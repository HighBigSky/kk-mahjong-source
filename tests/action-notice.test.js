import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RoomService } from '../src/server/rooms.js';
import { MahjongGame } from '../engine.js';
import { assertInvariants } from '../src/domain/invariants.js';
import { TILE, RED_DRAGON } from '../src/domain/tile.js';
import { actionFixture, scattered } from './pizi-fixtures.mjs';

class Stream extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writableLength = 0;
  states = [];
  writeHead() {}
  write(text) {
    const data = text.split('\n').find(line => line.startsWith('data: '));
    if (data) this.states.push(JSON.parse(data.slice(6)));
    return true;
  }
  end() { if (!this.writableEnded) { this.writableEnded = true; this.emit('close'); } }
  destroy() { this.destroyed = true; this.end(); }
}

function harness(t, { bots = false } = {}) {
  let clock = 100000;
  const service = new RoomService({ now: () => clock, botDelayMs: 18, disconnectGraceMs: 1 });
  t.after(() => service.close());
  const owner = service.create({ name: '提示甲', laizi: true });
  const code = owner.room.code;
  const tokens = [owner.token];
  for (let seat = 1; seat < 4; seat++) {
    if (bots) service.addBot(code, owner.token, { seat });
    else tokens.push(service.join(code, { name: `提示${seat}` }).token);
  }
  const streams = tokens.map(token => { const stream = new Stream(); service.connect(code, token, stream); return stream; });
  for (const token of tokens) service.ready(code, token, { ready: true });
  service.start(code, tokens[0]);
  const room = service.rooms.get(code);
  let requests = 0;
  const request = (player, action, requestId = `notice-${++requests}`) => service.action(code, tokens[player], {
    action, version: room.version, requestId,
  });
  const publish = game => { service._cancelBot(room); room.game = game; service._changed(room); };
  return { service, room, code, tokens, streams, request, publish,
    get now() { return clock; }, advance: elapsed => { clock += elapsed; } };
}

function assertNotice(h, actor, kind, duration = 2400) {
  const id = h.room.actionNotice.id;
  assert.ok(Number.isSafeInteger(id) && id > 0);
  const gameBefore = JSON.stringify(h.room.game);
  for (let viewer = 0; viewer < 4; viewer++) {
    const expected = { id, player: (actor - viewer + 4) % 4, kind, remainingMs: duration };
    assert.deepEqual(h.service.snapshot(h.room, viewer).state.actionNotice, expected);
    if (h.streams[viewer]) assert.deepEqual(h.streams[viewer].states.at(-1).state.actionNotice, expected);
  }
  assert.equal(JSON.stringify(h.room.game), gameBefore, 'notice snapshots cannot change rules, scores or events');
  assertInvariants(h.room.game);
  return id;
}

function resolveOtherClaims(h, actor) {
  for (let turn = 0; turn < 4 && h.room.game.phase.kind === 'claim'; turn++) {
    for (let seat = 0; seat < 4 && h.room.game.phase.kind === 'claim'; seat++) {
      if (seat !== actor && h.room.game.getActions(seat).pass) h.request(seat, { kind: 'pass' });
    }
  }
}

function scenarios(seat = 1) {
  return [
    { seat, action: { kind: 'redGang' } },
    { seat, hand: [...scattered, TILE.WHITE], action: { kind: 'piziGang' } },
    { seat, hand: [0, 2, ...scattered.filter(tile => tile !== 0 && tile !== 2).slice(0, 11)],
      discard: 1, action: { kind: 'chi', sequence: [0, 1, 2] } },
    { seat, hand: [27, 27, ...scattered.slice(0, 11)], discard: 27, action: { kind: 'peng' } },
    { seat, hand: [28, 28, 28, ...scattered.slice(0, 10)], discard: 28,
      action: { kind: 'gang', mode: 'exposed', tile: 28 } },
    { seat, hand: [29, 29, 29, 29, ...scattered.slice(0, 10)],
      action: { kind: 'gang', mode: 'concealed', tile: 29 } },
    { seat, hand: [30, ...scattered.slice(0, 10)],
      melds: [{ kind: 'peng', tiles: [30, 30, 30], from: (seat + 3) % 4, concealed: false }],
      action: { kind: 'gang', mode: 'added', tile: 30 } },
    { seat, hand: [0, 1, 2, 9, 10, 11, 18, 19, 20, 24, 25, 26, 4, 4], action: { kind: 'hu' } },
  ];
}

