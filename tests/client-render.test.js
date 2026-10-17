import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomClient } from '../src/network/client.js';

function envelope(version = 1, changes = () => {}) {
  const value = {
    room: { code:'123456', version, seat:0, owner:0, status:'playing', paused:false,
      seats:Array.from({length:4}, (_, seat) => ({name:`玩家${seat}`, occupied:true, connected:true, ready:true, bot:seat > 0, voice:false})) },
    state: { players:Array.from({length:4}, () => ({hand:[1,2,3], melds:[], redGangs:[], piziGangs:[], discards:[], score:1000})),
      wallCount:80, current:0, round:1, phase:{kind:'discard'}, pendingDiscard:null,
      actionNotice:null, actions:{hu:false, peng:false, gang:false, redGang:false, piziGang:false, chi:[], pass:false, concealedGangs:[], addedGangs:[]} },
  };
  changes(value);
  return value;
}

function harness(t, callbacks = {}) {
  const pending = [];
  const streams = [];
  class FakeEventSource {
    constructor(url) { this.url = url; this.listeners = new Map(); streams.push(this); }
    addEventListener(kind, listener) { this.listeners.set(kind, listener); }
    close() { this.closed = true; }
    emit(value, kind = 'state') { this.listeners.get(kind)?.({data:JSON.stringify(value)}); }
  }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const response = pending.shift();
    assert.ok(response, `unexpected request: ${url}`);
    return response(url, options);
  });
  const oldSource = globalThis.EventSource;
  const oldStorage = globalThis.sessionStorage;
  globalThis.EventSource = FakeEventSource;
  const storage = new Map();
  globalThis.sessionStorage = {getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value), removeItem:key => storage.delete(key)};
  t.after(() => { globalThis.EventSource = oldSource; globalThis.sessionStorage = oldStorage; });
  const changes = [];
  const busy = [];
  const errors = [];
  const client = createRoomClient({
    onChange:value => changes.push({version:value.room?.version, status:value.status, busy:value.busy}),
    onBusyChange:value => busy.push(value.busy),
    onError:message => errors.push(message),
    ...callbacks,
  });
  const reply = (value, status = 200) => pending.push(async () => ({ok:status < 400, status, json:async () => value}));
  return {client, pending, streams, changes, busy, errors, reply,
    async enter() {
      reply({...envelope(), token:'a'.repeat(48)});
      await client.create('玩家0');
      streams.at(-1).emit(envelope());
      changes.length = 0; busy.length = 0;
    },
  };
}

test('one command measurement: an SSE snapshot and matching HTTP reply', async t => {
  const h = harness(t);
  await h.enter();
  h.pending.push(async () => {
    h.streams.at(-1).emit(envelope(2));
    return {ok:true, status:200, json:async () => envelope(2)};
  });
  assert.equal(await h.client.ready(true), true);
  t.diagnostic(`command full-state callbacks: ${h.changes.length}; busy callbacks: ${h.busy.length}`);
  assert.equal(h.changes.length, 1);
  assert.deepEqual(h.busy, [true, false]);
  assert.equal(h.client.room.version, 2);
  assert.equal(h.client.busy, false);
});

test('legacy clients still receive busy updates without the optional callback', async t => {
  const h = harness(t, {onBusyChange:undefined});
  await h.enter();
  h.pending.push(async () => {
    h.streams.at(-1).emit(envelope(2));
    return {ok:true, status:200, json:async () => envelope(2)};
  });
  await h.client.game.discard(0, 0);
  assert.deepEqual(h.changes.map(value => value.busy), [true, true, false]);
  assert.equal(h.client.canAct(), true);
});

test('layout can peek new authoritative choices during busy without enabling an action', async t => {
  const observed = [];
  const h = harness(t, {onChange:client => {
    if (client.room?.version === 2) observed.push({busy:client.busy, available:client.availableActions().peng, actionable:client.game.getActions().peng});
  }});
  await h.enter();
  h.pending.push(async () => {
    h.streams.at(-1).emit(envelope(2, value => { value.state.actions.peng = true; value.state.actions.pass = true; }));
    assert.equal(h.client.canAct(), false);
    assert.equal(h.client.availableActions().pass, true);
    assert.equal(await h.client.game.claim(0, 'peng'), false);
    return {ok:true, status:200, json:async () => envelope(2, value => { value.state.actions.peng = true; value.state.actions.pass = true; })};
  });
  await h.client.game.discard(0, 0);
  assert.deepEqual(observed, [{busy:true, available:true, actionable:false}]);
  assert.equal(h.client.game.getActions().peng, true);
  assert.equal(h.client.availableActions().peng, true);
  h.streams.at(-1).emit(envelope(2, value => { value.room.paused = true; value.state.actions.peng = true; }));
  assert.equal(h.client.availableActions().peng, false);
  h.reply(envelope(2));
  h.streams.at(-1).onerror();
  assert.equal(h.client.availableActions().peng, false);
  await new Promise(resolve => setImmediate(resolve));
});

test('HTTP-first delivery and repeated SSE snapshots apply the authoritative state once', async t => {
  const h = harness(t);
  await h.enter();
  h.reply(envelope(2));
  await h.client.game.discard(0, 0);
  h.streams.at(-1).emit(envelope(2));
  h.streams.at(-1).emit(envelope(2));
  h.streams.at(-1).emit(envelope(1));
  assert.equal(h.changes.length, 1);
  assert.equal(h.client.room.version, 2);
});

