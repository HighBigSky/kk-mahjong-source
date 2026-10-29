import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {checkMaterialAreas,materialSnapshot} from './tile-material-checks.mjs';
import {installVisualGeometry} from './browser-geometry.mjs';
import {checkTilePaintBounds,checkTileInteractionPaint} from './tile-paint-bounds.mjs';

const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const service=new RoomService({botDelayMs:600000}),server=createServer({roomService:service});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const context=await browser.newContext({viewport:{width:640,height:360},reducedMotion:'reduce'});
await context.addInitScript(()=>{localStorage.setItem('queqi-settings',JSON.stringify({sound:false}));Object.defineProperty(Element.prototype,'requestFullscreen',{value:()=>Promise.reject(Error('fixed viewport'))});});
const BASELINE='f588507';
const sheets=['tiles-depth.css','landscape.css','styles.css','seats-layout.css','wall-layout.css'];
for(const file of sheets)await context.route(`**/${file}?material-baseline=*`,route=>route.fulfill({body:execFileSync('git',['show',`${BASELINE}:${file}`]),contentType:'text/css'}));
const page=await context.newPage(),report={passed:false,errors:[],cases:[],screenshots:0,note:`Client display fixtures only. Dialog and animation examples reuse existing markup classes; no product DOM or game actions are added. Geometry is compared to ${BASELINE}; no screenshot pixel sampling.`};
await page.addInitScript(installVisualGeometry);
const targetURL=process.env.KK_UI_TARGET_URL||`http://127.0.0.1:${server.address().port}`;
const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
page.on('pageerror',e=>report.errors.push(e.message));mkdirSync('output',{recursive:true});
const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function sheet(baseline) {
  await page.evaluate(({baseline,sheets})=>Promise.all(sheets.map(file=>new Promise((resolve,reject)=>{const link=[...document.querySelectorAll('link[rel=stylesheet]')].find(n=>n.href.includes('/'+file));link.onload=resolve;link.onerror=reject;link.href='/'+file+'?material-'+(baseline?'baseline':'current')+'='+Date.now();}))),{baseline,sheets});await frames();
}
async function checkPair(size,area,read) {
  const pair=[];for(const baseline of [true,false]){await sheet(baseline);pair.push(await read(baseline));}
  const shapes=rows=>Object.fromEntries(Object.entries(rows).map(([name,data])=>[name,data.map(row=>{
    const shape=Object.fromEntries(Object.entries(row.shape).filter(([key])=>area!=='animation'||key!=='svg'&&key!=='borderWidths'));
    // 仅本家牌缝变窄，逐张横坐标随居中重新分布；牌宽高、圆角和其它牌区保持基线。
    return name==='hand'?{...shape,gap:null,rect:[null,...shape.rect.slice(1)]}:shape;
  })]));
  assert.deepEqual(shapes(pair[1]),shapes(pair[0]),`${JSON.stringify(size)} ${area} dimensions, radii, orientations and non-hand gaps unchanged`);
  if(pair[0].hand){const center=data=>(data[0].shape.rect[0]+data.at(-1).shape.rect[0]+data.at(-1).shape.rect[2])/2;assert.ok(Math.abs(center(pair[0].hand)-center(pair[1].hand))<.05,'hand row remains centered');}
  report.cases.push({size,area,tiles:Object.values(pair[1]).reduce((n,a)=>n+a.length,0),groups:Object.fromEntries(Object.entries(pair[1]).map(([name,data])=>[name,{count:data.length,grade:data[0].grade,strength:data[0].strength,thickness:data[0].thickness,contactAlpha:data[0].ground[0].alpha,width:data[0].shape.width,height:data[0].shape.height,light:data[0].light,shadow:data[0].shadow,topSizes:data[0].topSizes}]))});
}
try {
  await page.goto(targetURL,{waitUntil:'networkidle'});await page.locator('#room-name').fill('全牌区共享材质验收');await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();
  for(const seat of [1,2,3])await page.locator(`.room-bot-add[data-seat="${seat}"]`).click();
  await page.locator('#room-ready').click();await page.locator('#room-start').click();await page.locator('#room-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#dice-intro').hidden&&!document.querySelector('#game').classList.contains('is-opening-deal'));await page.evaluate(()=>window.mahjongRoom.destroy());
  for(const size of [{width:640,height:360},{width:844,height:390},{width:1920,height:1080}]) {
    await page.setViewportSize(size);
    await page.evaluate(()=>{const g=window.mahjongGame;g.players.forEach((p,i)=>{p.hand=Array.from({length:i?10:14},(_,n)=>n);p.discards=Array.from({length:36},(_,n)=>(n+i*9)%34);p.redGangs=[];p.piziGangs=[];p.melds=[{kind:'peng',tiles:[20,20,20],from:1,concealed:false},{kind:'gang',tiles:[21,21,21,21],from:1,concealed:false}];});g.current=0;g.phase={kind:'discard',seat:0};g.pendingDiscard=null;g.lastDiscard=null;g.actionNotice=null;g.events=['全牌区材质展示夹具'];g.lastDraw=null;window.renderMahjong();});await frames();
    await checkPair(size,'table',baseline=>checkMaterialAreas(page,{baseline}));
    report.bounds??=[];report.interactions??=[];
    report.bounds.push({size,result:await checkTilePaintBounds(page,'#hand .tile,.table .tile,.table .back,.topbar .laizi-summary .tile')});
    report.interactions.push({size,result:await checkTileInteractionPaint(page)});
    // 弹窗使用实际容器，牌面克隆去掉牌河格位内联样式，避免伪造弹窗的摆放规则。
    for(const [id,container,count,wrapper]of [['choice-dialog','choice-options',3,true],['history-dialog','history-tiles',27,false],['result-dialog','result-hand',14,false]]) {
      await page.evaluate(({id,container,count,wrapper})=>{const root=document.getElementById(container);root.replaceChildren();const holder=wrapper?document.createElement('button'):root;if(wrapper){holder.className='choice-option';root.append(holder);}const source=document.querySelector('#river-0 .tile');for(let i=0;i<count;i++){const face=source.cloneNode(true);face.removeAttribute('style');face.className='tile';holder.append(face);}document.getElementById(id).showModal();},{id,container,count,wrapper});await frames();
      await checkPair(size,id,async baseline=>({[id]:await materialSnapshot(page,`#${container} .tile`,!baseline)}));report.bounds.push({size,area:id,result:await checkTilePaintBounds(page,`#${container} .tile`)});await page.evaluate(id=>document.getElementById(id).close(),id);
    }
    await page.evaluate(()=>{const q=value=>`${Math.round(parseFloat(value)*64)/64}px`,layer=document.querySelector('#opening-deal');layer.hidden=false;for(const seat of [0,1,2,3]){const flight=document.createElement('div');flight.className='deal-flight';flight.dataset.player=String(seat);const source=document.querySelector(seat?'#backs-'+seat+' .back':'#hand button'),s=getComputedStyle(source),face=source.cloneNode(true);flight.style.cssText=`left:${100+seat*65}px;top:100px;width:${q(s.width)};height:${q(s.height)}`;face.classList.add('deal-face');face.removeAttribute('id');flight.append(face);layer.append(flight);}const wall=document.querySelector('.wall-piece.back'),s=getComputedStyle(wall),source=wall.cloneNode(true);source.className='deal-source back';Object.assign(source.style,{left:'100px',top:'170px',width:q(s.width),height:q(s.height)});layer.append(source);});await frames();
    await checkPair(size,'animation',async baseline=>({face:await materialSnapshot(page,'.deal-flight .tile.deal-face',!baseline),backs:await materialSnapshot(page,'.deal-flight .back.deal-face,.deal-source.back',!baseline)}));
    await page.evaluate(()=>{const layer=document.querySelector('#opening-deal');layer.replaceChildren();layer.hidden=true;});
  }
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,cases:report.cases.length,tiles:report.cases.reduce((n,c)=>n+c.tiles,0),errors:report.errors,screenshots:0}));
} finally {
  if(process.env.KK_UI_TARGET_URL)try{report.testRoomLeft=await page.evaluate(()=>window.mahjongRoom.leave());}catch(error){report.cleanupError=error.message;}
  writeFileSync(process.env.KK_UI_TARGET_URL?'output/shared-tile-materials-online.json':'output/shared-tile-materials.json',JSON.stringify(report,null,2));await browser.close();service.close();server.closeAllConnections();await new Promise(r=>server.close(r));
}