test('all committed human chi, peng, five kong forms and Hu publish one mapped notice for every viewer', t => {
  const h = harness(t);
  let previousId = 0;
  for (const scenario of scenarios()) {
    h.publish(actionFixture({ ...scenario }));
    assert.equal(h.service.snapshot(h.room, 0).state.actionNotice, null, 'fixture history only establishes a baseline');
    h.request(scenario.seat, scenario.action);
    resolveOtherClaims(h, scenario.seat);
    const kind = ['redGang', 'piziGang'].includes(scenario.action.kind) ? 'gang' : scenario.action.kind;
    const id = assertNotice(h, scenario.seat, kind, kind === 'hu' ? null : 2400);
    assert.ok(id > previousId, 'notice identifiers never repeat when fixtures or rounds change');
    previousId = id;
  }
});

test('notice lifetime uses the authoritative clock and duplicates, reads and reconnects never renew it', t => {
  const h = harness(t);
  h.publish(actionFixture({ seat: 1 }));
  const action = { kind: 'redGang' };
  h.request(1, action, 'stable-red-request');
  const id = assertNotice(h, 1, 'gang');
  h.advance(700);
  const expected = { id, player: 1, kind: 'gang', remainingMs: 1700 };
  assert.deepEqual(h.service.state(h.code, h.tokens[0]).state.actionNotice, expected);
  const duplicate = h.request(1, action, 'stable-red-request');
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.state.actionNotice, { ...expected, player: 0 });
  h.streams[0].end();
  const reconnect = new Stream();
  h.service.connect(h.code, h.tokens[0], reconnect);
  assert.deepEqual(reconnect.states.at(-1).state.actionNotice, expected);
  h.advance(1700);
  assert.equal(h.service.state(h.code, h.tokens[0]).state.actionNotice, null, 'expiry is exact, not an animation restart');
  assert.equal(h.request(1, action, 'stable-red-request').state.actionNotice, null);
  const expiredReconnect = new Stream();
  h.service.connect(h.code, h.tokens[0], expiredReconnect);
  assert.equal(expiredReconnect.states.at(-1).state.actionNotice, null);
  h.service._changed(h.room);
  assert.equal(h.service.snapshot(h.room, 2).state.actionNotice, null, 'unrelated broadcasts do not revive an expired notice');
});

test('Hu remains until a new round or room reset, while same-round restart clears an ordinary notice', t => {
  const h = harness(t);
  h.publish(actionFixture({ hand: [0, 1, 2, 9, 10, 11, 18, 19, 20, 24, 25, 26, 4, 4] }));
  h.request(0, { kind: 'hu' });
  const id = assertNotice(h, 0, 'hu', null);
  h.advance(60000);
  h.service._changed(h.room);
  assertNotice(h, 0, 'hu', null);
  assert.equal(h.room.actionNotice.id, id);
  h.service.next(h.code, h.tokens[0]);
  assert.equal(h.service.snapshot(h.room, 0).state.actionNotice, null);
  h.publish(actionFixture());
  h.request(0, { kind: 'redGang' });
  assertNotice(h, 0, 'gang');
  const round = h.room.game.round;
  h.room.game.newRound('same-round-notice-reset', { restart: true });
  assert.equal(h.room.game.round, round);
  h.service._changed(h.room);
  assert.equal(h.service.snapshot(h.room, 0).state.actionNotice, null);
  h.room.game = null;
  h.service._changed(h.room);
  assert.equal(h.room.actionNotice, null);
});

