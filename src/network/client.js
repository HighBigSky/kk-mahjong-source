import { PHASE } from '../domain/model.js';

const SESSION_KEY = 'queqi-room-session';
const emptyActions = () => ({ hu:false, peng:false, gang:false, redGang:false, piziGang:false, chi:[], pass:false, concealedGangs:[], addedGangs:[] });
const emptyState = () => ({ players:Array.from({length:4}, () => ({name:'等待好友', hand:[], melds:[], redGangs:[], piziGangs:[], discards:[], score:1000})), wall:{length:0}, phase:{kind:PHASE.DEALING, dealt:0}, current:null, dealer:0, round:0, pendingDiscard:null, lastDiscard:null, result:null, winner:null, lastDraw:null, events:[], actionNotice:null, laiziEnabled:false, indicatorTile:null, indicatorTaken:false, indicatorTakenBy:null, wildTile:null, wallInfo:null });

/** Same-origin HTTP commands and server-sent snapshots. No rules run in this adapter. */
export function createRoomClient({ onChange = () => {}, onBusyChange, onError = () => {} } = {}) {
  let credentials = null;
  let stream = null;
  let generation = 0;
  let leaving = false;
  let snapshotKey = null;
  let actions = emptyActions();
  let retryTimer = null;
  let healthTimer = null;
  let retryDelay = 500;
  let lastMessageAt = 0;
  let validating = null;
  const lifecycle = new AbortController();
  const signalListeners = new Set();
  const client = { room:null, status:'offline', busy:false, game:emptyState() };
  const changed = () => onChange(client);
  // Busy changes only disable controls; callers can avoid rebuilding the table.
  // Existing callers without this callback keep receiving the original onChange.
  const setBusy = value => {
    if (client.busy === value) return;
    client.busy = value;
    if (onBusyChange) onBusyChange(client);
    else changed();
  };
  const storage = kind => { try { return globalThis[kind]; } catch { return null; } };
  // 标签页优先保留自己的座位，本地备份用于关闭页面后重新打开；网络错误不得清除凭据。
  const save = () => {
    for (const kind of ['sessionStorage', 'localStorage']) {
      try { storage(kind)?.setItem(SESSION_KEY, JSON.stringify(credentials)); } catch { /* 存储禁用不影响当前牌局。 */ }
    }
  };
  const clearSaved = previous => {
    for (const kind of ['sessionStorage', 'localStorage']) {
      try {
        const target = storage(kind);
        const saved = JSON.parse(target?.getItem(SESSION_KEY) || 'null');
        // 旧标签页退出时不能误删另一个标签页新加入的房间凭据。
        if (saved?.code === previous?.code && saved?.token === previous?.token) target?.removeItem(SESSION_KEY);
      } catch { /* Optional persistence. */ }
    }
  };
  const clearTimers = () => { clearTimeout(retryTimer); clearTimeout(healthTimer); retryTimer = healthTimer = null; };
  const online = () => globalThis.navigator?.onLine !== false;
  const setReconnecting = () => {
    if (client.status !== 'reconnecting') { client.status = 'reconnecting'; changed(); }
  };
  function retry() {
    if (!credentials || retryTimer || leaving || !online() || globalThis.document?.visibilityState === 'hidden') return;
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, retryDelay);
    retryTimer.unref?.();
    retryDelay = Math.min(retryDelay * 2, 8000);
  }
  function watchConnection(milliseconds = 45000) {
    clearTimeout(healthTimer);
    healthTimer = setTimeout(() => {
      healthTimer = null;
      if (!credentials || leaving) return;
      setReconnecting();
      retry();
    }, milliseconds);
    healthTimer.unref?.();
  }
  function activity() { lastMessageAt = Date.now(); watchConnection(); }
  function validateSession(currentGeneration) {
    if (!credentials || !online() || validating === currentGeneration) return;
    validating = currentGeneration;
    request(`/api/rooms/${credentials.code}/state`).then(envelope => {
      if (currentGeneration === generation && !leaving) receive(envelope);
    }).catch(error => {
      if (currentGeneration !== generation || leaving) return;
      if (error.status === 401 || error.status === 404) { reset(); onError('房间已失效，请重新创建或加入'); }
    }).finally(() => { if (validating === currentGeneration) validating = null; });
  }
  const receive = envelope => {
    if (!envelope?.room) return false;
    if (client.room?.code === envelope.room.code && client.room.version > envelope.room.version) return false;
    // SSE and the command reply usually contain the same snapshot. Compare the
    // entire payload, not just version: connection/pause/notice timing can change
    // without advancing the room version and must still reach the interface.
    const nextKey = JSON.stringify([envelope.room, envelope.state ?? null]);
    if (nextKey === snapshotKey) return false;
    snapshotKey = nextKey;
    client.room = envelope.room;
    const state = envelope.state;
    Object.assign(client.game, state ? { ...state, wall:{length:state.wallCount} } : emptyState());
    actions = state?.actions || emptyActions();
    changed();
    return true;
  };
  async function request(path, body, authenticated = true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(path, {
        method:body === undefined ? 'GET' : 'POST',
        headers:{ ...(body === undefined ? {} : {'Content-Type':'application/json'}), ...(authenticated && credentials ? {Authorization:`Bearer ${credentials.token}`} : {}) },
        body:body === undefined ? undefined : JSON.stringify(body),
        signal:controller.signal,
        cache:'no-store',
      });
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || '请求失败，请重试');
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('连接超时，请检查网络后重试');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function connect() {
    if (!credentials || leaving) return;
    clearTimers();
    stream?.close();
    stream = null;
    const currentGeneration = ++generation;
    if (!online()) { setReconnecting(); return; }
    client.status = client.room ? 'reconnecting' : 'connecting'; changed();
    watchConnection(12000);
    const source = new EventSource(`/api/rooms/${credentials.code}/events?token=${encodeURIComponent(credentials.token)}`);
    stream = source;
    source.addEventListener('state', event => {
      if (currentGeneration !== generation) return;
      try {
        const envelope = JSON.parse(event.data);
        if (!envelope?.room) return;
        activity(); clearTimeout(retryTimer); retryTimer = null; retryDelay = 500;
        const statusChanged = client.status !== 'connected';
        client.status = 'connected';
        if (!receive(envelope) && statusChanged) changed();
      } catch { onError('房间消息读取失败，请刷新重连'); }
    });
    source.addEventListener('heartbeat', () => {
      if (currentGeneration === generation) activity();
    });
    // 语音信令和牌局快照分开处理：信令不触发牌桌重绘，也不改变房间版本。
    source.addEventListener('signal', event => {
      if (currentGeneration !== generation) return;
      activity();
      try {
        const payload = JSON.parse(event.data);
        for (const listener of signalListeners) listener(payload);
      } catch { /* Ignore one malformed signaling message; the next one can still connect. */ }
    });
    source.onerror = () => {
      // Leaving revokes this token and closes SSE before the HTTP reply arrives.
      // Do not treat that intentional stream close as an expired-room recovery.
      if (currentGeneration !== generation || leaving) return;
      setReconnecting();
      // 先允许原生 SSE 快速恢复；永久关闭或切网失效时，再显式重建连接。
      retry();
      validateSession(currentGeneration);
    };
  }
  function reset() {
    clearTimers(); retryDelay = 500; lastMessageAt = 0;
    generation++; stream?.close(); stream = null;
    snapshotKey = null;
    clearSaved(credentials); credentials = null;
    client.room = null; client.status = 'offline'; actions = emptyActions();
    Object.assign(client.game, emptyState()); changed();
  }
  async function enter(path, body) {
    if (credentials) throw new Error('请先离开当前房间');
    const envelope = await request(path, body, false);
    credentials = {code:envelope.room.code, token:envelope.token}; save();
    receive(envelope); connect();
    return true;
  }
  async function command(endpoint, body = {}) {
    if (!credentials) throw new Error('请先加入房间');
    if (client.busy) return false;
    setBusy(true);
    const currentGeneration = generation;
    try {
      const envelope = await request(`/api/rooms/${credentials.code}/${endpoint}`, body);
      if (currentGeneration === generation && envelope.room) receive(envelope);
      return true;
    } catch (error) {
      if (error.status === 409 && credentials && currentGeneration === generation) {
        try {
          const envelope = await request(`/api/rooms/${credentials.code}/state`);
          if (currentGeneration === generation) receive(envelope);
        } catch { /* SSE also refreshes the snapshot. */ }
      }
      throw error;
    } finally { setBusy(false); }
  }
  client.canAct = () => client.status === 'connected' && !client.busy && client.room?.status === 'playing' && !client.room.paused;
  // Layout can show the next authoritative choices while the previous request
  // finishes. Execution still uses getActions/canAct and remains busy-guarded.
  client.availableActions = () => client.status === 'connected' && client.room?.status === 'playing' && !client.room.paused ? actions : emptyActions();
  client.create = (name, laizi = true) => enter('/api/rooms', {name, laizi});
  client.join = (code, name) => enter(`/api/rooms/${code}/join`, {name});
  client.ready = ready => command('ready', {ready});
  client.start = () => command('start');
  // The browser shows its own seat at 0; room commands use absolute table seats.
  const seatCommand = (operation, seat) => {
    if (!client.room || !Number.isInteger(seat) || seat < 0 || seat > 3) return Promise.reject(new Error('请选择有效的空位'));
    return command(operation, {seat:(client.room.seat + seat) % 4});
  };
  client.addBot = seat => seatCommand('addBot', seat);
  client.removeBot = seat => seatCommand('removeBot', seat);
  client.removePlayer = seat => seatCommand('removePlayer', seat);
  client.next = () => command('next');
  client.voice = enabled => command('voice', {enabled});
  client.voiceConfig = () => credentials
    ? request(`/api/rooms/${credentials.code}/voice`)
    : Promise.reject(new Error('请先加入房间'));
  // 信令是高频短消息，不占用 busy，也不刷新牌局快照。
  client.signal = async payload => {
    if (!credentials) return false;
    await request(`/api/rooms/${credentials.code}/signal`, payload);
    return true;
  };
  client.onSignal = listener => {
    signalListeners.add(listener);
    return () => signalListeners.delete(listener);
  };
  client.leave = async () => {
    if (leaving || !credentials || client.busy) return false;
    leaving = true;
    try { const success = await command('leave'); if (success) reset(); return success; }
    finally {
      leaving = false;
      if (credentials && (client.status !== 'connected' || !stream || stream.readyState === 0 || stream.readyState === 2 || !online())) {
        setReconnecting(); retry();
      }
    }
  };
  client.sessionCode = () => credentials?.code || null;
  client.reconnect = () => {
    if (!credentials || leaving) return false;
    retryDelay = 500;
    connect(); validateSession(generation);
    return true;
  };
  client.restore = async () => {
    if (credentials) return true;
    for (const kind of ['sessionStorage', 'localStorage']) {
      try {
        const saved = JSON.parse(storage(kind)?.getItem(SESSION_KEY) || 'null');
        if (saved && /^\d{6}$/.test(saved.code) && /^[a-f0-9]{48}$/.test(saved.token)) { credentials = {code:saved.code, token:saved.token}; break; }
      } catch { /* 继续尝试另一份备份。 */ }
    }
    if (!credentials) return false;
    save(); connect();
    const currentGeneration = generation;
    try {
      const envelope = await request(`/api/rooms/${credentials.code}/state`);
      if (currentGeneration === generation) receive(envelope);
      return true;
    } catch (error) {
      if (currentGeneration !== generation || leaving) return false;
      if (error.status === 401 || error.status === 404) reset();
      else { setReconnecting(); retry(); onError('网络暂不可用，正在重连原房间'); }
      return false;
    }
  };
  const resume = () => {
    if (credentials && globalThis.document?.visibilityState !== 'hidden'
      && (client.status !== 'connected' || stream?.readyState === 2 || Date.now() - lastMessageAt > 30000)) client.reconnect();
  };
  globalThis.window?.addEventListener('online', resume, {signal:lifecycle.signal});
  globalThis.window?.addEventListener('pageshow', resume, {signal:lifecycle.signal});
  globalThis.document?.addEventListener('visibilitychange', resume, {signal:lifecycle.signal});
  globalThis.window?.addEventListener('offline', () => {
    if (!credentials) return;
    clearTimers(); generation++; stream?.close(); stream = null; setReconnecting();
  }, {signal:lifecycle.signal});
  // 页面销毁只关闭传输，不代表主动离房；保留座位供原玩家恢复。
  client.destroy = () => { clearTimers(); generation++; stream?.close(); stream = null; lifecycle.abort(); };
  client.game.getActions = () => client.canAct() ? actions : emptyActions();
  client.game.applyAction = (_player, action) => {
    if (!client.canAct()) return Promise.resolve(false);
    return command('action', { action:{...action, player:0}, version:client.room.version, requestId:crypto.randomUUID?.() || `${Date.now()}-${Math.random()}` });
  };
  client.game.discard = (player, index) => client.game.applyAction(player, {kind:'discard', index});
  client.game.pass = player => client.game.applyAction(player, {kind:'pass'});
  client.game.claim = (player, kind, value) => {
    const action = kind === 'concealedGang' || kind === 'addedGang' ? {kind:'gang', mode:kind === 'concealedGang' ? 'concealed' : 'added', tile:value}
      : kind === 'gang' ? {kind:'gang', mode:'exposed', tile:client.game.pendingDiscard?.tile}
      : kind === 'chi' ? {kind, sequence:value}
      : kind === 'hu' ? {kind, selfDraw:client.game.phase.kind === PHASE.DISCARD}
      : {kind};
    return client.game.applyAction(player, action);
  };
  return client;
}
