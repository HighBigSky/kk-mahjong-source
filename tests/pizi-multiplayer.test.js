import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {assertInvariants} from '../src/domain/invariants.js';
import {TILE, RED_DRAGON} from '../src/domain/tile.js';
import {actionFixture} from './pizi-fixtures.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'four HTTP/SSE clients synchronize'); await sleep(5); }
}

test('four remote clients see real red and indicator kongs at rotated seats, retain private hands and conserve 136 tiles', async t => {
  const service = new RoomService();
  const server = createServer({roomService:service});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const streams = [];
  t.after(async () => {
    for (const stream of streams) stream.controller.abort();
    service.close(); const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed;
  });
  async function api(route, token, body) {
    const response = await fetch(base + route, {method:body ? 'POST' : 'GET', headers:{...(token ? {Authorization:`Bearer ${token}`} : {}), ...(body ? {'Content-Type':'application/json'} : {})}, ...(body ? {body:JSON.stringify(body)} : {})});
    return {status:response.status, data:await response.json()};
  }
  const first = await api('/api/rooms', null, {name:'公开甲', laizi:true});
  const code = first.data.room.code;
  const tokens = [first.data.token];
  for (const name of ['公开乙', '公开丙', '公开丁']) tokens.push((await api(`/api/rooms/${code}/join`, null, {name})).data.token);
  for (const token of tokens) {
    const stream = {controller:new AbortController(), latest:null};
    streams.push(stream);
    const response = await fetch(`${base}/api/rooms/${code}/events?token=${token}`, {signal:stream.controller.signal});
    assert.equal(response.status, 200);
    stream.task = (async () => {
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      try {
        for (;;) {
          const {done, value} = await reader.read(); if (done) return;
          buffer += decoder.decode(value, {stream:true});
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const lines = buffer.slice(0, boundary).split('\n'); buffer = buffer.slice(boundary + 2);
            const data = lines.find(line => line.startsWith('data: '));
            if (data) stream.latest = JSON.parse(data.slice(6));
          }
        }
      } catch (error) { if (!stream.controller.signal.aborted) throw error; }
    })();
  }
  await eventually(() => streams.every(stream => stream.latest));
  const room = service.rooms.get(code);
  await eventually(() => room.seats.every(seat => seat.connected));
  for (const token of tokens) assert.equal((await api(`/api/rooms/${code}/ready`, token, {ready:true})).status, 200);
  assert.equal((await api(`/api/rooms/${code}/start`, tokens[0], {})).status, 200);
  room.game = actionFixture({names:room.seats.map(seat => seat.name)});
  const game = room.game;
  service._changed(room);
  const sync = () => eventually(() => streams.every(stream => stream.latest.room.version >= room.version));
  await sync();
  const beforeIllegal = JSON.stringify(game);
  const illegal = await api(`/api/rooms/${code}/action`, tokens[0], {action:{kind:'discard', index:game.players[0].hand.indexOf(TILE.WHITE)}, version:room.version, requestId:'no-indicator-discard'});
  assert.equal(illegal.status, 409);
  assert.equal(JSON.stringify(game), beforeIllegal);
  const records = [];
  let lastNoticeId = 0;
  for (const kind of ['redGang', 'piziGang']) {
    const tail = game.wall[0]; const wallBefore = game.wall.length; const tailBefore = game.wallInfo.tailDraws;
    assert.equal(game.getActions(0)[kind], true);
    const accepted = await api(`/api/rooms/${code}/action`, tokens[0], {action:{kind}, version:room.version, requestId:`public-${kind}`});
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    const noticeId = accepted.data.state.actionNotice.id;
    assert.ok(noticeId > lastNoticeId);
    lastNoticeId = noticeId;
    await sync();
    assert.equal(game.lastDraw.tile, tail);
    assert.equal(game.wall.length, wallBefore - 1);
    assert.equal(game.wallInfo.tailDraws, tailBefore + 1);
    assertInvariants(game);
    const snapshots = [];
    for (let viewer = 0; viewer < 4; viewer++) {
      const http = await api(`/api/rooms/${code}/state`, tokens[viewer]);
      assert.equal(http.status, 200); snapshots.push(http.data);
      for (const snapshot of [http.data, streams[viewer].latest]) {
        assert.equal(snapshot.state.actionNotice.id, noticeId);
        assert.equal(snapshot.state.actionNotice.player, (4 - viewer) % 4);
        assert.equal(snapshot.state.actionNotice.kind, 'gang');
        assert.ok(snapshot.state.actionNotice.remainingMs > 0 && snapshot.state.actionNotice.remainingMs <= 2400);
        const actor = snapshot.state.players[(4 - viewer) % 4];
        assert.deepEqual(actor.redGangs, [RED_DRAGON]);
        assert.deepEqual(actor.piziGangs, kind === 'piziGang' ? [TILE.WHITE] : []);
        assert.deepEqual(actor.melds, [], 'special kongs do not consume normal meld slots');
        assert.ok(snapshot.state.players[0].hand.every(Number.isInteger));
        assert.ok(snapshot.state.players.slice(1).every(player => player.hand.every(tile => tile === null)));
        assert.equal(Object.hasOwn(snapshot.state, 'wall'), false, 'no concealed wall faces are exposed');
        assert.deepEqual(snapshot.state.wallInfo, game.wallInfo);
      }
    }
    const owned = [
      ...snapshots.flatMap(snapshot => snapshot.state.players[0].hand),
      ...snapshots[0].state.players.flatMap(player => [...player.discards, ...player.redGangs, ...player.piziGangs, ...player.melds.flatMap(meld => meld.tiles)]),
      snapshots[0].state.indicatorTile,
    ];
    assert.equal(owned.length + game.wall.length, 136);
    for (let tile = 0; tile < 34; tile++) assert.ok(owned.filter(code => code === tile).length <= 4);
    records.push({kind, publicSeats:[0, 3, 2, 1], wallBefore, wallAfter:game.wall.length, realTail:true, conservation:136});
  }
  t.diagnostic(JSON.stringify({fixture:'A conserved physical state, followed by two genuine HTTP actions and four SSE/HTTP observations.', actions:records}));
});
