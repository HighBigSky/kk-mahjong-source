import { tileName, isSpecialGangTile, classifyWin } from './engine.js';
import { createRoomClient } from './src/network/client.js';
import { createVoiceChat } from './src/network/voice.js';
import { RED_DRAGON } from './src/domain/tile.js';
import { PHASE } from './src/domain/model.js';
import { SCORING_TEXT } from './src/domain/scoring.js';
import { renderWall } from './src/network/wall-view.js';
import { createLandscapeLayout } from './src/ui/landscape.js';
import { createRoomFullscreen } from './src/ui/fullscreen.js';
import { loadTilesSprite, tileHref } from './src/ui/tiles-sprite.js';
import { createHintCalculator, createHintDisclosure, hintText, specialGangKind, settlementCoins, PLAY_TEXT } from './src/ui/play-assist.js';
import { createDiscardFocusState } from './src/ui/discard-focus.js';
import { createOpeningDeal, DEAL_TEXT, isOpeningDeal } from './src/ui/opening-deal.js';
import { createFlatOpponentView, tilePlane, planeCSS } from './src/ui/flat-opponents.js';
import { createDiscardSpeech } from './src/ui/discard-speech.js';
import { createRecordedVoice } from './src/ui/recorded-voice.js';
import { observeTileMetrics } from './src/ui/tile-material.js';

// 先把牌面精灵图内联进文档，再开始渲染：<use> 走同文档引用，不会被反复回源。
await loadTilesSprite();

const $ = selector => document.querySelector(selector);
observeTileMetrics($('#game'));
$('#scoring-rules').textContent = SCORING_TEXT.note.replace('红中杠、痞子杠', '红中、痞子开杠时');
const renderedHTML = new WeakMap();
// 手牌按「牌面 + 第几张同牌」复用节点：重建 innerHTML 会让每张牌的 SVG 重新解析，
// 出牌/接牌时会闪一下白。复用后只有真正增减的牌才新建节点。
const handNodes = new Map();
const network = createRoomClient({ onChange:roomChanged, onBusyChange:interactionChanged, onError:roomError });
const reconnectButton = document.createElement('button');
reconnectButton.id = 'room-reconnect';
reconnectButton.type = 'button';
reconnectButton.className = 'secondary-button';
reconnectButton.textContent = '重新连接';
reconnectButton.hidden = true;
reconnectButton.addEventListener('click', () => network.reconnect());
$('#room-status').before(reconnectButton);
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
const recordedVoice = createRecordedVoice({isEnabled:() => preferences.sound,onError:message=>toast(message)});
const discardSpeech = createDiscardSpeech({isEnabled:() => preferences.sound,voicePlayer:recordedVoice});
let previousRoomCode = null;
let previousRound = 0;
let previousVersion = -1;
let previousStatus = 'waiting';
let previousOpeningId = null;
let roomBusy = false;
let resultTimer = null;
let actionNoticeTimer = null;
let actionNoticeKey = null;
let actionNoticeDeadline = 0;
let actionNoticeLayoutFrame = null;
let voiceAnnouncing = false;
let diceIntroKey = null;
let diceIntroTimer = null;
let diceIntroFrame = null;
let diceIntroPhase = 'idle';
let diceIntroGeneration = 0;
let openingReadyTask = null;
let openingReadyTimer = null;
const DICE_INTRO_TIMING = Object.freeze({rollMs:1000, settledMs:120, enlargeMs:300, holdMs:800});
// 每颗骰子的节奏独立；最后一个换面点之后只做小幅回弹，真实点数一直保留到落定。
const DICE_ROLL_TRACKS = Object.freeze([
  {delay:0, duration:.94, beats:[0,.07,.15,.25,.38,.54,.73], step:1},
  {delay:.035, duration:.965, beats:[0,.10,.20,.34,.49,.65,.80], step:5},
]);
const diceIntroSeen = new Set();
const diceIntroPending = new Set();
const diceIntroMotion = matchMedia('(prefers-reduced-motion: reduce)');
try {
  const keys = JSON.parse(sessionStorage.getItem('kk-dice-intro-seen') || '[]');
  if (Array.isArray(keys)) for (const key of keys) if (typeof key === 'string') diceIntroSeen.add(key);
} catch { /* 存储不可用时，本页仍按 diceIntroKey 去重。 */ }
try {
  const keys = JSON.parse(sessionStorage.getItem('kk-dice-intro-pending') || '[]');
  if (Array.isArray(keys)) for (const key of keys) if (typeof key === 'string') diceIntroPending.add(key);
} catch { /* 存储不可用时，本页仍按 diceIntroKey 去重。 */ }
const discardFocusState = createDiscardFocusState({storage:(() => {
  try { return sessionStorage; } catch { return null; }
})()});
let focusedDiscard = null;
let discardFocusFrame = null;
let discardFocusTarget = null;
const discardFocusLayout = new ResizeObserver(() => positionDiscardFocus());
const calculateHints = createHintCalculator();
let hintState = {mode:'none', candidates:[]};
let hintChoice = 0;
let hintStateKey = '';
const hintDisclosure = createHintDisclosure();
let hintDescription = '';
let handTap = null;
let specialGangPending = false;
const ACTION_NOTICE_LABELS = Object.freeze({ chi: '吃', peng: '碰', gang: '杠', hu: '胡' });
const ACTION_NOTICE_OBSTACLES = [
  '.table .river .tile', '.table .opponent-rack .tile', '.table .opponent-rack .back',
  '.table .wall-piece:not(.is-empty)', '#hand button', '.my-melds .tile', '.table-center',
  '.player-seat', '.topbar', '.action-zone:not([hidden])', '#hint-details:not([hidden])',
  '#play-assist:not([hidden])', '.turn-message', '.last-event', '.table-labels .table-label', '#toast',
].join(',');
const tableLabelNodes = new Map();
const openingDeal = createOpeningDeal({stage:$('#game'), storage:(()=>{try{return sessionStorage;}catch{return null;}})(),
  canPlay:()=>!diceIntroBlocked() && $('#dice-intro').hidden,
  onLockChange:()=>interactionChanged(),
  onFinish:()=>requestAnimationFrame(()=>{selected=-1;hinted=-1;handTap=null;render();}),
});
const layoutOpponentView = createFlatOpponentView($('#game'));
const positionOverlays = () => { layoutOpponentView(); positionActionNotice(); positionDiscardFocus(); positionTableLabels(); openingDeal.layoutChanged(); };
const landscapeLayout = createLandscapeLayout({onLayout:positionOverlays});
const roomFullscreen = createRoomFullscreen();

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
  const restoring = !room && Boolean(network.sessionCode());
  const busy = roomBusy || network.busy;
  $('#room-entry').hidden = Boolean(room);
  $('#room-waiting').hidden = !room;
  $('#room-close').hidden = !room || room.status === 'waiting';
  $('#room-create').disabled = busy || restoring;
  $('#room-join').disabled = busy || restoring;
  reconnectButton.hidden = connected || !network.sessionCode();
  reconnectButton.disabled = busy;
  $('#connection-status').dataset.state = network.status;
  $('#connection-text').textContent = !room && !restoring ? '未加入房间' : connected ? room.paused ? '等待重连' : '好友联机' : '正在重连';
  $('#room-label').textContent = room ? room.code : '------';
  $('#room-code-pill').hidden = !room;
  if (!room) {
    $('#room-status').textContent = restoring ? `正在恢复房间 ${network.sessionCode()} 的原座位，请检查网络或点击重新连接。` : '创建房间，或输入好友发来的房间码。';
    return;
  }
  $('#room-current-code').textContent = room.code;
  const canStart = room.seats.every(seat => seat.occupied && seat.connected && seat.ready);
  const canManageBots = room.owner === 0 && room.status === 'waiting';
  $('#room-ready').disabled = busy || !connected || room.status !== 'waiting';
  $('#room-ready').textContent = room.status !== 'waiting' ? '已开局' : room.seats[0].ready ? '取消准备' : '准备';
  $('#room-start').hidden = room.owner !== 0 || room.status !== 'waiting';
  $('#room-start').disabled = busy || !connected || !canStart;
  $('#room-leave').disabled = busy;
  $('#room-leave').title = room.status === 'playing' ? '离开并中止本局，其他玩家返回等待房间' : '离开房间';
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
  $('#room-status').textContent = !connected ? '连接中断，正在恢复原座位；10分钟未重连将自动解散房间。'
    : room.paused ? '有好友离线，对局暂停；10分钟未重连将自动解散房间。'
    : room.opening ? '正在开局，房主开场结束后进入正式回合。'
    : room.status === 'playing' ? '对局进行中，关闭此面板返回牌桌。'
    : room.seats.some(member => member.occupied && !member.bot && !member.connected) ? '等待好友连接；掉线后保留10分钟，超时自动解散房间。'
    : room.status === 'ended' ? '本局结束，房主可以开始下一局。'
    : canStart ? room.owner === 0 ? '全员准备好了，可以开始对局。' : '全员准备好了，等待房主开局。'
    : room.seats.every(seat => seat.occupied) ? '人机已自动准备，等待真人玩家准备。'
    : room.owner === 0 ? '邀请好友，或点击空位添加人机；满四席并准备后开局。' : '等待好友入座，房主也可添加人机补位。';
}

