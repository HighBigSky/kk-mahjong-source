import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {actionFixture} from './pizi-fixtures.mjs';
import {assertInvariants} from '../src/domain/invariants.js';

const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const service=new RoomService({botDelayMs:600000});
const server=createServer({roomService:service});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const pages=[],contexts=[],names=['结算东','结算南','结算西','结算北'];
const report={passed:false,cases:[],errors:[],note:'Four actual HTTP/SSE human sessions; prepared hands conserve all 136 tiles. Real Hu/pass actions settle the round.'};
mkdirSync('output',{recursive:true});
const sync=async room=>{for(const page of pages)await page.waitForFunction(version=>window.mahjongRoom.room?.version>=version&&!window.mahjongRoom.busy,room.version);};
try{
 let code;
 for(let seat=0;seat<4;seat++){
  const context=await browser.newContext({viewport:[{width:640,height:360},{width:844,height:390},{width:1920,height:1080},{width:800,height:360}][seat],hasTouch:seat%2===1,isMobile:seat%2===1,reducedMotion:'reduce'});contexts.push(context);
  await context.addInitScript(()=>{
   Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:()=>Promise.reject(Error('test fallback'))});
   if(screen.orientation)Object.defineProperty(screen.orientation,'lock',{configurable:true,value:()=>Promise.reject(Error('test fallback'))});
  });
  const page=await context.newPage();pages.push(page);page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(base,{waitUntil:'networkidle'});await page.locator('#room-name').fill(names[seat]);
  if(!seat){await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();code=(await page.locator('#room-current-code').textContent()).trim();}
  else{await page.locator('#room-code').fill(code);await page.locator('#room-join').click();await page.locator('#room-waiting:not([hidden])').waitFor();}
  await page.locator('#room-ready').click();
 }
 const room=service.rooms.get(code);await sync(room);await pages[0].locator('#room-start').click();await sync(room);
 const hand=[9,10,11,18,19,20,24,25,26,4];
 const scenarios=[];
 for(const winner of [0,1,2,3])for(const from of [3,0,1,2])if(from!==winner)scenarios.push({winner,from,selfDraw:false});
 for(const winner of [0,1,2,3])scenarios.push({winner,from:null,selfDraw:true});
 for(const kind of ['redGang','piziGang','wildGang'])for(const selfDraw of [false,true])scenarios.push({winner:0,from:selfDraw?null:3,selfDraw,priorGangs:[{owner:2,kind}]});
 scenarios.push({winner:0,from:3,selfDraw:false,priorGangs:[{owner:1,kind:'redGang'},{owner:2,kind:'wildGang'},{owner:3,kind:'piziGang'}]});
 let beforeHu=[];
 const read=page=>page.evaluate(()=>({title:document.querySelector('#result-title').textContent,detail:document.querySelector('#result-detail').textContent,avatar:document.querySelector('#result-avatar').getAttribute('src'),alt:document.querySelector('#result-avatar').alt,winner:window.mahjongGame.result.winner,from:window.mahjongGame.result.from,scores:[...document.querySelectorAll('#result-scores .result-score-row')].map(row=>row.textContent),amounts:[...document.querySelectorAll('.score-main')].map(node=>Number(node.dataset.value)),gangs:[...document.querySelectorAll('.score-gang')].map(node=>Number(node.dataset.value)),nets:[...document.querySelectorAll('.score-net')].map(node=>Number(node.dataset.value)),balances:[...document.querySelectorAll('.score-balance')].map(node=>Number(node.dataset.value)),wallet:Number(document.querySelector('#score').textContent.replaceAll(',','')),hand:[...document.querySelectorAll('#result-hand use')].map(node=>Number(node.getAttribute('href').split('-').at(-1)))}));
 const priorGangs=(game,entries=[])=>{
  for(const {owner,kind} of entries){
   const type=kind==='redGang'?31:kind==='piziGang'?33:27,index=game.wall.indexOf(type);assert.ok(index>=0);
   game.wall.splice(index,1);(kind==='redGang'?game.players[owner].redGangs:game.players[owner].piziGangs).push(type);
   game._scoreSpecialGang(owner,kind);game.wallInfo.tailDraws++;assertInvariants(game);
  }
 };
 const check=async(scenario,label)=>{
  for(let viewer=0;viewer<4;viewer++){
   const page=pages[viewer];await page.locator('#result-dialog[open]').waitFor();const data=await read(page);
   report.cases.push({scenario,viewer,label,...data});
   if(label==='settled'&&scenario.winner===0&&scenario.from===3)await page.screenshot({path:`output/settlement-seat-${viewer}.png`});
   assert.equal(data.winner,(scenario.winner-viewer+4)%4);assert.equal(data.from,scenario.from===null?null:(scenario.from-viewer+4)%4);
   assert.ok(data.title.includes(names[scenario.winner]),`winner identity is explicit in heading: ${JSON.stringify({scenario,viewer,data})}`);
   assert.equal(data.avatar,['assets/avatar-player.svg','assets/avatar-1.svg','assets/avatar-2.svg','assets/avatar-3.svg'][scenario.winner]);
   assert.ok(data.alt.includes(names[scenario.winner]));
   assert.match(data.detail,scenario.selfDraw?/自摸/:/接炮/);
   if(!scenario.selfDraw){assert.ok(!data.title.includes(names[scenario.from]));assert.ok(data.detail.includes(`点炮：${names[scenario.from]}`));}
   assert.deepEqual(data.hand,[...room.game.players[scenario.winner].melds.flatMap(meld=>meld.tiles),...room.game.result.hand]);
   for(let relative=0;relative<4;relative++){
    const absolute=(viewer+relative)%4;assert.ok(data.scores[relative].includes(names[absolute]));
    const balance=room.game.players[absolute].score,huChange=balance-beforeHu[absolute];
    assert.equal(data.amounts[relative],huChange,'main amount equals actual balance change at Hu, not the whole-round net');
    assert.equal(data.gangs[relative],room.game.gangScoreDelta[absolute]);assert.equal(data.nets[relative],room.game.result.scoreDelta[absolute]);assert.equal(data.balances[relative],balance);
    assert.equal(data.nets[relative],data.amounts[relative]+data.gangs[relative]);
    if(absolute!==scenario.winner)assert.ok(huChange<=0,'a losing player never receives new Hu coins');
   }
   assert.equal(data.wallet,room.game.players[viewer].score);assert.equal(data.amounts.reduce((sum,value)=>sum+value,0),0);assert.equal(room.game.players.reduce((sum,player)=>sum+player.score,0),4000);
  }
 };
 for(const scenario of scenarios){
  const game=actionFixture({seat:scenario.winner,hand:scenario.selfDraw?[...hand,4]:hand,melds:[{kind:'chi',tiles:[0,1,2],from:(scenario.winner+1)%4,concealed:false}],discard:scenario.selfDraw?null:4,names});
  if(!scenario.selfDraw){const original=game.pendingDiscard.from;game.players[scenario.from].discards.push(...game.players[original].discards.splice(0));game.pendingDiscard={tile:4,from:scenario.from};game.phase={kind:'claim',discard:game.pendingDiscard};game.current=scenario.from;}
  priorGangs(game,scenario.priorGangs);game.round=room.game.round+1;game.events=['结算夹具打出五万。'];assertInvariants(game);room.game=game;service._changed(room);await sync(room);
  beforeHu=game.players.map(player=>player.score);
  for(let viewer=0;viewer<4;viewer++)assert.equal(await pages[viewer].locator('#score').textContent().then(text=>Number(text.replaceAll(',',''))),beforeHu[viewer]);
  for(const page of pages)if(await page.locator('#dice-intro').isVisible())await page.locator('#dice-intro').click();
  await pages[scenario.winner].locator('#action-hu:visible:enabled').click();await sync(room);
  for(let count=0;game.phase.kind==='claim'&&count<4;count++){
   const responder=[0,1,2,3].find(seat=>game.getActions(seat).pass);assert.notEqual(responder,undefined);
   await pages[responder].locator('#action-pass:visible:enabled').click();await sync(room);
  }
  assert.equal(game.result.winner,scenario.winner);assert.equal(game.result.from,scenario.from);assertInvariants(game);
  await check(scenario,'settled');
  if(scenario.winner===0&&scenario.from===3){
   const before=JSON.stringify(game);await pages[3].reload({waitUntil:'networkidle'});await sync(room);await check(scenario,'refresh');assert.equal(JSON.stringify(game),before);
  }
 }
 const draw=actionFixture({names});priorGangs(draw,[{owner:2,kind:'redGang'}]);draw.round=room.game.round+1;draw._finishDraw();assertInvariants(draw);room.game=draw;service._changed(room);await sync(room);
 for(let viewer=0;viewer<4;viewer++){
  await pages[viewer].locator('#result-dialog[open]').waitFor();const data=await read(pages[viewer]);
  assert.equal(data.winner,null);assert.equal(data.from,null);assert.equal(data.title,'好牌，下局再来');assert.match(data.detail,/荒庄/);assert.deepEqual(data.hand,[]);
  for(let relative=0;relative<4;relative++){const absolute=(viewer+relative)%4;assert.equal(data.amounts[relative],draw.result.scoreDelta[absolute]);assert.equal(data.gangs[relative],draw.gangScoreDelta[absolute]);assert.equal(data.balances[relative],draw.players[absolute].score);}
  report.cases.push({scenario:'draw',viewer,...data});
 }
 assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,views:report.cases.length,errors:report.errors}));
}finally{writeFileSync('output/ui-settlement.json',JSON.stringify(report,null,2));await Promise.allSettled(contexts.map(context=>context.close()));await browser.close();service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
