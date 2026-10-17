import { tileName, chooseDiscard, isSpecialGangTile, classifyWin } from './engine.js';
import { createRoomClient } from './src/network/client.js';
import { createVoiceChat } from './src/network/voice.js';
import { RED_DRAGON } from './src/domain/tile.js';
import { PHASE } from './src/domain/model.js';
import { renderWall } from './src/network/wall-view.js';
import { createRoomOrientation } from './src/ui/orientation.js';
import { loadTilesSprite, tileHref } from './src/ui/tiles-sprite.js';

// 先把牌面精灵图内联进文档，再开始渲染：<use> 走同文档引用，不会被反复回源。
await loadTilesSprite();

const $ = selector => document.querySelector(selector);
const renderedHTML = new WeakMap();
// 手牌按「牌面 + 第几张同牌」复用节点：重建 innerHTML 会让每张牌的 SVG 重新解析，
// 出牌/接牌时会闪一下白。复用后只有真正增减的牌才新建节点。
const handNodes = new Map();
const network = createRoomClient({ onChange:roomChanged, onError:roomError });
const voice = createVoiceChat({
  getIceServers: () => network.voiceConfig(),
  sendSignal: payload => network.signal(payload),
  onState: updateVoiceState,
  onSpeaking: voiceSpeaking,
});
network.onSignal(payload => voice.handleSignal(payload));
const game = network.game;
const displayNames = ['你', '等待好友', '等待好友', '等待好友'];
const avatars = ['assets/avatar-player.svg', 'assets/avatar-1.svg', 'assets/avatar-2.svg', 'assets/avatar-3.svg'];
const seats = ['东', '南', '西', '北'];
let selected = -1;
let hinted = -1;
let toastTimer = null;
let resultShown = 0;
let audio = null;
let lastSoundEvent = '';
const preferences = { sound: false };
let previousRoomCode = null;
let previousRound = 0;
let previousVersion = -1;
let previousStatus = 'waiting';
let roomBusy = false;
let resultTimer = null;
let actionNoticeTimer = null;
let actionNoticeKey = null;
let actionNoticeDeadline = 0;
let voiceAnnouncing = false;
const ACTION_NOTICE_LABELS = Object.freeze({ chi: '吃', peng: '碰', gang: '杠', hu: '胡' });
const roomOrientation = createRoomOrientation({onLayout:positionActionNotice});

try {
  const saved = JSON.parse(localStorage.getItem('queqi-settings') || '{}');
  preferences.sound = saved.sound === true;
  $('#room-name').value = localStorage.getItem('queqi-nickname') || '';
} catch { /* Browsers may disable local storage; the game still works. */ }

function persist() {
  try {
    localStorage.setItem('queqi-settings', JSON.stringify(preferences));
  } catch { /* Persistence is optional. */ }
}

function roomError(message) {
  $('#room-error').textContent = message;
  $('#room-error').hidden = false;
  toast(message);
}

/** 刷新语音面板与顶部按钮的文案、图标和可用状态。 */
function updateVoiceState(state = voice.getState()) {
  const room = network.room;
  const button = $('#voice-btn');
  button.disabled = !room;
  button.classList.toggle('is-active', state.active);
  button.classList.toggle('is-muted', state.active && state.muted);
  button.querySelector('use').setAttribute('href', state.active && state.muted ? '#i-mic-off' : '#i-mic');
  button.setAttribute('aria-label', state.active ? state.muted ? '语音已静音' : '语音已开启' : '开黑语音');
  button.title = state.active ? state.muted ? '语音已静音' : '语音已开启' : '开黑语音';

  $('#voice-status').textContent = state.starting ? '正在申请麦克风…'
    : state.active ? state.muted ? '语音已开启 · 麦克风已静音' : '语音已开启' : '语音未开启';
  $('#voice-start').hidden = state.active || state.starting;
  $('#voice-start').disabled = state.starting || !room;
  $('#voice-mute').hidden = !state.active;
  $('#voice-mute').textContent = state.muted ? '取消静音' : '静音';
  $('#voice-mute').setAttribute('aria-pressed', String(state.muted));
  $('#voice-leave').hidden = !state.active;
  $('#voice-leave').disabled = state.starting;
  $('#voice-error').hidden = !state.error;
  if (state.error) $('#voice-error').textContent = state.error;

  if (!room) {
    $('#voice-participants').textContent = '加入房间后可以开启语音';
    return;
  }
  const names = [];
  room.seats.forEach((seat, index) => {
    if (seat.occupied && !seat.bot && seat.voice) names.push(index === 0 ? '你' : seat.name);
  });
  if (state.active && !names.includes('你')) names.unshift('你');
  $('#voice-participants').textContent = names.length ? `语音中：${names.join('、')}` : '还没有人加入语音';
}

/** 把绝对座位映射到当前玩家视角的座位，并切换说话高亮。 */
function voiceSpeaking(absoluteSeat, speaking) {
  const room = network.room;
  if (!room || !Number.isInteger(absoluteSeat)) return;
  const relative = (absoluteSeat - room.seat + 4) % 4;
  $(`#opponent-${relative}`)?.classList.toggle('is-speaking', Boolean(speaking));
}

/** 让服务端语音状态与本地麦克风状态保持一致，处理刷新或短暂断网后的残留。 */
function syncVoicePresence(room) {
  if (!room) {
    if (voice.isActive() || voice.getState().starting) voice.stop();
    return;
  }
  const self = room.seats[0];
  if (voice.isActive() && !self.voice && !voiceAnnouncing) {
    voiceAnnouncing = true;
    network.voice(true).catch(() => {}).finally(() => { voiceAnnouncing = false; });
  } else if (!voice.isActive() && self.voice && !voiceAnnouncing) {
    voiceAnnouncing = true;
    network.voice(false).catch(() => {}).finally(() => { voiceAnnouncing = false; });
  }
}

async function startVoice() {
  $('#voice-error').hidden = true;
  try {
    await voice.start(network.room);
    await network.voice(true);
    updateVoiceState();
  } catch (error) {
    const message = error?.message || '无法开启语音，请检查麦克风和网络后重试';
    $('#voice-error').textContent = message;
    $('#voice-error').hidden = false;
    toast(message);
  }
}

async function stopVoice() {
  voice.stop();
  updateVoiceState();
  try { await network.voice(false); } catch { /* 离开房间时服务端会清理语音状态。 */ }
}