function roomChanged() {
  const room = network.room;
  // 正式回合已由房主放行；慢客户端不继续重放已经过期的开场。
  if (previousRoomCode===room?.code && previousOpeningId && !room.opening && game.phase.kind!==PHASE.DEALING) {
    forgetDiceIntroPending(diceIntroKey);dismissDiceIntro();openingDeal.cancel();
  }
  previousOpeningId=room?.opening?.id||null;
  // 发牌动画暂缓 render 时也记录连接边沿，重连后允许重新首次展开。
  hintDisclosure.update({session:`${room?.code || ''}:${game.round}`, connected:network.status === 'connected'});
  // 开场先保留初始画面；正式回合由房主完成放行，后续快照仍以服务端为准。
  if (diceIntroActive() && (network.status !== 'connected' || room?.status !== 'playing' || room.paused || game.phase.kind === PHASE.ENDED ||
      diceIntroKey !== diceIntroSessionKey(room))) dismissDiceIntro();
  const retainOpening = openingDeal.retain(room,game,network.status === 'connected');
  roomFullscreen.setInRoom(Boolean(room));
  const changedRoom = (room?.code || null) !== previousRoomCode;
  const changedRound = changedRoom || game.round !== previousRound;
  if (changedRound) { clearTimeout(resultTimer); resultShown = 0; }
  if (changedRoom || room?.version !== previousVersion) {
    selected = -1; hinted = -1;
    handTap = null;
    $('#choice-dialog').close();
  }
  for (let index = 0; index < 4; index++) {
    const absolute = ((room?.seat || 0) + index) % 4;
    seats[index] = ['东','南','西','北'][absolute];
    displayNames[index] = room?.seats[index].name || (index === 0 ? '你' : '等待好友');
    const seat = $(`#opponent-${index}`);
    const nameElement = seat.querySelector('.opponent-name');
    const nameKey = JSON.stringify([displayNames[index],index === 0,Boolean(room?.seats[index].bot)]);
    if (nameElement.dataset.nameKey !== nameKey) {
      nameElement.dataset.nameKey = nameKey;
      nameElement.replaceChildren(document.createTextNode(displayNames[index]));
      if (index === 0 || room?.seats[index].bot) {
        const badge = document.createElement('small'); badge.textContent = index === 0 ? '你' : '人机';
        nameElement.append(badge);
      }
    }
    seat.querySelector('.seat').textContent = seats[index];
    seat.querySelector('img').src = avatars[absolute];
    seat.querySelector('img').alt = `${displayNames[index]}的头像`;
    seat.setAttribute('aria-label', `${['下方','右侧','上方','左侧'][index]}，${displayNames[index]}，${seats[index]}家`);
    $(`.direction[data-player="${index}"]`).textContent = seats[index];
  }
  $('.my-seat').textContent = seats[0];
  if (changedRound || previousStatus === 'waiting' && room?.status === 'playing') {
    const keepLobby = $('#room-dialog').open && previousStatus !== 'waiting' && !changedRoom;
    document.querySelectorAll('dialog[open]').forEach(dialog => {
      if (!keepLobby || dialog.id !== 'room-dialog') dialog.close();
    });
    if (!room || room.status === 'waiting') openModal('#room-dialog');
  }
  const lastEvent = game.events.at(-1);
  if (!changedRound && lastEvent && lastSoundEvent !== lastEvent) playSound();
  lastSoundEvent = lastEvent || '';
  // 换房或换局后重新对齐朗读基线，避免把上一局/进房前的日志读出来。
  discardSpeech.update(game.events || [], {reset:changedRoom || changedRound,notice:game.actionNotice});
  previousRoomCode = room?.code || null;
  previousVersion = room?.version ?? -1;
  previousRound = game.round;
  previousStatus = room?.status || 'waiting';
  updateRoom(); if (!retainOpening) render();
  syncOpeningReady();
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

// 顶栏痞子/癞子小结里的牌：牌面 + 痞/癞角标，替掉原来「痞子」「癞子」两段文字。
function laiziTile(type, badge) {
  const name = tileName(type) + (badge === '癞' ? '，癞子' : '，痞子');
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
  return `<div class="meld-group" data-kind="${meld.kind}" aria-label="${label} ${meld.tiles.map(tileName).join('、')}">${meld.tiles.map(value => tile(value)).join('')}</div>`;
}

function specialGangHTML(type, kind) {
  const name = PLAY_TEXT[kind];
  return `<div class="meld-group special-gang" data-kind="${kind}" aria-label="${name} ${tileName(type)}，已公开">${tile(type)}</div>`;
}

function specialTile(type) {
  return isSpecialGangTile(type, game.indicatorTile);
}

// 手牌角标：红中与痞子都显示「痞」，癞子显示「癞」；杠型名称与实际判定保持独立。
// 「只能单张杠出」的提示留给 title 与提示文字。
function specialMarker(type) {
  if (!specialTile(type)) return wildMarker(type);
  // 红中也显示「痞」时统一使用痞角标；红色样式只留给真正显示「红」的角标。
  return '<span class="pizi-marker" aria-hidden="true">痞</span>';
}

function heldSpecialName() {
  const hand = game.players[0].hand;
  return [hand.includes(RED_DRAGON) ? '红中' : '', game.indicatorTile !== null && hand.includes(game.indicatorTile) ? '痞子' : ''].filter(Boolean).join('、');
}

// 进行中的房间可能仍带旧日志，仅在显示时统一用字，不改服务端状态。
function displayGameText(text) {
  // 仅统一界面名称；服务端仍保留实际杠型与对应计分。
  return String(text ?? '').replaceAll('\u76ae', '痞').replace(/(?:红中|痞子)杠/g, '杠');
}

function toast(message) {
  $('#toast').textContent = displayGameText(message);
  $('#toast').classList.add('visible');
  requestActionNoticeLayout();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').classList.remove('visible'); requestActionNoticeLayout(); }, 2500);
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

function syncSettings() {
  if (!preferences.sound) discardSpeech.stop();
  else discardSpeech.resume();
  $('#sound-setting').checked = preferences.sound;
  $('#sound-btn use').setAttribute('href', preferences.sound ? '#i-sound' : '#i-mute');
  $('#sound-btn').setAttribute('aria-label', preferences.sound ? '关闭音效' : '开启音效');
  $('#sound-btn').setAttribute('aria-pressed', String(preferences.sound));
}

function humanTurn() { return network.canAct() && !specialGangPending && !diceIntroBlocked() && !openingDeal.active && game.phase.kind === PHASE.DISCARD && game.current === 0; }
function modalOpen() { return Boolean(document.querySelector('dialog[open]')); }

// Keep existing SVG instances mounted when a snapshot has no visual changes.
function setHTMLIfChanged(element, html) {
  if (renderedHTML.get(element) === html) return;
  element.innerHTML = html;
  renderedHTML.set(element, html);
}

function diceIntroActive() { return diceIntroPhase !== 'idle'; }
function diceIntroBlocked() { return diceIntroActive() || diceIntroPending.has(diceIntroKey); }
function diceIntroSessionKey(room) {
  const base=`${room.code}:${game.round}:${(game.wallInfo?.dice||[]).join(',')}`;
  return room.opening?.id?`${base}:${room.opening.id}`:base;
}

function setDiceIntroPhase(phase) {
  diceIntroPhase = phase;
  $('#game').classList.toggle('is-dice-intro', diceIntroActive());
  $('#dice-intro').dataset.phase = phase;
  $('#table-dice').dataset.introPhase = phase;
}

function scheduleDiceIntro(callback, delayMs) {
  clearTimeout(diceIntroTimer);
  const generation = diceIntroGeneration;
  diceIntroTimer = setTimeout(() => {
    if (generation !== diceIntroGeneration) return;
    diceIntroTimer = null;
    if (diceIntroActive()) callback();
  }, delayMs);
}

function restoreIntroDice() {
  cancelAnimationFrame(diceIntroFrame); diceIntroFrame = null;
  $('#table-dice').classList.remove('is-rolling');
  // 正常落定前已显示真实点数并归正；此处只清理固定点位，不靠换节点修正朝向。
  renderedHTML.delete($('#table-dice'));
  setHTMLIfChanged($('#table-dice'), diceHTML(game.wallInfo?.dice || []));
}

function dismissDiceIntro() {
  diceIntroGeneration++;
  clearTimeout(diceIntroTimer); diceIntroTimer = null;
  if (diceIntroActive()) restoreIntroDice();
  else { cancelAnimationFrame(diceIntroFrame); diceIntroFrame = null; }
  $('#dice-intro').hidden = true;
  setDiceIntroPhase('idle');
}

function finishDiceIntro() {
  if (!diceIntroActive()) return;
  dismissDiceIntro();
  openingDeal.play();
  if (!openingDeal.active) render();
  interactionChanged();
}

// 房主完成自己的既有开场后放行权威回合；不等待全员，不按固定延时猜测结束。
function syncOpeningReady() {
  const room=network.room,opening=room?.opening,key=opening?`${room.code}:${opening.id}`:null;
  if (openingReadyTask?.key!==key) openingReadyTask=null;
  const eligible=opening && room.owner===0 && opening.round===game.round && game.phase.kind===PHASE.DEALING &&
    diceIntroKey===diceIntroSessionKey(room) && diceIntroSeen.has(diceIntroKey) &&
    network.status==='connected' && !room.paused && !document.hidden && !diceIntroBlocked() && !openingDeal.active && $('#dice-intro').hidden;
  if (!eligible) { clearTimeout(openingReadyTimer);openingReadyTimer=null;return; }
  if (openingReadyTask || openingReadyTimer || network.busy) return;
  const task={key};openingReadyTask=task;
  void network.openingComplete(opening.id).catch(()=>{
    // 网络失败沿既有重连和快照恢复；保留开局阶段，不能擅自放行。
  }).finally(()=>{
    if (openingReadyTask!==task) return;
    openingReadyTask=null;
    if (network.room?.code===room.code && network.room?.opening?.id===opening.id) {
      openingReadyTimer=setTimeout(()=>{openingReadyTimer=null;syncOpeningReady();},500);
    }
  });
}

function showDiceIntro() {
  clearTimeout(diceIntroTimer); diceIntroTimer = null;
  restoreIntroDice();
  setDiceIntroPhase('settled');
  $('#dice-intro').hidden = false;
  // 阶段切换时只批量读取一次锚点；动画帧不读写任何布局属性。
  const dice = [...$('#table-dice').children].map(node => node.getBoundingClientRect());
  const target = $('#dice-intro-dice').getBoundingClientRect();
  const left = Math.min(...dice.map(r=>r.left)), right = Math.max(...dice.map(r=>r.right));
  const centerY = (Math.min(...dice.map(r=>r.top)) + Math.max(...dice.map(r=>r.bottom))) / 2;
  const fromScale = (right-left) / target.width;
  const row = $('#dice-intro-dice');
  row.style.setProperty('--dice-intro-from-x', `${(left+right)/2-target.left-target.width/2}px`);
  row.style.setProperty('--dice-intro-from-y', `${centerY-target.top-target.height/2}px`);
  row.style.setProperty('--dice-intro-zoom-from', String(fromScale));
  row.style.setProperty('--dice-intro-zoom-to', String(fromScale*1.8));
  row.style.setProperty('--dice-intro-enlarge-duration', `${DICE_INTRO_TIMING.enlargeMs}ms`);
  const generation = diceIntroGeneration;
  const showing = () => {
    setDiceIntroPhase('showing');
    diceIntroFrame = requestAnimationFrame(() => {
      if (generation !== diceIntroGeneration || diceIntroPhase !== 'showing') return;
      diceIntroFrame = null;
      scheduleDiceIntro(finishDiceIntro, DICE_INTRO_TIMING.holdMs);
    });
  };
  if (diceIntroMotion.matches) showing();
  else {
    setDiceIntroPhase('enlarging');
    scheduleDiceIntro(showing, DICE_INTRO_TIMING.enlargeMs);
  }
  interactionChanged();
}

function rollIntroDice(values) {
  const holder = $('#table-dice');
  setHTMLIfChanged(holder, diceHTML([6,6]));
  const center = document.createElement('template');
  center.innerHTML = diceHTML([1,1]);
  const dice = [...holder.children];
  dice.forEach((die,index) => {
    die.classList.remove('is-key');
    die.append(center.content.children[index].firstElementChild.cloneNode(true));
    const track = DICE_ROLL_TRACKS[index];
    die.style.setProperty('--dice-roll-duration', `${DICE_INTRO_TIMING.rollMs * track.duration}ms`);
    die.style.setProperty('--dice-roll-delay', `${DICE_INTRO_TIMING.rollMs * track.delay}ms`);
  });
  // 七个固定点位覆盖所有骰面；按经过的时间换面，间隔逐步拉长，不依赖帧数。
  const lastFaces = [-1,-1];
  const tick = elapsedMs => {
    dice.forEach((die,index) => {
      const track = DICE_ROLL_TRACKS[index];
      const progress = Math.max(0, (elapsedMs / DICE_INTRO_TIMING.rollMs - track.delay) / track.duration);
      let face = 0;
      while (face + 1 < track.beats.length && progress >= track.beats[face + 1]) face++;
      if (lastFaces[index] === face) return;
      lastFaces[index] = face;
      const finalFace = track.beats.length - 1;
      const value = ((values[index] - 1 + (face - finalFace) * track.step) % 6 + 6) % 6 + 1;
      const visible = new Set(DIE_PIPS[value].map(([row,column]) => row + ' / ' + column));
      for (const pip of die.children) pip.style.opacity = visible.has(pip.style.gridArea) ? '1' : '0';
      die.dataset.value = String(value);
      die.classList.toggle('is-key', face === finalFace && value === Math.min(...values));
    });
  };
  tick(0);
  setDiceIntroPhase('rolling');
  const generation = diceIntroGeneration;
  // 布置完牌桌后同时启动 CSS 与换面时钟；最后一段已在结果面上逐步归正。
  diceIntroFrame = requestAnimationFrame(() => {
    if (generation !== diceIntroGeneration || diceIntroPhase !== 'rolling') return;
    diceIntroFrame = null;
    holder.classList.add('is-rolling');
    // 繁忙帧的 rAF 时间戳可能早于 CSS 真正起播；以同一动画时钟换面和收尾，
    // 不能在 CSS 仍翻滚时按旧帧时间强行清理。无动画查询能力时按实时时间降级。
    const animations=dice.flatMap(die=>die.getAnimations?.().filter(animation=>animation.animationName?.startsWith('dice-table-tumble'))||[]);
    const startedAt=performance.now();
    const advance = () => {
      if (generation !== diceIntroGeneration || diceIntroPhase !== 'rolling') return;
      diceIntroFrame = null;
      const elapsedMs = Math.min(animations.length?Math.max(...animations.map(animation=>Number(animation.currentTime)||0)):performance.now()-startedAt, DICE_INTRO_TIMING.rollMs);
      tick(elapsedMs);
      if (elapsedMs < DICE_INTRO_TIMING.rollMs) {
        diceIntroFrame = requestAnimationFrame(advance);
        return;
      }
      restoreIntroDice();
      setDiceIntroPhase('settled');
      scheduleDiceIntro(showDiceIntro, DICE_INTRO_TIMING.settledMs);
    };
    diceIntroFrame = requestAnimationFrame(advance);
  });
}

function rememberDiceIntro(entries, storageKey, key) {
  entries.add(key);
  while (entries.size > 16) entries.delete(entries.values().next().value);
  try { sessionStorage.setItem(storageKey, JSON.stringify([...entries])); } catch { /* 本页去重仍然有效。 */ }
}

function forgetDiceIntroPending(key) {
  if (!diceIntroPending.delete(key)) return;
  try { sessionStorage.setItem('kk-dice-intro-pending', JSON.stringify([...diceIntroPending])); } catch { /* 本页去重仍然有效。 */ }
}

// 播放即落「已播」并清掉「待播」，之后无论刷新、重连还是重复快照都不再重播。
function startDiceIntro(key, values) {
  diceIntroGeneration++;
  rememberDiceIntro(diceIntroSeen, 'kk-dice-intro-seen', key);
  forgetDiceIntroPending(key);
  setHTMLIfChanged($('#dice-intro-dice'), diceHTML(values));
  $('#dice-intro-note').textContent = `${values[0]} 点 · ${values[1]} 点，取 ${Math.min(...values)} 点翻痞`;
  $('#dice-intro').setAttribute('aria-label', $('#dice-intro-note').textContent + '，点击收起');
  if (diceIntroMotion.matches) showDiceIntro();
  else rollIntroDice([...values]);
}

function canShowDiceIntro() {
  return !document.hidden && network.status === 'connected' && !network.room?.paused;
}

// 页面恢复可见后，仅补播仍未推进的本局开场。
function replayDiceIntro() {
  if (!canShowDiceIntro() || diceIntroActive() || openingDeal.active) return;
  const room = network.room;
  const values = game.wallInfo?.dice || [];
  if (!room || room.status !== 'playing' || values.length !== 2) return;
  const key = diceIntroSessionKey(room);
  if (key !== diceIntroKey || !diceIntroPending.has(key)) return;
  // 该局已经推进（有人打出/杠出）或已结束就不再补播，避免打断对局；发牌动画随后由 render 的 prepare 接续。
  if (!isOpeningDeal(room, game)) { forgetDiceIntroPending(key); interactionChanged(); return; }
  startDiceIntro(key, values);
  interactionChanged();
}

function renderDiceIntro() {
  const room = network.room;
  if (room?.status==='playing' && room.opening===null) {
    forgetDiceIntroPending(diceIntroKey);dismissDiceIntro();return;
  }
  const values = game.wallInfo?.dice || [];
  if (!room || room.status !== 'playing' || values.length !== 2) {
    dismissDiceIntro();
    if (!room || room.status === 'waiting') diceIntroKey = null;
    return;
  }
  const key = diceIntroSessionKey(room);
  if (key === diceIntroKey) { replayDiceIntro(); return; }
  dismissDiceIntro();
  diceIntroKey = key;
  // A restored game already in progress does not replay its opening overlay.
  if (diceIntroSeen.has(key) || (game.events || []).some(event => /打出.+?。$/.test(event))) return;
  // 玩家暂时看不到牌桌时只记「待播」，避免在后台消耗开场。
  if (!canShowDiceIntro()) { rememberDiceIntro(diceIntroPending, 'kk-dice-intro-pending', key); return; }
  startDiceIntro(key, values);
}

diceIntroMotion.addEventListener('change', () => {
  if (diceIntroMotion.matches && diceIntroActive() && diceIntroPhase !== 'showing') showDiceIntro();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { finishDiceIntro(); return; }
  replayDiceIntro();
  syncOpeningReady();
});

window.addEventListener('pagehide', ()=>{clearTimeout(openingReadyTimer);openingReadyTimer=null;openingReadyTask=null;dismissDiceIntro();});

function stageRect(element) {
  const stage = $('#game').getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return {left:rect.left - stage.left, top:rect.top - stage.top, width:rect.width, height:rect.height};
}

// 桌面实物共用透视，说明文字留在屏幕平面；只在渲染和尺寸变化时读取实际锚点。
// 镜像不参与交互和读屏，原节点与牌组的语义仍保留，避免出现第二套游戏状态。
function positionTableLabels() {
  const stage = $('#game'), holder = $('#table-labels');
  // 静态文件热更新期间兼容尚未刷新的旧页面结构，避免入口中断。
  if (!holder) return;
  const active = network.room && network.room.status !== 'waiting';
  holder.hidden = !active;
  stage.classList.toggle('has-table-labels', Boolean(active));
  if (!active) return;
  const stageBox = stage.getBoundingClientRect();
  const unit = stageBox.height / 100;
  const gap = Math.max(1, unit * .35);
  const descriptors = [];
  const visible = element => element.getClientRects().length && getComputedStyle(element).display !== 'none';
  const add = (key, source, anchor, side, kind) => {
    if (!visible(source)) return;
    descriptors.push({key, text:source.textContent, anchor:stageRect(anchor), side, kind,
      color:getComputedStyle(source).color, active:source.classList.contains('active')});
  };
  document.querySelectorAll('.table .direction').forEach(source => add(`direction-${source.dataset.player}`, source, source, 'center', 'direction'));
  const keys = new Set(descriptors.map(item => item.key));
  for (const [key, node] of tableLabelNodes) if (!keys.has(key)) { node.remove(); tableLabelNodes.delete(key); }
  const obstacles = [...document.querySelectorAll('.table .river .tile,.table .opponent-rack .tile,.table .opponent-rack .back,.table .wall-piece:not(.is-empty),#hand button,.my-melds .tile,.player-seat,.action-zone:not([hidden]) button,.table-die,.seat-action-notice:not([hidden])')]
    .filter(visible).map(stageRect);
  const occupied = [];
  const intersects = (a, b) => a.left < b.left + b.width + .3 && a.left + a.width + .3 > b.left && a.top < b.top + b.height + .3 && a.top + a.height + .3 > b.top;
  for (const item of descriptors) {
    let node = tableLabelNodes.get(item.key);
    if (!node) {
      node = document.createElement('span');
      node.dataset.labelKey = item.key;
      holder.append(node); tableLabelNodes.set(item.key, node);
    }
    node.className = `table-label table-label-${item.kind}${item.active ? ' is-active' : ''}`;
    node.textContent = item.text;
    node.style.color = item.color;
    node.style.background = item.background || '';
    const {width, height} = node.getBoundingClientRect();
    const a = item.anchor;
    const preferred = {left:a.left + (a.width - width) / 2, top:a.top + (a.height - height) / 2, width, height};
    if (item.side === 'top') preferred.top = a.top - height - gap;
    if (item.side === 'bottom') preferred.top = a.top + a.height + gap;
    if (item.side === 'left') preferred.left = a.left - width - gap;
    if (item.side === 'right') preferred.left = a.left + a.width + gap;
    const candidates = [preferred];
    // 罗盘方向字只移动说明层，不挪动实牌或改变点击区。
    for (let lane = 1; lane <= 4; lane++) {
      const distance = lane * (height + gap);
      for (const tangent of [0, -1, 1, -2, 2]) {
        const horizontal = item.side === 'top' || item.side === 'bottom' || item.side === 'center';
        candidates.push({...preferred,
          left:preferred.left + (horizontal ? tangent * (width + gap) : (item.side === 'left' ? -1 : 1) * distance),
          top:preferred.top + (horizontal ? (item.side === 'bottom' ? 1 : -1) * distance : tangent * (height + gap))});
      }
    }
    const inside = area => area.left >= gap && area.top >= gap && area.left + width <= stageBox.width - gap && area.top + height <= stageBox.height - gap;
    const clear = area => inside(area) && [...obstacles, ...occupied].every(other => !intersects(area, other));
    const placed = candidates.find(clear) || {...preferred,
      left:Math.max(gap, Math.min(preferred.left, stageBox.width - width - gap)),
      top:Math.max(gap, Math.min(preferred.top, stageBox.height - height - gap))};
    node.style.left = `${placed.left}px`;
    node.style.top = `${placed.top}px`;
    occupied.push(placed);
  }
}

function discardRiverTile(discard) {
  if (game.players[discard.from]?.discards[discard.index] !== discard.tile) return null;
  return $(`#river-${discard.from}`).children[discard.index] || null;
}

function positionDiscardFocus() {
  if (!focusedDiscard) return;
  const target = discardRiverTile(focusedDiscard);
  if (target !== discardFocusTarget) {
    discardFocusTarget?.classList.remove('is-discard-focus');
    discardFocusLayout.disconnect();
    discardFocusTarget = target;
    if (target) discardFocusLayout.observe(target);
  }
  const plane = target && tilePlane(target, $('#game'));
  if (!plane) { target?.classList.remove('is-discard-focus'); $('#discard-focus').hidden = true; queueDiscardFocusLayout(); return; }
  const {width,height,matrix} = plane;
  const holder = $('#discard-focus');
  if (holder.parentElement !== $('#game')) $('#game').append(holder);
  // 每次按实牌四角定位并恢复显隐；同牌、重复快照和窗口重排也不能跳过。
  holder.style.cssText = `left:0;top:0;width:${width}px;height:${height}px;transform-origin:0 0;transform:${planeCSS(matrix)}`;
  // 仅给牌河中的实牌描边；空锚点保留读屏和定位语义，不再绘制第二张牌。
  target.classList.add('is-discard-focus');
  holder.hidden = false;
}

function queueDiscardFocusLayout() {
  if (discardFocusFrame !== null || !focusedDiscard) return;
  // 首次挂载或相机布局尚未完成时重试；回调只定位当前焦点，不复活已撤销的牌。
  discardFocusFrame = requestAnimationFrame(() => {
    discardFocusFrame = null;
    if (!focusedDiscard) return;
    layoutOpponentView();
    positionDiscardFocus();
  });
}

function settleDiscardFocus() {
  if (discardFocusFrame !== null) cancelAnimationFrame(discardFocusFrame);
  discardFocusFrame = null;
  focusedDiscard = null;
  discardFocusLayout.disconnect();
  discardFocusTarget?.classList.remove('is-discard-focus');
  discardFocusTarget = null;
  // 只撤去原地描边；不复制、不缩放，也不向已被吃碰杠胡取走的格位飞回。
  $('#discard-focus').hidden = true;
}

function renderDiscardFocus() {
  const focus = discardFocusState.update({game, room:network.room, connected:network.status === 'connected'});
  if (!focus) {
    settleDiscardFocus();
    return;
  }
  const holder = $('#discard-focus');
  if (focus.key !== focusedDiscard?.key) settleDiscardFocus();
  focusedDiscard = focus;
  holder.dataset.key = focus.key;
  holder.dataset.player = String(focus.from);
  holder.dataset.tile = String(focus.tile);
  holder.setAttribute('aria-label', `${displayNames[focus.from]}打出${tileName(focus.tile)}`);
  dismissDiceIntro();
  positionDiscardFocus();
  queueDiscardFocusLayout();
}

function renderTing() {
  const seat = game.players[0];
  const visibleTiles = [...game.players.flatMap(player => [...player.discards, ...player.redGangs, ...(player.piziGangs || []), ...player.melds.flatMap(meld => meld.tiles)]), ...(game.indicatorTile == null || game.indicatorTaken ? [] : [game.indicatorTile])];
  const eligible = network.status === 'connected' && network.room?.status === 'playing' && !network.room.paused && !network.busy && !specialGangPending && !diceIntroBlocked() && !openingDeal.active && game.phase.kind !== PHASE.DEALING && $('#dice-intro').hidden;
  hintState = eligible ? calculateHints({hand:seat.hand, melds:seat.melds, wildTile:game.wildTile, indicatorTile:game.indicatorTile, visibleTiles}) : {mode:'none', candidates:[]};
  // 第四张已经打出时仍可接胡，但不能伪称墙内还有该牌。
  const claimTile = eligible && game.phase.kind === PHASE.CLAIM && network.availableActions().hu ? game.pendingDiscard?.tile : null;
  if (claimTile != null && !hintState.candidates[0]?.waits.some(wait => wait.type === claimTile)) {
    const previous = hintState.candidates[0] || {index:-1, discardedTile:null, waits:[], total:0, points:0};
    hintState = {mode:'ready', candidates:[{...previous, waits:[...previous.waits, {type:claimTile, remaining:0, selfDraw:false, claim:true}]}]};
  }
  const stateKey = JSON.stringify(hintState);
  if (stateKey !== hintStateKey) { hintChoice = 0; hintStateKey = stateKey; }
  const shown = hintState.candidates.length > 0 && (hintState.mode === 'ready' || humanTurn());
  hintDisclosure.update({session:`${network.room?.code || ''}:${game.round}`, connected:network.status === 'connected', ready:shown && hintState.mode === 'ready'});
  const panel = $('#play-assist');
  panel.hidden = !shown;
  if (!shown) { updateHintDetails(); return; }
  const candidate = hintState.candidates[hintChoice] || hintState.candidates[0];
  const content = hintText(candidate, hintState.mode === 'ready');
  hintDescription = content.text;
  $('#hint-label').textContent = PLAY_TEXT.hint;
  // 静态更新期间旧 HTML 仍可正常选牌，新结构就绪后再绘制牌面提示卡。
  if ($('#hint-details')) {
    $('#hint-hu').textContent = PLAY_TEXT.hu;
    $('#hint-close').setAttribute('aria-label', PLAY_TEXT.closeHint);
    $('#hint-details').setAttribute('aria-label', PLAY_TEXT.waits);
    $('#hint-waits').setAttribute('aria-label', PLAY_TEXT.waits);
    // 按待胡牌的种类数缩放预览；剩余实牌张数只作标注，不影响尺寸。
    $('#hint-details').style.setProperty('--hint-count', String(candidate.waits.length));
    $('#hint-details').style.setProperty('--hint-columns', String(Math.min(6, candidate.waits.length)));
    setHTMLIfChanged($('#hint-waits'), candidate.waits.map(wait => `<div class="hint-wait" role="listitem">${tile(wait.type)}<span class="hint-wait-meta"><b>${PLAY_TEXT.remaining}${wait.remaining}${PLAY_TEXT.copies}</b><small>${wait.claim ? PLAY_TEXT.claim : PLAY_TEXT.selfDrawOnly}</small></span></div>`).join(''));
  }
  const line = $('#hint-text');
  line.style.setProperty('--hint-line-count', String(content.waits.length));
  line.style.setProperty('--hint-line-extra', String(content.discardedTile === null ? 0 : 1));
  setHTMLIfChanged(line, `<span class="hint-line-core"><span class="hint-line-label">${content.lead}</span>${content.discardedTile === null ? '' : `${tile(content.discardedTile, 'hint-line-discard')}<span class="hint-line-label">→ ${PLAY_TEXT.listen}</span>`}<span class="hint-line-waits" role="list" aria-label="${PLAY_TEXT.waits}">${content.waits.map(wait => `<span class="hint-line-wait" role="listitem">${tile(wait.type)}</span>`).join('')}</span></span><span class="hint-line-total">${content.total}</span>`);
  $('#hint-btn').title = content.text + '\n' + (hintState.mode === 'discard' ? PLAY_TEXT.confirm + '\n' : '') + PLAY_TEXT.note;
  $('#hint-btn').disabled = false;
  const choices = $('#hint-choice');
  choices.hidden = hintState.mode !== 'discard' || hintState.candidates.length < 2;
  setHTMLIfChanged(choices, hintState.candidates.map((value, index) => '<option value="' + index + '">' + (index + 1) + '. ' + hintText(value, false).text + '</option>').join(''));
  choices.value = String(hintChoice);
  updateHintDetails();
}

function updateHintDetails() {
  if (!$('#hint-details')) return;
  const open = !$('#play-assist').hidden && hintDisclosure.open;
  $('#hint-details').hidden = !open;
  $('#hint-btn').setAttribute('aria-expanded', String(open));
  $('#hint-btn').setAttribute('aria-label', `${open ? PLAY_TEXT.hint : PLAY_TEXT.openHint}：${hintDescription}`);
  requestActionNoticeLayout();
}

function closeHintDetails() {
  hintDisclosure.close();
  updateHintDetails();
}

// Busy changes only lock/unlock input. They do not rebuild a room snapshot.
function interactionChanged() {
  updateHandState();
  updateActionControls();
  updateRoom();
  renderTing();
  syncOpeningReady();
}

function requestActionNoticeLayout() {
  if (actionNoticeLayoutFrame !== null) return;
  actionNoticeLayoutFrame = requestAnimationFrame(() => {
    actionNoticeLayoutFrame = null;
    positionActionNotice();
  });
}

// 只移动现有 HUD 提示；以真实投影后的牌面和界面边界找空位，不改桌面或操作热区。
function positionActionNotice() {
  const notices = [...document.querySelectorAll('.seat-action-notice:not([hidden])')];
  if (!notices.length) return;
  const stage = $('#game'), stageBox = stage.getBoundingClientRect();
  const visible = node => {
    const style = getComputedStyle(node);
    return node.getClientRects().length && style.display !== 'none' && style.visibility !== 'hidden' &&
      (node.id !== 'toast' || node.classList.contains('visible') || Number(style.opacity) > 0);
  };
  const rect = node => {
    const box = node.getBoundingClientRect();
    return {left:box.left-stageBox.left-stage.clientLeft, top:box.top-stageBox.top-stage.clientTop, width:box.width, height:box.height};
  };
  const obstacles = [...document.querySelectorAll(ACTION_NOTICE_OBSTACLES)].filter(visible).map(node => {
    const box = rect(node);
    if (node.id === 'toast') {
      // toast 在 0 与 1cqw 之间过渡；当前投影不代表整个进出过程。
      // top 是不含 transform 的既有落点，预留完整路径，避免动画后半段压到文字。
      const top = parseFloat(getComputedStyle(node).top);
      if (Number.isFinite(top)) {
        const start = Math.min(top,box.top), end = Math.max(top+stage.clientWidth*.01,box.top);
        return {...box,top:start,height:box.height+end-start};
      }
    }
    // 选牌抬起使用 transform，不触发 ResizeObserver；提前为整个抬起过程留空间。
    const lift = node.matches('#hand button') ? stageBox.height * .019 : 0;
    return {...box, top:box.top-lift, height:box.height+lift};
  });
  const occupied = [];
  const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
  for (const element of notices) {
    const player = Number(element.dataset.player);
    const width = element.offsetWidth, height = element.offsetHeight;
    const gap = Math.max(6, parseFloat(getComputedStyle(element).fontSize) * .16);
    const minX = gap, maxX = stage.clientWidth-width-gap;
    const minY = gap, maxY = stage.clientHeight-height-gap;
    const tiles = [...document.querySelectorAll(player === 0 ? '#hand button' : `#backs-${player} .back,#backs-${player} .tile`)].filter(visible).map(rect);
    const anchor = tiles.length ? {
      left:Math.min(...tiles.map(box=>box.left)), top:Math.min(...tiles.map(box=>box.top)),
      right:Math.max(...tiles.map(box=>box.left+box.width)), bottom:Math.max(...tiles.map(box=>box.top+box.height)),
    } : (() => { const box = rect($(`#opponent-${player}`)); return {...box,right:box.left+box.width,bottom:box.top+box.height}; })();
    const preferred = {left:(anchor.left+anchor.right-width)/2, top:(anchor.top+anchor.bottom-height)/2};
    if (player === 0) preferred.top = anchor.top-stageBox.height*.019-height-gap;
    else if (player === 1) preferred.left = anchor.left-width-gap;
    else if (player === 2) preferred.top = anchor.bottom+gap;
    else preferred.left = anchor.right+gap;
    const blocked = [...obstacles,...occupied].map(box => ({left:box.left-gap, top:box.top-gap, right:box.left+box.width+gap, bottom:box.top+box.height+gap}));
    // 空位的纵向边界必来自画布或某个障碍物；逐行合并横向禁区，避免固定网格漏掉窄空隙。
    const rows = new Set([preferred.top,minY,maxY,...blocked.flatMap(box=>[box.top-height,box.bottom])].map(y=>clamp(y,minY,maxY)));
    let placed = null, distance = Infinity;
    const consider = (left, top) => {
      const score = (left-preferred.left)**2 + (top-preferred.top)**2;
      if (score < distance) { distance = score; placed = {left,top,width,height}; }
    };
    for (const top of rows) {
      if ((top-preferred.top)**2 > distance) continue;
      const intervals = blocked.filter(box=>box.top < top+height && box.bottom > top)
        .map(box=>[box.left-width,box.right]).sort((a,b)=>a[0]-b[0]);
      let cursor = minX;
      for (const [left,right] of intervals) {
        if (right <= cursor) continue;
        if (left > cursor) consider(clamp(preferred.left,cursor,Math.min(left,maxX)),top);
        cursor = Math.max(cursor,right);
        if (cursor > maxX) break;
      }
      if (cursor <= maxX) consider(clamp(preferred.left,cursor,maxX),top);
    }
    // 防御性处理没有可用空位的宿主尺寸；不通过隐藏提示或缩小文字掩盖空间不足。
    placed ||= {left:clamp(preferred.left,minX,maxX),top:clamp(preferred.top,minY,maxY),width,height};
    element.style.left = `${placed.left}px`;
    element.style.top = `${placed.top}px`;
    occupied.push(placed);
  }
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
    const key = actionNoticeKey;
    const timer = setTimeout(() => {
      if (actionNoticeTimer !== timer || actionNoticeKey !== key) return;
      actionNoticeTimer = null;
      renderActionNotice();
    }, Math.max(1, actionNoticeDeadline - Date.now()));
    actionNoticeTimer = timer;
  }
}

function updateHandState() {
  const myTurn = humanTurn();
  for (const button of $('#hand').children) {
    const index = Number(button.dataset.index);
    button.classList.toggle('selected', index === selected);
    button.classList.toggle('hinted', index === hinted);
    button.disabled = !myTurn;
    button.setAttribute('aria-disabled', String(!myTurn));
    button.setAttribute('aria-pressed', String(index === selected));
  }
}

function updateTurnMessage(actions = network.availableActions()) {
  const room = network.room;
  const active = Boolean(room && room.status !== 'waiting');
  const myTurn = network.status === 'connected' && room?.status === 'playing' && !room.paused && game.phase.kind === PHASE.DISCARD && game.current === 0;
  const hand = game.players[0].hand;
  const specialName = heldSpecialName();
  let message;
  if (!active) message = room ? '邀请好友或添加人机，准备后由房主开局' : '创建房间，邀请好友一起打牌';
  else if (network.status !== 'connected') message = '连接中断，正在重新连接房间…';
  else if (room.paused) message = '有好友离线，10分钟未重连将解散房间';
  else if (game.phase.kind === PHASE.ENDED) message = game.winner === null ? '牌墙已空，本局流局' : game.winner === 0 ? '好牌，胡了！' : `${displayNames[game.winner]}${game.result.selfDraw ? '自摸' : '胡牌'}，下局再来`;
  else if (diceIntroActive()) message = diceIntroPhase === 'rolling' ? '正在掷骰…' : '开局点数展示中…';
  else if (openingDeal.active) message = DEAL_TEXT.progress;
  else if (game.phase.kind === PHASE.DEALING) message = '等待房主开场完成…';
  else if (actions.pass) message = specialName ? `${displayNames[game.pendingDiscard.from]}打出${tileName(game.pendingDiscard.tile)}；手中有${specialName}，不能胡牌` : `${displayNames[game.pendingDiscard.from]}打出${tileName(game.pendingDiscard.tile)}，请选择操作`;
  else if (myTurn) message = actions.hu ? '好牌来了，可以自摸胡牌！' : selected >= 0 ? specialGangKind(hand[selected], game.indicatorTile, game.wildTile) ? `${PLAY_TEXT[specialGangKind(hand[selected], game.indicatorTile, game.wildTile)]}：${PLAY_TEXT.single}` : `已选${tileName(hand[selected])}，再点一次打出` : specialName ? `${specialName}只能杠出，全部杠出后才能胡牌` : '轮到你了，请选择一张牌打出';
  else message = game.phase.kind === PHASE.CLAIM ? '等待其他玩家响应…' : `${displayNames[game.current]}正在思考…`;
  $('#turn-text').textContent = message;
  $('.turn-message').classList.toggle('thinking', active && !myTurn && !actions.pass && game.phase.kind !== PHASE.ENDED);
}

// Selection is local UI state: it must not recreate the table or its tile faces.
function renderSelection() {
  updateHandState();
  updateTurnMessage();
  renderTing();
}

function render() {
  if (openingDeal.active || diceIntroActive()) return;
  const room = network.room;
  const active = Boolean(room && room.status !== 'waiting');
  const revealHands = game.phase.kind === PHASE.ENDED && game.result?.kind === 'win';
  const hand = game.players[0].hand;
  const actions = network.availableActions();
  $('#score').textContent = game.players[0].score.toLocaleString('zh-CN');
  $('#wall-count').textContent = String(game.wall.length).padStart(3, '0');
  $('#wall-pill').hidden = !active;
  $('#wall-pill').setAttribute('aria-label', `牌墙剩余 ${game.wall.length} 张`);
  renderWall($('#wall-tail'), game);
  const dice = game.wallInfo?.dice || [];
  setHTMLIfChanged($('#table-dice'), diceHTML(dice));
  renderDiceIntro();
  $('.table-center').setAttribute('aria-label', dice.length === 2
    ? `牌桌中央，骰子 ${dice[0]} 点和 ${dice[1]} 点，取较小点数 ${Math.min(...dice)} 翻痞；牌墙剩余 ${game.wall.length} 张`
    : '牌桌中央');
  $('#round-label').textContent = active ? `第 ${game.round} 局 · ${game.dealer === 0 ? '你' : displayNames[game.dealer]}坐庄` : '四人准备后开局';
  $('#laizi-summary').hidden = !game.laiziEnabled;
  // 痞子/癞子用牌面 + 角标表示，省掉「痞子」「癞子」两段文字，窄屏顶栏才放得下。
  setHTMLIfChanged($('#indicator-tile'), game.laiziEnabled ? laiziTile(game.indicatorTile, '痞') : '');
  setHTMLIfChanged($('#wild-tile'), game.laiziEnabled ? laiziTile(game.wildTile, '癞') : '');
  $('#laizi-summary').setAttribute('aria-label', game.laiziEnabled ? `痞子${tileName(game.indicatorTile)}，癞子${tileName(game.wildTile)}` : '未启用翻痞子定癞子');
  $('#hand-count').textContent = `${hand.length} 张`;
  $('.hand-zone').classList.toggle('has-melds', game.players[0].melds.length + game.players[0].redGangs.length + (game.players[0].piziGangs?.length || 0) > 0);

  const drawnIndex = [PHASE.DEALING,PHASE.DISCARD].includes(game.phase.kind) && game.current === 0 && game.lastDraw?.player === 0 ? game.lastDraw.index : -1;
  const tilePriority = type => specialTile(type) ? 0 : type === game.wildTile ? 1 : 2;
  // 所有新摸或补入的牌（含癞子、痞子和红中）先留在右侧；旧牌仍按原优先组排序。
  const separatedDrawnIndex = drawnIndex;
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
    // 角标随本局痞子/癞子变化，缓存键必须带上这两个标记，否则换局后会留着上一局的角标。
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
    // 每家固定预留 36 格，展示全部弃牌，既不截断也不随张数改变行列。
    // 136 张减翻痞与起手后最多 83 次摸牌；每家最多 4 组普通副露，
    // 计入吃碰跳家与已被取走的牌，单家留河上界 27 张。补牌只消耗牌墙。
    const recent = game.lastDiscard || (game.pendingDiscard && {...game.pendingDiscard,index:seat.discards.length - 1});
    setHTMLIfChanged(river, seat.discards.map((type, index) => tile(type, recent?.from === player && recent.index === index && recent.tile === type ? 'last-discard' : '')).join(''));
    river.dataset.label = `${seats[player]} · ${seat.discards.length} 张`;
    river.setAttribute('aria-label', `${displayNames[player]}的出牌，共${seat.discards.length}张，点击查看记录`);
    river.setAttribute('role', 'button');
    river.tabIndex = 0;
    const piziGangs = seat.piziGangs || [];
    const wildCount = piziGangs.filter(type => specialGangKind(type, game.indicatorTile, game.wildTile) === 'wildGang').length;
    const gangCount = seat.redGangs.length + piziGangs.length - wildCount;
    const melds = $(`#melds-${player}`);
    const publicGroups = [...seat.redGangs.map(type => specialGangHTML(type, specialGangKind(type, game.indicatorTile, game.wildTile))), ...piziGangs.map(type => specialGangHTML(type, specialGangKind(type, game.indicatorTile, game.wildTile))), ...seat.melds.map(meldHTML)];
    setHTMLIfChanged(melds, publicGroups.join(''));
    melds.hidden = publicGroups.length === 0;
    melds.setAttribute('aria-label', `${displayNames[player]}已公开的吃碰杠牌，单张杠${gangCount}张，${PLAY_TEXT.wildGang}${wildCount}张，普通副露${seat.melds.length}组`);
    const rack = $(`#rack-${player}`);
    rack.classList.toggle('has-melds', publicGroups.length > 0);
    $(`#score-${player}`).textContent = seat.score.toLocaleString('zh-CN');
    $(`#dealer-${player}`).hidden = !active || game.dealer !== player;
    const redBadge = $(`#red-gangs-${player}`);
    redBadge.hidden = seat.redGangs.length + piziGangs.length === 0;
    redBadge.textContent = [gangCount ? `杠×${gangCount}` : '', wildCount ? `癞×${wildCount}` : ''].filter(Boolean).join(' ');
    redBadge.title = `${displayNames[player]}已杠出 ${gangCount} 张、癞子 ${wildCount} 张，实牌公开摆在手牌旁`;
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
  updateActionControls();
  syncSettings();
  renderTing();
  layoutOpponentView();
  renderActionNotice();
  renderDiscardFocus();
  positionTableLabels();
  if (!diceIntroPending.has(diceIntroKey)) openingDeal.prepare(room,game);
  openingDeal.play();
  syncOpeningReady();
  if (game.phase.kind === PHASE.ENDED && resultShown !== game.round) {
    resultShown = game.round;
    persist();
    resultTimer = setTimeout(showResult, 350);
  }
}

function updateActionControls() {
  const room = network.room;
  const active = Boolean(room && room.status !== 'waiting');
  const actions = network.availableActions();
  const myTurn = network.status === 'connected' && room?.status === 'playing' && !room.paused && game.phase.kind === PHASE.DISCARD && game.current === 0;
  const specialName = heldSpecialName();
  const enabled = { chi: actions.chi.length > 0, peng: actions.peng, gang: actions.redGang || actions.piziGang || actions.wildGang || actions.gang || actions.concealedGangs.length > 0 || actions.addedGangs.length > 0, hu: actions.hu, pass: actions.pass };
  for (const [action, available] of Object.entries(enabled)) {
    const button = $(`#action-${action}`);
    button.disabled = !available || network.busy || specialGangPending || diceIntroBlocked() || openingDeal.active;
    button.hidden = !available;
  }
  const canNextRound = game.phase.kind === PHASE.ENDED && room?.owner === 0;
  const nextRoundReady = canNextRound && network.status === 'connected' && !room?.seats.some(seat => !seat.connected);
  $('#action-next').hidden = !canNextRound;
  $('#action-next').disabled = !nextRoundReady || network.busy;
  $('.action-zone').hidden = !(Object.values(enabled).some(Boolean) || canNextRound);
  $('#action-gang').title = actions.redGang || actions.piziGang || actions.wildGang ? '可单张杠出红中、痞子或癞子，从墙尾补摸一张牌' : '杠牌';

  updateTurnMessage(actions);
  $('#last-event').textContent = displayGameText(game.events.at(-1) || '好友同桌，支持添加人机');
  $('#action-caption').textContent = game.phase.kind === PHASE.ENDED ? '本局结束' : actions.pass ? '响应出牌' : '对局操作';
  $('#action-context').textContent = game.phase.kind === PHASE.ENDED ? (nextRoundReady ? '可以开始下一局' : '等待好友重连') : actions.hu ? '胡牌可用' : specialName ? `先杠出${specialName}，才能胡牌` : actions.concealedGangs.length ? '可暗杠' : actions.addedGangs.length ? '可补杠' : actions.pass ? '胡 > 碰杠 > 吃' : '好牌，慢慢打';
  $('#hand-instruction').textContent = !active ? '加入房间后由服务端发牌' : game.phase.kind === PHASE.ENDED ? '等待房主开始下一局' : !myTurn ? '等待轮到你时出牌' : PLAY_TEXT.handInstruction;
  $('#next-round').disabled = room?.owner !== 0 || network.status !== 'connected' || network.busy || room?.seats.some(seat => !seat.connected);
  $('#next-round').textContent = room?.owner === 0 ? '开始下一局' : '等待房主开始下一局';
}

async function moveDone(operation) {
  try {
    if (!await operation) { toast('当前不能执行这项操作'); return; }
    selected = -1; hinted = -1;
    renderSelection();
  } catch (error) { roomError(error.message); }
}

function openModal(id) {
  if (!$(id).open) $(id).showModal();
  landscapeLayout.refresh();
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
      if (['redGang', 'piziGang', 'wildGang'].includes(option.action)) void executeSpecialGang(option.action);
      else moveDone(game.claim(0, option.action, option.value));
    });
    holder.append(button);
  }
  openModal('#choice-dialog');
}

