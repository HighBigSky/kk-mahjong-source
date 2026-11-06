import {ensureReady} from './ui-ready.mjs';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const output=process.env.KK_UI_OUTPUT||'output/bot-review-20261106';mkdirSync(output,{recursive:true});
const service=new RoomService(),server=createServer({roomService:service});server.listen(0,'127.0.0.1');await once(server,'listening');
const target=process.env.KK_UI_TARGET_URL||'http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}),contexts=[];
const report={passed:false,target,checks:[],errors:[],resources:[],expectedNetworkFailures:0,cleanupErrors:[],note:'Real UI and HTTP/SSE rooms; held client animations test slow presentation. Only local same-round redeal uses the existing engine method as a controlled lifecycle fixture; public verification uses normal room operations only.'};
async function player(name,failOnce=false){
 const context=await browser.newContext({viewport:{width:1280,height:720}});contexts.push(context);
 if(failOnce)await context.route('**/openingComplete',async route=>{if(!report.expectedNetworkFailures){report.expectedNetworkFailures++;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'controlled retry fixture'})});}else await route.continue();});
 await context.addInitScript(()=>{
  localStorage.setItem('queqi-settings',JSON.stringify({sound:false}));window.__openingRequests=[];window.__holdDeal=false;window.__held=[];
  Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:()=>Promise.reject(Error('opening review viewport'))});
  const animate=Element.prototype.animate,timeout=window.setTimeout.bind(window),fetch=window.fetch.bind(window);
  Element.prototype.animate=function(...args){const a=animate.apply(this,args);if(window.__holdDeal&&this.classList.contains('deal-flight')){a.pause();window.__held.push(a);}return a;};
  window.setTimeout=(fn,delay,...args)=>timeout(fn,window.__holdDeal&&delay===3180?10000:delay,...args);
  window.fetch=(path,...args)=>{if(String(path).endsWith('/openingComplete'))window.__openingRequests.push({time:performance.now(),round:window.mahjongGame.round,phase:window.mahjongGame.phase.kind,dice:document.querySelector('#dice-intro').hidden,flights:document.querySelectorAll('.deal-flight').length,locked:document.querySelector('#game').matches('.is-dice-intro,.is-opening-deal')});return fetch(path,...args);};
 });
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!(failOnce&&m.location().url.endsWith('/openingComplete')&&/503/.test(m.text())))report.errors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400&&!(failOnce&&r.status()===503&&r.url().endsWith('/openingComplete')))report.resources.push({status:r.status(),url:r.url()});});
 page.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')report.resources.push({url:r.url(),error:r.failure()?.errorText});});
 await page.goto(target,{waitUntil:'networkidle'});await page.locator('#room-name').fill(name);return page;
}
const fresh=page=>page.evaluate(async()=>{const c=JSON.parse(sessionStorage.getItem('queqi-room-session')||localStorage.getItem('queqi-room-session'));const r=await fetch('/api/rooms/'+c.code+'/state',{headers:{Authorization:'Bearer '+c.token}});if(!r.ok)throw Error('Fresh state '+r.status);return r.json();});
const physical=s=>({phase:s.phase,current:s.current,dealer:s.dealer,wall:s.wallCount,hands:s.players.map(p=>p.hand.length),discards:s.players.map(p=>p.discards),scores:s.players.map(p=>p.score),events:s.events});
const formal=page=>page.waitForFunction(()=>window.mahjongRoom.status==='connected'&&!window.mahjongRoom.busy&&!window.mahjongRoom.room?.opening&&!document.querySelector('#game').matches('.is-dice-intro,.is-opening-deal')&&window.mahjongGame.phase.kind!=='dealing');
async function leave(page){if(!await page.locator('#room-dialog').isVisible()){await page.locator('#settings-btn').click();await page.locator('#settings-home').click();}await page.locator('#room-leave').click();await page.locator('#room-entry:not([hidden])').waitFor();}
async function requestsAfterPresentation(page){const requests=await page.evaluate(()=>window.__openingRequests);assert.ok(requests.length);assert.ok(requests.every(r=>r.phase==='dealing'&&r.dice&&r.flights===0&&!r.locked),'owner completion is sent after its actual presentation ends');return requests.length;}

