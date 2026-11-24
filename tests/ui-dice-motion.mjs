import {ensureReady} from './ui-ready.mjs';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {installVisualGeometry} from './browser-geometry.mjs';

const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const output=process.env.KK_UI_OUTPUT||'output/dice-review-20261106';mkdirSync(output,{recursive:true});
const service=new RoomService({botDelayMs:600000}),server=createServer({roomService:service});
server.listen(0,'127.0.0.1');await once(server,'listening');
const target=process.env.KK_UI_TARGET_URL||'http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}),contexts=[];
const baseline='5c755cb8af4a49b3ef6d1aeaefee7aca242505ed';
const prior=new Map(['app.js','landscape.css'].map(f=>[f,execFileSync('git',['show',baseline+':'+f])]));
const report={passed:false,baseline,target,timing:[],orbits:[],pairs:[],lifecycle:[],errors:[],resources:[],screenshots:[],note:'Real browser clocks and automatic completion. All 36 dice pairs use a controlled existing engine dice stream in isolated server rounds, not naturally sampled rounds. The comparison uses the formal pre-orbit client and the same opening gate as the delivery.'};
const idle=page=>page.waitForFunction(()=>!document.querySelector('#game').matches('.is-dice-intro,.is-opening-deal')&&!window.mahjongRoom.room?.opening&&!window.mahjongRoom.busy);