function performAction(action) {
  if (openingDeal.active || diceIntroActive()) return;
  if (!network.canAct() || specialGangPending) return;
  const actions = game.getActions(0);
  if (action === 'pass') return moveDone(game.pass(0));
  if (action === 'chi') {
    if (actions.chi.length === 1) return moveDone(game.claim(0, 'chi', actions.chi[0]));
    return selectOptions('选择吃牌组合', actions.chi.map(sequence => ({ tiles: sequence, label: '吃这组', action: 'chi', value: sequence })));
  }
  if (action === 'gang' && game.phase.kind === PHASE.DISCARD) {
    const options = [
      ...(actions.redGang ? [{ tiles: [RED_DRAGON], label: PLAY_TEXT.redGang, action: 'redGang' }] : []),
      ...(actions.piziGang ? [{ tiles: [game.indicatorTile], label: PLAY_TEXT.piziGang, action: 'piziGang' }] : []),
      ...(actions.wildGang ? [{ tiles: [game.wildTile], label: PLAY_TEXT.wildGang, action: 'wildGang' }] : []),
      ...actions.concealedGangs.map(type => ({ tiles: Array(4).fill(type), label: '暗杠', action: 'concealedGang', value: type })),
      ...actions.addedGangs.map(type => ({ tiles: Array(4).fill(type), label: '补杠', action: 'addedGang', value: type })),
    ];
    if (options.length === 1) return ['redGang', 'piziGang', 'wildGang'].includes(options[0].action)
      ? executeSpecialGang(options[0].action) : moveDone(game.claim(0, options[0].action, options[0].value));
    return selectOptions('选择杠牌组合', options);
  }
  moveDone(game.claim(0, action));
}

