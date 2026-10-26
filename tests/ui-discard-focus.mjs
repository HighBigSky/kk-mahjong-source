import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from '../server.js';
import { RoomService } from '../src/server/rooms.js';
import { MahjongGame, isSpecialGangTile } from '../engine.js';
import { assertInvariants, collectPhysicalTiles } from '../src/domain/invariants.js';
import { actionFixture, scattered } from './pizi-fixtures.mjs';
import {installVisualGeometry} from './browser-geometry.mjs';
import {riverCell} from '../src/ui/river-layout.js';

// Keep browser dependencies outside the zero-dependency application.
let playwright;
for (const location of [import.meta.url, 'C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json', path.join(process.env.TEMP || '', 'pwtest', 'package.json')]) {
  try { playwright = createRequire(location)('playwright'); break; }
  catch { try { playwright = createRequire(location)('playwright-core'); break; } catch { /* Try the next runtime. */ } }
}
assert.ok(playwright, 'An installed Playwright runtime is required');
const viewports = [
  { width: 640, height: 360 }, { width: 844, height: 390 },
  { width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 },
];
const output = path.resolve('output');
mkdirSync(output, { recursive: true });
const report = { passed: false, browser: '', checks: [], geometry: [], screenshots: [], errors: [], fixtureNote: 'Four independent real Edge sessions use actual HTTP commands and SSE snapshots. Explicit action fixtures conserve all 136 tiles and begin before a genuine browser discard; they are not naturally dealt whole rounds.' };
const service = new RoomService({ disconnectGraceMs: 100, botDelayMs: 60000 });
const server = createServer({ roomService: service });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseURL = `http://127.0.0.1:${server.address().port}`;
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await playwright.chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) });
report.browser = browser.version();
const contexts = [], pages = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const redact = value => value.replace(/[a-f0-9]{48}/g, '[redacted]');
async function until(test, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (!await test()) { assert.ok(Date.now() < end, `Timed out: ${label}`); await sleep(15); }
}
async function frames(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function sync(room) {
  await Promise.all(pages.map(page => until(() => page.evaluate(version => window.mahjongRoom?.room?.version >= version && !window.mahjongRoom.busy && window.mahjongRoom.status === 'connected', room.version), 'four connected SSE renders')));
  await Promise.all(pages.map(frames));
  await assertRiverSlots(room,true);
}
async function assertRiverSlots(room,skipOpening=false) {
  for(const [viewer,page]of pages.entries()){
    if(skipOpening&&await page.evaluate(()=>document.querySelector('#game').classList.contains('is-opening-deal')||!document.querySelector('#dice-intro').hidden))continue;
    const actual=await page.evaluate(()=>[0,1,2,3].map(seat=>[...document.querySelectorAll(`#river-${seat} .tile`)].map(tile=>({type:Number(tile.querySelector('use').getAttribute('href').split('-').at(-1)),column:Number(tile.style.gridColumn),row:Number(tile.style.gridRow)}))));
    const expected=['bottom','right','top','left'].map((side,relative)=>room.game.players[(viewer+relative)%4].discards.map((type,index)=>({type,...riverCell(index,side)})));
    assert.deepEqual(actual,expected,'every live/claimed/compacted river has one real card in each chronological explicit cell');
    assert.equal(await page.locator('#discard-focus .tile').count(),0,'live snapshots never create a focus face copy');
  }
}
async function dismissOverlays() {
  for (const page of pages) {
    if (await page.locator('#dice-intro').isVisible()) await page.locator('#dice-intro').click();
    const close = page.locator('dialog[open]:not(#room-dialog) [data-close]').first();
    if (await close.isVisible()) await close.click();
  }
}
async function player(name) {
  const context = await browser.newContext({ viewport: viewports[0], hasTouch: true, deviceScaleFactor: 1 });
  contexts.push(context);
  await context.addInitScript(() => {
    localStorage.setItem('queqi-settings', JSON.stringify({ sound: false, laizi: true, names: false }));
    window.__discardFlightAnimations = [];
    const nativeAnimate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = nativeAnimate.call(this, keyframes, options);
      if (this.classList.contains('discard-flight')) {
        const record = { keyframes: structuredClone(keyframes), duration: typeof options === 'number' ? options : options?.duration, finished: false, canceled: false };
        window.__discardFlightAnimations.push(record);
        animation.finished.then(() => { record.finished = true; }, () => { record.canceled = true; });
      }
      return animation;
    };
    if (screen.orientation) Object.defineProperty(screen.orientation, 'lock', { configurable: true, value: () => Promise.reject(new DOMException('Headless orientation fallback', 'NotSupportedError')) });
    Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: () => Promise.reject(new DOMException('Headless fullscreen fallback', 'NotSupportedError')) });
  });
  const page = await context.newPage();
  await page.addInitScript(installVisualGeometry);
  page.on('pageerror', error => report.errors.push(redact(error.message)));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(redact(message.text())); });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('#room-dialog[open]').waitFor();
  await page.locator('#room-name').fill(name);
  return page;
}
function physical(game) {
  assertInvariants(game);
  assert.equal(collectPhysicalTiles(game).length, 136);
}
async function publish(room, game) {
  game.round = room.game.round + 1;
  physical(game);
  room.game = game;
  service._changed(room);
  await sync(room);
  await dismissOverlays();
}
// Build a pre-discard state with one deliberate response and otherwise diverse
// hands. A second responder allows a real pass/submitted claim to remain pending.
function beforeDiscard(names, kind = 'none', { competition = false, filled = false } = {}) {
  const tile = { none: 30, chi: 1, peng: 27, gang: 28, hu: 27 }[kind];
  const hand = kind === 'chi' ? [0, 2, ...scattered.filter(value => value !== 0 && value !== 2).slice(0, 11)]
    : kind === 'peng' ? [27, 27, ...scattered.slice(0, 11)]
    : kind === 'gang' ? [28, 28, 28, ...scattered.slice(0, 10)]
    : kind === 'hu' ? [0, 0, 2, 2, 3, 3, 5, 5, 6, 6, 8, 8, 27] : [...scattered];
  // 东在此夹具中必须是普通可打牌；采用发作痞、白作癞，避免双击东触发癞子杠。
  const game = actionFixture({ names, hand: [...scattered, 24], indicator:32 });
  const counts = Array(34).fill(4);
  counts[game.indicatorTile]--;
  const take = value => { assert.ok(counts[value] > 0, `physical fixture copy ${value}`); counts[value]--; return value; };
  for (const seat of game.players) { seat.hand = []; seat.discards = []; seat.melds = []; seat.redGangs = []; seat.piziGangs = []; }
  game.players[0].hand = hand.map(take);
  game.players[3].hand = [take(tile)];
  if (competition) game.players[1].hand = [take(tile), take(tile)];
  const candidates = [...scattered, ...Array.from({ length: 34 }, (_, value) => value)].filter(value => value !== tile && !isSpecialGangTile(value, game.indicatorTile));
  for (const seat of [1, 2, 3]) {
    const target = seat === 3 ? 14 : 13;
    for (const value of candidates) {
      if (game.players[seat].hand.length === target) break;
      if (counts[value] && !game.players[seat].hand.includes(value)) game.players[seat].hand.push(take(value));
    }
    assert.equal(game.players[seat].hand.length, target);
  }
  for (const seat of game.players) seat.hand.sort((a, b) => a - b);
  game.wall = counts.flatMap((count, value) => Array(count).fill(value));
  if (filled) for (const seat of game.players) seat.discards = game.wall.splice(0, 12);
  game.current = 3; game.phase = { kind: 'discard', seat: 3 };
  game.lastDraw = { player: 3, tile, index: game.players[3].hand.indexOf(tile), replacement: false };
  game.pendingDiscard = null; game.lastDiscard = null; game.events = []; game._responses = Array(4).fill(null);
  physical(game);
  return { game, tile };
}
async function focusRows() {
  return Promise.all(pages.map(page => page.locator('#discard-focus').evaluate(element => ({ hidden: element.hidden, key: element.dataset.key, player: Number(element.dataset.player), tile: Number(element.dataset.tile), tileCount: element.querySelectorAll('.tile').length, pointerEvents: getComputedStyle(element).pointerEvents }))));
}
async function focusGeometry(page) {
  return page.evaluate(() => {
    const holder = document.querySelector('#discard-focus'), player = Number(holder.dataset.player);
    const focus = holder, original = document.querySelector(`#river-${player} .is-discard-focus`);
    if (holder.hidden || !focus || !original) return null;
    const box = element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const highlighted = box(focus), river = box(original);
    const a=window.visualGeometry.quad(focus),b=window.visualGeometry.quad(original);
    return {player, highlighted, river, centerError:Math.hypot(highlighted.x-river.x,highlighted.y-river.y),
      widthError:Math.abs(highlighted.width-river.width),heightError:Math.abs(highlighted.height-river.height),
      cornerError:Math.max(...a.map((p,i)=>Math.hypot(p.x-b[i].x,p.y-b[i].y))),
      animations:holder.getAnimations({subtree:true}).length,pointerEvents:getComputedStyle(holder).pointerEvents};
  });
}
async function assertLocalFocus(page,label){
  const row=await focusGeometry(page);
  assert.ok(row,label+': highlight and original are visible');
  assert.ok(row.widthError<1&&row.heightError<1&&row.cornerError<1,label+': same physical size, position and orientation '+JSON.stringify(row));
  assert.equal(row.animations,0,label+': static highlight has no scale or flight animation');
  assert.equal(row.pointerEvents,'none');
  return row;
}

