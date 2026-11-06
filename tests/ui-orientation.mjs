import {ensureReady} from './ui-ready.mjs';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';

let playwright;
try { playwright=createRequire(import.meta.url)('playwright'); }
catch { playwright=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright'); }
const service=new RoomService({botDelayMs:600000}),server=createServer({roomService:service});
server.listen(0,'127.0.0.1');await once(server,'listening');
const target=process.env.KK_UI_TARGET_URL||'http://127.0.0.1:'+server.address().port;
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await playwright.chromium.launch({headless:true,...(existsSync(edge)?{executablePath:edge}:{})});
const output=path.resolve('output');mkdirSync(output,{recursive:true});
const contexts=[],report={passed:false,browser:browser.version(),target,checks:[],geometry:[],screenshots:[],errors:[],resources:[],cleanupErrors:[]};
const sizes=[{width:568,height:320},{width:640,height:360},{width:844,height:390},{width:1280,height:720},{width:1920,height:1080},{width:390,height:844}];
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

async function player(name,mobile=true,mode='reject'){
  const context=await browser.newContext({viewport:{width:640,height:360},hasTouch:mobile,reducedMotion:'reduce'});contexts.push(context);
  await context.addInitScript(mode=>{
    localStorage.setItem('queqi-settings',JSON.stringify({sound:false}));
    let fullscreen=null;
    window.__landscapeCalls={lock:[],unlock:0,fullscreen:0,unhandled:[]};
    window.addEventListener('unhandledrejection',event=>window.__landscapeCalls.unhandled.push(String(event.reason)));
    Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>fullscreen});
    Object.defineProperty(document,'exitFullscreen',{configurable:true,value:async()=>{fullscreen=null;document.dispatchEvent(new Event('fullscreenchange'));}});
    Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:mode==='unsupported'?undefined:function(){
      window.__landscapeCalls.fullscreen++;
      if(mode==='reject')return Promise.reject(Error('Fullscreen fixture rejection'));
      fullscreen=this;document.dispatchEvent(new Event('fullscreenchange'));return Promise.resolve();
    }});
    if(screen.orientation){
      Object.defineProperty(screen.orientation,'lock',{configurable:true,value:kind=>{window.__landscapeCalls.lock.push(kind);return Promise.resolve();}});
      Object.defineProperty(screen.orientation,'unlock',{configurable:true,value:()=>{window.__landscapeCalls.unlock++;}});
    }
  },mode);
  const page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)report.resources.push({status:response.status(),url:response.url()});});
  page.on('requestfailed',request=>{if(request.failure()?.errorText!=='net::ERR_ABORTED')report.resources.push({url:request.url(),error:request.failure()?.errorText});});
  await page.goto(target,{waitUntil:'networkidle'});await page.locator('#room-name').fill(name);
  return page;
}

async function canvas(page,label){
  await frames(page);
  const result=await page.evaluate(()=>{
    const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const stage=document.querySelector('#game');
    return{viewport:{width:innerWidth,height:innerHeight},stage:rect(stage),
      layout:document.documentElement.classList.contains('landscape-app')&&stage.classList.contains('is-landscape'),
      guide:!!document.querySelector('#rotate-guide'),scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],calls:window.__landscapeCalls};
  });
  assert.equal(result.layout,true,label+' keeps the single canvas');assert.equal(result.guide,false,'no rotation prompt exists');
  assert.ok(result.stage.width/result.stage.height>=16/9-.01,label+' remains landscape');
  assert.ok(result.stage.x>=-.5&&result.stage.y>=-.5&&result.stage.right<=result.viewport.width+.5&&result.stage.bottom<=result.viewport.height+.5,label+' canvas stays in viewport');
  assert.ok(result.scroll[0]<=result.viewport.width+1&&result.scroll[1]<=result.viewport.height+1,label+' has no document overflow');
  assert.deepEqual(result.calls.lock,[],'fullscreen must never lock device orientation');assert.equal(result.calls.unlock,0);
  assert.deepEqual(result.calls.unhandled,[]);report.geometry.push({label,...result});return result;
}

