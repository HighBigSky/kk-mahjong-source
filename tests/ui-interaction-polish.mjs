import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from '../server.js';
import { RoomService } from '../src/server/rooms.js';
import { assertInvariants, collectPhysicalTiles } from '../src/domain/invariants.js';
import { actionFixture, scattered } from './pizi-fixtures.mjs';

// No browser dependency is added to the zero-dependency application.
let playwright;
for (const location of [import.meta.url, 'C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json', path.join(process.env.TEMP || '', 'pwtest', 'package.json')]) {
  try { const require = createRequire(location); playwright = require('playwright'); break; }
  catch { try { playwright = createRequire(location)('playwright-core'); break; } catch { /* Next installed runtime. */ } }
}
assert.ok(playwright, 'An installed Playwright runtime is required');
const baselineArgument = process.argv.find(argument => argument.startsWith('--baseline='));
const baseline = process.argv.includes('--baseline') || Boolean(baselineArgument);
const baselineRef = baselineArgument ? baselineArgument.slice('--baseline='.length) : 'HEAD';
const output = path.resolve('output');
mkdirSync(output, { recursive: true });
const report = { passed: false, baseline, createdAt: new Date().toISOString(), browser: '', errors: [], checks: [], screenshots: [], geometry: [], actions: [], mutations: [], fixtureNote: 'Four independent real Edge sessions use HTTP commands and SSE snapshots. Injected action states conserve all 136 tiles; they are not claimed to be naturally dealt complete rounds.' };
if (baseline) report.baselineCommit = execFileSync('git', ['rev-parse', baselineRef], { encoding: 'utf8', windowsHide: true }).trim();
const sizes = [
  { width: 640, height: 360 }, { width: 844, height: 390 },
  { width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 },
];
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
async function until(test, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!await test()) { assert.ok(Date.now() < deadline, `Timed out: ${label}`); await sleep(10); }
}
async function frames(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function sync(room) {
  await Promise.all(pages.map(page => until(() => page.evaluate(version => window.mahjongRoom.room?.version >= version && !window.mahjongRoom.busy, room.version), 'SSE version rendered')));
  await frames(pages[0]);
}
async function player(name) {
  const context = await browser.newContext({ viewport: sizes[0], hasTouch: true, deviceScaleFactor: 1 });
  contexts.push(context);
  await context.addInitScript(() => {
    localStorage.setItem('queqi-settings', JSON.stringify({ sound: false, names: false, laizi: true }));
    window.__stateEventCount = 0;
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(...args) { super(...args); this.addEventListener('state', () => window.__stateEventCount++); }
    };
    if (screen.orientation) Object.defineProperty(screen.orientation, 'lock', { configurable: true, value: () => Promise.reject(new DOMException('Headless orientation fallback', 'NotSupportedError')) });
    Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: () => Promise.reject(new DOMException('Headless fullscreen fallback', 'NotSupportedError')) });
  });
  if (baseline) {
    // Serve the committed browser implementation even while the workspace is edited.
    const cache = new Map();
    await context.route(`${baseURL}/**`, async route => {
      const url = new URL(route.request().url());
      const file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).slice(1);
      if (url.pathname.startsWith('/api/') || !/\.(?:js|css|html)$/.test(file)) return route.continue();
      if (!cache.has(file)) {
        try { cache.set(file, execFileSync('git', ['show', `${baselineRef}:${file}`], { cwd: path.resolve('.'), encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })); }
        catch { cache.set(file, null); }
      }
      if (cache.get(file) === null) return route.continue();
      await route.fulfill({ status: 200, contentType: file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8', body: cache.get(file) });
    });
  }
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('#room-dialog[open]').waitFor();
  await page.locator('#room-name').fill(name);
  return page;
}
async function publish(room, game, { nextRound = false } = {}) {
  game.round = (room.game?.round || 1) + Number(nextRound);
  assertInvariants(game);
  assert.equal(collectPhysicalTiles(game).length, 136);
  room.game = game;
  service._changed(room);
  await sync(room);
}
function fixture(names, kind) {
  if (kind === 'discard') return actionFixture({ names, hand: [...scattered, 24] });
  const game = kind === 'chi'
    ? actionFixture({ names, seat: 0, hand: [0, 2, ...scattered.filter(tile => tile !== 0 && tile !== 2).slice(0, 11)], discard: 1 })
    : actionFixture({ names, seat: 0, hand: [27, 27, ...scattered.slice(0, 11)], discard: 27 });
  // Other responders have already passed; the measured click resolves the claim.
  game._responses = [null, { action: 'pass' }, { action: 'pass' }, { action: 'pass' }];
  assertInvariants(game);
  return game;
}
async function beginMeasure(page, kind, selector) {
  await page.evaluate(({ kind, selector }) => {
    window.__polishMeasure?.observer.disconnect();
    const result = { kind, clickedAt: null, domAt: null, frameAt: null, childRecords: 0, added: 0, removed: 0, attributeRecords: 0, textRecords: 0, handRecords: 0, riverRecords: 0, meldRecords: 0 };
    const expected = () => kind === 'discard' ? document.querySelector('#river-0 .tile') : document.querySelector(`#melds-0 .meld-group[data-kind="${kind}"]`);
    const ready = () => {
      if (result.clickedAt === null || result.domAt !== null || !expected()) return;
      result.domAt = performance.now();
      requestAnimationFrame(() => { result.frameAt = performance.now(); });
    };
    const observer = new MutationObserver(records => {
      if (result.clickedAt === null) return;
      for (const record of records) {
        if (record.type === 'childList') { result.childRecords++; result.added += record.addedNodes.length; result.removed += record.removedNodes.length; }
        else if (record.type === 'attributes') result.attributeRecords++;
        else result.textRecords++;
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (target?.closest('#hand')) result.handRecords++;
        if (target?.closest('.river')) result.riverRecords++;
        if (target?.closest('[id^="melds-"]')) result.meldRecords++;
      }
      ready();
    });
    observer.observe(document.querySelector('#game'), { childList: true, subtree: true, attributes: true, characterData: true });
    const listener = event => {
      if (event.target.closest(selector)) { result.clickedAt = performance.now(); document.removeEventListener('click', listener, true); }
    };
    document.addEventListener('click', listener, true);
    window.__polishMeasure = { result, observer };
  }, { kind, selector });
}
async function actionTrials(room, names) {
  const page = pages[0];
  for (const kind of ['discard', 'peng', 'chi']) {
    for (let iteration = 0; iteration < 5; iteration++) {
      await publish(room, fixture(names, kind));
      const version = room.version;
      let selector = `#action-${kind}`;
      if (kind === 'discard') {
        selector = '#hand button[data-index="0"]';
        await page.locator(selector).click();
        assert.equal(await page.locator(selector).getAttribute('aria-pressed'), 'true');
      }
      await beginMeasure(page, kind, selector);
      await page.locator(selector).click();
      await until(() => room.version > version, `${kind} accepted by server`);
      await sync(room);
      await until(() => page.evaluate(() => window.__polishMeasure.result.frameAt !== null), `${kind} DOM painted`);
      await sleep(100);
      const measured = await page.evaluate(() => {
        const { result, observer } = window.__polishMeasure;
        observer.disconnect();
        return { ...result, domMs: Number((result.domAt - result.clickedAt).toFixed(2)), frameMs: Number((result.frameAt - result.clickedAt).toFixed(2)) };
      });
      assertInvariants(room.game);
      assert.equal(kind === 'discard' ? room.game.players[0].discards.length : room.game.players[0].melds.length, 1);
      assert.equal(collectPhysicalTiles(room.game).length, 136);
      report.actions.push({ kind, iteration: iteration + 1, actualBrowserClick: true, conservation: 136, ...measured });
    }
  }
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
  report.latency = Object.fromEntries(['discard', 'peng', 'chi'].map(kind => {
    const samples = report.actions.filter(action => action.kind === kind);
    return [kind, { samples: samples.length, domMedianMs: percentile(samples.map(s => s.domMs), .5), domP95Ms: percentile(samples.map(s => s.domMs), .95), frameMedianMs: percentile(samples.map(s => s.frameMs), .5), frameP95Ms: percentile(samples.map(s => s.frameMs), .95), childRecordsMedian: percentile(samples.map(s => s.childRecords), .5), attributesMedian: percentile(samples.map(s => s.attributeRecords), .5), addedMedian: percentile(samples.map(s => s.added), .5), removedMedian: percentile(samples.map(s => s.removed), .5) }];
  }));
}
async function unchangedRenders() {
  const stats = await pages[0].evaluate(async () => {
    const counters = Object.fromEntries(['hand', 'rivers', 'melds'].map(kind => [kind, { records: 0, added: 0, removed: 0 }]));
    const selectors = { hand: '#hand', rivers: '.river', melds: '[id^="melds-"]' };
    const observers = Object.entries(selectors).map(([kind, selector]) => {
      const observer = new MutationObserver(records => records.forEach(record => { counters[kind].records++; counters[kind].added += record.addedNodes.length; counters[kind].removed += record.removedNodes.length; }));
      document.querySelectorAll(selector).forEach(element => observer.observe(element, { childList: true, subtree: true }));
      return observer;
    });
    const started = performance.now();
    for (let i = 0; i < 20; i++) window.renderMahjong();
    const durationMs = Number((performance.now() - started).toFixed(2));
    await Promise.resolve();
    observers.forEach(observer => observer.disconnect());
    return { iterations: 20, durationMs, ...counters };
  });
  report.mutations.push(stats);
  assert.equal(stats.hand.records + stats.rivers.records + stats.melds.records, 0, 'Twenty unchanged full renders preserve tile DOM children');
}
async function duplicateSnapshots(room) {
  const page = pages[0];
  const envelope = service.snapshot(room, 0);
  // First align the exact payload, including the notice's remaining lifetime.
  let events = await page.evaluate(() => window.__stateEventCount);
  for (const stream of room.seats[0].streams) service._write(stream, envelope);
  await until(() => page.evaluate(before => window.__stateEventCount > before, events), 'Warm duplicate event received');
  await frames(page);
  events = await page.evaluate(() => {
    window.__duplicateStats = { childRecords: 0, added: 0, removed: 0, attributeRecords: 0, textRecords: 0, players: window.mahjongGame.players };
    window.__duplicateObserver = new MutationObserver(records => records.forEach(record => {
      const stats = window.__duplicateStats;
      if (record.type === 'childList') { stats.childRecords++; stats.added += record.addedNodes.length; stats.removed += record.removedNodes.length; }
      else if (record.type === 'attributes') stats.attributeRecords++;
      else stats.textRecords++;
    }));
    window.__duplicateObserver.observe(document.querySelector('#game'), { childList: true, subtree: true, characterData: true, attributes: true });
    return window.__stateEventCount;
  });
  for (let i = 0; i < 20; i++) for (const stream of room.seats[0].streams) service._write(stream, envelope);
  await until(() => page.evaluate(before => window.__stateEventCount >= before + 20, events), 'Twenty duplicate SSE events received');
  await frames(page);
  const stats = await page.evaluate(() => {
    window.__duplicateObserver.disconnect();
    const { players, ...counts } = window.__duplicateStats;
    return { ...counts, retainedPlayers: players === window.mahjongGame.players };
  });
  report.duplicateSSE = { events: 20, ...stats };
  if (!baseline) {
    assert.equal(stats.childRecords, 0, 'Identical duplicate snapshots do not rebuild game children');
    assert.equal(stats.attributeRecords, 0, 'Identical duplicate snapshots do not rewrite attributes');
    assert.equal(stats.retainedPlayers, true, 'Duplicate snapshot preserves the existing game state');
  }
}

