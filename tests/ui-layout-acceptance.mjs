import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from '../server.js';
import { RoomService } from '../src/server/rooms.js';
import { MahjongGame } from '../engine.js';
import { maximumPublicFixture, maximumSpecialHandFixture } from './pizi-fixtures.mjs';

let playwright;
try { playwright = createRequire(import.meta.url)('playwright'); }
catch { playwright = createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright'); }
const capacity = 36;
const screens = [
  { device: 'phone', width: 640, height: 360 },
  { device: 'phone', width: 844, height: 390 },
  { device: 'PC', width: 640, height: 360 },
  { device: 'PC', width: 1280, height: 720 },
  { device: 'PC', width: 1440, height: 900 },
  { device: 'PC', width: 1920, height: 1080 },
];
const output = path.resolve('output'); mkdirSync(output, { recursive: true });
const report = {
  passed: false, browser: '', capacity, screens, measurements: [], stability: [], screenshots: [], errors: [], failures: [],
  fixtureNote: 'Rooms are created and started by real HTTP/SSE browser interaction. Every seat is then assigned 36 visual discards, exceeding the proven single-seat bound of 27. Combined four-seat rivers and maximum racks are intentionally impossible tile allocations used only to stress presentation capacity; no rules or protocol are changed.',
};
const service = new RoomService({ botDelayMs: 60000, disconnectGraceMs: 100 });
const server = createServer({ roomService: service });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const baseURL = `http://127.0.0.1:${server.address().port}`;
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await playwright.chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) });
report.browser = browser.version();
const contexts = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!await test()) { assert.ok(Date.now() < deadline, `Timed out: ${label}`); await sleep(20); }
}
function check(condition, message, detail) { if (!condition) report.failures.push({ message, ...detail }); }
async function frames(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function player(mobile) {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 }, hasTouch: mobile, deviceScaleFactor: 1 }); contexts.push(context);
  await context.addInitScript(() => {
    localStorage.setItem('queqi-settings', JSON.stringify({ sound: false, names: false, laizi: true }));
    if (screen.orientation) Object.defineProperty(screen.orientation, 'lock', { configurable: true, value: () => Promise.reject(new DOMException('Browser test', 'NotSupportedError')) });
    Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: () => Promise.reject(new DOMException('Browser test', 'NotSupportedError')) });
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' }); await page.locator('#room-dialog[open]').waitFor();
  await page.locator('#room-name').fill(mobile ? '手机满牌验收' : 'PC满牌验收'); await page.locator('#room-create').click();
  await page.locator('#room-waiting:not([hidden])').waitFor();
  const code = (await page.locator('#room-current-code').textContent()).trim(); const room = service.rooms.get(code);
  await until(() => room.seats[0].connected, 'owner SSE connected');
  for (const seat of [1, 2, 3]) { await page.locator(`.room-bot-add[data-seat="${seat}"]:visible:enabled`).click(); await until(() => room.seats[seat]?.bot, 'bot seated'); }
  await page.locator('#room-ready:enabled').click(); await until(() => room.seats.every(seat => seat?.ready), 'all ready');
  await page.locator('#room-start:visible:enabled').click(); await until(() => !!room.game, 'real round begins');
  await page.locator('#room-dialog:not([open])').waitFor({ state: 'attached' });
  await until(() => page.evaluate(() => !document.querySelector('#dice-intro') || document.querySelector('#dice-intro').hidden), 'opening dice overlay finishes');
  return { page, room };
}
async function applyFixture(page, fixture, actions = false) {
  await page.evaluate(({ fixture, capacity, actions }) => {
    const game = window.mahjongGame;
    Object.assign(game, fixture);
    for (const [seat, player] of game.players.entries()) player.discards = Array.from({ length: capacity }, (_, index) => (seat * 9 + index) % 34);
    game.pendingDiscard = actions ? { from: 1, tile: game.players[1].discards.at(-1) } : null;
    // Mark a progressed presentation fixture so its independent dice values do
    // not replay the real opening overlay over the full-river screenshots.
    game.lastDiscard = null; game.actionNotice = null; game.events = ['布局验收打出一万。']; game.phase = actions ? { kind: 'claim', discard: game.pendingDiscard } : { kind: 'discard', seat: 0 }; game.current = 0;
    window.mahjongRoom.availableActions = () => ({ chi: actions ? [[0, 1, 2]] : [], peng: actions, gang: actions, hu: actions, pass: actions, redGang: false, piziGang: false, wildGang: false, concealedGangs: [], addedGangs: [] });
    window.renderMahjong();
  }, { fixture: JSON.parse(JSON.stringify(fixture)), capacity, actions });
  await frames(page);
}
async function measure(page, screen, scenario) {
  await page.setViewportSize({ width: screen.width, height: screen.height }); await frames(page);
  await page.evaluate(() => window.renderMahjong()); await frames(page);
  const data = await page.evaluate(() => {
    const box = element => {
      const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const visible = element => element.getClientRects().length && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden';
    const collect = selector => [...document.querySelectorAll(selector)].filter(visible).map((element, index) => ({ id: element.id || `${selector}[${index}]`, ...box(element) }));
    const hit = (a, b) => a.right > b.left + .4 && b.right > a.left + .4 && a.bottom > b.top + .4 && b.bottom > a.top + .4;
    const rivers = [0, 1, 2, 3].map(seat => {
      const river = document.querySelector(`#river-${seat}`);
      return {
        seat, tiles: collect(`#river-${seat} .tile`), box: box(river), clientWidth: river.clientWidth, clientHeight: river.clientHeight,
        scrollWidth: river.scrollWidth, scrollHeight: river.scrollHeight, overflow: getComputedStyle(river).overflow,
      };
    });
    const tiles = rivers.flatMap(river => river.tiles.map((tile, index) => ({ ...tile, id: `${river.seat}:${index}` })));
    const obstacles = {
      player: collect('.player-seat'), action: collect('.action-zone button'), hand: collect('#hand button'),
      rack: collect('.opponent-rack .tile,.opponent-rack .back,.my-melds .tile'),
      wall: collect('#wall-tail .wall-piece:not(.is-empty)'), compass: collect('.table-center'),
      tools: collect('.top-tools > *,.wallet-pill,.wall-pill,.laizi-summary'),
    };
    const overlaps = { river: [] };
    for (let a = 0; a < tiles.length; a++) for (let b = a + 1; b < tiles.length; b++) if (hit(tiles[a], tiles[b])) overlaps.river.push(`${tiles[a].id}/${tiles[b].id}`);
    for (const [kind, nodes] of Object.entries(obstacles)) {
      overlaps[kind] = [];
      for (const tile of tiles) for (const node of nodes) if (hit(tile, node)) overlaps[kind].push(`${tile.id}/${node.id}`);
    }
    const actionButtons = [...document.querySelectorAll('.action-zone button')].filter(visible).map(button => {
      const r = box(button); return { id: button.id, ...r, hit: document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)?.closest('button') === button };
    });
    const clips = [];
    for (const river of document.querySelectorAll('.river')) for (const tile of river.querySelectorAll('.tile')) {
      const r = box(tile);
      for (let parent = tile.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const horizontal = ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX);
        const vertical = ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY);
        if (!horizontal && !vertical) continue;
        const p = box(parent);
        if (horizontal && (r.left < p.left - .8 || r.right > p.right + .8) || vertical && (r.top < p.top - .8 || r.bottom > p.bottom + .8)) clips.push(`${river.id}/${parent.id || parent.className}`);
      }
    }
    const firstHand = document.querySelector('#hand button');
    const firstRiver = document.querySelector('#river-0 .tile');
    return {
      rivers, table: box(document.querySelector('.table')), stage: box(document.querySelector('#game')),
      scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      obstacles, actionButtons, clips, overlapCounts: Object.fromEntries(Object.entries(overlaps).map(([kind, pairs]) => [kind, pairs.length])), overlaps,
      handRiverRatio: firstHand && firstRiver ? parseFloat(getComputedStyle(firstRiver).width) / parseFloat(getComputedStyle(firstHand).width) : null,
      publicCounts: [0, 1, 2, 3].map(seat => ({ seat, groups: document.querySelectorAll(`#melds-${seat} .meld-group`).length, tiles: document.querySelectorAll(`#melds-${seat} .tile`).length })),
    };
  });
  const detail = { screen, scenario };
  const inside = (box, outer) => box.left >= outer.left - .8 && box.right <= outer.right + .8 && box.top >= outer.top - .8 && box.bottom <= outer.bottom + .8;
  const viewport = { left: 0, top: 0, right: screen.width, bottom: screen.height };
  check(data.stage.width + 1 >= data.stage.height * 16 / 9, 'single landscape canvas stays at least 16:9', detail);
  check(Math.abs(data.stage.width - screen.width) <= 1 && Math.abs(data.stage.height - Math.min(screen.height, screen.width * 9 / 16)) <= 1, 'canvas fills landscape viewport and centers in taller windows', { ...detail, stage: data.stage });
  check(data.rivers.every(river => river.tiles.length === capacity), 'all 36 physical river tiles render without truncation', { ...detail, counts: data.rivers.map(river => river.tiles.length) });
  check(data.rivers.every(river => river.tiles.every(tile => tile.width > 0 && tile.height > 0 && inside(tile, river.box) && inside(tile, data.table) && inside(tile, viewport))), 'every river tile remains fully in its container, on table and in viewport', detail);
  // Transformed decorative descendants may extend scrollHeight by a pixel or
  // two even with visible overflow. Test actual scrollbars and tile containment.
  check(data.rivers.every(river => !['auto', 'scroll'].some(value => river.overflow.includes(value)) || river.scrollWidth <= river.clientWidth + 1 && river.scrollHeight <= river.clientHeight + 1), 'river has no scrolling container', { ...detail, rivers: data.rivers.map(({ tiles, ...river }) => river) });
  check(data.scroll.width <= screen.width + 1 && data.scroll.height <= screen.height + 1, 'document has no scroll overflow', { ...detail, scroll: data.scroll });
  check(data.clips.length === 0, 'no river tile is clipped by an ancestor', { ...detail, clips: data.clips });
  check(Object.values(data.overlapCounts).every(count => count === 0), 'river tiles do not overlap each other, public racks, wall, actions or player information', { ...detail, counts: data.overlapCounts });
  check(data.actionButtons.every(button => inside(button, viewport) && button.hit), 'all action buttons remain visible and hit-testable', detail);
  if (scenario === 'all-actions') {
    check(data.actionButtons.length === 5, 'all five response actions are visible', detail);
    for (const action of ['chi', 'peng', 'gang', 'hu', 'pass']) {
      try { await page.locator(`#action-${action}`).click({ trial: true, timeout: 1000 }); }
      catch (error) { check(false, 'real browser actionability trial', { ...detail, action, error: error.message }); }
    }
  }
  const filename = path.join(output, `layout-acceptance-${screen.device}-${scenario}-${screen.width}x${screen.height}.png`);
  await page.screenshot({ path: filename }); report.screenshots.push(filename);
  report.measurements.push({ screen, scenario, ...data });
}
async function stability(page, screen, seat) {
  await page.setViewportSize({ width: screen.width, height: screen.height }); await frames(page);
  const result = await page.evaluate(async ({ capacity, seat }) => {
    const rects = () => [...document.querySelectorAll('.river .tile')].map(tile => {
      const r = tile.getBoundingClientRect(); return [r.left, r.top, r.width, r.height];
    });
    const before = rects(); const nodes = [...document.querySelectorAll('.river .tile')];
    for (let render = 0; render < 10; render++) window.renderMahjong();
    const unchangedNodes = nodes.every((node, index) => document.querySelectorAll('.river .tile')[index] === node);
    const game = window.mahjongGame; const index = capacity - 1; const tile = game.players[seat].discards[index];
    game.pendingDiscard = { from: seat, tile }; game.lastDiscard = { from: seat, tile, index }; game.phase = { kind: 'claim', discard: game.pendingDiscard };
    window.renderMahjong();
    await Promise.all(document.querySelector('#discard-focus').getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
    const expanded = !document.querySelector('#discard-focus').hidden;
    const focusRect = document.querySelector('#discard-focus .tile').getBoundingClientRect();
    const focusNeighborOverlaps = [...document.querySelectorAll('.river .tile')].filter(node => node !== document.querySelector(`#river-${seat}`).children[index]).map(node => {
      const r = node.getBoundingClientRect();
      return { seat: node.parentElement.id, width: Math.min(r.right, focusRect.right) - Math.max(r.left, focusRect.left), height: Math.min(r.bottom, focusRect.bottom) - Math.max(r.top, focusRect.top) };
    }).filter(overlap => overlap.width > .4 && overlap.height > .4);
    window.mahjongRoom.room.version++;
    game.pendingDiscard = null; game.phase = { kind: 'discard', seat: 1 }; window.renderMahjong();
    await Promise.all([...document.querySelectorAll('.discard-flight')].flatMap(node => node.getAnimations()).map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(resolve));
    const after = rects();
    return { before, after, unchangedNodes, expanded, focusNeighborOverlaps, focusHidden: document.querySelector('#discard-focus').hidden, flights: document.querySelectorAll('.discard-flight').length, lastCount: document.querySelector(`#river-${seat}`).querySelectorAll('.tile').length };
  }, { capacity, seat });
  check(result.unchangedNodes, 'unchanged render preserves river DOM nodes', { screen, seat });
  check(result.expanded && result.focusHidden && result.flights === 0, 'latest river tile enlarges then finishes shrinking', { screen, seat, expanded: result.expanded, hidden: result.focusHidden, flights: result.flights });
  check(result.focusNeighborOverlaps.length === 0, 'expanded latest tile does not cover neighboring river tiles', { screen, seat, overlaps: result.focusNeighborOverlaps });
  check(result.lastCount === capacity, 'last tile remains after animation', { screen, seat, count: result.lastCount });
  const maxDelta = Math.max(...result.before.flatMap((rect, index) => rect.map((value, component) => Math.abs(value - (result.after[index]?.[component] ?? Infinity)))));
  check(maxDelta < .1, 'all river positions remain stable after render and animation', { screen, seat, maxDelta });
  report.stability.push({ screen, seat, unchangedNodes: result.unchangedNodes, latestTileRemains: result.lastCount === capacity, maxDelta, expandedAndRetired: result.expanded && result.focusHidden && result.flights === 0, temporaryFocusNeighborOverlaps: result.focusNeighborOverlaps });
}

try {
  for (const mobile of [true, false]) {
    const { page, room } = await player(mobile);
    const names = room.seats.map(seat => seat.name);
    const fixtures = [
      ['full-rivers', new MahjongGame({ seed: 'full-river-layout-2026', names, laizi: true })],
      ['maximum-public-racks', maximumPublicFixture(names)],
      ['maximum-special-hand', maximumSpecialHandFixture(names)],
      ['all-actions', new MahjongGame({ seed: 'full-river-actions-2026', names, laizi: true })],
    ];
    for (const [scenario, fixture] of fixtures) {
      await applyFixture(page, fixture, scenario === 'all-actions');
      for (const screen of screens.filter(screen => (screen.device === 'phone') === mobile)) await measure(page, screen, scenario);
    }
    for (const screen of screens.filter(screen => (screen.device === 'phone') === mobile)) {
      await applyFixture(page, fixtures[0][1]);
      for (const seat of [0, 1, 2, 3]) await stability(page, screen, seat);
    }
  }
  check(report.errors.length === 0, 'browser has no page or console errors', { errors: report.errors });
  report.passed = report.failures.length === 0;
  console.log(JSON.stringify({ passed: report.passed, browser: report.browser, screens, measurements: report.measurements.length, stability: report.stability, screenshots: report.screenshots.length, errors: report.errors, failures: report.failures, report: path.join(output, 'ui-layout-acceptance.json') }, null, 2));
  assert.equal(report.passed, true, `${report.failures.length} layout acceptance checks failed; see output/ui-layout-acceptance.json`);
} catch (error) { report.failure = error.stack; throw error; }
finally {
  writeFileSync(path.join(output, 'ui-layout-acceptance.json'), JSON.stringify(report, null, 2));
  await Promise.allSettled(contexts.map(context => context.close())); await browser.close(); service.close();
  const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed;
}
