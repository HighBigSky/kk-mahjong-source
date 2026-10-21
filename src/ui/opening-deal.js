// 开局发牌只重放公开的数量与牌背；真实手牌、牌墙、顺序和回合始终以服务端为准。
export const DEAL_TEXT = Object.freeze({progress:'正在发牌…', layer:'开局发牌动画'});
const STORAGE_KEY = 'kk-opening-deal-seen';
const BATCH_INTERVAL = 145;
const FLIGHT_DURATION = 360;

/** 三轮四张，随后各补一张，庄家最后再摸一张；索引只用于展示落点。 */
export function openingDealBatches(dealer, extraIndex = 13) {
  if (!Number.isInteger(dealer) || dealer < 0 || dealer > 3 || !Number.isInteger(extraIndex) || extraIndex < 0 || extraIndex > 13) return [];
  const order = Array.from({length:4}, (_, index) => (dealer + index) % 4);
  const indexes = order.map(player => Array.from({length:player === dealer ? 14 : 13}, (_, index) => index)
    .filter(index => player !== dealer || index !== extraIndex));
  const batches = [];
  for (let pass=0;pass<3;pass++) for (let seat=0;seat<4;seat++) {
    batches.push({player:order[seat], indexes:indexes[seat].slice(pass*4,pass*4+4)});
  }
  for (let seat=0;seat<4;seat++) batches.push({player:order[seat], indexes:[indexes[seat][12]]});
  batches.push({player:dealer, indexes:[extraIndex]});
  return batches;
}

/** 普通发牌从墙头取，跳过翻出的皮子；不读取或推测其他玩家的牌面。 */
export function openingDealSlots(indicatorPosition = null) {
  return Array.from({length:136}, (_, index) => 135-index).filter(index => index !== indicatorPosition).slice(0,53);
}

/** 只接收尚未发生任何打牌或杠牌的真实开局快照，重连中途牌局不补播。 */
export function isOpeningDeal(room, game) {
  return room?.status === 'playing' && !room.paused && game.phase?.kind === 'discard' &&
    Number.isInteger(game.dealer) && game.current === game.dealer &&
    game.players?.length === 4 && game.players.every((player, index) =>
      player.hand.length === (index === game.dealer ? 14 : 13) &&
      !player.melds.length && !player.redGangs.length && !(player.piziGangs || []).length && !player.discards.length) &&
    game.wall?.length === 136-53-(game.indicatorTile == null ? 0 : 1) &&
    game.wallInfo?.tailDraws === 0 && game.events?.some(event => /^第 \d+ 局开始，/.test(event));
}

