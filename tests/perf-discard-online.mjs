// Public HTTP/SSE smoke sampling using only this test's naturally dealt bot room.
// A loopback gateway avoids this workstation's Edge HTTP->HTTPS upgrade policy;
// its upstream remains the explicit public HTTP endpoint, never an SSH tunnel.
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {installDiscardProbe,instrumentClientSource} from './perf-discard-probe.mjs';

const target=new URL(process.env.KK_UI_TARGET_URL || 'http://47.122.110.77');
assert.equal(target.protocol,'http:');
const output=process.env.KK_UI_OUTPUT || 'output/discard-review-20261112/online';
const count=Number(process.env.KK_PERF_SAMPLES || 20);
const resourceRef=process.env.KK_PERF_RESOURCE_REF || 'HEAD';
const fourWilds=process.env.KK_PERF_FOUR_WILDS==='1';
mkdirSync(output,{recursive:true});
const report={passed:false,target:target.origin,transport:'loopback gateway forwarding actual public HTTP/SSE; no added latency; not direct Edge navigation',browser:'',viewport:{width:844,height:390},dpr:1,raw:[],wire:[],resources:{},errors:[],cleanupErrors:[],requests:{actions:0,refreshes:0,conflicts:0},limitations:['Natural deals and changing turns are not a fixed-scene pre/post performance comparison.','Browser receipt includes main-thread scheduling; wire-hop durations use only the gateway clock.','rAF is not physical presentation. No claim about all devices or public networks.']};
const sha=b=>createHash('sha256').update(b).digest('hex');
report.resourceCommit=execFileSync('git',['rev-parse',resourceRef],{encoding:'utf8'}).trim();
report.ruleChoice={wildOwner:fourWilds?0:null};
report.sse=[];
const gateway=http.createServer((request,response)=>{
  const action=request.method==='POST'&&/\/action$/.test(request.url),start=performance.now();
  const item=action?{start,requestId:null,status:null,headersMs:null,firstByteMs:null,bodyEndMs:null}:null;
  if(item){item.room=/\/rooms\/(\d{6})\//.exec(request.url)?.[1];report.requests.actions++;report.wire.push(item);const chunks=[];request.on('data',b=>chunks.push(b));request.on('end',()=>{try{const body=JSON.parse(Buffer.concat(chunks));item.requestId=body.requestId;item.version=body.version;}catch{}});}
  if(/\/state$/.test(request.url))report.requests.refreshes++;
  // Preserve the browser's Host/Origin pair, just as the local diagnostic
  // transport does; the existing server origin check remains enabled.
  const upstream=http.request({hostname:target.hostname,port:target.port || 80,path:request.url,method:request.method,headers:request.headers},incoming=>{
    if(item){item.status=incoming.statusCode;item.headersMs=performance.now()-start;if(item.status===409)report.requests.conflicts++;}
    response.writeHead(incoming.statusCode,incoming.headers);
    incoming.on('data',()=>{if(item&&item.firstByteMs===null)item.firstByteMs=performance.now()-start;});
    if(/\/events\?/.test(request.url)){
      let pending='';incoming.setEncoding('utf8');incoming.on('data',chunk=>{
        pending+=chunk;let end;
        while((end=pending.indexOf('\n\n'))>=0){const event=pending.slice(0,end);pending=pending.slice(end+2);
          if(!event.startsWith('event: state\n'))continue;
          try{const value=JSON.parse(event.slice(event.indexOf('data: ')+6));report.sse.push({room:value.room.code,version:value.room.version,receivedAt:performance.now()});}catch{}
        }
      });
    }
    incoming.on('end',()=>{if(item)item.bodyEndMs=performance.now()-start;});
    incoming.pipe(response);
  });
  upstream.on('error',e=>{report.errors.push('gateway '+e.code);response.destroy();});
  response.on('close',()=>upstream.destroy());request.pipe(upstream);
});
gateway.listen(0,'127.0.0.1');await once(gateway,'listening');
const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
report.browser=browser.version();
const context=await browser.newContext({viewport:report.viewport,deviceScaleFactor:1,reducedMotion:'reduce'});
await context.addInitScript(installDiscardProbe);
await context.addInitScript(()=>{localStorage.setItem('queqi-settings',JSON.stringify({sound:false}));Object.defineProperty(Element.prototype,'requestFullscreen',{value:()=>Promise.reject(Error('public sample viewport'))});});
await context.route('**/*.js',async route=>{
  const file=new URL(route.request().url()).pathname,received=await route.fetch(),body=await received.body();
  const expected=execFileSync('git',['show',resourceRef+':'+file.slice(1)]);
  assert.equal(sha(body),sha(expected),'cloud JS version '+file);report.resources[file]=sha(body);
  await route.fulfill({response:received,body:instrumentClientSource(file,body.toString())});
});
const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text().replace(/[a-f0-9]{48}/g,'[redacted]'));});
page.on('response',r=>{if(r.status()>=400)report.errors.push(new URL(r.url()).pathname+' '+r.status());});
page.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')report.errors.push(new URL(r.url()).pathname+' '+r.failure()?.errorText);});
const pct=(values,p)=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return{n:sorted.length,value:sorted[Math.ceil(sorted.length*p)-1]??null};};
const delta=(s,a,b)=>s[a]!=null&&s[b]!=null?s[b]-s[a]:null;
try{
  const direct=await browser.newPage({viewport:report.viewport});
  try{const r=await direct.goto(target.origin,{waitUntil:'domcontentloaded',timeout:15000});report.directNavigation={ok:r?.ok()===true,url:direct.url()};}
  catch(e){report.directNavigation={ok:false,error:e.message.split('\n')[0],url:direct.url()};}
  finally{await direct.close();}
  await page.goto('http://127.0.0.1:'+gateway.address().port,{waitUntil:'networkidle'});
  await page.locator('#room-name').fill('性能审核独立房');await page.locator('#room-bot-entry').click();
  await page.waitForFunction(()=>window.mahjongRoom.room?.fourWildsReady&&!window.mahjongRoom.busy&&document.querySelector('#room-dialog').getAttribute('aria-busy')==='false');
  assert.equal(await page.evaluate(()=>window.mahjongRoom.room.status),'waiting');
  await page.locator(fourWilds?'#room-four-wilds':'#room-start').click();
  await page.waitForFunction(()=>window.mahjongRoom.room?.status==='playing'&&!window.mahjongRoom.room.opening&&!window.mahjongRoom.busy&&!document.querySelector('#game').matches('.is-opening-deal,.is-dice-intro'));
  const initial=await page.evaluate(()=>{const g=window.mahjongGame;return{wildOwner:window.mahjongRoom.room.wildOwner,wildCount:g.players[0].hand.filter(t=>t===g.wildTile).length};});
  assert.equal(initial.wildOwner,fourWilds?0:null);if(fourWilds)assert.equal(initial.wildCount,4);report.initialModeVerified=true;
  let rounds=1;const deadline=Date.now()+600000;
  while(report.raw.length<count){
    assert.ok(Date.now()<deadline,'natural online actions finish within bounded sample time');
    const state=await page.evaluate(()=>{
      const c=window.mahjongRoom,g=window.mahjongGame,a=g.getActions(0);
      return{busy:c.busy,phase:g.phase.kind,current:g.current,round:g.round,pass:a.pass,
        index:g.players[0].hand.findIndex(t=>t!==31&&t!==g.indicatorTile&&t!==g.wildTile),
        riverCount:g.players.reduce((n,p)=>n+p.discards.length,0),meldCount:g.players.reduce((n,p)=>n+p.melds.length,0)};
    });
    if(state.busy){await page.waitForTimeout(50);continue;}
    if(state.phase==='ended'){
      await page.locator('#next-round').click();rounds++;
      await page.waitForFunction(()=>!window.mahjongRoom.busy&&!window.mahjongRoom.room?.opening&&window.mahjongGame.phase.kind!=='ended'&&!document.querySelector('#game').matches('.is-opening-deal,.is-dice-intro'));continue;
    }
    if(state.pass){await page.locator('#action-pass:enabled').click();await page.waitForTimeout(100);continue;}
    if(state.phase!=='discard'||state.current!==0||state.index<0){await page.waitForTimeout(100);continue;}
    const id='public-'+report.raw.length;
    await page.evaluate(m=>window.__discardProbe.arm(m),{id,round:state.round,publicRiverCount:state.riverCount,publicMeldCount:state.meldCount});
    await page.locator('#hand button[data-index="'+state.index+'"]').dblclick({delay:50});
    await page.waitForFunction(()=>window.__discardProbe.active?.secondRAF!=null&&window.__discardProbe.active?.busyReleased!=null,null,{timeout:30000});
    await page.waitForTimeout(100);
    const sample=await page.evaluate(()=>window.__discardProbe.take());
    assert.equal(sample.httpStatus,200);assert.equal(sample.requestVersion,sample.version);assert.equal(sample.confirmedVersion,sample.version+1);
    const wire=report.wire.find(w=>w.requestId===sample.requestId),event=report.sse.find(e=>e.room===wire.room&&e.version===sample.confirmedVersion&&e.receivedAt>=wire.start);
    assert.ok(event,'matching authoritative public SSE arrived');wire.matchingSSEMs=event.receivedAt-wire.start;
    sample.metrics=Object.fromEntries([['confirmToRequest','C0','C1'],['requestToAuthority','C1','C2'],['authorityToDOM','C2','C3'],['confirmToDOM','C0','C3'],['confirmToHTTP','C0','httpComplete'],['confirmToUnlock','C0','busyReleased']].map(([k,a,b])=>[k,delta(sample,a,b)]));
    report.raw.push(sample);console.log('public natural discards '+report.raw.length+'/'+count);
  }
  report.rounds=rounds;
  report.metrics=Object.fromEntries(Object.keys(report.raw[0].metrics).map(k=>[k,{median:pct(report.raw.map(s=>s.metrics[k]),.5),p95:pct(report.raw.map(s=>s.metrics[k]),.95)}]));
  report.wireSummary=Object.fromEntries(['headersMs','firstByteMs','bodyEndMs','matchingSSEMs'].map(k=>[k,{median:pct(report.wire.filter(w=>report.raw.some(s=>s.requestId===w.requestId)).map(w=>w[k]),.5),p95:pct(report.wire.filter(w=>report.raw.some(s=>s.requestId===w.requestId)).map(w=>w[k]),.95)}]));
  await page.screenshot({path:output+'/natural-online.png'});assert.deepEqual(report.errors,[]);report.passed=true;
}catch(e){report.failure=e.stack;throw e;}finally{
  try{await page.evaluate(async()=>{const client=window.mahjongRoom;if(client?.room){if(!await client.leave())throw Error('test room cleanup failed');}client?.destroy();});}catch(e){report.cleanupErrors.push(e.message);}
  report.passed=report.passed&&report.cleanupErrors.length===0&&report.errors.length===0;
  writeFileSync(output+'/natural-online.json',JSON.stringify(report,null,2));await context.close();await browser.close();gateway.closeAllConnections();await new Promise(r=>gateway.close(r));
}
console.log(JSON.stringify({passed:report.passed,metrics:report.metrics,wire:report.wireSummary,errors:report.errors,cleanupErrors:report.cleanupErrors}));
assert.equal(report.passed,true,'Online actions, resources and test-room cleanup all pass');