try{
 const owner=await player('审核房主',!process.env.KK_UI_TARGET_URL),friend=await player('审核好友');
 await owner.locator('#room-create').click();await owner.locator('#room-waiting:not([hidden])').waitFor();const code=(await owner.locator('#room-current-code').textContent()).trim();
 await owner.locator('.room-bot-add[data-seat="1"]').click();await friend.locator('#room-code').fill(code);await friend.locator('#room-join').click();await friend.locator('#room-waiting:not([hidden])').waitFor();await owner.locator('.room-bot-add[data-seat="3"]').click();
 await ensureReady(friend);await ensureReady(owner);await owner.waitForTimeout(900);
 const waiting=await fresh(owner);assert.equal(waiting.room.status,'waiting');assert.equal(waiting.state,null);report.checks.push({waitingNoGameOrActions:true});
 await friend.evaluate(()=>{window.__holdDeal=true;});await owner.locator('#room-start:enabled').click();
 await friend.waitForFunction(()=>document.querySelector('#opening-deal').dataset.phase==='running');
 const before=await fresh(owner);assert.equal(before.state.phase.kind,'dealing');await owner.waitForTimeout(800);const held=await fresh(owner);assert.deepEqual(physical(held.state),physical(before.state));
 assert.equal(await friend.locator('.deal-flight').count(),53);report.checks.push({duringPresentationFrozen:true,noEarlyDiscard:true,noWallOrHandChanges:true});
 await formal(owner);await formal(friend);assert.equal(await friend.locator('.deal-flight').count(),0);report.checks.push({slowPeerClearsExpiredOpening:true,ownerCompletionAfterPresentation:await requestsAfterPresentation(owner),retryRecovered:!process.env.KK_UI_TARGET_URL});
 const index=await owner.evaluate(()=>{const g=window.mahjongGame;return g.players[0].hand.findIndex(t=>t!==31&&t!==g.indicatorTile&&t!==g.wildTile);});
 const tile=owner.locator('#hand button[data-index="'+index+'"]');await tile.click();await tile.click();await owner.waitForFunction(()=>window.mahjongGame.players[0].discards.length===1);await friend.waitForFunction(()=>window.mahjongGame.players.find(p=>p.name==='审核房主').discards.length===1);report.checks.push({humanDealerFirst:true,realDiscardAndPeerMessage:true});
 await leave(friend);await owner.locator('#room-waiting:not([hidden])').waitFor();await owner.locator('.room-bot-add[data-seat="2"]').click();await ensureReady(owner);
 await owner.evaluate(()=>{window.__holdDeal=true;window.__held=[];});await owner.locator('#room-start:enabled').click();
 await owner.waitForFunction(()=>window.mahjongGame.round===2&&window.mahjongGame.phase.kind==='dealing');const start=await fresh(owner);assert.equal(start.state.dealer,1);assert.equal(start.room.seats[1].bot,true);
 await owner.waitForFunction(()=>document.querySelector('#opening-deal').dataset.phase==='running');await owner.waitForTimeout(850);
 const pending=await fresh(owner);assert.deepEqual(physical(pending.state),physical(start.state));assert.equal(pending.state.players[1].hand.length,14);assert.ok(pending.state.players.every(p=>p.discards.length===0));
 await owner.evaluate(()=>{window.__holdDeal=false;for(const a of window.__held){a.currentTime=Math.max(Number(a.currentTime)||0,850);a.play();}});
 await formal(owner);await owner.waitForFunction(()=>{const g=window.mahjongGame,p=g.players[1];return p.discards.length||p.redGangs.length||p.piziGangs.length||p.melds.length||g.winner===1;});
 const acted=await fresh(owner);assert.equal(acted.room.opening,null);assert.notEqual(acted.state.phase.kind,'dealing');await requestsAfterPresentation(owner);report.checks.push({botDealerPreserved:true,botHeldUntilOpeningComplete:true,legalBotFirstAction:true});
 await leave(owner);
 await owner.locator('#room-create').click();await owner.locator('#room-waiting:not([hidden])').waitFor();for(const seat of[1,2,3])await owner.locator('.room-bot-add[data-seat="'+seat+'"]').click();await ensureReady(owner);await owner.locator('#room-start').click();
 await owner.waitForFunction(()=>window.mahjongGame.phase.kind==='dealing'&&document.querySelector('#game').classList.contains('is-dice-intro'));await owner.reload({waitUntil:'networkidle'});await formal(owner);assert.equal(await owner.locator('#hand button:enabled').count(),14);report.checks.push({reloadDuringOpeningRecovers:true,noReplayOrStuckInput:true});
 if(!process.env.KK_UI_TARGET_URL){
  const currentCode=(await fresh(owner)).room.code,room=service.rooms.get(currentCode),pair=[...room.game.wallInfo.dice],round=room.game.round;
  const restart=()=>{const random=room.game._diceRandom,values=[...pair];room.game._diceRandom=()=> (values.shift()-.5)/6;room.game.newRound(undefined,{restart:true});room.game._diceRandom=random;service._beginOpening(room);service._changed(room);return room.opening.id;};
  const oldId=restart();await owner.waitForFunction(()=>document.querySelector('#dice-intro').dataset.phase==='rolling');await owner.waitForTimeout(150);const id=restart();
  await owner.waitForFunction(id=>window.mahjongRoom.room.opening?.id===id&&document.querySelector('#dice-intro').dataset.phase==='rolling',id);await owner.waitForTimeout(700);
  const reset=await fresh(owner);assert.equal(reset.state.round,round);assert.deepEqual(reset.state.wallInfo.dice,pair);assert.equal(reset.state.phase.kind,'dealing');assert.notEqual(id,oldId);
  await formal(owner);assert.equal(room.completedOpening.id,id);assert.equal(room.botTimer,null);report.checks.push({sameRoundSameDiceNewOpeningId:true,oldPresentationCannotReleaseReplacement:true});
 }
 await leave(owner);assert.deepEqual(report.errors,[]);assert.deepEqual(report.resources,[]);report.passed=true;
}catch(error){report.failure=error.stack;throw error;}
finally{
 for(const context of contexts)for(const page of context.pages())try{await page.evaluate(async()=>{const c=JSON.parse(sessionStorage.getItem('queqi-room-session')||'null');if(c)await fetch('/api/rooms/'+c.code+'/leave',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.token},body:'{}'});});}catch(e){report.cleanupErrors.push(e.message);}
 writeFileSync(output+(process.env.KK_UI_TARGET_URL?'/ui-online.json':'/ui-local.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await Promise.allSettled(contexts.map(c=>c.close()));await browser.close();service.close();server.closeAllConnections();await new Promise(r=>server.close(r));
}
