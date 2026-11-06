import {ensureReady} from './ui-ready.mjs';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {actionFixture,maximumPublicFixture} from './pizi-fixtures.mjs';
const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const service=new RoomService(),server=createServer({roomService:service});server.listen(0,'127.0.0.1');await once(server,'listening');
const target=process.env.KK_UI_TARGET_URL||'http://127.0.0.1:'+server.address().port;
const output=process.env.KK_UI_OUTPUT||'output/action-notice-review-20261106';mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}),context=await browser.newContext({viewport:{width:1280,height:720}}),page=await context.newPage();
const report={passed:false,target,scenes:[],checks:[],errors:[],resources:[],screenshots:[],cleanupErrors:[],note:'Geometry sweeps use explicit client-only HUD snapshots with persistent notice time for measurement; they do not mutate the cloud game or claim to be natural rounds. Real action entry/color/lifetime coverage is in ui-action-notices.mjs. This test also performs one genuine discard in its own server room while the notice is visible.'};
const colors={chi:'rgb(159, 217, 179)',peng:'rgb(155, 204, 231)',gang:'rgb(241, 207, 131)',hu:'rgb(230, 75, 60)'};
const redact=text=>String(text).replace(/[a-f0-9]{48}/g,'[redacted]');
page.on('pageerror',e=>report.errors.push(redact(e.message)));page.on('console',m=>{if(m.type()==='error')report.errors.push(redact(m.text()));});page.on('response',r=>{if(r.status()>=400)report.resources.push({status:r.status(),path:new URL(r.url()).pathname});});
page.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')report.resources.push({path:new URL(r.url()).pathname,error:redact(r.failure()?.errorText)});});
await context.addInitScript(()=>{localStorage.setItem('queqi-settings',JSON.stringify({sound:false}));Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:()=>Promise.reject(Error('fixed audit viewport'))});});
async function measure(){return page.evaluate(async()=>{
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const box=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom};},visible=e=>{const s=getComputedStyle(e);return !e.hidden&&e.getClientRects().length&&s.display!=='none'&&s.visibility!=='hidden'&&(e.id!=='toast'||e.classList.contains('visible')||Number(s.opacity)>0);};
 const node=document.querySelector('.seat-action-notice:not([hidden])'),s=getComputedStyle(node),range=document.createRange();range.selectNodeContents(node);const r=range.getBoundingClientRect(),pad=parseFloat(s.webkitTextStrokeWidth)/2+3;
 const ink={left:r.left-pad,right:r.right+pad,top:r.top-pad,bottom:r.bottom+pad+2},stage=box(document.querySelector('#game'));
 const selectors='#hand button,.opponent-rack .tile,.opponent-rack .back,.my-melds .tile,.river .tile,.wall-piece:not(.is-empty),.table-die,.player-seat,.topbar > *,.action-zone:not([hidden]) button:not([hidden]),#hint-details:not([hidden]),#hint-btn,#toast,.table-label';
 const obstacles=[...document.querySelectorAll(selectors)].filter(visible).map(e=>({...box(e),name:e.id||e.className}));
 const collisions=obstacles.filter(b=>Math.min(ink.right,b.right)-Math.max(ink.left,b.left)>.5&&Math.min(ink.bottom,b.bottom)-Math.max(ink.top,b.top)>.5);
 const overlap=(a,b)=>Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top);
 const clipped=[];for(let p=node.parentElement;p;p=p.parentElement){const st=getComputedStyle(p);if(/clip|hidden|scroll|auto/.test(st.overflowX+' '+st.overflowY)){const b=box(p);if(ink.left<b.left-.5||ink.right>b.right+.5||ink.top<b.top-.5||ink.bottom>b.bottom+.5)clipped.push(p.id||p.tagName);}}
 const target=document.elementFromPoint((ink.left+ink.right)/2,(ink.top+ink.bottom)/2);
 return{kind:node.dataset.kind,player:Number(node.dataset.player),color:s.color,fill:s.webkitTextFillColor,fontSize:parseFloat(s.fontSize),pointerEvents:s.pointerEvents,ink,stage,collisions,clipped,hitsNotice:target===node||node.contains(target),hintOpen:!document.querySelector('#hint-details').hidden,toastVisible:document.querySelector('#toast').classList.contains('visible'),otherNotices:[...document.querySelectorAll('.seat-action-notice:not([hidden])')].filter(n=>n!==node).some(n=>overlap(ink,box(n)))};
});}
function check(data,label){assert.equal(data.fill,colors[data.kind],label+' actual fill');assert.equal(data.color,colors[data.kind]);assert.ok(data.fontSize>=20);assert.deepEqual(data.collisions,[],label+' collisions '+JSON.stringify(data));assert.deepEqual(data.clipped,[],label+' clipping');assert.equal(data.pointerEvents,'none');assert.equal(data.hitsNotice,false);assert.equal(data.otherNotices,false);assert.ok(data.ink.left>=data.stage.left-.5&&data.ink.right<=data.stage.right+.5&&data.ink.top>=data.stage.top-.5&&data.ink.bottom<=data.stage.bottom+.5);}
try{
 await page.goto(target,{waitUntil:'networkidle'});await page.locator('#room-name').fill('动作提示审核');await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();const code=(await page.locator('#room-current-code').textContent()).trim();
 for(const seat of [1,2,3])await page.locator('.room-bot-add[data-seat="'+seat+'"]').click();await ensureReady(page);await page.locator('#room-start').click();await page.waitForFunction(()=>!window.mahjongRoom.room?.opening&&!window.mahjongRoom.busy&&!document.querySelector('#game').matches('.is-dice-intro,.is-opening-deal'));
 await page.evaluate(()=>{window.__noticeLayoutSaved={room:structuredClone(window.mahjongRoom.room),game:JSON.parse(JSON.stringify(window.mahjongGame)),actions:window.mahjongRoom.availableActions};});
 const template=service.rooms.get(service.create({name:'投影夹具'}).room.code);for(const seat of [1,2,3])service.addBot(template.code,template.seats[0].token,{seat});template.seats[0].connected=true;template.code=code;
 const sizes=[{width:568,height:320},{width:640,height:360},{width:844,height:390},{width:1280,height:720},{width:1920,height:1080}];let id=1000000;
 for(const size of sizes){await page.setViewportSize(size);for(const dense of [false,true])for(let player=0;player<4;player++)for(const kind of Object.keys(colors)){
  template.game=dense?maximumPublicFixture():actionFixture();template.opening=null;template.actionNotice=null;const snapshot=service.snapshot(template,0);snapshot.state.actionNotice={id:++id,player,kind,remainingMs:null};
  await page.evaluate(snapshot=>{const g=window.mahjongGame;Object.assign(g,snapshot.state,{wall:{length:snapshot.state.wallCount}});window.mahjongRoom.room=snapshot.room;window.mahjongRoom.availableActions=()=>snapshot.state.actions;window.renderMahjong();},snapshot);
  const data=await measure(),label=JSON.stringify({size,dense,player,kind});check(data,label);report.scenes.push({size,dense,player,kind,color:data.color,fontSize:data.fontSize,ink:data.ink,noOverlap:true,noClip:true});
  if(kind==='hu'&&size.width===640&&(!dense||player===0)){const path=output+'/layout-'+(dense?'dense':'normal')+'-seat'+player+(process.env.KK_UI_TARGET_URL?'-online':'-local')+'.png';await page.screenshot({path});report.screenshots.push(path);}
 }}
 // 原有听牌面板、toast与选牌过渡共存，逐帧核对实际字形而非透明浮层。
 for(const size of [sizes[1],sizes[2],sizes[3]]){
  await page.setViewportSize(size);template.game=actionFixture({indicator:32,hand:[0,0,2,2,3,3,5,5,6,6,8,8,27,27]});const snapshot=service.snapshot(template,0);snapshot.state.actionNotice={id:++id,player:0,kind:'peng',remainingMs:null};
  await page.evaluate(snapshot=>{Object.assign(window.mahjongGame,snapshot.state,{wall:{length:snapshot.state.wallCount}});window.mahjongRoom.room=snapshot.room;window.mahjongRoom.availableActions=()=>snapshot.state.actions;window.renderMahjong();},snapshot);
  if(await page.locator('#hint-details').isHidden())await page.locator('#hint-btn').click();
  await page.evaluate(()=>{const t=document.querySelector('#toast');t.textContent='动作提示审核：现有提示叠加场景';t.classList.add('visible');window.dispatchEvent(new Event('resize'));});
  await page.locator('#hand button[aria-disabled="false"]').first().click();
  for(const delay of [0,40,80,120]){if(delay)await page.waitForTimeout(delay);const data=await measure();assert.equal(data.hintOpen,true);assert.equal(data.toastVisible,true);check(data,'hint/toast/selection '+JSON.stringify(size));}
  report.checks.push({size,hintToastSelection:true,transitionSamples:4});await page.locator('#hint-close').click();await page.evaluate(()=>{document.querySelector('#toast').classList.remove('visible');window.dispatchEvent(new Event('resize'));});
  for(const delay of [0,60,160]){if(delay)await page.waitForTimeout(delay);check(await measure(),'overlay exit '+JSON.stringify(size));}
 }
 // 结束投影夹具后离开旧测试房间，用全新权威牌局验证真实操作，
 // 不把客户端静态夹具中的牌序或状态当成服务端交付。
 await page.evaluate(async()=>{window.mahjongRoom.availableActions=window.__noticeLayoutSaved.actions;await window.mahjongRoom.leave();});
 await page.locator('#room-entry:not([hidden])').waitFor();await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();
 for(const seat of [1,2,3])await page.locator('.room-bot-add[data-seat="'+seat+'"]').click();await ensureReady(page);await page.locator('#room-start').click();await page.waitForFunction(()=>!window.mahjongRoom.room?.opening&&!window.mahjongRoom.busy&&!document.querySelector('#game').matches('.is-dice-intro,.is-opening-deal'));
 await page.evaluate(()=>{window.mahjongGame.actionNotice={id:2000000,player:0,kind:'peng',remainingMs:null};window.renderMahjong();});
 const index=await page.evaluate(()=>{const g=window.mahjongGame;return g.players[0].hand.findIndex(t=>t!==31&&t!==g.indicatorTile&&t!==g.wildTile);});const tile=page.locator('#hand button[data-index="'+index+'"]');await tile.click();await tile.click();await page.waitForFunction(()=>window.mahjongGame.players[0].discards.length===1);report.checks.push({realDiscardWhileNoticeVisible:true,flowNotBlocked:true});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.resources,[]);report.passed=true;
}catch(e){report.failure=e.stack;throw e;}finally{
 try{await page.evaluate(async()=>{const c=JSON.parse(sessionStorage.getItem('queqi-room-session')||'null');if(c){const r=await fetch('/api/rooms/'+c.code+'/leave',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.token},body:'{}'});if(!r.ok)throw Error('test room cleanup '+r.status);}});}catch(e){report.cleanupErrors.push(e.message);}
 writeFileSync(output+(process.env.KK_UI_TARGET_URL?'/layout-online.json':'/layout-local.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,scenes:report.scenes.length,checks:report.checks,errors:report.errors,failure:report.failure}));await browser.close();service.close();server.closeAllConnections();await new Promise(r=>server.close(r));
}