function updateRoom() {
  const room = network.room;
  const connected = network.status === 'connected';
  const busy = roomBusy || network.busy;
  $('#room-entry').hidden = Boolean(room);
  $('#room-waiting').hidden = !room;
  $('#room-close').hidden = false;
  $('#room-create').disabled = busy;
  $('#room-join').disabled = busy;
  $('#connection-status').dataset.state = network.status;
  $('#connection-text').textContent = !room ? '未加入房间' : connected ? room.paused ? '等待重连' : '好友联机' : '正在重连';
  $('#room-label').textContent = room ? `好友房 · ${room.code}` : '好友房间 · 等待加入';
  if (!room) {
    $('#room-status').textContent = '创建房间，或输入好友发来的房间码。';
    return;
  }
  $('#room-current-code').textContent = room.code;
  const canStart = room.seats.every(seat => seat.occupied && seat.connected && seat.ready);
  const canManageBots = room.owner === 0 && room.status === 'waiting';
  $('#room-ready').disabled = busy || !connected || room.status !== 'waiting';
  $('#room-ready').textContent = room.status !== 'waiting' ? '已开局' : room.seats[0].ready ? '取消准备' : '准备';
  $('#room-start').hidden = room.owner !== 0 || room.status !== 'waiting';
  $('#room-start').disabled = busy || !connected || !canStart;
  $('#room-leave').disabled = busy || !connected || room.status === 'playing';
  $('#room-leave').title = room.status === 'playing' ? '请完成本局后离开，断线可回到原座位' : '离开房间';
  for (let index = 0; index < 4; index++) {
    const member = room.seats[index];
    const element = $(`#room-members [data-seat="${index}"]`);
    element.querySelector('.room-member-seat').textContent = seats[index];
    element.querySelector('.room-member-name').textContent = member.occupied ? `${member.name}${index === 0 ? '（你）' : ''}${index === room.owner ? ' · 房主' : ''}` : '等待好友';
    element.querySelector('.room-member-state').textContent = !member.occupied ? '空位' : member.bot ? room.status === 'waiting' ? '自动准备' : '人机' : !member.connected ? '离线' : room.status !== 'waiting' ? '已入座' : member.ready ? '已准备' : '未准备';
    element.classList.toggle('is-ready', member.ready);
    element.classList.toggle('is-offline', member.occupied && !member.connected);
    element.classList.toggle('is-bot', Boolean(member.bot));
    for (const [operation, label] of [['add', '添加人机'], ['remove', '移除人机'], ['kick', '移除离线']]) {
      let button = element.querySelector(`.room-bot-${operation}`);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = `room-bot-button room-bot-${operation}`;
        button.dataset.seat = String(index);
        button.textContent = label;
        element.append(button);
      }
      // 离线真人只能由房主移除；房主自己离线时，其他真人可移除以解开卡住的房间。
      const canKick = room.status !== 'playing' && member.occupied && !member.bot && !member.connected && index !== 0
        && (room.owner === 0 || room.owner === index);
      const show = operation === 'add' ? canManageBots && !member.occupied
        : operation === 'remove' ? canManageBots && Boolean(member.bot) : canKick;
      button.hidden = !show;
      button.disabled = busy || !connected;
      button.setAttribute('aria-label', `${operation === 'kick' ? '移除离线玩家' : label}，${seats[index]}家座位`);
    }
  }
  $('#room-status').textContent = !connected ? '连接中断，正在恢复原座位，请勿重复加入。'
    : room.paused ? '有好友离线，对局暂停等待重连。'
    : room.status === 'playing' ? '对局进行中，关闭此面板返回牌桌。'
    : room.seats.some(member => member.occupied && !member.bot && !member.connected) ? '有好友离线，等待重连；离线座位可由房主移除。'
    : room.status === 'ended' ? '本局结束，房主可以开始下一局。'
    : canStart ? room.owner === 0 ? '全员准备好了，可以开始对局。' : '全员准备好了，等待房主开局。'
    : room.seats.every(seat => seat.occupied) ? '人机已自动准备，等待真人玩家准备。'
    : room.owner === 0 ? '邀请好友，或点击空位添加人机；满四席并准备后开局。' : '等待好友入座，房主也可添加人机补位。';
}

function roomChanged() {
  const room = network.room;
  roomOrientation.setInRoom(Boolean(room));
  const changedRoom = (room?.code || null) !== previousRoomCode;
  const changedRound = changedRoom || game.round !== previousRound;
  if (changedRound) { clearTimeout(resultTimer); resultShown = 0; }
  if (changedRoom || room?.version !== previousVersion) {
    selected = -1; hinted = -1;
    $('#choice-dialog').close();
  }
  for (let index = 0; index < 4; index++) {
    const absolute = ((room?.seat || 0) + index) % 4;
    seats[index] = ['东','南','西','北'][absolute];
    displayNames[index] = room?.seats[index].name || (index === 0 ? '你' : '等待好友');
    const seat = $(`#opponent-${index}`);
    const label = document.createTextNode(displayNames[index]);
    seat.querySelector('.opponent-name').replaceChildren(label);
    if (index === 0) {
      const me = document.createElement('small'); me.textContent = '你';
      seat.querySelector('.opponent-name').append(me);
    } else if (room?.seats[index].bot) {
      const bot = document.createElement('small'); bot.textContent = '人机';
      seat.querySelector('.opponent-name').append(bot);
    }
    seat.querySelector('.seat').textContent = seats[index];
    seat.querySelector('img').src = avatars[absolute];
    seat.querySelector('img').alt = `${displayNames[index]}的头像`;
    seat.setAttribute('aria-label', `${['下方','右侧','上方','左侧'][index]}，${displayNames[index]}，${seats[index]}家`);
    $(`.direction[data-player="${index}"]`).textContent = seats[index];
  }
  $('.my-seat').textContent = seats[0];
  if (changedRound || previousStatus === 'waiting' && room?.status === 'playing') {
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    if (!room || room.status === 'waiting') openModal('#room-dialog');
  }
  const lastEvent = game.events.at(-1);
  if (!changedRound && lastEvent && lastSoundEvent !== lastEvent) playSound();
  lastSoundEvent = lastEvent || '';
  // 换房或换局后重新对齐朗读基线，避免把上一局/进房前的日志读出来。
  if (changedRoom || changedRound) announcedEvents = -1;
  announceDiscards();
  previousRoomCode = room?.code || null;
  previousVersion = room?.version ?? -1;
  previousRound = game.round;
  previousStatus = room?.status || 'waiting';
  updateRoom(); render();
  // 语音在线状态随房间快照同步；本地麦克风状态与服务器状态互相校正。
  for (let index = 0; index < 4; index++) {
    const member = room?.seats[index];
    $(`#opponent-${index}`).classList.toggle('has-voice', Boolean(member?.occupied && !member.bot && member.voice));
  }
  voice.sync(room);
  syncVoicePresence(room);
  updateVoiceState();
}