// Measure projected points on the actual elements within the same browser frame.
// A rotating die's axis-aligned bounding box is not its projected outline.
function installOrbitSampling() {
 document.addEventListener('DOMContentLoaded',()=>{
  const holder=document.querySelector('#table-dice'),intro=document.querySelector('#dice-intro');
  const makeProbe=()=>{
   const node=document.createElement('span');
   node.style.cssText='position:absolute;width:0;height:0;pointer-events:none;visibility:hidden';
   return node;
  };
  const probes=Array.from({length:15},makeProbe);
  const read=(probe)=>{const {x,y}=probe.getBoundingClientRect();return{x,y};};
  const px=(value,size)=>parseFloat(value)*(value.endsWith('%')?size/100:1);
  const position=(probe,x,y)=>{probe.style.left=x+'px';probe.style.top=y+'px';};
  const sample=(dice,includeWell)=>{
   const placements=[],styles=dice.map(die=>getComputedStyle(die));
   const prior=dice.map(die=>die.style.position);
   if(includeWell){
    const {width,height}=getComputedStyle(holder),w=parseFloat(width),h=parseFloat(height);
    const s=getComputedStyle(holder.parentElement,'::before');
    const left=px(s.left,w)+parseFloat(s.borderLeftWidth),right=w-px(s.right,w)-parseFloat(s.borderRightWidth);
    const top=px(s.top,h)+parseFloat(s.borderTopWidth),bottom=h-px(s.bottom,h)-parseFloat(s.borderBottomWidth);
    const cx=(left+right)/2,cy=(top+bottom)/2,rx=(right-left)/2,ry=(bottom-top)/2;
    [[cx-rx,cy-ry],[cx+rx,cy-ry],[cx+rx,cy+ry],[cx-rx,cy+ry],[cx,cy]].forEach(([x,y],i)=>{
     position(probes[i+10],x,y);placements.push([holder,probes[i+10]]);
    });
   }
   dice.forEach((die,index)=>{
    const s=styles[index],w=parseFloat(s.width),h=parseFloat(s.height);
    const left=parseFloat(s.borderLeftWidth),top=parseFloat(s.borderTopWidth);
    if(s.position==='static')die.style.position='relative';
    [[0,0],[w,0],[w,h],[0,h],[w/2,h/2]].forEach(([x,y],i)=>{
     const probe=probes[index*5+i];position(probe,x-left,y-top);placements.push([die,probe]);
    });
   });
   try{
    for(const [element,probe] of placements)element.append(probe);
    const bodies=dice.map((n,i)=>({center:read(probes[i*5+4]),quad:probes.slice(i*5,i*5+4).map(read),
     value:Number(n.dataset.value)||n.querySelectorAll('i').length,key:n.classList.contains('is-key')}));
    if(!includeWell)return {dice:bodies};
    const well=probes.slice(10,14).map(read),{tablePlane,intersects}=window.visualGeometry;
    const corners=tablePlane(well)(bodies.flatMap(die=>die.quad));
    return {dice:bodies,well,center:read(probes[14]),
     rimRatio:Math.max(...corners.map(({x,y})=>2*Math.hypot(x-.5,y-.5))),
     overlap:intersects(bodies[0].quad,bodies[1].quad,0)};
   }finally{
    for(const [,probe] of placements)probe.remove();
    dice.forEach((die,i)=>{if(die.style.position!==prior[i])die.style.position=prior[i];});
   }
  };
  let captured=false;
  new MutationObserver(()=>{
   const phase=intro.dataset.phase;
   if(phase==='settled'&&captured&&!window.__diceOrbit.rest)window.__diceOrbit.rest=sample([...holder.children],false);
   if(phase!=='rolling'||captured)return;
   captured=true;
   const dice=[...holder.children],frames=[];
   window.__diceOrbit={frames,timeOrigin:performance.timeOrigin};
   const frame=()=>{
    if(intro.dataset.phase!=='rolling')return;
    const measurements=sample(dice,true);
    const time=Math.max(0,...dice.flatMap(die=>die.getAnimations().map(a=>Number(a.currentTime)||0)));
    frames.push({time,at:performance.now(),viewWidth:innerWidth,...measurements,sameDice:dice.every((die,i)=>holder.children[i]===die)});
    requestAnimationFrame(frame);
   };
   requestAnimationFrame(frame);
  }).observe(intro,{attributes:true,attributeFilter:['data-phase']});
 });
}

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function assertOrbit({frames,rest},size,resizeTo){
 assert.ok(frames.length>=18&&frames[0].time<100&&frames.at(-1).time>=960,'sample the full roll, including the settled tail');
 assert.ok(frames.every(frame=>frame.sameDice),'keep the same A/B identities even after their sides switch');
 const rimRatio=Math.max(...frames.map(frame=>frame.rimRatio));
 assert.ok(rimRatio<=1.015,'physical corners stay inside the recess, including during resize; max ratio '+rimRatio);
 assert.ok(frames.every(frame=>!frame.overlap),'projected die outlines never intersect');
 const tail=frames.at(-1).dice;
 const drift=Math.max(...tail.map((die,i)=>distance(die.center,rest.dice[i].center)));
 assert.ok(drift<1,'last moving centers align with the static centers');
 assert.deepEqual(tail.map(die=>[die.value,die.key]),rest.dice.map(die=>[die.value,die.key]),'final values and their gold outlines are present before settling');
 if(resizeTo){
  const after=frames.filter(frame=>frame.viewWidth===resizeTo.width);
  assert.ok(after.length>=8&&after[0].time<800,'sample the resized tray before the roll settles');
  return {size,resizeTo,samples:frames.length,resizedSamples:after.length,rimRatio,drift};
 }
 // Use the projected common tray center, not the angle of each die's own rotation.
 const turns=[0,1].map(i=>{
  const angles=frames.map(frame=>{const point=frame.dice[i].center;return Math.atan2(point.y-frame.center.y,point.x-frame.center.x);});
  const delta=angles.slice(1).map((angle,j)=>Math.atan2(Math.sin(angle-angles[j]),Math.cos(angle-angles[j])));
  return {delta,total:delta.reduce((sum,step)=>sum+step,0)};
 });
 const direction=Math.sign(turns[0].total);
 for(const turn of turns){
  assert.ok(turn.total*direction>1.95*Math.PI&&turn.total*direction<2.05*Math.PI,'both centers complete one turn in the same direction');
  assert.ok(turn.delta.every(step=>step*direction>=-.035&&Math.abs(step)<1),'turn advances continuously, without reversals or a teleport');
 }
 const sides=frame=>Math.sign(frame.dice[0].center.x-frame.dice[1].center.x);
 assert.ok(frames.some(frame=>frame.time>450&&frame.time<550&&sides(frame)===-sides(frames[0])),'half a turn swaps left and right');
 assert.equal(sides(frames.at(-1)),sides(frames[0]),'both dice return to their own side');
 const crossings=frames.filter(frame=>{
  const [a,b]=frame.dice;
  const width=distance(frame.well[0],frame.well[1]),height=distance(frame.well[0],frame.well[3]);
  return Math.abs(a.center.x-b.center.x)<width*.16&&Math.abs(a.center.y-b.center.y)>height*.37;
 });
 const fronts=new Set(crossings.map(frame=>Math.sign(frame.dice[0].center.y-frame.dice[1].center.y)));
 assert.ok(fronts.has(1)&&fronts.has(-1),'both front/back crossings remain visible on the projected tray');
 return {size,samples:frames.length,turnsDeg:turns.map(turn=>turn.total*180/Math.PI),rimRatio,drift,
  minimumCenterGap:Math.min(...frames.map(frame=>distance(frame.dice[0].center,frame.dice[1].center)))};
}

