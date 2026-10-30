import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';

const BASELINE='27257ba',sheets=['styles.css','rooms.css'];
const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const service=new RoomService({botDelayMs:600000}),server=createServer({roomService:service});
server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const contexts=[],pages=[],report={passed:false,baseline:BASELINE,browser:browser.version(),cases:[],states:[],errors:[],screenshots:0};
const target=process.env.KK_UI_TARGET_URL||`http://127.0.0.1:${server.address().port}`;
mkdirSync('output',{recursive:true});
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const split=value=>{if(value==='none')return [];let depth=0,start=0;const parts=[];for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;else if(value[i]===')')depth--;else if(value[i]===','&&!depth){parts.push(value.slice(start,i));start=i+1;}}parts.push(value.slice(start));return parts;};
const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);
const luminance=color=>color.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
async function player(){
  const context=await browser.newContext({viewport:{width:360,height:640},hasTouch:true,reducedMotion:'reduce'});contexts.push(context);
  await context.addInitScript(()=>{localStorage.setItem('queqi-settings',JSON.stringify({sound:false}));Object.defineProperty(Element.prototype,'requestFullscreen',{value:()=>Promise.reject(Error('room-leave fixture'))});});
  for(const file of sheets)await context.route(`**/${file}?leave-baseline=*`,route=>route.fulfill({body:execFileSync('git',['show',`${BASELINE}:${file}`]),contentType:'text/css'}));
  const page=await context.newPage();pages.push(page);page.on('pageerror',error=>report.errors.push(error.message));
  const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.send('DOM.enable');await cdp.send('CSS.enable');
  await page.goto(target,{waitUntil:'networkidle'});return{page,cdp};
}
async function load(page,baseline){
  await page.evaluate(async({sheets,baseline})=>{
    const sources=await Promise.all(sheets.map(async file=>{const response=await fetch('/'+file+'?leave-'+(baseline?'baseline':'current')+'='+Date.now(),{cache:'no-store'});if(!response.ok)throw Error(file);return response.text();}));
    sheets.forEach((file,i)=>{const old=document.querySelector('[data-leave-sheet="'+file+'"]')||Array.from(document.querySelectorAll('link[rel=stylesheet]')).find(n=>new URL(n.href).pathname.endsWith('/'+file));const style=document.createElement('style');style.dataset.leaveSheet=file;style.textContent=sources[i];old.replaceWith(style);});
    document.querySelector('#room-dialog').scrollTop=0;
  },{sheets,baseline});await frames(page);
}
async function snapshot(page){return page.evaluate(()=>{
  const rect=n=>{const r=n.getBoundingClientRect();return[r.x,r.y,r.width,r.height];};
  const shape=n=>{const s=getComputedStyle(n);return Object.fromEntries(['width','height','padding','margin','border-width','border-radius','font-size','font-weight','line-height','transform','position','z-index','overflow'].map(k=>[k,s.getPropertyValue(k)]));};
  const dialog=document.querySelector('#room-dialog'),leave=document.querySelector('#room-leave'),options=document.querySelector('#room-options');
  const paint=n=>{const s=getComputedStyle(n);return{rect:rect(n),background:s.backgroundImage,fill:s.backgroundColor,color:s.color,border:s.borderColor,radius:s.borderRadius,shadow:s.boxShadow,decoration:s.textDecorationLine,font:s.fontSize,outline:s.outline,offset:s.outlineOffset,opacity:s.opacity,shine:s.getPropertyValue('--ui-panel-shine-x').trim(),filter:s.filter,backdrop:s.backdropFilter};};
  return{geometry:[dialog,...dialog.querySelectorAll('*')].filter(n=>n!==leave&&n.getClientRects().length).map(n=>({id:n.id||n.className,rect:rect(n),shape:shape(n)})),scroll:[dialog.scrollWidth,dialog.scrollHeight,dialog.clientWidth,dialog.clientHeight],available:leave.parentElement.clientWidth,leave:paint(leave),options:paint(options)};
});}
async function compare(page,label,viewport){
  await page.setViewportSize(viewport);await frames(page);await load(page,true);const before=await snapshot(page);await load(page,false);const after=await snapshot(page);
  assert.deepEqual(after.geometry,before.geometry,label+' other buttons, text and dialog geometry stay exactly unchanged');assert.deepEqual(after.scroll,before.scroll,label+' does not add scrolling');assert.deepEqual(after.options,before.options,'settings text link stays unchanged');
  if(label!=='entry'){
    assert.ok(after.leave.rect[3]>=44);assert.ok(after.leave.rect[2]<after.available,'leave never fills its panel content width');assert.equal(after.leave.rect[1],before.leave.rect[1],'leave stays at the original row');
    assert.ok(Math.abs(after.leave.rect[0]+after.leave.rect[2]/2-before.leave.rect[0]-before.leave.rect[2]/2)<.1,'leave remains centered');
    assert.notEqual(after.leave.color,before.leave.color);assert.equal(after.leave.decoration,'none');assert.match(after.leave.background,/at 92% 32%/);assert.equal(split(after.leave.shadow).length,2);assert.deepEqual([after.leave.filter,after.leave.backdrop],['none','none']);
    const c=rgb(after.leave.border);assert.ok(c[0]>c[1]&&c[1]>c[2],'danger border is red-brown');
    const colors=await page.locator('#room-ready,#room-start').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).color));assert.ok(colors.every(color=>color!==after.leave.color),'danger color differs from both main room actions');
    const cast=split(after.leave.shadow).find(s=>!s.includes('inset'));assert.ok(Number(cast.match(/(-?[\d.]+)px/)[1])<0,'shared panel projection goes left');
  }
  report.cases.push({label,viewport,rectangles:after.geometry.length,exactGeometry:true,scroll:after.scroll,leave:after.leave,settingsUnchanged:true});
}
async function force(page,cdp,state){
  const {root}=await cdp.send('DOM.getDocument'),{nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#room-leave'});
  await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:state==='hover'?['hover']:state==='pressed'?['hover','active']:[]});await frames(page);
}
try{
  const {page,cdp}=await player();
  for(const viewport of [{width:360,height:640},{width:1280,height:720}])await compare(page,'entry',viewport);
  await page.setViewportSize({width:360,height:640});await page.locator('#room-name').fill('离房按钮验证');await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();await page.waitForFunction(()=>window.mahjongRoom.status==='connected'&&!window.mahjongRoom.busy);
  for(const viewport of [{width:360,height:640},{width:390,height:844},{width:1280,height:720}])await compare(page,'waiting',viewport);
  let leaveRequests=0;page.on('request',request=>{if(/\/api\/rooms\/\d+\/leave$/.test(new URL(request.url()).pathname))leaveRequests++;});
  await page.locator('#room-leave').scrollIntoViewIfNeeded();
  for(const state of ['normal','hover','pressed','disabled']){
    await page.locator('#room-leave').evaluate((n,disabled)=>n.disabled=disabled,state==='disabled');await force(page,cdp,state==='disabled'?'hover':state);
    const data=(await snapshot(page)).leave;report.states.push({state,...data});
    const ratio=contrast(rgb(data.color),rgb(data.fill));assert.ok(ratio>=4.5,state+' remains readable');report.states.at(-1).baseContrast=ratio;
    if(state==='normal')assert.equal(data.shine,'92%');
    if(state==='hover')assert.equal(data.shine,'98%');
    if(state==='pressed')assert.ok(split(data.shadow).every(s=>s.includes('inset')));
    if(state==='disabled'){
      assert.equal(data.background,'none');assert.equal(data.opacity,'1');assert.ok(split(data.shadow).every(s=>s.includes('inset')));
      const before=leaveRequests;await page.locator('#room-leave').evaluate(n=>n.click());const r=await page.locator('#room-leave').boundingBox();await page.mouse.click(r.x+r.width/2,r.y+r.height/2);await frames(page);assert.equal(leaveRequests,before,'disabled mouse and DOM clicks issue no leave request');
    }
  }
  assert.notEqual(report.states[0].fill,report.states[1].fill,'hover slightly brightens');
  await page.locator('#room-leave').evaluate(n=>n.disabled=false);await force(page,cdp,'normal');
  await page.mouse.move(0,0);await page.locator('#room-leave').evaluate(n=>n.blur());
  let focused=false;for(let i=0;i<30;i++){await page.keyboard.press('Tab');focused=await page.locator('#room-leave').evaluate(n=>n===document.activeElement);if(focused)break;}
  assert.ok(focused,'keyboard Tab reaches the leave button');assert.equal(await page.locator('#room-leave').evaluate(n=>n.matches(':focus-visible')),true);
  const focus=(await snapshot(page)).leave;assert.match(focus.outline,/2px/);report.focus=focus;
  const code=await page.locator('#room-current-code').textContent(),peer=await player();await peer.page.locator('#room-name').fill('离房同行验证');await peer.page.locator('#room-code').fill(code.trim());await peer.page.locator('#room-join').click();await peer.page.locator('#room-waiting:not([hidden])').waitFor();await peer.page.waitForFunction(()=>window.mahjongRoom.status==='connected'&&!window.mahjongRoom.busy);await peer.page.locator('#room-ready').click();
  for(const seat of [2,3])await page.locator('.room-bot-add[data-seat="'+seat+'"]').click();await page.locator('#room-ready').click();await page.setViewportSize({width:640,height:360});await page.locator('#room-start:enabled').click();await page.locator('#room-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>window.mahjongRoom.room?.status==='playing'&&!window.mahjongRoom.busy);
  await page.waitForFunction(()=>document.querySelector('#dice-intro').hidden&&!document.querySelector('#game').classList.contains('is-opening-deal'));
  await page.locator('#settings-btn').click();await page.locator('#settings-home').click();await page.locator('#room-dialog[open]').waitFor();
  for(const viewport of [{width:640,height:360},{width:844,height:390},{width:1920,height:1080}])await compare(page,'playing',viewport);
  assert.match(await page.locator('#room-leave').getAttribute('title'),/中止本局/);assert.match(await page.locator('#room-leave').getAttribute('aria-label'),/离开房间.*中止本局.*其他玩家/);
  let dialogs=0;page.on('dialog',dialog=>{dialogs++;void dialog.dismiss();});const before=leaveRequests;await page.locator('#room-leave').click();await page.locator('#room-entry:not([hidden])').waitFor();await peer.page.waitForFunction(()=>window.mahjongRoom.room?.status==='waiting');assert.equal(leaveRequests-before,1);assert.equal(dialogs,0);report.leaving={requests:1,confirmationDialogs:0,peerReturnedToWaiting:true};
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,cases:report.cases.length,rectangles:report.cases.reduce((n,c)=>n+c.rectangles,0),states:report.states.length,keyboardFocus:true,leaving:report.leaving,screenshots:0}));
}catch(error){report.failure=error.stack;throw error;}finally{
  if(process.env.KK_UI_TARGET_URL)report.cleanup=await Promise.all(pages.map(page=>page.evaluate(()=>window.mahjongRoom?.leave()).catch(error=>error.message)));
  writeFileSync(process.env.KK_UI_TARGET_URL?'output/room-leave-online.json':'output/room-leave-verification.json',JSON.stringify(report,null,2));await browser.close();service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
