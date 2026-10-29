import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {installVisualGeometry} from './browser-geometry.mjs';
import {checkTilePaintBounds,checkTileInteractionPaint} from './tile-paint-bounds.mjs';

const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const service=new RoomService({botDelayMs:600000}),server=createServer({roomService:service});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const base=process.env.KK_UI_TARGET_URL||`http://127.0.0.1:${server.address().port}`;
const report={passed:false,baseline:'f588507',cases:[],errors:[],testRoomsLeft:0,screenshots:0,note:'Browser geometry and CSS paint-bound proof, no screenshot or pixel sampling; isolated local display fixtures.'};
const contexts=[];mkdirSync('output',{recursive:true});
const frames=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function sheet(page,baseline){
  await page.evaluate(baseline=>Promise.all(['tiles-depth.css','landscape.css'].map(file=>new Promise((resolve,reject)=>{const link=[...document.querySelectorAll('link[rel=stylesheet]')].find(n=>n.href.includes('/'+file));link.onload=resolve;link.onerror=reject;link.href='/'+file+'?hand-seams-'+(baseline?'baseline':'current')+'='+Date.now();}))),baseline);
  await page.evaluate(()=>window.renderMahjong());await frames(page);
}
async function read(page){return page.evaluate(()=>{
  const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  const hand=document.querySelector('#hand'),hs=getComputedStyle(hand),paint=getComputedStyle(hand,'::after'),box=rect(hand),nodes=[...hand.children],cards=nodes.map(n=>{
    const s=getComputedStyle(n),b=getComputedStyle(n,'::before'),a=getComputedStyle(n,'::after'),svg=getComputedStyle(n.querySelector('svg'));
    return {rect:rect(n),drawn:n.classList.contains('drawn'),shape:[s.width,s.height,s.borderRadius,s.borderWidth],material:[s.background,s.boxShadow,b.background,b.boxShadow,b.borderRadius,a.background,a.boxShadow,a.borderRadius,svg.width,svg.height,svg.transform,s.outline,s.outlineOffset]};
  });
  const positions=paint.backgroundPosition.split(','),sizes=paint.backgroundSize.split(',');
  const strips=paint.backgroundImage==='none'?[]:sizes.map((value,i)=>{const [width,height]=value.trim().split(/\s+/).map(parseFloat),[x,y]=positions[i].trim().split(/\s+/).map(parseFloat);return {x:box.x+x,y:box.y+y,width,height};});
  return {box,gap:parseFloat(hs.gap),wrap:hs.flexWrap,scroll:hand.scrollWidth,client:hand.clientWidth,cards,strips,paint:paint.backgroundImage,pointer:paint.pointerEvents,z:paint.zIndex,
    other:[...document.querySelectorAll('.river .tile,.my-melds .tile,.opponent-rack .tile,.back')].map(n=>{const s=getComputedStyle(n);return [s.width,s.height,s.borderRadius,s.boxShadow,rect(n)];})};
});}
try{
  for(const size of [{width:640,height:360},{width:844,height:390},{width:1920,height:1080}]){
    const context=await browser.newContext({viewport:size,deviceScaleFactor:size.width<1000?2:1,hasTouch:size.width<1000,reducedMotion:'reduce'});contexts.push(context);
    await context.addInitScript(installVisualGeometry);
    await context.addInitScript(()=>{localStorage.setItem('queqi-settings',JSON.stringify({sound:false}));Object.defineProperty(Element.prototype,'requestFullscreen',{value:()=>Promise.reject(Error('fixed viewport'))});});
    for(const file of ['tiles-depth.css','landscape.css'])await context.route(`**/${file}?hand-seams-baseline=*`,route=>route.fulfill({body:execFileSync('git',['show',`f588507:${file}`]),contentType:'text/css'}));
    const page=await context.newPage(),cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});page.on('pageerror',error=>report.errors.push(error.message));
    try{
      await page.goto(base,{waitUntil:'networkidle'});await page.locator('#room-name').fill('紧凑手牌无截图验收');await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();
      for(const seat of [1,2,3])await page.locator(`.room-bot-add[data-seat="${seat}"]`).click();await page.locator('#room-ready').click();await page.locator('#room-start').click();
      await page.waitForFunction(()=>document.querySelector('#dice-intro').hidden&&!document.querySelector('#game').classList.contains('is-opening-deal'));await page.evaluate(()=>window.mahjongRoom.destroy());
      for(const mode of [{count:14},{count:13},{count:11,meld:true},{count:14,drawn:true},{count:11,meld:true,drawn:true},{count:1,drawn:true},{count:0}]){
        await page.evaluate(mode=>{const g=window.mahjongGame,p=g.players[0];p.hand=Array.from({length:mode.count},(_,i)=>i);p.redGangs=[];p.piziGangs=[];p.melds=mode.meld?[{kind:'peng',tiles:[20,20,20],from:1,concealed:false}]:[];g.players.forEach(player=>player.discards=[8]);g.lastDraw=mode.drawn?{player:0,index:mode.count-1,tile:p.hand.at(-1),replacement:true}:null;g.lastDiscard=null;g.pendingDiscard=null;g.actionNotice=null;g.phase={kind:'discard',seat:0};g.current=0;g.events=['手牌暗缝展示夹具'];window.renderMahjong();},mode);
        const pair=[];for(const baseline of [true,false]){await sheet(page,baseline);pair.push(await read(page));}
        const [before,after]=pair;assert.deepEqual(after.box,before.box,'hand container unchanged');assert.deepEqual(after.other,before.other,'other tile models unchanged');
        assert.deepEqual(after.cards.map(c=>[c.shape,c.material]),before.cards.map(c=>[c.shape,c.material]),'card dimensions, radius, visible planes, shading and interaction paint unchanged');
        assert.ok(after.gap>=.5&&after.gap<=1);assert.equal(after.wrap,'nowrap');assert.ok(after.scroll<=after.client+1);
        const ordinary=[],drawn=[];
        after.cards.forEach((card,i)=>{assert.ok(card.rect.x>=after.box.x-.5&&card.rect.right<=after.box.right+.5);if(!i)return;const gap=card.rect.x-after.cards[i-1].rect.right;if(card.drawn){drawn.push(gap);assert.ok(Math.abs(gap-(before.cards[i].rect.x-before.cards[i-1].rect.right))<.05,'drawn spacer unchanged');}else {assert.ok(gap>=.5&&gap<=1);ordinary.push({left:after.cards[i-1].rect.right,right:card.rect.x,width:gap});}});
        assert.equal(after.strips.length,ordinary.length,JSON.stringify({size,mode,gap:after.gap,paint:after.paint}));assert.equal(after.pointer,'none');assert.equal(after.z,'-1');
        after.strips.forEach((strip,i)=>{assert.ok(strip.x>=ordinary[i].left-1e-5&&strip.x+strip.width<=ordinary[i].right+1e-5,`seam gradient stays strictly inside the measured gap: ${JSON.stringify({size,mode,strip,gap:ordinary[i]})}`);assert.ok(strip.width>0&&strip.width<=1);for(const card of after.cards){const w=Math.min(strip.x+strip.width,card.rect.right)-Math.max(strip.x,card.rect.x),h=Math.min(strip.y+strip.height,card.rect.bottom)-Math.max(strip.y,card.rect.y);assert.ok(w<=1e-5||h<=1e-5,'gradient adds zero overlap with any card face or side');}});
        if(ordinary.length)assert.match(after.paint,/linear-gradient\(90deg, rgba\(2, 12, 9, 0\.65\), rgba\(15, 37, 28, 0\.4\) 50%, rgba\(2, 12, 9, 0\.65\)\)/,'dark edges and a slightly lighter center');
        const bounds=await checkTilePaintBounds(page,'#hand .tile');
        const interactions=mode.count===14?await checkTileInteractionPaint(page):[];
        report.cases.push({size,mode,beforeGap:before.gap,gap:after.gap,ordinaryGaps:ordinary.map(x=>x.width),drawnGaps:drawn,shapes:after.cards.map(c=>c.shape),strips:after.strips,bounds,interactions});
      }
    }finally{if(process.env.KK_UI_TARGET_URL&&await page.evaluate(()=>window.mahjongRoom.leave()))report.testRoomsLeft++;}
    await context.close();
  }
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,cases:report.cases.length,errors:report.errors,screenshots:0}));
}finally{writeFileSync(process.env.KK_UI_TARGET_URL?'output/hand-seams-online.json':'output/hand-seams.json',JSON.stringify(report,null,2));await Promise.allSettled(contexts.map(c=>c.close()));await browser.close();service.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