export function createOpeningDeal({stage, storage = null, canPlay = () => true, onLockChange = () => {}, onFinish = () => {}}) {
  const layer = document.createElement('div');
  layer.id = 'opening-deal';
  layer.className = 'opening-deal';
  layer.setAttribute('aria-hidden','true');
  layer.setAttribute('aria-label',DEAL_TEXT.layer);
  layer.hidden = true;
  stage.append(layer);
  const seen = new Set();
  try { for (const key of JSON.parse(storage?.getItem(STORAGE_KEY) || '[]')) if (typeof key === 'string') seen.add(key); } catch { /* 本地存储不影响发牌和正常对局。 */ }
  let state = null, phase = 'idle', generation = 0, watchdog = null, stageBox = null;
  const animations = new Set();
  const rect = node => {
    const box = node.getBoundingClientRect();
    return {left:box.left-stageBox.left, top:box.top-stageBox.top, width:box.width, height:box.height};
  };
  function remember(key) {
    seen.add(key);
    while (seen.size > 16) seen.delete(seen.values().next().value);
    try { storage?.setItem(STORAGE_KEY,JSON.stringify([...seen])); } catch { /* 隐私模式仍可在本页防止重复播放。 */ }
  }
  function finish(notify = true) {
    if (phase === 'idle') return;
    generation++; phase = 'idle'; state = null;
    clearTimeout(watchdog); watchdog = null;
    for (const animation of animations) animation.cancel();
    animations.clear(); layer.replaceChildren(); layer.hidden = true;
    stage.classList.remove('is-opening-deal');
    delete layer.dataset.phase; delete layer.dataset.batch; delete layer.dataset.player;
    onLockChange();
    if (notify) onFinish();
  }
  function animate(element, frames, timing) {
    const animation = element.animate(frames,timing);
    animations.add(animation);
    // 立即注册取消分支，离房/旋转/切后台时不产生未处理的 Promise 拒绝。
    animation.finished.then(()=>animations.delete(animation),()=>animations.delete(animation));
    return animation;
  }
  function prepare(room, game) {
    if (phase !== 'idle' || !isOpeningDeal(room,game)) return false;
    const key = `${room.code}:${game.round}:${game.wallInfo.dice.join(',')}:${game.indicatorTile}`;
    if (seen.has(key)) return false;
    remember(key);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || typeof layer.animate !== 'function' || document.hidden) return false;
    state = {key, code:room.code, round:game.round, dealer:game.dealer,
      drawnIndex:game.dealer === 0 ? game.lastDraw?.index : null, slots:openingDealSlots(game.wallInfo.indicatorPosition)};
    phase = 'waiting'; layer.dataset.phase = phase;
    stage.classList.add('is-opening-deal'); onLockChange();
    return true;
  }
  function play() {
    if (phase !== 'waiting' || !canPlay()) return;
    if (document.hidden || !stage.classList.contains('is-landscape')) { finish(); return; }
    // 动画为可选展示，浏览器不支持或中途失败时直接恢复真实手牌，不能留下输入锁。
    try { launch(); } catch { finish(); }
  }
  function launch() {
    const mine = ++generation;
    stageBox = stage.getBoundingClientRect();
    const targets = [Array.from(stage.querySelectorAll('#hand button')),
      Array.from(stage.querySelectorAll('#backs-1 .back')), Array.from(stage.querySelectorAll('#backs-2 .back')),
      Array.from(stage.querySelectorAll('#backs-3 .back'))];
    const extraIndex = state.dealer === 0 ? targets[0].findIndex(node=>Number(node.dataset.index) === state.drawnIndex) : 13;
    const batches = openingDealBatches(state.dealer,extraIndex >= 0 ? extraIndex : 13);
    const sources = state.slots.map(position=>stage.querySelector(`.wall-piece[data-position="${position}"]`));
    if (targets.some((nodes, index)=>nodes.length !== (index === state.dealer ? 14 : 13)) || sources.some(node=>!node)) { finish(); return; }
    // 先一次性读取所有落点，再插入动画节点，避免每张牌读写交替导致布局抖动。
    const destinations = targets.map(nodes=>nodes.map(node=>({node, box:rect(node)})));
    const sourceBoxes = sources.map(rect);
    if (sourceBoxes.some(box=>box.width <= 0 || box.height <= 0) || destinations.flat().some(({box})=>box.width <= 0 || box.height <= 0)) { finish(); return; }
    phase = 'running'; layer.dataset.phase = phase; layer.hidden = false;
    const flights = [], fragment = document.createDocumentFragment();
    let offset = 0;
    for (const [batchIndex, batch] of batches.entries()) for (const [inBatch, index] of batch.indexes.entries()) {
      const {node, box} = destinations[batch.player][index], source = sourceBoxes[offset++];
      const delay = batchIndex*BATCH_INTERVAL+inBatch*12;
      const wallBack = document.createElement('span');
      wallBack.className = 'deal-source back';
      Object.assign(wallBack.style,{left:`${source.left}px`,top:`${source.top}px`,width:`${source.width}px`,height:`${source.height}px`});
      const flight = document.createElement('div');
      flight.className = 'deal-flight'; flight.dataset.player = String(batch.player); flight.dataset.batch = String(batchIndex); flight.dataset.count = String(batch.indexes.length); flight.dataset.source = String(state.slots[offset-1]);
      Object.assign(flight.style,{left:`${box.left}px`,top:`${box.top}px`,width:`${box.width}px`,height:`${box.height}px`});
      const face = node.cloneNode(true);
      face.classList.add('deal-face'); face.classList.remove('selected','hinted','drawn');
      for (const child of [face,...face.querySelectorAll('[id]')]) child.removeAttribute('id');
      face.removeAttribute('data-index'); face.removeAttribute('title'); face.setAttribute('tabindex','-1');
      if ('disabled' in face) face.disabled = true;
      flight.append(face);
      if (batch.player === 0) {
        const cover = document.createElement('span'); cover.className = 'deal-cover back'; flight.append(cover);
        animate(cover,[{opacity:1,offset:0},{opacity:1,offset:.65},{opacity:0,offset:1}],{duration:FLIGHT_DURATION,delay,fill:'both'});
      }
      const dx = source.left-box.left, dy = source.top-box.top;
      const sx = source.width/box.width, sy = source.height/box.height;
      const lift = Math.min(stageBox.height*.035,16);
      const animation = animate(flight,[
        {transform:`translate(${dx}px,${dy}px) scale(${sx},${sy})`,opacity:0,offset:0},
        {transform:`translate(${dx}px,${dy}px) scale(${sx},${sy})`,opacity:1,offset:.04},
        {transform:`translate(${dx*.45}px,${dy*.45-lift}px) scale(${sx+(1-sx)*.6},${sy+(1-sy)*.6})`,opacity:1,offset:.55},
        {transform:'translate(0,0) scale(1)',opacity:1,offset:1},
      ],{duration:FLIGHT_DURATION,delay,easing:'cubic-bezier(.2,.65,.3,1)',fill:'both'});
      flights.push(animation.finished);
      animate(wallBack,[{opacity:1},{opacity:0}],{duration:1,delay,fill:'forwards'});
      fragment.append(wallBack,flight);
    }
    layer.append(fragment);
    const duration = (batches.length-1)*BATCH_INTERVAL+FLIGHT_DURATION;
    watchdog = setTimeout(()=>{ if (generation === mine) finish(); },duration+500);
    Promise.allSettled(flights).then(()=>{ if (generation === mine) finish(); });
  }
  function retain(room, game, connected = true) {
    if (phase === 'idle') return false;
    if (!connected || room?.status !== 'playing' || room.paused || room.code !== state.code || game.round !== state.round || game.phase.kind === 'ended') {
      finish(false); return false;
    }
    return true;
  }
  function layoutChanged() {
    if (phase !== 'idle' && !stage.classList.contains('is-landscape')) { finish(); return; }
    if (phase === 'waiting') { play(); return; }
    if (phase !== 'running') return;
    const box = stage.getBoundingClientRect();
    if (Math.abs(box.width-stageBox.width)>1 || Math.abs(box.height-stageBox.height)>1 || Math.abs(box.left-stageBox.left)>1 || Math.abs(box.top-stageBox.top)>1) finish();
  }
  document.addEventListener('visibilitychange',()=>{ if (document.hidden) finish(); });
  document.addEventListener('close',play,true);
  window.addEventListener('pagehide',()=>finish(false));
  return {get active(){return phase !== 'idle';}, prepare, play, retain, layoutChanged, cancel:()=>finish(false)};
}
