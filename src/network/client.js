import { PHASE } from '../domain/model.js';

const SESSION_KEY = 'queqi-room-session';
const emptyActions = () => ({ hu:false, peng:false, gang:false, redGang:false, piziGang:false, chi:[], pass:false, concealedGangs:[], addedGangs:[] });
const emptyState = () => ({ players:Array.from({length:4}, () => ({name:'等待好友', hand:[], melds:[], redGangs:[], piziGangs:[], discards:[], score:1000})), wall:{length:0}, phase:{kind:PHASE.DEALING, dealt:0}, current:null, dealer:0, round:0, pendingDiscard:null, result:null, winner:null, lastDraw:null, events:[], actionNotice:null, laiziEnabled:false, indicatorTile:null, wildTile:null, wallInfo:null });

/** Same-origin HTTP commands and server-sent snapshots. No rules run in this adapter. */
export function createRoomClient({ onChange = () => {}, onError = () => {} } = {}) {
  let credentials = null;
  let stream = null;
  let generation = 0;
  let leaving = false;
  let actions = emptyActions();
  const client = { room:null, status:'offline', busy:false, game:emptyState() };
  const changed = () => onChange(client);
  const save = () => { try { if (credentials) sessionStorage.setItem(SESSION_KEY, JSON.stringify(credentials)); else sessionStorage.removeItem(SESSION_KEY); } catch { /* Session storage is optional. */ } };
  const receive = envelope => {
    if (!envelope?.room) return;
    if (client.room?.code === envelope.room.code && client.room.version > envelope.room.version) return;
    client.room = envelope.room;
    const state = envelope.state;
    Object.assign(client.game, state ? { ...state, wall:{length:state.wallCount} } : emptyState());
    actions = state?.actions || emptyActions();
    changed();
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
    stream?.close();
    const currentGeneration = ++generation;
    client.status = 'connecting'; changed();
    const source = new EventSource(`/api/rooms/${credentials.code}/events?token=${encodeURIComponent(credentials.token)}`);
    stream = source;
    source.addEventListener('state', event => {
      if (currentGeneration !== generation) return;
      try {
        const envelope = JSON.parse(event.data);
        client.status = 'connected';
        receive(envelope);
      } catch { onError('房间消息读取失败，请刷新重连'); }
    });
    source.onerror = () => {
      // Leaving revokes this token and closes SSE before the HTTP reply arrives.
      // Do not treat that intentional stream close as an expired-room recovery.
      if (currentGeneration !== generation || leaving) return;
      client.status = 'reconnecting'; changed();
      // EventSource retries transport failures. An expired room cannot recover.
      request(`/api/rooms/${credentials.code}/state`).then(receive).catch(error => {
        if (currentGeneration !== generation) return;
        if (error.status === 401 || error.status === 404) { reset(); onError('房间已失效，请重新创建或加入'); }
      });
    };
  }
  function reset() {
    generation++; stream?.close(); stream = null;
    credentials = null; save();
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
    client.busy = true; changed();
    const currentGeneration = generation;
    try {
      const envelope = await request(`/api/rooms/${credentials.code}/${endpoint}`, body);
      if (currentGeneration === generation && envelope.room) receive(envelope);
      return true;
    } catch (error) {
      if (error.status === 409 && credentials) {
        try { receive(await request(`/api/rooms/${credentials.code}/state`)); } catch { /* SSE also refreshes the snapshot. */ }
      }
      throw error;
    } finally { client.busy = false; changed(); }
  }
  client.canAct = () => client.status === 'connected' && !client.busy && client.room?.status === 'playing' && !client.room.paused;
  client.create = (name, laizi = false) => enter('/api/rooms', {name, laizi});
  client.join = (code, name) => enter(`/api/rooms/${code}/join`, {name});
  client.ready = ready => command('ready', {ready});
  client.start = () => command('start');
  // The browser shows its own seat at 0; room commands use absolute table seats.
  const botCommand = (operation, seat) => {
    if (!client.room || !Number.isInteger(seat) || seat < 0 || seat > 3) return Promise.reject(new Error('请选择有效的空位'));
    return command(operation, {seat:(client.room.seat + seat) % 4});
  };
  client.addBot = seat => botCommand('addBot', seat);
  client.removeBot = seat => botCommand('removeBot', seat);
  client.next = () => command('next');
  client.leave = async () => {
    leaving = true;
    try { const success = await command('leave'); if (success) reset(); return success; }
    finally { leaving = false; }
  };
  client.restore = async () => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (!saved || !/^\d{6}$/.test(saved.code) || !/^[a-f0-9]{48}$/.test(saved.token)) return false;
      credentials = saved;
      receive(await request(`/api/rooms/${credentials.code}/state`));
      connect(); return true;
    } catch (error) {
      if (error.status === 401 || error.status === 404) reset();
      else if (credentials) { connect(); onError('网络暂不可用，正在重连原房间'); }
      return false;
    }
  };
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
