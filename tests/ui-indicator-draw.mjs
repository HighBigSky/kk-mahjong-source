import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {assertInvariants} from '../src/domain/invariants.js';
import {RED_DRAGON} from '../src/domain/tile.js';
import {actionFixture,scattered,maximumPublicFixture,maximumSpecialHandFixture} from './pizi-fixtures.mjs';
import {installVisualGeometry} from './browser-geometry.mjs';
let playwright;
try{playwright=createRequire(import.meta.url)('playwright');}
catch{playwright=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');}
const service=new RoomService({botDelayMs:600000,disconnectGraceMs:100});
const server=createServer({roomService:service});server.listen(0,'127.0.0.1');await once(server,'listening');
const executablePath='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await playwright.chromium.launch({headless:true,...(existsSync(executablePath)?{executablePath}:{})});
const report={passed:false,screenshots:[],errors:[],cases:[]},pages=[];
let room,round=10;
async function frames(){for(const page of pages)await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function sync(){for(const page of pages)await page.waitForFunction(v=>window.mahjongRoom.room?.version>=v&&!window.mahjongRoom.busy,room.version);await frames();}
async function publish(game){game.round=++round;game.events=['明示痞子取牌验收'];assertInvariants(game);room.game=game;service._changed(room);await sync();for(const page of pages){if(await page.locator('#dice-intro').isVisible())await page.locator('#dice-intro').evaluate(n=>n.click());await page.evaluate(()=>window.renderMahjong());}await frames();}
async function assertViews(game,label,expectDrawn=true){
 const position=game.wallInfo.indicatorPosition;
 for(let viewer=0;viewer<4;viewer++){
  const state=await pages[viewer].evaluate(position=>{
   const game=window.mahjongGame,slot=document.querySelector(`#wall-tail .wall-piece[data-position="${position}"]`);
   return {taken:game.indicatorTaken,by:game.indicatorTakenBy,count:+document.querySelector('#wall-count').textContent,backs:document.querySelectorAll('#wall-tail .back').length,slots:document.querySelectorAll('#wall-tail .wall-piece').length,stacks:document.querySelectorAll('#wall-tail .wall-stack').length,empty:slot.classList.contains('is-empty'),face:slot.querySelectorAll('svg').length,wallIndicators:document.querySelectorAll('#wall-tail .is-indicator').length,indicator:document.querySelector('#indicator-tile use').getAttribute('href'),drawn:[...document.querySelectorAll('#hand button.drawn')].map(n=>({index:+n.dataset.index,face:n.querySelector('use').getAttribute('href')})),last:game.lastDraw,hidden:game.players.slice(1).every(p=>p.hand.every(t=>t===null))};
  },position);
  assert.equal(state.taken,true);assert.equal(state.by,(game.indicatorTakenBy-viewer+4)%4);
  assert.equal(state.count,game.wall.length);assert.equal(state.backs,game.wall.length);
  assert.equal(state.slots,136);assert.equal(state.stacks,68);assert.equal(state.empty,true);assert.equal(state.face,0);assert.equal(state.wallIndicators,0);
  assert.equal(state.indicator,`#tile-${game.indicatorTile}`);assert.equal(state.hidden,true);
  if(expectDrawn&&viewer===game.lastDraw?.player){assert.equal(state.drawn.length,1);assert.equal(state.drawn[0].face,`#tile-${game.lastDraw.tile}`);assert.equal(state.drawn[0].index,game.lastDraw.index);assert.equal(state.last.replacement,game.lastDraw.replacement);}
  else assert.equal(state.drawn.length,0);
  report.cases.push({label,viewer,count:state.count,backs:state.backs,emptySlot:position,takenBy:state.by,drawn:state.drawn});
 }
 assertInvariants(game);
}
try{
 for(let viewer=0;viewer<4;viewer++){
  const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,reducedMotion:'reduce'});
  await context.addInitScript(()=>{localStorage.setItem('queqi-settings',JSON.stringify({sound:false,names:false,laizi:true}));Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:()=>Promise.reject(Error('fixed test viewport'))});});
  const page=await context.newPage();await page.addInitScript(installVisualGeometry);pages.push(page);page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});await page.locator('#room-name').fill(`取牌验收${viewer+1}`);
  if(!viewer){await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();room=service.rooms.get((await page.locator('#room-current-code').textContent()).trim());}
  else{await page.locator('#room-code').fill(room.code);await page.locator('#room-join').click();await page.locator('#room-waiting:not([hidden])').waitFor();}
 }
 for(const page of pages)await page.locator('#room-ready').click();await pages[0].locator('#room-start').click();for(const page of pages)await page.locator('#room-dialog').waitFor({state:'hidden'});
 const names=room.seats.map(s=>s.name);
 const tail=actionFixture({names,seat:2,hand:[...scattered,RED_DRAGON]});tail.wallInfo.tailDraws=tail.wallInfo.indicatorPosition;
 await publish(tail);const count=tail.wall.length;
 await pages[2].locator('#action-gang').click();await pages[2].waitForFunction(()=>window.mahjongGame.indicatorTaken===true);await sync();
 assert.equal(tail.wall.length,count);assert.equal(tail.lastDraw.replacement,true);await assertViews(tail,'tail indicator enters pending area');
 await pages[1].reload({waitUntil:'networkidle'});await sync();await assertViews(tail,'observer refresh retains empty slot');
 const next=tail.wall[0];await pages[2].locator('#action-gang:enabled').click();await pages[2].waitForFunction(()=>window.mahjongGame.players[0].piziGangs.length===1);await sync();
 assert.equal(tail.wall.length,count-1);assert.equal(tail.lastDraw.tile,next);assert.deepEqual(tail.gangScoreDelta,[-20,-20,60,-20]);await assertViews(tail,'optional indicator kong supplements next physical tail');

 const head=actionFixture({names,seat:3,hand:[...scattered,24]});head.lastDraw=null;
 const removed=head.wall.splice(head.wallInfo.indicatorPosition);
 for(const [index,tile] of removed.entries()){
  const owner=head.players[index%4];
  if(tile===RED_DRAGON)owner.redGangs.push(tile);else if(tile===head.indicatorTile)owner.piziGangs.push(tile);else owner.discards.push(tile);
 }
 await publish(head);const before=head.wall.length;
 await pages[3].locator('#hand button[data-index="13"]').dblclick();
 for(let attempt=0;attempt<4&&head.phase.kind==='claim';attempt++)for(const page of pages)if(await page.locator('#action-pass:visible:enabled').count())await page.locator('#action-pass').click();
 await pages[0].waitForFunction(()=>window.mahjongGame.indicatorTaken===true);await sync();assert.equal(head.wall.length,before);assert.equal(head.lastDraw.replacement,false);
 await assertViews(head,'head draw enters pending area');
 const ordinary=head.players[0].hand.findIndex(t=>t!==RED_DRAGON&&t!==head.indicatorTile),scores=head.players.map(p=>p.score),declared=head.players[0].piziGangs.length;
 await pages[0].locator(`#hand button[data-index="${ordinary}"]`).dblclick();await sync();
 assert.ok(head.players[0].hand.includes(head.indicatorTile));assert.equal(head.players[0].piziGangs.length,declared);assert.deepEqual(head.players.map(p=>p.score),scores);
 for(const page of pages)assert.equal(await page.locator('#wall-tail .is-indicator').count(),0);
 assertInvariants(head);report.cases.push({label:'retaining the taken indicator is optional and has no kong score',retained:true});
 for(const [label,create] of [['eight special kongs and fourteen concealed tiles',maximumSpecialHandFixture],['eight special kongs and four ordinary kongs',maximumPublicFixture]]){
  const game=create(names);game.indicatorTaken=true;game.indicatorTakenBy=0;game.players[0].piziGangs.push(game.indicatorTile);game.wallInfo.tailDraws=game.wallInfo.indicatorPosition;game.lastDraw=null;
  await publish(game);await assertViews(game,label,false);
  const geometry=await pages[0].evaluate(()=>{
   const hand=[...document.querySelectorAll('#hand button')],melds=[...document.querySelectorAll('.my-melds .tile')];
   return {overlaps:hand.flatMap((h,i)=>melds.flatMap((m,j)=>window.visualGeometry.intersects(window.visualGeometry.quad(h),window.visualGeometry.quad(m))?[{hand:i,meld:j}]:[])),wrap:getComputedStyle(document.querySelector('#hand')).flexWrap};
  });
  assert.deepEqual(geometry.overlaps,[],label+': extra fourth indicator kong must not cover the local hand');assert.equal(geometry.wrap,'nowrap');
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
 console.log(JSON.stringify({passed:true,fourClients:true,cases:report.cases.length,screenshots:0,errors:report.errors},null,2));
}finally{
 mkdirSync('output',{recursive:true});writeFileSync('output/ui-indicator-draw.json',JSON.stringify(report,null,2));
 await browser.close();service.close();server.close();server.closeAllConnections();
}
