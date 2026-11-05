import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {installVisualGeometry} from './browser-geometry.mjs';
const BASELINE='cad0e12',sheets=['tiles-depth.css','landscape.css','table-depth.css'];
const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const service=new RoomService({botDelayMs:600000}),server=createServer({roomService:service});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}),context=await browser.newContext({viewport:{width:640,height:360},reducedMotion:'reduce'});
await context.addInitScript(installVisualGeometry);
await context.addInitScript(()=>{localStorage.setItem('queqi-settings',JSON.stringify({sound:false}));Object.defineProperty(Element.prototype,'requestFullscreen',{value:()=>Promise.reject(Error('contact fixture'))});});
for(const file of sheets)await context.route(`**/${file}?contact-baseline=*`,route=>route.fulfill({body:execFileSync('git',['show',`${BASELINE}:${file}`]),contentType:'text/css'}));
const page=await context.newPage(),report={passed:false,baseline:BASELINE,browser:browser.version(),cases:[],errors:[],screenshots:0,note:'Real HTTP/SSE room and frozen visual fixtures. CSS gradients are sampled analytically; no screenshots or raster capture. Geometry is compared exactly to cad0e12.'};mkdirSync('output',{recursive:true});
const target=process.env.KK_UI_TARGET_URL||`http://127.0.0.1:${server.address().port}`;const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});page.on('pageerror',e=>report.errors.push(e.message));
const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