async function open(version,size,motion='no-preference',resizeTo=null){
 const context=await browser.newContext({viewport:size,reducedMotion:motion});contexts.push(context);
 if(version==='before')await context.route('**/*',route=>{const f=new URL(route.request().url()).pathname.slice(1),body=prior.get(f);return body?route.fulfill({body,contentType:f.endsWith('.css')?'text/css':'text/javascript'}):route.continue();});
 if(version==='after'&&motion!=='reduce'){
  await context.addInitScript(installVisualGeometry);
  await context.addInitScript(installOrbitSampling);
 }
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
 for(const seat of[1,2,3])await page.locator('.room-bot-add[data-seat="'+seat+'"]').click();await ensureReady(page);
 const capture=process.env.KK_DICE_CAPTURE==='1'&&version==='after'&&motion!=='reduce'&&!resizeTo&&!report.orbits.some(row=>row.size.width===size.width);
 const images=[];
 const cdp=capture?await context.newCDPSession(page):null;
 if(cdp){
  cdp.on('Page.screencastFrame',frame=>{
   if(frame.metadata.timestamp)images.push({at:frame.metadata.timestamp*1000,data:frame.data});
   void cdp.send('Page.screencastFrameAck',{sessionId:frame.sessionId}).catch(()=>{});
  });
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:90,everyNthFrame:1});
 }
 await page.locator('#room-start').click();
 await page.waitForFunction(()=>window.__motion.phases.length>0);
 if(resizeTo){
  await page.waitForFunction(()=>window.__diceOrbit?.frames.at(-1)?.time>=350);
  await page.setViewportSize(resizeTo);
 }
 await idle(page);
 if(cdp){await cdp.send('Page.stopScreencast');await cdp.detach();}
 const data=await page.evaluate(()=>window.__motion),phases=data.phases;
 assert.deepEqual(phases.map(p=>p.phase),motion==='reduce'?['showing','idle']:['rolling','settled','enlarging','showing','idle']);
 assert.ok(phases.filter(p=>p.phase!=='idle').every(p=>p.enabled===0));
 const at=name=>phases.find(p=>p.phase===name)?.time;
 const measured={version,size,motion,roll:motion==='reduce'?0:at('settled')-at('rolling'),settled:motion==='reduce'?0:at('enlarging')-at('settled'),enlarge:motion==='reduce'?0:at('showing')-at('enlarging'),holdTimer:data.dismissAt-at('showing'),hold:at('idle')-at('showing'),total:at('idle')-phases[0].time,dealPreparation:motion==='reduce'?0:data.deals[0]-data.dismissAt,dealGap:motion==='reduce'?null:data.deals[0]-at('idle'),frames:data.frames.length};
 if(motion!=='reduce'){assert.equal(data.deals.length,1);assert.ok(measured.dealGap>=0&&measured.dealGap<500,'no second wait before dealing');}
 const runSuffix=resizeTo?'-resize-'+resizeTo.width:report.orbits.some(row=>row.size.width===size.width)?'-repeat':'';
 report.timing.push({...measured,resizeTo});writeFileSync(output+'/motion-'+version+'-'+size.width+'-'+motion+runSuffix+'.json',JSON.stringify(data,null,2));
 if(version==='after'){
  assert.ok(measured.holdTimer>=750&&measured.holdTimer<1175&&measured.hold<1400,'readable 800ms hold');
  if(motion!=='reduce'){
   assert.ok(measured.roll>=985&&measured.roll<1500&&measured.settled>=110&&measured.settled<260&&measured.enlarge>=285&&measured.enlarge<470,'preserve the 1000/120/300ms opening stages');
   const orbit=await page.evaluate(()=>window.__diceOrbit);
   writeFileSync(output+'/orbit-'+size.width+runSuffix+'.json',JSON.stringify(orbit,null,2));
   report.orbits.push(assertOrbit(orbit,size,resizeTo));
   if(cdp&&images.length){
    const nearest=(rows,time,getTime)=>rows.reduce((a,b)=>Math.abs(getTime(b)-time)<Math.abs(getTime(a)-time)?b:a);
    const moments=[['front',350],['half',500],['back',650],['roll-tail',980]].map(([name,time])=>[
     name,nearest(orbit.frames,time,frame=>frame.time).at
    ]);
    moments.push(['settled',at('settled')+70],['showing',at('showing')+80],['dealing',data.deals[0]+160]);
    for(const [name,at] of moments){
     const shot=nearest(images,orbit.timeOrigin+at,image=>image.at),file=output+'/opening-'+size.width+'-'+name+'.jpg';
     writeFileSync(file,Buffer.from(shot.data,'base64'));
     report.screenshots.push({file,msFromRequestedFrame:shot.at-orbit.timeOrigin-at});
    }
   }
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
  const resized=await open('after',sizes[1],'no-preference',sizes[0]);
  await resized.page.evaluate(()=>window.mahjongRoom.leave());await resized.context.close();
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
