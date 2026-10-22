import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';

const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const external=process.argv[2];
const service=external?null:new RoomService({botDelayMs:600000});
const server=external?null:createServer({roomService:service});
if(server){server.listen(0,'127.0.0.1');await once(server,'listening');}
const base=external||`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const report={passed:false,errors:[],cases:[],note:'Real room and SSE client. Deterministic rolling-log snapshots injected only into this browser; speech API spy verifies calls, not physical speaker output. No fabricated game commands sent.'};
mkdirSync('output',{recursive:true});
try {
  const sha=data=>createHash('sha256').update(data).digest('hex');
  for(const file of ['app.js','src/ui/discard-speech.js']){
    const response=await fetch(`${base}/${file}`);assert.equal(response.status,200);
    assert.equal(sha(Buffer.from(await response.arrayBuffer())),sha(readFileSync(file)));
  }
  for(const size of [{width:640,height:360},{width:844,height:390},{width:1920,height:1080}]) {
    const context=await browser.newContext({viewport:size,hasTouch:size.width<1000,isMobile:size.width<1000,reducedMotion:'reduce'});
    await context.addInitScript(()=>{
      localStorage.setItem('queqi-settings',JSON.stringify({sound:true}));
      const probe=window.__speechProbe={calls:[],voices:[],cancels:0,resumes:0};
      const synth={paused:false,getVoices:()=>probe.voices,
        speak:u=>probe.calls.push({text:u.text,lang:u.lang,voice:u.voice?.lang}),
        resume:()=>{probe.resumes++;synth.paused=false;},cancel:()=>probe.cancels++};
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:synth});
      Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class {constructor(text){this.text=text;}}});
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
    });
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
    let commands=0;page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/action'))commands++;});
    await page.goto(base,{waitUntil:'networkidle'});
    await page.locator('#room-name').fill('读牌回归验收');await page.locator('#room-create').click();
    await page.waitForFunction(()=>window.mahjongRoom.status==='connected');
    for(const seat of [1,2,3])await page.locator(`.room-bot-add[data-seat="${seat}"]`).click();
    await page.locator('#room-ready').click();await page.locator('#room-start').click();
    await page.waitForFunction(()=>window.__speechEnvelope?.room.status==='playing');
    if(await page.locator('#dice-intro').isVisible())await page.locator('#dice-intro').click();
    await page.evaluate(()=>{window.__speechProbe.calls=[];window.__speechEmit(Array.from({length:80},(_,i)=>`历史记录${i}。`),{reset:true});});
    assert.equal(await page.evaluate(()=>window.__speechProbe.calls.length),0,'初始历史不重读');
    const expected=[];
    for(let batch=0;batch<20;batch++){
      const names=['一万','二万','三万'];expected.push(...names);
      await page.evaluate(({batch,names})=>window.__speechEmit(names.flatMap((name,i)=>[`玩家打出${name}。`,`摸牌记录${batch}:${i}。`])),{batch,names});
    }
    assert.deepEqual(await page.evaluate(()=>window.__speechProbe.calls.map(call=>call.text)),expected,'80条满日志下60次新出牌全部按序朗读');
    await page.evaluate(()=>{
      const e=structuredClone(window.__speechEnvelope);
      window.__speechSource.dispatchEvent(new MessageEvent('state',{data:JSON.stringify(e)}));
      e.room.paused=!e.room.paused;
      window.__speechSource.dispatchEvent(new MessageEvent('state',{data:JSON.stringify(e)}));
    });
    assert.equal(await page.evaluate(()=>window.__speechProbe.calls.length),60,'重复或仅连接状态变化不重复读牌');
    await page.locator('#sound-btn').click();
    await page.evaluate(()=>window.__speechEmit(['静音玩家打出四万。']));
    await page.locator('#sound-btn').click();
    assert.equal(await page.evaluate(()=>window.__speechProbe.calls.length),60,'重新开声不重播静音期间的牌');
    await page.evaluate(()=>{
      window.__speechProbe.voices=[{lang:'zh-CN',localService:true}];
      speechSynthesis.paused=true;
      window.__speechEmit(['玩家打出白。']);
    });
    const last=await page.evaluate(()=>window.__speechProbe.calls.at(-1));
    assert.deepEqual(last,{text:'白板',lang:'zh-CN',voice:'zh-CN'});
    assert.equal(await page.evaluate(()=>speechSynthesis.paused),false);
    await page.evaluate(()=>{speechSynthesis.paused=true;});await page.keyboard.press('Shift');
    assert.equal(await page.evaluate(()=>speechSynthesis.paused),false,'用户再次交互恢复暂停');
    await page.evaluate(()=>window.__speechEmit(['新一局历史打出五万。'],{reset:true}));
    assert.equal(await page.evaluate(()=>window.__speechProbe.calls.length),61,'换局基线不重读');
    assert.ok(await page.evaluate(()=>window.__speechProbe.cancels>=2),'静音和换局清理旧队列');
    assert.equal(commands,0);
    report.cases.push({size,rollingDiscards:60,batched:true,duplicateSilent:true,muteNoReplay:true,pausedResumed:true,voiceLoadedLater:true,newRoundNoReplay:true});
    await page.evaluate(()=>window.mahjongRoom.leave());
    await context.close();
  }
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify(report,null,2));
} finally {
  writeFileSync(`output/discard-speech-${external?'online':'local'}.json`,JSON.stringify(report,null,2));
  await browser.close();service?.close();
  if(server){const closed=once(server,'close');server.close();server.closeAllConnections();await closed;}
}
