import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';

const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const service=new RoomService({botDelayMs:600000}),server=createServer({roomService:service});
server.listen(0,'127.0.0.1');await once(server,'listening');
const target=process.env.KK_UI_TARGET_URL||`http://127.0.0.1:${server.address().port}`;
const baseline=execFileSync('git',['show','83a63dd:landscape.css'],{encoding:'utf8'});
const current=process.env.KK_UI_TARGET_URL?await(await fetch(target+'/landscape.css')).text():readFileSync('landscape.css','utf8');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const output=process.env.KK_UI_OUTPUT||'output/dice-review-20261106';
const contexts=[],report={passed:false,cases:[],errors:[],resources:[],screenshots:0};mkdirSync(output,{recursive:true});
async function setup(size,reducedMotion='no-preference',startHidden=false){
  const context=await browser.newContext({viewport:size,hasTouch:size.width<1000,reducedMotion});contexts.push(context);
  if(startHidden)await context.addInitScript(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
  });
  await context.addInitScript(()=>{
    localStorage.setItem('queqi-settings',JSON.stringify({sound:false}));
    Object.defineProperty(Element.prototype,'requestFullscreen',{value:()=>Promise.reject(Error('dice fixture'))});
    if(screen.orientation)Object.defineProperty(screen.orientation,'lock',{value:()=>Promise.reject(Error('dice fixture'))});
    document.addEventListener('DOMContentLoaded',()=>{
      window.__diceHistory=[];window.__diceSamples=[];window.__diceFaceChanges=[];
      let last='idle',pointWatcher=null;
      const intro=document.querySelector('#dice-intro'),holder=document.querySelector('#table-dice');
      new MutationObserver(()=>{
        const phase=intro.dataset.phase||'idle';if(phase===last)return;last=phase;
        if(phase!=='rolling'){pointWatcher?.disconnect();pointWatcher=null;}
        const row={phase,time:performance.now(),round:window.mahjongGame.round,hidden:intro.hidden,enabledHand:document.querySelectorAll('#hand button:enabled').length,
          values:[...holder.children].map(n=>n.children.length),truth:[...window.mahjongGame.wallInfo.dice],
          tracks:[...holder.children].map(n=>({duration:parseFloat(n.style.getPropertyValue('--dice-roll-duration')),delay:parseFloat(n.style.getPropertyValue('--dice-roll-delay'))}))};
        if(phase==='enlarging')row.zoom=document.querySelector('#dice-intro-dice').getAnimations().map(a=>({duration:a.effect.getTiming().duration,frames:a.effect.getKeyframes()}));
        window.__diceHistory.push(row);
        if(phase==='rolling'){
          const dice=[...holder.children],pips=dice.flatMap(n=>[...n.children]);
          const recordPoints=()=>window.__diceFaceChanges.push(dice.map(n=>[Number(n.dataset.value),[...n.children].filter(p=>p.style.opacity==='1').length]));
          recordPoints();pointWatcher=new MutationObserver(recordPoints);
          pointWatcher.observe(holder,{attributes:true,attributeFilter:['data-value'],subtree:true});
          const sample=()=>{
            if(intro.dataset.phase!=='rolling')return;
            const p=document.querySelector('.table-center').getBoundingClientRect();
            window.__diceSamples.push({inside:dice.every(n=>{const r=n.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right&&r.top>=p.top&&r.bottom<=p.bottom;}),
              stable:holder.children[0]===dice[0]&&holder.children[1]===dice[1]&&pips.every(n=>n.isConnected),
              faces:dice.map(n=>[Number(n.dataset.value),[...n.children].filter(p=>p.style.opacity==='1').length]),
              properties:dice.flatMap(n=>n.getAnimations().flatMap(a=>a.effect.getKeyframes().flatMap(f=>Object.keys(f).filter(k=>!['offset','computedOffset','easing','composite'].includes(k))))) });
            requestAnimationFrame(sample);
          };requestAnimationFrame(sample);
        }
      }).observe(intro,{attributes:true,attributeFilter:['data-phase']});
    });
  });
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)report.resources.push({url:r.url(),status:r.status()});});
  page.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')report.resources.push({url:r.url(),error:r.failure()?.errorText});});
  const actions=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/action'))actions.push(r.postDataJSON());});
  await page.goto(target,{waitUntil:'networkidle'});await page.locator('#room-name').fill('两段掷骰验收');await page.locator('#room-create').click();
  await page.locator('#room-waiting:not([hidden])').waitFor();
  const code=(await page.locator('#room-current-code').textContent()).trim();
  for(const seat of[1,2,3])await page.locator(`.room-bot-add[data-seat="${seat}"]`).click();
  await page.locator('#room-ready').click();await page.locator('#room-start').click();
  await page.waitForFunction(()=>window.mahjongRoom.room?.status==='playing');
  return {page,context,actions,room:service.rooms.get(code)};
}
async function sameGeometry(page){
  return page.evaluate(({baseline,current})=>{
    const selector='#game,.table,.table-border,.table-center,#table-dice,#dice-intro,.river,.wall-stack,.opponent-rack,.hand-zone,#hand,.my-melds';
    const read=()=>[...document.querySelectorAll(selector)].map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return [n.id||n.className,[r.x,r.y,r.width,r.height],...['width','height','padding','transform','clip-path','z-index','border-radius'].map(k=>s.getPropertyValue(k))];});
    const before=read(),old=document.querySelector('[data-dice-sheet]')||[...document.querySelectorAll('link[rel=stylesheet]')].find(n=>new URL(n.href).pathname.endsWith('/landscape.css'));
    const style=document.createElement('style');style.dataset.diceSheet='true';style.textContent=baseline;old.replaceWith(style);
    const prior=read();style.textContent=current;return {before,prior,after:read()};
  },{baseline,current});
}
async function idle(page){await page.waitForFunction(()=>!document.querySelector('#game').matches('.is-dice-intro,.is-opening-deal')&&!window.mahjongRoom.room?.opening&&!window.mahjongRoom.busy);}
async function trajectory(page){
  // 合成动画不依赖主线程 rAF 帧率；在不可见的中央原骰子上遍历整个周期，
  // 补足慢速公网无头浏览器的少量真实帧，不降低任何几何边界要求。
  return page.evaluate(()=>{
    const holder=document.querySelector('#table-dice'),dice=[...holder.children];
    const panel=document.querySelector('.table-center').getBoundingClientRect();
    const tracks=window.__diceHistory.find(row=>row.phase==='rolling').tracks;
    dice.forEach((n,i)=>{n.style.setProperty('--dice-roll-duration',tracks[i].duration+'ms');n.style.setProperty('--dice-roll-delay',tracks[i].delay+'ms');});
    holder.classList.add('is-rolling');
    const animations=dice.map(n=>n.getAnimations()[0]);
    if(animations.some(a=>!a))throw Error('Missing transform animation');
    if(animations.some((a,i)=>a.effect.getTiming().iterations!==1||a.effect.getTiming().duration!==tracks[i].duration||a.effect.getTiming().delay!==tracks[i].delay))throw Error('Incorrect single-roll timing');
    const samples=[];
    try{
      animations.forEach(a=>a.pause());
      for(let time=0;time<=1000;time+=5){
        animations.forEach(a=>a.currentTime=time);
        for(const die of dice){const r=die.getBoundingClientRect();samples.push({time,inside:r.left>=panel.left&&r.right<=panel.right&&r.top>=panel.top&&r.bottom<=panel.bottom});}
      }
    }finally{animations.forEach(a=>a.cancel());holder.classList.remove('is-rolling');}
    return samples;
  });
}
try{
  for(const size of[{width:640,height:360},{width:1920,height:1080}]){
    const {page,context,actions,room}=await setup(size);
    await page.waitForFunction(()=>document.querySelector('#dice-intro').dataset.phase==='rolling');
    assert.equal(await page.locator('#dice-intro').isVisible(),false);
    assert.equal(await page.locator('#hand button:enabled').count(),0);
    await page.evaluate(()=>{document.querySelector('#hand button')?.click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
    if(room){service._changed(room);service._changed(room);}
    await page.waitForFunction(()=>document.querySelector('#dice-intro').dataset.phase==='showing');
    const values=await page.evaluate(()=>({central:[...document.querySelector('#table-dice').children].map(n=>n.children.length),shown:[...document.querySelector('#dice-intro-dice').children].map(n=>n.children.length),truth:window.mahjongGame.wallInfo.dice}));
    assert.deepEqual(values.central,values.truth);assert.deepEqual(values.shown,values.truth);
    const measuredZoom=await page.evaluate(()=>{
      const dice=[...document.querySelector('#table-dice').children].map(n=>n.getBoundingClientRect());
      const width=Math.max(...dice.map(r=>r.right))-Math.min(...dice.map(r=>r.left));
      return document.querySelector('#dice-intro-dice').getBoundingClientRect().width/width;
    });
    assert.ok(Math.abs(measuredZoom-1.8)<1e-4,'final visible dice group is 1.8 times the actual center group');
    assert.equal(await page.locator('.deal-flight').count(),0);
    await idle(page);
    const geometry=await sameGeometry(page);assert.deepEqual(geometry.before,geometry.prior);assert.deepEqual(geometry.after,geometry.prior);
    const path=await trajectory(page);assert.equal(path.length,402);assert.ok(path.every(s=>s.inside),'entire single roll remains inside the center panel');
    const data=await page.evaluate(()=>({history:window.__diceHistory,samples:window.__diceSamples,faceChanges:window.__diceFaceChanges}));
    const phases=data.history.map(r=>r.phase);assert.deepEqual(phases,['rolling','settled','enlarging','showing','idle']);
    const duration=data.history[1].time-data.history[0].time;assert.ok(duration>=800&&duration<1600,'about one second of tumbling');
    assert.ok(data.history[2].time>data.history[1].time+80,'final values settle before enlargement');
    const holdDuration=data.history[4].time-data.history[3].time;
    assert.ok(holdDuration>=750&&holdDuration<1400,'the readable hold is now about 800ms, below the former 1500ms: '+holdDuration);
    const zoom=data.history[2].zoom[0];assert.equal(zoom.duration,300);
    const scales=zoom.frames.map(f=>Number(f.transform.match(/scale\(([^)]+)\)/)?.[1]));
    assert.ok(Math.abs(scales.at(-1)/scales[0]-1.8)<1e-5,'1.8 times enlargement within the unchanged display slot');
    assert.ok(data.samples.length>0&&data.samples.every(s=>s.inside&&s.stable));
    assert.ok(data.samples.every(s=>s.faces.every(([value,count])=>value===count)),'all temporary faces use the correct existing pip positions');
    assert.ok(data.faceChanges.every(f=>f.every(([value,count])=>value===count)));
    assert.ok(new Set(data.faceChanges.map(f=>f[0][0])).size>=3,'point mutations change rapidly even when rAF is throttled');
    assert.ok(data.samples.every(s=>s.properties.every(k=>['transform','opacity'].includes(k))));
    assert.equal(actions.length,0);report.cases.push({size,phases,rollDuration:duration,holdDuration,totalDuration:data.history[4].time-data.history[0].time,samples:data.samples.length,trajectorySamples:path.length,insidePanel:true,exactGeometry:true,enlargement:measuredZoom,noInput:true});
    await page.evaluate(()=>window.mahjongRoom.reconnect());await page.waitForFunction(()=>window.mahjongRoom.status==='connected');
    assert.equal(await page.locator('#game.is-dice-intro,#game.is-opening-deal').count(),0);
    await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.mahjongRoom.status==='connected');
    assert.equal(await page.locator('#game.is-dice-intro,#game.is-opening-deal').count(),0);
    if(room){
      clearTimeout(room.botTimer);room.game.newRound('dice-live-snapshot');service._beginOpening(room);service._changed(room);
      await page.waitForFunction(()=>document.querySelector('#dice-intro').dataset.phase==='rolling');
      const counts=await page.evaluate(()=>[...document.querySelectorAll('.opponent-rack .backs')].map(n=>n.children.length));
      const dealer=room.game.dealer,index=room.game.players[dealer].hand.findIndex(t=>t!==31&&t!==room.game.indicatorTile&&t!==room.game.wildTile);
      const before=JSON.stringify(room.game);assert.equal(room.game.discard(dealer,index),false);assert.equal(JSON.stringify(room.game),before);service._changed(room);
      await page.waitForFunction(version=>window.mahjongRoom.room.version>=version,room.version);
      assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('.opponent-rack .backs')].map(n=>n.children.length)),counts,'server advances while presentation keeps its opening fixture');
      await page.locator('#dice-intro').click();await idle(page);
      for(let seat=1;seat<4;seat++)assert.equal(await page.locator(`#backs-${seat} .back`).count(),room.game.players[seat].hand.length);
      report.cases.push({size,serverHeldDuringRoll:true,latestSnapshotAfterDeal:true});
      clearTimeout(room.botTimer);room.game.newRound('dice-refresh-mid-roll');service._beginOpening(room);service._changed(room);
      await page.waitForFunction(()=>document.querySelector('#dice-intro').dataset.phase==='rolling');
      await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.mahjongRoom.status==='connected');
      assert.equal(await page.locator('#game.is-dice-intro,#game.is-opening-deal').count(),0,'refresh mid-roll never replays either animation');
      clearTimeout(room.botTimer);room.game.newRound('dice-reconnect-mid-roll');service._beginOpening(room);service._changed(room);
      await page.waitForFunction(()=>document.querySelector('#dice-intro').dataset.phase==='rolling');
      await page.evaluate(()=>window.mahjongRoom.reconnect());await page.waitForFunction(()=>window.mahjongRoom.status==='connected');
      assert.equal(await page.locator('#game.is-dice-intro,#game.is-opening-deal').count(),0,'reconnect mid-roll clears lock without replay');
      report.cases.push({size,refresh:true,reconnect:true,newRound:true,midRollCleanup:true});
    }
    await page.evaluate(()=>window.mahjongRoom.leave());await context.close();
  }
  // 较高窗口仍使用同一横屏画布，开场不再等待旋转引导。
  for(const motion of ['no-preference','reduce']){
    const portrait=await setup({width:390,height:844},motion);
    assert.equal(await portrait.page.locator('#rotate-guide').count(),0);
    await portrait.page.waitForFunction(()=>document.querySelector('#dice-intro').dataset.phase===(matchMedia('(prefers-reduced-motion: reduce)').matches?'showing':'rolling'));
    assert.equal(await portrait.page.locator('#hand button:enabled').count(),0,'intro locks hand input in a tall viewport');
    const markers=await portrait.page.evaluate(()=>({pending:JSON.parse(sessionStorage.getItem('kk-dice-intro-pending')||'[]'),seen:JSON.parse(sessionStorage.getItem('kk-dice-intro-seen')||'[]')}));
    assert.equal(markers.pending.length,0);assert.equal(markers.seen.length,1);
    await portrait.page.setViewportSize({width:844,height:390});
    const resized=await portrait.page.evaluate(()=>({dice:document.querySelector('#game').classList.contains('is-dice-intro'),active:document.querySelector('#game').matches('.is-dice-intro,.is-opening-deal'),flights:document.querySelectorAll('.deal-flight').length,enabled:document.querySelectorAll('#hand button:enabled').length}));
    if(resized.dice)assert.equal(resized.flights,0,'dealing cannot overtake dice');
    if(resized.active)assert.equal(resized.enabled,0,'resizing preserves input lock until the intro finishes');
    await idle(portrait.page);
    const history=await portrait.page.evaluate(()=>window.__diceHistory),phases=history.map(row=>row.phase);
    assert.ok(history.filter(row=>row.phase!=='idle').every(row=>row.enabledHand===0),'every intro phase locks input before and after resize');
    assert.deepEqual(phases,motion==='reduce'?['showing','idle']:['rolling','settled','enlarging','showing','idle']);
    await portrait.page.setViewportSize({width:390,height:844});
    await portrait.page.setViewportSize({width:844,height:390});
    await portrait.page.waitForTimeout(200);
    assert.equal(await portrait.page.locator('#game.is-dice-intro,#game.is-opening-deal').count(),0,'subsequent rotations never replay');
    report.cases.push({tallViewport:true,reducedMotion:motion==='reduce',noRotationGuide:true,diceBeforeDeal:true,noRotationReplay:true,phases});
    await portrait.page.evaluate(()=>window.mahjongRoom.leave());await portrait.context.close();
  }
  // 隐藏标签页开局不记「已播」；恢复可见且仍在本局开局时补播一次完整流程，之后不再重复。
  const hidden=await setup({width:640,height:360},'no-preference',true);
  await hidden.page.waitForFunction(()=>window.mahjongGame.wallInfo?.dice?.length===2);
  assert.equal(await hidden.page.locator('#game.is-dice-intro,#game.is-opening-deal').count(),0,'hidden start never plays either animation');
  assert.equal(await hidden.page.locator('#dice-intro').isVisible(),false);
  assert.equal(await hidden.page.locator('#hand button:enabled').count(),0);
  const hiddenMarkers=await hidden.page.evaluate(()=>{
    const room=window.mahjongRoom.room,key=`${room.code}:${window.mahjongGame.round}:${window.mahjongGame.wallInfo.dice.join(',')}:${room.opening.id}`;
    return {key,pending:JSON.parse(sessionStorage.getItem('kk-dice-intro-pending')||'[]'),seen:JSON.parse(sessionStorage.getItem('kk-dice-intro-seen')||'[]')};
  });
  assert.ok(hiddenMarkers.pending.includes(hiddenMarkers.key),'hidden start writes a pending marker instead of a seen marker');
  assert.ok(!hiddenMarkers.seen.includes(hiddenMarkers.key),'hidden start never marks the round as seen');
  await hidden.page.evaluate(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await hidden.page.waitForFunction(()=>document.querySelector('#dice-intro').dataset.phase==='rolling');
  await hidden.page.waitForFunction(()=>document.querySelector('#game').matches('.is-opening-deal'));
  assert.ok((await hidden.page.locator('.deal-flight').count())>0,'deal animation follows the replayed intro');
  await idle(hidden.page);
  const hiddenData=await hidden.page.evaluate(()=>({history:window.__diceHistory,
    pending:JSON.parse(sessionStorage.getItem('kk-dice-intro-pending')||'[]'),seen:JSON.parse(sessionStorage.getItem('kk-dice-intro-seen')||'[]')}));
  assert.deepEqual(hiddenData.history.map(r=>r.phase),['rolling','settled','enlarging','showing','idle'],'restored page replays the full opening flow once');
  assert.ok(hiddenData.seen.includes(hiddenMarkers.key)&&!hiddenData.pending.includes(hiddenMarkers.key),'replay marks the round seen and clears the pending marker');
  await hidden.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await hidden.page.waitForTimeout(200);
  assert.equal(await hidden.page.locator('#game.is-dice-intro,#game.is-opening-deal').count(),0,'visibility flips never replay a seen round');
  await hidden.page.reload({waitUntil:'networkidle'});await hidden.page.waitForFunction(()=>window.mahjongRoom.status==='connected');
  assert.equal(await hidden.page.locator('#game.is-dice-intro,#game.is-opening-deal').count(),0,'refresh never replays a seen round');
  await hidden.page.evaluate(()=>window.mahjongRoom.reconnect());await hidden.page.waitForFunction(()=>window.mahjongRoom.status==='connected');
  assert.equal(await hidden.page.locator('#game.is-dice-intro,#game.is-opening-deal').count(),0,'reconnect never replays a seen round');
  report.cases.push({hiddenStart:true,replayOnce:true,dealAfterReplay:true,noRepeatOnVisibility:true,noRefreshReplay:true,noReconnectReplay:true});
  // 直接推进服务端快照的用例仅在本地运行；公网仍验证后台恢复与去重。
  if(hidden.room){
  // 换局后重新播放一次：刷新后页面仍处于隐藏状态，新局写待播，恢复可见再补播。
  clearTimeout(hidden.room.botTimer);hidden.room.game.newRound('dice-hidden-new-round');service._beginOpening(hidden.room);service._changed(hidden.room);
  await hidden.page.waitForFunction(version=>window.mahjongRoom.room.version>=version,hidden.room.version);
  assert.equal(await hidden.page.locator('#game.is-dice-intro,#game.is-opening-deal').count(),0);
  await hidden.page.evaluate(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await hidden.page.waitForFunction(()=>document.querySelector('#dice-intro').dataset.phase==='rolling');
  await idle(hidden.page);
  const hiddenRound=await hidden.page.evaluate(()=>window.__diceHistory.map(r=>r.phase));
  assert.deepEqual(hiddenRound,['rolling','settled','enlarging','showing','idle'],'a new round replays once');
  // 恢复可见时该局已经推进（有人打出），不补播。
  await hidden.page.evaluate(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
  });
  clearTimeout(hidden.room.botTimer);hidden.room.game.newRound('dice-hidden-progress');service._beginOpening(hidden.room);service._changed(hidden.room);
  await hidden.page.waitForFunction(version=>window.mahjongRoom.room.version>=version,hidden.room.version);
  // 代表同一房主的另一个有效页面已完成开场；普通出牌仍须先经过权威放行。
  service.openingComplete(hidden.room.code,hidden.room.seats[0].token,{id:hidden.room.opening.id});
  const hiddenDealer=hidden.room.game.dealer,hiddenIndex=hidden.room.game.players[hiddenDealer].hand.findIndex(t=>t!==31&&t!==hidden.room.game.indicatorTile&&t!==hidden.room.game.wildTile);
  assert.equal(hidden.room.game.discard(hiddenDealer,hiddenIndex),true);
  // 合法推进到自己的下一次出牌，确认跳过过期开场时会解除输入锁。
  for(let step=0;step<40&&!(hidden.room.game.phase.kind==='discard'&&hidden.room.game.current===0);step++){
    assert.notEqual(hidden.room.game.phase.kind,'ended');
    if(hidden.room.game.getActions(0).pass)assert.equal(hidden.room.game.pass(0),true);
    else assert.equal(hidden.room.game.advanceAI(),true);
  }
  assert.equal(hidden.room.game.phase.kind,'discard');assert.equal(hidden.room.game.current,0);
  service._changed(hidden.room);
  await hidden.page.waitForFunction(version=>window.mahjongRoom.room.version>=version,hidden.room.version);
  await hidden.page.evaluate(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await hidden.page.waitForTimeout(300);
  assert.equal(await hidden.page.locator('#game.is-dice-intro,#game.is-opening-deal').count(),0,'no replay after the round already progressed');
  assert.equal(await hidden.page.locator('#hand button:enabled').count(),hidden.room.game.players[0].hand.length,'skipping stale intro restores legal hand input');
  report.cases.push({hiddenStart:true,newRoundReplays:true,noReplayAfterProgress:true,inputRestoredAfterProgress:true});
  }
  await hidden.page.evaluate(()=>window.mahjongRoom.leave());await hidden.context.close();
  const reduced=await setup({width:640,height:360},'reduce');
  assert.equal(await reduced.page.locator('#dice-intro').getAttribute('data-phase'),'showing');
  assert.equal(await reduced.page.locator('#table-dice.is-rolling').count(),0);
  assert.equal(await reduced.page.locator('#hand button:enabled').count(),0);
  await idle(reduced.page);
  const reducedHistory=await reduced.page.evaluate(()=>window.__diceHistory);
  assert.deepEqual(reducedHistory.map(r=>r.phase),['showing','idle']);
  assert.ok(reducedHistory[1].time-reducedHistory[0].time>=750&&reducedHistory[1].time-reducedHistory[0].time<1400);
  assert.equal(await reduced.page.locator('#hand button:enabled').count(),14);
  report.cases.push({reducedMotion:true,noShake:true,noZoomAnimation:true,holdDuration:reducedHistory[1].time-reducedHistory[0].time});
  await reduced.page.evaluate(()=>window.mahjongRoom.leave());
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.resources,[]);report.passed=true;console.log(JSON.stringify(report));
}catch(error){report.failure=error.stack;throw error;}finally{
  for(const context of contexts)for(const page of context.pages())try{await page.evaluate(()=>window.mahjongRoom?.room?window.mahjongRoom.leave():true);}catch(error){(report.cleanupErrors??=[]).push(error.message);}
  writeFileSync(output+(process.env.KK_UI_TARGET_URL?'/intro-online.json':'/intro-local.json'),JSON.stringify(report,null,2));
  await Promise.allSettled(contexts.map(c=>c.close()));await browser.close();service.close();server.closeAllConnections();await new Promise(r=>server.close(r));
}
