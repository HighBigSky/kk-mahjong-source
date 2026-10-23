import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {RoomService} from '../src/server/rooms.js';

const TEN_MINUTES = 600000;
class Stream extends EventEmitter {
  writableLength = 0;
  writableEnded = false;
  writeHead() {}
  write() { return true; }
  end() { if (!this.writableEnded) { this.writableEnded = true; this.emit('close'); } }
}
function setup(t, {playing = true, humans = 2, now = () => Date.now()} = {}) {
  t.mock.timers.enable({apis:['Date', 'setTimeout', 'setInterval'], now:1000000});
  const service = new RoomService({now, botDelayMs:TEN_MINUTES * 3});
  t.after(() => service.close());
  const owner = service.create({name:'房主'}), code = owner.room.code;
  const tokens = [owner.token];
  for (let i = 1; i < humans; i++) tokens.push(service.join(code,{name:`好友${i}`}).token);
  const connect = index => { const stream = new Stream(); service.connect(code,tokens[index],stream); return stream; };
  const streams = tokens.map((_, index) => connect(index));
  if (playing) {
    for (let seat = humans; seat < 4; seat++) service.addBot(code,tokens[0],{seat});
    for (const token of tokens) service.ready(code,token,{ready:true});
    service.start(code,tokens[0]);
  }
  return {service, code, tokens, streams, connect, room:service.rooms.get(code)};
}
function missing(h, operation = () => h.service.state(h.code,h.tokens[0])) {
  assert.throws(operation, error => error.status === 404 && error.code === 'ROOM_NOT_FOUND');
  assert.equal(h.service.rooms.has(h.code),false);
}

for (const playing of [true, false]) test(`${playing ? 'playing' : 'waiting'} room survives 599999ms but dissolves at 600000ms despite other players remaining online`, t => {
  const h = setup(t,{playing});
  assert.equal(h.service.reconnectTimeoutMs,TEN_MINUTES);
  h.streams[1].end();
  const deadline = h.room.seats[1].reconnectDeadline;
  t.mock.timers.tick(599999);
  const state = h.service.state(h.code,h.tokens[0]);
  assert.equal(state.room.paused,playing);
  assert.equal(h.room.seats[1].reconnectDeadline,deadline);
  t.mock.timers.tick(1);
  missing(h);
  assert.equal(h.streams[0].writableEnded,true);
  assert.equal(h.room.botTimer,null);
  for (const seat of h.room.seats.filter(Boolean)) {
    assert.equal(seat.reconnectTimer,null);
    assert.equal(seat.disconnectTimer,null);
    assert.equal(seat.reconnectDeadline,null);
    assert.equal(seat.streams.size,0);
  }
});

test('reconnect before deadline retains identical game, hand and scores and cancels expiry; a later drop gets a fresh deadline', t => {
  const h = setup(t), game = h.room.game, before = JSON.stringify(game);
  h.streams[1].end();
  t.mock.timers.tick(599999);
  const restored = h.connect(1);
  assert.equal(h.room.seats[1].reconnectTimer,null);
  assert.equal(h.room.seats[1].reconnectDeadline,null);
  assert.equal(h.service.state(h.code,h.tokens[0]).room.paused,false);
  t.mock.timers.tick(TEN_MINUTES);
  assert.equal(h.room.game,game);
  assert.equal(JSON.stringify(game),before);
  restored.end();
  t.mock.timers.tick(599999);
  assert.ok(h.service.rooms.has(h.code));
  t.mock.timers.tick(1);
  missing(h);
});

test('one reconnect cannot extend another disconnected player deadline', t => {
  const h = setup(t,{humans:3});
  h.streams[1].end();
  t.mock.timers.tick(100000);
  h.streams[2].end();
  t.mock.timers.tick(100000);
  h.connect(2);
  t.mock.timers.tick(399999);
  assert.ok(h.service.rooms.has(h.code));
  t.mock.timers.tick(1);
  missing(h);
});

test('closing one tab does not start expiry while another stream for the same seat is alive', t => {
  const h = setup(t), second = h.connect(1);
  h.streams[1].end();
  t.mock.timers.tick(TEN_MINUTES + 1);
  assert.equal(h.room.seats[1].reconnectDeadline,null);
  assert.equal(h.service.state(h.code,h.tokens[0]).room.paused,false);
  second.end();
  t.mock.timers.tick(TEN_MINUTES);
  missing(h);
});

test('brief drop inside grace cancels both timers without pausing or changing game', t => {
  const h = setup(t), game = h.room.game;
  h.streams[1].end();
  t.mock.timers.tick(1000);
  h.connect(1);
  t.mock.timers.tick(TEN_MINUTES);
  assert.equal(h.room.game,game);
  assert.equal(h.service.state(h.code,h.tokens[0]).room.paused,false);
});

for (const operation of ['connect', 'join', 'state', 'cleanup']) test(`deadline cannot be bypassed by ${operation} when timer callback is delayed`, t => {
  let now = 2000000;
  const h = setup(t,{playing:false, now:() => now});
  h.streams[1].end();
  now += TEN_MINUTES;
  if (operation === 'cleanup') { h.service.cleanup(); missing(h); }
  else missing(h, () => operation === 'connect' ? h.connect(1)
    : operation === 'join' ? h.service.join(h.code,{name:'新好友'}) : h.service.state(h.code,h.tokens[0]));
});

for (const operation of ['leave', 'removePlayer']) test(`${operation} clears the departed seat expiry and preserves the remaining room`, t => {
  const h = setup(t,{playing:operation === 'leave'}), seat = h.room.seats[1];
  h.streams[1].end();
  t.mock.timers.tick(5000);
  if (operation === 'leave') h.service.leave(h.code,h.tokens[1]);
  else h.service.removePlayer(h.code,h.tokens[0],{seat:1});
  assert.equal(seat.reconnectDeadline,null);
  assert.equal(seat.reconnectTimer,null);
  assert.equal(h.room.seats[1],null);
  t.mock.timers.tick(TEN_MINUTES);
  assert.equal(h.service.state(h.code,h.tokens[0]).room.status,'waiting');
});
