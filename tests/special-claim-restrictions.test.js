import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {actionFixture} from './pizi-fixtures.mjs';
import {assertInvariants} from '../src/domain/invariants.js';
import {RED_DRAGON} from '../src/domain/tile.js';

const filler = [9, 11, 13, 15, 17, 18, 20, 22, 24, 26, 28];
const fixture = (hand, discard, indicator = 4) => actionFixture({hand, discard, indicator});
function rejectWithoutMutation(game, action) {
  const before = JSON.stringify(game);
  assert.equal(game.applyAction(0, {player:0, ...action}), false);
  assert.equal(JSON.stringify(game), before, '非法吃碰不得修改手牌、副露、牌墙、分数或响应记录');
  assertInvariants(game);
}

for (const [label, tile, indicator] of [
  ['红中', RED_DRAGON, 4], ['皮子', 4, 4], ['癞子', 5, 4],
  ['皮子同时为红中', RED_DRAGON, RED_DRAGON], ['癞子同时为红中', RED_DRAGON, 30],
]) {
  test(`${label}不能被碰，直接提交碰请求也不生效`, () => {
    const game = fixture([tile, tile, ...filler], tile, indicator);
    assert.equal(game.getActions(0).peng, false);
    assert.deepEqual(game.getActions(0).chi, []);
    rejectWithoutMutation(game, {kind:'peng'});
  });
}

test('别人打出的数牌癞子即使能按原牌面成顺也不能吃', () => {
  const game = fixture([6, 7, ...filler], 5);
  assert.deepEqual(game.getActions(0).chi, []);
  rejectWithoutMutation(game, {kind:'chi', sequence:[5, 6, 7]});
});

test('普通弃牌不能用手中的癞子搭吃，合法的另一组吃牌仍保留', () => {
  const game = fixture([5, 7, 8, ...filler.slice(0, 10)], 6);
  assert.deepEqual(game.getActions(0).chi, [[6, 7, 8]]);
  rejectWithoutMutation(game, {kind:'chi', sequence:[5, 6, 7]});
  assert.equal(game.applyAction(0, {kind:'chi', player:0, sequence:[6, 7, 8]}), true);
  assertInvariants(game);
});

test('手中有三种特殊牌时仍可碰普通牌', () => {
  const game = fixture([9, 9, RED_DRAGON, 4, 5, ...filler.slice(1, 9)], 9);
  assert.equal(game.getActions(0).peng, true);
  assert.equal(game.applyAction(0, {kind:'peng', player:0}), true);
  assertInvariants(game);
});

test('同一数牌不是本局癞子时仍可正常吃碰', () => {
  const peng = fixture([5, 5, ...filler], 5, 33);
  const chi = fixture([6, 7, ...filler], 5, 33);
  assert.equal(peng.getActions(0).peng, true);
  assert.deepEqual(chi.getActions(0).chi, [[5, 6, 7]]);
  assert.equal(peng.applyAction(0, {kind:'peng', player:0}), true);
  assert.equal(chi.applyAction(0, {kind:'chi', player:0, sequence:[5, 6, 7]}), true);
});

test('通用碰东夹具使用普通东，显式白皮夹具仍严格禁止碰东癞', () => {
  const hand = [27, 27, ...filler];
  const ordinary = actionFixture({hand, discard:27});
  assert.notEqual(ordinary.wildTile, 27);
  assert.equal(ordinary.getActions(0).peng, true);
  const wild = actionFixture({hand, discard:27, indicator:33});
  assert.equal(wild.wildTile, 27);
  assert.equal(wild.getActions(0).peng, false);
  rejectWithoutMutation(wild, {kind:'peng'});
});

test('HTTP 状态不开放特殊牌吃碰，伪造请求返回 409 且不产生副露', async t => {
  const service = new RoomService();
  const server = createServer({roomService:service});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    service.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function api(route, token, body) {
    const response = await fetch(base + route, {method:body ? 'POST' : 'GET',
      headers:{...(token ? {Authorization:`Bearer ${token}`} : {}), ...(body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body:JSON.stringify(body)} : {})});
    return {status:response.status, data:await response.json()};
  }
  const first = await api('/api/rooms', null, {name:'吃碰验收'});
  const {token} = first.data;
  const {code} = first.data.room;
  for (let seat=1;seat<4;seat++) await api(`/api/rooms/${code}/join`, null, {name:`玩家${seat}`});
  const room = service.rooms.get(code);
  // 注入守恒的物理牌夹具与在线状态，专门验证 HTTP 命令边界，不模拟整局发牌。
  room.seats.forEach(seat => { seat.connected = true; });
  const cases = [
    ...[RED_DRAGON, 4, 5].map(tile => ({game:fixture([tile, tile, ...filler], tile), action:{kind:'peng'}})),
    {game:fixture([6, 7, ...filler], 5), action:{kind:'chi', sequence:[5, 6, 7]}},
    {game:fixture([5, 6, ...filler], 7), action:{kind:'chi', sequence:[5, 6, 7]}},
  ];
  for (const [index, {game, action}] of cases.entries()) {
    room.game = game;
    const state = await api(`/api/rooms/${code}/state`, token);
    assert.equal(state.status, 200);
    assert.equal(state.data.state.actions.peng, false);
    assert.deepEqual(state.data.state.actions.chi, []);
    const before = JSON.stringify(game), version = room.version;
    for (let repeat=0;repeat<2;repeat++) {
      const result = await api(`/api/rooms/${code}/action`, token, {action, version, requestId:`forbidden-${index}`});
      assert.equal(result.status, 409);
      assert.equal(result.data.code, 'ILLEGAL_ACTION');
      assert.equal(room.version, version);
      assert.equal(room.seats[0].requests.size, 0);
      assert.equal(JSON.stringify(game), before);
    }
    assertInvariants(game);
  }
});