async function roomOperation(operation) {
  if (roomBusy) return;
  roomBusy = true; $('#room-error').hidden = true; updateRoom();
  try { await operation(); }
  catch (error) { roomError(error.message || '连接失败，请检查网络后重试'); }
  finally { roomBusy = false; updateRoom(); }
}

function nickname() {
  const name = $('#room-name').value.trim();
  if (!name || [...name].length > 12 || /[<>\x00-\x1f\x7f]/.test(name)) throw new Error('请输入 1–12 字昵称，不要包含尖括号或控制字符');
  try { localStorage.setItem('queqi-nickname', name); } catch { /* Optional preference. */ }
  return name;
}

function face(type) {
  return `<svg viewBox="0 0 60 84" aria-hidden="true"><use href="${tileHref(type)}"></use></svg>`;
}

function tile(type, className = '') {
  const wild = type === game.wildTile;
  const name = tileName(type) + (wild ? '，癞子' : '');
  return `<span class="tile ${className} ${wild ? 'is-wild' : ''}" title="${name}" aria-label="${name}">${face(type)}${wildMarker(type)}</span>`;
}

function wildMarker(type) {
  return type === game.wildTile ? '<span class="wild-marker" aria-hidden="true">癞</span>' : '';
}

// 顶栏皮子/癞子小结里的牌：牌面 + 皮/癞角标，替掉原来「皮子」「癞子」两段文字。
function laiziTile(type, badge) {
  const name = tileName(type) + (badge === '癞' ? '，癞子' : '，皮子');
  const marker = badge === '癞' ? 'wild-marker' : 'pizi-marker';
  return `<span class="tile ${badge === '癞' ? 'is-wild' : ''}" title="${name}" aria-label="${name}">${face(type)}<span class="${marker}" aria-hidden="true">${badge}</span></span>`;
}

// 骰子点数 → 3×3 格里的点位置（行/列），画成真正的骰子面而不是数字。
const DIE_PIPS = Object.freeze({
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]],
});

function diceHTML(values) {
  if (values.length !== 2) return '';
  const key = Math.min(...values);
  return values.map(value => {
    const pips = (DIE_PIPS[value] || []).map(([row, column]) => `<i style="grid-area:${row}/${column}"></i>`).join('');
    return `<span class="table-die${value === key ? ' is-key' : ''}">${pips}</span>`;
  }).join('');
}

function meldHTML(meld) {
  const label = meld.kind === 'gang' ? meld.added ? '补杠' : meld.concealed ? '暗杠' : '明杠' : meld.kind === 'chi' ? '吃' : '碰';
  return `<div class="meld-group" data-kind="${meld.kind}" aria-label="${label} ${meld.tiles.map(tileName).join('、')}"><span class="meld-label" aria-hidden="true">${label}</span>${meld.tiles.map(value => tile(value)).join('')}</div>`;
}

function specialGangHTML(type, kind) {
  const name = kind === 'redGang' ? '红中杠' : kind === 'wildGang' ? '癞子杠' : '皮子杠';
  const badge = kind === 'redGang' ? '红' : kind === 'wildGang' ? '癞' : '皮';
  return `<div class="meld-group special-gang" data-kind="${kind}" aria-label="${name} ${tileName(type)}，已公开"><span class="meld-label" aria-hidden="true">${badge}</span>${tile(type)}</div>`;
}

function specialTile(type) {
  return isSpecialGangTile(type, game.indicatorTile);
}

// 手牌角标只标「这是什么牌」，不标动作：红中、皮子、癞子分别标红/皮/癞，
// 与副露区杠出实牌的标记一致；「只能单张杠出」的提示留给 title 与提示文字。
function specialMarker(type) {
  if (!specialTile(type)) return wildMarker(type);
  return type === RED_DRAGON
    ? '<span class="red-kong-marker" aria-hidden="true">红</span>'
    : '<span class="pizi-marker" aria-hidden="true">皮</span>';
}

function heldSpecialName() {
  const hand = game.players[0].hand;
  return [hand.includes(RED_DRAGON) ? '红中' : '', game.indicatorTile !== null && hand.includes(game.indicatorTile) ? '皮子' : ''].filter(Boolean).join('、');
}

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2500);
}

function playSound(kind = 'tile') {
  if (!preferences.sound) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const tones = kind === 'win' ? [523.25, 659.25, 783.99] : [kind === 'select' ? 640 : 370];
    tones.forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime + index * .12;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * .8, start + .1);
      gain.gain.setValueAtTime(.055, start);
      gain.gain.exponentialRampToValueAtTime(.001, start + .16);
      oscillator.connect(gain); gain.connect(audio.destination);
      oscillator.start(start); oscillator.stop(start + .17);
    });
  } catch { /* Audio support is optional. */ }
}

// 出牌报牌名：用浏览器自带语音合成，零依赖。字牌单字容易听混，读全称。
const SPEECH_NAMES = Object.freeze({ 中: '红中', 发: '发财', 白: '白板' });
// 已读到的引擎日志条数：一个快照里可能同时带来好几条出牌，逐条读才不会漏。
let announcedEvents = -1;

function speakTile(name) {
  if (!preferences.sound || typeof speechSynthesis === 'undefined' || !name) return;
  try {
    const utterance = new SpeechSynthesisUtterance(SPEECH_NAMES[name] || name);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.15;
    utterance.pitch = 1;
    utterance.volume = 1;
    speechSynthesis.speak(utterance);
  } catch { /* 没有语音合成的浏览器只保留提示音。 */ }
}

function announceDiscards() {
  const events = game.events || [];
  if (announcedEvents < 0 || events.length < announcedEvents) {
    // 刚进房或刚开一局：只对齐基线，不把历史日志重读一遍。
    announcedEvents = events.length;
    return;
  }
  for (const event of events.slice(announcedEvents)) {
    const discarded = /打出(.+?)。$/.exec(event);
    if (discarded) speakTile(discarded[1]);
  }
  announcedEvents = events.length;
}

function syncSettings() {
  $('#sound-setting').checked = preferences.sound;
  $('#sound-btn use').setAttribute('href', preferences.sound ? '#i-sound' : '#i-mute');
  $('#sound-btn').setAttribute('aria-label', preferences.sound ? '关闭音效' : '开启音效');
  $('#sound-btn').setAttribute('aria-pressed', String(preferences.sound));
}

function humanTurn() { return network.canAct() && game.phase.kind === PHASE.DISCARD && game.current === 0; }
function modalOpen() { return Boolean(document.querySelector('dialog[open]')); }

// Keep existing SVG instances mounted when a snapshot has no visual changes.
function setHTMLIfChanged(element, html) {
  if (renderedHTML.get(element) === html) return;
  element.innerHTML = html;
  renderedHTML.set(element, html);
}

