import assert from 'node:assert/strict';
import {installVisualGeometry} from './browser-geometry.mjs';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from '../server.js';
import { RoomService } from '../src/server/rooms.js';
import { MahjongGame } from '../engine.js';
import { assertInvariants, collectPhysicalTiles } from '../src/domain/invariants.js';
import { RED_DRAGON, TILE, TOTAL_TILE_COUNT } from '../src/domain/tile.js';

// Exercise a real isolated HTTP/SSE room with the locally installed runtime.
let playwright;
try { playwright = createRequire(import.meta.url)('playwright'); }
catch { playwright = createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright'); }
const service = new RoomService({ botDelayMs:100000, disconnectGraceMs:100 });
const server = createServer({roomService:service});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseURL = `http://127.0.0.1:${server.address().port}`;
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await playwright.chromium.launch({headless:true, ...(existsSync(edge) ? {executablePath:edge} : {})});
const contexts = [];
const output = path.resolve('output');
mkdirSync(output, {recursive:true});
const report = {baseURL, passed:false, checks:[], viewports:[], maximumMeldViewports:[], screenshots:[], errors:[], fixtures:{}, actualGang:null, actualDiscard:null, observers:[], endBoundary:[]};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const redact = value => value.replace(/[a-f0-9]{48}/g, '[redacted]');

async function waitFor(test, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (!await test()) {
    assert.ok(Date.now() < deadline, `Timed out: ${message}`);
    await sleep(20);
  }
}

async function synchronize(page, room) {
  const version = room.version;
  await waitFor(() => page.evaluate(version => window.mahjongRoom.room?.version >= version && !window.mahjongRoom.busy, version), 'room snapshot rendered through SSE');
}

async function createPlayingRoom(name, laizi) {
  const context = await browser.newContext({viewport:{width:844,height:390}});
  contexts.push(context);
  await context.addInitScript(laizi => {
    try { localStorage.setItem('queqi-settings', JSON.stringify({sound:false, names:false, laizi})); }
    catch { /* about:blank has no local storage origin. */ }
  }, laizi);
  const page = await context.newPage();
  await page.addInitScript(installVisualGeometry);
  page.on('pageerror', error => report.errors.push(redact(error.message)));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(redact(message.text())); });
  await page.goto(baseURL, {waitUntil:'domcontentloaded'});
  await page.locator('#room-dialog[open]').waitFor();
  await page.locator('#room-name').fill(name);
  // 建房 UI 固定开启翻痞；关闭模式仅通过现有客户端接口建立测试房。
  if (laizi) await page.locator('#room-create').click();
  else await page.evaluate(name => window.mahjongRoom.create(name, false), name);
  await page.locator('#room-waiting:not([hidden])').waitFor();
  const code = (await page.locator('#room-current-code').textContent()).trim();
  const room = service.rooms.get(code);
  await waitFor(() => room.seats[0].connected, 'owner SSE connected');
  for (const seat of [1, 2, 3]) {
    const version = room.version;
    await page.locator(`.room-bot-add[data-seat="${seat}"]:visible:enabled`).click();
    await waitFor(() => room.version > version && room.seats[seat]?.bot, `bot ${seat} joined`);
    await synchronize(page, room);
  }
  await page.locator('#room-ready:enabled').click();
  await waitFor(() => room.seats.every(seat => seat?.ready && seat.connected), 'all seats ready');
  await page.locator('#room-start:enabled').click();
  await waitFor(() => !!room.game, 'game started through actual room controls');
  await page.locator('#room-dialog:not([open])').waitFor({state:'attached'});
  await synchronize(page, room);
  assert.equal(room.laizi, laizi);
  assertInvariants(room.game);
  return {page, room};
}

function findGame(predicate, laizi = true) {
  for (let index = 0; index < 1000; index++) {
    const seed = `ui-wall-${index}`;
    const game = new MahjongGame({seed, laizi});
    if (predicate(game, seed)) return {game, seed};
  }
  assert.fail('A deterministic wall fixture must exist within 1000 seeds.');
}

