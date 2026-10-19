import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {MahjongGame} from '../engine.js';
import {assertInvariants, collectPhysicalTiles} from '../src/domain/invariants.js';
import {TILE, TILE_TYPE_COUNT, TOTAL_TILE_COUNT} from '../src/domain/tile.js';

let playwright;
try { playwright = createRequire(import.meta.url)('playwright'); }
catch { playwright = createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright'); }
const service = new RoomService({disconnectGraceMs:100});
const server = createServer({roomService:service});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const baseURL = `http://127.0.0.1:${server.address().port}`;
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await playwright.chromium.launch({headless:true, ...(existsSync(edge) ? {executablePath:edge} : {})});
const contexts = [], pages = [];
const output = path.resolve('output'); mkdirSync(output, {recursive:true});
const viewports = [{width:844,height:390}, {width:640,height:360}, {width:1920,height:1080}, {width:1440,height:900}];
const report = {passed:false, errors:[], scenarios:[], views:[], geometry:[], screenshots:[], lifecycle:[],
  fixtureNote:'Fixtures allocate exactly four copies of every face across all 136 physical tiles. Four genuine browser sessions perform create/join/ready/start, Hu, pass, next-round and exhausted-wall discard actions over HTTP/SSE. Prepared hands are explicit conserved fixtures, not naturally dealt complete rounds.'};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const redact = message => message.replace(/[a-f0-9]{48}/g, '[redacted]');
async function waitFor(test, label, timeout = 8000) {
  const end = Date.now() + timeout;
  while (!await test()) { assert.ok(Date.now() < end, `Timed out: ${label}`); await sleep(20); }
}
async function sync(room) {
  for (const page of pages) await waitFor(() => page.evaluate(version => window.mahjongRoom.room?.version >= version && !window.mahjongRoom.busy, room.version), 'four clients receive and render the server state');
}
async function player(name) {
  const context = await browser.newContext({viewport:viewports[0]}); contexts.push(context);
  await context.addInitScript(() => {
    try { localStorage.setItem('queqi-settings', JSON.stringify({sound:false, laizi:true, names:false})); }
    catch { /* The explicit about:blank reconnection has no storage origin. */ }
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(redact(error.message)));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(redact(message.text())); });
  await page.goto(baseURL, {waitUntil:'domcontentloaded'});
  await page.locator('#room-dialog[open]').waitFor();
  await page.locator('#room-name').fill(name);
  return page;
}
function conservation(game) {
  assertInvariants(game);
  const tiles = collectPhysicalTiles(game);
  assert.equal(tiles.length, TOTAL_TILE_COUNT);
  for (let code = 0; code < TILE_TYPE_COUNT; code++) assert.equal(tiles.filter(tile => tile === code).length, 4);
}
function fixture(room, scenario) {
  const game = new MahjongGame({seed:`reveal-fixture-${scenario.name}`, laizi:true, names:room.seats.map(seat => seat.name)});
  game.round = room.game.round + 1;
  game.indicatorTile = TILE.GREEN; game.wildTile = TILE.WHITE;
  game.wallInfo = {dice:[1,1], indicatorPosition:0, tailDraws:0};
  const pool = Array.from({length:TOTAL_TILE_COUNT}, (_, index) => Math.floor(index / 4));
  const take = tiles => tiles.map(code => {
    const index = pool.indexOf(code); assert.ok(index >= 0, `fixture physical copy ${code}`);
    return pool.splice(index, 1)[0];
  });
  take([game.indicatorTile]);
  for (const seat of game.players) {
    seat.hand = []; seat.melds = []; seat.redGangs = []; seat.piziGangs = []; seat.discards = [];
  }
  const hand = [...scenario.hand], discard = scenario.claim ? hand.pop() : null;
  const winner = scenario.winner, from = (winner + 3) % 4;
  game.players[winner].hand = take(hand);
  game.players[winner].melds = structuredClone(scenario.melds || []);
  take(game.players[winner].melds.flatMap(meld => meld.tiles));
  if (discard !== null) game.players[from].discards = take([discard]);
  for (let seat = 0; seat < 4; seat++) if (seat !== winner) game.players[seat].hand = pool.splice(0, 13);
  game.wall = pool;
  game.current = discard === null ? winner : from;
  game.pendingDiscard = discard === null ? null : {tile:discard, from};
  game.phase = discard === null ? {kind:'discard', seat:winner} : {kind:'claim', discard:game.pendingDiscard};
  game.lastDraw = discard === null ? {player:winner, tile:hand.at(-1), index:hand.length - 1, replacement:false} : null;
  game.result = null; game.winner = null; game.events = []; game._responses = Array(4).fill(null);
  conservation(game);
  return game;
}
async function publish(room, game) {
  conservation(game); room.game = game; service._changed(room); await sync(room);
}
async function closeResults() {
  for (const page of pages) {
    if (await page.locator('#result-dialog').evaluate(dialog => dialog.open)) await page.locator('#result-dialog [data-close]').click();
    assert.equal(await page.locator('#result-dialog').evaluate(dialog => dialog.open), false);
  }
}
async function assertViews(room, revealed, label) {
  conservation(room.game);
  for (let viewer = 0; viewer < 4; viewer++) {
    const page = pages[viewer];
    const actual = await page.evaluate(() => {
      const code = use => Number(use.getAttribute('href').split('-').at(-1));
      return {
        snapshot:window.mahjongGame.players.map(player => [...player.hand]),
        own:[...document.querySelectorAll('#hand button.tile')].map(tile => ({index:Number(tile.dataset.index), codes:[...tile.querySelectorAll('use')].map(code), disabled:tile.disabled})),
        others:[1,2,3].map(seat => {
          const rack = document.querySelector(`#backs-${seat}`);
          return {seat, revealed:rack.classList.contains('is-revealed'), backs:rack.querySelectorAll('.back').length,
            faces:[...rack.querySelectorAll('.tile')].map(tile => ({codes:[...tile.querySelectorAll('use')].map(code), name:tile.getAttribute('aria-label'), title:tile.title})), label:rack.getAttribute('aria-label')};
        }),
      };
    });
    const hands = Array.from({length:4}, (_, relative) => room.game.players[(viewer + relative) % 4].hand);
    assert.deepEqual(actual.snapshot, hands.map((hand, seat) => seat === 0 || revealed ? hand : hand.map(() => null)), `${label}: viewer ${viewer} receives exactly the permitted private/public hands`);
    assert.equal(actual.own.length, hands[0].length);
    assert.deepEqual(actual.own.map(tile => tile.index).sort((a,b) => a-b), hands[0].map((_, index) => index));
    for (const tile of actual.own) {
      assert.deepEqual(tile.codes, [hands[0][tile.index]], `${label}: own face matches the authoritative unsorted hand index`);
      if (room.game.phase.kind === 'ended') assert.equal(tile.disabled, true);
    }
    for (const rack of actual.others) {
      assert.equal(rack.revealed, revealed);
      assert.equal(rack.backs, revealed ? 0 : hands[rack.seat].length);
      assert.deepEqual(rack.faces.map(tile => tile.codes), revealed ? hands[rack.seat].map(code => [code]) : [], `${label}: opponent order and SVG face match the actual rotated hand`);
      assert.ok(rack.faces.every(tile => tile.name && tile.title), 'revealed faces preserve accessible names');
      assert.ok(rack.label.includes(revealed ? '已亮出手牌' : '暗牌'));
    }
    const response = await page.request.get(`${baseURL}/api/rooms/${room.code}/state`, {headers:{Authorization:`Bearer ${room.seats[viewer].token}`}});
    assert.equal(response.status(), 200);
    assert.deepEqual((await response.json()).state.players.map(player => player.hand), actual.snapshot, 'authenticated HTTP state and live SSE/render state agree');
    report.views.push({label, viewer, revealed, concealedCounts:hands.map(hand => hand.length), matchingSVG:true, HTTPAndSSE:true});
  }
}
async function finishHu(room, scenario) {
  const version = room.version;
  await pages[scenario.winner].locator('#action-hu:visible:enabled').click();
  await waitFor(() => room.version > version, 'real Hu click accepted'); await sync(room);
  for (let count = 0; room.game.phase.kind === 'claim' && count < 4; count++) {
    const responder = [0,1,2,3].find(seat => room.game.getActions(seat).pass);
    assert.notEqual(responder, undefined, 'unresolved claim has a real responder');
    const before = room.version;
    await pages[responder].locator('#action-pass:visible:enabled').click();
    await waitFor(() => room.version > before, 'real pass accepted'); await sync(room);
  }
  assert.equal(room.game.phase.kind, 'ended');
  assert.equal(room.game.result.kind, 'win');
  assert.equal(room.game.result.winner, scenario.winner);
  assert.equal(room.game.result.selfDraw, !scenario.claim);
  for (const page of pages) await page.locator('#result-dialog[open]').waitFor();
  await assertViews(room, true, `${scenario.name}: settlement`);
}
async function geometry(room, scenario) {
  for (const viewport of viewports) {
    for (let viewer = 0; viewer < 4; viewer++) {
      const page = pages[viewer]; await page.setViewportSize(viewport);
      const data = await page.evaluate(() => {
        const rect = element => { const r = element.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}; };
        const faces = [...document.querySelectorAll('#hand button.tile, .opponent-rack .backs .tile, [id^="melds-"] .tile')]
          .map((element, index) => ({...rect(element),index,seat:element.closest('.backs, .hand, .bot-melds, .my-melds').id,svg:rect(element.querySelector('svg'))}));
        const protectedAreas = [...document.querySelectorAll('#wall-tail .wall-piece:not(.is-empty), .river .tile, .opponent .portrait, #hint-btn, .action-zone:not([hidden]) button:not([hidden])')]
          .map((element,index) => ({...rect(element),name:element.closest('#wall-tail') ? `wall-${index}` : element.closest('.river') ? `river-${index}` : element.closest('.opponent') ? `avatar-${index}` : `button-${index}`}));
        const overlap = (left,right) => {
          const width = Math.min(left.right,right.right)-Math.max(left.left,right.left);
          const height = Math.min(left.bottom,right.bottom)-Math.max(left.top,right.top);
          return width > .5 && height > .5 ? {width,height} : null;
        };
        const faceOverlaps = faces.flatMap((tile,index) => faces.slice(index+1).flatMap(other => {
          const hit=overlap(tile,other); return hit ? [{first:tile.index,second:other.index,...hit}] : [];
        }));
        const obstruction = faces.flatMap(tile => protectedAreas.flatMap(area => {
          const hit=overlap(tile,area); return hit ? [{tile:tile.index,seat:tile.seat,area:area.name,...hit}] : [];
        }));
        return {faces,faceOverlaps,obstruction,game:rect(document.querySelector('#game')),width:document.body.scrollWidth};
      });
      const expected = room.game.players.reduce((sum,player) => sum+player.hand.length+player.melds.reduce((n,meld)=>n+meld.tiles.length,0)+player.redGangs.length+player.piziGangs.length,0);
      assert.equal(data.faces.length,expected);
      assert.ok(data.width <= viewport.width + 1);
      const inside = tile => tile.left >= data.game.left-1 && tile.right <= data.game.right+1 && tile.top >= data.game.top-1 && tile.bottom <= data.game.bottom+1 && tile.left >= -1 && tile.right <= viewport.width+1 && tile.top >= -1 && tile.bottom <= viewport.height+1;
      assert.ok(data.faces.every(inside), `all hands fit the game and viewport: ${JSON.stringify({scenario:scenario.name,viewport,viewer,data})}`);
      assert.ok(data.faces.every(tile => tile.svg.right-tile.svg.left > 1 && tile.svg.bottom-tile.svg.top > 1), 'every tile has a rendered readable SVG surface');
      assert.deepEqual(data.faceOverlaps,[],`hand faces do not overlap: ${JSON.stringify({scenario:scenario.name,viewport,viewer})}`);
      assert.deepEqual(data.obstruction,[],`hand faces avoid wall, river, avatars and buttons: ${JSON.stringify({scenario:scenario.name,viewport,viewer})}`);
      report.geometry.push({scenario:scenario.name,viewer,...viewport,faces:expected,inBounds:true,noOverlap:true});
      if (viewport.width===390) {
        const screenshot=path.join(output,`ui-reveal-${scenario.name}-seat${viewer}-390x844.png`);
        await page.screenshot({path:screenshot});report.screenshots.push(screenshot);
      }
    }
  }
}
async function nextRound(room,label) {
  // Reload genuinely restores the ended room and opens the normal result modal,
  // permitting a real owner click without exposing any test-only app controls.
  await pages[0].reload({waitUntil:'domcontentloaded'});
  await waitFor(() => pages[0].evaluate(() => window.mahjongRoom.status==='connected'), 'settlement refresh reconnects');
  await sync(room); await pages[0].locator('#result-dialog[open]').waitFor();
  await assertViews(room,true,`${label}: refresh`);
  const unchanged=JSON.stringify(room.game);
  await pages[3].goto('about:blank');
  await waitFor(() => !room.seats[3].connected,'departed client disconnects');
  await pages[3].goto(baseURL,{waitUntil:'domcontentloaded'});
  await waitFor(() => room.seats.every(seat=>seat.connected),'same browser identity reconnects');
  await sync(room); await pages[3].locator('#result-dialog[open]').waitFor();
  await assertViews(room,true,`${label}: reconnect`);
  assert.equal(JSON.stringify(room.game),unchanged,'refresh/reconnection do not mutate the settled game');
  const round=room.game.round,version=room.version;
  await pages[0].locator('#next-round:visible:enabled').click();
  await waitFor(()=>room.version>version&&room.game.round===round+1,'owner starts actual next round');await sync(room);
  assert.equal(room.game.phase.kind,'discard');
  await assertViews(room,false,`${label}: next round`);
  report.lifecycle.push({scenario:label,settlementRefresh:true,settlementReconnect:true,nextRoundPrivate:true});
}

