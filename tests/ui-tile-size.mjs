import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {actionFixture,maximumPublicFixture,maximumSpecialHandFixture} from './pizi-fixtures.mjs';
import {assertInvariants} from '../src/domain/invariants.js';
import {installVisualGeometry} from './browser-geometry.mjs';
import {RIVER_LAYOUT,riverCell} from '../src/ui/river-layout.js';

let playwright;
try { playwright=createRequire(import.meta.url)('playwright'); }
catch { playwright=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright'); }
const sizes=[{width:640,height:360},{width:844,height:390},{width:1920,height:1080}];
const service=new RoomService({disconnectGraceMs:100});
const server=createServer({roomService:service});
server.listen(0,'127.0.0.1'); await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await playwright.chromium.launch({headless:true,...(existsSync(edge)?{executablePath:edge}:{})});
const contexts=[],pages=[],names=['尺寸甲','尺寸乙','尺寸丙','尺寸丁'];
const output=path.resolve(process.env.KK_UI_OUTPUT||'output');mkdirSync(output,{recursive:true});
const report={passed:false,errors:[],measurements:[],screenshots:[],
  note:'Four real HTTP/SSE clients; 0–4 meld and maximum fixtures conserve 136 tiles. The formal layout has independently enlarged local hands and capacity-limited public tiles; each projected body is checked against its unchanged CSS frame and 5:7 ratio. Full 36-cell rivers are presentation-only stress overlays. Table-plane lengths remove only the existing camera perspective.'};
async function player(name){
  const context=await browser.newContext({viewport:sizes[0],hasTouch:true,reducedMotion:'reduce'});contexts.push(context);
  await context.addInitScript(installVisualGeometry);
  await context.addInitScript(()=>{
    localStorage.setItem('queqi-settings',JSON.stringify({sound:false,names:false,laizi:true}));
    Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:()=>Promise.reject(Error('fixed viewport'))});
  });
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.goto(base,{waitUntil:'networkidle'});await page.locator('#room-name').fill(name);return page;
}
async function frames(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function measure(page){return page.evaluate(()=>{
  const visible=n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
  const table=document.querySelector('.table'),surface=getComputedStyle(table,'::before');
  const width=parseFloat(surface.width),height=parseFloat(surface.height);
  const probe=document.createElement('i');probe.style.cssText='position:absolute;width:0;height:0;pointer-events:none';table.append(probe);
  const corners=[[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>{
    probe.style.left=`${parseFloat(surface.left)+width*x}px`;probe.style.top=`${parseFloat(surface.top)+height*y}px`;
    const r=probe.getBoundingClientRect();return{x:r.left,y:r.top};
  });probe.remove();
  const unproject=window.visualGeometry.tablePlane(corners),edge=(q,a,b)=>Math.hypot(q[a].x-q[b].x,q[a].y-q[b].y);
  const categories={hand:'#hand button',public:'.my-melds .tile',concealed:'.opponent-rack .backs>*',meld:'.bot-melds .tile',river:'.river .tile',wall:'.wall-piece'};
  const entries=Object.entries(categories).flatMap(([kind,selector])=>[...document.querySelectorAll(selector)].filter(visible).map((node,index)=>({kind,node,index})));
  // 与原 quad() 使用完全相同的零尺寸测量点；批量读/写，避免逐牌四次强制布局。
  const probes=entries.map(({node})=>{const s=getComputedStyle(node);return {node,width:parseFloat(s.width),height:parseFloat(s.height),bx:parseFloat(s.borderLeftWidth),by:parseFloat(s.borderTopWidth),plain:s.position==='static'&&s.transform==='none'};});
  for(const row of probes)if(row.plain){const r=row.node.getBoundingClientRect();row.quad=[{x:r.left,y:r.top},{x:r.right,y:r.top},{x:r.right,y:r.bottom},{x:r.left,y:r.bottom}];}
  for(const row of probes)if(!row.plain){row.points=[[0,0],[row.width,0],[row.width,row.height],[0,row.height]].map(([x,y])=>{const p=document.createElement('i');p.style.cssText=`position:absolute;display:block;width:0;height:0;margin:0;padding:0;border:0;pointer-events:none;left:${x-row.bx}px;top:${y-row.by}px`;row.node.append(p);return p;});}
  for(const row of probes)if(row.points)row.quad=row.points.map(p=>{const r=p.getBoundingClientRect();return{x:r.left,y:r.top};});
  for(const row of probes)for(const p of row.points||[])p.remove();
  const seen=new Set();let batchPrecision=0;
  for(const [i,{kind,node}]of entries.entries()){const key=kind+':'+(node.closest('[id^="rack-"],.river,.wall-stack')?.id||node.closest('.wall-stack')?.dataset.side||'local');if(seen.has(key))continue;seen.add(key);const oracle=window.visualGeometry.quad(node);batchPrecision=Math.max(batchPrecision,...oracle.map((p,j)=>Math.hypot(p.x-probes[i].quad[j].x,p.y-probes[i].quad[j].y)));}
  const tiles=[];
  for(const [entry,{kind,node:n,index:i}]of entries.entries()){
    const quad=probes[entry].quad,flat=kind==='hand'||kind==='public';
    const q=flat?quad:unproject(quad).map(p=>({x:p.x*width,y:p.y*height}));
    const a=edge(q,0,1),b=edge(q,0,3),r=n.getBoundingClientRect();
    tiles.push({kind,index:i,seat:n.closest('[id^="rack-"]')?.id||n.closest('.river')?.id||n.closest('.wall-stack')?.dataset.side,
      width:Math.min(a,b),height:Math.max(a,b),cssWidth:parseFloat(getComputedStyle(n).width),cssHeight:parseFloat(getComputedStyle(n).height),
      quad,bounds:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},stack:n.closest('.wall-stack')?.dataset.stack,
      empty:n.classList.contains('is-empty'),position:n.dataset.position});
  }
  const base=parseFloat(getComputedStyle(document.querySelector('#hand button')).width);
  const outside=tiles.filter(t=>t.quad.some(p=>p.x<-.8||p.y<-.8||p.x>innerWidth+.8||p.y>innerHeight+.8));
  const live=tiles.filter(t=>!t.empty),overlaps=[];
  for(let i=0;i<live.length;i++)for(let j=i+1;j<live.length;j++){
    const a=live[i],b=live[j];
    // 上下两层牌墙本来叠放；仅排除同一物理墩的两张牌。
    if(a.kind==='wall'&&b.kind==='wall'&&Math.floor(+a.position/2)===Math.floor(+b.position/2))continue;
    if(window.visualGeometry.intersects(a.quad,b.quad))overlaps.push({a:[a.kind,a.index,a.seat],b:[b.kind,b.index,b.seat]});
  }
  const obstacles=[...document.querySelectorAll('.player-seat,.table-center,.top-left>div,.top-tools>*,.action-zone button,#hint-btn')].filter(visible).map(n=>({name:n.id||n.className,quad:window.visualGeometry.quad(n)}));
  const blocked=live.flatMap(t=>obstacles.filter(o=>window.visualGeometry.intersects(t.quad,o.quad)).map(o=>({kind:t.kind,index:t.index,obstacle:o.name})));
  return {base,batchPrecision,tiles,outside,overlaps,blocked,slots:tiles.filter(t=>t.kind==='wall').map(t=>+t.position),
    hiddenHands:window.mahjongGame.players.slice(1).every(p=>p.hand.every(t=>t===null)),
    handHits:[...document.querySelectorAll('#hand button')].map(n=>{const r=n.getBoundingClientRect();return document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2)?.closest('button')===n;})};
});}
try{
  pages.push(await player(names[0]));await pages[0].locator('#room-create').click();await pages[0].locator('#room-waiting:not([hidden])').waitFor();
  const code=(await pages[0].locator('#room-current-code').textContent()).trim(),room=service.rooms.get(code);
  for(const name of names.slice(1)){const page=await player(name);pages.push(page);await page.locator('#room-code').fill(code);await page.locator('#room-join').click();await page.locator('#room-waiting:not([hidden])').waitFor();}
  for(const page of pages)await page.locator('#room-ready').click();await pages[0].locator('#room-start').click();
  for(const page of pages)await page.locator('#room-dialog').waitFor({state:'hidden'});
  const scenarios=Array.from({length:5},(_,n)=>[`melds-${n}`,()=>actionFixture({names,hand:Array.from({length:14-n*3},(_,i)=>18+Math.floor(i/2)),melds:Array.from({length:n},(_,i)=>({kind:'gang',tiles:Array(4).fill(i*3),from:3,concealed:false}))})]);
  scenarios.push(['maximum-public',()=>maximumPublicFixture(names)],['seven-specials-full-hand',()=>maximumSpecialHandFixture(names)]);
  const baselines=new Map();
  for(const [scenario,fixture]of scenarios){
    const game=fixture();game.round=room.game.round+1;assertInvariants(game);room.game=game;service._changed(room);
    for(const [viewer,page]of pages.entries()){
      await page.waitForFunction(v=>window.mahjongRoom.room?.version>=v&&!window.mahjongRoom.busy,room.version);
      if(await page.locator('#dice-intro').isVisible())await page.locator('#dice-intro').click();
      for(const size of sizes){
        await page.setViewportSize(size);await frames(page);await page.evaluate(()=>window.renderMahjong());await frames(page);
        const data=await measure(page),label=`${scenario}, viewer ${viewer}, ${size.width}x${size.height}`;
        assert.ok(data.batchPrecision<=.001,`batch probes match original quad() within .001px: ${label}`);
        assert.equal(data.slots.length,136,label);assert.equal(new Set(data.slots).size,136,label);assert.equal(data.hiddenHands,true,label);
        assert.ok(data.handHits.every(Boolean),`hand hit targets: ${label}`);
        // 正式基线已将本家手牌独立放大，公开区也有容量约束；不能把桌上牌强行改成手牌尺寸。
        // 保留原反投影精度及5:7保护，分别验证每个现有牌框，防止透视/变换把牌身压扁。
        const mismatches=data.tiles.filter(t=>{const short=Math.min(t.cssWidth,t.cssHeight),long=Math.max(t.cssWidth,t.cssHeight);return Math.abs(t.width-short)>.07||Math.abs(t.height-long)>.08||Math.abs(long-short*7/5)>.08;});
        assert.deepEqual(mismatches.map(({kind,index,seat,width,height,cssWidth,cssHeight})=>({kind,index,seat,width,height,cssWidth,cssHeight})),[],`existing area-specific physical frames and 5:7 ratio: ${label}`);
        assert.deepEqual(data.outside,[],`no clipping: ${label}`);assert.deepEqual(data.overlaps,[],`no tile overlap: ${label}`);assert.deepEqual(data.blocked,[],`no UI obstruction: ${label}`);
        const key=`${viewer}-${size.width}`,old=baselines.get(key);if(old)assert.equal(data.base,old,`stable size from 0 to 4 melds: ${label}`);else baselines.set(key,data.base);
        report.measurements.push({scenario,viewer,size,base:data.base,batchPrecision:data.batchPrecision,count:data.tiles.length,widthRange:[Math.min(...data.tiles.map(t=>t.width)),Math.max(...data.tiles.map(t=>t.width))],heightRange:[Math.min(...data.tiles.map(t=>t.height)),Math.max(...data.tiles.map(t=>t.height))],slots:136});
        if(viewer===0&&scenario==='melds-0'){const file=path.join(output,`unified-tiles-${size.width}x${size.height}.png`);await page.screenshot({path:file});report.screenshots.push(file);}
      }
    }
  }
  // 四家同时满河只是展示压力夹具，保留服务端 136 张牌及牌墙槽位不动。
  for(const [viewer,page]of pages.entries())for(const size of sizes){
    await page.setViewportSize(size);await page.evaluate(capacity=>{
      const game=window.mahjongGame;
      for(const p of game.players)p.discards=Array.from({length:capacity},(_,i)=>i%31);
      game.lastDiscard=null;game.pendingDiscard=null;game.events=['展示压力夹具'];window.renderMahjong();
    },RIVER_LAYOUT.capacity);await frames(page);
    const data=await measure(page);assert.deepEqual(data.overlaps,[],`full rivers ${viewer} ${size.width}`);assert.deepEqual(data.blocked,[]);assert.deepEqual(data.outside,[]);
    const order=await page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('.river')].map(r=>[r.id,[...r.children].map(t=>({column:+t.style.gridColumn,row:+t.style.gridRow}))])));
    for(const [seat,side]of ['bottom','right','top','left'].entries())assert.deepEqual(order[`river-${seat}`],Array.from({length:36},(_,i)=>riverCell(i,side)));
    if(viewer===0){const file=path.join(output,`unified-tiles-full-${size.width}x${size.height}.png`);await page.screenshot({path:file});report.screenshots.push(file);}
  }
  assertInvariants(room.game);assert.deepEqual(report.errors,[]);report.passed=true;
  console.log(JSON.stringify({passed:true,cases:report.measurements.length,screenshots:report.screenshots},null,2));
}catch(e){report.failure=e.stack;throw e;}finally{
  writeFileSync(path.join(output,'ui-tile-size.json'),JSON.stringify(report,null,2));
  await Promise.allSettled(contexts.map(c=>c.close()));await browser.close();service.close();const closed=once(server,'close');server.close();server.closeAllConnections();await closed;
}