async function publish(page, room, game) {
  assertInvariants(game);
  room.game = game;
  service._changed(room);
  await synchronize(page, room);
  await page.locator('#wall-tail:not([hidden])').waitFor();
  if(await page.locator('#dice-intro').isVisible())await page.locator('#dice-intro').click();
  await page.waitForFunction(()=>!document.querySelector('#game').classList.contains('is-opening-deal'));
  await page.evaluate(()=>window.renderMahjong());
}

function nextSlot(game) {
  return liveSlots(game)[0] ?? -1;
}

/** Independent physical-slot oracle; neither concealed tile codes nor UI data. */
function liveSlots(game) {
  const indicator = game.indicatorTile === null ? -1 : game.wallInfo.indicatorPosition;
  const available = Array.from({length:TOTAL_TILE_COUNT}, (_, slot) => slot).filter(slot => slot !== indicator);
  const start = game.wallInfo.tailDraws;
  const slots = available.slice(start, start + game.wall.length);
  if (indicator >= 0 && !game.indicatorTaken) slots.push(indicator);
  return slots.sort((a,b)=>a-b);
}

let observerRoom;
async function assertFourObserverSnapshots(game, label) {
  if (!observerRoom) {
    const create = await fetch(`${baseURL}/api/rooms`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:'观察者一', laizi:true})});
    assert.equal(create.status, 201);
    const envelope = await create.json();
    observerRoom = {room:service.rooms.get(envelope.room.code), tokens:[envelope.token]};
    for (const name of ['观察者二', '观察者三', '观察者四']) {
      const join = await fetch(`${baseURL}/api/rooms/${observerRoom.room.code}/join`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})});
      assert.equal(join.status, 201);
      observerRoom.tokens.push((await join.json()).token);
    }
  }
  // This extra room is a privacy/count fixture; genuine actions run in the UI room.
  observerRoom.room.game = game;
  service._changed(observerRoom.room);
  const snapshots = await Promise.all(observerRoom.tokens.map(async token => {
    const response = await fetch(`${baseURL}/api/rooms/${observerRoom.room.code}/state`, {headers:{Authorization:`Bearer ${token}`}});
    assert.equal(response.status, 200);
    return response.json();
  }));
  for (const snapshot of snapshots) {
    assert.equal(snapshot.state.wallCount, game.wall.length);
    assert.deepEqual(snapshot.state.wallInfo, game.wallInfo);
    assert.equal(snapshot.state.indicatorTile, game.indicatorTile);
    assert.ok(snapshot.state.players[0].hand.every(Number.isInteger));
    assert.ok(snapshot.state.players.slice(1).every(player => player.hand.every(tile => tile === null)));
    assert.equal(Object.hasOwn(snapshot.state, 'wall'), false);
    assert.ok(!JSON.stringify(snapshot).includes('"token"'));
  }
  report.observers.push({label, counts:snapshots.map(snapshot => snapshot.state.wallCount), indicatorPosition:game.wallInfo.indicatorPosition});
}

