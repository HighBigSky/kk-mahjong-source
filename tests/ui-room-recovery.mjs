import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';

const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const service=new RoomService({botDelayMs:600000,disconnectGraceMs:100});
const server=createServer({roomService:service});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=process.env.KK_VERIFY_URL || `http://127.0.0.1:${server.address().port}`;
const remote=Boolean(process.env.KK_VERIFY_URL);
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const report={passed:false,browser:browser.version(),base,cases:[],errors:[],note:'Edge touch emulation, not physical iOS/Android; real HTTP/SSE and browser network offline/online.'};
const contexts=[];
mkdirSync('output',{recursive:true});
const identity=page=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('queqi-room-session')));
const connected=page=>page.waitForFunction(()=>window.mahjongRoom?.status==='connected'&&!window.mahjongRoom.room?.paused);
async function open(context) {
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.mahjongRoom);
  return page;
}
async function context(viewport,touch) {
  const value=await browser.newContext({viewport,hasTouch:touch,isMobile:touch,reducedMotion:'reduce'});contexts.push(value);
  await value.addInitScript(()=>{
    Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:()=>Promise.reject(Error('test viewport'))});
    if(screen.orientation)Object.defineProperty(screen.orientation,'lock',{configurable:true,value:()=>Promise.reject(Error('test viewport'))});
    const Native=EventSource;window.__streams=[];
    window.EventSource=class extends Native {constructor(...args){super(...args);window.__streams.push(this);}};
  });
  return value;
}
async function lobby(page) {
  if(!await page.locator('#room-dialog').evaluate(node=>node.open)) {
    await page.locator('#settings-btn').click();await page.locator('#settings-home').click();
  }
  await page.locator('#room-dialog[open]').waitFor();
}
try {
  for(const size of [{width:844,height:390},{width:1280,height:720}]) {
    // 公网验收只建一桌，不修改服务器内部状态。
    if(remote&&report.cases.length)break;
    const ownerContext=await context(size,size.width<1000),friendContext=await context(size,size.width<1000);
    const owner=await open(ownerContext),friend=await open(friendContext);
    await owner.locator('#room-name').fill('离房重连验收');await owner.locator('#room-create').click();await connected(owner);
    const ownerId=await identity(owner),code=ownerId.code;
    await friend.locator('#room-name').fill('重连好友');await friend.locator('#room-code').fill(code);await friend.locator('#room-join').click();await connected(friend);
    for(const seat of [2,3])await owner.locator(`.room-bot-add[data-seat="${seat}"]`).click();
    await friend.locator('#room-ready').click();await owner.locator('#room-ready').click();await owner.locator('#room-start').click();
    await Promise.all([owner,friend].map(page=>page.waitForFunction(()=>window.mahjongRoom.room?.status==='playing')));
    const room=remote?null:service.rooms.get(code),initial=room&&JSON.stringify(room.game);
    const friendId=await identity(friend),hand=await friend.evaluate(()=>[...window.mahjongGame.players[0].hand]);
    await friendContext.setOffline(true);
    await friend.waitForFunction(()=>window.mahjongRoom.status==='reconnecting');
    await owner.waitForFunction(()=>window.mahjongRoom.room?.paused);
    assert.equal(await friend.evaluate(()=>window.mahjongRoom.canAct()),false);
    await friendContext.setOffline(false);await connected(friend);await connected(owner);
    assert.deepEqual(await identity(friend),friendId);
    if(!remote){assert.deepEqual(await friend.evaluate(()=>window.mahjongGame.players[0].hand),hand);assert.equal(JSON.stringify(room.game),initial);}
    report.cases.push({size,offlineOnline:true,sameSeat:true,pausedAndResumed:true});

    await lobby(friend);
    await friend.evaluate(()=>{
      const source=window.__streams.at(-1);source.close();source.dispatchEvent(new Event('error'));
      const button=document.querySelector('#room-reconnect');
      if(button.hidden||button.disabled)throw Error('重连按钮不可用');
      button.click();
    });
    await connected(friend);assert.deepEqual(await identity(friend),friendId);
    report.cases.push({size,permanentlyClosedSSE:true,manualReconnect:true});

    await friend.close();await owner.waitForFunction(()=>window.mahjongRoom.room?.paused);
    const returned=await open(friendContext);await connected(returned);
    assert.deepEqual(await identity(returned),friendId);await connected(owner);
    if(!remote)assert.deepEqual(await returned.evaluate(()=>window.mahjongGame.players[0].hand),hand);
    report.cases.push({size,closedTabRestoredFromLocalBackup:true});

    await lobby(returned);assert.equal(await returned.locator('#room-leave').isEnabled(),true);
    if(!remote){room.game.players[0].score=1030;room.game.players[1].score=990;room.game.players[2].score=990;room.game.players[3].score=990;}
    await returned.locator('#room-leave').click();await returned.waitForFunction(()=>window.mahjongRoom.room===null);
    await owner.waitForFunction(()=>window.mahjongRoom.room?.status==='waiting');
    await owner.locator('#room-dialog[open]').waitFor();
    assert.equal(await owner.locator('#game').evaluate(node=>node.classList.contains('is-landscape')),false);
    assert.equal(await owner.locator('html').evaluate(node=>node.classList.contains('in-game')),false);
    assert.equal(await returned.evaluate(()=>localStorage.getItem('queqi-room-session')),null);
    const revoked=await owner.request.get(`${base}/api/rooms/${code}/state`,{headers:{Authorization:`Bearer ${friendId.token}`}});assert.equal(revoked.status(),401);
    if(!remote){assert.equal(room.game,null);assert.deepEqual(room.carry.scores,[1030,990,990,990]);}
    report.cases.push({size,activeLeave:true,remainingPlayersWaiting:true,identityRevoked:true});

    await owner.locator('.room-bot-add[data-seat="1"]').click();await owner.locator('#room-ready').click();await owner.locator('#room-start').click();
    await owner.waitForFunction(()=>window.mahjongRoom.room?.status==='playing');
    if(!remote)assert.deepEqual(room.game.players.map(player=>player.score),[1030,1000,990,990]);
    await lobby(owner);
    await owner.evaluate(()=>{
      const source=window.__streams.at(-1);source.close();source.dispatchEvent(new Event('error'));
      const leave=document.querySelector('#room-leave');
      if(leave.disabled)throw Error('SSE 断线时仍应允许通过 HTTP 主动离房');
      leave.click();
    });
    await owner.waitForFunction(()=>window.mahjongRoom.room===null);
    if(!remote)assert.equal(service.rooms.has(code),false);
    report.cases.push({size,restartAfterAbort:true,leaveWhileSSEDisconnected:true,lastHumanLeaveDisposesRoom:true});
    await ownerContext.close();await friendContext.close();
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
  console.log(JSON.stringify(report,null,2));
} finally {
  writeFileSync(`output/${remote?'online-':'仿真-'}room-recovery.json`,JSON.stringify(report,null,2));
  await browser.close();service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
