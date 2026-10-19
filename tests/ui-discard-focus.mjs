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

// Keep browser dependencies outside the zero-dependency application.
let playwright;
for (const location of [import.meta.url, 'C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json', path.join(process.env.TEMP || '', 'pwtest', 'package.json')]) {
  try { playwright = createRequire(location)('playwright'); break; }
  catch { try { playwright = createRequire(location)('playwright-core'); break; } catch { /* Try the next runtime. */ } }
}
assert.ok(playwright, 'An installed Playwright runtime is required');
const viewports = [
  { width: 844, height: 390 }, { width: 667, height: 375 }, { width: 932, height: 430 },
  { width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1280, height: 1024 },
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
  const game = actionFixture({ names, hand: [...scattered, 24] });
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
    const focus = holder.querySelector('.tile'), original = document.querySelector(`#river-${player} .last-discard`);
    if (holder.hidden || !focus || !original) return null;
    const box = element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const angle = element => {
      // The focus and its physical tile share the table perspective. Measure
      // only the transforms below that common plane, including seat rotation.
      const table = element.closest('.table');
      let matrix = new DOMMatrix();
      for (let node = element; node && node !== table; node = node.parentElement) {
        const transform = getComputedStyle(node).transform;
        if (transform !== 'none') matrix = new DOMMatrix(transform).multiply(matrix);
      }
      return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
    };
    const enlarged = box(focus), river = box(original);
    return {
      player, enlarged, river, centerError: Math.hypot(enlarged.x - river.x, enlarged.y - river.y),
      widthRatio: enlarged.width / river.width, heightRatio: enlarged.height / river.height,
      angle: angle(focus), originalAngle: angle(original),
      sameTable: holder.closest('.table') === original.closest('.table'),
      pointerEvents: getComputedStyle(holder).pointerEvents,
    };
  });
}
async function assertLocalFocus(page, label) {
  const row = await focusGeometry(page);
  assert.ok(row, `${label}: enlarged and original river tile are visible`);
  if (row.centerError > 1) report.focusGeometryFailure = { label, ...row };
  assert.equal(row.sameTable, true, `${label}: enlarged tile uses its river's table perspective`);
  assert.ok(row.centerError <= 1, `${label}: enlarged tile remains at the actual discard position (${row.centerError.toFixed(3)}px)`);
  for (const ratio of [row.widthRatio, row.heightRatio]) assert.ok(ratio >= 1.35 && ratio <= 1.7, `${label}: enlargement is a readable, moderate 1.5 times the original (${ratio.toFixed(3)})`);
  const expected = [0, -90, 180, 90][row.player];
  for (const actual of [row.angle, row.originalAngle]) {
    const difference = ((actual - expected + 540) % 360) - 180;
    assert.ok(Math.abs(difference) < .05, `${label}: whole tile faces seat ${row.player} (${actual}deg)`);
  }
  assert.equal(row.pointerEvents, 'none', `${label}: enlarged tile leaves controls reachable`);
  return row;
}
async function expanded(from, tile, label) {
  await until(async () => (await focusRows()).every(row => !row.hidden), `${label}: four expanded views`);
  // An entrance animation must finish before measuring the intended resting
  // scale. Its early frames deliberately begin below the final enlargement.
  await Promise.all(pages.map(page => page.locator('#discard-focus').evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))))));
  const rows = await focusRows();
  for (let viewer = 0; viewer < 4; viewer++) {
    assert.equal(rows[viewer].player, (from - viewer + 4) % 4, `${label}: relative player ${viewer}`);
    assert.equal(rows[viewer].tile, tile, `${label}: correct tile ${viewer}`);
    assert.ok(rows[viewer].key, `${label}: stable discard identity ${viewer}`);
    assert.equal(rows[viewer].tileCount, 1, `${label}: one visual enlarged tile ${viewer}`);
    assert.equal(rows[viewer].pointerEvents, 'none', `${label}: overlay does not block controls`);
    await assertLocalFocus(pages[viewer], `${label}: viewer ${viewer}`);
  }
  return rows;
}
async function settled(label) {
  await until(async () => (await focusRows()).every(row => row.hidden), `${label}: all views return tile to river`);
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
  return expanded(from, tile, 'real browser discard');
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
async function shrinkEvidence(room, before, from, tile) {
  const flights = await Promise.all(pages.map((page, viewer) => page.evaluate(start => window.__discardFlightAnimations.slice(start), before[viewer])));
  const scales = [], startScales = [], endScaleRatios = [], displacements = [];
  for (let viewer = 0; viewer < 4; viewer++) {
    assert.equal(flights[viewer].length, 1, `view ${viewer}: real pass creates exactly one shrink animation`);
    const flight = flights[viewer][0], start = flight.keyframes[0], end = flight.keyframes.at(-1);
    const scale = frame => Number(frame.transform.match(/scale\(([\d.]+)\)/)?.[1]);
    const rotation = frame => Number(frame.transform.match(/rotate\(\s*(-?[\d.]+)deg\s*\)/)?.[1]);
    const translate = frame => {
      const match = frame.transform.match(/translate\(\s*(-?[\d.]+)(px|%)?\s*,\s*(-?[\d.]+)(px|%)?\s*\)/);
      return match ? { x: Number(match[1]), y: Number(match[3]), xUnit: match[2] || 'px', yUnit: match[4] || 'px' } : { x: 0, y: 0, xUnit: 'px', yUnit: 'px' };
    };
    const origin = translate(start), destination = translate(end);
    assert.equal(destination.xUnit, origin.xUnit, 'shrink retains the same horizontal coordinate space');
    assert.equal(destination.yUnit, origin.yUnit, 'shrink retains the same vertical coordinate space');
    const displacement = Math.hypot(destination.x - origin.x, destination.y - origin.y);
    const relativeEndScale = scale(end) / scale(start);
    assert.ok(scale(start) >= 1.35 && scale(start) <= 1.7, 'shrink starts at the full enlarged 1.5-times size');
    assert.equal(start.opacity, 1, 'shrink starts opaque');
    assert.ok(relativeEndScale >= .60 && relativeEndScale <= .74, 'shrink returns the 1.5-times preview to its physical river size');
    assert.ok(displacement <= 1, `shrink stays at the original discard location (${displacement.toFixed(3)})`);
    assert.equal(end.opacity, 0, 'the temporary tile fades into its physical river tile');
    assert.equal(flight.duration, 260, 'the actual shrink animation uses the intended 260ms duration');
    scales.push(scale(end));
    startScales.push(scale(start));
    endScaleRatios.push(relativeEndScale);
    displacements.push(displacement);
    const relative = (from - viewer + 4) % 4;
    for (const frame of [start, end]) assert.equal(rotation(frame), [0, -90, 180, 90][relative], 'shrink retains the discarding player orientation');
    assert.equal(await pages[viewer].locator(`#river-${relative} .last-discard`).count(), 1, 'the original tile remains marked in its authoritative river');
    assert.equal(await pages[viewer].evaluate(({ relative, tile }) => window.mahjongRoom.game.players[relative].discards.at(-1) === tile, { relative, tile }), true);
  }
  // Wait for the actual animation completion, not a timer close to its 260ms
  // boundary. This remains reliable if a busy browser paints a later frame.
  await until(async () => (await Promise.all(pages.map((page, viewer) => page.evaluate(start => ({
    finished: window.__discardFlightAnimations.slice(start).every(animation => animation.finished && !animation.canceled),
    ghosts: document.querySelectorAll('.discard-flight').length,
  }), before[viewer])))).every(value => value.finished && value.ghosts === 0), 'completed shrink animations remove every temporary tile');
  physical(room.game);
  return { durationMs: 260, normalizedStartScale: 1, startScales, endScales: scales, endScaleRatios, displacements, startOpacity: 1, endOpacity: 0, fourFinishedAnimations: true, temporaryTilesRemoved: true, originalRiverTilePreserved: true };
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
        // table perspective and portrait screen rotation are shared view transforms.
        const river = element.closest('.river');
        let matrix = new DOMMatrix();
        for (let node = element; node && node !== river.parentElement; node = node.parentElement) {
          const transform = getComputedStyle(node).transform;
          if (transform !== 'none') matrix = new DOMMatrix(transform).multiply(matrix);
        }
        return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
      };
      return {
        rivers: [0, 1, 2, 3].map(player => {
          const river = document.querySelector(`#river-${player}`), tiles = [...river.querySelectorAll('.tile')];
          const style = getComputedStyle(river), tile = tiles[0], slot = tile.parentElement;
          const tileBox = rect(tile), rotated = document.documentElement.classList.contains('landscape-rotated');
          return { player, angle: angle(tile), box: rect(river), tile: tileBox, logicalTileWidth: rotated ? tileBox.height : tileBox.width, logicalTileHeight: rotated ? tileBox.width : tileBox.height, slot: rect(slot), count: tiles.length, columns: style.gridTemplateColumns.split(/\s+/).length, tileReachable: tiles.some(reachable) };
        }),
        handReachable: [...document.querySelectorAll('#hand button[aria-disabled="false"]')].some(reachable),
        focus: rect(document.querySelector('#discard-focus .tile')),
        focusPointerEvents: getComputedStyle(document.querySelector('#discard-focus')).pointerEvents,
      };
    });
    const expected = [0, -90, 180, 90];
    for (const row of rows.rivers) {
      const difference = ((row.angle - expected[row.player] + 540) % 360) - 180;
      assert.ok(Math.abs(difference) < .05, `whole river tile faces seat ${row.player}: ${row.angle}deg`);
      assert.equal(row.columns, row.player % 2 ? 2 : 6, `river ${row.player} keeps intended grid columns`);
      assert.equal(row.tileReachable, true, `river ${row.player} remains clickable at ${viewport.width}x${viewport.height}`);
      if (row.player % 2) assert.ok(row.logicalTileWidth > row.logicalTileHeight, 'sideways whole tiles occupy landscape grid slots');
      await page.locator(`#river-${row.player} .tile`).first().click();
      await page.locator('#history-dialog[open]').waitFor();
      assert.equal(await page.locator('#history-tiles .tile').count(), room.game.players[row.player].discards.length);
      await page.locator('#history-dialog [data-close]').first().click();
    }
    assert.equal(rows.handReachable, true, 'own active hand remains reachable');
    assert.equal(rows.focusPointerEvents, 'none');
    assert.ok(rows.focus.width > 0 && rows.focus.height > 0, 'enlarged tile remains visible');
    report.geometry.push({ viewport, ...rows, focusViews, actualRiverHistoryClicks: 4 });
    const screenshot = path.join(output, `出牌朝向与放大-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path: screenshot }); report.screenshots.push(screenshot);
  }
  await Promise.all(pages.map(view => view.setViewportSize(viewports[0])));
  // The other half of the interaction check measures the visible response
  // buttons, while the enlarged tile is still present.
  const response = beforeDiscard(names, 'peng');
  await publish(room, response.game); await discard(room, 3, response.tile);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport); await frames(page);
    for (const kind of ['peng', 'pass']) await page.locator(`#action-${kind}:visible:enabled`).click({ trial: true });
  }
  await page.setViewportSize(viewports[0]);
  await Promise.all(pages.map(page => page.emulateMedia({ reducedMotion: 'reduce' })));
  const animationsBefore = await animationCounts();
  await operation(room, 0, 'pass'); await settled('responsive action remains usable');
  assert.deepEqual(await animationCounts(), animationsBefore, 'reduced-motion pass settles without launching a shrink animation');
  for (const page of pages) assert.equal(await page.locator('.discard-flight').count(), 0, 'reduced-motion leaves no temporary animation tiles');
  await Promise.all(pages.map(page => page.emulateMedia({ reducedMotion: 'no-preference' })));
  report.checks.push({ sevenViewportRiverAndHandAccess: true, sevenViewportResponseButtonAccess: true, fourViewerLocalFocusTracksSevenViewports: true, maximumFocusCenterErrorPx: 1, moderateEnlargementRange: [1.35, 1.7], wholeTileSeatAngles: [0, -90, 180, 90], reducedMotionPassSettlesWithoutAnimation: true });
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
  await lifecycle(room, names);
  await claims(room, names);
  await geometry(room, names);
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify({ passed: true, browser: report.browser, checks: report.checks, geometryViewports: report.geometry.length, screenshots: report.screenshots, report: path.join(output, 'ui-discard-focus.json') }, null, 2));
} catch (error) {
  report.failure = error.stack;
  if (pages[0] && !pages[0].isClosed()) {
    const screenshot = path.join(output, 'ui-discard-focus-failure.png');
    await pages[0].screenshot({ path: screenshot }).catch(() => {}); report.screenshots.push(screenshot);
  }
  throw error;
} finally {
  writeFileSync(path.join(output, 'ui-discard-focus.json'), JSON.stringify(report, null, 2));
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser.close(); service.close();
  const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed;
}