async function wallState(page) {
  return page.evaluate(() => {
    const wall = document.querySelector('#wall-tail');
    return {
      label:wall.getAttribute('aria-label'),
      removedLabels:document.querySelectorAll('.meld-label,.wall-stack-number,.wall-tail-meta,.wall-indicator-position,#table-labels .table-label-meld,#table-labels .table-label-wall,#table-labels .table-label-marker').length,
      wallTitles:wall.querySelectorAll('[title]').length+(wall.hasAttribute('title')?1:0),
      badges:[...wall.querySelectorAll('.is-next,.is-head')].map(stack=>getComputedStyle(stack,'::before').content),
      directionLabels:document.querySelectorAll('#table-labels .table-label-direction').length,
      arrows:[...wall.querySelectorAll('.is-next,.is-head')].map(stack=>getComputedStyle(stack,'::after').content),
      faces:[...wall.querySelectorAll('svg use')].map(use => use.getAttribute('href').slice(use.getAttribute('href').indexOf('#'))),
      backs:wall.querySelectorAll('.wall-piece.back').length,
      empty:wall.querySelectorAll('.wall-piece.is-empty').length,
      next:[...wall.querySelectorAll('.is-next-piece')].map(piece => Number(piece.dataset.position)),
      head:[...wall.querySelectorAll('.is-head-piece')].map(piece => Number(piece.dataset.position)),
      indicator:[...wall.querySelectorAll('.is-indicator')].map(piece => Number(piece.dataset.position)),
      stacks:[...wall.querySelectorAll('.wall-stack')].map(stack => Number(stack.dataset.stack)),
      slots:[...wall.querySelectorAll('.wall-piece')].map(piece => Number(piece.dataset.position)),
      sides:Object.fromEntries(['bottom', 'right', 'top', 'left'].map(side => [side, wall.querySelectorAll(`.wall-stack[data-side="${side}"]`).length])),
      count:Number(wall.querySelector('.wall-tail-count strong')?.textContent),
      centerCount:Number(document.querySelector('#wall-count').textContent),
      publicWallKeys:Object.keys(window.mahjongRoom.game.wall),
      wallInfoKeys:Object.keys(window.mahjongRoom.game.wallInfo).sort(),
      ownHandVisible:window.mahjongRoom.game.players[0].hand.every(Number.isInteger),
      opponentHandsHidden:window.mahjongRoom.game.players.slice(1).every(player => player.hand.every(tile => tile === null)),
    };
  });
}

function assertPublicWall(state, game) {
  assert.equal(state.removedLabels,0);
  assert.equal(state.wallTitles,0);
  assert.ok(state.badges.every(value=>value==='none'));
  assert.equal(state.directionLabels,4);
  assert.ok(state.arrows.every(value=>value==='""'));
  assert.deepEqual(state.faces, game.indicatorTile === null || game.indicatorTaken ? [] : [`#tile-${game.indicatorTile}`], 'Only the untaken public indicator may have a visible SVG face.');
  assert.deepEqual(state.publicWallKeys, ['length'], 'The client must receive a count, never the concealed wall array.');
  assert.deepEqual(state.wallInfoKeys, ['dice', 'indicatorPosition', 'tailDraws']);
  assert.equal(state.ownHandVisible, true);
  assert.equal(state.opponentHandsHidden, true);
  assert.deepEqual(state.stacks.toSorted((a, b) => a - b), Array.from({length:68}, (_, index) => index + 1), 'All 68 fixed stacks must remain mounted.');
  assert.deepEqual(state.slots.toSorted((a, b) => a - b), Array.from({length:TOTAL_TILE_COUNT}, (_, index) => index), 'Each physical slot appears once.');
  assert.deepEqual(state.sides, {bottom:17, right:17, top:17, left:17});
  assert.equal(state.backs, game.wall.length, 'One visible back per live wall tile.');
  assert.equal(state.count, game.wall.length, 'The wall caption uses the server count.');
  assert.equal(state.centerCount, game.wall.length, 'The central live count agrees with the wall.');
  assert.deepEqual(state.indicator, game.indicatorTile === null || game.indicatorTaken ? [] : [game.wallInfo.indicatorPosition]);
  assert.equal(state.empty, TOTAL_TILE_COUNT - game.wall.length - state.indicator.length);
  const live = liveSlots(game);
  assert.deepEqual(state.next, live.length ? [live[0]] : []);
  assert.deepEqual(state.head, live.length ? [live.at(-1)] : []);
}

async function screenshot(page, name) {
  if (process.env.KK_UI_SCREENSHOTS === '0') return;
  const filename = path.join(output, name);
  await page.screenshot({path:filename});
  report.screenshots.push(filename);
}

/** Fixture only: perform real engine draws, then retain each real tile in its river. */
function drawIntoRiver(game, player, replacement) {
  const wasTaken = game.indicatorTaken;
  assert.equal(game._drawTile(player, replacement), true);
  const tile = game.lastDraw.tile;
  const hand = game.players[player].hand;
  const index = hand.lastIndexOf(tile);
  assert.ok(index >= 0);
  const destination = !wasTaken && game.indicatorTaken ? game.players[player].piziGangs : game.players[player].discards;
  destination.push(hand.splice(index, 1)[0]);
  game.lastDraw = null;
  assertInvariants(game);
}

