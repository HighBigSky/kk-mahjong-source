import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RoomService} from '../src/server/rooms.js';

class Stream extends EventEmitter {
  writableLength = 0;
  writableEnded = false;
  messages = [];
  writeHead() {}
  write(value) { this.messages.push(value); return true; }
  end() { if (!this.writableEnded) { this.writableEnded = true; this.emit('close'); } }
}
function setup(t, humans = 3) {
  const service = new RoomService({botDelayMs:600000, disconnectGraceMs:1});
  t.after(() => service.close());
  const owner = service.create({name:'房主'}), code = owner.room.code;
  const tokens = [owner.token];
  for (let i = 1; i < humans; i++) tokens.push(service.join(code, {name:`好友${i}`}).token);
  const streams = tokens.map(token => { const stream = new Stream(); service.connect(code, token, stream); return stream; });
  for (let seat = humans; seat < 4; seat++) service.addBot(code, tokens[0], {seat});
  for (const token of tokens) service.ready(code, token, {ready:true});
  service.start(code, tokens[0]);
  return {service, code, tokens, streams, room:service.rooms.get(code)};
}

for (const departing of [0, 1]) test(`active seat ${departing} leaves: abort, revoke identity, reset ready and carry only committed scores`, t => {
  const h = setup(t);
  const previous = h.room.game;
  previous.players.forEach((player, i) => { player.score = [1030,990,990,990][i]; });
  previous.round = 4;
  previous.current = 3; previous.phase = {kind:'discard', seat:3};
  h.service._changed(h.room);
  assert.ok(h.room.botTimer);
  assert.deepEqual(h.service.leave(h.code, h.tokens[departing]), {left:true});
  assert.equal(h.room.game, null);
  assert.equal(h.room.botTimer, null);
  assert.equal(previous.result, null, '不得额外结算荒庄或胡牌');
  assert.equal(h.room.actionNotice, null);
  assert.equal(h.room.owner, departing === 0 ? 1 : 0);
  assert.deepEqual(h.room.seats.map(seat => seat?.ready ?? null), departing === 0 ? [null,false,false,true] : [false,null,false,true]);
  assert.deepEqual(h.room.carry, {round:4, scores:[1030,990,990,990]});
  assert.equal(h.streams[departing].writableEnded, true);
  assert.throws(() => h.service.state(h.code,h.tokens[departing]), error => error.status === 401);
  assert.throws(() => h.service.leave(h.code,h.tokens[departing]), error => error.status === 401);
  const remaining = departing === 0 ? 1 : 0;
  assert.equal(h.service.state(h.code,h.tokens[remaining]).room.status,'waiting');
  assert.match(h.streams[remaining].messages.at(-1), /"status":"waiting"/);
  const replacement = h.service.join(h.code,{name:'新好友'});
  const stream = new Stream(); h.service.connect(h.code,replacement.token,stream);
  for (let seat = 0; seat < 3; seat++) h.service.ready(h.code,seat === departing ? replacement.token : h.tokens[seat],{ready:true});
  const next = h.service.start(h.code,h.tokens[remaining]);
  assert.equal(next.room.status,'playing');
  assert.equal(next.state.round,5);
  assert.deepEqual(h.room.game.players.map(player=>player.score), departing === 0 ? [1000,990,990,990] : [1030,1000,990,990]);
});

test('last human leaving an active bot game disposes room and timers', t => {
  const h = setup(t,1);
  h.service.leave(h.code,h.tokens[0]);
  assert.equal(h.service.rooms.has(h.code),false);
  assert.equal(h.room.botTimer,null);
  assert.equal(h.streams[0].writableEnded,true);
});

test('unintentional disconnect preserves the actual game, score, seat and hand until reconnect', async t => {
  const h = setup(t,2);
  const game = h.room.game, hand = [...game.players[1].hand];
  const before = JSON.stringify(game);
  h.streams[1].end();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(h.service.state(h.code,h.tokens[0]).room.paused,true);
  assert.equal(h.room.seats[1].bot,false);
  const restored = new Stream(); h.service.connect(h.code,h.tokens[1],restored);
  assert.equal(h.room.game,game);
  assert.equal(JSON.stringify(game),before);
  assert.deepEqual(h.service.state(h.code,h.tokens[1]).state.players[0].hand,hand);
  assert.equal(h.service.state(h.code,h.tokens[0]).room.paused,false);
});

test('SSE heartbeat is observable without advancing room version or exposing hands', t => {
  t.mock.timers.enable({apis:['setInterval']});
  const h = setup(t);
  const version = h.room.version;
  t.mock.timers.tick(15000);
  for (const stream of h.streams) assert.equal(stream.messages.at(-1),'event: heartbeat\ndata: {}\n\n');
  assert.equal(h.room.version,version);
});
