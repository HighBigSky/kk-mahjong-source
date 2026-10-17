import test from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { RoomService } from '../src/server/rooms.js';
import { createServer } from '../server.js';
import { MahjongGame, chooseDiscard } from '../engine.js';
import { assertInvariants } from '../src/domain/invariants.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(predicate, message, timeout = 5000) {
  const until = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < until, `Timed out waiting for ${message}`);
    await delay(2);
  }
}
class Stream extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writableLength = 0;
  writeHead() {}
  write() { return true; }
  end() { if (!this.writableEnded) { this.writableEnded = true; this.emit('close'); } }
  destroy() { this.destroyed = true; this.end(); }
}
function roomHarness(t, { humans = 1, ...options } = {}) {
  const service = new RoomService({ botDelayMs: 1, disconnectGraceMs: 1, ...options });
  t.after(() => service.close());
  const owner = service.create({ name: '房主' });
  const code = owner.room.code;
  const tokens = [owner.token];
  for (let seat = 1; seat < humans; seat++) tokens.push(service.join(code, { name: `好友${seat}` }).token);
  const streams = tokens.map(token => { const stream = new Stream(); service.connect(code, token, stream); return stream; });
  for (let seat = humans; seat < 4; seat++) service.addBot(code, owner.token, { seat });
  const room = service.rooms.get(code);
  let sequence = 0;
  const request = (player, action) => service.action(code, tokens[player], { action, version: room.version, requestId: `human-${++sequence}` });
  const start = () => {
    for (const token of tokens) service.ready(code, token, { ready: true });
    return service.start(code, owner.token);
  };
  return { service, code, room, tokens, streams, start, request };
}
function humanAction(game, player) {
  const actions = game.getActions(player);
  if (actions.hu) return { kind: 'hu' };
  if (game.phase.kind === 'claim') return { kind: 'pass' };
  if (actions.redGang) return { kind: 'redGang' };
  if (actions.piziGang) return { kind: 'piziGang' };
  if (actions.concealedGangs.length) return { kind: 'gang', mode: 'concealed', tile: actions.concealedGangs[0] };
  if (actions.addedGangs.length) return { kind: 'gang', mode: 'added', tile: actions.addedGangs[0] };
  return { kind: 'discard', index: chooseDiscard(game.players[player].hand, game.players[player].melds, game._visibleTiles(), game.wildTile, game.indicatorTile) };
}

test('HTTP bot endpoints validate owner and seats, cannot remove humans, and never expose a usable bot identity', async t => {
  const service = new RoomService();
  const server = createServer({ roomService: service });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { service.close(); const done = once(server, 'close'); server.close(); server.closeAllConnections(); await done; });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(path, body, token) {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  const owner = (await post('/api/rooms', { name: '房主' })).data;
  const code = owner.room.code, route = `/api/rooms/${code}`;
  const friend = (await post(`${route}/join`, { name: '真人' })).data;
  assert.equal((await post(`${route}/addBot`, { seat: 2 })).status, 401);
  assert.equal((await post(`${route}/addBot`, { seat: 2 }, friend.token)).status, 403);
  for (const seat of [-1, 4, 1.2, '2', null, undefined]) assert.equal((await post(`${route}/addBot`, { seat }, owner.token)).data.code, 'INVALID_SEAT');
  assert.equal((await post(`${route}/addBot`, { seat: 1 }, owner.token)).data.code, 'SEAT_OCCUPIED');
  assert.equal((await post(`${route}/removeBot`, { seat: 1 }, owner.token)).data.code, 'NOT_BOT');
  assert.equal((await post(`${route}/removeBot`, { seat: 2 }, owner.token)).data.code, 'NOT_BOT');
  const added = await post(`${route}/addBot`, { seat: 2 }, owner.token);
  assert.equal(added.status, 200);
  assert.deepEqual(added.data.room.seats[2], { name: '人机3', occupied: true, connected: true, voice: false, ready: true, bot: true });
  assert.equal(JSON.stringify(added.data).includes('token'), false);
  assert.equal(service.rooms.get(code).seats[2].token, null);
  assert.throws(() => service.authenticate(code, '0'.repeat(48)), error => error.code === 'UNAUTHORIZED');
  assert.equal((await post(`${route}/removeBot`, { seat: 2 }, friend.token)).status, 403);
  assert.equal((await post(`${route}/removeBot`, { seat: 2 }, owner.token)).status, 200);
  await post(`${route}/addBot`, { seat: 2 }, owner.token);
  await post(`${route}/addBot`, { seat: 3 }, owner.token);
  assert.equal((await post(`${route}/join`, { name: '第五人' })).data.code, 'ROOM_FULL');
});

