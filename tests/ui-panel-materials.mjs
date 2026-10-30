import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';

const BASELINE='b7442ff',sheets=['styles.css','seats-layout.css','landscape.css'];
const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const service=new RoomService({botDelayMs:600000}),server=createServer({roomService:service});
server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const context=await browser.newContext({viewport:{width:360,height:640},reducedMotion:'reduce'});
await context.addInitScript(()=>{localStorage.setItem('queqi-settings',JSON.stringify({sound:false}));Object.defineProperty(Element.prototype,'requestFullscreen',{value:()=>Promise.reject(Error('panel fixture'))});});
for(const file of sheets)await context.route(`**/${file}?panel-baseline=*`,route=>route.fulfill({body:execFileSync('git',['show',`${BASELINE}:${file}`]),contentType:'text/css'}));
const page=await context.newPage(),target=process.env.KK_UI_TARGET_URL||`http://127.0.0.1:${server.address().port}`;
const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
const report={passed:false,baseline:BASELINE,browser:browser.version(),cases:[],states:[],errors:[],screenshots:0,note:'Real HTTP/SSE room, display-only state fixtures; exact geometry, CSS material/luminance checks. No screenshots or pixel sampling.'};
page.on('pageerror',e=>report.errors.push(e.message));mkdirSync('output',{recursive:true});
const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const split=s=>{if(s==='none')return [];const out=[];let depth=0,start=0;for(let i=0;i<s.length;i++){if(s[i]==='(')depth++;else if(s[i]===')')depth--;else if(s[i]===','&&!depth){out.push(s.slice(start,i).trim());start=i+1;}}out.push(s.slice(start).trim());return out;};
const rgb=s=>s.startsWith('#')?[1,3,5].map(i=>parseInt(s.slice(i,i+2),16)):(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
const luminance=c=>c.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
async function sheet(baseline){
  await page.evaluate(async({sheets,baseline})=>{
    // 先取齐三表，再在同一任务内按原顺序替换，避免公网逐表到达时的中间布局触发滚动锚定。
    const sources=await Promise.all(sheets.map(async file=>{const response=await fetch('/'+file+'?panel-'+(baseline?'baseline':'current')+'='+Date.now(),{cache:'no-store'});if(!response.ok)throw Error('stylesheet '+file);return response.text();}));
    sheets.forEach((file,i)=>{const old=document.querySelector(`[data-panel-sheet="${file}"]`)||[...document.querySelectorAll('link[rel=stylesheet]')].find(n=>new URL(n.href).pathname.endsWith('/'+file));const style=document.createElement('style');style.dataset.panelSheet=file;style.textContent=sources[i];old.replaceWith(style);});
    // 固定对照输入：都从弹窗起点测量，并同时断言内容总尺寸，不能靠改变滚动量掩盖尺寸差异。
    for(const dialog of document.querySelectorAll('.modal[open]')){dialog.scrollTop=0;dialog.scrollLeft=0;}
  },{sheets,baseline});await frames();
}
async function snapshot(){return page.evaluate(()=>{
  const selectors='.player-seat,.player-seat *,.topbar,.topbar *,.action-zone,.action-zone *,.modal[open],.modal[open] *,.table,.table-border,.river,.opponent-rack,#hand,.hand-zone,#wall-tail,.wall-stack';
  const nodes=[...document.querySelectorAll(selectors)].filter(n=>n.getClientRects().length);
  const properties=['width','height','padding','margin','gap','border-width','border-radius','box-sizing','position','top','right','bottom','left','transform','transform-origin','clip-path','z-index','overflow','pointer-events','font-size','font-weight','font-family','line-height','letter-spacing'];
  const geometry=nodes.map(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return {name:n.id||n.tagName+'.'+n.getAttribute('class'),rect:[r.x,r.y,r.width,r.height],shape:Object.fromEntries(properties.map(name=>[name,s.getPropertyValue(name)])),image:n.matches('img')?n.getAttribute('src'):null};});
  const widgets=[...document.querySelectorAll('.player-seat,.portrait,.wallet-pill,.hud-stat,.laizi-summary,.connection,.room-invite,button:not(.tile),.modal[open],.modal[open] input:not([type="checkbox"]),.modal[open] select')].filter(n=>n.getClientRects().length);
  const paint=widgets.map(n=>{const s=getComputedStyle(n);return {id:n.id,name:n.className,tag:n.tagName,disabled:n.disabled||false,background:s.backgroundImage,color:s.backgroundColor,text:s.color,border:s.borderColor,shadow:s.boxShadow,filter:s.filter,backdrop:s.backdropFilter,transition:s.transitionProperty,model:s.getPropertyValue('--ui-panel-version').trim(),base:s.getPropertyValue('--ui-panel-base').trim(),coat:s.getPropertyValue('--ui-panel-coat').trim(),cast:s.getPropertyValue('--ui-panel-cast').trim(),edge:s.getPropertyValue('--ui-panel-edge').trim(),shine:s.getPropertyValue('--ui-panel-shine-x').trim(),unit:s.getPropertyValue('--ui-panel-unit').trim(),variant:s.fontVariantNumeric};});
  const dialogs=[...document.querySelectorAll('.modal[open]')].map(n=>{const s=getComputedStyle(n,'::backdrop');return {id:n.id,color:s.backgroundColor,image:s.backgroundImage,backdrop:s.backdropFilter};});
  const scrollers=[...document.querySelectorAll('.modal[open]')].map(n=>({id:n.id,top:n.scrollTop,left:n.scrollLeft,width:n.scrollWidth,height:n.scrollHeight,clientWidth:n.clientWidth,clientHeight:n.clientHeight}));
  const numeric=[...document.querySelectorAll('.topbar strong')].map(n=>({id:n.id,variant:getComputedStyle(n).fontVariantNumeric,features:getComputedStyle(n).fontFeatureSettings}));
  const palette=getComputedStyle(document.documentElement);
  const semantic=[...document.querySelectorAll('.player-seat,.opponent-name,.opponent-score,.opponent-state,.room-member-state')].map(n=>{const s=getComputedStyle(n);return [n.id||n.className,s.color,s.borderColor];});
  return {geometry,paint,dialogs,scrollers,numeric,semantic,palette:['--tile-ivory','--ui-panel-base','--felt-base','--ui-panel-active-base'].map(k=>palette.getPropertyValue(k).trim())};
});}
function assertPaint(current,{state='normal'}={}){
  const painted=current.paint.filter(p=>p.coat&&(['DIALOG','INPUT','SELECT'].includes(p.tag)||/player-seat|portrait|wallet-pill|hud-stat|laizi-summary|connection|room-invite|action-button|primary-button|secondary-button|icon-button|modal-close|hint-button|hint-close|setting-link|choice-option|room-bot-button/.test(p.name)));
  assert.ok(painted.length);
  for(const p of painted){assert.equal(p.model,'resin-panel-v1');assert.ok(split(p.shadow).length<=2,p.id+' <=2 shadows');assert.deepEqual([p.filter,p.backdrop],['none','none']);
    if(!p.disabled){assert.match(p.background,/(?:92|98)% 32%/,p.id+' right-side sheen');for(const shadow of split(p.shadow).filter(s=>!s.includes('inset'))){const px=[...shadow.matchAll(/(-?[\d.]+)px/g)].map(m=>Number(m[1]));assert.ok(px[0]<=0,p.id+' leftward projection');}}
    else {assert.equal(p.background,'none',p.id+' disabled has no highlight');assert.ok(split(p.shadow).every(s=>s.includes('inset')));}
  }
  for(const d of current.dialogs){const channels=(d.color.match(/[\d.]+/g)||[]).map(Number);assert.deepEqual(channels.slice(0,3),[0,0,0],'neutral blackout without color cast');assert.equal(d.backdrop,'none');}
  const hud=current.paint.filter(p=>/wallet-pill|hud-stat|laizi-summary/.test(p.name));
  if(hud.length){assert.equal(hud.length,4);assert.ok(hud.every(p=>p.color===hud[0].color&&p.background===hud[0].background&&p.shadow===hud[0].shadow&&p.coat===hud[0].coat),'four HUD pills use identical recess paint');assert.ok(split(hud[0].shadow).some(s=>s.includes('inset')));}
  assert.ok(current.numeric.every(n=>n.variant.includes('tabular-nums')),'existing tabular numeric metrics are preserved without changing glyph families');
  const seats=current.paint.filter(p=>p.name.includes('player-seat'));if(seats.length){assert.equal(seats.length,4);assert.ok(seats.every(p=>p.base===seats[0].base&&p.coat===seats[0].coat&&p.cast===seats[0].cast),'four seats share one material');}
  const [face,panel,felt,active]=current.palette.map(rgb).map(luminance);assert.ok(face>panel&&panel>felt&&face>active,'face > panel > felt, including active seat');
}
async function compare(label,{state='normal',validate=true}={}){
  await sheet(true);const before=await snapshot();await sheet(false);const after=await snapshot();
  assert.deepEqual(after.geometry,before.geometry,label+' all rectangles/geometry, typography, images and hit regions unchanged');
  assert.deepEqual(after.scrollers,before.scrollers,label+' scroll viewport, content bounds and test scroll positions unchanged');
  // 座位身份/离线提示的字色与强调边框不能因材质换色改变。
  assert.deepEqual(after.semantic,before.semantic,label+' identity/action/offline colors stay unchanged');
  if(validate)assertPaint(after,{state});
  report.cases.push({label,rectangles:after.geometry.length,exactGeometry:true,scrollers:after.scrollers,paint:after.paint,dialogs:after.dialogs,palette:after.palette});return after;
}
async function force(selector,state){
  const {root}=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});assert.ok(nodeId,selector);
  await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:state==='hover'?['hover']:state==='pressed'?['hover','active']:[]});await frames();
}
async function controls(selectors,label){
  for(const selector of selectors){
    const wasDisabled=await page.locator(selector).evaluate(n=>n.disabled);await page.locator(selector).evaluate(n=>n.disabled=false);
    const states={};for(const state of ['normal','hover','pressed','disabled']){
      await page.locator(selector).evaluate((n,disabled)=>n.disabled=disabled,state==='disabled');await force(selector,state);
      const result=await compare(label+' '+selector+' '+state,{state});const p=result.paint.find(p=>p.id===selector.slice(1));states[state]=p;
    }
    assert.equal(states.normal.shine,'92%');assert.equal(states.hover.shine,'98%');assert.notEqual(states.pressed.shadow,states.hover.shadow);assert.ok(split(states.pressed.shadow).every(s=>s.includes('inset')));
    assert.equal(states.disabled.background,'none');report.states.push({label,selector,states});
    await force(selector,'normal');await page.locator(selector).evaluate((n,value)=>n.disabled=value,wasDisabled);
  }
}
try {
  await cdp.send('CSS.enable');await page.goto(target,{waitUntil:'networkidle'});
  await compare('360x640 create room');await controls(['#room-create','#room-join'],'portrait lobby');
  await page.locator('#room-name').fill('共享面板材质');await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();
  for(const seat of [1,2,3])await page.locator(`.room-bot-add[data-seat="${seat}"]`).click();await page.waitForFunction(()=>!window.mahjongRoom.busy&&window.mahjongRoom.room.seats.every(seat=>seat.occupied));await compare('360x640 waiting room');
  const onlineMember=await page.locator('#room-members li[data-seat="1"]').evaluate(n=>{const saved={classes:n.className,text:n.querySelector('.room-member-state').textContent};n.classList.add('is-offline');n.querySelector('.room-member-state').textContent='离线重连中';return saved;});
  await compare('waiting room offline color');await page.locator('#room-members li[data-seat="1"]').evaluate((n,saved)=>{n.className=saved.classes;n.querySelector('.room-member-state').textContent=saved.text;},onlineMember);
  await page.locator('#room-ready').click();await page.setViewportSize({width:640,height:360});await page.locator('#room-start').click();await page.waitForFunction(()=>window.mahjongRoom.room?.status==='playing'&&document.querySelector('#game').classList.contains('is-landscape'));await page.locator('#room-dialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('#dice-intro').hidden&&!document.querySelector('#game').classList.contains('is-opening-deal'));
  await page.evaluate(()=>{window.mahjongRoom.destroy();window.mahjongRoom.availableActions=()=>({chi:[],peng:false,gang:false,hu:false,pass:false,redGang:false,piziGang:false,wildGang:false,concealedGangs:[],addedGangs:[]});const game=window.mahjongGame;game.current=0;game.phase={kind:'discard',seat:0};game.pendingDiscard=null;game.lastDiscard=null;game.lastDraw=null;game.actionNotice=null;game.events=['面板材质显示夹具'];window.renderMahjong();document.querySelector('.action-zone').hidden=false;for(const id of ['action-chi','action-peng','action-gang','action-hu','action-pass']){const n=document.getElementById(id);n.disabled=false;n.hidden=false;}document.querySelectorAll('.player-seat').forEach(n=>n.classList.remove('is-active'));});
  for(const size of [{width:640,height:360},{width:844,height:390},{width:1920,height:1080}]){
    await page.setViewportSize(size);await frames();await compare(JSON.stringify(size)+' resting');
    for(const state of ['is-active','is-claiming','is-speaking']){await page.locator('#opponent-0').evaluate((n,state)=>n.classList.add(state),state);await compare(JSON.stringify(size)+' '+state);await page.locator('#opponent-0').evaluate((n,state)=>n.classList.remove(state),state);}
    const stateText=await page.locator('#state-1').textContent();await page.locator('#state-1').evaluate(n=>n.textContent='离线重连中');await compare(JSON.stringify(size)+' offline text');await page.locator('#state-1').evaluate((n,text)=>n.textContent=text,stateText);
    if(size.width===640)await controls(['#action-peng','#action-hu','#action-pass','#settings-btn'],'landscape controls');
    for(const id of ['settings-dialog','rules-dialog','choice-dialog','history-dialog','voice-dialog','result-dialog']){
      await page.evaluate(id=>document.getElementById(id).showModal(),id);await frames();await compare(JSON.stringify(size)+' '+id);await page.evaluate(id=>document.getElementById(id).close(),id);
    }
  }
  // 不靠reduced-motion隐藏违规过渡；只允许三类合成/底色属性。
  await page.emulateMedia({reducedMotion:'no-preference'});const transitions=await page.evaluate(()=>[...document.querySelectorAll('button:not(.tile),.player-seat,.modal')].flatMap(n=>getComputedStyle(n).transitionProperty.split(',').map(p=>p.trim())).filter(p=>!['all','none'].includes(p)));assert.ok(transitions.every(p=>['transform','opacity','background-color'].includes(p)));
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,cases:report.cases.length,states:report.states.length,rectangles:report.cases.reduce((n,c)=>n+c.rectangles,0),screenshots:0}));
} catch(error){report.failure=error.stack;throw error;} finally {
  if(process.env.KK_UI_TARGET_URL)try{report.testRoomLeft=await page.evaluate(()=>window.mahjongRoom.leave());}catch(error){report.cleanupError=error.message;}
  writeFileSync(process.env.KK_UI_TARGET_URL?'output/panel-material-online.json':'output/panel-material-verification.json',JSON.stringify(report,null,2));await browser.close();service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
