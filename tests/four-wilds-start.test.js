import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {MahjongGame} from '../engine.js';
import {RoomService} from '../src/server/rooms.js';
import {createServer} from '../server.js';
import {assertInvariants} from '../src/domain/invariants.js';
import {canChooseFourWilds,canPrepareBotRoom,isSoloHumanBotTable} from '../src/domain/room-start.js';
class Stream extends EventEmitter{writableLength=0;writeHead(){}write(){return true;}end(){if(!this.writableEnded){this.writableEnded=true;this.emit('close');}}}
function room(t,{humans=1,laizi=true,bots=3}={}){
 const service=new RoomService({botDelayMs:650});t.after(()=>service.close());const a=service.create({name:'四癞审核',laizi}),code=a.room.code,tokens=[a.token],streams=[];
 for(let i=1;i<humans;i++)tokens.push(service.join(code,{name:'好友'+i}).token);
 for(const token of tokens){const stream=new Stream();streams.push(stream);service.connect(code,token,stream);}
 for(let i=humans;i<Math.min(4,humans+bots);i++)service.addBot(code,a.token,{seat:i});
 return{service,code,tokens,streams,room:service.rooms.get(code),ready(){for(const token of tokens)service.ready(code,token,{ready:true});},start(wildOwner=null){return service.start(code,tokens[0],{wildOwner});}};
}
const invalid=(fn,code)=>assert.throws(fn,e=>e.code===code);
test('four wilds readiness derives only from current complete connected ready seats and owner',t=>{
 const h=room(t,{bots:0});assert.equal(h.service.state(h.code,h.tokens[0]).room.fourWildsReady,false);
 for(let seat=1;seat<4;seat++){h.service.addBot(h.code,h.tokens[0],{seat});assert.equal(h.service.state(h.code,h.tokens[0]).room.fourWildsReady,false);}
 h.ready();const s=h.service.state(h.code,h.tokens[0]);assert.equal(s.room.fourWildsReady,true);assert.equal(canChooseFourWilds(s.room),true);assert.equal(h.room.game,null);assert.equal(h.room.botTimer,null);
 h.service.ready(h.code,h.tokens[0],{ready:false});assert.equal(h.service.state(h.code,h.tokens[0]).room.fourWildsReady,false);h.ready();
 h.service.removeBot(h.code,h.tokens[0],{seat:3});assert.equal(h.service.state(h.code,h.tokens[0]).room.fourWildsReady,false);assert.equal(h.room.game,null);
});
test('partial filling, unready, disconnected, disabled laizi and foreign owner cannot bypass the start gate',t=>{
 for(const options of [{bots:1},{bots:2},{laizi:false},{humans:2,bots:2}]){
  const h=room(t,options);h.ready();const before=JSON.stringify(h.room.game);assert.equal(h.service.state(h.code,h.tokens[0]).room.fourWildsReady,false);
  assert.throws(()=>h.start(0));assert.equal(JSON.stringify(h.room.game),before);assert.equal(h.room.botTimer,null);
 }
 const h=room(t);invalid(()=>h.start(0),'NOT_READY');h.ready();h.room.seats[0].connected=false;assert.equal(h.service.state(h.code,h.tokens[0]).room.fourWildsReady,false);invalid(()=>h.start(0),'PLAYER_DISCONNECTED');h.room.seats[0].connected=true;
 for(const wildOwner of [1,-1,4,'0',false,{},[]])invalid(()=>h.start(wildOwner),'FOUR_WILDS_UNAVAILABLE');
 for(const body of [{mode:'four-wilds'},{isBotRoom:true,wildOwner:0},null,[],{wildOwner:0,extra:true}])invalid(()=>h.service.start(h.code,h.tokens[0],body),'INVALID_START_OPTIONS');
 assert.equal(h.room.game,null);
});
test('roster changing after a ready snapshot invalidates the old four-wild request',t=>{
 const h=room(t);h.ready();assert.equal(h.service.state(h.code,h.tokens[0]).room.fourWildsReady,true);h.service.removeBot(h.code,h.tokens[0],{seat:3});
 const guest=h.service.join(h.code,{name:'后到真人'});h.service.connect(h.code,guest.token,new Stream());h.service.ready(h.code,guest.token,{ready:true});
 invalid(()=>h.start(0),'FOUR_WILDS_UNAVAILABLE');invalid(()=>h.service.start(h.code,guest.token,{wildOwner:3}),'OWNER_ONLY');assert.equal(h.room.game,null);
 const before=h.service.state(h.code,h.tokens[0]);assert.equal(before.room.fourWildsReady,false);h.start();assert.equal(h.room.game.wildOwner,null,'ordinary multiplayer start remains supported');
});
test('a disconnected human never becomes a bot or an empty participant',t=>{
 const h=room(t,{humans:2,bots:2});h.ready();h.room.seats[1].connected=false;
 assert.equal(isSoloHumanBotTable(h.room.seats,0),false);assert.equal(canPrepareBotRoom({...h.service.state(h.code,h.tokens[0]).room}),false);assert.equal(h.service.state(h.code,h.tokens[0]).room.fourWildsReady,false);assert.throws(()=>h.start(0));
});
test('four-wild engine deals actual four copies within 13/14 cards at every owner and dealer',()=>{
 for(let owner=0;owner<4;owner++)for(let seed=0;seed<12;seed++){
  const game=new MahjongGame({seed:'four-wild-deal-'+seed,laizi:true,wildOwner:owner});
  for(let round=0;round<4;round++){
   if(round)game.newRound();assert.equal(game.wildOwner,owner);assert.equal(game.players[owner].hand.filter(t=>t===game.wildTile).length,4);
   for(let seat=0;seat<4;seat++){assert.equal(game.players[seat].hand.length,seat===game.dealer?14:13);if(seat!==owner)assert.equal(game.players[seat].hand.includes(game.wildTile),false);}
   assert.equal(game.wall.length,82);assertInvariants(game);
  }
 }
});
test('ordinary explicit null and default deals stay equal and never inherit forced owner config',()=>{
 for(let i=0;i<30;i++){const options={seed:'ordinary-isolation-'+i,laizi:true};const a=new MahjongGame(options),b=new MahjongGame({...options,wildOwner:null});assert.equal(JSON.stringify(a),JSON.stringify(b));assert.equal(a.wildOwner,null);assertInvariants(a);}
});
for(const first of [null,0])test(`synchronous ordinary/four-wild crossover accepts exactly the first ${first===null?'ordinary':'four-wild'} start`,t=>{
 const h=room(t);h.ready();h.start(first);const game=h.room.game,before=JSON.stringify(game);invalid(()=>h.start(first===null?0:null),'ALREADY_STARTED');invalid(()=>h.start(first),'ALREADY_STARTED');assert.equal(JSON.stringify(game),before);assert.equal(game.wildOwner,first);assert.equal(game.phase.kind,'dealing');assert.equal(h.room.botTimer,null);assert.equal(h.service.state(h.code,h.tokens[0]).room.fourWildsReady,false);
});
test('nonzero human owner gets the four real wilds and does not steal a bot dealer first turn',t=>{
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1000000});const h=room(t,{humans:2,bots:2});h.service.leave(h.code,h.tokens[0]);h.service.addBot(h.code,h.tokens[1],{seat:0});h.service.ready(h.code,h.tokens[1],{ready:true});
 const before=h.service.state(h.code,h.tokens[1]);assert.equal(before.room.seat,1);assert.equal(before.room.owner,0);assert.equal(before.room.fourWildsReady,true);
 const start=h.service.start(h.code,h.tokens[1],{wildOwner:1});assert.equal(start.room.wildOwner,0);assert.equal(h.room.game.wildOwner,1);assert.equal(h.room.game.dealer,0);assert.equal(h.room.game.players[1].hand.filter(t=>t===h.room.game.wildTile).length,4);
 const frozen=JSON.stringify(h.room.game);t.mock.timers.tick(5000);assert.equal(JSON.stringify(h.room.game),frozen);assert.equal(h.room.botTimer,null);
 h.service.openingComplete(h.code,h.tokens[1],{id:start.room.opening.id});const version=h.room.version;t.mock.timers.tick(649);assert.equal(h.room.version,version);t.mock.timers.tick(1);assert.ok(h.room.version>version,'bot dealer acts after the legal opening phase');assertInvariants(h.room.game);
});
test('ended four-wild table hides choices and next round preserves only its already locked rule',t=>{
 const h=room(t);h.ready();const s=h.start(0);h.service.openingComplete(h.code,h.tokens[0],{id:s.room.opening.id});h.room.game._finishDraw();h.service._changed(h.room);
 assert.equal(h.service.state(h.code,h.tokens[0]).room.fourWildsReady,false);invalid(()=>h.start(null),'ALREADY_STARTED');invalid(()=>h.service.join(h.code,{name:'真人替换'}),'ALREADY_STARTED');
 const n=h.service.next(h.code,h.tokens[0]);assert.equal(n.state.phase.kind,'dealing');assert.equal(n.room.wildOwner,0);assert.equal(n.room.fourWildsReady,false);assert.equal(h.room.game.players[0].hand.filter(t=>t===h.room.game.wildTile).length,4);assertInvariants(h.room.game);
 h.service.leave(h.code,h.tokens[0]);assert.equal(h.service.rooms.has(h.code),false);const other=room(t);other.ready();other.start();assert.equal(other.room.game.wildOwner,null);
});
test('real concurrent HTTP start requests cannot switch a game that already started',async t=>{
 const h=room(t);h.ready();const server=createServer({roomService:h.service});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const url='http://127.0.0.1:'+server.address().port+'/api/rooms/'+h.code+'/start',headers={'Content-Type':'application/json','X-KK-Opening':'1',Authorization:'Bearer '+h.tokens[0]};
 const responses=await Promise.all([null,0,0,null].map(wildOwner=>fetch(url,{method:'POST',headers,body:JSON.stringify({wildOwner})})));assert.equal(responses.filter(r=>r.ok).length,1);assert.equal(responses.filter(r=>r.status===409).length,3);assert.equal(h.room.game.round,1);assert.equal(h.room.game.phase.kind,'dealing');assert.equal(h.room.botTimer,null);assertInvariants(h.room.game);
});
