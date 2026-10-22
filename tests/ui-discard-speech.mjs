import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {tileName} from '../engine.js';

const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const realtime=process.argv.includes('--latency');
const external=process.argv.slice(2).find(value=>!value.startsWith('--'));
const service=external?null:new RoomService({botDelayMs:600000});
const server=external?null:createServer({roomService:service});
if(server){server.listen(0,'127.0.0.1');await once(server,'listening');}
const base=external||`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const report={passed:false,errors:[],cases:[],note:`Real room and SSE client; actual Web Audio MP3 decoding and source start/end. Playback rate ${realtime?'1x (latency measurement)':'12x (regression test only)'}. Rolling-log snapshots injected locally. Timings measure receipt to source start, not network RTT or physical speaker latency.`};
mkdirSync('output',{recursive:true});
try {
  const sha=data=>createHash('sha256').update(data).digest('hex');
  for(const file of ['app.js','src/ui/discard-speech.js','src/ui/recorded-voice.js','src/ui/voice-bank.js']){
    const response=await fetch(`${base}/${file}`);assert.equal(response.status,200);
    assert.equal(sha(Buffer.from(await response.arrayBuffer())),sha(readFileSync(file)));
  }
  for(const size of [{width:640,height:360},{width:844,height:390},{width:1920,height:1080}]) {
    const context=await browser.newContext({viewport:size,hasTouch:size.width<1000,isMobile:size.width<1000,reducedMotion:'reduce'});
    await context.addInitScript(({rate})=>{
      localStorage.setItem('queqi-settings',JSON.stringify({sound:true}));
      const NativeAudioContext=window.AudioContext||window.webkitAudioContext;
      window.AudioContext=class extends NativeAudioContext {
        constructor(...args){super(...args);window.__audioContext??=this;}
        createBufferSource(){const source=super.createBufferSource();source.playbackRate.value=rate;return source;}
      };
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:undefined});
      const NativeSource=window.EventSource;
      window.EventSource=class extends NativeSource {
        constructor(...args){super(...args);window.__speechSource=this;this.addEventListener('state',event=>{window.__speechEnvelope=JSON.parse(event.data);});}
      };
      window.__speechEmit=(lines,{reset=false}={})=>{
        const envelope=structuredClone(window.__speechEnvelope);
        envelope.room.version++;
        if(reset){envelope.state.round++;envelope.state.events=lines;}
        else {envelope.state.events.push(...lines);envelope.state.events=envelope.state.events.slice(-80);}
        window.__speechSource.dispatchEvent(new MessageEvent('state',{data:JSON.stringify(envelope)}));
      };
      Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:()=>Promise.reject(Error('test fallback'))});
      if(screen.orientation)Object.defineProperty(screen.orientation,'lock',{configurable:true,value:()=>Promise.reject(Error('test fallback'))});
    },{rate:realtime?1:12});
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
    let commands=0;page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/action'))commands++;});
    await page.goto(base,{waitUntil:'networkidle'});
    await page.locator('#room-name').fill('读牌回归验收');await page.locator('#room-create').click();
    await page.waitForFunction(()=>window.mahjongRoom.status==='connected');
    for(const seat of [1,2,3])await page.locator(`.room-bot-add[data-seat="${seat}"]`).click();
    await page.locator('#room-ready').click();await page.locator('#room-start').click();
    await page.waitForFunction(()=>window.__speechEnvelope?.room.status==='playing');
    if(await page.locator('#dice-intro').isVisible())await page.locator('#dice-intro').click();
    await page.locator('#hand button:enabled').first().waitFor();
    if(realtime){
      await page.evaluate(()=>{window.mahjongGameAudio.stop();window.__speechEmit(Array.from({length:80},(_,i)=>`历史记录${i}。`));});
      for(let index=0;index<6;index++)await page.locator('#hand button').nth(index%2).click();
      await page.waitForFunction(()=>window.mahjongGameAudio.getState().playing);
      const latency=await page.evaluate(()=>{
        const at=performance.now();window.__speechEmit(['玩家打出九条。']);
        const state=window.mahjongGameAudio.getState(),timing=state.timings.at(-1);
        return {timing,startDelay:timing.startedAt-at,queued:state.queued,state:state.state};
      });
      assert.equal(latency.timing.name,'九条');assert.equal(latency.timing.preview,false);
      assert.ok(latency.startDelay>=0&&latency.startDelay<100,'原速播放时正式出牌在收到确认后100ms内启动，不等预听队列');
      assert.equal(latency.queued,0);
      await page.evaluate(()=>window.mahjongGameAudio.stop());
      await page.locator('#hand button').nth(0).click();
      await page.waitForFunction(()=>window.mahjongGameAudio.getState().playing);
      const same=await page.evaluate(()=>{
        const voice=window.mahjongGameAudio,before=voice.getState();
        voice.say(before.played.at(-1));const after=voice.getState();
        return {before:before.played.length,after:after.played.length,queued:after.queued,playing:after.playing};
      });
      assert.equal(same.after,same.before);assert.equal(same.queued,0);assert.equal(same.playing,true);
      report.cases.push({size,realtime:true,...latency,sameCardContinues:true});
      assert.equal(commands,0);await page.evaluate(()=>window.mahjongRoom.leave());await context.close();continue;
    }
    const expected=[];
    for(const index of [0,1]){
      const button=page.locator('#hand button').nth(index);
      const code=await button.evaluate(node=>window.mahjongGame.players[0].hand[Number(node.dataset.index)]);
      const name=tileName(code);expected.push({中:'红中',白:'白板',发:'发财'}[name]||name);
      await button.click();
    }
    await page.waitForFunction(()=>window.mahjongGameAudio.getState().played.length===2&&!window.mahjongGameAudio.getState().playing);
    await page.evaluate(()=>window.__speechEmit(Array.from({length:80},(_,i)=>`历史记录${i}。`),{reset:true}));
    assert.equal(await page.evaluate(()=>window.mahjongGameAudio.getState().played.length),2,'初始历史不重读');
    for(let batch=0;batch<20;batch++){
      const names=['一万','二万','三万'];expected.push(...names);
      await page.evaluate(({batch,names})=>window.__speechEmit(names.flatMap((name,i)=>[`玩家打出${name}。`,`摸牌记录${batch}:${i}。`])),{batch,names});
    }
    await page.waitForFunction(()=>{const s=window.mahjongGameAudio.getState();return s.played.length===62&&!s.playing&&s.queued===0;},null,{timeout:20000});
    assert.deepEqual(await page.evaluate(()=>window.mahjongGameAudio.getState().played),expected,'80条满日志下60次新出牌全部实际启动音频播放');
    await page.evaluate(()=>{
      const e=structuredClone(window.__speechEnvelope);
      window.__speechSource.dispatchEvent(new MessageEvent('state',{data:JSON.stringify(e)}));
      e.room.paused=!e.room.paused;
      window.__speechSource.dispatchEvent(new MessageEvent('state',{data:JSON.stringify(e)}));
    });
    assert.equal(await page.evaluate(()=>window.mahjongGameAudio.getState().played.length),62,'重复或仅连接状态变化不重复读牌');
    await page.locator('#sound-btn').click();
    await page.evaluate(()=>window.__speechEmit(['静音玩家打出四万。']));
    await page.locator('#sound-btn').click();
    assert.equal(await page.evaluate(()=>window.mahjongGameAudio.getState().played.length),62,'重新开声不重播静音期间的牌');
    await page.evaluate(async()=>{await window.__audioContext.suspend();window.__speechEmit(['玩家打出白。']);});
    await page.waitForFunction(()=>{const s=window.mahjongGameAudio.getState();return s.played.length===63&&!s.playing;});
    assert.equal(await page.evaluate(()=>window.mahjongGameAudio.getState().played.at(-1)),'白板');
    await page.evaluate(()=>window.__audioContext.suspend());await page.keyboard.press('Shift');
    await page.waitForFunction(()=>window.__audioContext.state==='running');
    const allNames=Array.from({length:34},(_,i)=>tileName(i));
    await page.evaluate(names=>{for(const name of names)window.mahjongGameAudio.say(name);window.__speechEmit(['玩家吃一万。','玩家碰白。','玩家红中杠，补摸一张牌。','玩家胡牌！基础胡牌，获得10分。','玩家自摸胡牌！基础胡牌，获得30分。']);},allNames);
    await page.waitForFunction(()=>{const s=window.mahjongGameAudio.getState();return s.played.length===102&&!s.playing&&s.queued===0;},null,{timeout:20000});
    assert.deepEqual(await page.evaluate(()=>window.mahjongGameAudio.getState().played.slice(-5)),['吃','碰','杠','胡','自摸']);
    assert.equal(await page.evaluate(()=>window.mahjongGameAudio.getState().error),'');
    const clips=await page.evaluate(async()=>{
      const {VOICE_BANK}=await import('/src/ui/voice-bank.js');
      return Promise.all(Object.entries(VOICE_BANK).map(async([key,data])=>{
        const decoded=await window.__audioContext.decodeAudioData(Uint8Array.from(atob(data),c=>c.charCodeAt(0)).buffer);
        const samples=decoded.getChannelData(0);let peak=0,power=0;
        for(const sample of samples){peak=Math.max(peak,Math.abs(sample));power+=sample*sample;}
        return {key,duration:decoded.duration,peak,rms:Math.sqrt(power/samples.length)};
      }));
    });
    assert.equal(clips.length,39);assert.ok(clips.every(clip=>clip.duration>.1&&clip.duration<4&&clip.peak>.02&&clip.rms>.005),'所有配音有可解码、非静音的实际声波');
    await page.evaluate(()=>window.__speechEmit(['新一局历史打出五万。'],{reset:true}));
    assert.equal(await page.evaluate(()=>window.mahjongGameAudio.getState().played.length),102,'换局基线不重读');
    assert.equal(commands,0);
    report.cases.push({size,rollingDiscards:60,selectionNames:2,all34TileClipsDecoded:true,all5ActionsDecoded:true,clips,batched:true,duplicateSilent:true,muteNoReplay:true,pausedResumed:true,noSystemTTS:true,newRoundNoReplay:true});
    await page.evaluate(()=>window.mahjongRoom.leave());
    await context.close();
  }
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify(report,null,2));
} finally {
  writeFileSync(`output/discard-speech-${realtime?'latency-':''}${external?'online':'local'}.json`,JSON.stringify(report,null,2));
  await browser.close();service?.close();
  if(server){const closed=once(server,'close');server.close();server.closeAllConnections();await closed;}
}