// Keep the word on the actual concealed hand's centreline, facing the felt.
// Public combinations can move that hand within its rack, so table percentages
// cannot describe its position. Layout reads happen only on renders/resizes.
function positionActionNotice() {
  const element = document.querySelector('.seat-action-notice:not([hidden])');
  if (!element) return;
  const stage = $('#game');
  const stageBounds = stage.getBoundingClientRect();
  const rotated = document.documentElement.classList.contains('landscape-rotated');
  // DOMRects use physical screen axes. Convert them back to the stage's
  // logical axes before aligning text on a CSS-rotated phone display.
  const rect = item => {
    const area = item.getBoundingClientRect();
    return rotated ? {left:area.top - stageBounds.top, right:area.bottom - stageBounds.top,
      top:stageBounds.right - area.right, bottom:stageBounds.right - area.left}
      : {left:area.left - stageBounds.left, right:area.right - stageBounds.left,
        top:area.top - stageBounds.top, bottom:area.bottom - stageBounds.top};
  };
  const player = Number(element.dataset.player);
  const hand = $(player === 0 ? '#hand' : `#backs-${player}`);
  const cards = [...hand.children].map(rect);
  if (!cards.length) return;
  const horizontal = player === 0 || player === 2;
  const forward = player === 2 || player === 3 ? 1 : -1;
  const axisStart = horizontal ? 'top' : 'left';
  const axisEnd = horizontal ? 'bottom' : 'right';
  const crossStart = horizontal ? 'left' : 'top';
  const crossEnd = horizontal ? 'right' : 'bottom';
  const centre = (Math.min(...cards.map(card => card[crossStart])) + Math.max(...cards.map(card => card[crossEnd]))) / 2;
  // The local heading and public row also belong behind its action word.
  const edge = player === 0 ? rect($('.hand-zone')).top
    : forward > 0 ? Math.max(...cards.map(card => card[axisEnd])) : Math.min(...cards.map(card => card[axisStart]));
  const board = {left:0, top:0, right:stage.clientWidth, bottom:stage.clientHeight};
  const table = rect($('.table'));
  element.style.removeProperty('width');
  element.style.removeProperty('height');
  element.style.removeProperty('font-size');
  const preferredSize = parseFloat(getComputedStyle(element).width);
  const unit = preferredSize / 6;
  const gap = .1 * unit;
  const obstacles = [...document.querySelectorAll('#hand button,.opponent-rack .tile,.opponent-rack .back,.my-melds .tile,.river .tile,#wall-tail .wall-piece:not(.is-empty),.player-seat,.action-zone:not([hidden]),.hand-heading,.turn-message,.last-event,.table-center,.wall-tail-meta')]
    .filter(item => item.getClientRects().length)
    .map(rect);
  // River counts are generated content, so their bounds are not DOM children.
  for (const river of document.querySelectorAll('.river')) {
    const area = rect(river);
    const style = getComputedStyle(river, '::before');
    const top = area.top + parseFloat(style.top);
    const height = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    obstacles.push({left:area.left, right:area.right, top, bottom:top + height});
  }
  let placement;
  // A crowded river can leave only a narrow lane in front of its wall. Prefer
  // the large word, then reduce it within that same centreline rather than
  // drifting to a different player's corner or covering physical tiles.
  for (let size = preferredSize; size >= 2 * unit - .01 && !placement; size -= .25 * unit) {
    let distance = gap;
    const crossLow = centre - size / 2;
    const crossHigh = centre + size / 2;
    for (let attempts = 0; attempts <= obstacles.length; attempts++) {
      const low = forward > 0 ? edge + distance : edge - distance - size;
      const high = low + size;
      if (distance + size > (player === 0 ? 16 : 23) * unit) break;
      const collision = obstacles.find(area => area[crossEnd] > crossLow + .1 && area[crossStart] < crossHigh - .1
        && area[axisEnd] + gap > low && area[axisStart] - gap < high);
      if (collision) {
        distance = forward > 0 ? collision[axisEnd] + gap - edge : edge - collision[axisStart] + gap;
        continue;
      }
      const left = horizontal ? crossLow : low;
      const top = horizontal ? low : crossLow;
      if (left >= board.left && top >= board.top && left + size <= board.right && top + size <= board.bottom) placement = {left, top, size};
      break;
    }
  }
  if (!placement) return;
  // The existing nodes stay in the table; include its border in the conversion.
  element.style.left = `${placement.left - table.left - $('.table').clientLeft}px`;
  element.style.top = `${placement.top - table.top - $('.table').clientTop}px`;
  element.style.width = element.style.height = `${placement.size}px`;
  element.style.fontSize = `${placement.size * .93}px`;
}

// The server announces only completed public actions. Repeated snapshots of
// the same notice may shorten its lifetime, but must never restart the timer.
function renderActionNotice() {
  clearTimeout(actionNoticeTimer);
  actionNoticeTimer = null;
  const notice = game.actionNotice;
  const label = notice && ACTION_NOTICE_LABELS[notice.kind];
  const valid = network.room && label && Number.isInteger(notice.player) && notice.player >= 0 && notice.player < 4;
  const now = Date.now();
  if (valid) {
    const key = `${network.room.code}:${game.round}:${notice.id}`;
    const deadline = notice.remainingMs === null ? Infinity : now + Math.max(0, notice.remainingMs);
    actionNoticeDeadline = key === actionNoticeKey ? Math.min(actionNoticeDeadline, deadline) : deadline;
    actionNoticeKey = key;
  } else {
    actionNoticeKey = null;
    actionNoticeDeadline = 0;
  }
  const visible = valid && actionNoticeDeadline > now;
  for (const element of document.querySelectorAll('.seat-action-notice')) {
    const shown = visible && Number(element.dataset.player) === notice.player;
    element.hidden = !shown;
    if (shown) {
      element.dataset.kind = notice.kind;
      if (element.textContent !== label) element.textContent = label;
      element.setAttribute('aria-label', `${displayNames[notice.player]}${label}`);
    } else {
      element.textContent = '';
      element.removeAttribute('data-kind');
      element.removeAttribute('aria-label');
    }
  }
  positionActionNotice();
  if (visible && Number.isFinite(actionNoticeDeadline)) {
    actionNoticeTimer = setTimeout(renderActionNotice, Math.max(1, actionNoticeDeadline - Date.now()));
  }
}

function updateHandState() {
  const myTurn = humanTurn();
  for (const button of $('#hand').children) {
    const index = Number(button.dataset.index);
    button.classList.toggle('selected', index === selected);
    button.classList.toggle('hinted', index === hinted);
    button.disabled = !myTurn;
    button.setAttribute('aria-disabled', String(!myTurn || specialTile(game.players[0].hand[index])));
    button.setAttribute('aria-pressed', String(index === selected));
  }
}

