// Baseline diagnostic sampler; not an acceptance test. Uses an isolated local
// RoomService, real HTTP/SSE, legal physical fixtures and the existing UI path.
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {actionFixture} from './pizi-fixtures.mjs';
import {assertInvariants} from '../src/domain/invariants.js';
import {installDiscardProbe,instrumentClientSource} from './perf-discard-probe.mjs';
import {createDiagnosticTransport} from './perf-discard-transport.mjs';

const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const revision=option('--revision','e2397ec4ebe2b6a2b506a4f218e902127ab4a2f5');
const count=Number(option('--samples','20'));
const output=path.resolve(option('--output','output/discard-performance-20261112/baseline'));
const selected=option('--cases','all');
mkdirSync(output,{recursive:true});
const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const service=new RoomService({botDelayMs:600000}),server=createServer({roomService:service});
const serverSamples=[],byRoom=new Map();let activeServer=null;
for(const name of ['_changed','snapshot','_write']){
  const original=service[name];service[name]=function(...params){
    if(!activeServer)return original.apply(this,params);
    const start=performance.now();try{return original.apply(this,params);}finally{activeServer.spans.push({name,duration:performance.now()-start,viewer:name==='snapshot'?params[1]:undefined});}
  };
}
const originalAction=service.action;
service.action=function(code,token,body){
  const sample={requestId:body.requestId,version:body.version,S0:performance.now(),spans:[]};activeServer=sample;byRoom.set(code,sample);
  try{return originalAction.call(this,code,token,body);}finally{sample.actionReturned=performance.now();serverSamples.push(sample);activeServer=null;}
};
server.prependListener('request',(request,response)=>{
  const match=/^\/api\/rooms\/(\d{6})\/action$/.exec(request.url||'');
  if(match)response.once('finish',()=>{const sample=byRoom.get(match[1]);if(sample){sample.S3=performance.now();sample.httpStatus=response.statusCode;}});
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const transport=await createDiagnosticTransport(server.address().port);
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const cases=[
  {name:'ordinary',density:'sparse',hintOpen:false,latency:0,cpu:1},
  {name:'hints-open',density:'sparse',hintOpen:true,latency:0,cpu:1},
  {name:'dense',density:'dense',hintOpen:false,latency:0,cpu:1},
  {name:'dense-cpu4',density:'dense',hintOpen:true,latency:0,cpu:4},
  // Explicit opt-in only: established SSE did not observe the configured RTT.
  {name:'dense-rtt150',density:'dense',hintOpen:true,latency:150,cpu:1,exploratory:true},
  {name:'dense-proxy150',density:'dense',hintOpen:true,latency:0,proxyRTT:150,cpu:1}
].filter(row=>selected==='all'?!row.exploratory:selected.split(',').includes(row.name));
const report={kind:revision==='working'?'working-source diagnostic':'fixed-revision baseline diagnostic',revision,sampleCountPerCase:count,environment:{browser:browser.version(),viewport:{width:844,height:390},dpr:1,headless:true,participants:'one human / three bots, bot scheduling held at 600000ms in this diagnostic service only',network:'loopback; proxyRTT delays action uplink and HTTP/SSE downlink by half each; latency is a CDP setting and not calibrated SSE RTT; neither is public Internet',reducedMotion:'reduce'},limitations:['C4 rAF and compositor trace are observations, not proof of a physical display or GPU presentation.','Fixtures allocate four physical copies and use authoritative actions, but are not claimed to be naturally played whole games.','Only the requesting player receives private state; no credentials or other players concealed tiles are written.','Instrumentation adds overhead; nested spans overlap and must not be summed.','httpComplete is response.json consumption completion on the browser main thread, not an independent wire timestamp.','--revision selects browser JS; the imported server is from this worktree, so use separate fixed worktrees if server code changes.'],cases:[],errors:[]};
const redact=value=>JSON.parse(JSON.stringify(value).replace(/[a-f0-9]{48}/g,'[credential-redacted]'));
const sourceCache=new Map();
const sourceFor=file=>{
  const key=revision+':'+file;if(!sourceCache.has(key))sourceCache.set(key,revision==='working'?readFileSync(path.resolve(file),'utf8'):execFileSync('git',['show',`${revision}:${file}`],{encoding:'utf8'}));return sourceCache.get(key);
};
const duration=(s,from,to)=>s[from]==null||s[to]==null?null:s[to]-s[from];
const stats=values=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return{n:sorted.length,median:sorted.length?sorted[Math.floor(sorted.length/2)]:null,p95:sorted.length?sorted[Math.ceil(sorted.length*.95)-1]:null,max:sorted.at(-1)??null};};
function fixture(density,names){
  const hand=[0,1,2,9,10,11,18,19,20,24,25,26,4,7];
  const game=actionFixture({hand,names});
  if(density==='dense'){
    const pool=Array.from({length:136},(_,i)=>Math.floor(i/4));
    const take=tiles=>tiles.map(t=>{const i=pool.indexOf(t);if(i<0)throw Error('fixture copy budget');return pool.splice(i,1)[0];});
    take([game.indicatorTile]);
    game.players.forEach(p=>{p.hand=[];p.melds=[];p.discards=[];p.redGangs=[];p.piziGangs=[];});
    game.players[0].hand=take(hand);
    for(let i=1;i<4;i++){const t=27+i;game.players[i].melds=[{kind:'peng',tiles:take([t,t,t]),from:(i+3)%4,concealed:false}];}
    for(let i=1;i<4;i++)game.players[i].hand=pool.splice(0,10);
    for(let i=0;i<4;i++)game.players[i].discards=pool.splice(0,12);
    game.wall=pool;
  }
  game.lastDraw=null;assertInvariants(game);return game;
}
try{
  for(const scenario of cases){
    const context=await browser.newContext({viewport:report.environment.viewport,deviceScaleFactor:1,reducedMotion:'reduce'});
    await context.addInitScript(installDiscardProbe);
    await context.addInitScript(()=>{localStorage.setItem('queqi-settings',JSON.stringify({sound:false}));Object.defineProperty(Element.prototype,'requestFullscreen',{value:()=>Promise.reject(Error('diagnostic viewport'))});});
    await context.route('**/*.js',async route=>{
      const file=new URL(route.request().url()).pathname;
      try{await route.fulfill({body:instrumentClientSource(file,sourceFor(file.slice(1))),contentType:'text/javascript'});}catch(error){report.errors.push(String(error));await route.abort();}
    });
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
    const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    transport.setRTT(0);
    await page.goto(transport.url,{waitUntil:'networkidle'});
    await page.locator('#room-name').fill('性能采样');await page.locator('#room-bot-entry').click();
    await page.waitForFunction(()=>window.mahjongRoom?.room?.fourWildsReady&&!window.mahjongRoom.busy&&document.querySelector('#room-dialog').getAttribute('aria-busy')!=='true');
    const code=await page.locator('#room-current-code').textContent(),room=service.rooms.get(code.trim());
    await page.locator('#room-start').click();
    await page.waitForFunction(()=>window.mahjongRoom.room?.status==='playing'&&!window.mahjongRoom.room.opening&&!window.mahjongRoom.busy);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:scenario.cpu});
    const raw=[];const trace=[];
    cdp.on('Tracing.dataCollected',({value})=>trace.push(...value));
    await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,toplevel,disabled-by-default-devtools.timeline.frame',transferMode:'ReportEvents'});
    for(let iteration=-2;iteration<count;iteration++){
      // Do not let transport emulation delay fixture setup or be mistaken for a measured action.
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      transport.setRTT(0);
      const game=fixture(scenario.density,room.seats.map(s=>s.name));game.round=room.game.round+1;room.game=game;room.opening=null;room.completedOpening=null;
      const originalApply=game.applyAction;game.applyAction=function(...params){const start=performance.now();try{return originalApply.apply(this,params);}finally{if(activeServer){activeServer.ruleMs=performance.now()-start;activeServer.S1=performance.now();}}};
      service._changed(room);
      await page.waitForFunction(version=>window.mahjongRoom.room.version>=version&&!window.mahjongRoom.busy&&document.querySelector('#dice-intro').hidden,room.version);
      if(scenario.hintOpen&&await page.locator('#hint-btn').isVisible())await page.locator('#hint-btn').click();
      await page.waitForTimeout(scenario.cpu===4?400:120);
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:scenario.latency,downloadThroughput:-1,uploadThroughput:-1});
      transport.setRTT(scenario.proxyRTT||0);
      const id=`${scenario.name}-${iteration}`;
      await page.evaluate(metadata=>window.__discardProbe.arm(metadata),{id,warmup:iteration<0,density:scenario.density,publicRiverCount:game.players.reduce((n,p)=>n+p.discards.length,0),publicMeldCount:game.players.reduce((n,p)=>n+p.melds.length,0),hintDetailsOpen:await page.locator('#hint-details').isVisible()});
      // The first click selects; C0 is inside confirmHand, reached by the second click.
      await page.locator('#hand button[data-index="13"]').dblclick({delay:50});
      await page.waitForFunction(()=>window.__discardProbe.active?.secondRAF!=null&&window.__discardProbe.active?.busyReleased!=null,{},{timeout:30000});
      await page.waitForTimeout(120);
      const sample=await page.evaluate(()=>window.__discardProbe.take());
      sample.server=serverSamples.find(s=>s.requestId===sample.requestId);
      sample.metrics={confirmToRequest:duration(sample,'C0','C1'),requestToAuthority:duration(sample,'C1','C2'),authorityToDOM:duration(sample,'C2','C3'),confirmToDOM:duration(sample,'C0','C3'),domToSecondRAF:duration(sample,'C3','secondRAF'),confirmToHTTP:duration(sample,'C0','httpComplete'),confirmToUnlock:duration(sample,'C0','busyReleased'),serverTotal:sample.server?sample.server.S3-sample.server.S0:null};
      raw.push(sample);writeFileSync(path.join(output,`${scenario.name}-raw.json`),JSON.stringify(redact(raw),null,2));
      if(iteration>=0&&((iteration+1)%5===0||iteration===count-1))console.log(`${scenario.name}: ${iteration+1}/${count} samples`);
    }
    const traceDone=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');await traceDone;
    const relevant=new Set(['RunTask','Layout','UpdateLayoutTree','Paint','DrawFrame','Commit','FunctionCall','TimerFire','FireAnimationFrame','EventDispatch','PrePaint']);
    const filtered=trace.filter(e=>relevant.has(e.name)||e.cat?.includes('user_timing'));
    writeFileSync(path.join(output,`${scenario.name}-trace.json`),JSON.stringify(redact({traceEvents:filtered})));
    for(const sample of raw){
      const c0=trace.find(e=>e.name===`discard:${sample.id}:C0`),c3=trace.find(e=>e.name===`discard:${sample.id}:C3`);
      if(!c0||!c3)continue;
      const end=c0.ts+(sample.secondRAF-sample.C0)*1000;
      const within=filtered.filter(e=>e.ts>=c0.ts&&e.ts<=end);
      const paint=within.find(e=>e.name==='Paint'&&e.ts>=c3.ts),draw=paint&&within.find(e=>e.name==='DrawFrame'&&e.ts>=paint.ts);
      sample.trace={layoutCount:within.filter(e=>e.name==='Layout').length,layoutMs:within.filter(e=>e.name==='Layout').reduce((n,e)=>n+(e.dur||0)/1000,0),styleMs:within.filter(e=>e.name==='UpdateLayoutTree').reduce((n,e)=>n+(e.dur||0)/1000,0),firstDocumentPaintMs:paint?(paint.ts-c0.ts)/1000:null,firstDrawFrameAfterPaintMs:draw?(draw.ts-c0.ts)/1000:null};
      sample.metrics.confirmToDocumentPaint=sample.trace.firstDocumentPaintMs;
      sample.metrics.confirmToDrawFrame=sample.trace.firstDrawFrameAfterPaintMs;
    }
    writeFileSync(path.join(output,`${scenario.name}-raw.json`),JSON.stringify(redact(raw),null,2));
    const rows=raw.filter(s=>!s.warmup),summary={...scenario,n:rows.length,metrics:Object.fromEntries(Object.keys(rows[0]?.metrics||{}).map(key=>[key,stats(rows.map(s=>s.metrics[key]))])),spans:{},longTasks:rows.flatMap(s=>s.longTasks.map(t=>({sample:s.id,...t})))};
    for(const name of new Set(rows.flatMap(s=>s.spans.map(span=>span.name))))summary.spans[name]=stats(rows.map(s=>s.spans.filter(span=>span.name===name).reduce((sum,span)=>sum+span.duration,0)));
    report.cases.push(summary);writeFileSync(path.join(output,'summary.json'),JSON.stringify(redact(report),null,2));
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    transport.setRTT(0);
    await page.evaluate(()=>window.mahjongRoom.leave());await context.close();
  }
}catch(error){report.errors.push(String(error));throw error;}
finally{
  writeFileSync(path.join(output,'summary.json'),JSON.stringify(redact(report),null,2));
  await browser.close();await transport.close();service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify(report.cases.map(s=>({name:s.name,n:s.n,metrics:s.metrics,spans:s.spans,longTaskCount:s.longTasks.length})),null,2));
