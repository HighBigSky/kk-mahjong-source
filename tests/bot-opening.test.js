import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {RoomService} from '../src/server/rooms.js';
import {MahjongGame} from '../engine.js';
import {createServer} from '../server.js';
import {assertInvariants} from '../src/domain/invariants.js';

class Stream extends EventEmitter {
  writableLength=0;writableEnded=false;states=[];
  writeHead(){}write(value){const match=/^event: state\ndata: (.+)\n\n$/.exec(value);if(match)this.states.push(JSON.parse(match[1]));return true;}
  end(){if(!this.writableEnded){this.writableEnded=true;this.emit('close');}}
}
function makeRoom(service,humans=1){
 const owner=service.create({name:'开局审核',laizi:false}),code=owner.room.code,tokens=[owner.token];
 for(let i=1;i<humans;i++)tokens.push(service.join(code,{name:'好友'+i}).token);
 const streams=tokens.map(token=>{const stream=new Stream();service.connect(code,token,stream);return stream;});
 for(let seat=humans;seat<4;seat++)service.addBot(code,owner.token,{seat});
 for(const token of tokens)service.ready(code,token,{ready:true});
 const room=service.rooms.get(code);
 return{service,code,tokens,streams,room,start:()=>service.start(code,tokens[0]),complete:()=>service.openingComplete(code,tokens[0],{id:room.opening.id})};
}
function setup(t,humans=1){
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1000000});
 const service=new RoomService({botDelayMs:650,disconnectGraceMs:10});t.after(()=>service.close());return makeRoom(service,humans);
}
function botGame(){
 for(let i=0;i<100;i++){
  const game=new MahjongGame({seed:'opening-bot-'+i,laizi:false});game.newRound();
  const a=game.getActions(1);if(!a.hu&&!a.redGang&&!a.piziGang&&!a.concealedGangs.length&&!a.addedGangs.length)return game;
 }
 throw Error('No deterministic ordinary bot turn fixture');
}
function botOpening(h){h.room.game=botGame();h.service._beginOpening(h.room);h.service._changed(h.room);return h.room.game;}
function captureTimers(t){
 const saved=globalThis.setTimeout,callbacks=[];
 t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{if(delay===650)callbacks.push(callback);return saved(callback,delay,...args);});
 return callbacks;
}
const frozen=game=>JSON.stringify(game);

test('waiting, repeated readiness and opening never produce bot actions or mutate dealt state',t=>{
 const h=setup(t);for(let i=0;i<8;i++)h.service._changed(h.room);t.mock.timers.tick(5000);
 assert.equal(h.room.game,null);assert.equal(h.room.botTimer,null);assert.ok(h.streams[0].states.every(s=>s.state===null));
 h.start();const game=botOpening(h),before=frozen(game);
 for(let i=0;i<8;i++)h.service._changed(h.room);t.mock.timers.tick(10000);
 assert.equal(game.phase.kind,'dealing');assert.equal(h.room.botTimer,null);assert.equal(h.room.botTask,null);assert.equal(frozen(game),before);
 for(let player=0;player<4;player++)assert.equal(game.discard(player,0),false);
 assert.equal(game.advanceAI(),false);assert.equal(game.applyAction(1,{kind:'discard',player:1,index:0}),false);assert.equal(frozen(game),before);assertInvariants(game);
 assert.throws(()=>h.service.action(h.code,h.tokens[0],{action:{kind:'discard',index:0},version:h.room.version,requestId:'early'}),e=>e.code==='NOT_PLAYING');
});

test('human dealer retains the first action; no bot can steal it after opening completion',t=>{
 const h=setup(t);h.start();h.complete();const before=frozen(h.room.game);t.mock.timers.tick(10000);
 assert.equal(h.room.game.current,0);assert.equal(h.room.game.hasDiscardTurn(0),true);assert.equal(h.room.botTimer,null);assert.equal(frozen(h.room.game),before);
});

test('bot dealer waits for owner completion then performs exactly one legal first discard',t=>{
 const h=setup(t),callbacks=captureTimers(t);h.start();const game=botOpening(h),id=h.room.opening.id;
 t.mock.timers.tick(5000);assert.equal(game.players[1].discards.length,0);
 h.complete();const timer=h.room.botTimer;assert.ok(timer);assert.equal(game.current,1);
 for(let i=0;i<10;i++){h.service._changed(h.room);h.service.openingComplete(h.code,h.tokens[0],{id});}
 assert.equal(h.room.botTimer,timer);t.mock.timers.tick(649);assert.equal(game.players[1].discards.length,0);
 t.mock.timers.tick(1);assert.equal(game.players[1].discards.length,1);assert.equal(game.players[1].hand.length,13);assertInvariants(game);
 const after=frozen(game),next=h.room.botTimer;callbacks[0]();assert.equal(frozen(game),after);assert.equal(h.room.botTimer,next);
});

test('ordinary discard and AI reject mismatched seats, pending responses and residual settlement without writes',()=>{
 for(const change of[g=>{g.phase.seat=2;},g=>{g.current=2;},g=>{g.pendingDiscard={from:0,tile:1};},g=>{g.result={kind:'draw'};},g=>{g.winner=1;}]){
  const game=botGame();change(game);const before=frozen(game);assert.equal(game.discard(1,0),false);assert.equal(game.advanceAI(),false);assert.equal(frozen(game),before);
 }
});

