import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';

const BASELINE='ebe2e64';
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const asset=readFileSync('assets/tiles.svg');
assert.equal(sha(asset),sha(execFileSync('git',['show',`${BASELINE}:assets/tiles.svg`])),'the original SVG artwork is byte-for-byte unchanged');
const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const service=new RoomService({botDelayMs:600000}),server=createServer({roomService:service});
server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const report={passed:false,browser:browser.version(),assetSha256:sha(asset),cases:[],errors:[],screenshots:0,note:'Actual HTTP/SSE rooms and existing markup; display fixtures send no game actions. Borders are checked in CSS pixels, not screenshot/physical-pixel sampling. CSS zoom is separately reported because Blink quantizes border used widths; DPR does not change the 100% CSS width.'};
const contexts=[];
mkdirSync('output',{recursive:true});
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const rgb=value=>value.startsWith('#')?[1,3,5].map(index=>parseInt(value.slice(index,index+2),16)):(value.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
const properties=rows=>Object.fromEntries(rows.map(row=>[row.name,row.value]));
async function settle(page) {
  await frames(page);
  await page.evaluate(()=>Promise.all(document.querySelector('#hand').getAnimations({subtree:true}).filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{}))));
}
async function setup(dpr) {
  const context=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:dpr,reducedMotion:'no-preference'});contexts.push(context);
  await context.addInitScript(()=>{localStorage.setItem('queqi-settings',JSON.stringify({sound:false}));Object.defineProperty(Element.prototype,'requestFullscreen',{value:()=>Promise.reject(Error('surface fixture'))});});
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
  await page.locator('#room-name').fill(`牌面质感${dpr}x`);await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();
  for(const seat of [1,2,3])await page.locator(`.room-bot-add[data-seat="${seat}"]`).click();
  await page.locator('#room-ready').click();await page.locator('#room-start').click();
  await page.waitForFunction(()=>document.querySelector('#dice-intro').hidden&&!document.querySelector('#game').classList.contains('is-opening-deal'));
  await page.evaluate(()=>{window.mahjongRoom.destroy();const game=window.mahjongGame;game.players.forEach(player=>{player.hand=[0,9,18,27,31,32,33,1,2,3,4,5,6,7];player.discards=[0,9,18,27,31,32,33,1,2];player.redGangs=[];player.piziGangs=[];player.melds=[{kind:'peng',tiles:[20,20,20],from:1,concealed:false}];});game.current=0;game.phase={kind:'discard',seat:0};game.pendingDiscard=null;game.lastDiscard=null;game.lastDraw=null;game.actionNotice=null;game.events=['牌面质感与清晰度展示夹具'];window.renderMahjong();});
  await settle(page);return {context,page};
}
async function face(page,selector) {
  return page.locator(selector).first().evaluate(node=>{
    const s=getComputedStyle(node),b=getComputedStyle(node,'::before'),svg=node.querySelector('svg'),use=svg?.querySelector('use'),u=use&&getComputedStyle(use);
    return {palette:['--tile-face-light','--tile-face-base','--tile-ivory','--tile-face-shade'].map(name=>s.getPropertyValue(name).trim()),curve:s.getPropertyValue('--tile-model-face-curve').trim(),paint:b.backgroundImage,svgFilter:svg?getComputedStyle(svg).filter:null,filter:s.filter,backdrop:s.backdropFilter,use:use?{href:use.getAttribute('href'),stroke:u.stroke,width:u.strokeWidth,paintOrder:u.paintOrder}:null};
  });
}
async function artworkManifest(page) {
  const result=await page.evaluate(source=>{
    const parsed=new DOMParser().parseFromString(source,'image/svg+xml'),selector='path,circle,ellipse,rect,line,polyline,polygon';
    const manifest=root=>[...root.querySelectorAll(selector)].map(node=>({tag:node.localName,attributes:Object.fromEntries([...node.attributes].filter(attribute=>!['class','style'].includes(attribute.name)).map(attribute=>[attribute.name,attribute.value]))}));
    const expected=manifest(parsed),actual=manifest(document.querySelector('#tile-sprite'));
    const changed=actual.flatMap((node,index)=>JSON.stringify(node)===JSON.stringify(expected[index])?[]:[{index,tag:node.tag,attributes:Object.keys(node.attributes).filter(name=>node.attributes[name]!==expected[index]?.attributes[name])}]);
    return {same:expected.length===actual.length&&!changed.length,count:actual.length,changed:changed.slice(0,3)};
  },asset.toString('utf8'));
  assert.equal(result.same,true,'live sprite keeps every original geometry, transform, fill, stroke and stroke-width attribute: '+JSON.stringify(result));return result;
}
async function faces(page) {
  const result={};
  for(const [name,selector]of Object.entries({hand:'#hand .tile',river:'#river-0 .tile',meld:'#melds-0 .tile',wall:'#wall-tail .wall-piece.is-indicator.tile'}))result[name]=await face(page,selector);
  for(const [name,id,container,wrapper]of [['choice','choice-dialog','choice-options',true],['result','result-dialog','result-hand',false]]){
    await page.evaluate(({id,container,wrapper})=>{const root=document.getElementById(container);root.replaceChildren();const parent=wrapper?document.createElement('button'):root;if(wrapper){parent.className='choice-option';root.append(parent);}const tile=document.querySelector('#river-0 .tile').cloneNode(true);tile.removeAttribute('style');tile.className='tile';parent.append(tile);document.getElementById(id).showModal();},{id,container,wrapper});await frames(page);
    result[name]=await face(page,`#${container} .tile`);await page.evaluate(id=>document.getElementById(id).close(),id);
  }
  for(const [name,data]of Object.entries(result)){
    assert.deepEqual(data.palette.map(rgb),[[255,254,246],[246,239,221],[246,239,221],[232,223,201]],`${name} uses the shared ivory colors`);
    assert.match(data.curve,/^radial-gradient\(ellipse at 50% 44%/);assert.equal((data.paint.match(/radial-gradient/g)||[]).length,3);
    const alphas=[...data.curve.matchAll(/#([a-f\d]{8})\b/gi)].map(match=>parseInt(match[1].slice(6),16)/255);
    for(const match of data.curve.matchAll(/rgba\([^()]*,\s*([\d.]+)\)/g))alphas.push(Number(match[1]));
    assert.ok(alphas.length>=3&&alphas.every(alpha=>alpha>=0&&alpha<=.06),`${name} convex light is no stronger than 6%`);
    assert.deepEqual([data.filter,data.backdrop,data.svgFilter],['none','none','none']);assert.ok(data.use&&data.use.stroke!=='none');assert.equal(data.use.paintOrder,'normal','use must not override the artwork paint order');
  }
  return result;
}
async function glyphInstances(page) {
  const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
  const document=await cdp.send('DOM.getDocument',{depth:-1,pierce:true}),ids=await cdp.send('DOM.querySelectorAll',{nodeId:document.root.nodeId,selector:'#hand svg use:is([href="#tile-0"],[href="#tile-9"],[href="#tile-18"],[href="#tile-27"],[href="#tile-31"],[href="#tile-32"],[href="#tile-33"])'});
  assert.equal(ids.nodeIds.length,7,'instance sampling includes all three suits and wind/dragon/blank artwork');
  const records=[];
  const visit=(node,inherited={stroke:'none',width:1,paintOrder:'normal',fill:'black'})=>{
    const attributes=Object.fromEntries(Array.from({length:(node.attributes||[]).length/2},(_,index)=>[node.attributes[index*2],node.attributes[index*2+1]]));
    const source={stroke:attributes.stroke??inherited.stroke,width:attributes['stroke-width']==null?inherited.width:Number(attributes['stroke-width']),paintOrder:attributes['paint-order']??inherited.paintOrder,fill:attributes.fill??inherited.fill};
    return [{node,attributes,source},...(node.children||[]).flatMap(child=>visit(child,source)),...(node.shadowRoots||[]).flatMap(child=>visit(child,source))];
  };
  for(const id of ids.nodeIds){
    const {node}=await cdp.send('DOM.describeNode',{nodeId:id,depth:-1,pierce:true});
    assert.ok(node.shadowRoots?.length,'browser exposes the actual SVG use instance tree');
    for(const {node:child,attributes,source} of visit(node).filter(({node})=>['path','circle','ellipse','rect','line','polyline','polygon'].includes(node.localName))){
      const computed=properties((await cdp.send('CSS.getComputedStyleForNode',{nodeId:child.nodeId})).computedStyle);
      const {object}=await cdp.send('DOM.resolveNode',{nodeId:child.nodeId});
      const {result}=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){const m=this.getScreenCTM();return m?Math.max(Math.hypot(m.a,m.b),Math.hypot(m.c,m.d)):null;}',returnByValue:true});
      const scale=result.value;
      if(source.fill.startsWith('#'))assert.deepEqual(rgb(computed.fill),rgb(source.fill),'instance keeps the source artwork fill');
      if(source.stroke.startsWith('#'))assert.deepEqual(rgb(computed.stroke),rgb(source.stroke),'instance keeps its explicit or inherited original stroke color');
      assert.equal(computed['paint-order'],source.paintOrder,'instance keeps its original paint order');
      const original=source.stroke==='none'?0:source.width,width=parseFloat(computed['stroke-width']);
      if(source.stroke!=='none')assert.ok(width>original,'an originally stroked instance also receives the small contrast enhancement: '+JSON.stringify({kind:child.localName,original,width,stroke:computed.stroke,scale,style:attributes.style}));
      if(scale>0){const added=Math.max(0,width-original)*scale;assert.ok(added<=.5,`glyph enhancement stays below 0.5 screen CSS px: ${added}`);}
      records.push({kind:child.localName,stroke:computed.stroke,fill:computed.fill,sourceStroke:source.stroke,original,width,scale,added:scale>0?Math.max(0,width-original)*scale:null});
    }
  }
  assert.ok(records.length>10&&records.some(record=>record.width>record.original),'the actual instanced glyph geometry is enhanced');assert.ok(records.some(record=>record.kind==='circle')&&records.some(record=>record.kind==='path'),'sampling covers both round pips and outlined lettering');await cdp.detach();return records;
}
async function transitions(page) {
  const result={};
  for(const state of ['hover','selected','hinted']){
    await page.mouse.move(1,1);await page.evaluate(()=>{const tile=document.querySelector('#hand button');tile.classList.remove('selected','hinted');tile.disabled=false;});await settle(page);
    if(state==='hover')await page.locator('#hand button').first().hover();else await page.locator('#hand button').first().evaluate((node,state)=>node.classList.add(state),state);
    result[state]=await page.locator('#hand button').first().evaluate(node=>{const s=getComputedStyle(node),b=getComputedStyle(node,'::before');return {property:s.transitionProperty,duration:s.transitionDuration,easing:s.transitionTimingFunction,faceProperty:b.transitionProperty,faceDuration:b.transitionDuration,faceEasing:b.transitionTimingFunction};});await settle(page);
  }
  assert.deepEqual(result.hover,result.selected);assert.deepEqual(result.hover,result.hinted,'hover, selection and hint share duration and easing');
  assert.ok(result.hover.duration.split(',').every(value=>value.trim()==='0.12s'));assert.ok(!result.hover.property.split(',').some(value=>['box-shadow','all'].includes(value.trim())),'normal outer shadows must disappear without a dirty fade tail');
  assert.ok(result.hover.easing.includes('cubic-bezier(0.2, 0.7, 0.2, 1)'));
  assert.ok(result.hover.faceDuration.split(',').every(value=>value.trim()==='0s'),'static inset bevels must never interpolate on tile-metric or viewport changes');
  await page.mouse.move(1,1);await page.locator('#hand button').first().evaluate(node=>node.classList.remove('selected','hinted'));await settle(page);
  result.interpolation=[];
  for(const state of ['selected','hinted']){
    const sample=await page.locator('#hand button').first().evaluate((node,state)=>{
      node.classList.add(state);const properties=node.getAnimations().map(a=>a.transitionProperty);
      const active=getComputedStyle(node).boxShadow;node.classList.remove(state);
      return {state,properties,active,exit:getComputedStyle(node).boxShadow};
    },state);
    assert.ok(sample.properties.every(name=>['transform','opacity'].includes(name)),'paint properties never animate');
    assert.ok(!sample.active.includes('inset'),'interaction keeps external lighting');assert.ok(sample.exit.includes('inset'),'normal-state return removes outer shadows immediately');
    result.interpolation.push(sample);await settle(page);
  }

  return result;
}
async function borders(page,dpr) {
  const result=[];
  for(const zoom of [.8,1,1.25]){
    await page.evaluate(zoom=>document.documentElement.style.zoom=String(zoom),zoom);await frames(page);
    const rows=await page.evaluate(()=>['#river-0 .tile','#wall-tail .wall-piece.back','#backs-1 .back'].map(selector=>{const node=document.querySelector(selector),s=getComputedStyle(node),b=getComputedStyle(node,'::before');return {selector,dpr:devicePixelRatio,borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth].map(parseFloat),inner:parseFloat(b.borderTopWidth)};}));
    for(const row of rows){assert.equal(row.dpr,dpr);for(const width of [...row.borders,...(row.inner>0?[row.inner]:[])]){assert.ok(width>0);if(zoom===1)assert.equal(width,1);else assert.ok(Math.abs(width*zoom-1)<.01,'CSS zoom border quantization keeps an integer used line');}}
    result.push({zoom,rows});
  }
  await page.evaluate(()=>document.documentElement.style.zoom='');await frames(page);return result;
}
try {
  for(const dpr of [1,2,3]){
    const {context,page}=await setup(dpr);
    const row={dpr,originalArtwork:await artworkManifest(page),faces:await faces(page),transitions:await transitions(page),borders:await borders(page,dpr),glyphs:await glyphInstances(page)};
    report.cases.push(row);await context.close();
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
  console.log(JSON.stringify({passed:true,cases:report.cases.length,faces:report.cases.reduce((sum,row)=>sum+Object.keys(row.faces).length,0),glyphs:report.cases.reduce((sum,row)=>sum+row.glyphs.length,0),dpr:report.cases.map(row=>row.dpr),zoom:[.8,1,1.25],errors:report.errors,screenshots:0}));
} finally {
  writeFileSync('output/tile-surface-verification.json',JSON.stringify(report,null,2));await Promise.allSettled(contexts.map(context=>context.close()));await browser.close();service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