test('bots count toward four ready seats; only the waiting room permits bot edits', t => {
  const h = roomHarness(t);
  const started = h.start();
  assert.equal(started.room.status, 'playing');
  assert.ok(started.room.seats.slice(1).every(seat => seat.bot && seat.ready && seat.connected));
  for (const operation of ['addBot', 'removeBot']) assert.throws(() => h.service[operation](h.code, h.tokens[0], { seat: 1 }), error => error.code === 'ALREADY_STARTED');
  h.room.game._finishDraw(); h.service._changed(h.room);
  assert.throws(() => h.service.removeBot(h.code, h.tokens[0], { seat: 1 }), error => error.code === 'ALREADY_STARTED');
  const next = h.service.next(h.code, h.tokens[0]);
  assert.equal(next.state.round, 2);
  assert.equal(next.state.current, 1, 'the next round may begin with a bot dealer');
  assert.ok(h.room.botTimer);
});

for (const humans of [1, 2]) test(`${humans} human(s) and ${4 - humans} bots finish a seeded round with exact rule parity and tile conservation`, async t => {
  const h = roomHarness(t, { humans });
  h.start();
  const seed = `mixed-room-${humans}-2026`;
  const options = { seed, laizi: true, names: h.room.seats.map(seat => seat.name) };
  const game = h.room.game = new MahjongGame(options);
  const oracle = new MahjongGame(options);
  let commands = 0, botCommands = 0;
  const apply = game.applyAction.bind(game);
  game.applyAction = (player, action) => {
    const accepted = apply(player, action);
    if (accepted) {
      commands++; if (h.room.seats[player].bot) botCommands++;
      assert.ok(commands < 600, 'game must make progress');
      assert.equal(oracle.applyAction(player, action), true);
      assertInvariants(game);
      assert.deepEqual(game.events, oracle.events, `events after command ${commands}`);
      assert.deepEqual(game.players.map(seat => seat.score), oracle.players.map(seat => seat.score));
    }
    return accepted;
  };
  h.service._changed(h.room);
  const deadline = Date.now() + 15000;
  while (game.phase.kind !== 'ended') {
    assert.ok(Date.now() < deadline, 'mixed room must complete without a stalled scheduler');
    if (game.phase.kind === 'discard' && !h.room.seats[game.current].bot) h.request(game.current, humanAction(game, game.current));
    else if (game.phase.kind === 'claim') {
      for (let player = 0; player < humans && game.phase.kind === 'claim'; player++) if (game.getActions(player).pass) h.request(player, humanAction(game, player));
    }
    await delay(1);
  }
  assert.ok(botCommands > 5);
  assert.deepEqual(game.result, oracle.result);
  assertInvariants(game);
  assert.equal(h.room.botTimer, null);
  t.diagnostic(`${humans} human(s): ${commands} commands, ${botCommands} bot commands, ${game.events.length} events matched the unchanged engine; all 136 tiles conserved at every action.`);
});

