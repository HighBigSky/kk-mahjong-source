import { randomBytes, randomInt } from 'node:crypto';
import { MahjongGame, chooseDiscard } from '../../engine.js';

const EMPTY_ACTIONS = Object.freeze({ hu:false, peng:false, gang:false, redGang:false, piziGang:false, chi:[], pass:false, concealedGangs:[], addedGangs:[] });
const CODE_PATTERN = /^\d{6}$/;
const ACTION_NOTICE_MS = 2400;

export class RoomError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function fail(status, code, message) { throw new RoomError(status, code, message); }
function nameOf(value) {
  if (typeof value !== 'string') fail(400, 'INVALID_NAME', '请输入昵称。');
  const name = value.trim();
  if (!name || [...name].length > 12 || /[<>"'&\x00-\x1f\x7f]/u.test(name)) fail(400, 'INVALID_NAME', '昵称请使用 1–12 个文字或数字。');
  return name;
}
function relative(seat, viewer) { return seat === null ? null : (seat - viewer + 4) % 4; }
function rotate(items, viewer) { return Array.from({length:4}, (_, index) => items[(index + viewer) % 4]); }

/** Authoritative in-memory rooms. Human and computer turns use the same rules. */
export class RoomService {
  constructor({ disconnectGraceMs = 5000, reconnectTimeoutMs = 10 * 60 * 1000, roomTtlMs = 6 * 60 * 60 * 1000, maxRooms = 200, botDelayMs = 650, now = Date.now,
    iceServers = () => [] } = {}) {
    this.rooms = new Map();
    this.disconnectGraceMs = disconnectGraceMs;
    this.reconnectTimeoutMs = reconnectTimeoutMs;
    this.roomTtlMs = roomTtlMs;
    this.maxRooms = maxRooms;
    this.botDelayMs = botDelayMs;
    this.now = now;
    this.iceServers = typeof iceServers === 'function' ? iceServers : () => iceServers;
    this.cleanupTimer = setInterval(() => this.cleanup(), 60000);
    this.cleanupTimer.unref();
  }

  create({ name, laizi = true } = {}) {
    name = nameOf(name);
    if (typeof laizi !== 'boolean') fail(400, 'INVALID_LAIZI', '癞子选项必须是布尔值。');
    this.cleanup();
    if (this.rooms.size >= this.maxRooms) fail(503, 'ROOM_LIMIT', '房间暂满，请稍后再试。');
    let code;
    do { code = String(randomInt(100000, 1000000)); } while (this.rooms.has(code));
    const seat = this._newSeat(name);
    const room = { code, owner:0, seats:[seat, null, null, null], laizi, game:null, version:1, touched:this.now(), botTimer:null,
      actionNotice:null, _actionNoticeId:0, _actionState:null };
    this.rooms.set(code, room);
    return { token:seat.token, ...this.snapshot(room, 0) };
  }

  join(code, { name } = {}) {
    const room = this._room(code);
    name = nameOf(name);
    if (room.game) fail(409, 'ALREADY_STARTED', '对局已开始，暂不能加入。');
    const player = room.seats.indexOf(null);
    if (player < 0) fail(409, 'ROOM_FULL', '房间已满。');
    const seat = this._newSeat(name);
    room.seats[player] = seat;
    // 新入座玩家使用初始积分，不继承该座位上一任玩家留下的分数。
    if (room.carry) room.carry.scores[player] = 1000;
    this._changed(room);
    return { token:seat.token, ...this.snapshot(room, player) };
  }

  addBot(code, token, { seat: target } = {}) {
    const {room, player} = this.authenticate(code, token);
    this._editBot(room, player, target);
    if (room.seats[target]) fail(409, 'SEAT_OCCUPIED', '该座位已经有人，请选择空位。');
    room.seats[target] = { ...this._newSeat(`人机${target + 1}`), token:null, bot:true, ready:true, connected:true };
    // 人机补位同样从初始积分开始，避免继承已离开玩家的分数。
    if (room.carry) room.carry.scores[target] = 1000;
    this._changed(room);
    return this.snapshot(room, player);
  }

  /** 房主移除已离线真人，用于释放关页后无法再用原 token 恢复的幽灵座位。 */
  removePlayer(code, token, { seat: target } = {}) {
    const {room, player} = this.authenticate(code, token);
    if (!Number.isInteger(target) || target < 0 || target >= 4) fail(400, 'INVALID_SEAT', '请选择有效的座位。');
    const targetSeat = room.seats[target];
    if (!targetSeat) fail(404, 'SEAT_EMPTY', '该座位已经空出。');
    if (targetSeat.bot) fail(409, 'IS_BOT', '人机座位请使用移除人机操作。');
    if (targetSeat.connected) fail(409, 'PLAYER_CONNECTED', '只能移除已离线的玩家。');
    // 房主可移除任何离线玩家；房主自己离线时，允许其他真人移除他，避免整房卡死。
    if (room.owner !== player && target !== room.owner) fail(403, 'OWNER_ONLY', '仅房主可以移除离线玩家。');
    if (room.game && room.game.phase.kind !== 'ended') fail(409, 'PLAYING', '对局进行中不能移除玩家。');
    this._clearDisconnect(targetSeat);
    for (const stream of targetSeat.streams) stream.end();
    room.seats[target] = null;
    if (!room.seats.some(member => member && !member.bot)) { this._dispose(room); return { removed:true }; }
    if (room.owner === target) room.owner = room.seats.findIndex(member => member && !member.bot);
    if (room.game) {
      // 已结束对局被清空时沿用离房逻辑：保留积分和局数，并让真人重新准备。
      this._carryGame(room);
      for (const member of room.seats) if (member) member.ready = !!member.bot;
    }
    this._changed(room);
    return { removed:true, ...this.snapshot(room, player) };
  }

  removeBot(code, token, { seat: target } = {}) {
    const {room, player} = this.authenticate(code, token);
    this._editBot(room, player, target);
    if (!room.seats[target]?.bot) fail(409, 'NOT_BOT', '只能移除人机座位。');
    room.seats[target] = null;
    this._changed(room);
    return this.snapshot(room, player);
  }

  authenticate(code, token) {
    const room = this._room(code);
    if (typeof token !== 'string' || token.length !== 48) fail(401, 'UNAUTHORIZED', '房间身份已失效，请重新加入。');
    const player = room.seats.findIndex(seat => seat && !seat.bot && seat.token === token);
    if (player < 0) fail(401, 'UNAUTHORIZED', '房间身份已失效，请重新加入。');
    room.touched = this.now();
    return { room, player, seat:room.seats[player] };
  }

  state(code, token) {
    const {room, player} = this.authenticate(code, token);
    return this.snapshot(room, player);
  }

  /** 返回当前房间可用的 STUN/TURN 配置；TURN 短期凭证在每次请求时重新生成。 */
  voiceConfig(code, token) {
    this.authenticate(code, token);
    return {iceServers:this.iceServers()};
  }

  /** 标记玩家是否已加入语音；状态变化会随房间快照同步给其他玩家。 */
  setVoice(code, token, {enabled} = {}) {
    const {room, player, seat} = this.authenticate(code, token);
    if (typeof enabled !== 'boolean') fail(400, 'INVALID_VOICE', '语音状态必须是布尔值。');
    if (enabled && !seat.connected) fail(409, 'PLAYER_DISCONNECTED', '连接恢复后才能开启语音。');
    if (seat.voice !== enabled) { seat.voice = enabled; this._changed(room); }
    return this.snapshot(room, player);
  }

  /** 转发 WebRTC SDP / ICE 信令；只允许同房间已开启语音的真人互相发送。 */
  signal(code, token, {to, description, candidate} = {}) {
    const {room, player, seat} = this.authenticate(code, token);
    if (!Number.isInteger(to) || to < 1 || to > 3) fail(400, 'INVALID_SIGNAL_TARGET', '请选择有效的语音对象。');
    const target = (player + to) % 4;
    const targetSeat = room.seats[target];
    if (!targetSeat || targetSeat.bot) fail(409, 'VOICE_UNAVAILABLE', '该座位没有可用的语音玩家。');
    if (!targetSeat.connected) fail(409, 'VOICE_UNAVAILABLE', '对方已离线。');
    if (!seat.voice || !targetSeat.voice) fail(409, 'VOICE_OFF', '双方都开启语音后才能连接。');
    let payload;
    if (description !== undefined) {
      const type = description?.type;
      const sdp = description?.sdp;
      if (!['offer', 'answer'].includes(type) || typeof sdp !== 'string' || !sdp || sdp.length > 20000) {
        fail(400, 'INVALID_SIGNAL', '语音协商内容无效。');
      }
      payload = {description:{type, sdp}};
    } else if (candidate !== undefined) {
      const value = candidate?.candidate;
      if (typeof value !== 'string' || value.length > 2048) fail(400, 'INVALID_SIGNAL', '语音候选地址无效。');
      /** @type {Record<string, unknown>} */
      const copy = {candidate:value};
      if (typeof candidate.sdpMid === 'string' || candidate.sdpMid === null) copy.sdpMid = candidate.sdpMid;
      if (Number.isInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex === null) copy.sdpMLineIndex = candidate.sdpMLineIndex;
      if (typeof candidate.usernameFragment === 'string' || candidate.usernameFragment === null) copy.usernameFragment = candidate.usernameFragment;
      payload = {candidate:copy};
    } else fail(400, 'INVALID_SIGNAL', '语音信令内容为空。');
    const from = relative(player, target);
    for (const stream of targetSeat.streams) this._writeSignal(stream, {from, ...payload});
    room.touched = this.now();
    return {sent:true};
  }

  ready(code, token, { ready } = {}) {
    const {room, player, seat} = this.authenticate(code, token);
    if (room.game?.phase.kind !== 'ended' && room.game) fail(409, 'PLAYING', '对局进行中不能更改准备状态。');
    if (typeof ready !== 'boolean') fail(400, 'INVALID_READY', '准备状态必须是布尔值。');
    if (seat.ready !== ready) { seat.ready = ready; this._changed(room); }
    return this.snapshot(room, player);
  }

  start(code, token) {
    const {room, player} = this.authenticate(code, token);
    this._owner(room, player);
    if (room.game) fail(409, 'ALREADY_STARTED', '房间已经开局。');
    this._canStart(room);
    room.game = new MahjongGame({ seed:randomBytes(24).toString('hex'), names:room.seats.map(seat => seat.name), laizi:room.laizi });
    this._restoreCarry(room);
    this._changed(room);
    return this.snapshot(room, player);
  }

  next(code, token) {
    const {room, player} = this.authenticate(code, token);
    this._owner(room, player);
    if (!room.game || room.game.phase.kind !== 'ended') fail(409, 'NOT_ENDED', '请先完成当前对局。');
    this._canStart(room);
    room.game.newRound();
    this._changed(room);
    return this.snapshot(room, player);
  }

  action(code, token, { action, version, requestId } = {}) {
    const {room, player, seat} = this.authenticate(code, token);
    if (typeof requestId !== 'string' || !/^[\w.:-]{1,120}$/.test(requestId)) fail(400, 'INVALID_REQUEST_ID', '操作缺少有效的请求编号。');
    const signature = JSON.stringify(action);
    if (seat.requests.has(requestId)) {
      if (seat.requests.get(requestId) !== signature) fail(409, 'REQUEST_ID_REUSED', '请求编号已被其他操作使用。');
      return { ...this.snapshot(room, player), duplicate:true };
    }
    if (!Number.isSafeInteger(version)) fail(400, 'INVALID_VERSION', '操作缺少有效的状态版本。');
    if (version !== room.version) fail(409, 'STALE_STATE', '牌局已更新，请确认当前手牌后重试。');
    if (!room.game || room.game.phase.kind === 'ended') fail(409, 'NOT_PLAYING', '当前没有进行中的对局。');
    if (room.seats.some(member => !member?.connected)) fail(409, 'PLAYER_DISCONNECTED', '有好友掉线，对局已暂停；好友重连后继续。');
    const command = this._command(room.game, player, action);
    if (!room.game.applyAction(player, command)) fail(409, 'ILLEGAL_ACTION', '当前不能执行这项操作。');
    seat.requests.set(requestId, signature);
    if (seat.requests.size > 128) seat.requests.delete(seat.requests.keys().next().value);
    this._changed(room);
    return this.snapshot(room, player);
  }

  leave(code, token) {
    const {room, player, seat} = this.authenticate(code, token);
    this._clearDisconnect(seat);
    room.seats[player] = null;
    for (const stream of seat.streams) stream.end();
    if (!room.seats.some(member => member && !member.bot)) { this._dispose(room); return { left:true }; }
    if (room.owner === player) room.owner = room.seats.findIndex(member => member && !member.bot);
    if (room.game) {
      // 主动离房中止本局，其他人返回等待房间；只保留已结算积分，不额外结算胡牌或荒庄。
      this._carryGame(room);
      for (const member of room.seats) if (member) { member.ready = !!member.bot; member.requests.clear(); }
    }
    this._changed(room);
    return { left:true };
  }

  /** Each SSE stream receives its viewer's snapshot, revealing all hands after a win. */
  connect(code, token, response) {
    const {room, player, seat} = this.authenticate(code, token);
    this._clearDisconnect(seat);
    while (seat.streams.size >= 2) {
      const previous = seat.streams.values().next().value;
      seat.streams.delete(previous);
      previous.end();
    }
    seat.streams.add(response);
    const wasConnected = seat.connected;
    seat.connected = true;
    response.writeHead(200, { 'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'no-cache, no-transform', 'Connection':'keep-alive', 'X-Accel-Buffering':'no', 'Referrer-Policy':'no-referrer' });
    response.flushHeaders?.();
    const heartbeat = setInterval(() => {
      if (!response.destroyed && !response.writableEnded) {
        if (response.writableLength > 262144) { response.destroy(); return; }
        room.touched = this.now(); response.write('event: heartbeat\ndata: {}\n\n');
      }
    }, 15000);
    heartbeat.unref();
    response.once('close', () => {
      clearInterval(heartbeat);
      seat.streams.delete(response);
      if (this.rooms.get(code) !== room || room.seats[player] !== seat || seat.streams.size) return;
      // 从最后一条连接关闭时计满十分钟；其他玩家的心跳、请求不得延长重连期限。
      seat.reconnectDeadline = this.now() + this.reconnectTimeoutMs;
      seat.reconnectTimer = setTimeout(() => {
        if (this.rooms.get(code) === room && room.seats[player] === seat && this._disconnectExpired(room)) this._dispose(room);
      }, this.reconnectTimeoutMs);
      seat.reconnectTimer.unref();
      seat.disconnectTimer = setTimeout(() => {
        if (this.rooms.get(code) === room && !seat.streams.size && room.seats[player] === seat) { seat.connected = false; seat.voice = false; this._changed(room); }
      }, this.disconnectGraceMs);
      seat.disconnectTimer.unref();
    });
    if (!wasConnected) this._changed(room);
    else this._write(response, this.snapshot(room, player));
  }

  snapshot(room, viewer) {
    const paused = !!room.game && room.game.phase.kind !== 'ended' && room.seats.some(seat => !seat?.connected);
    const roomView = {
      code:room.code, self:0, seat:viewer, owner:relative(room.owner, viewer), version:room.version,
      status:room.game ? room.game.phase.kind === 'ended' ? 'ended' : 'playing' : 'waiting',
      laizi:room.laizi, paused,
      seats:rotate(room.seats, viewer).map(seat => ({name:seat?.name || '等待好友', occupied:!!seat, connected:!!seat?.connected, voice:!!seat?.voice, ready:!!seat?.ready, bot:!!seat?.bot})),
    };
    if (!room.game) return {room:roomView, state:null};
    const game = room.game;
    const revealHands = game.phase.kind === 'ended' && game.result?.kind === 'win';
    const mapSeat = seat => relative(seat, viewer);
    const mapDiscard = discard => discard && ({tile:discard.tile, from:mapSeat(discard.from)});
    const result = game.result && {...game.result, winner:mapSeat(game.result.winner), from:mapSeat(game.result.from), scoreDelta:rotate(game.result.scoreDelta, viewer)};
    const phase = game.phase.kind === 'discard' ? {kind:'discard', seat:mapSeat(game.phase.seat)}
      : game.phase.kind === 'claim' ? {kind:'claim', discard:mapDiscard(game.phase.discard)}
      : game.phase.kind === 'ended' ? {kind:'ended', result} : {...game.phase};
    const notice = room.actionNotice;
    const remainingMs = notice?.expiresAt === null ? null : Math.max(0, (notice?.expiresAt || 0) - this.now());
    const actionNotice = notice && (remainingMs === null || remainingMs > 0)
      ? {id:notice.id, player:mapSeat(notice.player), kind:notice.kind, remainingMs} : null;
    return {
      room:roomView,
      state:{
        players:rotate(game.players, viewer).map((player, index) => ({
          name:player.name, score:player.score,
          hand:index === 0 || revealHands ? [...player.hand] : Array(player.hand.length).fill(null),
          melds:player.melds.map(meld => ({...meld, tiles:[...meld.tiles], from:mapSeat(meld.from)})),
          redGangs:[...player.redGangs], piziGangs:[...(player.piziGangs || [])], discards:[...player.discards],
        })),
        wallCount:game.wall.length, dealer:mapSeat(game.dealer), current:mapSeat(game.current), round:game.round,
        phase, pendingDiscard:mapDiscard(game.pendingDiscard), lastDiscard:game.lastDiscard && {...mapDiscard(game.lastDiscard), index:game.lastDiscard.index}, winner:mapSeat(game.winner), result, actionNotice,
        lastDraw:game.lastDraw?.player === viewer ? {...game.lastDraw, player:0} : null,
        // The teaching engine logs seat 0's actual draw; never broadcast that secret.
        events:game.events.map(event => /^你(?:摸|补)到/.test(event) ? `${game.players[0].name}${event.startsWith('你补') ? '补牌' : '摸牌'}。` : event),
        laiziEnabled:game.laiziEnabled, indicatorTile:game.indicatorTile, wildTile:game.wildTile,
        wallInfo:{...game.wallInfo, dice:[...game.wallInfo.dice]},
        actions:paused ? {...EMPTY_ACTIONS} : game.getActions(viewer),
      },
    };
  }

  cleanup() {
    const cutoff = this.now() - this.roomTtlMs;
    for (const room of this.rooms.values()) if (room.touched < cutoff || this._disconnectExpired(room)) this._dispose(room);
  }

  close() {
    clearInterval(this.cleanupTimer);
    for (const room of this.rooms.values()) this._dispose(room);
  }

  _newSeat(name) { return {name, token:randomBytes(24).toString('hex'), bot:false, ready:false, connected:false, voice:false, streams:new Set(), requests:new Map(), disconnectTimer:null, reconnectTimer:null, reconnectDeadline:null}; }
  _clearDisconnect(seat) {
    clearTimeout(seat.disconnectTimer);
    clearTimeout(seat.reconnectTimer);
    seat.disconnectTimer = seat.reconnectTimer = seat.reconnectDeadline = null;
  }
  _disconnectExpired(room) {
    const now = this.now();
    return room.seats.some(seat => seat && !seat.bot && !seat.streams.size && seat.reconnectDeadline !== null && now >= seat.reconnectDeadline);
  }
  _room(code) {
    const room = CODE_PATTERN.test(code) ? this.rooms.get(code) : null;
    // Do not let a request revive an expired room between minute cleanup ticks.
    // 即使定时器被事件循环延迟，超时请求也不能复活房间。
    if (room && (room.touched < this.now() - this.roomTtlMs || this._disconnectExpired(room))) this._dispose(room);
    if (!room || !this.rooms.has(code)) fail(404, 'ROOM_NOT_FOUND', '房间不存在或已过期，请检查房间码。');
    return room;
  }
  _dispose(room) {
    if (this.rooms.get(room.code) !== room) return;
    this.rooms.delete(room.code);
    this._cancelBot(room);
    for (const seat of room.seats) if (seat) {
      this._clearDisconnect(seat);
      seat.connected = false;
      seat.voice = false;
      for (const stream of seat.streams) stream.end();
      seat.streams.clear();
      seat.requests.clear();
    }
  }
  /** 中止或清空对局前，暂存各绝对座位的已结算积分与局数，供下一次开局恢复。 */
  _carryGame(room) {
    if (!room.game) return;
    room.carry = {scores:room.game.players.map(member => member.score), round:room.game.round};
    room.game = null;
  }
  /** 用暂存的积分和局数重建下一局；构造器已发过一局，重发一次才能正确推进局数与庄家。 */
  _restoreCarry(room) {
    const carry = room.carry;
    if (!carry) return;
    room.carry = null;
    for (let seat = 0; seat < 4; seat++) room.game.players[seat].score = carry.scores[seat] ?? 1000;
    if (Number.isInteger(carry.round) && carry.round > 0) {
      room.game.round = carry.round;
      room.game.newRound();
    }
  }
  _owner(room, player) { if (room.owner !== player) fail(403, 'OWNER_ONLY', '仅房主可以操作。'); }
  _editBot(room, player, target) {
    this._owner(room, player);
    if (room.game) fail(409, 'ALREADY_STARTED', '对局开始后不能添加或移除人机。');
    if (!Number.isInteger(target) || target < 0 || target >= 4) fail(400, 'INVALID_SEAT', '请选择有效的座位。');
  }
  _canStart(room) {
    if (room.seats.some(seat => !seat)) fail(409, 'NEED_FOUR_PLAYERS', '需要 4 个座位全部入座，可邀请好友或添加人机。');
    if (room.seats.some(seat => !seat.connected)) fail(409, 'PLAYER_DISCONNECTED', '请等待所有好友连接成功。');
    if (room.seats.some(seat => !seat.ready)) fail(409, 'NOT_READY', '请等待所有好友准备。');
  }
  _changed(room) {
    this._updateActionNotice(room);
    room.version++; room.touched = this.now();
    for (let player = 0; player < 4; player++) for (const stream of room.seats[player]?.streams || []) this._write(stream, this.snapshot(room, player));
    this._scheduleBot(room);
  }
  /** Compare committed public state, so submitted or defeated claims never announce. */
  _updateActionNotice(room) {
    const game = room.game;
    if (!game) { room._actionState = null; room.actionNotice = null; return; }
    const previous = room._actionState;
    const next = {
      game, round:game.round, wallInfo:game.wallInfo, result:game.result,
      players:game.players.map(player => ({
        melds:player.melds.map(meld => ({kind:meld.kind, count:meld.tiles.length})),
        redGangs:player.redGangs.length, piziGangs:(player.piziGangs || []).length,
      })),
    };
    room._actionState = next;
    // wallInfo is replaced on a same-round restart as well as a new round.
    if (!previous || previous.game !== game || previous.round !== game.round || previous.wallInfo !== game.wallInfo) {
      room.actionNotice = null;
      return;
    }
    let executed = null;
    for (let player = 0; player < next.players.length; player++) {
      const before = previous.players[player];
      const after = next.players[player];
      if (after.redGangs > before.redGangs || after.piziGangs > before.piziGangs) executed = {player, kind:'gang'};
      for (let index = 0; index < after.melds.length; index++) {
        const old = before.melds[index];
        const meld = after.melds[index];
        if (!old || (meld.kind === 'gang' && (old.kind !== 'gang' || old.count !== meld.count))) {
          executed = {player, kind:meld.kind};
        }
      }
    }
    if (game.phase.kind === 'ended' && game.result?.kind === 'win' && game.result !== previous.result) {
      executed = {player:game.result.winner, kind:'hu'};
    }
    if (executed) room.actionNotice = {
      id:++room._actionNoticeId, ...executed,
      expiresAt:executed.kind === 'hu' ? null : this.now() + ACTION_NOTICE_MS,
    };
  }
  _cancelBot(room) { clearTimeout(room.botTimer); room.botTimer = null; }
  _botTurn(room) {
    const game = room.game;
    if (this.rooms.get(room.code) !== room || !game || game.phase.kind === 'ended' || room.seats.some(seat => !seat?.connected)) return null;
    if (game.phase.kind === 'discard') return room.seats[game.current]?.bot ? game.current : null;
    if (game.phase.kind === 'claim') {
      for (let distance = 1; distance < 4; distance++) {
        const player = (game.phase.discard.from + distance) % 4;
        if (room.seats[player]?.bot && game.getActions(player).pass) return player;
      }
    }
    return null;
  }
  _scheduleBot(room) {
    if (this._botTurn(room) === null) { this._cancelBot(room); return; }
    if (room.botTimer) return;
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      // Recheck after the delay: a human may have disconnected or ended the round.
      const player = this._botTurn(room);
      if (player === null) return;
      const game = room.game;
      const actions = game.getActions(player);
      let action;
      if (game.phase.kind === 'claim') {
        const choice = game._botClaim(player, actions);
        action = this._command(game, player, {kind:choice.action, sequence:choice.tiles, mode:'exposed'});
      } else if (actions.hu) action = {kind:'hu', player, selfDraw:true};
      else if (actions.redGang) action = {kind:'redGang', player};
      else if (actions.piziGang) action = {kind:'piziGang', player};
      else {
        const concealed = actions.concealedGangs.find(tile => tile !== game.wildTile);
        const added = actions.addedGangs.find(tile => tile !== game.wildTile);
        if (concealed !== undefined) action = {kind:'gang', player, tile:concealed, mode:'concealed'};
        else if (added !== undefined) action = {kind:'gang', player, tile:added, mode:'added'};
        else {
          const index = chooseDiscard(game.players[player].hand, game.players[player].melds, game._visibleTiles(), game.wildTile, game.indicatorTile);
          if (index < 0) { game._finishDraw('牌墙已空，杠牌无法补摸，本局流局'); this._changed(room); return; }
          action = {kind:'discard', player, index};
        }
      }
      if (game.applyAction(player, action)) this._changed(room);
    }, this.botDelayMs);
    room.botTimer.unref();
  }
  _write(response, snapshot) { if (response.destroyed || response.writableEnded) return; if (response.writableLength > 262144) { response.destroy(); return; } response.write(`event: state\ndata: ${JSON.stringify(snapshot)}\n\n`); }
  /** 语音信令与牌局快照分开推送，避免信令触发客户端重绘牌桌。 */
  _writeSignal(response, payload) { if (response.destroyed || response.writableEnded) return; if (response.writableLength > 262144) { response.destroy(); return; } response.write(`event: signal\ndata: ${JSON.stringify(payload)}\n\n`); }
  _command(game, player, action) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) fail(400, 'INVALID_ACTION', '操作格式无效。');
    const base = {kind:action.kind, player};
    switch (action.kind) {
      case 'discard': if (!Number.isInteger(action.index)) break; return {...base, index:action.index};
      case 'chi': if (!Array.isArray(action.sequence) || action.sequence.length !== 3 || !action.sequence.every(tile => Number.isInteger(tile) && tile >= 0 && tile < 34)) break; return {...base, sequence:[...action.sequence]};
      case 'gang': {
        if (!['exposed', 'concealed', 'added'].includes(action.mode)) break;
        const tile = action.mode === 'exposed' ? game.pendingDiscard?.tile : action.tile;
        if (!Number.isInteger(tile) || tile < 0 || tile >= 34) break;
        return {...base, mode:action.mode, tile};
      }
      case 'hu': return {...base, selfDraw:game.phase.kind === 'discard'};
      case 'peng': case 'redGang': case 'piziGang': case 'wildGang': case 'pass': return base;
    }
    fail(400, 'INVALID_ACTION', '操作格式无效。');
  }
}