/** Display fixture only: allocate real copies from a fresh complete tile pool. */
function maximumMeldFixture(seed) {
  const game = new MahjongGame({seed, laizi:true});
  const pool = Array.from({length:TOTAL_TILE_COUNT}, (_, index) => Math.floor(index / 4));
  pool.splice(pool.indexOf(game.indicatorTile), 1);
  for (const player of game.players) {
    player.hand = [];
    player.melds = [];
    player.redGangs = [];
    player.discards = [];
  }
  const gangCodes = Array.from({length:34}, (_, code) => code).filter(code => code !== game.indicatorTile && code !== RED_DRAGON).slice(0, 12);
  let group = 0;
  for (const player of [1, 2, 3]) {
    for (let index = 0; index < 4; index++) {
      const code = gangCodes[group++];
      const tiles = [];
      for (let copy = 0; copy < 4; copy++) {
        const position = pool.indexOf(code);
        assert.ok(position >= 0);
        tiles.push(pool.splice(position, 1)[0]);
      }
      game.players[player].melds.push({kind:'gang', tiles, from:0, concealed:false});
    }
  }
  for (let player = 0; player < 4; player++) game.players[player].hand = pool.splice(0, player === 0 ? 14 : 1);
  for (let player = 0; player < 4; player++) game.players[player].discards = pool.splice(0, player === 0 || player === 2 ? 12 : 8);
  game.wall = pool;
  game.wallInfo.tailDraws = 0;
  game.current = 0;
  game.phase = {kind:'discard', seat:0};
  game.pendingDiscard = null;
  game.lastDraw = null;
  assert.equal(game.wall.length, 30);
  assertInvariants(game);
  return game;
}

