import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';

const BASELINE='a46cb58';
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
    return{geometry,frameRect:rect(table),consoleRect:rect(center),diceRects:Array.from(document.querySelectorAll('#table-dice .table-die')).map(rect),frame:layer(table,'::before'),border:layer(border),inlay:layer(border,'::after'),console:layer(center),well:layer(center,'::before'),dice:layer(die),pip:layer(die.querySelector('i')),room:layer(document.querySelector('#game')),environment:layer(document.querySelector('#game'),'::before'),painted,frameSize:parseFloat(getComputedStyle(table,'::before').width),params:Object.fromEntries(['--table-console-depth','--table-metal-edge-width','--table-inlay-track','--felt-groove-width','--table-metal-light','--table-metal-mid','--table-metal-dark','--wood-bevel','--wood-band','--wood-radius','--table-inner-wall-width','--table-inner-wall-left','--table-inner-wall-right','--table-inner-wall-near','--table-inner-wall-far','--table-trim-width','--table-joint-width','--table-joint-glint-width','--table-patina-light','--table-patina-shade','--tile-model-ivory'].map(k=>[k,s.getPropertyValue(k).trim()]))};
  });
}
function stopData(gradient){
  const args=split(gradient.slice(gradient.indexOf('(')+1,-1));
  return args.filter(s=>/^rgba?\(/.test(s)).map(s=>({color:colors(s.match(/rgba?\([^()]*\)/)[0]),px:(s.includes('calc(50% -')?-1:1)*Number(s.match(/(-?[\d.]+)px/)?.[1]||0)}));
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
      assert.deepEqual(after[key].shape,before[key].shape,key+' geometry unchanged');
      assert.deepEqual(after[key].filters,['none','none']);
      assert.ok(split(after[key].shadow).length<=2,key+' at most two shadows');
      const images=split(after[key].background);
      assert.ok(images.length<=10,key+' at most ten gradients');
      assert.ok(images.every(g=>/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/.test(g)),key+' gradients only');
    }
    for(const p of after.painted){if(p.p&&['none','normal'].includes(p.content))continue;assert.ok(split(p.shadow).length<=2,String(p.name)+' shadow budget');assert.deepEqual([p.filter,p.backdrop],['none','none']);}
    const wood=split(after.frame.background),felt=split(after.border.background);
    assert.equal(wood.length,10);assert.equal(felt.length,9);
    assert.equal(Number.parseFloat(after.params['--table-trim-width']),2);
    assert.equal(Number.parseFloat(after.params['--table-joint-width']),1);
    assert.equal(Number.parseFloat(after.params['--table-joint-glint-width']),.35);
    // Four square, mirrored patches: the diagonal dark strip is one CSS pixel
    // measured perpendicular to its 45-degree line, with two .35px glints.
    const woodSizes=split(after.frame.size).map(v=>v.split(' ').map(parseFloat));
    const woodPositions=split(after.frame.position);
    const jointStops=wood.slice(0,4).map(stopData);
    for(let i=0;i<4;i++){
      assert.ok(wood[i].startsWith('linear-gradient('+([45,135,45,135][i])+'deg'));
      assert.deepEqual(jointStops[i],jointStops[0]);
      assert.equal(jointStops[i][4].px-jointStops[i][3].px,1,'one-pixel dark joint');
      assert.ok(Math.abs(jointStops[i][2].px-jointStops[i][1].px-.35)<.001);
      assert.ok(Math.abs(jointStops[i][6].px-jointStops[i][5].px-.35)<.001);
      assert.equal(woodSizes[i][0],woodSizes[i][1],'square seam patch preserves 45 degrees');
    }
    assert.notEqual(woodPositions[0],woodPositions[1]);assert.notEqual(woodPositions[0],woodPositions[3]);
    const head=stopData(wood[8]).slice(0,18),corners=wood.slice(4,8).map(stopData);
    const radius=woodSizes[4][0],band=head[16].px,bevel=head[3].px;
    assert.ok(Math.abs(woodSizes[0][0]-(band-2)/Math.SQRT2)<.002,'joint ends before the continuous metal ring');
    const inset=radius*(1-1/Math.SQRT2),outerPoint=radius-Math.hypot(radius-inset,radius-inset);
    assert.ok(Math.abs(outerPoint)<.002,'joint begins on rounded outer edge, with no protruding line');
    assert.ok(Math.abs(radius-Math.SQRT2*(radius-inset-woodSizes[0][0])-(band-2))<.002,'joint meets metal outer edge without cutting the ring');
    let maxGrainDelta=0;
    for(const corner of corners){
      assert.equal(corner.length,head.length);
      for(let i=0;i<corner.length;i++){
        const straight=head[head.length-1-i];
        assert.ok(Math.abs(radius-corner[i].px-straight.px)<.002,'corner and straight grain share the same distance profile');
        if(straight.px>=bevel*2){
          maxGrainDelta=Math.max(maxGrainDelta,...corner[i].color.map((c,j)=>Math.abs(c-straight.color[j])));
        }
      }
    }
    assert.equal(maxGrainDelta,0,'grain phase and colors remain continuous; patina only warms the outer bevel');
    const patina=corners[0].find(p=>Math.abs(p.px-(radius-bevel))<.002).color;
    const oldCorner=stopData(split(before.frame.background)[1]);
    assert.notDeepEqual(corners[0],oldCorner,'rounded outer corner has warm highlight and shade');
    const face=await page.locator('#hand .tile').first().evaluate(n=>getComputedStyle(n,'::before').backgroundImage);
    const faceColors=gradientColors(face).filter(c=>(c[3]??1)===1);
    assert.ok(faceColors.length);const faceHighlight=Math.max(...faceColors.map(luminance));
    assert.ok(luminance(patina)<faceHighlight,'patina remains below the ivory face highlight');
    // The metal lives in the original six wood patches. Straight and radial
    // stops share a 2px distance profile, including all eight arc tangents.
    const metal=head.slice(14,17);
    assert.equal(metal[2].px-metal[0].px,2);
    assert.equal(metal[1].px-metal[0].px,1);
    assert.ok(luminance(metal[1].color)>luminance(metal[0].color)&&luminance(metal[1].color)>luminance(metal[2].color),'dark-gold / bright-gold / dark-gold');
    const woodVertical=stopData(wood[9]).slice(0,18);
    assert.deepEqual(woodVertical,head,'metal and grain use the same profile on both axes');
    for(const corner of corners)for(const stop of metal){
      const arc=corner.find(p=>Math.abs(p.px-(radius-stop.px))<.002);
      assert.ok(arc,'continuous rounded metal cross-section');assert.deepEqual(arc.color,stop.color);
    }
    assert.ok(Math.abs(woodSizes[8][0]+2*radius-woodSizes[9][0])<.002,'horizontal and curved patches tile without gaps');
    assert.ok(Math.abs(woodSizes[9][1]+2*radius-after.frameSize)<.02,'vertical and curved patches tile without gaps');
    const lightColors=gradientColors(felt[0]);
    const right=composite(lightColors[1],metal[1].color),left=composite(lightColors[3],metal[1].color);
    assert.ok(luminance(right)>luminance(left),'right-hand metal catches more light');
    assert.ok(Math.max(...lightColors.map(ink=>luminance(composite(ink,patina))))<faceHighlight,'even illuminated patina remains below the face highlight');
    const lightingSize=split(after.border.size)[0].split(' ').map(parseFloat);
    assert.equal(lightingSize[0],woodSizes[9][0]);
    assert.ok(Math.abs(lightingSize[1]-after.frameSize)<.02,'continuous light spans the existing wooden frame');
    const oldFelt=split(before.border.background);
    for(let i=3;i<9;i++){
      assert.equal(felt[i],oldFelt[i-1],'retain original weave, wear, sheen and main felt light');
      assert.equal(split(after.border.size)[i],split(before.border.size)[i-1],'original felt paint dimensions retained');
      assert.equal(split(after.border.position)[i],split(before.border.position)[i-1],'original felt paint origin retained');
    }
    assert.deepEqual(after.inlay,before.inlay);assert.deepEqual(after.console,before.console);assert.deepEqual(after.dice,before.dice);
    assert.deepEqual(after.room,before.room);assert.deepEqual(after.environment,before.environment);
    report.cases.push({size,rectangles:after.geometry.length,geometryExactlyEqual:true,woodLayers:10,feltLayers:9,maxShadows:2,jointWidth:1,jointGlints:.35,trimWidth:2,trimRadius:radius-band,maxGrainDelta,patinaLuminance:luminance(patina),faceHighlight,rightLuminance:luminance(right),leftLuminance:luminance(left),frame:after.frame,border:after.border});
  }
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,cases:report.cases.length,rectangles:report.cases.reduce((n,c)=>n+c.rectangles,0),backgroundLayers:10,maxShadows:2,screenshots:0}));
}catch(error){report.failure=error.stack;throw error;}finally{
  if(process.env.KK_UI_TARGET_URL)try{report.testRoomLeft=await page.evaluate(()=>window.mahjongRoom.leave());}catch(error){report.cleanupError=error.message;}
  writeFileSync(process.env.KK_UI_TARGET_URL?'output/wood-rim-online.json':'output/wood-rim-verification.json',JSON.stringify(report,null,2));await browser.close();service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