function showResult() {
  if (game.phase.kind !== PHASE.ENDED) return;
  if ($('#room-dialog').open) { resultShown = 0; return; }
  const result = game.result;
  // 结算只认服务端 result.winner / from，赢家与点炮者分开标明，不从当前座位或净分推断。
  const winner = result.kind === 'win' ? result.winner : null;
  const winnerName = winner === null ? '' : displayNames[winner];
  $('#result-title').textContent = winner === null ? PLAY_TEXT.resultDraw : `${PLAY_TEXT.resultWinner}${winnerName}${winner === 0 ? PLAY_TEXT.resultYou : ''}`;
  $('#result-avatar').src = avatars[((network.room?.seat || 0) + (winner ?? 0)) % 4];
  $('#result-avatar').alt = winner === null ? PLAY_TEXT.resultDraw : PLAY_TEXT.resultWinner + winnerName;
  // 他家快照不公开摸牌记录；结算牌型展示复用服务端已确认的杠开计分项。
  const replacement = result.selfDraw && result.breakdown.some(item => item.name === SCORING_TEXT.replacementWin);
  const classification = result.kind === 'win'
    ? classifyWin(result.hand, game.players[winner].melds, game.wildTile, game.indicatorTile, replacement) : null;
  const winTypes = classification ? [
    classification.sevenPairs ? '七对' : '', classification.allTriplets ? '碰碰胡' : '',
    classification.allJiang ? '将一色' : '', classification.allHonors ? '风一色' : '',
  ].filter(Boolean) : [];
  if (classification?.ordinary && !winTypes.length) winTypes.push('屁胡');
  const resultLabels = [...new Set([...winTypes, ...result.patterns])];
  const method = winner === null ? '' : result.selfDraw ? PLAY_TEXT.resultSelfDraw : `${PLAY_TEXT.resultDiscardWin} · ${PLAY_TEXT.resultDiscarder}${displayNames[result.from]}`;
  $('#result-detail').textContent = displayGameText(winner === null ? PLAY_TEXT.drawResult : `${method} · ${resultLabels.join(' · ')} · ${result.points} 基础分`);
  $('#result-hand').innerHTML = winner === null ? '' : [...game.players[winner].melds.flatMap(meld => meld.tiles), ...result.hand].map(value => tile(value)).join('');
  const coins = settlementCoins(game);
  const signed = value => `${value > 0 ? '+' : ''}${value}`;
  $('#result-scores').setAttribute('aria-label', PLAY_TEXT.settlementFields);
  $('#result-scores').replaceChildren(...displayNames.map((name, index) => {
    const row = document.createElement('div'); row.className = 'result-score-row';
    const label = document.createElement('span'); label.className = 'score-name'; label.textContent = name + (index === 0 ? '（你）' : ''); label.title = label.textContent;
    const amount = winner === null ? coins.net[index] : coins.hu[index];
    const score = document.createElement('strong');
    score.className = `score-main ${amount > 0 ? 'positive' : amount < 0 ? 'negative' : ''}`.trim();
    score.dataset.value = String(amount);
    score.textContent = `${winner === null ? PLAY_TEXT.roundNet : PLAY_TEXT.huCoins} ${signed(amount)}`;
    const details = document.createElement('small'); details.className = 'result-score-breakdown';
    for (const [kind, text] of [['gang', PLAY_TEXT.gangSettled], ['net', PLAY_TEXT.roundNet], ['balance', PLAY_TEXT.balance]]) {
      const item = document.createElement('span'); item.className = `score-${kind}`; item.dataset.value = String(coins[kind][index]);
      item.textContent = `${text} ${kind === 'balance' ? coins[kind][index].toLocaleString('zh-CN') : signed(coins[kind][index])}`;
      details.append(item);
    }
    row.append(label, score, details); return row;
  }));
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  openModal('#result-dialog');
  if (winner === 0) playSound('win');
}