const scenarios=[
  {name:'self-draw',winner:0,claim:false,hand:[0,1,2,9,10,11,18,19,20,24,25,26,4,4]},
  {name:'discard-win',winner:2,claim:true,melds:[{kind:'chi',tiles:[0,1,2],from:1,concealed:false}],hand:[9,10,11,18,19,20,24,25,26,4,4]},
];
try {
  pages.push(await player('亮牌甲'));await pages[0].locator('#room-create').click();
  await pages[0].locator('#room-waiting:not([hidden])').waitFor();
  const code=(await pages[0].locator('#room-current-code').textContent()).trim();
  for(const name of ['亮牌乙','亮牌丙','亮牌丁']) {
    const page=await player(name);pages.push(page);await page.locator('#room-code').fill(code);await page.locator('#room-join').click();
    await page.locator('#room-waiting:not([hidden])').waitFor();
  }
  const room=service.rooms.get(code);
  await waitFor(()=>room.seats.every(seat=>seat.connected),'all four SSE identities connected');
  for(const page of pages)await page.locator('#room-ready:enabled').click();
  await waitFor(()=>room.seats.every(seat=>seat.ready),'all four genuine ready commands');
  await pages[0].locator('#room-start:enabled').click();await waitFor(()=>room.game,'real room starts');await sync(room);
  await assertViews(room,false,'naturally dealt playing state');
  for(const scenario of scenarios) {
    await publish(room,fixture(room,scenario));await assertViews(room,false,`${scenario.name}: before Hu`);
    await finishHu(room,scenario);await closeResults();await geometry(room,scenario);
    report.scenarios.push({name:scenario.name,winner:scenario.winner,actualBrowserHu:true,fourHumanObservers:true,conservation:136});
    await nextRound(room,scenario.name);
  }
  // End an actually exhausted conserved wall through normal discard/pass
  // commands. Unused physical tiles are placed in explicit historical rivers.
  const drawn=fixture(room,scenarios[0]);
  const remaining=drawn.wall.splice(0);
  for(let index=0;index<remaining.length;index++)drawn.players[index%4].discards.push(remaining[index]);
  await publish(room,drawn);await assertViews(room,false,'exhausted wall before final discard');
  const index=room.game.players[0].hand.indexOf(0),version=room.version;
  const button=pages[0].locator(`#hand button[data-index="${index}"]`);await button.click();await button.click();
  await waitFor(()=>room.version>version,'last real discard accepted');await sync(room);
  for(let count=0;room.game.phase.kind==='claim'&&count<4;count++) {
    const seat=[0,1,2,3].find(seat=>room.game.getActions(seat).pass);assert.notEqual(seat,undefined);
    const before=room.version;await pages[seat].locator('#action-pass:visible:enabled').click();
    await waitFor(()=>room.version>before,'final pass accepted');await sync(room);
  }
  assert.equal(room.game.result.kind,'draw');
  await assertViews(room,false,'draw settlement retains concealed opponents');
  report.lifecycle.push({scenario:'draw',actualExhaustedWall:true,actualDiscard:true,actualPasses:true,opponentsStayPrivate:true});
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify(report,null,2));
} catch(error) {report.failure=redact(error.stack);throw error;}
finally {
  writeFileSync(path.join(output,'ui-reveal-hands.json'),JSON.stringify(report,null,2));
  await Promise.allSettled(contexts.map(context=>context.close()));await browser.close();service.close();
  const closed=once(server,'close');server.close();server.closeAllConnections();await closed;
}
