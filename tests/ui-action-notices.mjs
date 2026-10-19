import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {assertInvariants} from '../src/domain/invariants.js';
import {actionFixture,maximumPublicFixture,scattered} from './pizi-fixtures.mjs';

let playwright;
try {playwright=createRequire(import.meta.url)('playwright');}
catch {playwright=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');}
const service=new RoomService({disconnectGraceMs:100});
const server=createServer({roomService:service});server.listen(0,'127.0.0.1');await once(server,'listening');
const baseURL=`http://127.0.0.1:${server.address().port}`;
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await playwright.chromium.launch({headless:true,...(existsSync(edge)?{executablePath:edge}:{})});
const contexts=[],pages=[],expected409=new Set();
const output=path.resolve('output');mkdirSync(output,{recursive:true});
const report={passed:false,errors:[],actions:[],views:[],geometry:[],screenshots:[],checks:[],colors:{},fixtureNote:'Explicit action fixtures allocate all 136 physical tiles. Commands are genuine four-browser HTTP/SSE operations; fixtures are not naturally dealt full rounds.'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const redact=text=>text.replace(/[a-f0-9]{48}/g,'[redacted]');
async function waitFor(test,label,timeout=8000){const end=Date.now()+timeout;while(!await test()){assert.ok(Date.now()<end,`Timed out: ${label}`);await sleep(20);}}
async function sync(room){for(const page of pages)await waitFor(()=>page.evaluate(version=>window.mahjongRoom.room?.version>=version&&!window.mahjongRoom.busy,room.version),'four SSE renders');}
async function player(name){
  const context=await browser.newContext({viewport:{width:390,height:844}});contexts.push(context);
  await context.addInitScript(()=>localStorage.setItem('queqi-settings',JSON.stringify({sound:false,laizi:true,names:false})));
  const page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(redact(error.message)));
  page.on('console',message=>{if(message.type()==='error'&&!(expected409.has(message.location().url)&&/\b409\b/.test(message.text())))report.errors.push(redact(message.text()));});
  await page.goto(baseURL,{waitUntil:'domcontentloaded'});await page.locator('#room-dialog[open]').waitFor();await page.locator('#room-name').fill(name);return page;
}
async function visible(page){return page.evaluate(()=>[...document.querySelectorAll('.seat-action-notice')].filter(element=>!element.hidden&&element.getClientRects().length).map(element=>({player:Number(element.dataset.player),kind:element.dataset.kind,text:element.textContent,color:getComputedStyle(element).color})));}
async function none(label){for(const page of pages)assert.deepEqual(await visible(page),[],label);}
async function publish(room,game){assertInvariants(game);game.round=room.game.round+1;room.game=game;service._changed(room);await sync(room);await none('a new game reference clears the previous notice');}
async function notice(room,kind,actor,label){
  assertInvariants(room.game);
  const text={chi:'吃',peng:'碰',gang:'杠',hu:'胡'}[kind];
  for(let viewer=0;viewer<4;viewer++){
    const rows=await visible(pages[viewer]);assert.equal(rows.length,1,`${label}: exactly one actor notice`);
    assert.deepEqual({...rows[0],color:undefined},{player:(actor-viewer+4)%4,kind,text,color:undefined},`${label}: relative seat and exact single character`);
    assert.notEqual(rows[0].color,'rgba(0, 0, 0, 0)');report.colors[kind]=rows[0].color;
    const response=await pages[viewer].request.get(`${baseURL}/api/rooms/${room.code}/state`,{headers:{Authorization:`Bearer ${room.seats[viewer].token}`}});
    assert.equal(response.status(),200);const state=(await response.json()).state;
    assert.equal(state.actionNotice.kind,kind);assert.equal(state.actionNotice.player,(actor-viewer+4)%4);
    assert.ok(Number.isInteger(state.actionNotice.id));
    assert.ok(kind==='hu'?state.actionNotice.remainingMs===null:state.actionNotice.remainingMs>0&&state.actionNotice.remainingMs<=2400);
    report.views.push({label,viewer,actor,relative:(actor-viewer+4)%4,kind,text,HTTPAndSSE:true});
  }
}
async function click(room,actor,action){
  const page=pages[actor],version=room.version;
  if(['gang','redGang','piziGang'].includes(action.kind)){
    await page.locator('#action-gang:visible:enabled').click();
    await waitFor(async()=>room.version>version||await page.locator('#choice-dialog').evaluate(dialog=>dialog.open),'kong accepted or choice visible');
    if(await page.locator('#choice-dialog').evaluate(dialog=>dialog.open)){
      const label=action.kind==='redGang'?'红中杠':action.kind==='piziGang'?'皮子杠':action.mode==='concealed'?'暗杠':'补杠';
      let option=page.locator('#choice-options button').filter({hasText:label});
      if(action.kind==='gang')option=option.filter({has:page.locator(`use[href="assets/tiles.svg#tile-${action.tile}"]`)});
      await option.first().click();
    }
  }else if(action.kind==='chi'){
    await page.locator('#action-chi:visible:enabled').click();
    if(await page.locator('#choice-dialog').evaluate(dialog=>dialog.open)){
      const options=page.locator('#choice-options button');let found=false;
      for(let index=0;index<await options.count();index++){
        const codes=await options.nth(index).locator('use').evaluateAll(uses=>uses.map(use=>Number(use.getAttribute('href').split('-').at(-1))));
        if(JSON.stringify(codes)===JSON.stringify(action.sequence)){await options.nth(index).click();found=true;break;}
      }
      assert.equal(found,true,'requested legal chi choice exists');
    }
  }else {
    const button=page.locator(`#action-${action.kind}:visible:enabled`);
    const hit=await button.evaluate(element=>{
      const rect=item=>{const r=item.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
      const box=rect(element),target=document.elementFromPoint((box.left+box.right)/2,(box.top+box.bottom)/2);
      return {reachable:Boolean(target&&(target===element||element.contains(target))),button:box,blocker:target?{tag:target.tagName,id:target.id,className:target.className,box:rect(target)}:null,game:rect(document.querySelector('#game')),stage:{width:document.querySelector('#game').clientWidth,height:document.querySelector('#game').clientHeight},viewport:{width:innerWidth,height:innerHeight}};
    });
    if(!hit.reachable){
      report.actionHitFailure={kind:action.kind,actor,...hit};
      const screenshot=path.join(output,'ui-action-notice-hit-failure.png');await page.screenshot({path:screenshot});report.screenshots.push(screenshot);
      console.error(JSON.stringify({actionHitFailure:report.actionHitFailure}));
    }
    await button.click();
  }
  await waitFor(()=>room.version>version,`server accepts ${action.kind}`);await sync(room);
}
async function passes(room){
  for(let count=0;room.game.phase.kind==='claim'&&count<4;count++){
    const seat=[0,1,2,3].find(seat=>room.game.getActions(seat).pass);assert.notEqual(seat,undefined);
    await click(room,seat,{kind:'pass'});
  }
  assert.notEqual(room.game.phase.kind,'claim');
}
function competition(names){
  const game=actionFixture({seat:1,hand:[0,2,...scattered.filter(tile=>tile!==0&&tile!==2).slice(0,11)],discard:1,names});
  const pool=[...game.wall,...game.players.filter((_,seat)=>seat!==1).flatMap(player=>player.hand)].sort((a,b)=>a-b);
  for(let seat=0;seat<4;seat++)if(seat!==1)game.players[seat].hand=[];
  const take=tiles=>tiles.map(tile=>{const index=pool.indexOf(tile);assert.ok(index>=0);return pool.splice(index,1)[0];});
  game.players[2].hand=take([1,1,6,8,10,12,14,16,18,20,22,24,26]);
  for(const seat of [0,3])game.players[seat].hand=pool.splice(0,13);
  game.wall=pool;assertInvariants(game);return game;
}
async function expiredReplay(room){
  const snapshots=Array.from({length:4},(_,viewer)=>service.snapshot(room,viewer));
  const started=Date.now();await sleep(850);
  for(let viewer=0;viewer<4;viewer++)for(const stream of room.seats[viewer].streams)service._write(stream,snapshots[viewer]);
  await sync(room);await notice(room,'gang',0,'same-id original snapshot does not restart the notice');
  for(const page of pages)await waitFor(async()=>!(await visible(page)).length,'real 2400ms timer expires',4000);
  const elapsed=Date.now()-started;assert.ok(elapsed<2850,`same-id replay must not add another 850ms: ${elapsed}`);
  for(let viewer=0;viewer<4;viewer++)for(const stream of room.seats[viewer].streams)service._write(stream,snapshots[viewer]);
  await sleep(150);await none('an already expired same-id snapshot cannot replay a notice');
  report.checks.push({realTimerExpiry:true,sameSnapshotDoesNotExtend:true,expiredSnapshotDoesNotReplay:true,elapsedMs:elapsed});
}
const geometryViewports=[{width:390,height:844},{width:375,height:667},{width:1080,height:1920},{width:1440,height:900}];
async function geometry(room,actor,{label='hu',viewports=geometryViewports,screenshots=true}={}){
  for(const viewport of viewports)for(let viewer=0;viewer<4;viewer++){
    const page=pages[viewer];await page.setViewportSize(viewport);
    const data=await page.evaluate(async()=>{
      // ResizeObserver positions the word from measured card bounds. Wait for
      // the new viewport layout and its observer callback before measuring it.
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const game=document.querySelector('#game'),gameBox=game.getBoundingClientRect();
      const rotated=document.documentElement.classList.contains('landscape-rotated');
      const screenRect=element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
      // Seat numbers describe the game surface, so its front/centre assertions
      // use logical landscape coordinates even on a physically portrait phone.
      const rect=element=>{const r=screenRect(element);return rotated
        ?{left:r.top-gameBox.top,right:r.bottom-gameBox.top,top:gameBox.right-r.right,bottom:gameBox.right-r.left}
        :{left:r.left-gameBox.left,right:r.right-gameBox.left,top:r.top-gameBox.top,bottom:r.bottom-gameBox.top};};
      const element=[...document.querySelectorAll('.seat-action-notice')].find(element=>!element.hidden&&element.getClientRects().length);
      const note=element&&rect(element);
      const player=element?Number(element.dataset.player):null;
      const hand=player===null?null:document.querySelector(player===0?'#hand':`#backs-${player}`);
      const cards=hand?[...hand.children].filter(card=>card.getClientRects().length).map(rect):[];
      const anchor=cards.length?{left:Math.min(...cards.map(card=>card.left)),right:Math.max(...cards.map(card=>card.right)),top:Math.min(...cards.map(card=>card.top)),bottom:Math.max(...cards.map(card=>card.bottom))}:null;
      const areas=[...document.querySelectorAll('#hand button,.opponent-rack .tile,.opponent-rack .back,.my-melds .tile,.river .tile,#wall-tail .wall-piece:not(.is-empty),.opponent .portrait,.action-zone:not([hidden]) button:not([hidden]),#hint-btn,.hand-heading,.turn-message,.last-event,.table-center,.wall-tail-meta')]
        .filter(element=>element.getClientRects().length)
        .map(element=>({...rect(element),area:element.id||element.className}))
        .filter(area=>area.right>area.left&&area.bottom>area.top);
      for(const river of document.querySelectorAll('.river')){
        if(!river.getClientRects().length||!river.dataset.label)continue;
        const area=rect(river),style=getComputedStyle(river,'::before');
        const top=area.top+parseFloat(style.top),height=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.2;
        if(Number.isFinite(top)&&height>0&&area.right>area.left)areas.push({...area,top,bottom:top+height,area:`${river.id}::before`});
      }
      const collisions=note?areas.filter(area=>Math.min(note.right,area.right)-Math.max(note.left,area.left)>.5&&Math.min(note.bottom,area.bottom)-Math.max(note.top,area.top)>.5):[];
      return {note,screenNote:element&&screenRect(element),anchor,player,handCount:cards.length,collisions,rotated,landscape:game.clientWidth>game.clientHeight,pointerEvents:element&&getComputedStyle(element).pointerEvents,hudLayer:element?.parentElement===game};
    });
    const context=JSON.stringify({label,viewport,viewer,data});
    assert.ok(data.note,`${label} notice visible for viewer ${viewer}`);
    assert.ok(data.anchor,`${label} notice has a real hand stack anchor`);
    assert.equal(data.player,(actor-viewer+4)%4,'notice is anchored to the acting relative seat');
    assert.equal(data.landscape,true,'in-room game surface must remain landscape');
    assert.equal(data.rotated,viewport.height>viewport.width,'physical portrait viewport uses the landscape rotation fallback');
    assert.equal(data.hudLayer,true,'notice uses the flat stage HUD so projected card coordinates are not transformed twice');
    assert.ok(data.screenNote.left>=0&&data.screenNote.right<=viewport.width+1&&data.screenNote.top>=0&&data.screenNote.bottom<=viewport.height+1,`notice remains inside the physical screen: ${context}`);
    const horizontal=data.player===0||data.player===2;
    const centreError=Math.abs(horizontal?(data.note.left+data.note.right-data.anchor.left-data.anchor.right)/2:(data.note.top+data.note.bottom-data.anchor.top-data.anchor.bottom)/2);
    assert.ok(centreError<=1,`notice is centred on the actual concealed hand, not the rack or table: ${context}`);
    const facesFelt=data.player===0?data.note.bottom<=data.anchor.top:data.player===2?data.note.top>=data.anchor.bottom:data.player===3?data.note.left>=data.anchor.right:data.note.right<=data.anchor.left;
    assert.ok(facesFelt,`notice sits in front of its own hand toward the table centre: ${context}`);
    assert.deepEqual(data.collisions,[],`notice avoids cards, wall, portraits, controls and text: ${context}`);
    assert.equal(data.pointerEvents,'none','decorative notice must not block game hit targets');
    report.geometry.push({label,...viewport,viewer,relative:data.player,handCount:data.handCount,centreError,rotated:data.rotated,landscape:true,inBounds:true,noOverlap:true,facesFelt:true});
    if(screenshots&&viewport.width===390){const screenshot=path.join(output,`ui-action-notice-${label}-seat${viewer}-390x844.png`);await page.screenshot({path:screenshot});report.screenshots.push(screenshot);}
  }
}
try{
  pages.push(await player('动作甲'));await pages[0].locator('#room-create').click();await pages[0].locator('#room-waiting:not([hidden])').waitFor();
  const code=(await pages[0].locator('#room-current-code').textContent()).trim();
  for(const name of ['动作乙','动作丙','动作丁']){const page=await player(name);pages.push(page);await page.locator('#room-code').fill(code);await page.locator('#room-join').click();await page.locator('#room-waiting:not([hidden])').waitFor();}
  const room=service.rooms.get(code);await waitFor(()=>room.seats.every(seat=>seat.connected),'four real SSE identities');
  for(const page of pages)await page.locator('#room-ready:enabled').click();await waitFor(()=>room.seats.every(seat=>seat.ready),'all ready');
  await pages[0].locator('#room-start:enabled').click();await waitFor(()=>room.game,'real game start');await sync(room);await none('ordinary dealing has no action notice');
  const names=room.seats.map(seat=>seat.name);
  await publish(room,actionFixture({names}));await click(room,0,{kind:'redGang'});await notice(room,'gang',0,'red single kong');await expiredReplay(room);
  await click(room,0,{kind:'piziGang'});await notice(room,'gang',0,'indicator single kong');await geometry(room,0,{label:'special-kongs',viewports:[geometryViewports[0]],screenshots:false});
  report.actions.push({kind:'redGang',actor:0},{kind:'piziGang',actor:0});
  const scenarios=[
    {seat:1,hand:[0,2,...scattered.filter(tile=>tile!==0&&tile!==2).slice(0,11)],discard:1,action:{kind:'chi',sequence:[0,1,2]}},
    {seat:2,hand:[27,27,...scattered.slice(0,11)],discard:27,action:{kind:'peng'}},
    {seat:3,hand:[28,28,28,...scattered.slice(0,10)],discard:28,action:{kind:'gang',tile:28,mode:'exposed'}},
    {seat:1,hand:[29,29,29,29,...scattered.slice(0,10)],action:{kind:'gang',tile:29,mode:'concealed'}},
    {seat:2,hand:[30,...scattered.slice(0,10)],melds:[{kind:'peng',tiles:[30,30,30],from:1,concealed:false}],action:{kind:'gang',tile:30,mode:'added'}},
  ];
  for(const [index,scenario] of scenarios.entries()){await publish(room,actionFixture({...scenario,names}));await click(room,scenario.seat,scenario.action);if(room.game.phase.kind==='claim')await none('unresolved claim must not announce an action');await passes(room);await notice(room,scenario.action.kind,scenario.seat,scenario.action.mode||scenario.action.kind);await geometry(room,scenario.seat,{label:scenario.action.mode||scenario.action.kind,viewports:[geometryViewports[index%geometryViewports.length]],screenshots:false});report.actions.push({kind:scenario.action.kind,mode:scenario.action.mode,actor:scenario.seat});}
  await publish(room,competition(names));await click(room,1,{kind:'chi',sequence:[0,1,2]});assert.equal(room.game.phase.kind,'claim');await none('submitted chi awaiting a higher-priority response is not announced');
  await click(room,2,{kind:'peng'});if(room.game.phase.kind==='claim')await none('pending peng remains unannounced');await passes(room);await notice(room,'peng',2,'higher-priority peng defeats chi');assert.equal(room.game.players[1].melds.length,0);assert.equal(room.game.players[2].melds[0].kind,'peng');report.checks.push({unresolvedClaimSilent:true,losingChiSilent:true,winningPengOnly:true});
  await publish(room,actionFixture({names}));const version=room.version,before=JSON.stringify(room.game);const url=`${baseURL}/api/rooms/${code}/action`;expected409.add(url);
  const rejected=await pages[1].request.post(url,{headers:{Authorization:`Bearer ${room.seats[1].token}`},data:{action:{kind:'peng'},version,requestId:'illegal-notice-proof'}});assert.equal(rejected.status(),409);assert.equal(room.version,version);assert.equal(JSON.stringify(room.game),before);await none('illegal action cannot create a notice');report.checks.push({illegalActionSilent:true});
  await publish(room,actionFixture({seat:3,hand:[0,0,2,2,3,3,5,5,6,6,8,8,27,27],names}));await click(room,3,{kind:'hu'});assert.equal(room.game.result.kind,'win');
  for(const page of pages){await page.locator('#result-dialog[open]').waitFor();await page.locator('#result-dialog [data-close]').click();}
  await notice(room,'hu',3,'self-draw Hu');await sleep(2650);await notice(room,'hu',3,'Hu persists beyond transient timeout');await geometry(room,3);report.actions.push({kind:'hu',actor:3});
  assert.equal(new Set(Object.values(report.colors)).size,4,'chi, peng, gang and hu have four distinct visible colors');
  await pages[0].reload({waitUntil:'domcontentloaded'});await waitFor(()=>pages[0].evaluate(()=>window.mahjongRoom.status==='connected'),'owner reload restores settled room');await sync(room);await pages[0].locator('#result-dialog[open]').waitFor();await notice(room,'hu',3,'settlement reload retains Hu notice');
  const round=room.game.round;await pages[0].locator('#next-round:visible:enabled').click();await waitFor(()=>room.game.round===round+1,'real next round');await sync(room);await none('next round clears persistent Hu notice');report.checks.push({huPersists:true,refreshPreservesHu:true,nextRoundClearsHu:true});
  // This physical fixture has four ordinary kongs per player, all seven
  // special kongs, full visible rivers and just one/two concealed tiles.
  // A genuine legal Hu keeps the announcement alive for the viewport sweep.
  const crowded=maximumPublicFixture(names);crowded.lastDraw={player:0,tile:crowded.players[0].hand.at(-1),index:crowded.players[0].hand.length-1,replacement:true};
  await publish(room,crowded);await click(room,0,{kind:'hu'});
  for(const page of pages){await page.locator('#result-dialog[open]').waitFor();await page.locator('#result-dialog [data-close]').click();}
  await notice(room,'hu',0,'maximum public rack Hu');await geometry(room,0,{label:'maximum-public'});
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify(report,null,2));
}catch(error){report.failure=redact(error.stack);throw error;}
finally{writeFileSync(path.join(output,'ui-action-notices.json'),JSON.stringify(report,null,2));await Promise.allSettled(contexts.map(context=>context.close()));await browser.close();service.close();const closed=once(server,'close');server.close();server.closeAllConnections();await closed;}