async function reachable(page,selector){
  const node=page.locator(selector);await node.scrollIntoViewIfNeeded();
  const data=await node.evaluate(node=>{
    const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return{width:r.width,height:r.height,hit:!!hit&&(node===hit||node.contains(hit))};
  });
  assert.ok(data.width>0&&data.height>0&&data.hit,selector+' remains reachable through its scroll area');
}

async function room(page,label){
  await canvas(page,label);
  const data=await page.locator('#room-dialog').evaluate(node=>{const r=node.getBoundingClientRect();return{width:r.width,height:r.height};});
  assert.ok(data.width>data.height,label+' dialog is landscape');
  const entry=await page.locator('#room-entry').isVisible();
  for(const selector of entry?['#room-name','#room-code','#room-create','#room-join','#room-options']:['#room-copy','#room-ready','#room-leave','#room-options'])await reachable(page,selector);
  if(entry){
    await page.locator('#room-name').scrollIntoViewIfNeeded();
    const columns=await page.evaluate(()=>{const a=document.querySelector('#room-name').getBoundingClientRect(),b=document.querySelector('#room-code').getBoundingClientRect();return{sameRow:Math.abs(a.y-b.y)<1,separate:a.right<=b.left};});
    assert.ok(columns.sameRow&&columns.separate,'nickname and join code use two distinct columns');
  }
  report.checks.push({label,entry,reachable:true,landscapeDialog:true});
}
async function leave(page){await page.locator('#room-leave').click();await page.locator('#room-entry:not([hidden])').waitFor();}