test('completion is owner-only, round-bound and idempotent across repeated requests',t=>{
 const h=setup(t,2);h.start();const id=h.room.opening.id,before=frozen(h.room.game),version=h.room.version;
 assert.throws(()=>h.service.openingComplete(h.code,h.tokens[1],{id}),e=>e.code==='OWNER_ONLY');
 assert.throws(()=>h.service.openingComplete(h.code,h.tokens[0],{id:'0'.repeat(24)}),e=>e.code==='STALE_OPENING');
 assert.equal(frozen(h.room.game),before);assert.equal(h.room.version,version);
 h.complete();const done=h.room.version;h.service.openingComplete(h.code,h.tokens[0],{id});assert.equal(h.room.version,done);
 h.room.game.newRound();h.service._beginOpening(h.room);h.service._changed(h.room);
 assert.throws(()=>h.service.openingComplete(h.code,h.tokens[0],{id}),e=>e.code==='STALE_OPENING');assert.equal(h.room.game.phase.kind,'dealing');
});

test('disconnect holds the opening and reconnect resumes the same valid completion',t=>{
 const h=setup(t,2);h.start();const id=h.room.opening.id,before=frozen(h.room.game);h.streams[1].end();t.mock.timers.tick(10);
 assert.throws(()=>h.complete(),e=>e.code==='PLAYER_DISCONNECTED');t.mock.timers.tick(5000);assert.equal(frozen(h.room.game),before);
 h.service.connect(h.code,h.tokens[1],new Stream());h.complete();assert.equal(h.room.game.phase.kind,'discard');assert.equal(h.room.completedOpening.id,id);
});

for(const change of ['new-round','same-round-redeal','replace-game','end','disconnect','dispose','recreate'])test('queued old callback cannot act after '+change,t=>{
 const h=setup(t),callbacks=captureTimers(t);h.start();const old=botOpening(h);h.complete();const callback=callbacks.at(-1);
 assert.equal(typeof callback,'function');
 if(change==='new-round'||change==='same-round-redeal'){
  old.newRound('stale-'+change,{restart:change==='same-round-redeal'});h.service._beginOpening(h.room);h.service._changed(h.room);
 }else if(change==='replace-game')botOpening(h);
 else if(change==='end'){old._finishDraw();h.service._changed(h.room);}
 else if(change==='disconnect'){h.streams[0].end();t.mock.timers.tick(10);}
 else {h.service._dispose(h.room);if(change==='recreate'){const replacement=makeRoom(h.service);h.service.rooms.delete(replacement.code);replacement.room.code=h.code;h.service.rooms.set(h.code,replacement.room);}}
 const current=h.room.game,before=frozen(current),task=h.room.botTask,timer=h.room.botTimer;callback();
 assert.equal(frozen(current),before);assert.equal(h.room.botTask,task);assert.equal(h.room.botTimer,timer);
 if(h.room.opening){h.complete();const nextTimer=h.room.botTimer,ready=frozen(h.room.game);callback();assert.equal(h.room.botTimer,nextTimer);assert.equal(frozen(h.room.game),ready);}
});

test('a state replacement during decision is rechecked before any game writes',t=>{
 const h=setup(t);h.start();const old=botOpening(h);h.complete();const before=frozen(old),get=old.getActions.bind(old);let replaced=false;
 old.getActions=player=>{const actions=get(player);if(!replaced){replaced=true;botOpening(h);}return actions;};
 t.mock.timers.tick(650);assert.equal(replaced,true);assert.notEqual(h.room.game,old);assert.equal(frozen(old),before);assert.equal(h.room.game.phase.kind,'dealing');assert.equal(h.room.botTimer,null);
});

test('canceling or disposing one room leaves another room bot timer and action intact',t=>{
 const h=setup(t);h.start();botOpening(h);h.complete();
 const other=makeRoom(h.service);other.start();const game=botOpening(other);other.complete();const timer=other.room.botTimer;
 h.service._dispose(h.room);assert.equal(other.room.botTimer,timer);t.mock.timers.tick(650);assert.equal(game.players[1].discards.length,1);assertInvariants(game);
});

test('HTTP rejects old clients, gates ordinary actions and exposes the owner completion route',async t=>{
 const service=new RoomService({botDelayMs:600000}),server=createServer({roomService:service});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{service.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 const base='http://127.0.0.1:'+server.address().port;
 const post=async(path,body,token,modern=true)=>{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(modern?{'X-KK-Opening':'1'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return{status:response.status,data:await response.json()};};
 assert.equal((await post('/api/rooms',{name:'旧页面'},null,false)).data.code,'CLIENT_UPDATE_REQUIRED');
 const owner=(await post('/api/rooms',{name:'新页面'})).data,code=owner.room.code;service.connect(code,owner.token,new Stream());for(const seat of[1,2,3])service.addBot(code,owner.token,{seat});service.ready(code,owner.token,{ready:true});
 assert.equal((await post('/api/rooms/'+code+'/start',{},owner.token,false)).data.code,'CLIENT_UPDATE_REQUIRED');assert.equal(service.rooms.get(code).game,null);
 const started=await post('/api/rooms/'+code+'/start',{},owner.token);assert.equal(started.status,200);assert.equal(started.data.state.phase.kind,'dealing');
 assert.equal((await post('/api/rooms/'+code+'/action',{action:{kind:'discard',index:0},version:started.data.room.version,requestId:'early-http'},owner.token)).data.code,'NOT_PLAYING');
 const done=await post('/api/rooms/'+code+'/openingComplete',{id:started.data.room.opening.id},owner.token);assert.equal(done.status,200);assert.equal(done.data.state.phase.kind,'discard');assert.equal(done.data.room.opening,null);
});
