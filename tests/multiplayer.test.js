import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../server.js';
import { RoomService } from '../src/server/rooms.js';
import { MahjongGame, chooseDiscard } from '../engine.js';
import { assertInvariants } from '../src/domain/invariants.js';
import { TILE, RED_DRAGON } from '../src/domain/tile.js';
import { previewWall } from './legacy-wall-oracle.mjs';
import { actionFixture } from './pizi-fixtures.mjs';

async function eventually(predicate, message = 'condition', timeout = 3000) {
  const until = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < until, `Timed out waiting for ${message}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function harness(t) {
  const service = new RoomService({ disconnectGraceMs: 30 });
  const server = createServer({ roomService: service });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const streams = [];
  t.after(async () => {
    for (const stream of streams) stream.controller.abort();
    service.close();
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  });
  async function api(route, { token, body, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
    const response = await fetch(base + route, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  async function connect(code, token) {
    const stream = { controller: new AbortController(), states: [], latest: null };
    const response = await fetch(`${base}/api/rooms/${code}/events?token=${token}`, { signal: stream.controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    streams.push(stream);
    stream.task = (async () => {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = block.split('\n').find(line => line.startsWith('data: '));
            if (data) { stream.latest = JSON.parse(data.slice(6)); stream.states.push(stream.latest); }
          }
        }
      } catch (error) {
        if (!stream.controller.signal.aborted) throw error;
      }
    })();
    await eventually(() => stream.latest, 'initial SSE state');
    return stream;
  }
  return { base, service, api, connect };
}

async function fourPlayers(h, { laizi = false } = {}) {
  const names = ['房主甲', '好友乙', '好友丙', '好友丁'];
  const created = await h.api('/api/rooms', { body: { name: names[0], laizi } });
  assert.equal(created.status, 201);
  const code = created.data.room.code;
  assert.match(code, /^\d{6}$/);
  const tokens = [created.data.token];
  for (const name of names.slice(1)) {
    const joined = await h.api(`/api/rooms/${code}/join`, { body: { name } });
    assert.equal(joined.status, 201);
    tokens.push(joined.data.token);
  }
  const streams = [];
  for (const token of tokens) streams.push(await h.connect(code, token));
  await eventually(() => streams.every(stream => stream.latest.room.seats.every(seat => seat.connected)), 'four connected players');
  async function sync(version) {
    await eventually(() => streams.every(stream => stream.latest.room.version >= version), 'broadcast to four independent clients');
  }
  async function request(player, operation, body = {}) {
    const result = await h.api(`/api/rooms/${code}/${operation}`, { token: tokens[player], body });
    if (result.status === 200 && result.data.room) await sync(result.data.room.version);
    return result;
  }
  async function start() {
    for (let player = 0; player < 4; player++) assert.equal((await request(player, 'ready', { ready: true })).status, 200);
    const result = await request(0, 'start');
    assert.equal(result.status, 200);
    return result;
  }
  return { names, code, tokens, streams, sync, request, start, room: h.service.rooms.get(code) };
}

function assertPrivacy(snapshot) {
  assert.equal(snapshot.room.self, 0);
  assert.ok(snapshot.state.players[0].hand.every(Number.isInteger));
  const revealed = snapshot.state.phase.kind === 'ended' && snapshot.state.result?.kind === 'win';
  for (const player of snapshot.state.players.slice(1)) {
    assert.ok(player.hand.every(revealed ? Number.isInteger : tile => tile === null));
  }
  for (const key of ['wall', '_random', '_responses', 'seed']) assert.equal(Object.hasOwn(snapshot.state, key), false, `${key} must remain server-only`);
  assert.ok(snapshot.state.lastDraw === null || snapshot.state.lastDraw.player === 0);
  assert.ok(!JSON.stringify(snapshot).includes('"token"'), 'snapshots must not expose any identity token');
  assert.ok(!snapshot.state.events.some(event => /^你(?:摸|补)到/.test(event)), 'draw events must not expose the dealer private draw');
}

test('friend rooms validate inputs, reject fifth player and isolate identity by room', async t => {
  const h = await harness(t);
  for (const name of ['', '   ', '<img src=x>', '名字超出十二字限制十二字限制']) {
    const result = await h.api('/api/rooms', { body: { name } });
    assert.equal(result.status, 400);
  }
  assert.equal((await h.api('/api/rooms', { body: { name: '好友', laizi: 'yes' } })).status, 400);
  const room = await fourPlayers(h);
  assert.equal(new Set(room.tokens).size, 4);
  assert.equal((await h.api(`/api/rooms/${room.code}/join`, { body: { name: '第五人' } })).status, 409);
  assert.equal((await h.api(`/api/rooms/${room.code}/state`)).status, 401);
  const other = await h.api('/api/rooms', { body: { name: '另一房主' } });
  assert.equal((await h.api(`/api/rooms/${other.data.room.code}/state`, { token: room.tokens[0] })).status, 401);
  assert.equal((await h.api(`/api/rooms/${room.code}/ready`, { token: room.tokens[0], body: { ready: true }, headers: { Origin: 'https://unrelated.invalid' } })).status, 403);
  for (const route of ['/server.js', '/src/server/rooms.js', '/tests/multiplayer.test.js', '/package.json', '/output/material-25d-constraints.json']) {
    assert.equal((await h.api(route)).status, 404, `${route} must not be served`);
  }
});

test('four ready friends start with rotated seats and private hands; actions are authoritative and idempotent', async t => {
  const h = await harness(t);
  const room = await fourPlayers(h);
  assert.equal((await room.request(1, 'start')).status, 403);
  assert.equal((await room.request(0, 'start')).data.code, 'NOT_READY');
  await room.start();
  for (let viewer = 0; viewer < 4; viewer++) {
    const snapshot = room.streams[viewer].latest;
    assertPrivacy(snapshot);
    assert.equal(snapshot.room.owner, (4 - viewer) % 4);
    assert.deepEqual(snapshot.state.players.map(player => player.name), [...room.names.slice(viewer), ...room.names.slice(0, viewer)]);
    assert.deepEqual(snapshot.state.players[0].hand, room.room.game.players[viewer].hand);
    assert.equal(snapshot.state.current, (4 - viewer) % 4);
    assert.equal(snapshot.state.players[0].hand.length, viewer === 0 ? 14 : 13);
  }
  const version = room.room.version;
  const illegal = await room.request(1, 'action', { action: { kind: 'discard', player: 0, index: 0 }, version, requestId: 'not-my-turn' });
  assert.equal(illegal.status, 409);
  assert.equal(illegal.data.code, 'ILLEGAL_ACTION');
  assert.equal(room.room.version, version);
  assert.equal((await room.request(0, 'action', { action: { kind: 'discard', index: -1 }, version, requestId: 'negative' })).status, 409);
  assert.equal((await room.request(0, 'action', { action: { kind: 'unknown' }, version, requestId: 'invalid-kind' })).status, 400);
  assert.equal((await room.request(0, 'action', { action: { kind: 'discard', index: 0 }, version: version - 1, requestId: 'stale' })).data.code, 'STALE_STATE');
  const index = room.room.game.players[0].hand.findIndex(tile => tile !== 31);
  const body = { action: { kind: 'discard', player: 3, index }, version, requestId: 'unique-discard' };
  const accepted = await room.request(0, 'action', body);
  assert.equal(accepted.status, 200, 'submitted player field must not impersonate another seat');
  const after = JSON.stringify(room.room.game);
  const duplicate = await room.request(0, 'action', body);
  assert.equal(duplicate.data.duplicate, true);
  assert.equal(JSON.stringify(room.room.game), after, 'retry must not execute twice');
  assert.equal((await room.request(0, 'action', { ...body, action: { kind: 'pass' } })).data.code, 'REQUEST_ID_REUSED');
  assertInvariants(room.room.game);
  for (const stream of room.streams) for (const snapshot of stream.states.filter(item => item.state)) assertPrivacy(snapshot);
});

test('four remote players receive white indicator and green wild after a red reveal, and the returned red can be konged', async t => {
  const h = await harness(t);
  const room = await fourPlayers(h, { laizi: true });
  await room.start();
  const seed = 'remote-red-indicator-50';
  assert.equal(previewWall(seed).candidate, RED_DRAGON, 'the independent dice-positioned candidate is 红中');
  const game = new MahjongGame({ seed, names: room.names, laizi: true });
  room.room.game = game;
  h.service._changed(room.room);
  await room.sync(room.room.version);
  for (let player = 0; player < 4; player++) {
    const http = await h.api(`/api/rooms/${room.code}/state`, { token: room.tokens[player] });
    assert.equal(http.status, 200);
    for (const snapshot of [http.data, room.streams[player].latest]) {
      assert.equal(snapshot.state.laiziEnabled, true);
      assert.equal(snapshot.state.indicatorTile, TILE.WHITE);
      assert.equal(snapshot.state.wildTile, TILE.GREEN);
      assert.equal(snapshot.state.wallCount, 82);
      assert.deepEqual(snapshot.state.wallInfo, game.wallInfo, 'all seats receive the same public dice and physical indicator slot');
      assertPrivacy(snapshot);
    }
  }
  assert.equal(room.streams[0].latest.state.actions.redGang, true);
  const replacementTile = game.wall[0];
  const wallInfo = structuredClone(game.wallInfo);
  const accepted = await room.request(0, 'action', {
    action: { kind: 'redGang' }, version: room.room.version, requestId: 'returned-red-gang',
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(game.players[0].redGangs, [RED_DRAGON]);
  assert.equal(game.wall.length, 81);
  assert.equal(game.lastDraw.tile, replacementTile, 'the authoritative kong replacement comes from the wall tail');
  assert.deepEqual(game.wallInfo, { ...wallInfo, tailDraws: wallInfo.tailDraws + 1 });
  assertInvariants(game);
  for (let player = 0; player < 4; player++) {
    const stream = room.streams[player];
    assert.equal(stream.latest.state.indicatorTile, TILE.WHITE);
    assert.equal(stream.latest.state.wildTile, TILE.GREEN);
    assert.deepEqual(stream.latest.state.wallInfo, game.wallInfo, 'SSE preserves one shared physical wall state');
    const http = await h.api(`/api/rooms/${room.code}/state`, { token: room.tokens[player] });
    assert.equal(http.status, 200);
    assert.deepEqual(http.data.state.wallInfo, game.wallInfo, 'HTTP refresh preserves the same tail-draw progress');
  }
});

test('multi-player claims wait for every eligible human and preserve hu priority over peng', async t => {
  const h = await harness(t);
  const room = await fourPlayers(h);
  await room.start();
  const game = room.room.game;
  // Player 0 discards two sou: player 1 may peng; the already-open player 2
  // completes a legal 258 pair and retains Hu priority over that peng.
  const hands = [
    [19, 3, 5, 7, 12, 14, 16, 21, 23, 25, 28, 30, 32, 33],
    [19, 19, 4, 6, 8, 13, 15, 17, 20, 22, 24, 28, 29],
    [0, 1, 2, 9, 10, 11, 21, 22, 23, 26, 26, 26, 19],
    [3, 5, 7, 12, 14, 16, 21, 23, 25, 28, 30, 32, 33],
  ];
  const counts = Array(34).fill(4);
  game.indicatorTile = null;
  game.wildTile = null;
  game.laiziEnabled = false;
  game.players.forEach((player, seat) => {
    player.hand = [...hands[seat]].sort((a, b) => a - b);
    player.discards = []; player.melds = []; player.redGangs = [];
    for (const tile of player.hand) assert.ok(--counts[tile] >= 0);
  });
  game.players[2].hand.splice(0, 3);
  game.players[2].melds = [{ kind: 'chi', tiles: [0, 1, 2], from: 1, concealed: false }];
  game.wall = counts.flatMap((count, tile) => Array(count).fill(tile));
  game.current = 0; game.phase = { kind: 'discard', seat: 0 }; game.pendingDiscard = null;
  game.lastDraw = { player: 0, tile: 19, index: game.players[0].hand.indexOf(19), replacement: false };
  game._responses = Array(4).fill(null); game.events = []; game.result = null; game.winner = null;
  h.service._changed(room.room);
  await room.sync(room.room.version);
  assertInvariants(game);
  assert.equal((await room.request(0, 'action', { action: { kind: 'discard', index: game.players[0].hand.indexOf(19) }, version: room.room.version, requestId: 'two-sou' })).status, 200);
  assert.equal(game.phase.kind, 'claim');
  assert.equal(room.streams[1].latest.state.actions.peng, true);
  assert.equal(room.streams[2].latest.state.actions.hu, true);
  assert.equal((await room.request(1, 'action', { action: { kind: 'peng' }, version: room.room.version, requestId: 'peng' })).status, 200);
  assert.equal(game.phase.kind, 'claim', 'peng cannot execute before the winning player responds');
  assert.equal(game.players[1].melds.length, 0);
  assert.equal((await room.request(2, 'action', { action: { kind: 'hu' }, version: room.room.version, requestId: 'hu' })).status, 200);
  assert.equal(game.phase.kind, 'ended');
  assert.equal(game.winner, 2);
  assert.equal(game.players[1].melds.length, 0);
  assertInvariants(game);
});

test('disconnect pauses actions and same-token reconnect recovers seat and hand without AI takeover', async t => {
  const h = await harness(t);
  const room = await fourPlayers(h);
  await room.start();
  const gameBefore = JSON.stringify(room.room.game);
  room.streams[2].controller.abort();
  await eventually(() => !room.room.seats[2].connected, 'disconnect grace expires');
  assert.equal(h.service.state(room.code, room.tokens[0]).room.paused, true);
  const blocked = await room.request(0, 'action', { action: { kind: 'discard', index: 0 }, version: room.room.version, requestId: 'offline-action' });
  assert.equal(blocked.data.code, 'PLAYER_DISCONNECTED');
  assert.equal(JSON.stringify(room.room.game), gameBefore);
  room.streams[2] = await h.connect(room.code, room.tokens[2]);
  await room.sync(room.room.version);
  assert.equal(room.streams[2].latest.room.paused, false);
  assert.equal(room.streams[2].latest.state.players[0].name, room.names[2]);
  assert.deepEqual(room.streams[2].latest.state.players[0].hand, room.room.game.players[2].hand);
  assert.equal(JSON.stringify(room.room.game), gameBefore, 'connection changes must never play a turn');
});

test('a win reveals all four hands over SSE and HTTP, survives reconnect, and hides them again next round', async t => {
  const h = await harness(t);
  const room = await fourPlayers(h, { laizi: true });
  await room.start();
  // A conserved physical fixture, followed by a genuine HTTP Hu action. One
  // public chi also checks that revealed hand counts are not assumed to be 13.
  const winner = 2;
  const game = actionFixture({ seat: winner, names: room.names,
    hand: [9, 10, 11, 18, 19, 20, 24, 25, 26, 4, 4],
    melds: [{ kind: 'chi', tiles: [0, 1, 2], from: 1, concealed: false }] });
  room.room.game = game;
  h.service._changed(room.room);
  await room.sync(room.room.version);

  function checkSnapshot(snapshot, viewer, source, revealed) {
    assertPrivacy(snapshot);
    assert.equal(snapshot.room.seat, viewer);
    for (let relativeSeat = 0; relativeSeat < 4; relativeSeat++) {
      const actual = snapshot.state.players[relativeSeat];
      const physical = source.players[(viewer + relativeSeat) % 4];
      assert.equal(actual.name, physical.name);
      assert.deepEqual(actual.hand, revealed || relativeSeat === 0
        ? physical.hand : Array(physical.hand.length).fill(null),
      `viewer ${viewer}, relative seat ${relativeSeat}, reveal=${revealed}`);
    }
    for (const key of ['wall', 'seed', '_random', '_diceRandom', '_responses']) {
      assert.equal(Object.hasOwn(snapshot.state, key), false, `${key} stays private after hand reveal`);
    }
    for (const token of room.tokens) assert.equal(JSON.stringify(snapshot).includes(token), false);
    assert.equal(snapshot.state.wallCount, source.wall.length);
    if (revealed) {
      assert.equal(snapshot.state.actionNotice.kind, 'hu');
      assert.equal(snapshot.state.actionNotice.player, (winner - viewer + 4) % 4);
      assert.equal(snapshot.state.actionNotice.remainingMs, null);
    } else assert.equal(snapshot.state.actionNotice, null);
    assert.deepEqual(snapshot.state.events, h.service.snapshot(room.room, viewer).state.events);
  }

  async function checkAll(source, revealed) {
    for (let viewer = 0; viewer < 4; viewer++) {
      checkSnapshot(room.streams[viewer].latest, viewer, source, revealed);
      const response = await h.api(`/api/rooms/${room.code}/state`, { token: room.tokens[viewer] });
      assert.equal(response.status, 200);
      checkSnapshot(response.data, viewer, source, revealed);
    }
    assertInvariants(source);
  }

  await checkAll(game, false);
  const won = await room.request(winner, 'action', { action: { kind: 'hu' },
    version: room.room.version, requestId: 'reveal-all-after-hu' });
  assert.equal(won.status, 200);
  assert.equal(game.phase.kind, 'ended');
  assert.equal(game.result.kind, 'win');
  assert.equal(game.result.winner, winner);
  assert.equal(game.players[winner].hand.length, 11);
  checkSnapshot(won.data, winner, game, true);
  const afterHu = JSON.stringify(game);
  await checkAll(game, true);

  const reconnecting = 1;
  room.streams[reconnecting].controller.abort();
  await eventually(() => !room.room.seats[reconnecting].connected, 'post-win disconnect');
  room.streams[reconnecting] = await h.connect(room.code, room.tokens[reconnecting]);
  await room.sync(room.room.version);
  await checkAll(game, true);
  assert.equal(JSON.stringify(game), afterHu, 'snapshot reveal and reconnect never change rules, scores or events');

  const scores = game.players.map(player => player.score);
  const next = await room.request(0, 'next');
  assert.equal(next.status, 200);
  assert.equal(room.room.game.phase.kind, 'discard');
  assert.equal(room.room.game.result, null);
  assert.deepEqual(room.room.game.players.map(player => player.score), scores);
  await checkAll(room.room.game, false);

  // A separate conserved drawn-round fixture retains the old privacy policy.
  const drawn = actionFixture({ names: room.names });
  drawn._finishDraw('亮牌回归用流局状态');
  room.room.game = drawn;
  h.service._changed(room.room);
  await room.sync(room.room.version);
  assert.equal(drawn.phase.kind, 'ended');
  assert.equal(drawn.result.kind, 'draw');
  await checkAll(drawn, false);
  t.diagnostic('Four viewers: live hands hidden; genuine Hu reveals all; SSE/HTTP reconnect retains reveal; next round and draw hide opponents; no wall, seed or token leaked.');
});

test('four HTTP clients finish a seeded round with conserved tiles and exact engine parity, then rotate dealer', async t => {
  const h = await harness(t);
  const room = await fourPlayers(h, { laizi: true });
  await room.start();
  const seed = 'online-four-friends-2026';
  const oracle = new MahjongGame({ seed, names: room.names, laizi: true });
  room.room.game = new MahjongGame({ seed, names: room.names, laizi: true });
  h.service._changed(room.room);
  await room.sync(room.room.version);
  let commands = 0;
  while (oracle.phase.kind !== 'ended' && commands < 500) {
    assertInvariants(room.room.game);
    const player = oracle.phase.kind === 'discard' ? oracle.current : [0, 1, 2, 3].find(seat => oracle.getActions(seat).pass);
    assert.ok(Number.isInteger(player), 'a claim phase must have an eligible human response');
    const snapshot = room.streams[player].latest.state;
    const actions = snapshot.actions;
    let action;
    if (actions.hu) action = { kind: 'hu', selfDraw: snapshot.phase.kind === 'discard' };
    else if (snapshot.phase.kind === 'claim') action = { kind: 'pass' };
    else if (actions.redGang) action = { kind: 'redGang' };
    else if (actions.piziGang) action = { kind: 'piziGang' };
    else if (actions.concealedGangs.length) action = { kind: 'gang', mode: 'concealed', tile: actions.concealedGangs[0] };
    else if (actions.addedGangs.length) action = { kind: 'gang', mode: 'added', tile: actions.addedGangs[0] };
    else {
      const visible = snapshot.players.flatMap(seat => [...seat.discards, ...seat.redGangs, ...seat.piziGangs, ...seat.melds.flatMap(meld => meld.tiles)]);
      action = { kind: 'discard', index: chooseDiscard(snapshot.players[0].hand, snapshot.players[0].melds, visible, snapshot.wildTile, snapshot.indicatorTile) };
    }
    assert.equal(oracle.applyAction(player, { ...action, player }), true);
    const applied = await room.request(player, 'action', { action: { ...action, player: 0 }, version: room.room.version, requestId: `round-${++commands}` });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    assert.deepEqual(room.room.game.events, oracle.events, `events after action ${commands}`);
    assert.deepEqual(room.room.game.players.map(seat => seat.score), oracle.players.map(seat => seat.score));
    const physicalKnown = room.streams.flatMap(stream => stream.latest.state.players[0].hand);
    const publicState = room.streams[0].latest.state;
    physicalKnown.push(...publicState.players.flatMap(seat => [...seat.discards, ...seat.redGangs, ...seat.piziGangs, ...seat.melds.flatMap(meld => meld.tiles)]));
    if (publicState.indicatorTile !== null) physicalKnown.push(publicState.indicatorTile);
    assert.equal(physicalKnown.length + publicState.wallCount, 136);
    assert.ok(Array.from({ length: 34 }, (_, tile) => physicalKnown.filter(value => value === tile).length).every(count => count <= 4));
  }
  assert.ok(commands > 20 && commands < 500);
  assert.equal(room.room.game.phase.kind, 'ended');
  assert.deepEqual(room.room.game.result, oracle.result);
  assertInvariants(room.room.game);
  assert.equal((await room.request(1, 'next')).status, 403);
  const next = await room.request(0, 'next');
  assert.equal(next.status, 200);
  assert.equal(next.data.state.round, 2);
  assert.equal(next.data.state.dealer, 1);
  assert.deepEqual(next.data.state.players.map(seat => seat.score), oracle.players.map(seat => seat.score));
  assertInvariants(room.room.game);
  t.diagnostic(`Four clients completed ${commands} commands; events and scores matched the seeded engine exactly; all 136 tiles conserved after every command.`);
});

test('waiting-room owner can leave, ownership transfers, and departed identity cannot re-enter its old seat', async t => {
  const h = await harness(t);
  const first = await h.api('/api/rooms', { body: { name: '首任房主' } });
  const code = first.data.room.code;
  const second = await h.api(`/api/rooms/${code}/join`, { body: { name: '继任房主' } });
  assert.equal((await h.api(`/api/rooms/${code}/leave`, { token: first.data.token, body: {} })).status, 200);
  assert.equal((await h.api(`/api/rooms/${code}/state`, { token: first.data.token })).status, 401);
  const state = await h.api(`/api/rooms/${code}/state`, { token: second.data.token });
  assert.equal(state.data.room.owner, 0, 'remaining player becomes owner in their rotated view');
  assert.equal(state.data.room.seats[0].name, '继任房主');
  const replacement = await h.api(`/api/rooms/${code}/join`, { body: { name: '新好友' } });
  assert.equal(replacement.status, 201);
  assert.notEqual(replacement.data.token, first.data.token);
  assert.equal(replacement.data.room.owner, 1, 'new arrival does not steal transferred ownership');
  assert.equal((await h.api(`/api/rooms/${code}/start`, { token: replacement.data.token, body: {} })).status, 403);
  await h.api(`/api/rooms/${code}/leave`, { token: replacement.data.token, body: {} });
  await h.api(`/api/rooms/${code}/leave`, { token: second.data.token, body: {} });
  assert.equal(h.service.rooms.has(code), false, 'empty rooms are removed immediately');
  assert.equal((await h.api(`/api/rooms/${code}/state`, { token: second.data.token })).status, 404);
});

test('HTTP room endpoints reject non-JSON, malformed/oversized bodies and do not expose private server files', async t => {
  const h = await harness(t);
  for (const body of ['null', '[]', '"nickname"', '{broken']) {
    const response = await fetch(h.base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_JSON');
  }
  const form = await fetch(h.base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"name":"好友"}' });
  assert.equal(form.status, 415);
  const oversized = await fetch(h.base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '友'.repeat(4000) }) });
  assert.equal(oversized.status, 413);
  for (const route of ['/src/server/rooms.js', '/docs/部署.md', '/tests/ui-multiplayer.mjs', '/.env', '/Dockerfile']) {
    assert.equal((await h.api(route)).status, 404);
  }
  const health = await h.api('/healthz');
  assert.equal(health.status, 200);
  assert.deepEqual(health.data, { ok: true });
});

test('expired in-memory rooms release capacity and invalidate previous identity tokens', t => {
  let now = 1000;
  const service = new RoomService({ now: () => now, roomTtlMs: 100, maxRooms: 1 });
  t.after(() => service.close());
  const first = service.create({ name: '房主' });
  assert.throws(() => service.create({ name: '另一房主' }), error => error.status === 503 && error.code === 'ROOM_LIMIT');
  now = 1101;
  service.cleanup();
  assert.equal(service.rooms.size, 0);
  assert.throws(() => service.state(first.room.code, first.token), error => error.status === 404 && error.code === 'ROOM_NOT_FOUND');
  assert.match(service.create({ name: '新房主' }).room.code, /^\d{6}$/);
});