const split=value=>{if(value==='none')return [];const out=[];let d=0,start=0;for(let i=0;i<value.length;i++){if(value[i]==='(')d++;if(value[i]===')')d--;if(value[i]===','&&!d){out.push(value.slice(start,i).trim());start=i+1;}}out.push(value.slice(start).trim());return out;};
async function sheet(baseline){
  await page.evaluate(async({sheets,baseline})=>{const css=await Promise.all(sheets.map(async f=>(await fetch('/'+f+'?contact-'+(baseline?'baseline':'current')+'='+Date.now(),{cache:'no-store'})).text()));sheets.forEach((f,i)=>{const old=document.querySelector('[data-contact-sheet="'+f+'"]')||[...document.querySelectorAll('link[rel=stylesheet]')].find(n=>new URL(n.href).pathname.endsWith('/'+f));const style=document.createElement('style');style.dataset.contactSheet=f;style.textContent=css[i];old.replaceWith(style);});window.renderMahjong();},{sheets,baseline});await frames();
}
async function snapshot(){return page.evaluate(()=>{
  const rect=n=>{const r=n.getBoundingClientRect();return[r.x,r.y,r.width,r.height];};
  const props=['width','height','gap','padding','margin','border-width','border-radius','transform','transform-origin','position','z-index','overflow','clip-path','pointer-events'];
  const nodes=[...document.querySelectorAll('#game,.table,.table-border,.table-center,.table-center::before,.table-dice,.table-die,.direction,.river,.opponent-rack,.hand-zone,#hand,.tile,.back,.meld-group,.flat-wall-run,.wall-stack,.player-seat,.topbar,.action-zone')].filter(n=>n.getClientRects().length);
  const geometry=nodes.map(n=>({name:n.id||n.tagName+'.'+n.className,rect:rect(n),shape:Object.fromEntries(props.map(k=>[k,getComputedStyle(n).getPropertyValue(k)]))}));
  const cards=[...document.querySelectorAll('.tile,.back')].filter(n=>n.getClientRects().length&&!n.closest('#opening-deal'));
  const shadows=cards.map(n=>{const s=getComputedStyle(n),t=parseFloat(s.getPropertyValue('--tile-model-turn'))*Math.PI/180,x=Number(s.getPropertyValue('--tile-model-shadow-x')),y=Number(s.getPropertyValue('--tile-model-shadow-y'));return{area:n.closest('.river,.flat-wall-run,.meld-group,.backs,.hand')?.id||n.parentElement.className,width:parseFloat(s.getPropertyValue('--tile-model-width')),reach:s.getPropertyValue('--tile-ground-reach'),strength:Number(s.getPropertyValue('--tile-ground-strength')),grade:s.getPropertyValue('--tile-model-grade').trim(),direction:[x*Math.cos(t)-y*Math.sin(t),x*Math.sin(t)+y*Math.cos(t)],layers:[s.boxShadow,getComputedStyle(n,'::before').boxShadow,getComputedStyle(n,'::after').boxShadow]};});
  const grounds=[...document.querySelectorAll('.river,.hand,.opponent-rack .backs,.meld-group,.flat-wall-run')].filter(n=>n.getClientRects().length).map((n,parentIndex)=>{const s=getComputedStyle(n);return{parentIndex,name:n.id||n.className,side:n.dataset.side,images:s.getPropertyValue('--tile-ground-images').trim(),positions:s.getPropertyValue('--tile-ground-positions').trim(),sizes:s.getPropertyValue('--tile-ground-sizes').trim(),computed:getComputedStyle(n,n.matches('.hand')?'::after':null).backgroundImage,cards:n.querySelectorAll(n.matches('.flat-wall-run')?'.wall-piece:not(.is-empty)':':scope > .tile,:scope > .back').length};});
  for(const ground of grounds){
    const parent=[...document.querySelectorAll('.river,.hand,.opponent-rack .backs,.meld-group,.flat-wall-run')].filter(n=>n.getClientRects().length)[ground.parentIndex];
    if(!parent||parent.matches('.flat-wall-run'))continue;
    const staticParent=getComputedStyle(parent).position==='static',reference=staticParent?parent.offsetParent:parent;
    const ps=getComputedStyle(reference),pw=parseFloat(ps.width),ph=parseFloat(ps.height),unproject=window.visualGeometry.tablePlane(window.visualGeometry.quad(reference));
    const records=[...parent.querySelectorAll(':scope > .tile,:scope > .back')].map(n=>{const points=unproject(window.visualGeometry.quad(n));const xs=points.map(p=>p.x*pw),ys=points.map(p=>p.y*ph);return{left:Math.min(...xs),top:Math.min(...ys),center:[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2],width:parseFloat(getComputedStyle(n).getPropertyValue('--tile-model-width'))};});
    const origin=staticParent&&records.length?[Math.min(...records.map(r=>r.left)),Math.min(...records.map(r=>r.top))]:[0,0];
    ground.tileBoxes=records.map(r=>({...r,center:[r.center[0]-origin[0],r.center[1]-origin[1]]}));
  }
  const panel=document.querySelector('.table-center'),dice=[...document.querySelectorAll('#table-dice .table-die')].map(n=>({rect:rect(n),width:parseFloat(getComputedStyle(n).width),shadow:getComputedStyle(n).boxShadow}));
  const filters=[...document.querySelectorAll('*')].flatMap(n=>['','::before','::after'].map(p=>({name:n.id||n.className,p,backdrop:getComputedStyle(n,p||null).backdropFilter}))).filter(s=>s.backdrop!=='none');
  return{geometry,shadows,grounds,dice,panel:rect(panel),filters,ratio:Number(getComputedStyle(document.querySelector('#game')).getPropertyValue('--scene-ground-reach-ratio')),sources:[...document.querySelectorAll('.tile svg')].map(n=>n.outerHTML)};
});}
const intersect=(a,b)=>Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]));
function verify(data){
  assert.equal(data.ratio,.045);assert.deepEqual(data.filters,[]);
  for(const s of data.shadows){assert.ok(Math.abs(s.direction[0]+1)<1e-5&&Math.abs(s.direction[1]-.25)<1e-5,'all rotations cast left');for(const layer of s.layers)assert.ok(split(layer).length<=2,'two shadows per tile layer maximum');}
  for(const g of data.grounds){
    const images=split(g.images),positions=split(g.positions).map(v=>v.split(' ').map(parseFloat)),sizes=split(g.sizes).map(v=>v.split(' ').map(parseFloat));
    if(g.cards)assert.ok(images.length,'occupied '+g.name+' has grounded paint');else assert.equal(images.length,0,'empty area has no ghost shadow');
    assert.equal(images.length,positions.length===1&&images.length===0?0:positions.length);assert.equal(images.length,sizes.length===1&&images.length===0?0:sizes.length);
    for(const image of images)assert.match(image,/gradient/);
    assert.ok(split(g.computed).filter(v=>v!=='none').length>=images.length,'generated contact gradients actually reach computed background: '+g.name);
    if(g.tileBoxes)for(const [i,tile]of g.tileBoxes.entries()){
      const m=images[i].match(/ellipse ([\d.-]+)px ([\d.-]+)px at ([\d.-]+)px ([\d.-]+)px/);assert.ok(m);
      const center=[Number(m[3])+positions[i][0],Number(m[4])+positions[i][1]];
      const ratios=[(center[0]-tile.center[0])/tile.width,(center[1]-tile.center[1])/tile.width];(g.measuredRatios??=[]).push(ratios);
      assert.ok(Math.abs(Math.hypot(...ratios)/Math.hypot(.045,.01125)-1)<.05,'projected width-relative contact offset magnitude agrees within 5%');
      assert.ok(Math.abs(center[0]-tile.center[0]+tile.width*.045)<.035,'ground paint center casts left by 4.5% of actual tile width '+JSON.stringify({area:g.name,index:i,center,tile,positions:positions[i],image:images[i]}));
      assert.ok(Math.abs(center[1]-tile.center[1]-tile.width*.045*.25)<.035,'ground paint slope matches lamp');
    }
    if(g.name.startsWith('river-')||g.name==='hand'||g.name.startsWith('backs-')||g.name.includes('meld-group')){
      assert.equal(images.length,g.cards,'one disjoint ground patch per real tile');
      const boxes=positions.map((p,i)=>[...p,...sizes[i]]);for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert.ok(intersect(boxes[i],boxes[j])<.001,'ground footprints never overlap: '+g.name);
    }
    if(g.name==='flat-wall-run'&&g.cards){assert.ok(images.some(s=>s.startsWith('radial-gradient'))&&images.some(s=>s.startsWith('linear-gradient')),'continuous wall AO plus root seam/highlight');}
  }
  const [px,py,pw,ph]=data.panel;
  for(const die of data.dice){const cast=split(die.shadow).filter(s=>!s.includes('inset'));assert.equal(cast.length,1);const values=[...cast[0].matchAll(/(-?[\d.]+)px/g)].map(m=>Number(m[1]));const [x,y,blur,spread]=values;assert.ok(x<0&&y>0);assert.ok(Math.abs(-x/die.width-.085)<.0001,'dice shadow scales with its own width');const extent=3*blur+spread;const [dx,dy,dw,dh]=die.rect;assert.ok(dx+x-extent>=px&&dx+dw+x+extent<=px+pw&&dy+y-extent>=py&&dy+dh+y+extent<=py+ph,'conservative dice shadow bound stays inside control panel');}
}
try{
  console.log('CONTACT start');await page.goto(target,{waitUntil:'networkidle'});console.log('CONTACT home');await page.locator('#room-name').fill('接触影验收');await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();for(const seat of [1,2,3])await page.locator('.room-bot-add[data-seat="'+seat+'"]').click();await page.locator('#room-ready').click();await page.locator('#room-start').click();await page.locator('#room-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#dice-intro').hidden&&!document.querySelector('#game').classList.contains('is-opening-deal'));
  await page.evaluate(()=>{window.mahjongRoom.destroy();window.mahjongRoom.availableActions=()=>({chi:[],peng:false,gang:false,hu:false,pass:false,redGang:false,piziGang:false,wildGang:false,concealedGangs:[],addedGangs:[]});const g=window.mahjongGame;g.players.forEach((p,i)=>{p.hand=Array.from({length:i?10:14},(_,n)=>n);p.redGangs=[];p.piziGangs=[];p.melds=[{kind:'peng',tiles:[20,20,20],from:1,concealed:false}];});g.current=0;g.phase={kind:'discard',seat:0};g.lastDiscard=null;g.pendingDiscard=null;g.lastDraw={player:0,index:13,tile:13};g.actionNotice=null;g.events=['接触影展示夹具'];window.renderMahjong();});await frames();
  for(const size of [{width:640,height:360},{width:844,height:390},{width:1280,height:720},{width:1920,height:1080}]){
    await page.setViewportSize(size);await frames();
    for(const count of [0,1,9,27,36]){console.log('CONTACT '+size.width+' '+count);
      await page.evaluate(count=>{window.mahjongGame.players.forEach((p,i)=>p.discards=Array.from({length:count},(_,n)=>(n+i*9)%34));window.renderMahjong();},count);await frames();
      await sheet(true);const before=await snapshot();await sheet(false);const after=await snapshot();
      assert.deepEqual(after.geometry,before.geometry,'all tile/area/dice/control panel geometry remains exactly unchanged');assert.deepEqual(after.sources,before.sources,'SVG artwork and positioning remain unchanged');verify(after);
      if(count===9){
        const result=await page.evaluate(()=>{
          const river=document.querySelector('#river-0'),read=()=>({count:river.querySelectorAll('.tile').length,images:getComputedStyle(river).getPropertyValue('--tile-ground-images')});
          const before=read();for(let i=0;i<10;i++)window.renderMahjong();const repeated=read();window.mahjongGame.players[0].discards.push(10);window.renderMahjong();const added=read();window.mahjongGame.players[0].discards.pop();window.renderMahjong();return{before,repeated,added,restored:read()};
        });assert.deepEqual(result.repeated,result.before,'unchanged snapshots retain contact paint');assert.equal(result.added.count,10);assert.equal(split(result.added.images).length,10,'one real discard invalidates only the affected cache');assert.deepEqual(result.restored,result.before,'removing the discard restores floor slots without a ghost');
      }
      report.cases.push({size,count,rectangles:after.geometry.length,grounds:after.grounds,shadows:after.shadows,dice:after.dice,panel:after.panel,exactGeometry:true});
    }
    for(const remaining of [135,0]){
      await page.evaluate(remaining=>{const g=window.mahjongGame;g.wall=Array(remaining).fill(0);g.wallInfo.tailDraws=0;g.indicatorTaken=remaining===0;g.players.forEach((p,i)=>p.discards=Array.from({length:9},(_,n)=>(n+i*9)%34));window.renderMahjong();},remaining);await frames();
      await sheet(true);const before=await snapshot();await sheet(false);const after=await snapshot();assert.deepEqual(after.geometry,before.geometry);assert.deepEqual(after.sources,before.sources);verify(after);
      const runs=after.grounds.filter(g=>g.name==='flat-wall-run'),occupied=runs.filter(g=>g.cards);assert.equal(occupied.length,remaining?4:0,'full four-side wall / empty wall roots');
      if(remaining)for(const run of occupied)assert.equal(split(run.images).length,2,'each complete wall root is one continuous two-gradient band');
      report.cases.push({size,wallRemaining:remaining,rectangles:after.geometry.length,grounds:after.grounds,shadows:after.shadows,dice:after.dice,panel:after.panel,exactGeometry:true});
    }
  }
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,cases:report.cases.length,rectangles:report.cases.reduce((n,c)=>n+c.rectangles,0),shadowPatches:report.cases.reduce((n,c)=>n+c.grounds.reduce((sum,g)=>sum+split(g.images).length,0),0),screenshots:0}));
}catch(error){report.failure=error.stack;throw error;}finally{if(process.env.KK_UI_TARGET_URL)try{report.testRoomLeft=await page.evaluate(()=>window.mahjongRoom.leave());}catch(e){report.cleanupError=e.message;}writeFileSync(process.env.KK_UI_TARGET_URL?'output/contact-shadows-online.json':'output/contact-shadows-verification.json',JSON.stringify(report,null,2));await browser.close();service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
