import {ensureReady} from './ui-ready.mjs';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';

const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const output=process.env.KK_UI_OUTPUT||'output/dice-review-20261106';mkdirSync(output,{recursive:true});
const service=new RoomService({botDelayMs:600000}),server=createServer({roomService:service});
server.listen(0,'127.0.0.1');await once(server,'listening');
const target=process.env.KK_UI_TARGET_URL||'http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}),contexts=[];
const baseline='fceddc011f6f33505a9160673639088cad164341';
const prior=new Map(['app.js','landscape.css','src/ui/opening-deal.js','src/ui/flat-opponents.js'].map(f=>[f,execFileSync('git',['show',baseline+':'+f])]));
const report={passed:false,baseline,target,timing:[],pairs:[],lifecycle:[],errors:[],resources:[],screenshots:[],note:'Real browser clocks and automatic completion. All 36 dice pairs use a controlled existing engine dice stream in isolated server rounds, not naturally sampled rounds. The frozen prior UI is explicitly released by the local controller to reproduce its former immediate-play contract.'};
const idle=page=>page.waitForFunction(()=>!document.querySelector('#game').matches('.is-dice-intro,.is-opening-deal')&&!window.mahjongRoom.room?.opening&&!window.mahjongRoom.busy);

async function open(version,size,motion='no-preference'){
 const context=await browser.newContext({viewport:size,reducedMotion:motion});contexts.push(context);
 if(version==='before')await context.setExtraHTTPHeaders({'X-KK-Opening':'1'});
 if(version==='before')await context.route('**/*',route=>{const f=new URL(route.request().url()).pathname.slice(1),body=prior.get(f);return body?route.fulfill({body,contentType:f.endsWith('.css')?'text/css':'text/javascript'}):route.continue();});
 await context.addInitScript(()=>{
  localStorage.setItem('queqi-settings',JSON.stringify({sound:false}));
  Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:()=>Promise.reject(Error('fixed review viewport'))});
  const hidden=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'hidden');
  Object.defineProperty(HTMLElement.prototype,'hidden',{configurable:true,get:hidden.get,set(value){if(this.id==='dice-intro'&&value&&this.dataset.phase==='showing'&&window.__motion)window.__motion.dismissAt=performance.now();hidden.set.call(this,value);}});
  document.addEventListener('DOMContentLoaded',()=>{
   window.__motion={phases:[],frames:[],deals:[],faces:[]};
   const intro=document.querySelector('#dice-intro'),holder=document.querySelector('#table-dice'),stage=document.querySelector('#game');let last='idle',lastRound=null,sampling=false;
   const sample=time=>{
    sampling=false;if(intro.dataset.phase!=='rolling')return;
    const dice=[...holder.children];
    window.__motion.frames.push({time,dice:dice.map(n=>({value:Number(n.dataset.value)||n.children.length,transform:getComputedStyle(n).transform,points:[...n.children].filter(p=>p.style.opacity!=='0').map(p=>p.style.gridArea),animation:n.getAnimations()[0]?.currentTime??null}))});
    sampling=true;requestAnimationFrame(sample);
   };
   new MutationObserver(()=>{
    const phase=intro.dataset.phase||'idle',round=window.mahjongGame.round;if(phase===last&&(phase==='idle'||round===lastRound)){lastRound=round;return;}last=phase;lastRound=round;
    window.__motion.phases.push({phase,round,time:performance.now(),enabled:stage.querySelectorAll('#hand button:enabled').length,faces:[...holder.children].map(n=>Number(n.dataset.value)||n.children.length)});
    if(phase==='rolling'&&!sampling){sampling=true;requestAnimationFrame(sample);}
   }).observe(intro,{attributes:true,attributeFilter:['data-phase']});
   new MutationObserver(records=>{if(records.some(r=>r.target.id==='opening-deal')&&document.querySelector('#opening-deal')?.dataset.phase==='running')window.__motion.deals.push(performance.now());}).observe(stage,{subtree:true,attributes:true,attributeFilter:['data-phase']});
   new MutationObserver(()=>window.__motion.faces.push({time:performance.now(),values:[...holder.children].map(n=>Number(n.dataset.value)||n.children.length)})).observe(holder,{subtree:true,attributes:true,attributeFilter:['data-value']});
  });
 });
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)report.resources.push({url:r.url(),status:r.status()});});
 page.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')report.resources.push({url:r.url(),error:r.failure()?.errorText});});
 await page.goto(target,{waitUntil:'networkidle'});await page.locator('#room-name').fill('骰子运动审核');await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();
 const code=(await page.locator('#room-current-code').textContent()).trim();
 for(const seat of[1,2,3])await page.locator('.room-bot-add[data-seat="'+seat+'"]').click();await ensureReady(page);await page.locator('#room-start').click();
 await page.waitForFunction(()=>window.__motion.phases.length>0);
 const room=service.rooms.get(code);if(version==='before'&&room?.opening)service.openingComplete(code,room.seats[0].token,{id:room.opening.id});
 await idle(page);
 const data=await page.evaluate(()=>window.__motion),phases=data.phases;
 assert.deepEqual(phases.map(p=>p.phase),motion==='reduce'?['showing','idle']:['rolling','settled','enlarging','showing','idle']);
 assert.ok(phases.filter(p=>p.phase!=='idle').every(p=>p.enabled===0));
 const at=name=>phases.find(p=>p.phase===name)?.time;
 const measured={version,size,motion,roll:motion==='reduce'?0:at('settled')-at('rolling'),settled:motion==='reduce'?0:at('enlarging')-at('settled'),enlarge:motion==='reduce'?0:at('showing')-at('enlarging'),holdTimer:data.dismissAt-at('showing'),hold:at('idle')-at('showing'),total:at('idle')-phases[0].time,dealPreparation:motion==='reduce'?0:data.deals[0]-data.dismissAt,dealGap:motion==='reduce'?null:data.deals[0]-at('idle'),frames:data.frames.length};
 if(motion!=='reduce'){assert.equal(data.deals.length,1);assert.ok(measured.dealGap>=0&&measured.dealGap<500,'no second wait before dealing');}
 report.timing.push(measured);writeFileSync(output+'/motion-'+version+'-'+size.width+'-'+motion+'.json',JSON.stringify(data,null,2));
 if(version==='after'){
  assert.ok(measured.hold>=750&&measured.hold<1400,'readable 800ms hold');
  if(motion!=='reduce'){
   assert.ok(data.frames.length>10);assert.ok(data.frames.some(f=>f.dice[0].transform!==f.dice[1].transform),'dice use distinct motion tracks');
   const end=data.frames.at(-1);for(const die of end.dice){const values=die.transform.slice(die.transform.indexOf('(')+1).match(/-?[\d.]+(?:e[+-]?\d+)?/gi)?.map(Number)||[],diagonal=values.length===16?[0,5,10,15]:[0,3];assert.ok(die.transform==='none'||values.every((v,i)=>Math.abs(v-(diagonal.includes(i)?1:0))<.05),'last observed roll frame approaches its stable pose');}
  }
 }
 return {page,context,room:service.rooms.get(code)};
}

