import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createHmac } from 'node:crypto';
import { RoomService } from '../src/server/rooms.js';
import { createServer } from '../server.js';
import { createVoiceIceConfig } from '../src/server/voice.js';

class Stream extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.writableEnded = false;
    this.writableLength = 0;
    this.chunks = [];
  }
  writeHead() {}
  flushHeaders() {}
  write(chunk) { this.chunks.push(String(chunk)); return true; }
  end() {
    if (this.writableEnded) return;
    this.writableEnded = true;
    this.emit('close');
  }
  destroy() { this.destroyed = true; this.end(); }
}

function signalPayload(stream) {
  const block = stream.chunks.join('').split('\n\n').filter(item => item.startsWith('event: signal')).at(-1);
  assert.ok(block, 'target stream must receive a signal event');
  const data = block.split('\n').find(line => line.startsWith('data: '));
  assert.ok(data, 'signal event must contain data');
  return JSON.parse(data.slice(6));
}

test('voice ICE configuration supports STUN, coturn short-lived credentials and static TURN credentials', () => {
  const stun = createVoiceIceConfig({ STUN_URL: 'stun:a.example:3478, stun:b.example:3478' })();
  assert.deepEqual(stun, [{ urls: ['stun:a.example:3478', 'stun:b.example:3478'] }]);

  const dynamic = createVoiceIceConfig({
    TURN_URL: 'turn:turn.example:3478?transport=udp',
    TURN_SECRET: 'shared-secret',
    TURN_TTL_SECONDS: '600',
  })();
  assert.equal(dynamic.length, 2);
  assert.deepEqual(dynamic[1].urls, ['turn:turn.example:3478?transport=udp']);
  assert.match(dynamic[1].username, /^\d+:[a-f0-9]+$/);
  assert.equal(dynamic[1].credential, createHmac('sha1', 'shared-secret').update(dynamic[1].username).digest('base64'));
  const expiresAt = Number(dynamic[1].username.split(':')[0]);
  assert.ok(expiresAt >= Math.floor(Date.now() / 1000) + 500);

  const fixed = createVoiceIceConfig({
    TURN_URL: 'turns:turn.example:5349',
    TURN_USERNAME: 'player',
    TURN_CREDENTIAL: 'password',
  })();
  assert.deepEqual(fixed[1], { urls: ['turns:turn.example:5349'], username: 'player', credential: 'password' });
});

test('voice presence is isolated to seats and SDP/ICE signals reach only the requested voice seat', t => {
  const service = new RoomService({ iceServers: () => [{ urls: ['stun:test.example'] }] });
  t.after(() => service.close());
  const owner = service.create({ name: '房主' });
  const guest = service.join(owner.room.code, { name: '好友' });
  const ownerStream = new Stream();
  const guestStream = new Stream();
  service.connect(owner.room.code, owner.token, ownerStream);
  service.connect(owner.room.code, guest.token, guestStream);

  assert.deepEqual(service.voiceConfig(owner.room.code, owner.token), { iceServers: [{ urls: ['stun:test.example'] }] });
  assert.equal(service.state(owner.room.code, owner.token).room.seats[0].voice, false);
  assert.equal(service.setVoice(owner.room.code, owner.token, { enabled: true }).room.seats[0].voice, true);
  assert.equal(service.setVoice(owner.room.code, guest.token, { enabled: true }).room.seats[0].voice, true);

  const version = service.rooms.get(owner.room.code).version;
  assert.deepEqual(service.signal(owner.room.code, owner.token, {
    to: 1,
    description: { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' },
  }), { sent: true });
  const offer = signalPayload(guestStream);
  assert.equal(offer.from, 3, 'owner is three seats behind the guest in the guest view');
  assert.equal(offer.description.type, 'offer');
  assert.match(offer.description.sdp, /^v=0/);
  assert.equal(service.rooms.get(owner.room.code).version, version, 'signaling must not change the room version');

  assert.deepEqual(service.signal(owner.room.code, owner.token, {
    to: 1,
    candidate: { candidate: 'candidate:1 1 udp 2122260223 192.0.2.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 },
  }), { sent: true });
  const candidate = signalPayload(guestStream);
  assert.equal(candidate.from, 3);
  assert.equal(candidate.candidate.sdpMid, '0');
  assert.equal(candidate.candidate.sdpMLineIndex, 0);

  assert.throws(() => service.signal(owner.room.code, owner.token, { to: 0, description: { type: 'offer', sdp: 'v=0' } }),
    error => error.code === 'INVALID_SIGNAL_TARGET');
  assert.throws(() => service.signal(owner.room.code, owner.token, { to: 1, description: { type: 'offer', sdp: 'x'.repeat(20001) } }),
    error => error.code === 'INVALID_SIGNAL');

  service.setVoice(owner.room.code, guest.token, { enabled: false });
  assert.throws(() => service.signal(owner.room.code, owner.token, { to: 1, description: { type: 'offer', sdp: 'v=0' } }),
    error => error.code === 'VOICE_OFF');
});

test('a disconnected voice seat is cleared after the grace period and the HTTP voice endpoints stay authenticated', async t => {
  const service = new RoomService({ disconnectGraceMs: 15, iceServers: () => [{ urls: ['stun:test.example'] }] });
  const server = createServer({ roomService: service });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    service.close();
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  });

  const created = await (await fetch(`${base}/api/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '语音房主' }),
  })).json();
  const code = created.room.code;
  const configResponse = await fetch(`${base}/api/rooms/${code}/voice`, { headers: { Authorization: `Bearer ${created.token}` } });
  assert.equal(configResponse.status, 200);
  assert.deepEqual((await configResponse.json()).iceServers, [{ urls: ['stun:test.example'] }]);

  const stream = new Stream();
  service.connect(code, created.token, stream);
  const voiceResponse = await fetch(`${base}/api/rooms/${code}/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.token}` },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(voiceResponse.status, 200);
  assert.equal(service.rooms.get(code).seats[0].voice, true);

  stream.end();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(service.rooms.get(code).seats[0].connected, false);
  assert.equal(service.rooms.get(code).seats[0].voice, false);
});
