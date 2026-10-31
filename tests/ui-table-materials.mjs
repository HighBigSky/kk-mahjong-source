import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';

const BASELINE='b62f133';
const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const service=new RoomService({botDelayMs:600000}),server=createServer({roomService:service});
server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const context=await browser.newContext({viewport:{width:640,height:360},reducedMotion:'reduce'});
await context.addInitScript(()=>{localStorage.setItem('queqi-settings',JSON.stringify({sound:false}));Object.defineProperty(Element.prototype,'requestFullscreen',{value:()=>Promise.reject(Error('fixed table fixture'))});});
const sheets=['table-depth.css','landscape.css'];
for(const file of sheets)await context.route(`**/${file}?table-baseline=*`,route=>route.fulfill({body:execFileSync('git',['show',`${BASELINE}:${file}`]),contentType:'text/css'}));
const page=await context.newPage(),report={passed:false,browser:browser.version(),baseline:BASELINE,cases:[],errors:[],screenshots:0,note:'Real HTTP/SSE room, frozen display fixture. Exact DOM rectangles and geometry properties are compared. No screenshot or pixel sampling.'};
const target=process.env.KK_UI_TARGET_URL||`http://127.0.0.1:${server.address().port}`;
const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
page.on('pageerror',error=>report.errors.push(error.message));mkdirSync('output',{recursive:true});
const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const split=value=>{let depth=0,start=0;const result=[];for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;else if(value[i]===')')depth--;else if(value[i]===','&&!depth){result.push(value.slice(start,i).trim());start=i+1;}}result.push(value.slice(start).trim());return result;};
const colors=value=>(value.match(/[\d.]+/g)||[]).map(Number);
const gradientColors=value=>(value.match(/rgba?\([^()]*\)/g)||[]).map(colors);
const luminance=rgb=>rgb.slice(0,3).map(value=>{const c=value/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
const composite=(ink,base)=>ink.slice(0,3).map((value,i)=>value*(ink[3]??1)+base[i]*(1-(ink[3]??1)));
async function load(baseline) {
  await page.evaluate(async function(args){
    const sources=await Promise.all(args.sheets.map(async function(file){const response=await fetch('/'+file+'?table-'+(args.baseline?'baseline':'current')+'='+Date.now(),{cache:'no-store'});if(!response.ok)throw Error(file);return response.text();}));
    args.sheets.forEach(function(file,i){const old=document.querySelector('[data-craft-sheet="'+file+'"]')||Array.from(document.querySelectorAll('link[rel=stylesheet]')).find(n=>new URL(n.href).pathname.endsWith('/'+file));const style=document.createElement('style');style.dataset.craftSheet=file;style.textContent=sources[i];old.replaceWith(style);});
  },{sheets,baseline});await frames();
}
async function snapshot() {
  return page.evaluate(function(){
    const properties=['position','display','top','right','bottom','left','width','height','padding','margin','box-sizing','transform','transform-origin','transform-style','perspective','clip-path','z-index','border-radius','border-width','border-style','overflow','pointer-events'];
    const shape=s=>Object.fromEntries(properties.map(name=>[name,s.getPropertyValue(name)]));
    const rect=n=>{const r=n.getBoundingClientRect();return[r.x,r.y,r.width,r.height];};
    const selectors='#game,.table,.table-border,.table-center,.table-dice,.table-die,.table-die i,.direction,.table-label-direction,#hand,#wall-tail,.river,.opponent-rack,.my-melds,.table .tile,.table .back,.wall-stack,#hand button,.player-seat,.action-zone';
    const geometry=Array.from(document.querySelectorAll(selectors)).filter(n=>n.getClientRects().length).map(n=>({name:n.id||n.tagName+'.'+n.getAttribute('class'),rect:rect(n),shape:shape(getComputedStyle(n)),pseudos:['::before','::after'].map(p=>shape(getComputedStyle(n,p)))}));
    const layer=(n,p)=>{const s=getComputedStyle(n,p);return{shape:shape(s),background:s.backgroundImage,size:s.backgroundSize,position:s.backgroundPosition,origin:s.backgroundOrigin,shadow:s.boxShadow,filters:[s.filter,s.backdropFilter],colors:[s.borderTopColor,s.borderRightColor,s.borderBottomColor,s.borderLeftColor]};};
    const table=document.querySelector('.table'),border=document.querySelector('.table-border'),center=document.querySelector('.table-center'),die=document.querySelector('#table-dice .table-die'),s=getComputedStyle(table);
    const painted=Array.from(document.querySelectorAll('.table,.table *')).filter(n=>n.getClientRects().length).flatMap(n=>['','::before','::after'].map(p=>{const s=getComputedStyle(n,p||null);return{name:n.id||n.className,p,content:s.content,shadow:s.boxShadow,filter:s.filter,backdrop:s.backdropFilter};}));
    return{geometry,frameRect:rect(table),consoleRect:rect(center),diceRects:Array.from(document.querySelectorAll('#table-dice .table-die')).map(rect),frame:layer(table,'::before'),border:layer(border),inlay:layer(border,'::after'),console:layer(center),well:layer(center,'::before'),dice:layer(die),pip:layer(die.querySelector('i')),room:layer(document.querySelector('#game')),environment:layer(document.querySelector('#game'),'::before'),painted,frameSize:parseFloat(getComputedStyle(table,'::before').width),params:Object.fromEntries(['--table-console-depth','--table-metal-edge-width','--table-inlay-track','--felt-groove-width','--table-metal-light','--table-metal-mid','--table-metal-dark','--wood-bevel','--wood-band','--wood-radius','--table-inner-wall-width','--table-inner-wall-left','--table-inner-wall-right','--table-inner-wall-near','--table-inner-wall-far'].map(k=>[k,s.getPropertyValue(k).trim()]))};
  });
}
function stopData(gradient){
  const args=split(gradient.slice(gradient.indexOf('(')+1,-1));
  return args.filter(s=>/^rgba?\(/.test(s)).map(s=>({color:colors(s.match(/rgba?\([^()]*\)/)[0]),px:Number(s.match(/(-?[\d.]+)px/)?.[1]||0)}));
}
function interpolate(stops,t){
  if(t<=stops[0][0])return stops[0][1];if(t>=stops.at(-1)[0])return stops.at(-1)[1];
  const i=stops.findIndex(s=>s[0]>=t),a=stops[i-1],b=stops[i],f=(t-a[0])/(b[0]-a[0]);
  const aa=a[1][3]??1,ba=b[1][3]??1,alpha=aa*(1-f)+ba*f;
  const rgb=a[1].slice(0,3).map((v,j)=>alpha?(v*aa*(1-f)+b[1][j]*ba*f)/alpha:0);return [...rgb,alpha];
}
function roomLight(room,width,height){
  const layers=split(room.background),ink=layers.map(gradientColors);
  // CSS默认ellipse farthest-corner的归一化半径；只算渐变场，不读取或生成图像。
  const radius=(x,y,cx,cy)=>Math.hypot((x-cx)/(Math.max(cx,1-cx)*Math.SQRT2),(y-cy)/(Math.max(cy,1-cy)*Math.SQRT2));
  const at=x=>{const y=.32;let c=interpolate([[0,ink[4][0]],[.6,ink[4][1]],[1,ink[4][2]]],y);
    c=composite(interpolate([[.48,ink[3][0]],[1,ink[3][1]]],y),c);
    c=composite(interpolate([[0,ink[2][0]],[.68,ink[2][1]]],x),c);
    c=composite(interpolate([[0,ink[1][0]],[.62,ink[1][1]]],radius(x,y,.92,.32)),c);
    return composite(interpolate([[.22,ink[0][0]],[.62,ink[0][1]],[1,ink[0][2]]],radius(x,y,.58,.46)),c);
  };
  const left=at(.15),right=at(.85);assert.ok(luminance(right)>luminance(left),'computed room gradients light the right side more than the left');
  return{left,right,leftLuminance:luminance(left),rightLuminance:luminance(right),width,height,method:'analytic CSS gradient samples, no pixel sampling'};
}
try {
  await page.goto(target,{waitUntil:'networkidle'});await page.locator('#room-name').fill('牌桌工艺验收');await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();
  for(const seat of [1,2,3])await page.locator('.room-bot-add[data-seat="'+seat+'"]').click();
  await page.locator('#room-ready').click();await page.locator('#room-start').click();await page.waitForFunction(()=>window.mahjongRoom.room?.status==='playing'&&document.querySelector('#game').classList.contains('is-landscape'));await page.locator('#room-dialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('#dice-intro').hidden&&!document.querySelector('#game').classList.contains('is-opening-deal'));
  await page.evaluate(()=>{window.mahjongRoom.destroy();window.mahjongRoom.availableActions=()=>({chi:[],peng:false,gang:false,hu:false,pass:false,redGang:false,piziGang:false,wildGang:false,concealedGangs:[],addedGangs:[]});const g=window.mahjongGame;g.players.forEach((p,i)=>{p.hand=Array.from({length:i?10:14},(_,n)=>n);p.discards=Array.from({length:36},(_,n)=>(n+i*9)%34);p.redGangs=[];p.piziGangs=[];p.melds=[{kind:'peng',tiles:[20,20,20],from:1,concealed:false},{kind:'gang',tiles:[21,21,21,21],from:1,concealed:false}];});g.current=0;g.phase={kind:'discard',seat:0};g.pendingDiscard=null;g.lastDiscard=null;g.lastDraw=null;g.actionNotice=null;g.events=['牌桌工艺显示夹具'];window.renderMahjong();});await frames();
  for(const size of [{width:640,height:360},{width:844,height:390},{width:1920,height:1080}]){
    await page.setViewportSize(size);await frames();await load(true);const before=await snapshot();await load(false);const after=await snapshot();
    assert.deepEqual(after.geometry,before.geometry,'all table/tile/HUD/dice/direction rectangles, pseudo geometry, radii, transforms and click bounds remain exactly unchanged: '+JSON.stringify(size));
    for(const key of ['frame','border','inlay','console','well','dice','pip','room','environment']){
      assert.deepEqual(after[key].shape,before[key].shape,key+' geometry unchanged');assert.deepEqual(after[key].filters,['none','none']);assert.ok(split(after[key].shadow).length<=2,key+' at most two shadows');
      assert.ok(split(after[key].background).length<=8);assert.doesNotMatch(after[key].background,/url\(|image-set\(/);
    }
    for(const p of after.painted){if(p.p&&['none','normal'].includes(p.content))continue;assert.ok(split(p.shadow).length<=2,String(p.name)+' shadow budget');assert.deepEqual([p.filter,p.backdrop],['none','none']);}
    const layers=split(after.frame.background),old=split(before.frame.background),surface=split(after.border.background);
    report.paint={frame:after.frame,border:after.border};
    assert.equal(layers.length,8,'wood frame stays within eight gradient layers');assert.equal(surface.length,8,'existing felt/inlay layer stays within eight gradients');
    assert.match(layers[0],/^conic-gradient/);assert.ok(layers.slice(1,5).every(g=>g.startsWith('radial-gradient(circle')));assert.match(layers[5],/^linear-gradient\((?:180deg, )?rgb/);assert.match(layers[6],/^linear-gradient\(90deg/);
    assert.equal(layers[7],old[8],'original felt main light and palette retained');
    for(const [now,prior]of [[0,0],[1,1],[2,2],[3,3],[4,5],[5,6],[6,7],[7,8]])assert.equal(surface[now],old[prior],'retain original inlay, weave, wear, sheen and main felt light');
    const sizes=split(after.frame.size),rimRadius=parseFloat(sizes[1]),frameSize=parseFloat(sizes[7].split(' ')[1])/.916,span=parseFloat(sizes[6]),straightWidth=parseFloat(sizes[5]),straightHeight=Number(sizes[6].split(' ')[1].replace('px',''));
    assert.ok(Math.abs(straightWidth+2*rimRadius-span)<.01);assert.ok(Math.abs(straightHeight+2*rimRadius-frameSize)<.01,'six paint patches tile one rounded-rectangle field');
    assert.ok(Math.abs(frameSize-after.frameSize)<.017,'CSS paint dimensions agree with the DOM after layout subpixel quantization');
    const head=stopData(layers[5]).slice(0,17),vertical=stopData(layers[6]).slice(0,17),bevel=head[3].px,band=head[15].px;
    assert.deepEqual(vertical,head,'all four straight sides use one cross-section');assert.ok(bevel>=1&&bevel<=2);assert.ok(rimRadius>=band+2*bevel-.002,'grain inner curves retain a positive radius without altering the DOM outer radius');assert.ok(head.every((p,i)=>i===0||p.px>=head[i-1].px),'profile stops remain ordered at the smallest screen');
    const value=d=>interpolate(head.map(p=>[p.px,p.color]),d);let maxColorDelta=0,maxTangentDelta=0,samples=0;
    for(const gradient of layers.slice(1,5)){
      const corner=stopData(gradient);assert.equal(corner.length,head.length);assert.deepEqual(corner.map(p=>p.color).reverse(),head.map(p=>p.color));
      for(let i=0;i<corner.length;i++)assert.ok(Math.abs(rimRadius-corner[i].px-head[head.length-1-i].px)<.002,'corner R-r and straight inset d share the same phase');
      for(const d of [bevel*.5,bevel,band*.3,band*.5,band-bevel])for(const sign of [-1,1]){
        const e=rimRadius*.0001,radial=Math.hypot(e,rimRadius-d),c=interpolate(corner.map(p=>[p.px,p.color]),radial),v=value(d);
        maxColorDelta=Math.max(maxColorDelta,...v.map((n,i)=>Math.abs(n-c[i])));maxTangentDelta=Math.max(maxTangentDelta,Math.abs(Math.atan2(sign*e,rimRadius-d))*180/Math.PI);samples++;
      }
    }
    assert.ok(maxColorDelta<.05&&maxTangentDelta<.1,'grain colors and tangents cross all eight straight/corner joins without a seam');
    const polishStops=split(layers[0].slice(layers[0].indexOf('(')+1,-1)).filter(p=>/^rgba?\(/.test(p)).map(p=>[Number(p.match(/([\d.]+)deg$/)[1])/360,colors(p.match(/rgba?\([^()]*\)/)[0])]);
    assert.deepEqual(polishStops[0][1],polishStops.at(-1)[1],'continuous polish wraps without a lighting seam');
    const lit=(angle,d)=>composite(interpolate(polishStops,angle/360),value(d));
    const lighting={right:luminance(lit(90,bevel)),left:luminance(lit(270,bevel)),far:luminance(lit(0,bevel)),near:luminance(lit(180,bevel)),top:luminance(lit(90,bevel)),side:luminance(lit(90,bevel*.35)),lower:luminance(lit(90,0))};
    assert.ok(lighting.right>lighting.left&&lighting.far>lighting.near&&lighting.top>lighting.side&&lighting.side>lighting.lower,'right light and rounded top/side/lower profile agree');
    const cornerLuminance=layers.slice(1,5).map(g=>stopData(g).length);assert.ok(cornerLuminance.every(n=>n>=15));
    const oldSizes=split(before.frame.size),felt=sizes[7].split(' ').map(parseFloat),trim=split(after.border.size)[0].split(' ').map(parseFloat);
    assert.equal(sizes[7],oldSizes[8]);assert.ok(trim.every((v,i)=>Math.abs(v-felt[i]-8)<.001),'inlay still occupies its original 4px wood track');
    const edgeSizes=split(after.border.size);assert.ok(edgeSizes.slice(2).every(v=>v===oldSizes[2]),'felt paint width/height remain unchanged');
    const borderHeight=parseFloat(after.border.shape.height),origin=after.border.shape['transform-origin'].split(' ').map(parseFloat),positions=split(after.border.position);
    const paintTop=parseFloat(positions[7].split(' ')[1]);assert.ok(Math.abs(paintTop+felt[1]/2-frameSize*.43)<.002,'felt image stays at the existing projection origin');
    const ring=split(after.inlay.background);assert.equal(ring.length,2);assert.match(ring[0],/^radial-gradient/);assert.equal(gradientColors(ring[0])[0][3],0);
    const edges=split(after.inlay.shadow).map(g=>[...g.matchAll(/(-?[\d.]+)px/g)].map(m=>Number(m[1])));assert.deepEqual(edges,[[0,1,0,0],[0,-1,0,0]],'embedded gold retains 1px bright/dark edges');
    const depth=parseFloat(after.params['--table-console-depth']);assert.ok(depth>=1&&depth<=2);assert.match(after.console.background,/at 92% 32%/);assert.match(after.dice.background,/at 92% 32%/);
    for(const key of ['frame','console','dice'])for(const shadow of split(after[key].shadow).filter(g=>!g.includes('inset')))assert.ok(Number(shadow.match(/(-?[\d.]+)px/)[1])<0,'cast shadows stay leftward');
    assert.equal(after.room.background,before.room.background);assert.equal(after.environment.background,before.environment.background,'room and ground contact retained');
    const roomSamples=roomLight(after.room,size.width,size.height);
    report.cases.push({size,rectangles:after.geometry.length,geometryExactlyEqual:true,backgroundLayers:8,feltLayers:8,maxShadows:2,bevel,band,rimRadius,joins:{samples,maxColorDelta,maxTangentDelta},lighting,feltPaint:felt,trimPaint:trim,projectionOrigin:origin,borderHeight,consoleDepth:depth,roomSamples,frameRect:after.frameRect});
  }
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,cases:report.cases.length,rectangles:report.cases.reduce((n,c)=>n+c.rectangles,0),backgroundLayers:8,maxShadows:2,screenshots:0}));
}catch(error){report.failure=error.stack;throw error;}finally{
  if(process.env.KK_UI_TARGET_URL)try{report.testRoomLeft=await page.evaluate(()=>window.mahjongRoom.leave());}catch(error){report.cleanupError=error.message;}
  writeFileSync(process.env.KK_UI_TARGET_URL?'output/wood-rim-online.json':'output/wood-rim-verification.json',JSON.stringify(report,null,2));await browser.close();service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