async function fixture(page,pair,room){
 await page.evaluate(()=>{window.__motion={phases:[],frames:[],deals:[],faces:[]};});
 const random=room.game._diceRandom,values=[...pair];room.game._diceRandom=()=> (values.shift()-.5)/6;room.game.newRound();room.game._diceRandom=random;service._beginOpening(room);service._changed(room);
 await page.waitForFunction(()=>document.querySelector('#dice-intro').dataset.phase==='showing');
}

try{
 const sizes=[{width:640,height:360},{width:1920,height:1080}];
 for(const size of sizes){
  if(!process.env.KK_UI_TARGET_URL){const old=await open('before',size);await old.page.evaluate(()=>window.mahjongRoom.leave());await old.context.close();}
  const current=await open('after',size);await current.page.evaluate(()=>window.mahjongRoom.leave());await current.context.close();
 }
 if(!process.env.KK_UI_TARGET_URL){
  const old=await open('before',sizes[0],'reduce');await old.page.evaluate(()=>window.mahjongRoom.leave());await old.context.close();
  for(const size of sizes){const a=report.timing.find(r=>r.version==='before'&&r.size.width===size.width&&r.motion==='no-preference'),b=report.timing.find(r=>r.version==='after'&&r.size.width===size.width);assert.ok(Math.abs(a.holdTimer-b.holdTimer)<250,'800ms readable hold is preserved');assert.ok(b.total<a.total+500,'authority gating adds no wait to the presentation');assert.ok(b.roll<a.roll+250&&b.settled<a.settled+150&&b.enlarge<a.enlarge+150);}
 }
 const current=await open('after',sizes[0],'reduce');await current.page.emulateMedia({reducedMotion:'no-preference'});
 if(!process.env.KK_UI_TARGET_URL){
  for(let first=1;first<=6;first++)for(let second=1;second<=6;second++){
   const pair=[first,second];await fixture(current.page,pair,current.room);
   const result=await current.page.evaluate(()=>{
    const read=selector=>[...document.querySelector(selector).children].map(n=>({value:n.children.length,points:[...n.children].map(p=>p.style.gridArea).sort(),key:n.classList.contains('is-key'),transform:getComputedStyle(n).transform}));
    return{central:read('#table-dice'),shown:read('#dice-intro-dice'),truth:window.mahjongGame.wallInfo.dice,history:window.__motion.phases,frames:window.__motion.frames};
   });
   assert.deepEqual(result.truth,pair);assert.deepEqual(result.central.map(n=>n.value),pair);assert.deepEqual(result.shown.map(n=>n.value),pair);
   for(let i=0;i<2;i++){assert.deepEqual(result.central[i].points,result.shown[i].points);assert.equal(result.central[i].key,pair[i]===Math.min(...pair));assert.equal(result.central[i].transform,'none');}
   assert.ok(result.frames.length>3);
   assert.ok(result.frames.slice(-3).every(f=>f.dice.every((d,i)=>d.value===pair[i]&&JSON.stringify(d.points.slice().sort())===JSON.stringify(result.central[i].points))),'last roll frames already show the exact final pips before cleanup');
   report.pairs.push({pair,correctFaces:true,correctPipPositions:true,stableOrientation:true,finalBeforeCleanup:true});
   await current.page.evaluate(()=>{document.querySelector('#dice-intro').click();document.querySelector('#dice-intro').click();});
   assert.equal(await current.page.evaluate(()=>window.__motion.deals.length),1,'duplicate dismiss advances the deal once');
  }
 }
 await current.page.evaluate(()=>window.mahjongRoom.leave());await current.context.close();
 if(!process.env.KK_UI_TARGET_URL){
  // Real incoming round snapshots must pass through roomChanged, which cancels the previous intro.
  const live=await open('after',sizes[0]),room=live.room;
  clearTimeout(room.botTimer);room.game.newRound('dice-cancel-first');service._beginOpening(room);service._changed(room);
  await live.page.waitForFunction(()=>document.querySelector('#dice-intro').dataset.phase==='rolling');await live.page.waitForTimeout(180);
  await live.page.evaluate(()=>{window.__motion={phases:[],frames:[],deals:[],faces:[]};});
  clearTimeout(room.botTimer);room.game.newRound('dice-cancel-replacement');service._beginOpening(room);service._changed(room);const nextRound=room.game.round;
  await live.page.waitForFunction(round=>window.mahjongGame.round===round&&document.querySelector('#dice-intro').dataset.phase==='rolling',nextRound);
  await idle(live.page);const lifecycle=await live.page.evaluate(()=>window.__motion);writeFileSync(output+'/lifecycle.json',JSON.stringify(lifecycle,null,2));
  const phases=lifecycle.phases.filter(r=>r.round===nextRound);assert.deepEqual(phases.map(r=>r.phase),['rolling','settled','enlarging','showing','idle']);assert.ok(phases[1].time-phases[0].time>=1000,'replacement roll is not finished by old callbacks');assert.ok(lifecycle.frames.at(-1).dice.every((d,i)=>d.animation>=[940*.96,35+965*.96][i]),'each CSS track reaches its own settled tail before cleanup');assert.equal(lifecycle.deals.length,1);report.lifecycle.push({cancelAndRestart:true,realRoundSnapshots:true,oldCallbacksIgnored:true,cssClockSettled:true,dealOnce:true});
  await live.page.evaluate(()=>window.mahjongRoom.leave());await live.context.close();
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.resources,[]);report.passed=true;
}catch(error){report.failure=error.stack;throw error;}
finally{
 for(const context of contexts)for(const page of context.pages())try{await page.evaluate(()=>window.mahjongRoom?.room?window.mahjongRoom.leave():true);}catch{}
 writeFileSync(output+(process.env.KK_UI_TARGET_URL?'/motion-online.json':'/motion-local.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,timing:report.timing,pairs:report.pairs.length,lifecycle:report.lifecycle,errors:report.errors,resources:report.resources}));
 await Promise.allSettled(contexts.map(c=>c.close()));await browser.close();service.close();server.closeAllConnections();await new Promise(r=>server.close(r));
}