function updateTurnMessage(actions = game.getActions(0)) {
  const room = network.room;
  const active = Boolean(room && room.status !== 'waiting');
  const myTurn = humanTurn();
  const hand = game.players[0].hand;
  const specialName = heldSpecialName();
  let message;
  if (!active) message = room ? '邀请好友或添加人机，准备后由房主开局' : '创建房间，邀请好友一起打牌';
  else if (network.status !== 'connected') message = '连接中断，正在重新连接房间…';
  else if (room.paused) message = '有好友离线，对局暂停等待重连';
  else if (game.phase.kind === PHASE.ENDED) message = game.winner === null ? '牌墙已空，本局流局' : game.winner === 0 ? '好牌，胡了！' : `${displayNames[game.winner]}${game.result.selfDraw ? '自摸' : '胡牌'}，下局再来`;
  else if (actions.pass) message = specialName ? `${displayNames[game.pendingDiscard.from]}打出${tileName(game.pendingDiscard.tile)}；手中有${specialName}，不能胡牌` : `${displayNames[game.pendingDiscard.from]}打出${tileName(game.pendingDiscard.tile)}，请选择操作`;
  else if (myTurn) message = actions.hu ? '好牌来了，可以自摸胡牌！' : selected >= 0 ? `已选${tileName(hand[selected])}，再点一次打出` : specialName ? `${specialName}只能杠出，全部杠出后才能胡牌` : '轮到你了，请选择一张牌打出';
  else message = game.phase.kind === PHASE.CLAIM ? '等待其他玩家响应…' : `${displayNames[game.current]}正在思考…`;
  $('#turn-text').textContent = message;
  $('.turn-message').classList.toggle('thinking', active && !myTurn && !actions.pass && game.phase.kind !== PHASE.ENDED);
}

// Selection is local UI state: it must not recreate the table or its tile faces.
function renderSelection() {
  updateHandState();
  updateTurnMessage();
}

