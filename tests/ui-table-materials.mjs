import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';

const BASELINE='3601345';
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
  await page.evaluate(({sheets,baseline})=>Promise.all(sheets.map(file=>new Promise((resolve,reject)=>{const link=[...document.querySelectorAll('link[rel=stylesheet]')].find(node=>new URL(node.href).pathname.endsWith('/'+file));link.onload=resolve;link.onerror=()=>reject(Error('stylesheet failed: '+file));link.href='/'+file+'?table-'+(baseline?'baseline':'current')+'='+Date.now();}))),{sheets,baseline});
  await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await frames();
}
async function snapshot() {
  return page.evaluate(()=>{
    const properties=['position','display','top','right','bottom','left','width','height','padding','margin','box-sizing','transform','transform-origin','transform-style','perspective','clip-path','z-index','border-radius','border-width','border-style','overflow','pointer-events'];
    const shape=style=>Object.fromEntries(properties.map(name=>[name,style.getPropertyValue(name)]));
    const rect=node=>{const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height];};
    const table=document.querySelector('.table'),border=document.querySelector('.table-border'),game=document.querySelector('#game');
    const selectors=['#game','.table','.table-border','.table-center','#hand','#wall-tail','.river','.opponent-rack','.my-melds','.table .tile','.table .back','.wall-stack','#hand button','.player-seat','.action-zone'];
    const geometry=Object.fromEntries(selectors.map(selector=>[selector,[...document.querySelectorAll(selector)].filter(node=>node.getClientRects().length).map(node=>({rect:rect(node),shape:shape(getComputedStyle(node))}))]));
    const layer=(node,pseudo)=>{const s=getComputedStyle(node,pseudo);return {shape:shape(s),background:s.backgroundImage,size:s.backgroundSize,position:s.backgroundPosition,repeat:s.backgroundRepeat,shadow:s.boxShadow,filters:[s.filter,s.backdropFilter],colors:[s.borderTopColor,s.borderRightColor,s.borderBottomColor,s.borderLeftColor]};};
    const s=getComputedStyle(table);
    const tile=getComputedStyle(document.querySelector('#hand button'));
    return {geometry,frame:layer(table,'::before'),border:layer(border),inlay:layer(border,'::after'),game:layer(game),environment:layer(game,'::before'),groove:{width:parseFloat(s.getPropertyValue('--felt-groove-width')),highlight:parseFloat(s.getPropertyValue('--felt-groove-highlight-width'))},tileLight:[tile.getPropertyValue('--tile-model-shine-x'),tile.getPropertyValue('--tile-model-shine-y')].map(parseFloat),felt:[s.getPropertyValue('--felt-light'),s.getPropertyValue('--felt-base'),s.getPropertyValue('--felt-shade')].map(value=>value.trim()),frameSize:getComputedStyle(table,'::before').width};
  });
}
try {
  await page.goto(target,{waitUntil:'networkidle'});
  await page.locator('#room-name').fill('牌桌纹理验收');await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();
  for(const seat of [1,2,3])await page.locator(`.room-bot-add[data-seat="${seat}"]`).click();
  await page.locator('#room-ready').click();await page.locator('#room-start').click();
  report.startBeforeWait=await page.evaluate(()=>({room:window.mahjongRoom.room?.status,landscape:document.querySelector('#game').classList.contains('is-landscape')}));
  // 公网响应到达前，等待页也满足“无骰子/发牌动画”；必须先确认真实开局与横屏对局生效。
  await page.waitForFunction(()=>window.mahjongRoom.room?.status==='playing'&&document.querySelector('#game').classList.contains('is-landscape'));
  await page.locator('#room-dialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('#dice-intro').hidden&&!document.querySelector('#game').classList.contains('is-opening-deal'));
  await page.evaluate(()=>{window.mahjongRoom.destroy();window.mahjongRoom.availableActions=()=>({chi:[],peng:false,gang:false,hu:false,pass:false,redGang:false,piziGang:false,wildGang:false,concealedGangs:[],addedGangs:[]});const game=window.mahjongGame;game.players.forEach((player,i)=>{player.hand=Array.from({length:i?10:14},(_,n)=>n);player.discards=Array.from({length:36},(_,n)=>(n+i*9)%34);player.redGangs=[];player.piziGangs=[];player.melds=[{kind:'peng',tiles:[20,20,20],from:1,concealed:false},{kind:'gang',tiles:[21,21,21,21],from:1,concealed:false}];});game.current=0;game.phase={kind:'discard',seat:0};game.pendingDiscard=null;game.lastDiscard=null;game.lastDraw=null;game.actionNotice=null;game.events=['牌桌纹理展示夹具'];window.renderMahjong();});await frames();
  for(const size of [{width:640,height:360},{width:844,height:390},{width:1920,height:1080}]) {
    await page.setViewportSize(size);await frames();await load(true);const before=await snapshot();await load(false);const after=await snapshot();
    assert.deepEqual(after.geometry,before.geometry,'every table/frame/hand/river/wall/meld rectangle and geometry property remains exactly unchanged: '+JSON.stringify(size));
    for(const name of ['frame','border','inlay','game','environment']){
      assert.deepEqual(after[name].shape,before[name].shape,`${name} dimensions, padding, transform, clipping, radius, layer and border widths unchanged`);
      assert.deepEqual(after[name].filters,['none','none']);
      const images=split(after[name].background);assert.ok(images.length<=8);assert.ok(images.every(image=>image==='none'||/^(?:repeating-)?(?:linear|radial)-gradient\(/.test(image)));assert.doesNotMatch(after[name].background,/url\(/);
    }
    const layers=split(after.frame.background);assert.equal(layers.length,8);
    assert.match(layers[2],/^repeating-linear-gradient\(90deg/);assert.match(layers[3],/^repeating-linear-gradient\(0deg/);
    assert.match(layers[4],/^repeating-radial-gradient/);assert.match(layers[5],/^radial-gradient\(at 68% 24%/);
    assert.ok(layers.slice(6).every(layer=>layer.startsWith('repeating-radial-gradient')),'two continuous wood growth periods');
    const ratios=[2,3,4,6,7].map(index=>{const lengths=[...layers[index].matchAll(/(-?[\d.]+)px/g)].map(match=>Number(match[1]));return lengths.at(-1)/parseFloat(after.frameSize);});
    for(const [i,ratio]of ratios.entries())assert.ok(Math.abs(ratio-[.0018,.0018,.00187,.005,.038][i])<1e-6,'material periods scale with the physical table width');
    const sizes=after.frame.size.split(',').map(value=>value.trim()),positions=after.frame.position.split(',').map(value=>value.trim());assert.ok(sizes.slice(0,6).every(value=>value===sizes[0]),'groove, cloth lighting and weave share one unchanged felt paint region');assert.equal(sizes[0],before.frame.size.split(',')[0].trim(),'groove follows the original cloth boundary');assert.ok(positions.slice(0,6).every(value=>value===positions[0]),'all four groove corners meet on the same paint rectangle');
    assert.ok(after.groove.width>=2&&after.groove.width<=3);assert.ok(after.groove.highlight>0&&after.groove.highlight<=1);
    for(const [index,angle]of [[0,90],[1,0]]){
      assert.match(layers[index],new RegExp('^linear-gradient\\('+angle+'deg'));
      const ink=gradientColors(layers[index]);assert.equal(ink.length,12);assert.ok(ink[0][3]>.5&&ink.at(-1)[3]>.5);assert.ok(ink[3][3]>0&&ink[3][3]<ink[0][3]);assert.equal(ink[5][3],0);assert.equal(ink[6][3],0);
      const px=[...layers[index].matchAll(/(-?[\d.]+)px/g)].map(match=>Number(match[1]));assert.equal(px[2],after.groove.width);assert.ok(Math.abs(px[4]-after.groove.width-after.groove.highlight)<1e-5,'inner glint is subpixel and stays within the original cloth boundary');
    }
    const well=split(after.inlay.background);assert.equal(well.length,1);assert.match(well[0],/^radial-gradient/);const wellInk=gradientColors(well[0]);assert.ok(wellInk[0][3]>0&&wellInk[0][3]<=.15);assert.equal(wellInk.at(-1)[3],0,'center depression fades to transparent without a hard boundary');const wellShadows=split(after.inlay.shadow);assert.equal(wellShadows.length,2);assert.ok(wellShadows.every(value=>value.includes('inset')&&Number([...value.matchAll(/(-?[\d.]+)px/g)][2][1])>0));
    const oldShadows=split(before.frame.shadow),shadows=split(after.frame.shadow);assert.equal(shadows.length,4);assert.equal(shadows.length,oldShadows.length);
    for(let i=0;i<shadows.length;i++){const px=value=>[...value.matchAll(/(-?[\d.]+)px/g)].map(match=>Number(match[1]));assert.deepEqual(px(shadows[i]).slice(0,2),px(oldShadows[i]).slice(0,2),'side-wall and ground offsets unchanged');}
    const woodLum=shadows.slice(0,3).map(shadow=>luminance(colors(shadow)));assert.ok(woodLum[0]>woodLum[1]&&woodLum[1]>woodLum[2],'three original side-wall layers run from highlight through middle to shade');
    const felt=[27,85,67],gold=after.inlay.colors.map(colors),oldGold=before.inlay.colors.map(colors);
    const goldContrast=gold.map(color=>contrast(composite(color,felt),felt)),oldContrast=oldGold.map(color=>contrast(composite(color,felt),felt));
    assert.deepEqual(after.inlay.colors,before.inlay.colors,'existing gold line endpoints are retained');assert.ok(gold.every(color=>luminance(composite(color,felt))<luminance([255,253,246])),'inlay remains darker than the tile highlights');
    const depth=split(after.border.background);assert.equal(depth.length,2);assert.match(depth[0],/^linear-gradient\(215deg/);assert.match(depth[1],/^linear-gradient\((?:180deg,\s*)?rgba?\(/);const depthInk=gradientColors(depth[1]),wood=[96,67,46],far=luminance(composite(depthInk[0],wood)),near=luminance(composite(depthInk.at(-1),wood));assert.ok(far>near&&depthInk.at(-1)[3]>depthInk[0][3],'near wood is darker, far wood lighter');assert.ok(luminance(composite(colors(after.frame.colors[0]),wood))>luminance(composite(colors(after.frame.colors[2]),wood)),'thin far edge is lighter than near edge');
    const nearDepth=Number([...shadows[2].matchAll(/(-?[\d.]+)px/g)][1][1]);assert.ok(nearDepth>parseFloat(after.frame.shape['border-width']),'three positive-Y sidewall shadows paint more near depth than the far thin edge');
    assert.deepEqual(after.tileLight,before.tileLight,'tile material is untouched');assert.ok(after.tileLight.every((value,index)=>Math.abs(value-[82,8][index])<1e-4),"light direction keeps its upper-right reference despite serialized projection tails");const gameLayers=split(after.game.background);assert.equal(gameLayers.length,3);assert.match(gameLayers[1],/^radial-gradient\(at 82% 8%/);const outside=gradientColors(gameLayers[0]);assert.equal(outside[0][3],0);assert.ok(outside.at(-1)[3]>.5,'environment darkens softly away from the table');
    report.cases.push({size,tableRect:after.geometry['.table'][0].rect,frameRect:after.geometry['.table-border'][0].rect,rectangles:Object.values(after.geometry).reduce((sum,list)=>sum+list.length,0),geometryExactlyEqual:true,backgroundLayers:layers.length,texturePeriods:[2,3,4,6,7].map(index=>[...layers[index].matchAll(/(-?[\d.]+)px/g)].map(match=>Number(match[1])).at(-1)),frameWidth:parseFloat(after.frameSize),periodRatios:ratios,gold:after.inlay.colors,goldContrast,oldContrast,groove:after.groove,wellAlpha:wellInk[0][3],wellShadows:wellShadows.length,nearFarLuminance:{near,far},nearDepth,shadowLayers:shadows.length,gameLayers:gameLayers.length,tileLight:after.tileLight});
  }
  assert.ok(new Set(report.cases.map(row=>row.frameWidth)).size>1,'density is checked at different physical frame widths');assert.deepEqual(report.errors,[]);report.passed=true;
  console.log(JSON.stringify({passed:true,cases:report.cases.length,rectangles:report.cases.reduce((sum,row)=>sum+row.rectangles,0),backgroundLayers:8,errors:report.errors,screenshots:0}));
} finally {
  if(process.env.KK_UI_TARGET_URL)try{report.testRoomLeft=await page.evaluate(()=>window.mahjongRoom.leave());}catch(error){report.cleanupError=error.message;}
  writeFileSync(process.env.KK_UI_TARGET_URL?'output/table-materials-online-verification.json':'output/table-materials-verification.json',JSON.stringify(report,null,2));await browser.close();service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
