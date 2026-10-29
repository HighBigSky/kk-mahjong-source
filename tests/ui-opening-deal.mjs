import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {assertInvariants} from '../src/domain/invariants.js';
import {installVisualGeometry} from './browser-geometry.mjs';

const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const service=new RoomService({botDelayMs:600000});
const server=createServer({roomService:service});
server.listen(0,'127.0.0.1'); await once(server,'listening');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const report={passed:false,browser:browser.version(),cases:[],errors:[],note:'Real HTTP/SSE opening rooms; browser touch emulation, not physical phones. Server newRound/discard are used only to exercise round and snapshot boundaries.'};
mkdirSync('output',{recursive:true});
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const idle=page=>page.waitForFunction(()=>!document.querySelector('#game').classList.contains('is-opening-deal')&&document.querySelector('#opening-deal').children.length===0);
async function setup(size,reducedMotion='no-preference') {
  const context=await browser.newContext({viewport:size,hasTouch:size.touch,isMobile:size.touch,reducedMotion});
  await context.addInitScript(()=>{
    Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:()=>Promise.reject(Error('viewport fixture'))});
    if(screen.orientation)Object.defineProperty(screen.orientation,'lock',{configurable:true,value:()=>Promise.reject(Error('viewport fixture'))});
  });
  const page=await context.newPage();
  await page.addInitScript(installVisualGeometry);
  page.on('pageerror',error=>report.errors.push(error.message));
  const requests=[];
  page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/action'))requests.push(request.postDataJSON());});
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
  await page.locator('#room-name').fill('发牌动画验收'); await page.locator('#room-create').click();
  await page.locator('#room-waiting:not([hidden])').waitFor();
  const code=(await page.locator('#room-current-code').textContent()).trim();
  const room=service.rooms.get(code);
  for(const seat of [1,2,3])await page.locator(`.room-bot-add[data-seat="${seat}"]`).click();
  await page.locator('#room-ready').click(); await page.locator('#room-start').click();
  await page.waitForFunction(()=>window.mahjongRoom.room?.status==='playing');
  await frames(page);
  return {context,page,room,requests};
}
async function startFlight(page) {
  await page.waitForFunction(()=>document.querySelector('#opening-deal').dataset.phase==='waiting');
  await page.locator('#dice-intro').click();
  await page.waitForFunction(()=>document.querySelector('#opening-deal').dataset.phase==='running');
}
async function metadata(page) {
  return page.evaluate(async()=>{
    const {captureTileMaterial}=await import('/src/ui/tile-material.js');
    const key=material=>JSON.stringify({...material,custom:Object.fromEntries(Object.entries(material.custom).sort(([a],[b])=>a.localeCompare(b)))});
    const flights=[...document.querySelectorAll('.deal-flight')];
    const differences=(a,b,prefix='')=>Object.keys({...a,...b}).flatMap(name=>{const x=a?.[name],y=b?.[name],path=prefix+name;return x&&y&&typeof x==='object'&&typeof y==='object'?differences(x,y,path+'.'):x===y?[]:[{path,flight:String(x).slice(0,220),target:String(y).slice(0,220)}];});
    window.__dealMaterialRecords=flights.map(flight=>{const seat=Number(flight.dataset.player),index=Number(flight.dataset.handIndex),target=document.querySelectorAll(seat?`#backs-${seat} .back`:'#hand button')[index],face=flight.querySelector('.deal-face'),a=captureTileMaterial(face),b=captureTileMaterial(target);return {seat,index,key:key(b),same:key(a)===key(b),differences:differences(a,b)};});
    const groups=Array.from({length:17},(_,batch)=>{
      const cards=flights.filter(node=>Number(node.dataset.batch)===batch);
      return {count:cards.length,player:Number(cards[0]?.dataset.player),declaredCount:Number(cards[0]?.dataset.count)};
    });
    const stage=document.querySelector('#game').getBoundingClientRect();
    return {count:flights.length,groups,sources:flights.map(node=>Number(node.dataset.source)),materialsMatch:window.__dealMaterialRecords.map(record=>record.same),materialDifferences:window.__dealMaterialRecords.filter(record=>!record.same).slice(0,4).map(({seat,index,differences})=>({seat,index,differences})),
      opponentsFaces:document.querySelectorAll('.deal-flight:not([data-player="0"]) svg').length,
      localFaces:document.querySelectorAll('.deal-flight[data-player="0"] svg').length,
      images:document.querySelectorAll('#opening-deal img').length,
      handVisibility:getComputedStyle(document.querySelector('#hand')).visibility,
      enabled:document.querySelectorAll('#hand button:enabled').length,
      destinations:flights.map(node=>({player:Number(node.dataset.player),left:parseFloat(node.style.left),top:parseFloat(node.style.top),width:parseFloat(node.style.width),height:parseFloat(node.style.height)})),
      stage:{width:stage.width,height:stage.height}};
  });
}
function assertBatches(data,dealer) {
  assert.equal(data.count,53); assert.equal(new Set(data.sources).size,53);
  for(let batch=0;batch<17;batch++) {
    assert.equal(data.groups[batch].count,batch<12?4:1);
    assert.equal(data.groups[batch].declaredCount,data.groups[batch].count);
    assert.equal(data.groups[batch].player,batch===16?dealer:(dealer+batch%4)%4);
  }
  assert.equal(data.opponentsFaces,0); assert.equal(data.localFaces,dealer===0?14:13); assert.equal(data.images,0);
  assert.equal(data.handVisibility,'hidden'); assert.equal(data.enabled,0);
  assert.ok(data.materialsMatch.every(Boolean),'all 53 flying cards copy their landing target material and thickness: '+JSON.stringify(data.materialDifferences));
  assert.ok(data.destinations.every(box=>box.left>=-.5&&box.top>=-.5&&box.left+box.width<=data.stage.width+.5&&box.top+box.height<=data.stage.height+.5));
}
try {
  for(const size of [{width:844,height:390,touch:true},{width:1280,height:720,touch:false}]) {
    const {context,page,room,requests}=await setup(size);
    const before=JSON.stringify(room.game);
    await startFlight(page);
    const data=await metadata(page); assertBatches(data,0);
    const landingError=await page.evaluate(()=>{
      let worst=0;
      for(const player of [1,2,3]) {
        const flight=document.querySelector(`.deal-flight[data-player="${player}"]`),animation=flight.getAnimations()[0];
        const time=animation.currentTime,timing=animation.effect.getTiming();animation.pause();animation.currentTime=Number(timing.delay)+Number(timing.duration)-.001;
        const face=window.visualGeometry.quad(flight.querySelector('.deal-face'));
        const target=window.visualGeometry.quad(document.querySelectorAll(`#backs-${player} .back`)[Number(flight.dataset.handIndex)]);
        worst=Math.max(worst,...face.map((point,index)=>Math.hypot(point.x-target[index].x,point.y-target[index].y)));
        animation.currentTime=time;animation.play();
      }
      return worst;
    });
    assert.ok(landingError<.8,`沿桌边落牌的四角误差过大：${landingError}`);
    assert.ok(!data.sources.includes(room.game.wallInfo.indicatorPosition));
    await page.evaluate(()=>{window.__firstDealCard=document.querySelector('.deal-flight');document.querySelector('#hand button')?.click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
    service._changed(room);
    await page.waitForFunction(version=>window.mahjongRoom.room.version>=version,room.version);
    assert.equal(await page.evaluate(()=>window.__firstDealCard===document.querySelector('.deal-flight')),true,'重复快照不得重新创建动画');
    if(process.env.KK_UI_SCREENSHOTS!=='0')await page.screenshot({path:`output/opening-deal-${size.touch?'phone':'pc'}-flying.png`});
    await idle(page); await frames(page);
    const unchangedMaterials=await page.evaluate(async()=>{const {captureTileMaterial}=await import('/src/ui/tile-material.js');const key=material=>JSON.stringify({...material,custom:Object.fromEntries(Object.entries(material.custom).sort(([a],[b])=>a.localeCompare(b)))});const differences=(a,b,prefix='')=>Object.keys({...a,...b}).flatMap(name=>{const x=a?.[name],y=b?.[name],path=prefix+name;return x&&y&&typeof x==='object'&&typeof y==='object'?differences(x,y,path+'.'):x===y?[]:[{path,after:String(x).slice(0,180),before:String(y).slice(0,180)}];});return window.__dealMaterialRecords.map(({seat,index,key:before})=>{const after=captureTileMaterial(document.querySelectorAll(seat?`#backs-${seat} .back`:'#hand button')[index]);return {seat,index,same:key(after)===before,differences:differences(after,JSON.parse(before))};});});
    assert.ok(unchangedMaterials.every(row=>row.same),'landing keeps the same material, texture, bevel, visible sides and thickness: '+JSON.stringify(unchangedMaterials.filter(row=>!row.same).slice(0,4)));
    assert.equal(JSON.stringify(room.game),before,'动画不得修改服务端状态'); assertInvariants(room.game);
    assert.equal(requests.length,0,'发牌期间点击或 Enter 不得发送游戏操作');
    assert.equal(await page.locator('#hand button:enabled').count(),14);
    assert.equal(await page.locator('.deal-flight').count(),0);
    const positions=await page.evaluate(()=>[...document.querySelectorAll('#hand button')].map(node=>{const b=node.getBoundingClientRect();return [b.left,b.top,b.width,b.height];}));
    await frames(page);
    assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#hand button')].map(node=>{const b=node.getBoundingClientRect();return [b.left,b.top,b.width,b.height];})),positions);
    if(process.env.KK_UI_SCREENSHOTS!=='0')await page.screenshot({path:`output/opening-deal-${size.touch?'phone':'pc'}-finished.png`});
    report.cases.push({size,opening:data,landingError,serverUnchanged:true,noInput:true,stableFinish:true});

    // 刷新相同开局不补播，避免服务器响应与 SSE/重连重复触发。
    await page.reload({waitUntil:'networkidle'}); await page.waitForFunction(()=>window.mahjongRoom.status==='connected');
    assert.equal(await page.locator('#game.is-opening-deal').count(),0);
    if(await page.locator('#dice-intro').isVisible())await page.locator('#dice-intro').click();

    // 下一局庄家换座：即使人机在动画期间已出牌，网络继续接收，结束后显示最新状态。
    clearTimeout(room.botTimer); room.game.newRound('opening-animation-next'); service._changed(room);
    await startFlight(page);
    assertBatches(await metadata(page),1);
    const countsBefore=await page.evaluate(()=>[...document.querySelectorAll('.opponent-rack .backs')].map(node=>node.children.length));
    const index=room.game.players[1].hand.findIndex(tile=>tile!==31&&tile!==room.game.indicatorTile);
    assert.equal(room.game.discard(1,index),true); assertInvariants(room.game); service._changed(room);
    await page.waitForFunction(version=>window.mahjongRoom.room.version>=version,room.version);
    assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('.opponent-rack .backs')].map(node=>node.children.length)),countsBefore,'网络更新不得打断正在播放的发牌');
    await idle(page); await frames(page);
    for(let seat=1;seat<4;seat++)assert.equal(await page.locator(`#backs-${seat} .back`).count(),room.game.players[seat].hand.length);
    assert.equal(Number(await page.locator('#wall-count').textContent()),room.game.wall.length);
    report.cases.push({size,nextRound:true,rotatedDealer:true,reloadDoesNotReplay:true,latestSnapshotRendered:true});

    clearTimeout(room.botTimer); room.game.newRound('opening-animation-resize'); service._changed(room);
    await startFlight(page);
    await page.setViewportSize({width:size.width-24,height:size.height});
    await idle(page); assert.equal(await page.locator('#opening-deal .deal-flight').count(),0);
    clearTimeout(room.botTimer); room.game.newRound('opening-animation-leave'); service._changed(room);
    await page.waitForFunction(()=>document.querySelector('#game').classList.contains('is-opening-deal'));
    await page.locator('#settings-btn').click(); await page.locator('#settings-home').click();
    await idle(page);
    // 主动离房可以中止进行中的牌局，也必须清理发牌动画和输入锁。
    await page.locator('#room-leave').click();
    await page.waitForFunction(()=>window.mahjongRoom.room===null);
    assert.equal(await page.locator('#game.is-opening-deal').count(),0);
    report.cases.push({size,resizeClearsFlights:true,leaveClearsLock:true});
    await context.close();
  }
  const reduced=await setup({width:640,height:360,touch:true},'reduce');
  assert.equal(await reduced.page.locator('#game.is-opening-deal').count(),0);
  assert.equal(await reduced.page.locator('.deal-flight').count(),0);
  assert.equal(await reduced.page.locator('#hand button:enabled').count(),14);
  report.cases.push({reducedMotion:true,animationSkippedWithoutLock:true});
  await reduced.context.close();
  const failed=await setup({width:640,height:360,touch:true});
  await failed.page.evaluate(()=>{
    const original=Element.prototype.animate;
    Element.prototype.animate=function(...args){if(this.classList.contains('deal-flight'))throw Error('animation fault fixture');return original.apply(this,args);};
  });
  await failed.page.locator('#dice-intro').click(); await idle(failed.page); await frames(failed.page);
  assert.equal(await failed.page.locator('#hand button:enabled').count(),14);
  assert.equal(await failed.page.locator('#opening-deal').isVisible(),false);
  report.cases.push({animationFailure:true,realHandAndInputRestored:true});
  await failed.context.close();
  assert.deepEqual(report.errors,[]); report.passed=true;
  console.log(JSON.stringify({passed:report.passed,browser:report.browser,cases:report.cases.length,errors:report.errors},null,2));
} finally {
  writeFileSync('output/opening-deal-verification.json',JSON.stringify(report,null,2));
  await browser.close(); service.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
}
