import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once, EventEmitter } from 'node:events';
import { createServer } from '../server.js';
import { RoomService } from '../src/server/rooms.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function harness(t) {
  const service = new RoomService();
  const server = createServer({ roomService: service });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    service.close();
    const closed = once(server, 'close');
    server.close(); server.closeAllConnections();
    await closed;
  });
  async function raw(path, chunks, headers = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(text) }));
      });
      request.on('error', reject);
      (async () => {
        for (const chunk of chunks) { request.write(chunk); await delay(2); }
        request.end();
      })().catch(reject);
    });
  }
  return { service, base, raw };
}

class Stream extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writableLength = 0;
  messages = [];
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  write(message) { this.messages.push(message); return true; }
  end() { if (!this.writableEnded) { this.writableEnded = true; this.emit('close'); } }
  destroy() { this.destroyed = true; this.end(); }
}

test('HTTP JSON preserves multibyte nicknames across incoming network chunks', async t => {
  const h = await harness(t);
  const encoded = Buffer.from(JSON.stringify({ name: '麻将好友' }));
  const split = encoded.indexOf(Buffer.from('麻')) + 1;
  const response = await h.raw('/api/rooms', [encoded.subarray(0, split), encoded.subarray(split)]);
  assert.equal(response.status, 201);
  assert.equal(response.data.room.seats[0].name, '麻将好友');
});

test('HTTP rejects oversized and malformed input and remains available afterward', async t => {
  const h = await harness(t);
  for (const body of ['[]', 'null', '{broken']) {
    const response = await h.raw('/api/rooms', [body]);
    assert.equal(response.status, 400);
    assert.equal(response.data.code, 'INVALID_JSON');
  }
  const oversized = await h.raw('/api/rooms', [JSON.stringify({ name: '甲', padding: 'x'.repeat(9000) })]);
  assert.equal(oversized.status, 413);
  assert.equal(oversized.data.code, 'TOO_LARGE');
  const contentType = await h.raw('/api/rooms', ['{}'], { 'Content-Type': 'text/plain' });
  assert.equal(contentType.status, 415);
  const invalidUrl = await fetch(h.base + '/%ZZ');
  assert.equal(invalidUrl.status, 400);
  assert.equal((await invalidUrl.json()).code, 'INVALID_URL');
  assert.equal((await fetch(h.base + '/healthz')).status, 200);
  assert.equal(h.service.rooms.size, 0);
});

test('room creation has its own bounded budget without blocking ordinary room state', async t => {
  const h = await harness(t);
  let identity;
  for (let index = 0; index < 30; index++) {
    const response = await h.raw('/api/rooms', [JSON.stringify({ name: '好友' })]);
    assert.equal(response.status, 201);
    identity ||= response.data;
  }
  const limited = await h.raw('/api/rooms', [JSON.stringify({ name: '好友' })]);
  assert.equal(limited.status, 429);
  assert.equal(limited.data.code, 'RATE_LIMITED');
  assert.equal(h.service.rooms.size, 30);
  const state = await fetch(`${h.base}/api/rooms/${identity.room.code}/state`, { headers: { Authorization: `Bearer ${identity.token}` } });
  assert.equal(state.status, 200);
});

test('an expired identity cannot revive a room between cleanup ticks', t => {
  let now = 0;
  const service = new RoomService({ now: () => now, roomTtlMs: 100 });
  t.after(() => service.close());
  const created = service.create({ name: '房主' });
  const stream = new Stream();
  service.connect(created.room.code, created.token, stream);
  const seat = service.rooms.get(created.room.code).seats[0];
  now = 101;
  assert.throws(() => service.state(created.room.code, created.token), error => error.code === 'ROOM_NOT_FOUND');
  assert.equal(service.rooms.size, 0);
  assert.equal(stream.writableEnded, true);
  assert.equal(seat.streams.size, 0);
  assert.equal(seat.connected, false);
});

test('leaving revokes the former seat and transfers ownership without exposing tokens', t => {
  const service = new RoomService();
  t.after(() => service.close());
  const owner = service.create({ name: '房主' });
  const code = owner.room.code;
  const friend = service.join(code, { name: '好友' });
  const stream = new Stream();
  service.connect(code, owner.token, stream);
  assert.deepEqual(service.leave(code, owner.token), { left: true });
  assert.equal(stream.writableEnded, true);
  assert.throws(() => service.state(code, owner.token), error => error.code === 'UNAUTHORIZED');
  const view = service.state(code, friend.token);
  assert.equal(view.room.owner, 0);
  assert.equal(view.room.seat, 1);
  assert.equal(JSON.stringify(view).includes(friend.token), false);
  const replacement = service.join(code, { name: '房主' });
  assert.notEqual(replacement.token, owner.token);
  assert.equal(service.rooms.get(code).owner, 1, 'a matching nickname cannot take ownership back');
  service.leave(code, replacement.token);
  service.leave(code, friend.token);
  assert.equal(service.rooms.size, 0);
});

test('short reconnect preserves presence and stream replacement stays bounded', async t => {
  const service = new RoomService({ disconnectGraceMs: 50 });
  t.after(() => service.close());
  const owner = service.create({ name: '房主' });
  const code = owner.room.code;
  const stream = new Stream();
  service.connect(code, owner.token, stream);
  const room = service.rooms.get(code);
  const connectedVersion = room.version;
  stream.end();
  await delay(5);
  const recovered = new Stream();
  service.connect(code, owner.token, recovered);
  await delay(70);
  assert.equal(room.seats[0].connected, true);
  assert.equal(room.version, connectedVersion, 'a reconnect within the grace period must not generate offline/online changes');
  const second = new Stream();
  const third = new Stream();
  service.connect(code, owner.token, second);
  service.connect(code, owner.token, third);
  assert.equal(recovered.writableEnded, true);
  assert.equal(room.seats[0].streams.size, 2);
  service.close();
  assert.equal(second.writableEnded, true);
  assert.equal(third.writableEnded, true);
  assert.equal(room.seats[0].streams.size, 0);
  assert.equal(service.rooms.size, 0);
});

test('slow state consumers are disconnected instead of accumulating snapshots', t => {
  const service = new RoomService();
  t.after(() => service.close());
  const owner = service.create({ name: '房主' });
  const stream = new Stream();
  service.connect(owner.room.code, owner.token, stream);
  stream.writableLength = 262145;
  service.ready(owner.room.code, owner.token, { ready: true });
  assert.equal(stream.destroyed, true);
  assert.equal(stream.writableEnded, true);
});
