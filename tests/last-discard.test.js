import test from 'node:test';
import assert from 'node:assert/strict';
import { MahjongGame, isSpecialGangTile } from '../engine.js';
import { RoomService } from '../src/server/rooms.js';
import { assertInvariants } from '../src/domain/invariants.js';
import { actionFixture, scattered } from './pizi-fixtures.mjs';

function passAll(game, except = -1) {
  let passes = 0;
  for (let step = 0; step < 4 && game.phase.kind === 'claim'; step++) {
    const player = game.players.findIndex((_, seat) => seat !== except && game.getActions(seat).pass);
    assert.ok(player >= 0, 'every unresolved claim must have a player who can answer');
    assert.equal(game.pass(player), true);
    passes++;
  }
  assert.notEqual(game.phase.kind, 'claim');
  return passes;
}

function discardLegal(game) {
  const from = game.current;
  const index = game.players[from].hand.findIndex(tile => !isSpecialGangTile(tile, game.indicatorTile));
  assert.ok(index >= 0);
  const tile = game.players[from].hand[index];
  const riverIndex = game.players[from].discards.length;
  assert.equal(game.discard(from, index), true);
  const expected = { from, tile, index: riverIndex };
  assert.deepEqual(game.lastDiscard, expected);
  assertInvariants(game);
  return expected;
}

test('a naturally dealt legal discard remains marked after every claim is passed, until the next discard', () => {
  const game = new MahjongGame({ seed: 'last-discard-0', laizi: true });
  assert.equal(game.lastDiscard, null);
  const tile = game.players[0].hand[7];
  assert.equal(game.discard(0, 7), true);
  assert.equal(game.phase.kind, 'claim', 'the real seed offers player 1 a response');
  const first = { from: 0, tile, index: 0 };
  assert.deepEqual(game.lastDiscard, first);
  assert.equal(passAll(game), 1);
  assert.equal(game.pendingDiscard, null);
  assert.equal(game.current, 1);
  assert.deepEqual(game.lastDiscard, first, 'a draw and completed response window must not erase the visible latest discard');
  assert.equal(game.players[0].discards[first.index], first.tile);
  const second = discardLegal(game);
  assert.equal(second.from, 1);
  assert.notDeepEqual(second, first);
  passAll(game);
  assert.deepEqual(game.lastDiscard, second);
  assertInvariants(game);
});

test('the marker stores a river index, including the same seat next time around, rather than a hand index', () => {
  const game = new MahjongGame({ seed: 'last-discard-0', laizi: true });
  for (let turn = 0; turn < 5; turn++) {
    const latest = discardLegal(game);
    assert.equal(latest.index, turn < 4 ? 0 : 1);
    passAll(game);
    assert.deepEqual(game.lastDiscard, latest);
    assert.equal(game.players[latest.from].discards[latest.index], latest.tile);
  }
  assert.equal(game.lastDiscard.from, 0);
  assert.equal(game.lastDiscard.index, 1);
});

test('rejected out-of-turn and invalid-index actions preserve the latest discard marker', () => {
  const game = new MahjongGame({ seed: 'last-discard-0', laizi: true });
  const latest = discardLegal(game);
  passAll(game);
  const before = JSON.stringify(game);
  assert.equal(game.discard((game.current + 1) % 4, 0), false);
  assert.equal(game.discard(game.current, -1), false);
  assert.equal(game.discard(game.current, 999), false);
  assert.deepEqual(game.lastDiscard, latest);
  assert.equal(JSON.stringify(game), before);
});