test('an older HTTP reply cannot replace newer SSE turns or their available actions', async t => {
  const h = harness(t);
  await h.enter();
  h.pending.push(async (_url, options) => {
    const command = JSON.parse(options.body);
    assert.equal(command.version, 1);
    assert.equal(command.action.kind, 'discard');
    h.streams.at(-1).emit(envelope(2));
    h.streams.at(-1).emit(envelope(3, value => { value.state.actions.peng = true; value.state.current = 1; }));
    return {ok:true, status:200, json:async () => envelope(2)};
  });
  await h.client.game.discard(0, 1);
  assert.equal(h.changes.length, 2);
  assert.equal(h.client.room.version, 3);
  assert.equal(h.client.game.current, 1);
  assert.equal(h.client.game.getActions().peng, true);
});

test('same-version pause, connection, voice, action and notice timing changes remain observable', async t => {
  const h = harness(t);
  await h.enter();
  const value = envelope();
  const send = () => h.streams.at(-1).emit(value);
  value.room.paused = true; send();
  assert.equal(h.client.canAct(), false);
  value.room.seats[1].connected = false; send();
  value.room.seats[0].voice = true; send();
  value.state.actions.peng = true; send();
  value.state.actionNotice = {id:1, player:1, kind:'peng', remainingMs:650}; send();
  value.state.actionNotice.remainingMs = 510; send();
  assert.equal(h.client.game.actionNotice.remainingMs, 510);
  value.state.actionNotice = null; send();
  assert.equal(h.client.game.actionNotice, null);
  value.room.paused = false; send();
  assert.equal(h.client.canAct(), true);
  send();
  assert.equal(h.changes.length, 8);
});

test('failed requests release busy, prevent duplicate commands and allow a retry', async t => {
  const h = harness(t);
  await h.enter();
  let rejectRequest;
  h.pending.push(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
  const first = h.client.game.discard(0, 0);
  assert.equal(h.client.busy, true);
  assert.equal(h.client.canAct(), false);
  assert.equal(await h.client.game.discard(0, 0), false);
  rejectRequest(new Error('network unavailable'));
  await assert.rejects(first, /network unavailable/);
  assert.deepEqual(h.busy, [true, false]);
  assert.equal(h.changes.length, 0);
  assert.equal(h.client.canAct(), true);
  h.reply(envelope(2));
  assert.equal(await h.client.game.discard(0, 0), true);
  assert.deepEqual(h.busy, [true, false, true, false]);
  assert.equal(h.client.room.version, 2);
});

test('409 recovery refreshes authoritative state before allowing another action', async t => {
  const h = harness(t);
  await h.enter();
  h.reply({error:'stale action'}, 409);
  h.reply(envelope(4, value => { value.state.players[0].hand = [4,5,6]; }));
  await assert.rejects(h.client.game.discard(0, 0), error => error.status === 409);
  assert.equal(h.client.room.version, 4);
  assert.deepEqual(h.client.game.players[0].hand, [4,5,6]);
  assert.equal(h.client.busy, false);
  assert.equal(h.changes.length, 1);
  assert.deepEqual(h.busy, [true, false]);
});

test('failed 409 refresh preserves the error and SSE can still recover afterward', async t => {
  const h = harness(t);
  await h.enter();
  h.reply({error:'stale action'}, 409);
  h.pending.push(async () => { throw new Error('offline'); });
  await assert.rejects(h.client.game.discard(0, 0), error => error.status === 409);
  assert.equal(h.client.busy, false);
  h.streams.at(-1).emit(envelope(2));
  assert.equal(h.client.room.version, 2);
  assert.equal(h.client.canAct(), true);
});

test('an identical snapshot still announces a transport reconnection exactly once', async t => {
  const h = harness(t);
  await h.enter();
  h.reply(envelope());
  h.streams.at(-1).onerror();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.client.status, 'reconnecting');
  assert.equal(h.client.canAct(), false);
  h.streams.at(-1).emit(envelope());
  h.streams.at(-1).emit(envelope());
  assert.deepEqual(h.changes.map(value => value.status), ['reconnecting', 'connected']);
  assert.equal(h.client.canAct(), true);
});

test('a recovery response from an expired stream cannot resurrect the room after leaving', async t => {
  const h = harness(t);
  await h.enter();
  let resolveRecovery;
  h.pending.push(() => new Promise(resolve => { resolveRecovery = resolve; }));
  const oldStream = h.streams.at(-1);
  oldStream.onerror();
  h.reply({left:true});
  await h.client.leave();
  assert.equal(h.client.room, null);
  assert.equal(h.client.game.lastDiscard, null);
  resolveRecovery({ok:true, status:200, json:async () => envelope(5)});
  oldStream.emit(envelope(6));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.client.room, null);
  assert.equal(h.client.status, 'offline');
  assert.equal(h.client.busy, false);
});

test('voice signaling continues without full-state or busy callbacks', async t => {
  const h = harness(t);
  await h.enter();
  const signals = [];
  const unsubscribe = h.client.onSignal(value => signals.push(value));
  const signal = {from:1, candidate:{candidate:'candidate:test'}};
  h.streams.at(-1).emit(signal, 'signal');
  h.reply({sent:true});
  assert.equal(await h.client.signal({to:1, candidate:signal.candidate}), true);
  unsubscribe();
  h.streams.at(-1).emit(signal, 'signal');
  assert.deepEqual(signals, [signal]);
  assert.equal(h.changes.length, 0);
  assert.equal(h.busy.length, 0);
});
