import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoomClient} from '../src/network/client.js';

const KEY = 'queqi-room-session';
const identity = {code:'123456',token:'a'.repeat(48)};
const snapshot = (version=1) => ({room:{code:identity.code,version,status:'playing',paused:false},state:{players:[{hand:[1,2,3]}],wallCount:80,phase:{kind:'discard'},actions:{}}});
const flush = async () => { for(let i=0;i<8;i++) await Promise.resolve(); };
function harness(t) {
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  const originals = new Map();
  const replace = (key,value) => { originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key)); Object.defineProperty(globalThis,key,{configurable:true,writable:true,value}); };
  const streams=[], pending=[], errors=[], clients=[];
  const makeStorage = () => { const values=new Map(); return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}; };
  const session=makeStorage(), local=makeStorage(), window=new EventTarget(), document=new EventTarget(), navigator={onLine:true};
  document.visibilityState='visible';
  replace('sessionStorage',session); replace('localStorage',local); replace('window',window); replace('document',document); replace('navigator',navigator);
  replace('EventSource',class {
    constructor(url) { this.url=url; this.listeners=new Map(); this.readyState=0; streams.push(this); }
    addEventListener(kind,callback) {this.listeners.set(kind,callback);}
    close() {this.closed=true; this.readyState=2;}
    emit(value=snapshot(),kind='state') {this.readyState=1; this.listeners.get(kind)?.({data:JSON.stringify(value)});}
  });
  replace('fetch',async (url,options)=>{
    const next=pending.shift(); assert.ok(next,`Unexpected request ${url}`);
    return next(url,options);
  });
  const reply=(data,status=200)=>pending.push(async()=>({ok:status<400,status,json:async()=>data}));
  const create=()=>{const client=createRoomClient({onError:message=>errors.push(message)});clients.push(client);return client;};
  const client=create();
  t.after(()=>{for(const value of clients)value.destroy();for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  return {client,create,streams,pending,reply,errors,session,local,window,document,navigator,
    async enter() {reply({...snapshot(),token:identity.token});await client.create('玩家');streams.at(-1).emit();},
    async fail(status) {if(status)reply({error:'expired'},status);else pending.push(async()=>{throw Error('offline');});streams.at(-1).readyState=2;streams.at(-1).onerror();await flush();},
  };
}

test('closed SSE explicitly reconnects with bounded backoff and resets delay after a real snapshot', async t=>{
  const h=harness(t);await h.enter();
  for(const delay of [500,1000,2000,4000,8000,8000]) {
    await h.fail();const count=h.streams.length;
    t.mock.timers.tick(delay-1);assert.equal(h.streams.length,count);
    t.mock.timers.tick(1);assert.equal(h.streams.length,count+1);
    assert.equal(h.client.status,'reconnecting');
    assert.ok(h.streams.at(-1).url.includes(identity.token));
  }
  h.streams.at(-1).emit(snapshot(2));assert.equal(h.client.status,'connected');
  await h.fail();t.mock.timers.tick(500);assert.equal(h.streams.length,8);
});

test('heartbeat keeps silent games alive; missing heartbeat and initial snapshot restart the stream', async t=>{
  const h=harness(t);await h.enter();
  t.mock.timers.tick(30000);h.streams[0].emit({},'heartbeat');
  t.mock.timers.tick(30000);assert.equal(h.streams.length,1);
  t.mock.timers.tick(15000);assert.equal(h.client.canAct(),false);
  t.mock.timers.tick(500);assert.equal(h.streams.length,2);
  t.mock.timers.tick(12000);t.mock.timers.tick(1000);assert.equal(h.streams.length,3);
});

test('offline, online and suspended-page recovery preserve identity and invalidate stale streams', async t=>{
  const h=harness(t);await h.enter();const old=h.streams[0];
  h.navigator.onLine=false;h.window.dispatchEvent(new Event('offline'));
  assert.equal(h.client.status,'reconnecting');assert.equal(old.closed,true);
  t.mock.timers.tick(60000);assert.equal(h.streams.length,1);
  old.emit(snapshot(8));assert.equal(h.client.room.version,1);
  h.reply(snapshot(2));h.navigator.onLine=true;h.window.dispatchEvent(new Event('online'));await flush();
  assert.equal(h.streams.length,2);assert.equal(h.client.status,'reconnecting','HTTP alone cannot enable play');
  h.streams.at(-1).emit(snapshot(2));assert.equal(h.client.canAct(),true);
  h.document.visibilityState='hidden';t.mock.timers.tick(60000);assert.equal(h.streams.length,2);
  h.reply(snapshot(3));h.document.visibilityState='visible';h.document.dispatchEvent(new Event('visibilitychange'));await flush();
  assert.equal(h.streams.length,3);h.streams.at(-1).emit(snapshot(3));assert.equal(h.client.room.version,3);
});

test('local backup restores closed tabs and transient 502 never discards the original token', async t=>{
  const h=harness(t);await h.enter();h.client.destroy();h.session.removeItem(KEY);
  const restored=h.create();h.reply({error:'gateway'},502);
  assert.equal(await restored.restore(),false);assert.equal(restored.sessionCode(),identity.code);
  assert.deepEqual(JSON.parse(h.session.getItem(KEY)),identity);
  h.streams.at(-1).emit(snapshot(4));assert.equal(restored.status,'connected');
  h.reply({left:true});await restored.leave();
  assert.equal(h.local.getItem(KEY),null);assert.equal(h.session.getItem(KEY),null);
  const count=h.streams.length;t.mock.timers.tick(120000);assert.equal(h.streams.length,count);
});

for(const status of [401,404]) test(`expired identity (${status}) clears saved seat and stops retry`, async t=>{
  const h=harness(t);await h.enter();await h.fail(status);
  assert.equal(h.client.room,null);assert.equal(h.client.sessionCode(),null);
  assert.equal(h.local.getItem(KEY),null);t.mock.timers.tick(60000);assert.equal(h.streams.length,1);
});

test('manual reconnect ignores late validation and snapshots after active leave', async t=>{
  const h=harness(t);await h.enter();let resolve;
  h.pending.push(()=>new Promise(done=>{resolve=done;}));assert.equal(h.client.reconnect(),true);
  const old=h.streams.at(-1);h.reply({left:true});await h.client.leave();
  resolve({ok:true,status:200,json:async()=>snapshot(9)});old.emit(snapshot(10));await flush();
  t.mock.timers.tick(60000);assert.equal(h.client.room,null);assert.equal(h.client.status,'offline');
});

test('failed leave retains credentials and can retry; old tabs cannot erase a newer local room', async t=>{
  const h=harness(t);await h.enter();h.pending.push(async()=>{throw Error('offline');});
  await assert.rejects(h.client.leave(),/offline/);assert.equal(h.client.busy,false);
  assert.equal(h.client.sessionCode(),identity.code);
  const newer={code:'654321',token:'b'.repeat(48)};h.local.setItem(KEY,JSON.stringify(newer));
  h.reply({left:true});assert.equal(await h.client.leave(),true);
  assert.deepEqual(JSON.parse(h.local.getItem(KEY)),newer);assert.equal(h.session.getItem(KEY),null);
});

test('failed leave whose stream closes resumes retry and duplicate leave submits only once', async t=>{
  const h=harness(t);await h.enter();let reject;
  h.pending.push(()=>new Promise((_resolve,fail)=>{reject=fail;}));
  const first=h.client.leave();
  assert.equal(await h.client.leave(),false);
  h.streams[0].readyState=2;h.streams[0].onerror();
  reject(Error('network interrupted'));
  await assert.rejects(first,/network interrupted/);
  assert.equal(h.client.status,'reconnecting');assert.equal(h.client.sessionCode(),identity.code);
  t.mock.timers.tick(500);assert.equal(h.streams.length,2);
});