test('bot claims follow discard distance and wait for eligible human responses with hu priority intact', async t => {
  const h = roomHarness(t, { humans: 2, botDelayMs: 5 });
  // Put the second human at seat 2 so the bot at seat 1 answers first.
  [h.room.seats[1], h.room.seats[2]] = [h.room.seats[2], h.room.seats[1]];
  h.start();
  const game = h.room.game;
  const hands = [
    [19, 3, 5, 7, 12, 14, 16, 21, 23, 25, 28, 30, 32, 33],
    [19, 19, 4, 6, 8, 13, 15, 17, 20, 22, 24, 28, 29],
    [0, 1, 2, 9, 10, 11, 21, 22, 23, 26, 26, 26, 19],
    [3, 5, 7, 12, 14, 16, 21, 23, 25, 28, 30, 32, 33],
  ];
  const counts = Array(34).fill(4);
  game.indicatorTile = null; game.wildTile = null; game.laiziEnabled = false;
  game.players.forEach((player, seat) => { player.hand = [...hands[seat]].sort((a, b) => a - b); player.discards = []; player.melds = []; player.redGangs = []; for (const tile of player.hand) assert.ok(--counts[tile] >= 0); });
  game.players[2].hand.splice(0, 3);
  game.players[2].melds = [{ kind: 'chi', tiles: [0, 1, 2], from: 1, concealed: false }];
  game.wall = counts.flatMap((count, tile) => Array(count).fill(tile));
  game.current = 0; game.phase = { kind: 'discard', seat: 0 }; game.pendingDiscard = null; game.lastDraw = { player: 0, tile: 19, index: game.players[0].hand.indexOf(19), replacement: false };
  game._responses = Array(4).fill(null); game.events = []; game.result = null; game.winner = null;
  h.service._changed(h.room);
  const answered = [], original = game._botClaim.bind(game);
  game._botClaim = (player, actions) => { answered.push(player); return original(player, actions); };
  h.request(0, { kind: 'discard', index: game.players[0].hand.indexOf(19) });
  await eventually(() => game._responses[1], 'bot response');
  assert.deepEqual(answered, [1]);
  assert.equal(game._responses[1].action, 'peng', 'the lower-priority bot claim is actually pending');
  assert.equal(game.phase.kind, 'claim', 'the bot must wait for the human win decision');
  assert.equal(game.players[1].melds.length, 0);
  assert.equal(h.room.botTimer, null, 'no bot should be rescheduled while waiting for the human');
  assert.equal(game.getActions(2).hu, true);
  h.request(1, { kind: 'hu' });
  assert.equal(game.phase.kind, 'ended'); assert.equal(game.winner, 2);
  assert.equal(game.players[1].melds.length, 0);
  assertInvariants(game);
});

test('human disconnect cancels one pending bot timer; reconnect resumes without duplicate scheduling', async t => {
  const h = roomHarness(t, { botDelayMs: 60, disconnectGraceMs: 1 });
  h.start();
  h.room.game.newRound(); // Seat 1 is now the bot dealer.
  h.service._changed(h.room);
  const timer = h.room.botTimer;
  assert.ok(timer);
  for (let index = 0; index < 10; index++) h.service._changed(h.room);
  assert.equal(h.room.botTimer, timer, 'updates reuse a single pending timer');
  h.streams[0].end();
  await eventually(() => !h.room.seats[0].connected, 'human disconnected');
  assert.equal(h.room.botTimer, null);
  const before = JSON.stringify(h.room.game);
  await delay(100);
  assert.equal(JSON.stringify(h.room.game), before, 'no bot action occurs during disconnect');
  h.service.connect(h.code, h.tokens[0], new Stream());
  assert.ok(h.room.botTimer);
  await eventually(() => JSON.stringify(h.room.game) !== before, 'bot resumes after reconnection');
  assertInvariants(h.room.game);
  h.room.game._finishDraw(); h.service._changed(h.room);
  assert.equal(h.room.botTimer, null);
  const ended = JSON.stringify(h.room.game);
  await delay(90);
  assert.equal(JSON.stringify(h.room.game), ended, 'ended games cannot continue scheduling bots');
});

test('ownership transfers only to humans; ended reset keeps bots ready and last human departure destroys bot rooms', t => {
  const h = roomHarness(t, { humans: 2, botDelayMs: 1000 });
  [h.room.seats[1], h.room.seats[2]] = [h.room.seats[2], h.room.seats[1]];
  h.start();
  h.room.game._finishDraw(); h.service._changed(h.room);
  h.service.leave(h.code, h.tokens[0]);
  assert.equal(h.room.owner, 2, 'the bot at seat 1 cannot inherit ownership');
  assert.equal(h.room.game, null);
  assert.equal(h.room.seats[2].ready, false);
  assert.equal(h.room.seats[1].ready, true); assert.equal(h.room.seats[3].ready, true);
  h.service.leave(h.code, h.tokens[1]);
  assert.equal(h.service.rooms.has(h.code), false, 'rooms without humans are removed even when bots remain');
  assert.equal(h.room.botTimer, null);
});

test('room disposal and service close release pending bot timers', async t => {
  const h = roomHarness(t, { botDelayMs: 25 });
  h.start(); h.room.game.newRound(); h.service._changed(h.room);
  assert.ok(h.room.botTimer);
  const before = JSON.stringify(h.room.game);
  h.service.close();
  assert.equal(h.room.botTimer, null); assert.equal(h.service.rooms.size, 0);
  await delay(60);
  assert.equal(JSON.stringify(h.room.game), before);
});
