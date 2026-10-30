import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';

let playwright;
try { playwright=createRequire(import.meta.url)('playwright'); }
catch { playwright=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright'); }
const service=new RoomService({botDelayMs:60000,disconnectGraceMs:100});
const server=createServer({roomService:service}); server.listen(0,'127.0.0.1'); await once(server,'listening');
const baseURL=`http://127.0.0.1:${server.address().port}`;
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await playwright.chromium.launch({headless:true,...(existsSync(edge)?{executablePath:edge}:{})});
const output=path.resolve('output'); mkdirSync(output,{recursive:true});
const report={passed:false,browser:browser.version(),fullscreen:[],numbers:[],hands:[],errors:[],screenshots:[],fixtureNote:'Fullscreen success/failure and restored activation are simulated explicitly. Numeric and hand fixtures only mutate browser presentation snapshots; server game rules and physical tile allocation are not changed.'};
const contexts=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test,label){const end=Date.now()+10000;while(!await test()){assert.ok(Date.now()<end,label);await sleep(15);}}
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function player(mode,mobile){
  const context=await browser.newContext({viewport:{width:360,height:640},hasTouch:mobile});contexts.push(context);
  await context.addInitScript(mode=>{
    let fullscreen=null;
    window.__fs={calls:[],exits:0};
    let ordinaryGesture=false;
    document.addEventListener('pointerdown',()=>{ordinaryGesture=true;},{capture:true});
    document.addEventListener('keydown',()=>{ordinaryGesture=true;},{capture:true});
    Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>fullscreen});
    Object.defineProperty(document,'exitFullscreen',{configurable:true,value:async()=>{fullscreen=null;window.__fs.exits++;document.dispatchEvent(new Event('fullscreenchange'));}});
    Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:mode==='unsupported'?undefined:function(){
      window.__fs.calls.push({root:this===document.documentElement,active:navigator.userActivation.isActive,hasRoom:Boolean(window.mahjongRoom?.room)});
      if(mode==='throw')throw new Error('Synchronous browser rejection');
      if(mode==='reject'||(mode==='activation'&&!ordinaryGesture))return Promise.reject(new Error('Browser requires activation'));
      const enter=()=>{fullscreen=this;document.dispatchEvent(new Event('fullscreenchange'));};
      if(mode==='late')return new Promise(resolve=>{window.__resolveFullscreen=()=>{enter();resolve();};});
      enter();return Promise.resolve();
    }});
    if(screen.orientation)Object.defineProperty(screen.orientation,'lock',{configurable:true,value:()=>Promise.reject(new Error('Simulated lock unavailable'))});
  },mode);
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(baseURL,{waitUntil:'networkidle'});await page.locator('#room-name').fill('房间HUD验证');return page;
}
async function create(page){await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();await until(()=>page.evaluate(()=>window.mahjongRoom.status==='connected'&&!window.mahjongRoom.busy),'room connected');await frames(page);}
async function leave(page){await page.locator('#room-leave:enabled').click();await page.locator('#room-entry:not([hidden])').waitFor();await until(()=>page.evaluate(()=>!document.fullscreenElement&&!document.documentElement.classList.contains('room-session')),'leaving exits fullscreen');}
try{
  for(const mobile of [true,false]){
    const context=await browser.newContext({hasTouch:mobile,viewport:mobile?{width:360,height:640}:{width:1280,height:720}});contexts.push(context);
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));await page.goto(baseURL,{waitUntil:'networkidle'});await page.locator('#room-name').fill('原生全屏验证');await create(page);
    await page.waitForFunction(()=>document.fullscreenElement===document.documentElement);await leave(page);report.fullscreen.push({mobile,mode:'native-browser-api',rootFullscreen:true,leftCleanly:true});
  }
  for(const mobile of [true,false])for(const mode of ['success','reject','unsupported','throw']){
    const page=await player(mode,mobile);
    for(let cycle=0;cycle<3;cycle++){
      await create(page);
      const state=await page.evaluate(()=>({fullscreen:document.fullscreenElement===document.documentElement,room:document.documentElement.classList.contains('room-session'),fallback:document.documentElement.classList.contains('fullscreen-fallback'),calls:window.__fs.calls,scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight]}));
      assert.equal(state.room,true);assert.equal(state.fullscreen,mode==='success');assert.equal(state.fallback,mode!=='success');
      if(mode!=='unsupported'){assert.equal(state.calls.at(-1).root,true);assert.equal(state.calls.at(-1).active,true,'request stays in the create gesture');assert.equal(state.calls.at(-1).hasRoom,false,'request occurs before HTTP room success');}
      assert.ok(state.scroll[0]<=361&&state.scroll[1]<=641,'room fits viewport');
      assert.equal(await page.locator('#room-dialog [data-fullscreen-note]').isVisible(),mode!=='success');
      await leave(page);report.fullscreen.push({mobile,mode,cycle,rootRequest:true,fallback:state.fallback,leftCleanly:true});
    }
  }
  const restored=await player('activation',true);await create(restored);await restored.reload({waitUntil:'domcontentloaded'});
  await until(()=>restored.evaluate(()=>window.mahjongRoom?.status==='connected'&&document.documentElement.classList.contains('fullscreen-fallback')),'restored room has safe fallback without activation');
  await restored.locator('#room-ready').click();await until(()=>restored.evaluate(()=>document.fullscreenElement===document.documentElement),'ordinary room interaction restores fullscreen');await leave(restored);
  report.fullscreen.push({restoreAttempt:true,rejectedWithoutActivation:true,recoveredOnOrdinaryGesture:true});
  const late=await player('late',false);await create(late);await leave(late);await late.evaluate(()=>window.__resolveFullscreen());await frames(late);
  assert.equal(await late.evaluate(()=>Boolean(document.fullscreenElement)),false,'late fullscreen resolution cannot leak after leaving');report.fullscreen.push({lateResolutionAfterLeave:true,fullscreenLeak:false});
  const failed=await player('success',false);await failed.route('**/api/rooms',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Test room failure'})}));
  await failed.locator('#room-create').click();await failed.locator('#room-error:not([hidden])').waitFor();await until(()=>failed.evaluate(()=>!document.fullscreenElement),'failed creation releases warmed fullscreen');report.fullscreen.push({failedCreation:true,fullscreenLeak:false});

  const page=await player('reject',true);await page.setViewportSize({width:640,height:360});await create(page);
  const code=(await page.locator('#room-current-code').textContent()).trim(),room=service.rooms.get(code);
  for(const seat of [1,2,3])await page.locator(`.room-bot-add[data-seat="${seat}"]`).click();
  await page.locator('#room-ready').click();await page.locator('#room-start').click();await page.locator('#room-dialog').waitFor({state:'hidden'});
  await until(()=>page.evaluate(()=>window.mahjongRoom.room?.status==='playing'&&!window.mahjongRoom.busy),'game entered');
  if(await page.locator('#dice-intro').isVisible())await page.locator('#dice-intro').click();
  for(const viewport of [{width:640,height:360},{width:844,height:390},{width:1920,height:1080}]){
    await page.setViewportSize(viewport);await frames(page);
    const numbers=await page.evaluate(()=>{
      const game=window.mahjongGame,room=window.mahjongRoom.room,original={count:game.wall.length,code:room.code};
      const measure=element=>{const r=element.getBoundingClientRect(),s=getComputedStyle(element),mark=document.createElement('span');mark.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline';element.append(mark);const baseline=mark.getBoundingClientRect().top;mark.remove();return{left:r.left,right:r.right,width:r.width,baseline,font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,color:s.color};};
      const rows=[];
      for(const font of ['Consolas,monospace','"SFMono-Regular",Menlo,monospace','"Roboto Mono",monospace']){
        for(const node of document.querySelectorAll('.hud-number'))node.style.fontFamily=font;
        const probe=document.querySelector('#room-label').cloneNode(false);probe.removeAttribute('id');probe.style.cssText+= ';position:absolute;visibility:hidden;inline-size:auto;min-inline-size:0';probe.textContent='0123456789';document.body.append(probe);
        const widths=Array.from({length:10},(_,i)=>{const range=document.createRange();range.setStart(probe.firstChild,i);range.setEnd(probe.firstChild,i+1);return range.getBoundingClientRect().width;});probe.remove();
        if(Math.max(...widths)-Math.min(...widths)>.05)throw new Error('Numeric glyphs are not tabular: '+font);
        for(const code of ['100000','111111','999999'])for(const count of [136,100,99,83,10,9,1,0]){
          room.code=code;game.wall.length=count;window.renderMahjong();const roomNode=document.querySelector('#room-label'),wallNode=document.querySelector('#wall-count');rows.push({font,code,count,room:measure(roomNode),wall:measure(wallNode),roomLabel:measure(roomNode.previousElementSibling),wallLabel:measure(wallNode.previousElementSibling),wallText:wallNode.textContent});
        }
      }
      room.code=original.code;game.wall.length=original.count;for(const node of document.querySelectorAll('.hud-number'))node.style.removeProperty('font-family');window.renderMahjong();return rows;
    });
    for(const row of numbers){assert.ok(Math.abs(row.room.baseline-row.wall.baseline)<=1,'HUD numeric baselines align');assert.ok(Math.abs(row.roomLabel.baseline-row.wallLabel.baseline)<=1,'labels share the same baseline');assert.ok(Math.abs((row.room.left-row.roomLabel.right)-(row.wall.left-row.wallLabel.right))<.1,'label-to-digit gaps match');for(const key of ['font','size','weight','color'])assert.equal(row.room[key],row.wall[key]);assert.equal(row.wallText.length,3);}
    for(const font of new Set(numbers.map(row=>row.font))){const rows=numbers.filter(row=>row.font===font),first=rows[0];for(const row of rows)for(const key of ['left','right','width','baseline']){assert.ok(Math.abs(row.room[key]-first.room[key])<.1,'room-code region remains fixed');assert.ok(Math.abs(row.wall[key]-first.wall[key])<.1,'wall-count region remains fixed');}}
    report.numbers.push({viewport,states:numbers.length,baselineError:Math.max(...numbers.map(row=>Math.abs(row.room.baseline-row.wall.baseline))),fixedBounds:true});
    for(const publicCase of [{melds:0,special:0},{melds:1,special:0},{melds:4,special:0},{melds:0,special:7}])for(let count=1;count<=14;count++){
      await page.evaluate(({count,publicCase})=>{
        const game=window.mahjongGame,seat=game.players[0];seat.hand=[0,2,4,6,8,9,11,13,15,17,18,20,22,24].slice(0,count);seat.melds=Array.from({length:publicCase.melds},(_,n)=>({kind:'gang',tiles:Array(4).fill(n),from:1,concealed:false}));seat.redGangs=Array(Math.min(4,publicCase.special)).fill(31);seat.piziGangs=Array(Math.max(0,publicCase.special-4)).fill(33);
        game.events=['HUD布局检查打出一万。'];game.phase={kind:'discard',seat:0};game.current=0;game.lastDiscard=null;game.pendingDiscard=null;game.lastDraw={player:0,tile:seat.hand.at(-1),index:count-1};
        window.mahjongRoom.availableActions=()=>({chi:[],peng:false,gang:false,hu:false,pass:false,redGang:false,piziGang:false,wildGang:false,concealedGangs:[],addedGangs:[]});window.renderMahjong();document.querySelector('#dice-intro').click();
      },{count,publicCase});await frames(page);
      const data=await page.evaluate(()=>{
        const rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};};const cards=[...document.querySelectorAll('#hand button')].map(rect),stage=rect(document.querySelector('#game')),hand=rect(document.querySelector('#hand')),center=(Math.min(...cards.map(r=>r.left))+Math.max(...cards.map(r=>r.right)))/2;
        const publicCards=[...document.querySelectorAll('#melds-0 .tile')].map(rect),overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>.4&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.4;
        return{centerError:Math.abs(center-(stage.left+stage.right)/2),width:cards[0].width,cards,hand,collisions:cards.some(card=>publicCards.some(other=>overlap(card,other))),rowSpread:Math.max(...cards.map(r=>r.bottom))-Math.min(...cards.map(r=>r.bottom)),scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight]};
      });
      assert.ok(data.centerError<=1,`hand center ${JSON.stringify({viewport,count,publicCase,error:data.centerError})}`);assert.equal(data.collisions,false,'concealed cards avoid public combinations');assert.ok(data.rowSpread<=1,'hand never wraps');assert.ok(data.cards.every(r=>r.left>=data.hand.left-.2&&r.right<=data.hand.right+.2),'all cards fit the hand region');assert.ok(data.scroll[0]<=viewport.width+1&&data.scroll[1]<=viewport.height+1);
      report.hands.push({viewport,count,...publicCase,centerError:data.centerError,tileWidth:data.width,noWrap:true,noOverlap:true});
      if(process.env.KK_UI_SCREENSHOTS!=='0'&&(count===14||count===2)&&publicCase.melds===0&&viewport.width===640){const file=path.join(output,`hud-centered-hand-${count}-special${publicCase.special}.png`);await page.screenshot({path:file});report.screenshots.push(file);}
    }
  }
  assert.ok(room.game,'server game was started normally');assert.deepEqual(report.errors,[]);report.passed=true;
  console.log(JSON.stringify({passed:true,browser:report.browser,fullscreenCases:report.fullscreen.length,numericCases:report.numbers.reduce((n,row)=>n+row.states,0),handCases:report.hands.length,maxCenterError:Math.max(...report.hands.map(row=>row.centerError)),errors:report.errors},null,2));
}catch(error){report.failure=error.stack;throw error;}
finally{writeFileSync(path.join(output,'ui-room-hud.json'),JSON.stringify(report,null,2));await Promise.allSettled(contexts.map(context=>context.close()));await browser.close();service.close();const closed=once(server,'close');server.close();server.closeAllConnections();await closed;}