function claimFixture(h, { current = 0, hands, melds = {} }) {
  const quiet = [3, 5, 7, 12, 14, 16, 21, 23, 25, 28, 30, 32, 33];
  const game = new MahjongGame({ seed: 'notice-claim-priority', names: h.room.seats.map(seat => seat.name), laizi: false });
  const counts = Array(34).fill(4);
  for (let seat = 0; seat < 4; seat++) {
    const player = game.players[seat];
    player.hand = [...(hands[seat] || quiet)];
    player.melds = structuredClone(melds[seat] || []);
    player.redGangs = []; player.piziGangs = []; player.discards = [];
    for (const tile of [...player.hand, ...player.melds.flatMap(meld => meld.tiles)]) assert.ok(--counts[tile] >= 0);
  }
  game.wall = counts.flatMap((count, tile) => Array(count).fill(tile));
  game.current = current; game.phase = { kind: 'discard', seat: current };
  game.pendingDiscard = null; game.result = null; game.winner = null; game.events = [];
  game.lastDraw = { player: current, tile: game.players[current].hand.at(-1), index: game.players[current].hand.length - 1, replacement: false };
  game._responses = Array(4).fill(null);
  assertInvariants(game);
  return game;
}

test('unresolved or defeated chi and peng never announce, and committed Hu has priority', t => {
  const h = harness(t);
  const quiet = [3, 5, 7, 12, 14, 16, 21, 23, 25, 28, 30, 32, 33];
  for (const order of [[1, 2], [2, 1]]) {
    const game = claimFixture(h, { hands: {
      0: [...quiet, 19], 1: [19, 19, 4, 6, 8, 13, 15, 17, 20, 22, 24, 28, 29],
      2: [9, 10, 11, 21, 22, 23, 26, 26, 26, 19],
    }, melds: { 2: [{ kind: 'chi', tiles: [0, 1, 2], from: 1, concealed: false }] } });
    h.publish(game);
    assert.equal(h.service.snapshot(h.room, 0).state.actionNotice, null, 'initial public chi is historical');
    h.request(0, { kind: 'discard', index: game.players[0].hand.indexOf(19) });
    h.request(order[0], { kind: order[0] === 1 ? 'peng' : 'hu' });
    assert.equal(game.phase.kind, 'claim');
    assert.equal(h.service.snapshot(h.room, 0).state.actionNotice, null, 'a submitted claim is not yet an executed operation');
    h.request(order[1], { kind: order[1] === 1 ? 'peng' : 'hu' });
    assert.equal(game.players[1].melds.length, 0);
    assertNotice(h, 2, 'hu', null);
  }
  const game = claimFixture(h, { hands: {
    0: [...quiet, 1], 1: [0, 2, ...quiet.slice(2)], 2: [1, 1, ...quiet.slice(2)],
  } });
  h.publish(game);
  h.request(0, { kind: 'discard', index: game.players[0].hand.indexOf(1) });
  h.request(1, { kind: 'chi', sequence: [0, 1, 2] });
  assert.equal(h.service.snapshot(h.room, 0).state.actionNotice, null);
  h.request(2, { kind: 'peng' });
  assert.equal(game.players[1].melds.length, 0);
  assertNotice(h, 2, 'peng');
});

test('only executed bot operations publish notices through the same public-state path', async t => {
  const h = harness(t, { bots: true });
  for (const scenario of scenarios()) {
    const game = actionFixture({ ...scenario });
    // Fix only the choice for claims; bot timer and applyAction remain real.
    game._botClaim = player => player === scenario.seat
      ? { action: scenario.action.kind, tiles: scenario.action.sequence } : { action: 'pass' };
    h.publish(game);
    const deadline = Date.now() + 1500;
    while (!h.room.actionNotice) {
      assert.ok(Date.now() < deadline, `bot executes ${scenario.action.kind}/${scenario.action.mode || ''}`);
      if (game.phase.kind === 'claim' && game.getActions(0).pass) h.request(0, { kind: 'pass' });
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    h.service._cancelBot(h.room);
    const kind = ['redGang', 'piziGang'].includes(scenario.action.kind) ? 'gang' : scenario.action.kind;
    assertNotice(h, scenario.seat, kind, kind === 'hu' ? null : 2400);
    assert.ok(h.room.seats[scenario.seat].bot);
  }
});