async function expanded(from, tile, label) {
  await until(async () => (await focusRows()).every(row => !row.hidden), `${label}: four highlighted views`);
  // 直接量取当前帧，不等待动画结束；入场帧同样必须与实牌等大。
  const rows = await focusRows();
  for (let viewer = 0; viewer < 4; viewer++) {
    assert.equal(rows[viewer].player, (from - viewer + 4) % 4, `${label}: relative player ${viewer}`);
    assert.equal(rows[viewer].tile, tile, `${label}: correct tile ${viewer}`);
    assert.ok(rows[viewer].key, `${label}: stable discard identity ${viewer}`);
    assert.equal(rows[viewer].tileCount, 0, `${label}: no duplicate tile in focus anchor ${viewer}`);
    assert.equal(await pages[viewer].locator('.river .is-discard-focus').count(),1,`${label}: exactly one real tile highlighted`);
    assert.equal(rows[viewer].pointerEvents, 'none', `${label}: overlay does not block controls`);
    await assertLocalFocus(pages[viewer], `${label}: viewer ${viewer}`);
  }
  return rows;
}
async function settled(label) {
  await until(async () => (await focusRows()).every(row => row.hidden), `${label}: all views return tile to river`);
  for(const page of pages)assert.equal(await page.locator('.river .is-discard-focus').count(),0,'retirement removes the real-tile glow');
}
async function discard(room, from, tile) {
  const page = pages[from], version = room.version;
  const index = room.game.players[from].hand.indexOf(tile);
  assert.ok(index >= 0, `seat ${from} owns discarded tile ${tile}`);
  const button = page.locator(`#hand button[data-index="${index}"]`);
  await button.click();
  await button.click();
  await until(() => room.version > version, 'real browser discard accepted');
  await sync(room);
  physical(room.game);
  assert.deepEqual(room.game.lastDiscard, { from, tile, index: room.game.players[from].discards.length - 1 });
  const shown=await expanded(from, tile, 'real browser discard');
  await assertRiverSlots(room);
  return shown;
}
async function operation(room, actor, kind) {
  const version = room.version, page = pages[actor];
  await page.locator(`#action-${kind}:visible:enabled`).click();
  if (await page.locator('#choice-dialog').evaluate(element => element.open)) await page.locator('#choice-options button').first().click();
  await until(() => room.version > version, `actual ${kind} request accepted`);
  await sync(room);
  physical(room.game);
}
async function finishPasses(room) {
  for (let count = 0; room.game.phase.kind === 'claim' && count < 4; count++) {
    const actor = gameResponder(room.game);
    assert.ok(actor >= 0, 'pending response has a player who can pass');
    await operation(room, actor, 'pass');
  }
  assert.notEqual(room.game.phase.kind, 'claim');
}
const gameResponder = game => game.players.findIndex((_, seat) => game.getActions(seat).pass);
async function replay(room) {
  for (let viewer = 0; viewer < 4; viewer++) for (const stream of room.seats[viewer].streams) service._write(stream, service.snapshot(room, viewer));
  await sync(room);
}
async function animationCounts() {
  return Promise.all(pages.map(page => page.evaluate(() => window.__discardFlightAnimations.length)));
}
async function shrinkEvidence(room,before,from,tile){
  assert.deepEqual(await animationCounts(),before,'retirement creates no flying or scaling tile');
  for(const [viewer,page]of pages.entries()){
    assert.equal(await page.locator('.discard-flight').count(),0);
    assert.equal(await page.locator('#discard-focus').evaluate(n=>n.hidden),true);
    const relative=(from-viewer+4)%4;
    assert.equal(await page.locator('#river-'+relative+' .last-discard').count(),1,'pass preserves physical discard');
  }
  physical(room.game);return {staticRetirement:true,noFlight:true,originalRiverTilePreserved:true};
}
async function lifecycle(room, names) {
  const first = beforeDiscard(names);
  await publish(room, first.game);
  const shown = await discard(room, 3, first.tile);
  assert.equal(room.game.pendingDiscard, null, 'no-claim discard automatically draws in the same operation');
  assert.equal(room.game.current, 0);
  await replay(room);
  for (const page of pages) await page.evaluate(() => { for (let count = 0; count < 5; count++) window.renderMahjong(); });
  assert.deepEqual(await focusRows(), shown, 'duplicate HTTP/SSE and unchanged render preserve the focus');
  for (const enabled of [true, false]) {
    const response = await pages[0].request.post(`${baseURL}/api/rooms/${room.code}/voice`, { headers: { Authorization: `Bearer ${room.seats[0].token}` }, data: { enabled } });
    assert.equal(response.status(), 200);
    await sync(room);
    await expanded(3, first.tile, 'voice metadata keeps focus');
  }
  // A real reload closes/reopens SSE. The other three views must not interpret
  // that transport change as a game command, and the refreshed view does not
  // replay a resolved response window merely because lastDiscard persists.
  await pages[2].reload({ waitUntil: 'domcontentloaded' });
  await sync(room); await dismissOverlays();
  const restored = await focusRows();
  assert.equal(restored[2].hidden, true, 'refresh does not replay a resolved historical discard');
  for (const viewer of [0, 1, 3]) assert.equal(restored[viewer].hidden, false, 'another player reconnecting does not close existing focus');
  const next = room.game.players[0].hand.find(tile => !isSpecialGangTile(tile, room.game.indicatorTile));
  const replacement = await discard(room, 0, next);
  assert.notEqual(replacement[0].key, shown[0].key, 'next discard replaces, rather than stacks with, old focus');
  await finishPasses(room);
  report.checks.push({ automaticDrawKeepsFocus: true, duplicateSnapshotsStable: true, voiceMetadataStable: true, anotherViewerReconnectKeepsFocus: true, refreshDoesNotReplayResolvedDiscard: true, nextDiscardReplaces: true });

  const competing = beforeDiscard(names, 'chi', { competition: true });
  await publish(room, competing.game);
  await discard(room, 3, competing.tile);
  // 未响应的当前出牌在真实刷新、断网重连后仍可见，连接版本不能冒充过牌。
  await pages[2].reload({waitUntil:'domcontentloaded'});
  await sync(room);await dismissOverlays();await expanded(3,competing.tile,'refresh within response window');
  await contexts[2].setOffline(true);
  await until(()=>!room.seats[2].connected,'real offline SSE disconnect');
  for(const viewer of [0,1,3])assert.equal((await focusRows())[viewer].hidden,false,'disconnect metadata preserves highlight');
  await contexts[2].setOffline(false);await pages[2].evaluate(()=>window.mahjongRoom.reconnect());
  await sync(room);await expanded(3,competing.tile,'real offline reconnect within response window');
  assert.equal(room.game.getActions(0).pass, true);
  assert.equal(room.game.getActions(1).peng, true);
  const animationsBefore = await animationCounts();
  await operation(room, 0, 'pass');
  assert.equal(room.game.phase.kind, 'claim', 'other responder still has a choice after the first genuine pass');
  await settled('pass settles focus before other responder chooses');
  const shrinkAnimation = await shrinkEvidence(room, animationsBefore, 3, competing.tile);
  await replay(room); await settled('same-discard replay cannot revive settled focus');
  await pages[0].reload({ waitUntil: 'domcontentloaded' });
  await sync(room); await dismissOverlays();
  await settled('refresh of settled discard cannot replay it');
  await finishPasses(room);
  assert.equal(room.game.players[3].discards.at(-1), competing.tile, 'pass leaves the physical river tile in place');
  report.checks.push({ realPassSettlesAllViews: true, otherResponderStillPending: true, refreshSettledDoesNotReplay: true, shrinkAnimation, physicalTiles: 136 });

  // A naturally dealt seed complements the explicit legal-allocation fixtures.
  const natural = new MahjongGame({ seed: 'last-discard-0', laizi: true, names });
  await publish(room, natural);
  const naturalTile = room.game.players[0].hand[7];
  await discard(room, 0, naturalTile);
  assert.equal(room.game.phase.kind, 'claim');
  await operation(room, gameResponder(room.game), 'pass');
  await settled('naturally dealt response returns focus to river');
  report.checks.push({ naturalDealSeed: 'last-discard-0', genuineDiscardAndPass: true });
}
async function consecutiveDiscards(room,names){
  await publish(room,new MahjongGame({seed:'stable-focus-twenty-discards',names,laizi:true}));
  const seen=new Set();
  let maximumError=0;
  for(let turn=0;turn<20;turn++){
    const from=room.game.current;seen.add(from);
    const tile=room.game.players[from].hand.find(t=>!isSpecialGangTile(t,room.game.indicatorTile)&&t!==room.game.wildTile);
    assert.notEqual(tile,undefined);
    await discard(room,from,tile);
    for(let frame=0;frame<3;frame++){
      for(const [viewer,page]of pages.entries()){
        const row=await assertLocalFocus(page,`discard ${turn+1}, frame ${frame}, viewer ${viewer}`);
        maximumError=Math.max(maximumError,row.widthError,row.heightError,row.cornerError);
      }
      await Promise.all(pages.map(frames));
    }
    await finishPasses(room);
  }
  assert.equal(seen.size,4);
  report.checks.push({consecutiveDiscards:20,fourSeats:true,allFramesSameSize:true,maximumErrorPx:maximumError});
}
async function claims(room, names) {
  for (const kind of ['chi', 'peng', 'gang', 'hu']) {
    const setup = beforeDiscard(names, kind, { competition: kind === 'chi' });
    await publish(room, setup.game);
    await discard(room, 3, setup.tile);
    assert.ok(kind === 'chi' ? room.game.getActions(0).chi.length : room.game.getActions(0)[kind]);
    await operation(room, 0, kind);
    await settled(`submitted ${kind} retracts the focus`);
    if (kind === 'chi') assert.equal(room.game.phase.kind, 'claim', 'submitted chi waits for a higher-priority rival');
    await finishPasses(room);
    assert.equal(room.game.lastDiscard, null, `${kind}: consumed discard has no marker`);
    assert.equal(room.game.players[3].discards.length, 0, `${kind}: physical claimed tile leaves river`);
    if (kind === 'hu') assert.equal(room.game.result.winner, 0);
    else assert.equal(room.game.players[0].melds.at(-1).kind, kind);
    physical(room.game);
    report.checks.push({ kind, realBrowserDiscard: true, realBrowserResponse: true, focusRetracts: true, riverTileConsumedExactlyOnce: true, physicalTiles: 136 });
  }
}
async function geometry(room, names) {
  const setup = beforeDiscard(names, 'none', { filled: true });
  await publish(room, setup.game);
  await discard(room, 3, setup.tile);
  const page = pages[0];
  // 实际将几何暂时置零，覆盖首帧未布局完成；恢复 CSS 后由待处理帧自行显示。
  await page.evaluate(()=>{
    const style=document.createElement('style');style.id='focus-zero-geometry';style.textContent='.river .tile{width:0!important}';document.head.append(style);
    window.renderMahjong();
  });
  await frames(page);
  await page.evaluate(()=>document.querySelector('#focus-zero-geometry').remove());
  await frames(page);
  await until(()=>page.locator('#discard-focus').evaluate(n=>!n.hidden),'deferred geometry retries without a new snapshot');
  await assertLocalFocus(page,'geometry retry');
  await page.evaluate(()=>{document.querySelector('#discard-focus').hidden=true;window.renderMahjong();});
  await assertLocalFocus(page,'same-key render restores hidden layer');
  await page.evaluate(()=>{
    const style=document.createElement('style');style.id='focus-no-plane';style.textContent='.river .tile{display:none!important}';document.head.append(style);
    window.renderMahjong();
  });
  await frames(page);
  assert.equal(await page.locator('#discard-focus').evaluate(n=>n.hidden),true,'missing plane cannot show stale geometry');
  await page.evaluate(()=>document.querySelector('#focus-no-plane').remove());await frames(page);
  await until(()=>page.locator('#discard-focus').evaluate(n=>!n.hidden),'missing plane recovers on the next layout without a snapshot');
  await assertLocalFocus(page,'null-plane retry');
  for (const viewport of viewports) {
    await Promise.all(pages.map(view => view.setViewportSize(viewport)));
    await Promise.all(pages.map(frames)); await sleep(200);
    const focusViews = await Promise.all(pages.map((view, viewer) => assertLocalFocus(view, `${viewport.width}x${viewport.height}: viewer ${viewer}`)));
    const rows = await page.evaluate(() => {
      const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const reachable = element => {
        const r = element.getBoundingClientRect();
        const target = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return Boolean(target && (target === element || element.contains(target)));
      };
      const angle = element => {
        // Include the complete tile and all transforms inside its river. The
        // table perspective and canvas scaling are shared view transforms.
        const river = element.closest('.river');
        let matrix = new DOMMatrix();
        for (let node = element; node && node !== river.parentElement; node = node.parentElement) {
          const transform = getComputedStyle(node).transform;
          if (transform !== 'none') matrix = new DOMMatrix(transform).multiply(matrix);
        }
        return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
      };
      // 只验证本次高亮不改变既有热区；透视桌面本身的命中情况与高亮隐藏时逐点比较。
      const holder=document.querySelector('#discard-focus');
      const points=[...document.querySelectorAll('.river .tile,#hand button')].map(n=>{const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
      const hits=()=>points.map(p=>document.elementFromPoint(p.x,p.y));
      const withHighlight=hits();holder.hidden=true;const withoutHighlight=hits();holder.hidden=false;
      const pointerUnchanged=withHighlight.every((node,index)=>node===withoutHighlight[index]);
      return {
        rivers: [0, 1, 2, 3].map(player => {
          const river = document.querySelector(`#river-${player}`), tiles = [...river.querySelectorAll('.tile')];
          const style = getComputedStyle(river), tile = tiles[0], slot = tile.parentElement;
          const tileBox = rect(tile);
          return { player, angle: angle(tile), box: rect(river), tile: tileBox, logicalTileWidth: tileBox.width, logicalTileHeight: tileBox.height, slot: rect(slot), count: tiles.length, columns: style.gridTemplateColumns.split(/\s+/).length, tileReachable: tiles.some(reachable) };
        }),
        handReachable: [...document.querySelectorAll('#hand button[aria-disabled="false"]')].some(reachable),
        focus: rect(document.querySelector('#discard-focus')),
        focusPointerEvents: getComputedStyle(document.querySelector('#discard-focus')).pointerEvents,
        pointerUnchanged,pointerSamples:points.length,
      };
    });
    const expected = [0, -90, 180, 90];
    for (const row of rows.rivers) {
      const difference = ((row.angle - expected[row.player] + 540) % 360) - 180;
      assert.ok(Math.abs(difference) < .05, `whole river tile faces seat ${row.player}: ${row.angle}deg`);
      assert.equal(row.columns, row.player % 2 ? 4 : 9, `river ${row.player} keeps intended grid columns`);
      if (row.player % 2) assert.ok(row.logicalTileWidth > row.logicalTileHeight, 'sideways whole tiles occupy landscape grid slots');
      // 检查原有鼠标热区可操作性；牌谱用原生键盘入口验证，避免透视牌面选点误差。
      if(row.tileReachable)await page.locator(`#river-${row.player} .tile`).first().click({trial:true});
      await page.locator(`#river-${row.player}`).press('Enter');
      await page.locator('#history-dialog[open]').waitFor({timeout:3000});
      assert.equal(await page.locator('#history-tiles .tile').count(), room.game.players[row.player].discards.length);
      await page.locator('#history-dialog [data-close]').first().click();
      await page.evaluate(()=>document.activeElement?.blur());
      await frames(page);
    }
    assert.equal(rows.handReachable, true, 'own active hand remains reachable');
    assert.equal(rows.focusPointerEvents, 'none');
    assert.equal(rows.pointerUnchanged,true,'all river and hand hit targets are identical with and without highlight');
    assert.ok(rows.focus.width > 0 && rows.focus.height > 0, 'highlighted tile remains visible');
    report.geometry.push({ viewport, ...rows, focusViews, riverPointerTrials:rows.rivers.filter(r=>r.tileReachable).length, actualRiverHistoryKeyboardInputs:4 });
    const screenshot = path.join(output, `出牌朝向与高亮-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path: screenshot }); report.screenshots.push(screenshot);
  }
  await Promise.all(pages.map(view => view.setViewportSize(viewports[0])));
  // The other half of the interaction check measures the visible response
  // buttons, while the highlighted tile is still present.
  const response = beforeDiscard(names, 'peng');
  await publish(room, response.game); await discard(room, 3, response.tile);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport); await frames(page);
    for (const kind of ['peng', 'pass']) await page.locator(`#action-${kind}:visible:enabled`).click({ trial: true });
  }
  await page.setViewportSize(viewports[0]);
  await Promise.all(pages.map(page => page.emulateMedia({ reducedMotion: 'reduce' })));
  // 无动画设置下首次出牌也必须出现，不只验证撤销路径。
  const reduced=beforeDiscard(names,'peng');await publish(room,reduced.game);await discard(room,3,reduced.tile);
  await expanded(3,reduced.tile,'reduced motion static highlight');
  const animationsBefore = await animationCounts();
  await operation(room, 0, 'pass'); await settled('responsive action remains usable');
  assert.deepEqual(await animationCounts(), animationsBefore, 'reduced-motion pass settles without launching a shrink animation');
  for (const page of pages) assert.equal(await page.locator('.discard-flight').count(), 0, 'reduced-motion leaves no temporary animation tiles');
  await Promise.all(pages.map(page => page.emulateMedia({ reducedMotion: 'no-preference' })));
  report.checks.push({ supportedViewportRiverAndHandAccess: true, supportedViewportResponseButtonAccess: true, fourViewerLocalFocusTracksSupportedViewports: true, maximumFocusSizeErrorPx: 1, maximumFocusCornerErrorPx: 1, wholeTileSeatAngles: [0, -90, 180, 90], reducedMotionPassSettlesWithoutAnimation: true });
}

try {
  pages.push(await player('出牌甲'));
  await pages[0].locator('#room-create').click();
  await pages[0].locator('#room-waiting:not([hidden])').waitFor();
  const code = (await pages[0].locator('#room-current-code').textContent()).trim();
  for (const name of ['出牌乙', '出牌丙', '出牌丁']) {
    const page = await player(name); pages.push(page);
    await page.locator('#room-code').fill(code); await page.locator('#room-join').click();
    await page.locator('#room-waiting:not([hidden])').waitFor();
  }
  const room = service.rooms.get(code);
  await until(() => room.seats.every(seat => seat.connected), 'four genuine SSE connections');
  for (const page of pages) await page.locator('#room-ready:enabled').click();
  await until(() => room.seats.every(seat => seat.ready), 'four human ready clicks');
  await pages[0].locator('#room-start:enabled').click();
  await until(() => !!room.game, 'real game starts'); await sync(room); await dismissOverlays();
  const names = room.seats.map(seat => seat.name);
  await consecutiveDiscards(room,names);
  await lifecycle(room, names);
  await claims(room, names);
  await geometry(room, names);
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify({ passed: true, browser: report.browser, checks: report.checks, geometryViewports: report.geometry.length, screenshots: report.screenshots, report: path.join(output, 'ui-discard-focus.json') }, null, 2));
} catch (error) {
  report.failure = error.stack;
  throw error;
} finally {
  writeFileSync(path.join(output, 'ui-discard-focus.json'), JSON.stringify(report, null, 2));
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser.close(); service.close();
  const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed;
}