async function executeSpecialGang(kind) {
  if (!humanTurn() || !game.getActions(0)[kind]) return;
  selected = -1; hinted = -1; handTap = null;
  // 本地锁覆盖请求和开杠表现；服务端仍用版本号、requestId 和持牌校验兜底。
  specialGangPending = true;
  interactionChanged();
  try { await Promise.all([moveDone(game.claim(0, kind)), new Promise(resolve => setTimeout(resolve, 420))]); }
  finally { specialGangPending = false; interactionChanged(); }
}

async function confirmHand(index) {
  if (!humanTurn() || !Number.isInteger(index) || index < 0 || index >= game.players[0].hand.length) return;
  const type = game.players[0].hand[index];
  const kind = specialGangKind(type, game.indicatorTile, game.wildTile);
  selected = -1; hinted = -1; handTap = null;
  renderSelection();
  if (!kind) return moveDone(game.discard(0, index));
  if (!game.getActions(0)[kind]) { toast(PLAY_TEXT.noSupplement); return; }
  return executeSpecialGang(kind);
}

$('#hand').addEventListener('click', event => {
  const button = event.target.closest('button[data-index]');
  if (!button || !humanTurn()) return;
  const index = Number(button.dataset.index);
  const now = performance.now();
  const sameTap = handTap?.node === button && handTap?.version === network.room.version && now - handTap.time <= 300;
  const kind = specialGangKind(game.players[0].hand[index], game.indicatorTile, game.wildTile);
  // 普通牌保留原来的再次点选出牌；特殊牌必须在 300ms 内双击同一实牌节点。
  if (sameTap || (!kind && selected === index)) { void confirmHand(index); return; }
  handTap = {node:button, version:network.room.version, time:now};
  selected = index; hinted = -1;
  // 选牌只更新抬起态；服务端确认出牌或吃碰杠胡后再播放声音。
  renderSelection();
  if (kind) button.title = PLAY_TEXT.single;
  button.focus({preventScroll:true});
});
$('#dice-intro').addEventListener('click', finishDiceIntro);
$('.action-buttons').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (button && !button.disabled) performAction(button.dataset.action);
});
function selectHint() {
  const candidate = hintState.candidates[hintChoice];
  if (!candidate || hintState.mode !== 'discard' || !humanTurn()) return;
  selected = candidate.index; hinted = candidate.index; handTap = null;
  renderSelection();
}
$('#hint-btn').addEventListener('click', () => {
  if (!hintDisclosure.open) { hintDisclosure.show(); updateHintDetails(); return; }
  const candidate = hintState.candidates[hintChoice];
  if (!candidate || hintState.mode !== 'discard' || !humanTurn()) return;
  if (selected === candidate.index && hinted === candidate.index) { void confirmHand(candidate.index); return; }
  selectHint();
});
$('#hint-close')?.addEventListener('click', closeHintDetails);
$('#hint-choice').addEventListener('change', event => { hintChoice = Number(event.target.value); renderTing(); selectHint(); });
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
  roomFullscreen.prepareEntry();
  try { return await network.create(name, true); }
  finally { roomFullscreen.finishEntry(Boolean(network.room)); }
}));
$('#room-join').addEventListener('click', () => roomOperation(async () => {
  const code = $('#room-code').value.trim();
  if (!/^\d{6}$/.test(code)) throw new Error('请输入 6 位数字房间码');
  const name = nickname();
  roomFullscreen.prepareEntry();
  try { return await network.join(code, name); }
  finally { roomFullscreen.finishEntry(Boolean(network.room)); }
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
$('#room-close').addEventListener('click', () => {
  $('#room-dialog').close();
});

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
// 鼠标按下即可激活音频，触屏要等抬手；必须在该手势的同步事件链中恢复。
document.addEventListener('pointerdown', event => { if (event.pointerType === 'mouse') discardSpeech.resume(); }, {capture:true});
document.addEventListener('pointerup', event => { if (event.pointerType !== 'mouse') discardSpeech.resume(); }, {capture:true});
document.addEventListener('touchend', () => discardSpeech.resume(), {capture:true,passive:true});
document.addEventListener('click', () => discardSpeech.resume(), {capture:true});
document.addEventListener('keydown', () => discardSpeech.resume(), {capture:true});
// 回到页面只尝试恢复已有队列，不重读已经消费的日志。
document.addEventListener('visibilitychange', () => { if (!document.hidden) discardSpeech.resume(); });
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
document.querySelectorAll('.river').forEach(river => {
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
  if (event.key === 'Escape' && !modalOpen() && $('#hint-details') && !$('#hint-details').hidden) { event.preventDefault(); closeHintDetails(); return; }
  if (modalOpen() || !humanTurn()) return;
  if (event.key === 'Enter' && selected >= 0 && !event.target.closest('button:not([data-index])') && event.target.closest('[aria-disabled="true"]') === null) { event.preventDefault(); void confirmHand(selected); }
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
window.mahjongGameAudio = recordedVoice;
window.renderMahjong = () => { openingDeal.cancel(); selected = -1; hinted = -1; render(); };
const invitedRoom = new URL(location.href).searchParams.get('room');
if (/^\d{6}$/.test(invitedRoom || '')) $('#room-code').value = invitedRoom;
$('#room-dialog').addEventListener('cancel', event => {
  if (!network.room || network.room.status === 'waiting') event.preventDefault();
});
$('#room-dialog').addEventListener('close', render);
roomChanged();
const actionNoticeLayout = new ResizeObserver(positionOverlays);
for (const element of [$('#game'), ...document.querySelectorAll('.opponent-rack,.hand-zone,#hand,#hint-details,.action-zone')]) actionNoticeLayout.observe(element);
document.fonts.ready.then(positionOverlays);
openModal('#room-dialog');
network.restore();
