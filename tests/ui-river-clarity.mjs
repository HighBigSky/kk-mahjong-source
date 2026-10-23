import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {RIVER_LAYOUT} from '../src/ui/river-layout.js';

const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const external=process.argv[2],service=external?null:new RoomService({botDelayMs:600000});
const server=external?null:createServer({roomService:service});
if(server){server.listen(0,'127.0.0.1');await once(server,'listening');}
const base=external||`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const report={passed:false,errors:[],cases:[],note:'Real isolated rooms; full rivers and claim snapshots are local presentation fixtures, no fabricated game actions sent.'};
mkdirSync('output',{recursive:true});
try {
  const sha=data=>createHash('sha256').update(data).digest('hex');
  for(const file of ['app.js','landscape.css']){const response=await fetch(`${base}/${file}`);assert.equal(response.status,200);assert.equal(sha(Buffer.from(await response.arrayBuffer())),sha(readFileSync(file)));}
  for(const size of [{width:640,height:360},{width:844,height:390},{width:1920,height:1080}]) {
    const context=await browser.newContext({viewport:size,deviceScaleFactor:size.width<1000?2:1,hasTouch:size.width<1000,isMobile:size.width<1000,reducedMotion:'reduce'});
    await context.addInitScript(()=>{
      localStorage.setItem('queqi-settings',JSON.stringify({sound:false}));
      Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:()=>Promise.reject(Error('test fallback'))});
      if(screen.orientation)Object.defineProperty(screen.orientation,'lock',{configurable:true,value:()=>Promise.reject(Error('test fallback'))});
    });
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto(base,{waitUntil:'networkidle'});await page.locator('#room-name').fill('牌河清晰度验收');await page.locator('#room-create').click();
    await page.waitForFunction(()=>window.mahjongRoom.status==='connected');
    for(const seat of [1,2,3])await page.locator(`.room-bot-add[data-seat="${seat}"]`).click();
    await page.locator('#room-ready').click();await page.locator('#room-start').click();await page.waitForFunction(()=>window.mahjongRoom.room?.status==='playing');
    if(await page.locator('#dice-intro').isVisible())await page.locator('#dice-intro').click();
    for(const dense of [false,true])for(const seat of [0,1,2,3]) {
      await page.evaluate(({dense,seat,capacity})=>{
        const game=window.mahjongGame;
        for(const player of game.players){player.hand=[4,4];player.melds=[];player.redGangs=[];player.piziGangs=[];player.discards=dense?Array.from({length:capacity},(_,i)=>i%27):[];}
        const cards=game.players[seat].discards;if(!dense)cards.push(22);
        const tile=cards.at(-1),index=cards.length-1;
        game.round++;game.actionNotice=null;game.result=null;game.winner=null;
        game.lastDiscard={tile,from:seat,index};game.pendingDiscard={tile,from:seat};game.phase={kind:'claim',discard:game.pendingDiscard};
        window.mahjongRoom.room.status='playing';window.renderMahjong();
      },{dense,seat,capacity:RIVER_LAYOUT.capacity});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const data=await page.evaluate(()=>{
        const holder=document.querySelector('#discard-focus'),focused=holder.querySelector('.tile'),original=document.querySelector('.river .tile.last-discard');
        const box=node=>{const r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,top:r.top,right:r.right,bottom:r.bottom};};
        const a=box(focused),b=box(original),style=getComputedStyle(original),face=getComputedStyle(original,'::before');
        return {scale:Number(holder.style.getPropertyValue('--discard-focus-scale')),visible:!holder.hidden,centerError:Math.hypot(a.x-b.x,a.y-b.y),pointer:getComputedStyle(holder).pointerEvents,
          inBounds:a.left>=0&&a.top>=0&&a.right<=innerWidth+1&&a.bottom<=innerHeight+1,
          riverCount:document.querySelectorAll('.river .tile').length,faceBackground:face.backgroundImage,shadow:style.boxShadow,
          vector:original.querySelector('svg use').getAttribute('href'),shape:getComputedStyle(original.querySelector('svg')).shapeRendering,
          aspects:[...document.querySelectorAll('.river .tile')].map(tile=>{const s=getComputedStyle(tile);return parseFloat(s.width)/parseFloat(s.height);}),
          canvasOverflow:document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1};
      });
      assert.equal(data.visible,true);assert.ok(data.scale>=1&&data.scale<=2.001);
      assert.ok(data.centerError<=1);assert.equal(data.pointer,'none');assert.equal(data.inBounds,true);assert.equal(data.canvasOverflow,false);
      assert.match(data.vector,/#tile-/);assert.equal(data.shape,'geometricprecision');
      assert.ok(data.aspects.every(value=>Math.abs(value-5/7)<.02));
      if(dense)assert.equal(data.riverCount,RIVER_LAYOUT.capacity*4);
      report.cases.push({size,dense,seat,...data});
      if(size.width===844&&seat===0)await page.screenshot({path:`output/river-clarity-${external?'online':'local'}-${dense?'full':'focus'}.png`});
    }
    await page.evaluate(()=>window.mahjongRoom.leave());await context.close();
  }
  assert.ok(report.cases.some(item=>!item.dense&&item.scale>=1.9),'空旷牌河实际可达到新的2倍放大');
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,cases:report.cases.length,scales:report.cases.map(item=>item.scale),errors:report.errors}));
} finally {
  writeFileSync(`output/river-clarity-${external?'online':'local'}.json`,JSON.stringify(report,null,2));await browser.close();service?.close();
  if(server){const closed=once(server,'close');server.close();server.closeAllConnections();await closed;}
}