test('executed chi, peng, exposed gang and discard Hu remove the marker with the claimed river tile', () => {
  const scenarios = [
    { kind: 'chi', hand: [0, 2, ...scattered.filter(tile => tile !== 0 && tile !== 2).slice(0, 11)], discard: 1, tiles: [0, 1, 2] },
    { kind: 'peng', hand: [27, 27, ...scattered.slice(0, 11)], discard: 27 },
    { kind: 'gang', hand: [28, 28, 28, ...scattered.slice(0, 10)], discard: 28 },
    { kind: 'hu', hand: [0, 0, 2, 2, 3, 3, 5, 5, 6, 6, 8, 8, 27], discard: 27 },
  ];
  for (const scenario of scenarios) {
    const actor = 1;
    const game = actionFixture({ seat: actor, hand: scenario.hand, discard: scenario.discard });
    const from = game.pendingDiscard.from;
    // The fixture allocates a real public river tile but has no prior action history.
    game.lastDiscard = { from, tile: scenario.discard, index: 0 };
    assert.equal(game.players[from].discards[0], scenario.discard);
    assert.equal(game.claim(actor, scenario.kind, scenario.tiles), true, scenario.kind);
    if (game.phase.kind === 'claim') {
      assert.notEqual(game.lastDiscard, null, 'a submitted claim waits for priority resolution before removing the marker');
      passAll(game, actor);
    }
    assert.equal(game.lastDiscard, null, scenario.kind);
    assert.deepEqual(game.players[from].discards, []);
    assert.equal(game.pendingDiscard, null);
    assert.equal(scenario.kind === 'hu' ? game.result.winner : game.players[actor].melds.at(-1).kind, scenario.kind === 'hu' ? actor : scenario.kind);
    assertInvariants(game);
  }
});

test('both next-round deals and same-round restarts clear the previous discard', () => {
  for (const restart of [false, true]) {
    const game = new MahjongGame({ seed: 'last-discard-0', laizi: true });
    discardLegal(game);
    passAll(game);
    const round = game.round;
    assert.notEqual(game.lastDiscard, null);
    game.newRound('last-discard-reset', { restart });
    assert.equal(game.round, round + (restart ? 0 : 1));
    assert.equal(game.lastDiscard, null);
    assert.equal(game.pendingDiscard, null);
    assert.ok(game.players.every(player => player.discards.length === 0));
    assertInvariants(game);
  }
});

test('four room viewpoints map the marked seat and preserve its river index while exposing only three fields', t => {
  const service = new RoomService();
  t.after(() => service.close());
  const created = service.create({ name: '标记甲' });
  for (const name of ['标记乙', '标记丙', '标记丁']) service.join(created.room.code, { name });
  const room = service.rooms.get(created.room.code);
  room.game = new MahjongGame({ seed: 'last-discard-0', laizi: true });
  const game = room.game;
  for (let turn = 0; turn < 5; turn++) {
    const latest = discardLegal(game);
    passAll(game);
    game.lastDiscard.serverOnly = { value: 'private-marker-field' };
    const before = JSON.stringify(game);
    for (let viewer = 0; viewer < 4; viewer++) {
      const snapshot = service.snapshot(room, viewer);
      const relative = (latest.from - viewer + 4) % 4;
      assert.deepEqual(snapshot.state.lastDiscard, { from: relative, tile: latest.tile, index: latest.index });
      assert.deepEqual(Object.keys(snapshot.state.lastDiscard).sort(), ['from', 'index', 'tile']);
      assert.equal(snapshot.state.players[relative].discards[latest.index], latest.tile);
      assert.ok(snapshot.state.players.slice(1).every(player => player.hand.every(tile => tile === null)));
      assert.equal(JSON.stringify(snapshot).includes('private-marker-field'), false);
      snapshot.state.lastDiscard.index = 999;
      assert.equal(game.lastDiscard.index, latest.index, 'view snapshots cannot mutate the authoritative marker');
    }
    assert.equal(JSON.stringify(game), before);
    delete game.lastDiscard.serverOnly;
  }
  game.newRound('last-discard-snapshot-reset');
  for (let viewer = 0; viewer < 4; viewer++) assert.equal(service.snapshot(room, viewer).state.lastDiscard, null);
});
