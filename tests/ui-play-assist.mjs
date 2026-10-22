import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {writeFileSync,mkdirSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {actionFixture,scattered} from './pizi-fixtures.mjs';
import {assertInvariants} from '../src/domain/invariants.js';
import {createHintCalculator} from '../src/ui/play-assist.js';

const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const service=new RoomService({botDelayMs:600000});
const server=createServer({roomService:service});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const report={cases:[],errors:[],geometry:[],scoring:'Base 10; all three opponents pay 1/1/2 base immediately; replacement Hu adds 10; gang scores persist on draw.'};mkdirSync('output',{recursive:true});
const waiting=[0,1,2,9,10,11,18,19,20,24,25,26,4];
try{
 for(const touch of [false,true]){
  const context=await browser.newContext({viewport:{width:640,height:360},hasTouch:touch,isMobile:touch});
  await context.addInitScript(()=>{Object.defineProperty(Element.prototype,'requestFullscreen',{value:()=>Promise.reject(Error('test fallback'))});if(screen.orientation)Object.defineProperty(screen.orientation,'lock',{value:()=>Promise.reject(Error('test fallback'))});});
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  let sent=[];page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/action'))sent.push(request.postDataJSON());});
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
  await page.locator('#room-name').fill('交互验收');await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();
  const room=service.rooms.get((await page.locator('#room-current-code').textContent()).trim());
  for(const seat of [1,2,3])await page.locator(`.room-bot-add[data-seat="${seat}"]`).click();
  await page.locator('#room-ready').click();await page.locator('#room-start').click();await page.locator('#room-dialog').waitFor({state:'hidden'});
  const sync=async()=>{await page.waitForFunction(version=>window.mahjongRoom.room.version>=version&&!window.mahjongRoom.busy,room.version);await page.waitForTimeout(40);};
  const publish=async game=>{clearTimeout(room.botTimer);room.botTimer=null;game.round=room.game.round+1;assertInvariants(game);room.game=game;service._changed(room);await sync();if(await page.locator('#dice-intro').isVisible())await page.locator('#dice-intro').click();sent=[];};
  const tap=async locator=>touch?locator.tap():locator.click();
  const names=room.seats.map(seat=>seat.name);
  for(const [indicator,type,kind,label] of [[33,31,'redGang','红中杠'],[33,33,'piziGang','痞子杠'],[33,27,'wildGang','赖子杠'],[31,31,'piziGang','痞子杠'],[30,31,'redGang','红中杠']]){
   const game=actionFixture({indicator,hand:[...scattered,type],names});
   // 补牌特意取普通牌，避免把两张同脸牌的合法连续杠误当成重复触发。
   const tail=game.wall.findIndex(tile=>![indicator,game.wildTile,31].includes(tile));[game.wall[0],game.wall[tail]]=[game.wall[tail],game.wall[0]];
   const before=game.wall.length;await publish(game);
   assert.equal(await page.locator('#indicator-tile .pizi-marker').textContent(),'痞');
   assert.match(await page.locator('.wall-stack.has-indicator .wall-stack-number').textContent(),/^痞·\d+$/);
   assert.equal(await page.locator('#rules-dialog').textContent().then(text=>text.includes('皮')),false);
   const oldLabels=await page.evaluate(()=>[...document.querySelectorAll('[aria-label],[title]')].flatMap(node=>['aria-label','title'].map(name=>node.getAttribute(name)||'')).filter(text=>text.includes('皮')));
   assert.deepEqual(oldLabels,[],'visible and assistive game labels use the same spelling');
   const tile=page.locator('#hand button[data-index="13"]');await tap(tile);
   if(kind!=='wildGang')assert.equal(await tile.locator('.red-kong-marker,.pizi-marker').textContent(),'痞');
   assert.equal(sent.length,0);assert.equal(await tile.getAttribute('aria-pressed'),'true');
   await tap(tile);await page.evaluate(()=>{for(let index=0;index<8;index++)document.querySelector('#hand button')?.click();});await sync();
   await page.waitForTimeout(450);
   assert.equal(sent.length,1);assert.equal(sent[0].action.kind,kind);assert.equal(game.wall.length,before-1);assert.equal(game.wallInfo.tailDraws,1);
   const multiple=kind==='wildGang'?2:1;assert.deepEqual(game.players.map(player=>player.score),[1000+30*multiple,1000-10*multiple,1000-10*multiple,1000-10*multiple]);
   assert.equal(game.players[0].hand.includes(type),false);assert.equal(game.lastDraw.replacement,true);
   assert.match(await page.locator('#melds-0').textContent(),new RegExp(label));assert.equal(await page.locator('#hand .selected').count(),0);assertInvariants(game);
   if(kind==='piziGang'){
    assert.match(game.events.at(-2),/皮子杠/,'server log remains unchanged');
    const legacyDisplay=await page.evaluate(()=>{
     const game=window.mahjongGame;game.events.push(game.events.at(-2));window.renderMahjong();
     const text=document.querySelector('#last-event').textContent;game.events.pop();window.renderMahjong();return text;
    });
    assert.match(legacyDisplay,/痞子杠/,'legacy room text is normalized only for display');
    assert.equal(legacyDisplay.includes('皮'),false);
   }
   const horizontal=await page.locator('#melds-0 .special-gang .tile').boundingBox();assert.ok(horizontal.width>horizontal.height);
   const replay=service.action(room.code,room.seats[0].token,sent[0]);assert.equal(replay.duplicate,true);assert.equal(game.wallInfo.tailDraws,1);
   assert.deepEqual(game.players.map(player=>player.score),[1000+30*multiple,1000-10*multiple,1000-10*multiple,1000-10*multiple]);
   report.cases.push({touch,kind,indicator,type,label,singleRequest:true,tailDraws:1,duplicateRejected:true});
  }
  // 超过 300ms 的两次特殊牌单击不能触发杠。
  await publish(actionFixture({names,hand:[...scattered,31]}));let tile=page.locator('#hand button[data-index="13"]');await tap(tile);await page.waitForTimeout(350);await tap(tile);assert.equal(sent.length,0);
  await publish(actionFixture({names,hand:[...scattered,24]}));tile=page.locator('#hand button[data-index="13"]');await tap(tile);await tap(tile);await sync();assert.equal(sent[0].action.kind,'discard');assert.equal(sent.length,1);
  report.cases.push({touch,ordinaryDiscard:true,specialWindow300ms:true});
  const input={names,hand:[...waiting,28]};await publish(actionFixture(input));
  assert.equal(await page.locator('#ting-btn,#ting-dialog').count(),0);await page.locator('#play-assist:not([hidden])').waitFor();
  assert.match(await page.locator('#hint-text').textContent(),/打【.+】→ 听【.+张/);
  for(const size of [{width:640,height:360},{width:844,height:390},{width:1280,height:720},{width:1920,height:1080}]){
   await page.setViewportSize(size);await page.waitForTimeout(80);
   const geometry=await page.evaluate(()=>{const rect=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();return {hint:rect('#play-assist'),details:rect('#hint-details'),hand:rect('.hand-zone'),rack:rect('#rack-0'),scroll:document.documentElement.scrollWidth>innerWidth+1};});
   assert.ok(Math.abs(geometry.hint.bottom-geometry.hand.bottom)<=1);assert.ok(geometry.hint.left>geometry.hand.right);assert.ok(geometry.details.bottom<geometry.hand.top);assert.ok(geometry.details.left>=0&&geometry.details.right<=size.width+1);assert.equal(geometry.scroll,false);report.geometry.push({touch,size,...geometry});
   await page.screenshot({path:`output/play-assist-${touch?'touch':'pc'}-${size.width}.png`});
  }
  assert.ok(await page.locator('#hint-waits .tile').count()>0,'waits show actual tile faces');
  assert.match(await page.locator('#hint-waits').textContent(),/剩\d+张/);
  await page.locator('#hint-close').click();assert.equal(await page.locator('#hint-details').isVisible(),false);assert.equal(sent.length,0);
  await page.evaluate(()=>window.renderMahjong());assert.equal(await page.locator('#hint-details').isVisible(),false,'repeated render respects manual close');
  await page.locator('#hint-btn').click();assert.equal(await page.locator('#hint-details').isVisible(),true);assert.equal(sent.length,0);assert.equal(await page.locator('#hand .hinted').count(),0,'reopening is never a discard confirmation');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#hint-details').isVisible(),false);await page.locator('#hint-btn').click();
  report.cases.push({touch,waitFaces:true,remainingCopies:true,closePersists:true,reopenWithoutAction:true,escapeCloses:true});
  await page.locator('#hint-btn').click();assert.equal(sent.length,0);assert.equal(await page.locator('#hand .hinted').count(),1);
  const index=Number(await page.locator('#hand .hinted').getAttribute('data-index'));assert.equal(room.game.players[0].hand[index],28);
  await page.locator('#hint-btn').click();await sync();assert.equal(sent.length,1);assert.equal(sent[0].action.kind,'discard');
  report.cases.push({touch,hintFirstHighlights:true,secondConfirms:true});
  const ready=actionFixture({names,hand:waiting});ready.players[1].hand.push(ready.wall.pop());ready.current=1;ready.phase={kind:'discard',seat:1};ready.lastDraw=null;await publish(ready);
  assert.match(await page.locator('#hint-text').textContent(),/^已听：/);assert.equal(await page.locator('#play-assist').isVisible(),true);
  const notReady=actionFixture({names,hand:scattered});notReady.players[1].hand.push(notReady.wall.pop());notReady.current=1;notReady.phase={kind:'discard',seat:1};notReady.lastDraw=null;await publish(notReady);assert.equal(await page.locator('#play-assist').isVisible(),false);
  await publish(actionFixture({names,hand:[...scattered,24]}));assert.equal(await page.locator('#play-assist').isVisible(),false);
  const open=actionFixture({names,hand:[9,10,11,18,19,20,24,25,26,4,28],melds:[{kind:'peng',tiles:[0,0,0],from:1,concealed:false}]});await publish(open);assert.equal(await page.locator('#play-assist').isVisible(),true);
  const expected=createHintCalculator()({hand:open.players[0].hand,melds:open.players[0].melds,indicatorTile:open.indicatorTile,wildTile:open.wildTile,visibleTiles:[33,0,0,0]});assert.equal(expected.mode,'discard');
  await page.locator('#hint-btn').click();const chosen=page.locator('#hand .hinted');await tap(chosen);await sync();assert.equal(sent.length,1);
  report.cases.push({touch,readyOtherTurn:true,notReadyHidden:true,noWaitHidden:true,afterPengRefreshed:true,tileConfirms:true});
  // 参考图场景：四家少量弃牌、自己的副露在右侧，别人回合仍展示实际待胡牌。
  const reference=actionFixture({names,hand:[9,10,11,18,19,20,24,25,26,4],melds:[{kind:'peng',tiles:[0,0,0],from:1,concealed:false}]});
  reference.players[1].hand.push(reference.wall.pop());reference.current=1;reference.phase={kind:'discard',seat:1};reference.lastDraw=null;
  for(const [seat,count] of [[0,5],[1,7],[2,4],[3,5]])for(let index=0;index<count;index++){const at=reference.wall.findIndex(tile=>![4,27,31,33].includes(tile));assert.ok(at>=0);reference.players[seat].discards.push(reference.wall.splice(at,1)[0]);}
  await publish(reference);await page.setViewportSize({width:844,height:390});await page.waitForTimeout(80);
  const referenceHints=createHintCalculator()({hand:reference.players[0].hand,melds:reference.players[0].melds,wildTile:reference.wildTile,indicatorTile:reference.indicatorTile,visibleTiles:[reference.indicatorTile,...reference.players.flatMap(player=>[...player.discards,...player.melds.flatMap(meld=>meld.tiles)])]});
  assert.equal(await page.locator('#hint-details').isVisible(),true);assert.equal(await page.locator('#hint-waits .tile').count(),referenceHints.candidates[0].waits.length);
  await page.screenshot({path:`output/reference-table-${touch?'touch':'pc'}.png`});
  await page.locator('#hint-close').click();service._changed(room);await sync();assert.equal(await page.locator('#hint-details').isVisible(),false);await page.locator('#hint-btn').click();assert.equal(sent.length,0);
  report.cases.push({touch,referenceRivers:true,readyOtherTurnFaces:true,closePersistsAcrossSnapshot:true});
  // 真实规则产生的 1 / 2 / 5 / 10 / 32 种听牌，验证数量驱动尺寸和极多牌的可读下限。
  const sizes=[{width:640,height:360},{width:844,height:390},{width:800,height:360},{width:1920,height:1080}];
  const previews=[
   {count:1,hand:waiting,exhaustWild:true},
   {count:2,hand:waiting},
   {count:5,hand:[0,0,0,1,2,3,4,5,6,7,8,8,27]},
   {count:10,hand:[1,1,4,4,7,7,10,10,13,13,16,16,19]},
   {count:32,hand:[1,1,4,4,7,7,10,10,13,13,16,16,27]},
  ];
  const previousWidths=new Map();
  for(const preview of previews){
   const game=actionFixture({names,hand:preview.hand});
   if(preview.exhaustWild)for(let index=game.wall.length-1;index>=0;index--)if(game.wall[index]===27)game.players[3].discards.push(game.wall.splice(index,1)[0]);
   game.players[1].hand.push(game.wall.pop());game.current=1;game.phase={kind:'discard',seat:1};game.lastDraw=null;
   await publish(game);
   assert.equal(await page.locator('#hint-waits .tile').count(),preview.count);
   for(const size of sizes){
    await page.setViewportSize(size);await page.waitForTimeout(50);
    const layout=await page.evaluate(()=>{
     const rect=node=>node.getBoundingClientRect().toJSON();
     const hint=document.querySelector('#hint-btn'),details=document.querySelector('#hint-details'),waits=document.querySelector('#hint-waits'),close=document.querySelector('#hint-close'),action=document.querySelector('.action-zone');
     // 吃碰杠区域的最大占位只用于测量，不发送命令，也不改动牌局数据。
     action.hidden=false;for(const button of action.querySelectorAll('button'))button.hidden=false;
     const hit=node=>{const box=rect(node);return node.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));};
     return {button:rect(hint),details:rect(details),hand:rect(document.querySelector('.hand-zone')),action:rect(action),tile:rect(waits.querySelector('.tile')),horizontalOverflow:waits.scrollWidth>waits.clientWidth+1,verticalScroll:waits.scrollHeight>waits.clientHeight+1,buttonHit:hit(hint),closeHit:hit(close),pageOverflow:document.documentElement.scrollWidth>innerWidth+1};
    });
    const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.5;
    assert.ok(layout.button.left>layout.hand.right);assert.ok(layout.button.right<=size.width);
    assert.equal(overlap(layout.button,layout.action),false);assert.equal(overlap(layout.details,layout.action),false);assert.equal(overlap(layout.details,layout.hand),false);
    assert.ok(layout.details.top>=0&&layout.details.right<=size.width);assert.ok(Math.abs(layout.tile.width/layout.tile.height-5/7)<.002);
    assert.equal(layout.horizontalOverflow,false);assert.equal(layout.pageOverflow,false);assert.equal(layout.buttonHit,true);assert.equal(layout.closeHit,true);
    const previous=previousWidths.get(size.width);if(previous!==undefined)assert.ok(layout.tile.width<=previous+.1);previousWidths.set(size.width,layout.tile.width);
    if(preview.count===1||preview.count===5||preview.count===32)await page.screenshot({path:`output/hint-right-${touch?'touch':'pc'}-${size.width}-${preview.count}.png`});
    // 最后一种听牌可在浮窗内查看，滚动不会把桌面或手牌带走。
    await page.locator('#hint-waits .hint-wait').last().scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#hint-waits .hint-wait').last().isVisible(),true);
    report.geometry.push({touch,size,waitCount:preview.count,...layout});
    await page.evaluate(()=>window.renderMahjong());
   }
  }
  report.cases.push({touch,rightOfHand:true,countScaled:[1,2,5,10,32],aspectPreserved:true,actionHotspotsClear:true});
  await publish(actionFixture({names,hand:[1,1,4,4,7,7,10,10,13,13,16,16,27,28]}));
  assert.equal(await page.locator('#hint-waits .tile').count(),32);
  await page.locator('#hint-choice').selectOption('1');
  assert.equal(await page.locator('#hint-waits .tile').count(),3);
  assert.equal(await page.locator('#hint-details').evaluate(node=>node.style.getPropertyValue('--hint-count')),'3');
  assert.equal(await page.locator('#hand .hinted').count(),1);assert.equal(sent.length,0);
  report.cases.push({touch,candidateChangeRefreshesFacesAndSize:true,selectionOnly:true});
  const ended=actionFixture({names,hand:[...waiting,28]});ended._finishDraw();await publish(ended);assert.equal(await page.locator('#play-assist').isVisible(),false);assert.equal(await page.locator('#hand button:enabled').count(),0);
  await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify(report,null,2));
}finally{writeFileSync('output/play-assist-verification.json',JSON.stringify(report,null,2));await browser.close();service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
