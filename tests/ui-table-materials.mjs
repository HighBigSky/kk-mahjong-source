import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';

const BASELINE='306e39b';
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
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
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
    return{geometry,frameRect:rect(table),consoleRect:rect(center),diceRects:Array.from(document.querySelectorAll('#table-dice .table-die')).map(rect),frame:layer(table,'::before'),border:layer(border),inlay:layer(border,'::after'),console:layer(center),well:layer(center,'::before'),dice:layer(die),pip:layer(die.querySelector('i')),room:layer(document.querySelector('#game')),environment:layer(document.querySelector('#game'),'::before'),painted,frameSize:parseFloat(getComputedStyle(table,'::before').width),params:Object.fromEntries(['--table-console-depth','--table-metal-edge-width','--table-inlay-track','--felt-groove-width','--table-metal-light','--table-metal-mid','--table-metal-dark','--table-wood-grain','--table-wood-growth','--table-inner-wall-width','--table-inner-wall-left','--table-inner-wall-right','--table-inner-wall-near','--table-inner-wall-far'].map(k=>[k,s.getPropertyValue(k).trim()]))};
  });
}
function stopData(gradient){
  const args=split(gradient.slice(gradient.indexOf('(')+1,-1));
  return args.filter(s=>/^rgba?\(/.test(s)).map(s=>({color:colors(s.match(/rgba?\([^()]*\)/)[0]),px:Number(s.match(/(-?[\d.]+)px/)?.[1]||0)}));
}
function sample(stops,r){
  const period=stops.at(-1).px,p=((r%period)+period)%period;let i=1;while(i<stops.length-1&&p>stops[i].px)i++;
  const a=stops[i-1],b=stops[i],t=(p-a.px)/(b.px-a.px);return a.color.map((v,j)=>v+(b.color[j]-v)*t);
}
function grainContinuity(gradient,width){
  const stops=stopData(gradient);assert.ok(stops.length>=5);assert.deepEqual(stops[0].color,stops.at(-1).color,'period wraps to the same color');
  let maxColorDelta=0,maxTangentDelta=0,samples=0;
  for(const sx of [-1,1])for(const sy of [-1,1])for(let r=.36;r<=.48;r+=.01){
    const e=.0005,a=[sx*(r+e),sy*(r-e)],b=[sx*(r-e),sy*(r+e)],ra=Math.hypot(...a)*width,rb=Math.hypot(...b)*width;
    const ca=sample(stops,ra),cb=sample(stops,rb);maxColorDelta=Math.max(maxColorDelta,...ca.map((v,i)=>Math.abs(v-cb[i])));
    let angle=Math.abs(Math.atan2(a[1],a[0])-Math.atan2(b[1],b[0]));if(angle>Math.PI)angle=2*Math.PI-angle;maxTangentDelta=Math.max(maxTangentDelta,angle*180/Math.PI);samples++;
  }
  assert.ok(maxColorDelta<1e-8&&maxTangentDelta<.2,'one analytic field crosses all four miter diagonals continuously');
  return{samples,maxColorDelta,maxTangentDelta,period:stops.at(-1).px};
}
const hex=value=>[1,3,5,7].map((i,n)=>n===3?(value.length===9?parseInt(value.slice(i,i+2),16)/255:1):parseInt(value.slice(i,i+2),16));
function percentageStops(gradient){
  return split(gradient.slice(gradient.indexOf('(')+1,-1)).filter(s=>/^rgba?\(/.test(s)).flatMap(s=>{const token=s.match(/rgba?\([^()]*\)/)[0],color=colors(token);return [...s.slice(token.length).matchAll(/([\d.]+)%/g)].map(m=>[Number(m[1])/100,color]);});
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
      assert.ok(split(after[key].background).length<=12);assert.doesNotMatch(after[key].background,/url\(|image-set\(/);
    }
    for(const p of after.painted){if(p.p&&['none','normal'].includes(p.content))continue;assert.ok(split(p.shadow).length<=2,String(p.name)+' shadow budget');assert.deepEqual([p.filter,p.backdrop],['none','none']);}
    const layers=split(after.frame.background),old=split(before.frame.background);assert.equal(layers.length,11);
    for(const [now,prior]of [[2,2],[3,3],[4,4],[5,5],[6,6],[8,7],[9,8],[10,9]])assert.equal(layers[now],old[prior],'original weave/fuzz/wear/felt lighting and wood are retained');
    for(const i of [5,6]){assert.match(layers[i],/^radial-gradient/);const ink=gradientColors(layers[i]);assert.ok(ink.every(c=>(c[3]??1)<=.025));assert.equal(ink.at(-1)[3],0,'usage variation fades out');assert.doesNotMatch(layers[i],/repeating/);}
    const bgSizes=split(after.frame.size),priorSizes=split(before.frame.size);assert.ok(bgSizes.slice(2,9).every(s=>s===priorSizes[2]),'felt paint footprint unchanged');
    const trim=bgSizes[0].split(' ').map(parseFloat),felt=bgSizes[2].split(' ').map(parseFloat);assert.ok(trim.every((v,i)=>Math.abs(v-felt[i]-8)<.001),'4px inlay lies on wood outside each unchanged felt edge');
    for(const i of [0,1]){assert.match(layers[i],/^linear-gradient/);for(const c of [[233,212,157],[187,150,92],[105,70,37]])assert.ok(gradientColors(layers[i]).some(color=>c.every((v,j)=>v===color[j])),'three metallic tones in trim');}
    const ring=split(after.inlay.background);assert.equal(ring.length,2);assert.match(ring[0],/^radial-gradient/);assert.equal(gradientColors(ring[0])[0][3],0,'metal ring leaves the interior transparent');
    const edges=split(after.inlay.shadow).map(s=>[...s.matchAll(/(-?[\d.]+)px/g)].map(m=>Number(m[1])));assert.deepEqual(edges,[[0,1,0,0],[0,-1,0,0]],'1px upper glint and 1px lower groove');
    const depth=Number.parseFloat(after.params['--table-console-depth']);assert.ok(depth>=1&&depth<=2);assert.ok(split(after.console.shadow).some(s=>s.includes('inset')&&s.includes(depth+'px')),'console has 1-2px recessed contact');
    assert.match(after.console.background,/at 92% 32%/);assert.match(after.dice.background,/at 92% 32%/);assert.match(after.pip.background,/radial-gradient/);
    assert.ok(after.diceRects.length===2&&after.diceRects.every(r=>r[0]>=after.consoleRect[0]-.5&&r[1]>=after.consoleRect[1]-.5&&r[0]+r[2]<=after.consoleRect[0]+after.consoleRect[2]+.5&&r[1]+r[3]<=after.consoleRect[1]+after.consoleRect[3]+.5),'both dice sit within the unchanged console');
    for(const key of ['frame','console','dice'])for(const s of split(after[key].shadow).filter(s=>!s.includes('inset'))){const x=Number(s.match(/(-?[\d.]+)px/)[1]);assert.ok(x<0,key+' casts left');}
    const metal=after.params['--table-metal-light'];const metalRgb=[1,3,5].map(i=>parseInt(metal.slice(i,i+2),16));assert.ok(luminance(metalRgb)<luminance([255,254,246]),'gold stays below tile highlights');
    const grain=layers.slice(9);assert.ok(grain.every(s=>s.startsWith('repeating-radial-gradient(')));assert.ok(['--table-wood-grain','--table-wood-growth'].every(k=>after.params[k].includes('at 50% 50%')),'one shared center and phase instead of four plank directions');
    const corners=grain.map(g=>grainContinuity(g,after.frameSize));
    const border=split(after.border.background);assert.equal(border.length,7);assert.match(border[0],/^linear-gradient/);const farInk=gradientColors(border[0]);assert.equal(farInk.at(-1)[3],0);assert.ok(farInk[0][3]>0&&farInk[0][3]<=.31);
    const wood=[96,67,46],far=luminance(composite(farInk[0],wood)),near=luminance(wood);assert.ok(far<near,'far trim is darker');
    const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));const a=[128,87,51],b=[60,38,25],softness=distance(composite(farInk[0],a),composite(farInk[0],b))/distance(a,b);assert.ok(Math.abs(softness-.7)<.001,'far fine grain contrast is reduced 30% without blur');
    assert.ok(border.slice(1,5).every(g=>/^radial-gradient/.test(g)),'four rounded corner polish fields');
    const wallWidth=parseFloat(after.params['--table-inner-wall-width']);assert.equal(wallWidth,2.5);
    const walls=Object.fromEntries(['left','right','near','far'].map(side=>[side,hex(after.params['--table-inner-wall-'+side])]));
    const feltRgb=[27,85,67],leftWall=luminance(composite(walls.left,feltRgb)),rightWall=luminance(composite(walls.right,feltRgb));assert.ok(rightWall>leftWall);
    for(const [axis,sides]of [[0,['left','right']],[1,['near','far']]])for(const side of sides)assert.ok(gradientColors(layers[axis]).some(c=>c.every((v,i)=>Math.abs(v-walls[side][i])<.001)),'every wall color is used in the continuous two-axis groove');
    // 两条覆盖整幅的线性场在四角叠合，非透明壁段连续相交，没有四块拼片的空口。
    const wallCorners=[];for(const horizontal of ['left','right'])for(const vertical of ['near','far']){const ink=composite(walls[horizontal],composite(walls[vertical],feltRgb));wallCorners.push({horizontal,vertical,ink,opacity:1-(1-walls[horizontal][3])*(1-walls[vertical][3])});}assert.ok(wallCorners.every(c=>c.opacity>=.8));
    const room=split(after.room.background),environment=split(after.environment.background);assert.equal(room.length,5);assert.equal(environment.length,4);assert.match(room[1],/at 92% 32%/);
    const roomSamples=roomLight(after.room,size.width,size.height);
    const ground=environment.slice(0,2).map(gradientColors);assert.ok(ground[0][0][3]>ground[1][0][3]);assert.ok(ground.every(stops=>stops.at(-1)[3]===0),'floor patches fade to transparent before their rectangular limits');
    assert.ok(environment.slice(0,2).every(g=>g.endsWith('70%)')),'radial patches end before the nearest patch edge at 70.7%');
    assert.deepEqual(split(after.environment.size).slice(0,2),['88% 28%','68% 14%']);assert.deepEqual(split(after.environment.position).slice(0,2),['50% 100%','50% 24%']);
    assert.deepEqual(environment.slice(2),split(before.environment.background),'existing ambient light and vignette retained');
    const sheen=layers[7],sheenColors=gradientColors(sheen);assert.match(sheen,/^linear-gradient\(255deg/);assert.ok(sheenColors.every(c=>c[3]<=.04));assert.equal(sheenColors[0][3],0);assert.equal(sheenColors.at(-1)[3],0);
    const angle=255*Math.PI/180,sheenT=(x,y)=>.5+((x-.5)*felt[0]*Math.sin(angle)-(y-.5)*felt[1]*Math.cos(angle))/(Math.abs(felt[0]*Math.sin(angle))+Math.abs(felt[1]*Math.cos(angle)));
    const sheenStops=percentageStops(sheen);assert.ok(sheenStops.length>=7,'all stops in the wide reflection ramp are present');
    const sheenRight=interpolate(sheenStops,sheenT(.75,.35))[3],sheenLeft=interpolate(sheenStops,sheenT(.25,.65))[3];assert.ok(sheenRight>sheenLeft&&sheenRight>0,'velvet reflection band follows the right lamp');
    report.cases.push({size,rectangles:after.geometry.length,geometryExactlyEqual:true,backgroundLayers:11,roomLayers:5,environmentLayers:4,maxShadows:2,wallWidth,leftWall,rightWall,wallCorners,roomSamples,groundNearAlpha:ground[0][0][3],groundFarAlpha:ground[1][0][3],sheenMaxAlpha:Math.max(...sheenColors.map(c=>c[3])),sheenRight,sheenLeft,consoleDepth:depth,metalEdge:1,corners,wearMaxAlpha:Math.max(...[5,6].flatMap(i=>gradientColors(layers[i]).map(c=>c[3]??1))),farLuminance:far,nearLuminance:near,farContrastRatio:softness,frameRect:after.frameRect});
  }
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,cases:report.cases.length,rectangles:report.cases.reduce((n,c)=>n+c.rectangles,0),backgroundLayers:11,maxShadows:2,screenshots:0}));
}catch(error){report.failure=error.stack;throw error;}finally{
  if(process.env.KK_UI_TARGET_URL)try{report.testRoomLeft=await page.evaluate(()=>window.mahjongRoom.leave());}catch(error){report.cleanupError=error.message;}
  writeFileSync(process.env.KK_UI_TARGET_URL?'output/table-room-online.json':'output/table-room-verification.json',JSON.stringify(report,null,2));await browser.close();service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
