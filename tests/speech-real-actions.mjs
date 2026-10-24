import assert from 'node:assert/strict';
import {isSpecialGangTile,tileName} from '../engine.js';
import {actionFixture,scattered} from './pizi-fixtures.mjs';
import {assertInvariants} from '../src/domain/invariants.js';

// 原生 MP3/Web Audio + 四个真实 HTTP/SSE 玩家；仅模拟严格的触屏抬手授权策略。
export async function verifyRealSpeechActions({browser,service,base,report}) {
  const contexts=[],pages=[],samples=[];let room;
  const read=page=>page.evaluate(()=>({saved:JSON.parse(localStorage.getItem('queqi-settings')),button:document.querySelector('#sound-btn').getAttribute('aria-pressed'),setting:document.querySelector('#sound-setting').checked,...window.mahjongGameAudio.getState()}));
  const sync=()=>Promise.all(pages.map(p=>p.waitForFunction(v=>window.mahjongRoom.room?.version>=v&&!window.mahjongRoom.busy,room.version)));
  const ended=(page,count)=>page.waitForFunction(count=>{const s=window.mahjongGameAudio.getState();return s.played.length===count&&!s.playing&&!s.queued;},count,{timeout:8000});
  async function passClaims(quiet=true){
    while(room.game.phase.kind==='claim'){
      const seat=[0,1,2,3].find(n=>room.game.getActions(n).pass);assert.notEqual(seat,undefined);
      const before=await Promise.all(pages.map(read));await pages[seat].locator('#action-pass:enabled').tap();await sync();
      const after=await Promise.all(pages.map(read));if(quiet)assert.deepEqual(after.map(s=>s.played),before.map(s=>s.played),'真实过牌不重读来牌');
    }
  }
  async function discard(){
    await passClaims();const seat=room.game.current,index=room.game.players[seat].hand.findIndex(t=>!isSpecialGangTile(t,room.game.indicatorTile));assert.ok(index>=0);
    const name=tileName(room.game.players[seat].hand[index]),spoken={中:'红中',发:'发财',白:'白板'}[name]||name;
    const before=await Promise.all(pages.map(read)),target=pages[seat].locator(`#hand button[data-index="${index}"]`);
    await target.tap();assert.deepEqual((await Promise.all(pages.map(read))).map(s=>s.played),before.map(s=>s.played),'真实单击选牌静音');
    await target.tap();await sync();return {seat,name:spoken,before};
  }
  try{
    for(let i=0;i<4;i++){
      const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true,reducedMotion:'reduce'});contexts.push(context);
      await context.addInitScript(()=>{
        localStorage.setItem('queqi-settings',JSON.stringify({sound:true}));let activation=false,activationTimer;
        // 授权贯穿本次事件的所有监听器；不能用监听器间的微任务检查点过早撤销。
        for(const type of ['pointerdown','pointerup','touchend','click','keydown']){
          document.addEventListener(type,event=>{clearTimeout(activationTimer);activation=event.isTrusted&&(type!=='pointerdown'||event.pointerType==='mouse');activationTimer=setTimeout(()=>{activation=false;},0);},{capture:true,passive:true});
          window.addEventListener(type,()=>{activation=false;});
        }
        const Native=window.AudioContext||window.webkitAudioContext;
        window.AudioContext=class extends Native{
          constructor(...args){super(...args);(window.__speechContexts??=[]).push(this);}
          resume(){if(this.state!=='running'&&(!activation||window.__blockSpeechResume))return Promise.reject(new DOMException('Touch audio requires pointerup/touchend activation','NotAllowedError'));return super.resume();}
        };
        Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:()=>Promise.reject(Error('test fallback'))});
      });
      const page=await context.newPage();pages.push(page);page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base,{waitUntil:'networkidle'});await page.locator('#room-name').fill(`真实报牌${i+1}`);
      if(i===0){await page.locator('#room-create').tap();await page.locator('#room-waiting:not([hidden])').waitFor();room=service.rooms.get((await page.locator('#room-current-code').textContent()).trim());}
      else{await page.locator('#room-code').fill(room.code);await page.locator('#room-join').tap();await page.locator('#room-waiting:not([hidden])').waitFor();}
    }
    for(const page of pages)await page.locator('#room-ready').tap();await pages[0].locator('#room-start').tap();await sync();
    for(const page of pages){if(await page.locator('#dice-intro').isVisible())await page.locator('#dice-intro').evaluate(n=>n.click());await page.evaluate(()=>window.renderMahjong());}
    const initial=await Promise.all(pages.map(read));assert.ok(initial.every(s=>s.saved.sound===true&&s.button==='true'&&s.setting===true&&s.enabled===true));
    for(let i=0;i<5;i++){
      const action=await discard();await Promise.all(pages.map(p=>ended(p,i+1)));const after=await Promise.all(pages.map(read));
      for(const state of after){assert.equal(state.played.at(-1),action.name);assert.equal(state.error,'');assert.equal(state.state,'running');}
      samples.push({seat:action.seat,name:action.name,players:after.map(s=>({played:s.played.length,queued:s.queued,playing:s.playing,state:s.state,error:s.error}))});
    }
    for(const page of pages)await page.locator('#sound-btn').tap();await discard();const muted=await Promise.all(pages.map(read));assert.ok(muted.every(s=>s.enabled===false&&s.played.length===5&&!s.queued));
    for(const page of pages)await page.locator('#sound-btn').tap();const unmutedAction=await discard();await Promise.all(pages.map(p=>ended(p,6)));assert.ok((await Promise.all(pages.map(read))).every(s=>s.played.at(-1)===unmutedAction.name));
    // 暂停观察者而非出牌者，保证补播来自下一次普通触碰，而非再点音效开关。
    await passClaims();const observer=(room.game.current+1)%4;
    await pages[observer].evaluate(async()=>{window.__blockSpeechResume=true;await window.__speechContexts[0].suspend();});const pendingAction=await discard();
    await Promise.all(pages.filter((_,i)=>i!==observer).map(p=>ended(p,7)));const suspended=await read(pages[observer]);assert.equal(suspended.played.length,6);assert.equal(suspended.queued,1);assert.equal(suspended.state,'suspended');assert.equal(suspended.playing,false);
    await pages[observer].evaluate(()=>{window.__blockSpeechResume=false;});await pages[observer].locator('#wall-pill').tap();await ended(pages[observer],7);const resumed=await read(pages[observer]);assert.equal(resumed.error,'');assert.equal(resumed.played.at(-1),pendingAction.name);
    await pages[observer].evaluate(()=>window.__speechContexts[0].close());await discard();await pages[observer].locator('#wall-pill').tap();await Promise.all(pages.map(p=>ended(p,8)));assert.ok(await pages[observer].evaluate(()=>window.__speechContexts.length>1));
    const rejected=await pages[observer].evaluate(()=>({accepted:window.mahjongGameAudio.say('不存在的牌'),error:window.mahjongGameAudio.getState().error,toast:document.querySelector('#toast').textContent,visible:document.querySelector('#toast').classList.contains('visible')}));assert.equal(rejected.accepted,false);assert.ok(rejected.visible);assert.match(rejected.toast,/牌名映射/);assert.equal(rejected.error,rejected.toast);
    // 刷新只恢复基线，不回放本局先前出牌。
    await pages[observer].reload({waitUntil:'networkidle'});await sync();assert.equal((await read(pages[observer])).played.length,0);
    await pages[observer].locator('#wall-pill').tap();
    const actionVoices=[],names=room.seats.map(s=>s.name),pairs=[0,0,2,2,3,3,5,5,6,6,8,8,27,27];
    const cases=[
      {seat:1,hand:[0,2,...scattered.filter(t=>t!==0&&t!==2).slice(0,11)],discard:1,kind:'chi',spoken:'吃'},
      {seat:2,hand:[27,27,...scattered.slice(0,11)],discard:27,kind:'peng',spoken:'碰'},
      {seat:3,hand:[28,28,28,...scattered.slice(0,10)],discard:28,kind:'gang',spoken:'杠'},
      {seat:0,hand:pairs.slice(0,-1),discard:27,kind:'hu',spoken:'胡'},
      {seat:3,hand:pairs,kind:'hu',spoken:'自摸'},
    ];
    for(const scenario of cases){
      const game=actionFixture({...scenario,names});game.round=room.game.round+1;game.events=['动作报牌回归验收。'];assertInvariants(game);room.game=game;service._changed(room);await sync();
      for(const page of pages){if(await page.locator('#dice-intro').isVisible())await page.locator('#dice-intro').evaluate(n=>n.click());await page.evaluate(()=>window.renderMahjong());}
      const counts=(await Promise.all(pages.map(read))).map(s=>s.played.length);await pages[scenario.seat].locator(`#action-${scenario.kind}:enabled`).tap();
      if(await pages[scenario.seat].locator('#choice-dialog').evaluate(n=>n.open))await pages[scenario.seat].locator('#choice-options button').first().tap();await sync();await passClaims(false);
      await Promise.all(pages.map((p,i)=>ended(p,counts[i]+1)));const states=await Promise.all(pages.map(read));
      assert.ok(states.every(s=>s.played.at(-1)===scenario.spoken&&s.error===''));actionVoices.push({kind:scenario.spoken,allFourPlayersOnce:true});
    }
    report.realActions={strictTouchPolicy:true,nativePlaybackRate:1,initial:initial.map(s=>({saved:s.saved,button:s.button,setting:s.setting,state:s.state})),discards:samples,muted:muted.map(s=>({played:s.played.length,queued:s.queued,enabled:s.enabled})),suspended:{played:suspended.played.length,queued:suspended.queued,state:suspended.state,error:suspended.error},resumed:{played:resumed.played.length,queued:resumed.queued,state:resumed.state,error:resumed.error},closedRecovered:true,unknownNameToast:rejected,actionVoices,passSilent:true,selectionSilent:true,refreshSilent:true};
  }catch(error){
    report.realActionsFailure={message:error.message,states:await Promise.all(pages.map(read))};throw error;
  }finally{
    for(const page of pages){try{await page.evaluate(()=>window.mahjongRoom.leave());}catch{/* 自己的测试房间可能已被其他测试页清空。 */}}
    await Promise.all(contexts.map(c=>c.close()));
  }
}