try{
  assert.equal(existsSync('src/ui/orientation.js'),false,'retired mode controller is deleted');
  for(const file of ['styles.css','landscape.css','rooms.css','seats-layout.css','wall-layout.css','table-depth.css'])assert.doesNotMatch(readFileSync(file,'utf8'),/@media[^{}]*orientation\s*:\s*portrait/i,file+' has no portrait-only media branch');
  assert.doesNotMatch(readFileSync('src/ui/landscape.js','utf8'),/screen\.orientation|\.lock\(/,'canvas controller must not request device rotation');
  const owner=await player('横屏审核房主');
  for(const size of sizes){await owner.setViewportSize(size);await room(owner,'entry '+size.width+'x'+size.height);}
  await owner.setViewportSize({width:568,height:320});
  await owner.locator('#room-options').click();await owner.locator('#settings-dialog[open]').waitFor();
  const checked=await owner.locator('#sound-setting').isChecked();await owner.locator('#sound-setting').setChecked(!checked);
  await owner.locator('#settings-rules').click();await owner.locator('#rules-dialog[open]').waitFor();await reachable(owner,'#rules-dialog .primary-button');await owner.locator('#rules-dialog .primary-button').click();
  await owner.locator('#room-options').click();assert.equal(await owner.locator('#sound-setting').isChecked(),!checked);await owner.locator('#sound-setting').setChecked(false);await owner.locator('#settings-dialog [data-close]').last().click();
  report.checks.push({settings:true,ruleLink:true,soundOptionPreserved:true});

  await owner.locator('#room-create').click();await owner.locator('#room-waiting:not([hidden])').waitFor();
  const code=(await owner.locator('#room-current-code').textContent()).trim();assert.match(code,/^\d{6}$/);
  for(const size of sizes){await owner.setViewportSize(size);await room(owner,'waiting '+size.width+'x'+size.height);}
  await owner.setViewportSize({width:844,height:390});
  const friend=await player('横屏审核好友',false,'resolve');
  await friend.locator('#room-code').fill(code);await friend.locator('#room-join').click();await friend.locator('#room-waiting:not([hidden])').waitFor();
  assert.equal(await friend.evaluate(()=>Boolean(document.fullscreenElement)),true);await canvas(friend,'join fullscreen');
  for(const seat of[2,3])await owner.locator('.room-bot-add[data-seat="'+seat+'"]').click();
  await owner.locator('.room-bot-remove[data-seat="3"]').click();await owner.locator('.room-bot-add[data-seat="3"]').click();
  await ensureReady(friend);await ensureReady(owner);await owner.locator('#room-start:enabled').waitFor();await owner.locator('#room-start').click();
  for(const page of[owner,friend])await page.waitForFunction(()=>window.mahjongRoom.room?.status==='playing'&&!document.querySelector('#game').matches('.is-dice-intro,.is-opening-deal'));
  for(const size of sizes){await owner.setViewportSize(size);await canvas(owner,'game '+size.width+'x'+size.height);}
  await owner.setViewportSize({width:844,height:390});
  const index=await owner.evaluate(()=>{const g=window.mahjongGame;return g.players[0].hand.findIndex(t=>t!==31&&t!==g.indicatorTile&&t!==g.wildTile);});
  const tile=owner.locator('#hand button[data-index="'+index+'"]');await tile.click();await tile.click();
  await owner.waitForFunction(()=>window.mahjongGame.players[0].discards.length===1);await friend.waitForFunction(()=>window.mahjongGame.players.some(p=>p.discards.length===1));
  report.checks.push({createJoinPrepareStart:true,botsAddRemove:true,realDiscard:true,friendSnapshot:true});
  await owner.locator('#settings-btn').click();await owner.locator('#settings-home').click();await room(owner,'return to room during game');assert.equal(await owner.locator('#room-ready').isDisabled(),true);
  await owner.reload({waitUntil:'networkidle'});await owner.waitForFunction(()=>window.mahjongRoom.status==='connected');await canvas(owner,'restored game');
  if(!await owner.locator('#room-dialog').isVisible()){await owner.locator('#settings-btn').click();await owner.locator('#settings-home').click();}
  await leave(owner);await friend.waitForFunction(()=>window.mahjongRoom.room?.status==='waiting');await room(friend,'friend returns to waiting');await leave(friend);
  await room(owner,'entry after leave');report.checks.push({returnRoute:true,reloadRecovery:true,leaveResetsWaiting:true});
  if(process.env.KK_UI_SCREENSHOTS!=='0')for(const size of[{width:568,height:320},{width:1280,height:720}]){await owner.setViewportSize(size);const file=path.join(output,'landscape-entry-'+size.width+'x'+size.height+'.png');await owner.screenshot({path:file});report.screenshots.push(file);}
  for(const mobile of[true,false])for(const mode of['unsupported','reject','resolve']){
    const page=await player('全屏横屏审核',mobile,mode);await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();await canvas(page,'fullscreen '+mobile+' '+mode);
    assert.equal(await page.evaluate(()=>Boolean(document.fullscreenElement)),mode==='resolve');await leave(page);assert.equal(await page.evaluate(()=>Boolean(document.fullscreenElement)),false);await page.context().close();
    report.checks.push({mobile,fullscreenMode:mode,noDeviceRotation:true,leftCleanly:true});
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.resources,[]);report.passed=true;
}catch(error){report.failure=error.stack;throw error;}
finally{
  for(const context of contexts)for(const page of context.pages())try{await page.evaluate(()=>window.mahjongRoom?.room?window.mahjongRoom.leave():true);}catch(error){report.cleanupErrors.push(error.message);}
  writeFileSync(path.join(output,process.env.KK_UI_TARGET_URL?'ui-landscape-online.json':'ui-orientation.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,geometry:report.geometry.length,screenshots:report.screenshots.length,errors:report.errors,resources:report.resources}));
  await Promise.allSettled(contexts.map(c=>c.close()));await browser.close();service.close();server.closeAllConnections();await new Promise(r=>server.close(r));
}