try {
  const {page, room} = await createPlayingRoom('牌墙验收', true);
  const normal = findGame(game => game.wallInfo.indicatorPosition > 0 && game.getActions(0).redGang);
  await publish(page, room, normal.game);
  const initial = await wallState(page);
  assertPublicWall(initial, room.game);
  assert.equal(initial.stacks.length, 68);
  assert.equal(initial.backs, 82);
  const expectedStack = Math.min(...room.game.wallInfo.dice);
  assert.equal(room.game.wallInfo.indicatorPosition, (expectedStack - 1) * 2);
  assert.match(initial.label, new RegExp(`第 ${expectedStack} 墩上面一张`));
  report.fixtures.normal = {seed:normal.seed, dice:room.game.wallInfo.dice, indicatorPosition:room.game.wallInfo.indicatorPosition};
  report.checks.push('A real room displays all 68 fixed stacks / 136 slots, 17 stacks per side, exactly 82 live backs, synchronized caption/center counts, and one indicator at the smaller-die upper slot.');
  await assertFourObserverSnapshots(room.game, 'initial');

  const existingFace = await page.locator('#wall-tail .is-indicator svg').elementHandle();
  for (let repeat = 0; repeat < 3; repeat++) {
    service._changed(room);
    await synchronize(page, room);
    assert.equal(await page.evaluate(face => face === document.querySelector('#wall-tail .is-indicator svg'), existingFace), true);
  }
  report.checks.push('Three repeated real SSE snapshots retain the exact same indicator SVG instance.');

  const before = {tailDraws:room.game.wallInfo.tailDraws, wallCount:room.game.wall.length, tailTile:room.game.wall[0], redGangs:room.game.players[0].redGangs.length};
  const version = room.version;
  await page.locator('#action-gang:visible:enabled').click();
  await waitFor(async () => room.version > version || await page.locator('#choice-dialog').evaluate(dialog => dialog.open), 'gang command or choice dialog');
  if (await page.locator('#choice-dialog').evaluate(dialog => dialog.open)) await page.locator('#choice-options button').filter({has:page.locator('use[href$="#tile-31"]')}).click();
  await waitFor(() => room.version > version, 'real gang accepted by server');
  await synchronize(page, room);
  assert.equal(room.game.wallInfo.tailDraws, before.tailDraws + 1);
  assert.equal(room.game.wall.length, before.wallCount - 1);
  assert.equal(room.game.lastDraw.tile, before.tailTile);
  assert.equal(room.game.lastDraw.replacement, true);
  assert.equal(room.game.players[0].redGangs.length, before.redGangs + 1);
  assertInvariants(room.game);
  const afterGang = await wallState(page);
  assertPublicWall(afterGang, room.game);
  assert.equal(afterGang.backs, initial.backs - 1);
  assert.deepEqual(afterGang.indicator, initial.indicator);
  assert.ok(afterGang.empty >= 1);
  assert.equal(await page.evaluate(face => face === document.querySelector('#wall-tail .is-indicator svg'), existingFace), true);
  report.actualGang = {tailDrawsBefore:before.tailDraws, tailDrawsAfter:room.game.wallInfo.tailDraws, drawnActualTail:room.game.lastDraw.tile === before.tailTile, nextPhysicalSlot:afterGang.next[0]};
  report.checks.push('An actual browser red-dragon kong removes wall[0], adds one tailDraw, leaves the old slot empty, and advances the gold arrow without remounting the indicator.');
  await screenshot(page, 'ui-wall-real-gang-390x844.png');
  await assertFourObserverSnapshots(room.game, 'actual browser redGang');

  // One genuine browser discard, followed by legal pass responses if any seat
  // can claim. This is a real legal sequence, unlike the later display fixtures.
  const beforeDiscard = {count:room.game.wall.length, tailDraws:room.game.wallInfo.tailDraws, headTile:room.game.wall.at(-1), indicator:room.game.wallInfo.indicatorPosition};
  const discardIndex = room.game.players[0].hand.findIndex(tile => tile !== RED_DRAGON && tile !== room.game.indicatorTile);
  assert.ok(discardIndex >= 0);
  const discardVersion = room.version;
  await page.locator(`#hand button[data-index="${discardIndex}"]`).click();
  await page.locator(`#hand button[data-index="${discardIndex}"]`).click();
  await waitFor(() => room.version > discardVersion, 'real browser discard accepted');
  await synchronize(page, room);
  assertPublicWall(await wallState(page), room.game);
  let legalPasses = 0;
  while (room.game.phase.kind === 'claim') {
    const player = [0, 1, 2, 3].find(player => room.game.getActions(player).pass);
    assert.notEqual(player, undefined, 'Every pending legal response must be addressable.');
    assert.equal(room.game.applyAction(player, {kind:'pass', player}), true);
    legalPasses++;
    service._changed(room);
    await synchronize(page, room);
    assertPublicWall(await wallState(page), room.game);
  }
  assert.equal(room.game.wall.length, beforeDiscard.count - 1);
  assert.equal(room.game.wallInfo.tailDraws, beforeDiscard.tailDraws);
  assert.equal(room.game.lastDraw.tile, beforeDiscard.headTile);
  assert.equal(room.game.lastDraw.replacement, false);
  assertInvariants(room.game);
  const afterDiscard = await wallState(page);
  assertPublicWall(afterDiscard, room.game);
  assert.equal(afterDiscard.backs, afterGang.backs - 1);
  assert.deepEqual(afterDiscard.indicator, initial.indicator);
  assert.equal(await page.evaluate(face => face === document.querySelector('#wall-tail .is-indicator svg'), existingFace), true);
  report.actualDiscard = {wallBefore:beforeDiscard.count, wallAfter:room.game.wall.length, drawnActualHead:room.game.lastDraw.tile === beforeDiscard.headTile, legalPasses, nextHeadSlot:afterDiscard.head[0], nextTailSlot:afterDiscard.next[0]};
  report.checks.push('A real browser discard plus any legal pass responses draws exactly one wall-head tile, removes exactly one back, keeps the indicator in place, and leaves tailDraws unchanged.');
  await assertFourObserverSnapshots(room.game, 'actual browser discard and legal passes');

  const maximum = maximumMeldFixture(normal.seed);
  await publish(page, room, maximum);
  assertPublicWall(await wallState(page), maximum);
  report.fixtures.maximumMelds = {description:'Display fixture only: each opponent has four real four-copy gang groups and one concealed tile; self has fourteen tiles, all rivers reach their visible caps, and the original indicator is owned once.', physicalTiles:collectPhysicalTiles(maximum).length, remaining:maximum.wall.length};
  for (const viewport of [{width:640,height:360}, {width:844,height:390}, {width:1920,height:1080}, {width:1440, height:900}]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const geometry = await page.evaluate(() => {
      const rect = element => {
        const r = element.getBoundingClientRect();
        return {left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height,quad:window.visualGeometry.quad(element)};
      };
      const melds = [...document.querySelectorAll('.bot-melds .tile')].map((tile, index) => ({...rect(tile), index}));
      const targets = [...document.querySelectorAll('.river .tile, #wall-tail .wall-piece:not(.is-empty), .opponent .portrait, .backs .back, #hand')].map((element, index) => ({...rect(element), name:element.closest('.river') ? `river ${index}` : element.closest('#wall-tail') ? `wall ${element.dataset.position}` : element.closest('.opponent') ? `portrait ${element.closest('.opponent').id}` : element.closest('.backs') ? `concealed ${element.closest('.backs').id}` : 'hand'}));
      const overlaps = melds.flatMap(meld => targets.flatMap(target => {
        const width = Math.min(meld.right, target.right) - Math.max(meld.left, target.left);
        const height = Math.min(meld.bottom, target.bottom) - Math.max(meld.top, target.top);
        return window.visualGeometry.intersects(meld.quad,target.quad) ? [{meld:meld.index, target:target.name, width, height}] : [];
      }));
      return {melds, overlaps, groups:[1, 2, 3].map(player => document.querySelector(`#melds-${player}`).children.length), opponentBacks:[1, 2, 3].map(player => document.querySelector(`#backs-${player}`).children.length), pageWidth:document.body.scrollWidth};
    });
    assert.deepEqual(geometry.groups, [4, 4, 4]);
    assert.deepEqual(geometry.opponentBacks, [1, 1, 1]);
    assert.equal(geometry.melds.length, 48);
    assert.ok(geometry.pageWidth <= viewport.width + 1);
    assert.ok(geometry.melds.every(tile => tile.left >= -1 && tile.right <= viewport.width + 1 && tile.top >= -1 && tile.bottom <= viewport.height + 1), `All maximum-meld tiles must remain on screen at ${viewport.width}×${viewport.height}: ${JSON.stringify(geometry.melds.filter(tile => tile.left < -1 || tile.right > viewport.width + 1 || tile.top < -1 || tile.bottom > viewport.height + 1))}`);
    assert.deepEqual(geometry.overlaps, [], `Four gangs per opponent must not cover portraits, live walls, full rivers, concealed backs or self hand at ${viewport.width}×${viewport.height}.`);
    report.maximumMeldViewports.push({...viewport, visibleMeldTiles:geometry.melds.length, noOverlap:true});
    if (viewport.width === 390) await screenshot(page, 'ui-wall-maximum-melds-390x844.png');
  }
  report.checks.push('A separate 136-tile display fixture renders four gangs per opponent, one opponent concealed tile and full rivers; all 48 meld tiles remain on screen and avoid portraits, wall pieces, rivers, concealed backs and the self hand at all four viewports.');

  // Late-wall display fixture, not a claim that twenty supplement draws form a
  // legal complete game: every draw is real, and every physical tile is retained.
  const late = new MahjongGame({seed:normal.seed, laizi:true});
  for (let draw = 0; late.wallInfo.tailDraws < 20; draw++) drawIntoRiver(late, draw % 4, true);
  assert.equal(late.indicatorTaken, true);
  for (let player = 0; player < 4; player++) {
    const limit = player === 0 || player === 2 ? 12 : 8;
    while (late.players[player].discards.length < limit) drawIntoRiver(late, player, false);
  }
  assert.equal(late.wallInfo.tailDraws, 20);
  assert.equal(collectPhysicalTiles(late).length, TOTAL_TILE_COUNT);
  await publish(page, room, late);
  const lateState = await wallState(page);
  assertPublicWall(lateState, late);
  assert.ok(lateState.stacks.includes(expectedStack), 'Original indicator stack remains mounted among all 68 fixed stacks.');
  assert.ok(lateState.stacks.includes(Math.floor(nextSlot(late) / 2) + 1), 'Current supplement stack remains visible after twenty draws.');
  assert.ok(lateState.empty > 0);
  report.fixtures.late = {description:'Twenty engine replacement draws retained as real river tiles; ordinary engine draws fill four rivers to their visible caps.', tailDraws:20, totalPhysicalTiles:collectPhysicalTiles(late).length, nextPhysicalSlot:nextSlot(late), visibleStacks:lateState.stacks};
  for (const viewport of [{width:640,height:360}, {width:844,height:390}, {width:1920,height:1080}, {width:1440, height:900}]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const geometry = await page.evaluate(() => {
      const rect = target => {
        const r = (typeof target === 'string' ? document.querySelector(target) : target).getBoundingClientRect();
        return {left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height,quad:window.visualGeometry.quad(typeof target === 'string' ? document.querySelector(target) : target)};
      };
      const protectedAreas = [...document.querySelectorAll('.river .tile')].map((tile, index) => ({...rect(tile), name:`river tile ${index}`}));
      protectedAreas.push({...rect('.table-center'), name:'compass'}, ...[...document.querySelectorAll('#hand button')].map(node=>({...rect(node),name:'hand tile'})));
      const pieces = [...document.querySelectorAll('#wall-tail .wall-piece:not(.is-empty)')].map(piece => ({...rect(piece), slot:Number(piece.dataset.position)}));
      const overlaps = pieces.flatMap(piece => protectedAreas.flatMap(area => {
        const width = Math.min(piece.right, area.right) - Math.max(piece.left, area.left);
        const height = Math.min(piece.bottom, area.bottom) - Math.max(piece.top, area.top);
        return window.visualGeometry.intersects(piece.quad,area.quad) ? [{slot:piece.slot, target:area.name, width, height}] : [];
      }));
      return {game:rect('.game'), table:rect('.table'), hand:rect('#hand'), stacks:[...document.querySelectorAll('.wall-stack')].map(rect), pieces, overlaps, pageWidth:document.body.scrollWidth};
    });
    assert.ok(geometry.pageWidth <= viewport.width + 1);
    assert.equal(geometry.stacks.length, 68);
    assert.ok(geometry.stacks.every(stack => stack.left >= geometry.table.left - 1 && stack.right <= geometry.table.right + 1 && stack.top >= geometry.table.top - 1 && stack.bottom <= geometry.table.bottom + 1), 'All 68 stack boxes must fit inside the tabletop.');
    assert.ok(geometry.pieces.every(piece => piece.left >= geometry.table.left - 1 && piece.right <= geometry.table.right + 1 && piece.top >= geometry.table.top - 1 && piece.bottom <= geometry.table.bottom + 1), 'Every visible wall tile must fit inside the tabletop.');
    assert.deepEqual(geometry.overlaps, [], `No visible wall piece may cover any river tile, compass or hand at ${viewport.width}×${viewport.height}.`);
    assert.ok(geometry.hand.left >= geometry.game.left - 1 && geometry.hand.right <= geometry.game.right + 1);
    assertPublicWall(await wallState(page), late);
    report.viewports.push({...viewport, noOverlap:true, allFixedStacksInsideTable:geometry.stacks.length, visiblePiecesChecked:geometry.pieces.length, nextPhysicalSlot:lateState.next[0]});
    await screenshot(page, `ui-wall-late-${viewport.width}x${viewport.height}.png`);
  }
  report.checks.push('The late-wall fixture preserves all 68 stack boxes inside the table; every live back and indicator avoids every visible river tile, compass and hand at 640×360, 844×390, 1920×1080 and 1440×900.');

  // End-of-wall fixture only: retain each drawn physical tile in a river.
  // Alternate head and tail on the final two draws to exercise the converging
  // markers without presenting the synthetic sequence as a legal whole game.
  const boundary = new MahjongGame({seed:normal.seed, laizi:true});
  while (boundary.wall.length > 2) drawIntoRiver(boundary, boundary.wall.length % 4, false);
  if (!boundary.indicatorTaken) drawIntoRiver(boundary, 0, false);
  assert.equal(boundary.indicatorTaken, true);
  await page.setViewportSize({width:844,height:390});
  for (const remaining of [2, 1, 0]) {
    await publish(page, room, boundary);
    const state = await wallState(page);
    assertPublicWall(state, boundary);
    assert.equal(state.backs, remaining);
    assert.deepEqual(state.indicator, [], 'the original exposed slot is now empty');
    if (remaining === 1) assert.deepEqual(state.head, state.next, 'The final live tile is both the head and tail.');
    if (remaining === 0) { assert.deepEqual(state.head, []); assert.deepEqual(state.next, []); }
    assert.equal(collectPhysicalTiles(boundary).length, TOTAL_TILE_COUNT);
    await assertFourObserverSnapshots(boundary, `boundary ${remaining}`);
    report.endBoundary.push({remaining, head:state.head, tail:state.next, indicator:state.indicator, totalPhysicalTiles:collectPhysicalTiles(boundary).length});
    if (remaining > 0) drawIntoRiver(boundary, 0, remaining === 1);
  }
  await screenshot(page, 'ui-wall-empty-390x844.png');
  report.checks.push('A conservation-checked display fixture takes the exposed tile then reaches 2→1→0: the original indicator slot is empty, the last back carries both markers, and the physically empty wall carries neither marker.');

  const redReveal = findGame((game, seed) => {
    const unflipped = new MahjongGame({seed, laizi:false});
    return unflipped.wall[(Math.min(...unflipped.wallInfo.dice) - 1) * 2] === RED_DRAGON;
  });
  assert.equal(redReveal.game.indicatorTile, TILE.WHITE);
  assert.equal(redReveal.game.wildTile, TILE.GREEN);
  await page.setViewportSize({width:844,height:390});
  await publish(page, room, redReveal.game);
  const redState = await wallState(page);
  assertPublicWall(redState, redReveal.game);
  assert.deepEqual(redState.faces, ['#tile-33']);
  report.fixtures.redReveal = {seed:redReveal.seed, actualOriginalReveal:RED_DRAGON, indicatorTile:redReveal.game.indicatorTile, wildTile:redReveal.game.wildTile, position:redReveal.game.wallInfo.indicatorPosition};
  report.checks.push('A seed whose actual original reveal is a red dragon shows a white indicator at that same physical slot and green dragon as wildcard.');
  await screenshot(page, 'ui-wall-white-exception-390x844.png');

  const disabled = await createPlayingRoom('不开癞子', false);
  const disabledState = await wallState(disabled.page);
  assertPublicWall(disabledState, disabled.room.game);
  assert.equal(disabledState.backs, 83);
  assert.equal(disabledState.empty, 53);
  assert.equal(await disabled.page.locator('#laizi-summary').isHidden(), true);
  report.checks.push('A second real room created with laizi disabled shows all 68 stacks with 83 live backs, 53 consumed slots, no indicator face, and synchronized counts. Neither mode exposes hidden wall tiles or opponents’ hands.');
  await screenshot(disabled.page, 'ui-wall-no-laizi-390x844.png');
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = error.stack;
  throw error;
} finally {
  writeFileSync(path.join(output, 'ui-wall.json'), JSON.stringify(report, null, 2));
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser.close();
  service.close();
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
}
