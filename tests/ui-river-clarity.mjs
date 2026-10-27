import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {RIVER_LAYOUT} from '../src/ui/river-layout.js';
import {execFileSync} from 'node:child_process';
import {readRiverGaps,assertRiverGaps} from './river-gap-checks.mjs';

const {chromium}=createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const external=process.argv[2],service=external?null:new RoomService({botDelayMs:600000});
const server=external?null:createServer({roomService:service});
if(server){server.listen(0,'127.0.0.1');await once(server,'listening');}
const base=external||`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const report={passed:false,errors:[],cases:[],spacing:[],screenshots:0,testRoomsLeft:0,note:'Real isolated rooms; full rivers and claim snapshots are local presentation fixtures, no fabricated game actions sent.'};
const contexts=[];
mkdirSync('output',{recursive:true});
try {
  const sha=data=>createHash('sha256').update(data).digest('hex');
  for(const file of ['app.js','landscape.css','src/ui/flat-opponents.js','src/ui/river-spacing.js']){const response=await fetch(`${base}/${file}`);assert.equal(response.status,200);assert.equal(sha(Buffer.from(await response.arrayBuffer())),sha(external?execFileSync('git',['show',`HEAD:${file}`]):readFileSync(file)));}
  for(const size of [{width:640,height:360},{width:844,height:390},{width:1920,height:1080}]) {
    const context=await browser.newContext({viewport:size,deviceScaleFactor:size.width<1000?2:1,hasTouch:size.width<1000,isMobile:size.width<1000,reducedMotion:'reduce'});
    contexts.push(context);
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
    await page.waitForFunction(()=>document.querySelector('#dice-intro').hidden);
    await page.waitForFunction(()=>!document.querySelector('#game').classList.contains('is-opening-deal'));
    const baseline=await page.evaluate(()=>{const hand=getComputedStyle(document.querySelector('#hand button')),probe=document.createElement('span');probe.className='tile';probe.style.cssText='position:absolute';document.querySelector('#river-0').append(probe);const s=getComputedStyle(probe),river=[parseFloat(s.width),parseFloat(s.height)];probe.remove();return {hand:[hand.width,hand.height],river};});
    await page.evaluate(()=>window.mahjongRoom.destroy());
    for(const count of [0,1,9,27,36]) {
      await page.evaluate(count=>{const game=window.mahjongGame;for(const [seat,player]of game.players.entries()){player.hand=Array.from({length:14},(_,i)=>i);player.melds=[];player.redGangs=[];player.piziGangs=[];player.discards=Array.from({length:count},(_,i)=>(seat*9+i)%34);}game.lastDraw=null;game.lastDiscard=null;game.pendingDiscard=null;game.actionNotice=null;game.phase={kind:'discard',seat:0};game.current=0;window.renderMahjong();},count);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const data=await readRiverGaps(page);report.spacing.push({size,count,...data});assertRiverGaps(data,count,baseline);
    }
    for(const dense of [false,true])for(const seat of [0,1,2,3]) {
      await page.evaluate(({dense,seat,capacity})=>{
        const game=window.mahjongGame;
        for(const player of game.players){player.hand=Array.from({length:14},(_,i)=>i);player.melds=[];player.redGangs=[];player.piziGangs=[];player.discards=dense?Array.from({length:capacity},(_,i)=>i%27):[];}
        const cards=game.players[seat].discards;if(!dense)cards.push(22);
        const tile=cards.at(-1),index=cards.length-1;
        game.actionNotice=null;game.result=null;game.winner=null;
        game.lastDiscard={tile,from:seat,index};game.pendingDiscard={tile,from:seat};game.phase={kind:'claim',discard:game.pendingDiscard};
        window.mahjongRoom.room.status='playing';window.renderMahjong();
      },{dense,seat,capacity:RIVER_LAYOUT.capacity});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const data=await page.evaluate(()=>{
        const holder=document.querySelector('#discard-focus'),focused=holder,original=document.querySelector('.river .tile.last-discard');
        const box=node=>{const r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,top:r.top,right:r.right,bottom:r.bottom};};
        const a=box(focused),b=box(original),style=getComputedStyle(original),face=getComputedStyle(original,'::before');
        return {copies:holder.querySelectorAll('.tile').length,marked:original.classList.contains('is-discard-focus'),sizeError:Math.max(...['left','right','top','bottom'].map(key=>Math.abs(a[key]-b[key]))),visible:!holder.hidden,centerError:Math.hypot(a.x-b.x,a.y-b.y),pointer:getComputedStyle(holder).pointerEvents,
          inBounds:a.left>=0&&a.top>=0&&a.right<=innerWidth+1&&a.bottom<=innerHeight+1,
          riverCount:document.querySelectorAll('.river .tile').length,faceBackground:face.backgroundImage,shadow:style.boxShadow,
          vector:original.querySelector('svg use').getAttribute('href'),shape:getComputedStyle(original.querySelector('svg')).shapeRendering,
          aspects:[...document.querySelectorAll('.river .tile')].map(tile=>{const s=getComputedStyle(tile);return parseFloat(s.width)/parseFloat(s.height);}),
          canvasOverflow:document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1};
      });
      assert.equal(data.visible,true);assert.equal(data.copies,0);assert.equal(data.marked,true);assert.ok(data.sizeError<1);
      assert.ok(data.centerError<=1);assert.equal(data.pointer,'none');assert.equal(data.inBounds,true);assert.equal(data.canvasOverflow,false);
      assert.match(data.vector,/#tile-/);assert.equal(data.shape,'geometricprecision');
      assert.ok(data.aspects.every(value=>Math.abs(value-5/7)<.02));
      if(dense)assert.equal(data.riverCount,RIVER_LAYOUT.capacity*4);
      report.cases.push({size,dense,seat,...data});
    }
    for(const seat of [0,1,2,3]){await page.locator('#river-'+seat).press('Enter');await page.locator('#history-dialog[open]').waitFor();assert.equal(await page.locator('#history-tiles .tile').count(),36);await page.locator('#history-dialog [data-close]').first().click();}
    assert.equal(await page.evaluate(()=>window.mahjongRoom.leave()),true);report.testRoomsLeft++;await context.close();
  }
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,spacing:report.spacing.length,focus:report.cases.length,screenshots:0,testRoomsLeft:report.testRoomsLeft,errors:report.errors}));
} finally {
  for(const context of contexts){for(const page of context.pages())try{await page.evaluate(()=>window.mahjongRoom?.leave());}catch{}await context.close();}
  writeFileSync(`output/river-clarity-${external?'online':'local'}.json`,JSON.stringify(report,null,2));await browser.close();service?.close();
  if(server){const closed=once(server,'close');server.close();server.closeAllConnections();await closed;}
}