async function screenshot(page, name) {
  const file = path.join(output, `interaction-${name}.png`);
  await page.screenshot({ path: file });
  report.screenshots.push(file);
}
function filledFixture(names) {
  const game = actionFixture({ names, hand: [...scattered, 24] });
  // Move owning physical tiles out of the wall instead of duplicating tile codes.
  for (let seat = 0; seat < 4; seat++) game.players[seat].discards = game.wall.splice(0, seat % 2 === 0 ? 12 : 6);
  game.pendingDiscard = null;
  game.lastDiscard = { from: 2, tile: game.players[2].discards.at(-1), index: 11 };
  assertInvariants(game);
  return game;
}
async function geometry(page, viewport) {
  await page.setViewportSize(viewport);
  await frames(page);
  const measured = await page.evaluate(() => {
    const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5;
    const hand = [...document.querySelectorAll('#hand button')].map(element => ({ box: box(element), hit: document.elementFromPoint(...[(box(element).left + box(element).right) / 2, (box(element).top + box(element).bottom) / 2])?.closest('#hand button') === element }));
    const rivers = [...document.querySelectorAll('.river .tile')].map(element => ({ box: box(element), seat: element.parentElement.id }));
    const avatar = box(document.querySelector('#opponent-2'));
    const avatarFace = box(document.querySelector('#opponent-2 .portrait'));
    const table = box(document.querySelector('.table'));
    const protections = [...document.querySelectorAll('.opponent-rack .tile,.opponent-rack .back,.my-melds .tile,#wall-tail .wall-piece:not(.is-empty),.table-center,.player-seat,#hand button,.top-tools>*')].filter(visible).map(element => ({ box: box(element), name: element.id || element.className.baseVal || element.className }));
    const overlaps = [];
    for (let i = 0; i < rivers.length; i++) {
      for (const obstacle of protections) if (overlap(rivers[i].box, obstacle.box)) overlaps.push({ river: i, obstacle: obstacle.name });
      for (let j = i + 1; j < rivers.length; j++) if (overlap(rivers[i].box, rivers[j].box)) overlaps.push({ river: i, other: j });
    }
    const topRackTiles = [...document.querySelectorAll('#rack-2 .tile,#rack-2 .back')].map(box);
    const avatarOverlap = topRackTiles.filter(tile => overlap(tile, avatar));
    const avatarToolbarOverlaps = [...document.querySelectorAll('.top-tools>*')].filter(visible).map(element => ({ name: element.id || element.className, box: box(element) })).filter(element => overlap(element.box, avatar));
    const marker = document.querySelector('.river .last-discard');
    const markerStyle = marker && getComputedStyle(marker);
    return { stage: { width: document.querySelector('#game').clientWidth, height: document.querySelector('#game').clientHeight },  table, avatar, avatarFace, avatarOverlap, avatarToolbarOverlaps, hand, rivers, overlaps, marker: marker ? { box: box(marker), outlineWidth: markerStyle.outlineWidth, color: markerStyle.backgroundColor, width: markerStyle.width, height: markerStyle.height } : null, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight };
  });
  report.geometry.push({ viewport, ...measured });
  await screenshot(page, `layout-${viewport.width}x${viewport.height}`);
  const inside = b => b.left >= -1.1 && b.top >= -1.1 && b.right <= viewport.width + 1.1 && b.bottom <= viewport.height + 1.1;
  assert.ok(measured.hand.length === 14 && measured.hand.every(item => inside(item.box) && item.hit), `Hand visibility and hit targets ${JSON.stringify({ viewport, measured })}`);
  assert.ok(inside(measured.avatar) && inside(measured.avatarFace), `Avatar face and ting are on screen ${JSON.stringify({ viewport, measured })}`);
  assert.deepEqual(measured.avatarOverlap, [], `Top avatar does not cover tiles ${JSON.stringify(viewport)}`);
  assert.deepEqual(measured.avatarToolbarOverlaps, [], `Top avatar avoids toolbar ${JSON.stringify(viewport)}`);
  assert.deepEqual(measured.overlaps, [], `River clearances ${JSON.stringify({ viewport, overlaps: measured.overlaps })}`);
  assert.equal(measured.rivers.length, 36, 'All 36 physical discards in this fixture are displayed');
  assert.ok(measured.rivers.every(tile => inside(tile.box)));
  assert.ok(measured.marker && parseFloat(measured.marker.outlineWidth) > 0);
  assert.ok(measured.scrollWidth <= viewport.width + 1 && measured.scrollHeight <= viewport.height + 1);
}
async function diceChecks(room, names) {
  const page = pages[0];
  await until(() => page.locator('#dice-intro').evaluate(element => !element.hidden), 'Opening enlarged dice');
  const large = await page.evaluate(() => {
    const intro = document.querySelector('#dice-intro-dice .table-die').getBoundingClientRect();
    const small = document.querySelector('#table-dice .table-die').getBoundingClientRect();
    return { opening: { width: intro.width, height: intro.height }, central: { width: small.width, height: small.height } };
  });
  assert.ok(large.opening.width >= large.central.width * 1.8 && large.opening.height >= large.central.height * 1.8, JSON.stringify(large));
  await screenshot(page, 'opening-dice');
  await sleep(400);
  await page.evaluate(() => { for (let i = 0; i < 20; i++) window.renderMahjong(); });
  for (const stream of room.seats[0].streams) service._write(stream, service.snapshot(room, 0));
  await until(() => page.locator('#dice-intro').evaluate(element => element.hidden), 'Dice shrink automatically after 1500 ms');
  const events = await page.evaluate(() => window.__introEvents);
  const shown = events.find(event => event.visible);
  const hidden = events.find(event => !event.visible && event.at > shown?.at);
  const durationMs = hidden && shown ? Number((hidden.at - shown.at).toFixed(2)) : null;
  assert.ok(durationMs >= 1350 && durationMs <= 1900, `Actual opening display duration: ${durationMs} ms`);
  report.dice = { ...large, durationMs, repeatedRenders: 20, sameVersionSSE: true };
  const round = room.game.round;
  await publish(room, fixture(names, 'discard'), { nextRound: true });
  assert.equal(room.game.round, round + 1);
  await until(() => page.locator('#dice-intro').evaluate(element => !element.hidden), 'Next round enlarged dice');
  await page.evaluate(() => {
    window.__introClick = { clickedAt: null, hiddenAt: null };
    document.querySelector('#dice-intro').addEventListener('click', () => { window.__introClick.clickedAt = performance.now(); }, { capture: true, once: true });
    const observer = new MutationObserver(() => { if (document.querySelector('#dice-intro').hidden) { window.__introClick.hiddenAt = performance.now(); observer.disconnect(); } });
    observer.observe(document.querySelector('#dice-intro'), { attributes: true });
  });
  await page.locator('#dice-intro').click();
  await until(() => page.locator('#dice-intro').evaluate(element => element.hidden), 'Click dismisses opening dice');
  const clicked = await page.evaluate(() => window.__introClick);
  report.dice.clickDismissMs = Number((clicked.hiddenAt - clicked.clickedAt).toFixed(2));
  assert.ok(report.dice.clickDismissMs >= 0 && report.dice.clickDismissMs < 100);
  await page.evaluate(() => window.renderMahjong());
  assert.equal(await page.locator('#dice-intro').evaluate(element => element.hidden), true, 'Click dismissal survives rerender');
}
async function tingChecks(room, names) {
  const page = pages[0];
  const waiting = [0,1,2,9,10,11,18,19,20,24,25,26,1];
  await publish(room, actionFixture({names,hand:[...waiting,28]}));
  const button = page.locator('#hand button[data-index="13"]');
  const before = await button.boundingBox(); await button.click();
  await until(() => button.evaluate((element,y) => element.getBoundingClientRect().y < y-2,before.y),'Selection raises the tile');
  assert.equal(await button.getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#hint-text .hint-line-discard use').getAttribute('href'),'#tile-28');
  assert.ok((await page.locator('#hint-text .hint-line-waits use').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')))).includes('#tile-1'));
  await screenshot(page,'selected-unified-hint');
  const current=actionFixture({names,hand:waiting});current.players[1].hand.push(current.wall.pop());current.current=1;current.phase={kind:'discard',seat:1};current.lastDraw=null;
  await publish(room,current);assert.match(await page.locator('#hint-text').textContent(),/^已听：/);
  assert.ok((await page.locator('#hint-text .hint-line-waits use').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')))).includes('#tile-1'));
  report.tingPanelGeometry=[];
  for(const viewport of sizes){await page.setViewportSize(viewport);await frames(page);const geometry=await page.locator('#play-assist').boundingBox();assert.ok(geometry.x>=-1&&geometry.y>=-1&&geometry.x+geometry.width<=viewport.width+1&&geometry.y+geometry.height<=viewport.height+1);report.tingPanelGeometry.push({viewport,...geometry});}
  await page.setViewportSize(sizes[0]);await frames(page);
  report.ting={unified:true,selectedDiscard:28,currentThirteenWaits:[1]};
}
async function latestChecks(room, names) {
  const page = pages[0];
  await publish(room, fixture(names, 'discard'));
  await page.locator('#hand button[data-index="0"]').click();
  const version = room.version;
  await page.locator('#hand button[data-index="0"]').click();
  await until(() => room.version > version, 'Discard for persistent marker');
  await sync(room);
  assert.equal(await page.locator('#river-0 .last-discard').count(), 1);
  // Genuine passes resolve the pending discard; the marker must remain on the river tile.
  for (let seat = 0; seat < 4 && room.game.phase.kind === 'claim'; seat++) {
    if (room.game.getActions(seat).pass) {
      const before = room.version;
      await pages[seat].locator('#action-pass:enabled').click();
      await until(() => room.version > before, `Seat ${seat} passes`); await sync(room);
    }
  }
  assert.equal(room.game.pendingDiscard, null);
  assert.equal(await page.locator('#river-0 .last-discard').count(), 1, 'Marker survives clearing pendingDiscard');
  const claim = fixture(names, 'peng');
  claim.lastDiscard = { from: 3, tile: 27, index: 0 };
  await publish(room, claim);
  assert.equal(await page.locator('#river-3 .last-discard').count(), 1);
  const before = room.version;
  await page.locator('#action-peng:enabled').click();
  await until(() => room.version > before, 'Peng consumes latest river tile'); await sync(room);
  assert.equal(await page.locator('.river .last-discard').count(), 0, 'Claimed tile marker is cleared');
  assert.equal(room.game.lastDiscard, null);
  assertInvariants(room.game);
  report.latestDiscard = { realDiscard: true, persistentAfterAllPass: true, clearedAfterPeng: true, physicalTiles: 136 };
}
async function fourthCopyClaimCheck(room, names) {
  const page = pages[0];
  const game = actionFixture({ names, hand: [0, 0, 2, 2, 3, 3, 5, 5, 6, 6, 8, 8, 28], discard: 28 });
  for (const seat of [1, 2]) {
    const index = game.wall.indexOf(28); assert.ok(index >= 0, 'Fourth-copy fixture owns a real South');
    game.players[seat].discards.push(game.wall.splice(index, 1)[0]);
  }
  game.lastDiscard = { from: 3, tile: 28, index: 0 };
  assertInvariants(game);
  assert.equal(game.getActions(0).hu, true, 'Current fourth physical South can complete seven pairs');
  await publish(room, game);
  assert.ok((await page.locator('#hint-text .hint-line-waits use').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')))).includes('#tile-28'));
  assert.match(await page.locator('#hint-btn').getAttribute('aria-label'),/南（0张，仅接胡）/);
  assert.equal(await page.locator('#play-assist').isVisible(),true);
  await screenshot(page,'fourth-copy-current-claim');
  game.pendingDiscard=null;game.current=1;game.phase={kind:'discard',seat:1};game.lastDraw=null;
  await publish(room,game);
  assert.equal((await page.locator('#hint-btn').getAttribute('aria-label')).includes('南（0张，仅接胡）') && await page.locator('#play-assist').isVisible(),false);
  report.fourthCopyClaim = { knownCopies: 4, serverHu: true, duringResponse: { claim: true, selfDraw: false }, afterResponseShown: false, conservation: 136 };
}
async function featureChecks(room, names) {
  await diceChecks(room, names);
  await tingChecks(room, names);
  await latestChecks(room, names);
  await fourthCopyClaimCheck(room, names);
  await publish(room, filledFixture(names));
  for (const viewport of sizes) await geometry(pages[0], viewport);
  await pages[0].setViewportSize(sizes[0]);
  await frames(pages[0]);
  await unchangedRenders();
}

try {
  pages.push(await player('交互甲'));
  await pages[0].locator('#room-create').click();
  await pages[0].locator('#room-waiting:not([hidden])').waitFor();
  const code = (await pages[0].locator('#room-current-code').textContent()).trim();
  for (const name of ['交互乙', '交互丙', '交互丁']) {
    const page = await player(name); pages.push(page);
    await page.locator('#room-code').fill(code);
    await page.locator('#room-join').click();
    await page.locator('#room-waiting:not([hidden])').waitFor();
  }
  const room = service.rooms.get(code);
  await until(() => room.seats.every(seat => seat.connected), 'four SSE connections');
  for (const page of pages) await page.locator('#room-ready:enabled').click();
  await until(() => room.seats.every(seat => seat.ready), 'four human ready clicks');
  if (!baseline) await pages[0].evaluate(() => {
    window.__introEvents = [];
    const element = document.querySelector('#dice-intro');
    const observer = new MutationObserver(() => window.__introEvents.push({ visible: !element.hidden, at: performance.now() }));
    observer.observe(element, { attributes: true, attributeFilter: ['hidden'] });
  });
  await pages[0].locator('#room-start:enabled').click();
  await until(() => !!room.game, 'real round start');
  await sync(room);
  const names = room.seats.map(seat => seat.name);
  if (!baseline) await featureChecks(room, names);
  await actionTrials(room, names);
  await unchangedRenders();
  await duplicateSnapshots(room);
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify({ passed: true, baseline, browser: report.browser, latency: report.latency, mutations: report.mutations, duplicateSSE: report.duplicateSSE, screenshots: report.screenshots.length, errors: report.errors, report: path.join(output, `interaction-polish${baseline ? '-baseline' : ''}.json`) }, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally {
  writeFileSync(path.join(output, `interaction-polish${baseline ? '-baseline' : ''}.json`), JSON.stringify(report, null, 2));
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser.close(); service.close();
  const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed;
}