function render() {
  const room = network.room;
  const active = Boolean(room && room.status !== 'waiting');
  const revealHands = game.phase.kind === PHASE.ENDED && game.result?.kind === 'win';
  const hand = game.players[0].hand;
  const actions = game.getActions(0);
  const myTurn = humanTurn();
  const specialName = heldSpecialName();
  $('#score').textContent = game.players[0].score.toLocaleString('zh-CN');
  $('#wall-count').textContent = game.wall.length;
  $('#wall-pill').hidden = !active;
  $('#wall-pill').setAttribute('aria-label', `牌墙剩余 ${game.wall.length} 张`);
  renderWall($('#wall-tail'), game);
  const dice = game.wallInfo?.dice || [];
  setHTMLIfChanged($('#table-dice'), diceHTML(dice));
  $('.table-center').setAttribute('aria-label', dice.length === 2
    ? `牌桌中央，骰子 ${dice[0]} 点和 ${dice[1]} 点，取较小点数 ${Math.min(...dice)} 翻皮；牌墙剩余 ${game.wall.length} 张`
    : '牌桌中央');
  $('#round-label').textContent = active ? `第 ${game.round} 局 · ${game.dealer === 0 ? '你' : displayNames[game.dealer]}坐庄` : '四人准备后开局';
  $('#laizi-summary').hidden = !game.laiziEnabled;
  // 皮子/癞子用牌面 + 角标表示，省掉「皮子」「癞子」两段文字，窄屏顶栏才放得下。
  setHTMLIfChanged($('#indicator-tile'), game.laiziEnabled ? laiziTile(game.indicatorTile, '皮') : '');
  setHTMLIfChanged($('#wild-tile'), game.laiziEnabled ? laiziTile(game.wildTile, '癞') : '');
  $('#laizi-summary').setAttribute('aria-label', game.laiziEnabled ? `皮子${tileName(game.indicatorTile)}，癞子${tileName(game.wildTile)}` : '未启用翻皮子定癞子');
  $('#hand-count').textContent = `${hand.length} 张`;
  $('.hand-zone').classList.toggle('has-melds', game.players[0].melds.length + game.players[0].redGangs.length + (game.players[0].piziGangs?.length || 0) > 0);

  const drawnIndex = game.phase.kind === PHASE.DISCARD && game.current === 0 && game.lastDraw?.player === 0 ? game.lastDraw.index : -1;
  const tilePriority = type => specialTile(type) ? 0 : type === game.wildTile ? 1 : 2;
  // Special tiles stay in their priority group even when just drawn.
  const separatedDrawnIndex = drawnIndex >= 0 && tilePriority(hand[drawnIndex]) === 2 ? drawnIndex : -1;
  const order = hand.map((type, index) => ({ type, index }))
    .filter(entry => entry.index !== separatedDrawnIndex)
    .sort((left, right) => tilePriority(left.type) - tilePriority(right.type) || left.type - right.type);
  if (separatedDrawnIndex >= 0 && separatedDrawnIndex < hand.length) order.push({ type: hand[separatedDrawnIndex], index: separatedDrawnIndex });
  const handKeySeen = new Map();
  const handTileNodes = order.map(({ type, index }) => {
    const occurrence = handKeySeen.get(type) || 0;
    handKeySeen.set(type, occurrence + 1);
    const special = specialTile(type);
    const wild = type === game.wildTile;
    // 角标随本局皮子/癞子变化，缓存键必须带上这两个标记，否则换局后会留着上一局的角标。
    const key = `${type}:${occurrence}:${special ? 'p' : ''}${wild ? 'w' : ''}`;
    let node = handNodes.get(key);
    if (!node) {
      node = document.createElement('button');
      node.dataset.key = key;
      node.innerHTML = `${face(type)}${specialMarker(type)}`;
      handNodes.set(key, node);
    }
    node.dataset.index = String(index);
    node.className = `tile ${special ? 'red-kong-tile' : ''} ${wild ? 'is-wild' : ''} ${index === separatedDrawnIndex ? 'drawn' : ''}`.trim();
    node.setAttribute('aria-label', `${tileName(type)}${special ? '，只能杠出，不能打出' : ''}${wild ? '，癞子' : ''}${index === drawnIndex ? '，摸到的牌' : ''}`);
    if (special) node.title = '只能单张杠出，从牌墙末端补摸一张牌';
    else node.removeAttribute('title');
    return node;
  });
  const handElement = $('#hand');
  // 只做最小改动：删掉多余的牌、插入新增的牌，其余节点原地不动。
  // 整块 replaceChildren 会把 14 张牌全部摘下再插回，<use> 需要重新解析，仍可能闪一帧。
  const wantedHandNodes = new Set(handTileNodes);
  for (const child of [...handElement.children]) if (!wantedHandNodes.has(child)) child.remove();
  let handReference = handElement.firstChild;
  for (const node of handTileNodes) {
    if (node === handReference) { handReference = handReference.nextSibling; continue; }
    handElement.insertBefore(node, handReference);
  }
  updateHandState();

  for (let player = 0; player < 4; player++) {
    const seat = game.players[player];
    const river = $(`#river-${player}`);
    // 牌河四边同尺寸同行数：上下各 6 列×2 行（12 张），左右各 3 列×2 行（6 张）。
    // 所有横屏尺寸保持同一上限，避免侧边牌河侵入中央罗盘。
    const limit = player === 0 || player === 2 ? 12 : 6;
    const offset = Math.max(0, seat.discards.length - limit);
    setHTMLIfChanged(river, seat.discards.slice(offset).map((type, index) => tile(type, game.pendingDiscard?.from === player && index === seat.discards.length - offset - 1 ? 'last-discard' : '')).join(''));
    river.dataset.label = `${seats[player]} · ${seat.discards.length} 张${offset ? ' ›' : ''}`;
    river.setAttribute('aria-label', `${displayNames[player]}的出牌，共${seat.discards.length}张，点击查看全部`);
    river.setAttribute('role', 'button');
    river.tabIndex = 0;
    const piziGangs = seat.piziGangs || [];
    const piziOnly = piziGangs.filter(tile => tile !== game.wildTile);
    const wildOnly = piziGangs.filter(tile => tile === game.wildTile);
    const melds = $(`#melds-${player}`);
    const publicGroups = [...seat.redGangs.map(type => specialGangHTML(type, 'redGang')), ...piziGangs.map(type => specialGangHTML(type, type === game.wildTile ? 'wildGang' : 'piziGang')), ...seat.melds.map(meldHTML)];
    setHTMLIfChanged(melds, publicGroups.join(''));
    melds.hidden = publicGroups.length === 0;
    melds.setAttribute('aria-label', `${displayNames[player]}已公开的吃碰杠牌，红中杠${seat.redGangs.length}张，皮子杠${piziOnly.length}张，癞子杠${wildOnly.length}张，普通副露${seat.melds.length}组`);
    const rack = $(`#rack-${player}`);
    rack.classList.toggle('has-melds', publicGroups.length > 0);
    rack.style.setProperty('--concealed-count', seat.hand.length);
    rack.style.setProperty('--meld-count', seat.melds.length);
    rack.style.setProperty('--special-count', seat.redGangs.length + piziGangs.length);
    $(`#score-${player}`).textContent = seat.score.toLocaleString('zh-CN');
    $(`#dealer-${player}`).hidden = !active || game.dealer !== player;
    const redBadge = $(`#red-gangs-${player}`);
    redBadge.hidden = seat.redGangs.length + piziGangs.length === 0;
    redBadge.textContent = [seat.redGangs.length ? `中×${seat.redGangs.length}` : '', piziOnly.length ? `皮×${piziOnly.length}` : '', wildOnly.length ? `癞×${wildOnly.length}` : ''].filter(Boolean).join(' ');
    redBadge.title = `${displayNames[player]}已杠出红中 ${seat.redGangs.length} 张、皮子 ${piziOnly.length} 张、癞子 ${wildOnly.length} 张，实牌公开摆在手牌旁`;
    redBadge.setAttribute('aria-label', redBadge.title);
    $(`#opponent-${player}`).classList.toggle('is-active', active && game.current === player && game.phase.kind !== PHASE.ENDED);
    $(`#opponent-${player}`).classList.toggle('is-claiming', player === 0 && actions.pass);
    $(`#state-${player}`).textContent = !room?.seats[player].occupied ? '等待好友' : !room.seats[player].connected ? '离线重连中' : !active ? room.seats[player].ready ? '已准备' : '未准备' : game.phase.kind === PHASE.ENDED ? (game.winner === player ? '胡牌了' : '本局结束') : player === 0 && actions.pass ? '请选择操作' : game.current === player && game.phase.kind === PHASE.DISCARD ? (player === 0 ? '请出牌' : '正在出牌') : '等待中';
    if (player === 0) continue;
    const backs = $(`#backs-${player}`);
    backs.classList.toggle('is-revealed', revealHands);
    setHTMLIfChanged(backs, seat.hand.map(type => revealHands ? tile(type) : '<span class="back"></span>').join(''));
    backs.setAttribute('aria-label', `${displayNames[player]}的${seat.hand.length}张${revealHands ? '已亮出手牌' : '暗牌'}`);
  }
  document.querySelectorAll('.direction').forEach(element => element.classList.toggle('active', active && Number(element.dataset.player) === game.current && game.phase.kind !== PHASE.ENDED));

  const enabled = { chi: actions.chi.length > 0, peng: actions.peng, gang: actions.redGang || actions.piziGang || actions.wildGang || actions.gang || actions.concealedGangs.length > 0 || actions.addedGangs.length > 0, hu: actions.hu, pass: actions.pass };
  for (const [action, available] of Object.entries(enabled)) {
    const button = $(`#action-${action}`);
    button.disabled = !available;
    button.hidden = !available;
  }
  // 「出牌提示」只在轮到自己、且没有吃碰杠胡可选时出现：有牌可吃碰杠胡时它只会分心。
  const hintAvailable = myTurn && !(enabled.chi || enabled.peng || enabled.gang || enabled.hu || enabled.pass);
  $('#hint-btn').disabled = !hintAvailable;
  $('#hint-btn').hidden = !hintAvailable;
  const canNextRound = game.phase.kind === PHASE.ENDED && room?.owner === 0;
  const nextRoundReady = canNextRound && network.status === 'connected' && !room?.seats.some(seat => !seat.connected);
  $('#action-next').hidden = !canNextRound;
  $('#action-next').disabled = !nextRoundReady || network.busy;
  $('.action-zone').hidden = !(Object.values(enabled).some(Boolean) || canNextRound || hintAvailable);
  $('#action-gang').title = actions.redGang || actions.piziGang || actions.wildGang ? '可单张杠出红中、皮子或癞子，从墙尾补摸一张牌' : '杠牌';

  updateTurnMessage(actions);
  $('#last-event').textContent = game.events.at(-1) || '好友同桌，支持添加人机';
  $('#action-caption').textContent = game.phase.kind === PHASE.ENDED ? '本局结束' : actions.pass ? '响应出牌' : '对局操作';
  $('#action-context').textContent = game.phase.kind === PHASE.ENDED ? (nextRoundReady ? '可以开始下一局' : '等待好友重连') : actions.hu ? '胡牌可用' : specialName ? `先杠出${specialName}，才能胡牌` : actions.concealedGangs.length ? '可暗杠' : actions.addedGangs.length ? '可补杠' : actions.pass ? '胡 > 碰杠 > 吃' : '好牌，慢慢打';
  $('#hand-instruction').textContent = !active ? '加入房间后由服务端发牌' : game.phase.kind === PHASE.ENDED ? '等待房主开始下一局' : !myTurn ? '等待轮到你时出牌' : '点选手牌，再点一次打出';
  $('#next-round').disabled = room?.owner !== 0 || network.status !== 'connected' || network.busy || room?.seats.some(seat => !seat.connected);
  $('#next-round').textContent = room?.owner === 0 ? '开始下一局' : '等待房主开始下一局';
  syncSettings();
  renderActionNotice();
  if (game.phase.kind === PHASE.ENDED && resultShown !== game.round) {
    resultShown = game.round;
    persist();
    resultTimer = setTimeout(showResult, 350);
  }
}

