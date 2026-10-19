import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscardFocusState } from '../src/ui/discard-focus.js';
import { MahjongGame } from '../engine.js';
import { RoomService } from '../src/server/rooms.js';
import { assertInvariants } from '../src/domain/invariants.js';

function table(t) {
  const service = new RoomService({ botDelayMs:60000 });
  t.after(() => service.close());
  const created = service.create({ name:'出牌甲', laizi:true });
  const tokens = [created.token];
  for (let index = 1; index < 4; index++) tokens.push(service.join(created.room.code, { name:`出牌${index}` }).token);
  const room = service.rooms.get(created.room.code);
  room.seats.forEach(seat => { seat.connected = true; seat.ready = true; });
  room.game = new MahjongGame({ seed:'last-discard-0', laizi:true, names:room.seats.map(seat => seat.name) });
  service._changed(room);
  const controller = createDiscardFocusState();
  const sample = (connected = true) => {
    const envelope = service.snapshot(room, 0);
    return controller.update({ room:envelope.room, game:envelope.state, connected });
  };
  assert.equal(sample(), null);
  let request = 0;
  const command = (seat, action) => service.action(room.code, tokens[seat], {
    action, version:room.version, requestId:`focus-${++request}`,
  });
  return { service, room, tokens, sample, command, controller };
}

test('an accepted discard stays enlarged through repeated renders and its automatic next draw', t => {
  const h = table(t);
  const index = h.room.game.players[0].hand.findIndex((_, index) => {
    const candidate = new MahjongGame({seed:'last-discard-0', laizi:true});
    return candidate.discard(0, index) && candidate.phase.kind === 'discard';
  });
  assert.ok(index >= 0, 'the dealt hand has a discard with no offered response');
  h.command(0, {kind:'discard', index});
  const focus = h.sample();
  assert.ok(focus);
  assert.equal(h.room.game.pendingDiscard, null);
  assert.equal(h.room.game.current, 1);
  for (let repeat = 0; repeat < 5; repeat++) assert.deepEqual(h.sample(), focus);
  assertInvariants(h.room.game);
});

test('a pass retires the enlarged tile and duplicate snapshots cannot replay it', t => {
  const h = table(t);
  h.command(0, {kind:'discard', index:7});
  assert.ok(h.sample());
  assert.equal(h.room.game.phase.kind, 'claim');
  const responder = h.room.game.players.findIndex((_, seat) => h.room.game.getActions(seat).pass);
  h.command(responder, {kind:'pass'});
  assert.equal(h.sample(), null);
  assert.equal(h.sample(), null);
  assert.notEqual(h.room.game.lastDiscard, null, 'the physical river tile is preserved');
  assertInvariants(h.room.game);
});

test('voice changes, pause/reconnect and missed versions do not masquerade as a response', t => {
  const h = table(t);
  h.command(0, {kind:'discard', index:7});
  const focus = h.sample();
  h.service.setVoice(h.room.code, h.tokens[1], {enabled:true});
  assert.deepEqual(h.sample(), focus);
  h.room.seats[1].connected = false; h.service._changed(h.room);
  assert.deepEqual(h.sample(false), focus);
  h.room.seats[1].connected = true; h.service._changed(h.room);
  assert.deepEqual(h.sample(), focus);
  h.room.version += 2;
  assert.deepEqual(h.sample(), focus);
});

test('new public kong data retires a tile even after missing its command snapshot', t => {
  const h = table(t);
  h.command(0, {kind:'discard', index:7});
  assert.ok(h.sample());
  const envelope = h.service.snapshot(h.room, 0);
  envelope.room.version += 3;
  envelope.state.players[1].redGangs.push(31);
  assert.equal(h.controller.update({room:envelope.room, game:envelope.state}), null);
  assert.equal(h.controller.update({room:envelope.room, game:envelope.state}), null);
});

test('new round or leave clears presentation; historical resolved tiles are not replayed on load', t => {
  const h = table(t);
  h.command(0, {kind:'discard', index:7});
  assert.ok(h.sample());
  const responder = h.room.game.players.findIndex((_, seat) => h.room.game.getActions(seat).pass);
  h.command(responder, {kind:'pass'});
  const envelope = h.service.snapshot(h.room, 0);
  const restored = createDiscardFocusState();
  assert.equal(restored.update({room:envelope.room, game:envelope.state}), null);
  assert.equal(h.controller.update({room:null, game:envelope.state}), null);
  h.room.game.newRound('focus-next-round'); h.service._changed(h.room);
  assert.equal(h.sample(), null);
});

test('a retired pending tile remains small on refresh even while another response is unresolved', t => {
  const h = table(t);
  const data = new Map();
  const storage = {getItem:key => data.get(key), setItem:(key, value) => data.set(key, value)};
  const live = createDiscardFocusState({storage});
  let envelope = h.service.snapshot(h.room, 0);
  live.update({room:envelope.room, game:envelope.state});
  h.command(0, {kind:'discard', index:7});
  envelope = h.service.snapshot(h.room, 0);
  assert.ok(live.update({room:envelope.room, game:envelope.state}));
  // A submitted response is public only as a version advance until priority
  // resolves; its river and pending discard are intentionally still identical.
  envelope.room.version++;
  assert.equal(live.update({room:envelope.room, game:envelope.state}), null);
  const restored = createDiscardFocusState({storage});
  assert.equal(restored.update({room:envelope.room, game:envelope.state}), null);
});

test('an expired earlier action notice returning in a duplicate snapshot is not a new response', t => {
  const h = table(t);
  h.command(0, {kind:'discard', index:7});
  let envelope = h.service.snapshot(h.room, 0);
  envelope.state.actionNotice = {id:5, player:0, kind:'gang', remainingMs:10};
  const focus = h.controller.update({room:envelope.room, game:envelope.state});
  assert.ok(focus);
  envelope = structuredClone(envelope);
  envelope.state.actionNotice = null;
  assert.deepEqual(h.controller.update({room:envelope.room, game:envelope.state}), focus);
  envelope.state.actionNotice = {id:5, player:0, kind:'gang', remainingMs:1};
  assert.deepEqual(h.controller.update({room:envelope.room, game:envelope.state}), focus);
  envelope.state.actionNotice.id = 6;
  assert.equal(h.controller.update({room:envelope.room, game:envelope.state}), null);
});
