import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {installVisualGeometry} from './browser-geometry.mjs';

// 固定本轮基线；只比较真实DOM，不截图，也不把材质改动误当成几何例外。
const BASELINE='5bbe071';
const sheets=['styles.css','table-depth.css','tiles-depth.css','seats-layout.css','laizi.css','landscape.css'];
const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const service=new RoomService({botDelayMs:600000}),server=createServer({roomService:service});
server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const context=await browser.newContext({viewport:{width:640,height:360},reducedMotion:'reduce'});
await context.addInitScript(()=>{localStorage.setItem('queqi-settings',JSON.stringify({sound:false}));Object.defineProperty(Element.prototype,'requestFullscreen',{value:()=>Promise.reject(Error('fixed light fixture'))});});
await context.addInitScript(installVisualGeometry);
for(const file of [...sheets,'src/ui/tile-material.js'])await context.route(`**/${file}?scene-baseline=*`,route=>route.fulfill({body:execFileSync('git',['show',`${BASELINE}:${file}`]),contentType:file.endsWith('.js')?'text/javascript':'text/css'}));
const page=await context.newPage(),target=process.env.KK_UI_TARGET_URL||`http://127.0.0.1:${server.address().port}`;
const report={passed:false,baseline:BASELINE,browser:browser.version(),cases:[],errors:[],screenshots:0,note:'Computed gradients, analytic sRGB luminance bounds and exact DOM geometry. No screenshots/pixel sampling; touch/DPR are browser emulation.'};
page.on('pageerror',error=>report.errors.push(error.message));mkdirSync('output',{recursive:true});
const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const split=value=>{if(value==='none')return [];let depth=0,start=0;const list=[];for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;else if(value[i]===')')depth--;else if(value[i]===','&&!depth){list.push(value.slice(start,i).trim());start=i+1;}}list.push(value.slice(start).trim());return list;};
const rgb=value=>value.trim().startsWith('#')?[1,3,5].map(i=>parseInt(value.trim().slice(i,i+2),16)):(value.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
const luminance=rgb=>rgb.slice(0,3).map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
async function load(baseline) {
  await page.evaluate(({sheets,baseline})=>Promise.all(sheets.map(file=>new Promise((resolve,reject)=>{const link=[...document.querySelectorAll('link[rel=stylesheet]')].find(node=>new URL(node.href).pathname.endsWith('/'+file));link.onload=resolve;link.onerror=reject;link.href='/'+file+'?scene-'+(baseline?'baseline':'current')+'='+Date.now();}))),{sheets,baseline});
  await page.evaluate(async baseline=>{const module=await import('/src/ui/tile-material.js?scene-'+(baseline?'baseline':'current')+'=1');for(const node of document.querySelectorAll('.tile,.back'))module.syncTileMetric(node);},baseline);
  await frames();
}
async function snapshot() {
  return page.evaluate(()=>{
    const properties=['position','display','width','height','padding','margin','gap','border-width','border-radius','box-sizing','top','right','bottom','left','transform','transform-origin','transform-style','clip-path','z-index','overflow','pointer-events'];
    const shape=s=>Object.fromEntries(properties.map(name=>[name,s.getPropertyValue(name)]));
    const nodes=[...document.querySelectorAll('#game,#game *')].filter(n=>n.getClientRects().length&&!n.closest('.icon-defs,#tile-sprite'));
    const geometry=nodes.map(n=>{const r=n.getBoundingClientRect();return {name:n.id||n.className?.baseVal||String(n.className),rect:[r.x,r.y,r.width,r.height],shape:shape(getComputedStyle(n)),pseudos:['::before','::after'].map(p=>shape(getComputedStyle(n,p)))};});
    const style=(node,pseudo)=>{const s=getComputedStyle(node,pseudo);return {background:s.backgroundImage,shadow:s.boxShadow,filter:s.filter,backdrop:s.backdropFilter,transition:s.transitionProperty};};
    const surfaces=Object.fromEntries([['table','.table','::before'],['felt','.table-border'],['scene','#game'],['environment','#game','::before'],['center','.table-center'],['dice','.table-die'],['seat','.player-seat'],['hud','.wallet-pill'],['button','.action-button:not(:disabled)']].map(([name,selector,pseudo])=>[name,style(document.querySelector(selector),pseudo)]));
    const tiles=[...document.querySelectorAll('.tile,.back')].filter(n=>!n.closest('#opening-deal'));
    const paints=tiles.map(n=>({name:n.id||n.parentElement.id||n.className,grade:getComputedStyle(n).getPropertyValue('--tile-model-grade').trim(),layers:[style(n),style(n,'::before'),style(n,'::after'),...(n.querySelector('svg')?[style(n.querySelector('svg'))]:[])]}));
    const lightSelectors=[...Array.from({length:4},(_,i)=>`#river-${i} .tile`),...Array.from({length:4},(_,i)=>`#melds-${i} .tile`),...Array.from({length:3},(_,i)=>`#backs-${i+1} .back`),'#hand .tile','.wall-stack[data-side="top"] .back','.wall-stack[data-side="bottom"] .back','.wall-stack[data-side="left"] .back','.wall-stack[data-side="right"] .back'];
    const globalLights=lightSelectors.map(selector=>{
      const n=document.querySelector(selector);if(!n)return {selector,empty:true}; // 发牌后整段牌墙可能已空。
      const s=getComputedStyle(n),angle=parseFloat(s.getPropertyValue('--tile-model-turn'))*Math.PI/180,c=Math.cos(angle),sin=Math.sin(angle);
      const rotate=(x,y)=>[x*c-y*sin,x*sin+y*c],shadow=rotate(Number(s.getPropertyValue('--tile-model-shadow-x')),Number(s.getPropertyValue('--tile-model-shadow-y')));
      const quad=window.visualGeometry.quad(n),point=(x,y)=>({x:quad[0].x*(1-x)*(1-y)+quad[1].x*x*(1-y)+quad[2].x*x*y+quad[3].x*(1-x)*y,y:quad[0].y*(1-x)*(1-y)+quad[1].y*x*(1-y)+quad[2].y*x*y+quad[3].y*(1-x)*y});
      const shine=point(parseFloat(s.getPropertyValue('--tile-model-shine-x'))/100,parseFloat(s.getPropertyValue('--tile-model-shine-y'))/100),center=point(.5,.5);
      return {selector,turn:angle*180/Math.PI,shadow,shine:[shine.x-center.x,shine.y-center.y],face:s.getPropertyValue('--tile-face')};
    });
    const root=getComputedStyle(document.documentElement),tile=getComputedStyle(document.querySelector('#hand .tile'));
    const filters=[...document.querySelectorAll('*')].flatMap(n=>['', '::before','::after',...(n.matches('dialog')?['::backdrop']:[])].map(p=>({name:n.id||n.className,p,filter:getComputedStyle(n,p||null).filter,backdrop:getComputedStyle(n,p||null).backdropFilter}))).filter(s=>s.filter!=='none'||s.backdrop!=='none');
    const transitions=nodes.map(n=>getComputedStyle(n).transitionProperty).filter(v=>v!=='all'&&v!=='none');
    return {geometry,surfaces,paints,globalLights,filters,transitions,palette:{ivory:tile.getPropertyValue('--tile-ivory').trim(),faceShade:tile.getPropertyValue('--tile-face-normal-shade').trim(),felt:root.getPropertyValue('--felt-base').trim(),feltLight:root.getPropertyValue('--felt-light').trim(),outside:'#202921',highlight:root.getPropertyValue('--scene-light-ink').trim()},light:[root.getPropertyValue('--scene-light-angle'),root.getPropertyValue('--scene-light-x'),root.getPropertyValue('--scene-light-y')]};
  });
}
try {
  await page.goto(target,{waitUntil:'networkidle'});await page.locator('#room-name').fill('右侧单灯验收');await page.locator('#room-create').click();await page.locator('#room-waiting:not([hidden])').waitFor();
  for(const seat of [1,2,3])await page.locator(`.room-bot-add[data-seat="${seat}"]`).click();
  await page.locator('#room-ready').click();await page.locator('#room-start').click();await page.waitForFunction(()=>window.mahjongRoom.room?.status==='playing'&&document.querySelector('#game').classList.contains('is-landscape'));await page.locator('#room-dialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('#dice-intro').hidden&&!document.querySelector('#game').classList.contains('is-opening-deal'));
  await page.evaluate(()=>{window.mahjongRoom.destroy();window.mahjongRoom.availableActions=()=>({chi:[],peng:false,gang:false,hu:false,pass:false,redGang:false,piziGang:false,wildGang:false,concealedGangs:[],addedGangs:[]});const game=window.mahjongGame;game.players.forEach((p,i)=>{p.hand=Array.from({length:i?10:14},(_,n)=>n);p.discards=Array.from({length:36},(_,n)=>(n+i*9)%34);p.redGangs=[];p.piziGangs=[];p.melds=[{kind:'peng',tiles:[20,20,20],from:1,concealed:false},{kind:'gang',tiles:[21,21,21,21],from:1,concealed:false}];});game.current=0;game.phase={kind:'discard',seat:0};game.pendingDiscard=null;game.lastDiscard=null;game.lastDraw=null;game.actionNotice=null;game.events=['光照展示夹具'];window.renderMahjong();document.querySelector('.action-zone').hidden=false;for(const id of ['action-gang','action-peng','action-pass']){const n=document.getElementById(id);n.hidden=false;n.disabled=false;}});await frames();
  for(const size of [{width:640,height:360},{width:844,height:390},{width:1920,height:1080}]) {
    await page.setViewportSize(size);await frames();await load(true);const before=await snapshot();await load(false);const after=await snapshot();
    assert.deepEqual(after.geometry,before.geometry,'all visible scene/tile/HUD/button rectangles and pseudo-element geometry stay exactly unchanged: '+JSON.stringify(size));
    assert.deepEqual(after.filters,[],'global scene has no filters/backdrop filters');
    assert.ok(after.transitions.every(list=>list.split(',').every(property=>['opacity','transform','background-color'].includes(property.trim()))),'UI only transitions transform, opacity or background-color');
    for(const tile of after.paints)for(const layer of tile.layers)assert.ok(split(layer.shadow).length<=2,`${tile.name}: tile and each existing drawing layer have at most two shadows`);
    assert.ok(after.globalLights.filter(light=>!light.empty).length>=14);
    for(const light of after.globalLights.filter(light=>!light.empty)){assert.ok(light.shine[0]>0&&light.shine[1]<0,`${light.selector} highlights are at the global right`);assert.ok(Math.abs(light.shadow[0]+1)<1e-6&&Math.abs(light.shadow[1]-.25)<1e-6,'all rotations project left at the same slope');}
    assert.equal(split(after.surfaces.table.background).length,8);
    for(const name of ['table','felt','scene','environment','center','dice','seat','hud','button']) {
      const surface=after.surfaces[name];assert.ok(split(surface.background).length<=8);
      assert.ok(/(?:92% 32%|255deg)/.test(surface.background),name+' highlights follow the right-side lamp');
      for(const shadow of split(surface.shadow).filter(s=>!s.includes('inset'))){const px=[...shadow.matchAll(/(-?[\d.]+)px/g)].map(m=>Number(m[1]));assert.ok(px[0]<=0,name+' has no rightward cast shadow');}
    }
    const palette=Object.fromEntries(Object.entries(after.palette).map(([key,value])=>[key,rgb(value)]));
    const levels={face:luminance(palette.ivory),felt:luminance(palette.felt),background:luminance(palette.outside)};
    assert.ok(levels.face>levels.felt&&levels.felt>levels.background);
    // 最亮绒布再加20%暖白反射的保守估值，覆盖织纹、布光和压槽内缘反光。
    const feltBound=palette.feltLight.map((c,i)=>c*.8+palette.highlight[i]*.2);
    const minContrast=contrast(palette.faceShade,feltBound);assert.ok(minContrast>=3,'darkest ivory face / conservatively bright felt >=3:1');
    const hand=await page.locator('#hand .tile').first().evaluate(n=>({turn:getComputedStyle(n).getPropertyValue('--tile-model-turn'),face:getComputedStyle(n,'::before').backgroundImage,top:getComputedStyle(n).getPropertyValue('--tile-model-plane-lit')}));
    assert.match(hand.face,/linear-gradient\(255deg, rgb\(255, 254, 246\)/,'right end of face is the bright end');assert.match(hand.top,/#fffef9/);
    report.cases.push({size,rectangles:after.geometry.length,exactGeometry:true,light:after.light,globalLights:after.globalLights,maxTileShadowLayers:Math.max(...after.paints.flatMap(t=>t.layers.map(s=>split(s.shadow).length))),tiles:after.paints.length,backgroundLayers:8,levels,minContrast,surfaces:after.surfaces});
  }
  await page.emulateMedia({reducedMotion:'no-preference'});
  const interactive=[];
  for(const state of ['selected','hinted','is-discard-focus']){
    const data=await page.evaluate(async state=>{
      const n=document.querySelector(state==='is-discard-focus'?'#river-1 .tile':'#hand .tile');n.classList.add(state);
      const properties=n.getAnimations().map(a=>a.transitionProperty).filter(Boolean);
      await Promise.all(n.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
      const style=getComputedStyle(n),active={shadow:style.boxShadow,outline:style.outlineWidth,transition:style.transitionProperty};n.classList.remove(state);
      return {state,properties,active,resting:getComputedStyle(n).boxShadow};
    },state);
    assert.ok(data.properties.every(p=>['transform','opacity'].includes(p)));
    assert.ok(data.active.transition.split(',').every(p=>['transform','opacity'].includes(p.trim())));
    assert.ok(split(data.active.shadow).length<=2&&split(data.active.shadow).some(s=>!s.includes('inset')));
    assert.ok(split(data.resting).every(s=>s.includes('inset')),'interaction shadows disappear immediately');interactive.push(data);
  }
  report.interactive=interactive;
  const moving=await snapshot();assert.ok(moving.transitions.every(list=>list.split(',').every(p=>['transform','opacity','background-color'].includes(p.trim()))));
  // 样式表与现有WAAPI只允许transform/opacity；不以reduced-motion掩盖动画属性问题。
  const animationProperties=await page.evaluate(()=>{
    const violations=[];const walk=rules=>{for(const rule of rules){if(rule.type===CSSRule.KEYFRAMES_RULE)for(const frame of rule.cssRules)for(const name of frame.style)if(!['transform','opacity'].includes(name))violations.push(name);else{}if(rule.cssRules&&rule.type!==CSSRule.KEYFRAMES_RULE)walk(rule.cssRules);}};for(const sheet of document.styleSheets)walk(sheet.cssRules);return violations;
  });assert.deepEqual(animationProperties,[]);
  const animationSource=readFileSync('src/ui/opening-deal.js','utf8');assert.doesNotMatch(animationSource,/\{\s*(?:filter|background|width|height|boxShadow)\s*:/);
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,cases:report.cases.length,rectangles:report.cases.reduce((n,c)=>n+c.rectangles,0),minimumContrast:Math.min(...report.cases.map(c=>c.minContrast)),maxTileShadowLayers:2,screenshots:0}));
} catch(error){report.failure=error.stack;throw error;} finally {
  if(process.env.KK_UI_TARGET_URL)try{report.testRoomLeft=await page.evaluate(()=>window.mahjongRoom.leave());}catch(error){report.cleanupError=error.message;}
  writeFileSync(process.env.KK_UI_TARGET_URL?'output/scene-light-online.json':'output/scene-light-verification.json',JSON.stringify(report,null,2));await browser.close();service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