async function moveDone(operation) {
  try {
    if (!await operation) { toast('当前不能执行这项操作'); return; }
    selected = -1; hinted = -1;
    playSound(); render();
  } catch (error) { roomError(error.message); }
}

function openModal(id) {
  if (!$(id).open) $(id).showModal();
}

function selectOptions(title, options) {
  $('#choice-title').textContent = title;
  const holder = $('#choice-options');
  holder.replaceChildren();
  for (const option of options) {
    const button = document.createElement('button');
    button.className = 'choice-option';
    button.innerHTML = option.tiles.map(value => tile(value)).join('') + `<span>${option.label}</span>`;
    button.addEventListener('click', () => {
      $('#choice-dialog').close();
      moveDone(game.claim(0, option.action, option.value));
    });
    holder.append(button);
  }
  openModal('#choice-dialog');
}

function performAction(action) {
  const actions = game.getActions(0);
  if (action === 'pass') return moveDone(game.pass(0));
  if (action === 'chi') {
    if (actions.chi.length === 1) return moveDone(game.claim(0, 'chi', actions.chi[0]));
    return selectOptions('选择吃牌组合', actions.chi.map(sequence => ({ tiles: sequence, label: '吃这组', action: 'chi', value: sequence })));
  }
  if (action === 'gang' && game.phase.kind === PHASE.DISCARD) {
    const options = [
      ...(actions.redGang ? [{ tiles: [RED_DRAGON], label: '红中杠 · 补摸1张', action: 'redGang' }] : []),
      ...(actions.piziGang ? [{ tiles: [game.indicatorTile], label: '皮子杠 · 补摸1张', action: 'piziGang' }] : []),
      ...(actions.wildGang ? [{ tiles: [game.wildTile], label: '癞子杠 · 补摸1张', action: 'wildGang' }] : []),
      ...actions.concealedGangs.map(type => ({ tiles: Array(4).fill(type), label: '暗杠', action: 'concealedGang', value: type })),
      ...actions.addedGangs.map(type => ({ tiles: Array(4).fill(type), label: '补杠', action: 'addedGang', value: type })),
    ];
    if (options.length === 1) return moveDone(game.claim(0, options[0].action, options[0].value));
    return selectOptions('选择杠牌组合', options);
  }
  moveDone(game.claim(0, action));
}

function showResult() {
  if (game.phase.kind !== PHASE.ENDED) return;
  const result = game.result;
  $('#result-title').textContent = result.kind === 'draw' ? '好牌，下局再来' : game.winner === 0 ? '好牌，胡了！' : `${displayNames[game.winner]}胡牌`;
  $('#result-avatar').src = avatars[((network.room?.seat || 0) + (game.winner ?? 0)) % 4];
  const classification = result.kind === 'win'
    ? classifyWin(result.hand, game.players[game.winner].melds, game.wildTile, game.indicatorTile) : null;
  const winTypes = classification ? [
    classification.sevenPairs ? '七对' : '', classification.allTriplets ? '碰碰胡' : '',
    classification.allJiang ? '将一色' : '', classification.allHonors ? '风一色' : '',
  ].filter(Boolean) : [];
  if (classification?.ordinary && !winTypes.length) winTypes.push('屁胡');
  const resultLabels = [...new Set([...winTypes, ...result.patterns])];
  $('#result-detail').textContent = result.kind === 'draw' ? '余牌已用完，金币不变。' : `${result.reason} · ${resultLabels.join(' · ')} · ${result.points} 基础分`;
  $('#result-hand').innerHTML = result.kind === 'win' ? [...game.players[game.winner].melds.flatMap(meld => meld.tiles), ...result.hand].map(value => tile(value)).join('') : '';
  $('#result-scores').replaceChildren(...displayNames.map((name, index) => {
    const row = document.createElement('div'); row.className = 'result-score-row';
    const label = document.createElement('span'); label.textContent = name + (index === 0 ? '（你）' : '');
    const score = document.createElement('strong');
    score.className = result.scoreDelta[index] > 0 ? 'positive' : result.scoreDelta[index] < 0 ? 'negative' : '';
    score.textContent = `${result.scoreDelta[index] > 0 ? '+' : ''}${result.scoreDelta[index]}`;
    row.append(label, score); return row;
  }));
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  openModal('#result-dialog');
  if (game.winner === 0) playSound('win');
}

$('#hand').addEventListener('click', event => {
  const button = event.target.closest('button[data-index]');
  if (!button || !humanTurn()) return;
  const index = Number(button.dataset.index);
  if (specialTile(game.players[0].hand[index])) {
    const name = game.players[0].hand[index] === RED_DRAGON ? '红中' : '皮子';
    toast(game.getActions(0).redGang || game.getActions(0).piziGang ? `${name}只能杠出，请点击「杠」补摸一张` : `${name}只能杠出，当前无余牌可补杠`);
    return;
  }
  if (selected === index) return moveDone(game.discard(0, index));
  selected = index; hinted = -1;
  playSound('select'); renderSelection();
  $(`#hand [data-index="${index}"]`)?.focus({ preventScroll: true });
});
$('.action-buttons').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (button && !button.disabled) performAction(button.dataset.action);
});
$('#hint-btn').addEventListener('click', () => {
  if (!humanTurn()) return;
  if (game.getActions(0).redGang || game.getActions(0).piziGang) {
    selected = -1; hinted = -1; renderSelection();
    $('#action-gang').focus({ preventScroll: true });
    toast(`${heldSpecialName()}只能用于杠牌，点击「杠」补摸一张`);
    return;
  }
  const visible = [...game.players.flatMap(player => [...player.discards, ...player.redGangs, ...(player.piziGangs || []), ...player.melds.flatMap(meld => meld.tiles)]), ...(game.indicatorTile === null || game.indicatorTile === undefined ? [] : [game.indicatorTile])];
  hinted = chooseDiscard(game.players[0].hand, game.players[0].melds, visible, game.wildTile, game.indicatorTile);
  selected = hinted;
  renderSelection();
  toast(hinted < 0 ? '当前没有可打出的牌，红中和皮子只能用于杠牌' : `建议打出${tileName(game.players[0].hand[hinted])}，仅供参考`);
});
// 设置里的两个入口都会先关掉设置弹窗，再开对应对弹窗，避免两层弹窗叠在一起。
$('#settings-rules').addEventListener('click', () => {
  $('#settings-dialog').close();
  openModal('#rules-dialog');
});
$('#settings-btn').addEventListener('click', () => openModal('#settings-dialog'));
$('#settings-home').addEventListener('click', () => {
  $('#settings-dialog').close();
  openModal('#room-dialog');
});
$('#next-round').addEventListener('click', () => moveDone(network.next()));
$('#action-next').addEventListener('click', async () => {
  await moveDone(network.next());
  const dialog = $('#result-dialog');
  if (dialog?.open) dialog.close();
});
$('#room-create').addEventListener('click', () => roomOperation(async () => {
  const name = nickname();
  roomOrientation.prepareEntry();
  try { return await network.create(name, true); }
  finally { roomOrientation.finishEntry(Boolean(network.room)); }
}));
$('#room-join').addEventListener('click', () => roomOperation(async () => {
  const code = $('#room-code').value.trim();
  if (!/^\d{6}$/.test(code)) throw new Error('请输入 6 位数字房间码');
  const name = nickname();
  roomOrientation.prepareEntry();
  try { return await network.join(code, name); }
  finally { roomOrientation.finishEntry(Boolean(network.room)); }
}));
$('#room-code').addEventListener('keydown', event => { if (event.key === 'Enter') $('#room-join').click(); });
$('#room-ready').addEventListener('click', () => roomOperation(() => network.ready(!network.room.seats[0].ready)));
$('#room-start').addEventListener('click', () => roomOperation(() => network.start()));
$('#room-members').addEventListener('click', event => {
  const button = event.target.closest('.room-bot-button');
  if (!button || button.disabled) return;
  const seat = Number(button.dataset.seat);
  roomOperation(() => button.classList.contains('room-bot-kick') ? network.removePlayer(seat)
    : button.classList.contains('room-bot-add') ? network.addBot(seat) : network.removeBot(seat));
});
$('#room-leave').addEventListener('click', () => roomOperation(() => network.leave()));
$('#room-close').addEventListener('click', () => $('#room-dialog').close());
$('#room-options').addEventListener('click', () => openModal('#settings-dialog'));
$('#room-copy').addEventListener('click', () => roomOperation(async () => {
  const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('room', network.room.code);
  const invitation = `来KK麻将一起打牌，房间码：${network.room.code}\n${url.href}`;
  try {
    if (!navigator.clipboard?.writeText) throw new Error();
    await navigator.clipboard.writeText(invitation);
  } catch {
    const input = document.createElement('textarea'); input.value = invitation;
    input.setAttribute('aria-label', '邀请内容，长按或 Ctrl+C 复制');
    input.style.cssText = 'width:100%;min-height:90px;font-size:16px';
    $('#room-dialog').append(input); input.select();
    if (!document.execCommand('copy')) {
      $('#room-status').textContent = '请长按下方邀请内容复制，然后发给好友。';
      toast('邀请内容已显示，可以手动复制'); return;
    }
    input.remove();
  }
  $('#room-status').textContent = '邀请已复制，请发给好友；人机占满座位时可在开局前移除。';
  toast('邀请已复制，包含网址和房间码');
}));
$('#sound-btn').addEventListener('click', () => {
  preferences.sound = !preferences.sound; persist(); syncSettings(); playSound('select');
  toast(preferences.sound ? '音效已开启' : '音效已关闭');
});
$('#voice-btn').addEventListener('click', () => {
  updateVoiceState();
  openModal('#voice-dialog');
});
$('#voice-start').addEventListener('click', startVoice);
$('#voice-mute').addEventListener('click', () => {
  voice.toggleMuted();
  updateVoiceState();
});
$('#voice-leave').addEventListener('click', stopVoice);
window.addEventListener('beforeunload', () => voice.stop());
$('#sound-setting').addEventListener('change', event => { preferences.sound = event.target.checked; persist(); syncSettings(); playSound('select'); });
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => {
    if (dialog.id === 'room-dialog' && network.room?.status !== 'playing' && network.room?.status !== 'ended') return;
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
});
document.querySelectorAll('.river').forEach((river, player) => {
  const showRiver = () => {
    const index = Number(river.id.split('-')[1]);
    $('#history-title').textContent = `${displayNames[index]}的出牌`;
    $('#history-description').textContent = `共 ${game.players[index].discards.length} 张，按出牌顺序排列。已被吃碰杠的牌不在牌河中。`;
    $('#history-tiles').innerHTML = game.players[index].discards.map(value => tile(value)).join('') || '<p class="empty-river">还没有出牌</p>';
    const seat = game.players[index];
    const specialGangs = [...seat.redGangs, ...(seat.piziGangs || []), ];
    $('#history-red-record').hidden = specialGangs.length === 0;
    $('#history-red-tiles').innerHTML = specialGangs.map(value => tile(value)).join('');
    openModal('#history-dialog');
  };
  river.addEventListener('click', showRiver);
  river.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showRiver(); } });
});
document.addEventListener('keydown', event => {
  if (modalOpen() || !humanTurn()) return;
  if (event.key === 'Enter' && selected >= 0 && !event.target.closest('button:not([data-index])') && event.target.closest('[aria-disabled="true"]') === null) { event.preventDefault(); moveDone(game.discard(0, selected)); }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const order = [...$('#hand').querySelectorAll('[data-index][aria-disabled="false"]')].map(button => Number(button.dataset.index));
    if (!order.length) return;
    const position = order.indexOf(selected);
    selected = order[(position + (event.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length];
    hinted = -1; renderSelection();
    $(`#hand [data-index="${selected}"]`)?.focus({ preventScroll: true });
  }
});
// Only the requesting player's filtered server snapshot is present in this browser.
window.mahjongGame = game;
window.mahjongRoom = network;
window.mahjongVoice = voice;
window.renderMahjong = () => { selected = -1; hinted = -1; render(); };
const invitedRoom = new URL(location.href).searchParams.get('room');
if (/^\d{6}$/.test(invitedRoom || '')) $('#room-code').value = invitedRoom;
$('#room-dialog').addEventListener('cancel', event => {
  if (network.room?.status === 'waiting') event.preventDefault();
});
roomChanged();
const actionNoticeLayout = new ResizeObserver(positionActionNotice);
for (const element of [$('#game'), ...document.querySelectorAll('.opponent-rack,.hand-zone')]) actionNoticeLayout.observe(element);
document.fonts.ready.then(positionActionNotice);
openModal('#room-dialog');
network.restore();
