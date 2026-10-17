import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from '../server.js';
import { RoomService } from '../src/server/rooms.js';
import { MahjongGame } from '../engine.js';

// Browser tooling stays outside this zero-dependency application.
const require = createRequire(import.meta.url);
let playwright;
for (const source of [
  () => require('playwright'),
  () => createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright'),
  () => createRequire(path.join(process.env.TEMP || '', 'pwtest', 'package.json'))('playwright-core'),
]) {
  try { playwright = source(); break; } catch { /* Try the next installed browser runtime. */ }
}
assert.ok(playwright, 'An installed Playwright runtime is required');

const viewports = [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 932, height: 430 },
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
  { width: 1280, height: 1024 },
];
const output = path.resolve('output');
mkdirSync(output, { recursive: true });
const report = {
  passed: false,
  browser: '',
  createdAt: new Date().toISOString(),
  fixture: 'The opening is dealt by MahjongGame and delivered over HTTP/SSE. Filled rivers are a local visual stress fixture, not a claim that this tile allocation is a legal round.',
  geometry: [], screenshots: [], errors: [], failures: [], mutations: [], clicks: [], actionTrials: [],
};
const service = new RoomService({ botDelayMs: 60000, disconnectGraceMs: 100 });
const server = createServer({ roomService: service });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseURL = `http://127.0.0.1:${server.address().port}`;
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await playwright.chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) });
report.browser = browser.version();
const context = await browser.newContext({ viewport: viewports[0], hasTouch: true, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  localStorage.setItem('queqi-settings', JSON.stringify({ sound: false, names: false, laizi: true }));
  // Force the browser's CSS orientation fallback; headless fullscreen is not a physical phone.
  if (screen.orientation) Object.defineProperty(screen.orientation, 'lock', {
    configurable: true, value: () => Promise.reject(new DOMException('Headless fallback', 'NotSupportedError')),
  });
  Object.defineProperty(Element.prototype, 'requestFullscreen', {
    configurable: true, value: () => Promise.reject(new DOMException('Headless fallback', 'NotSupportedError')),
  });
});
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (!await test()) { assert.ok(Date.now() < end, `Timed out: ${label}`); await wait(20); }
}
function check(value, message, data) {
  if (!value) report.failures.push({ message, ...data });
}

async function measure(viewport, label) {
  await page.setViewportSize(viewport);
  await page.evaluate(async () => {
    window.dispatchEvent(new Event('resize'));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.renderMahjong();
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
  const data = await page.evaluate(() => {
    const box = element => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const visible = element => {
      const r = element.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
    };
    const collect = selector => [...document.querySelectorAll(selector)].filter(visible).map((element, index) => {
      const rack = element.closest('[id^="rack-"]');
      const stack = element.closest('.wall-stack');
      const owner = rack?.id || (stack ? `wall-${stack.dataset.side}` : null);
      return { id: element.id || `${owner || selector}[${element.dataset.position || index}]`, owner, ...box(element) };
    });
    const hit = (a, b) => a.right > b.x + .5 && b.right > a.x + .5 && a.bottom > b.y + .5 && b.bottom > a.y + .5;
    const groups = Object.fromEntries([['bottom', 0], ['right', 1], ['top', 2], ['left', 3]].map(([name, index]) => [name, collect(`#river-${index} .tile`)]));
    const obstacleGroups = {
      compass: collect('.table-center'),
      wall: collect('#wall-tail .wall-piece:not(.is-empty)'),
      rack: collect('.opponent-rack .back,.opponent-rack .tile,#hand button,.my-melds .tile'),
      seat: collect('.player-seat'),
    };
    const structures = {
      rack: collect('.opponent-rack .back,.opponent-rack .tile,.my-melds .tile'),
      wall: obstacleGroups.wall,
    };
    const messages = collect('.turn-message,.last-event');
    const uiObstacles = {
      seat: obstacleGroups.seat,
      topbar: collect('.wallet-pill,.wall-pill,.laizi-summary,.top-tools > *'),
      hand: collect('#hand button'),
      action: collect('.action-zone button'),
    };
    const structureOverlaps = {};
    for (const [kind, sources] of Object.entries(structures)) {
      for (const [targetKind, targets] of Object.entries(uiObstacles)) {
        const pairs = [];
        for (const source of sources) for (const target of targets) {
          if (hit(source, target)) pairs.push(`${source.id}/${target.id}`);
        }
        structureOverlaps[`${kind}/${targetKind}`] = pairs;
      }
    }
    structureOverlaps['rack/wall'] = [];
    for (const source of structures.rack) for (const target of structures.wall) {
      if (hit(source, target)) structureOverlaps['rack/wall'].push(`${source.id}/${target.id}`);
    }
    for (const [kind, targets] of Object.entries({ seat: uiObstacles.seat, wall: structures.wall, hand: uiObstacles.hand })) {
      structureOverlaps[`message/${kind}`] = [];
      for (const source of messages) for (const target of targets) {
        if (hit(source, target)) structureOverlaps[`message/${kind}`].push(`${source.id}/${target.id}`);
      }
    }
    const overlaps = { river: [], compass: [], wall: [], rack: [], seat: [] };
    for (const [name, tiles] of Object.entries(groups)) {
      for (let index = 0; index < tiles.length; index++) {
        const tile = tiles[index];
        for (const [otherName, otherTiles] of Object.entries(groups)) {
          if (name > otherName) continue;
          for (let otherIndex = 0; otherIndex < otherTiles.length; otherIndex++) {
            if (name === otherName && index >= otherIndex) continue;
            if (hit(tile, otherTiles[otherIndex])) overlaps.river.push(`${name}:${index}/${otherName}:${otherIndex}`);
          }
        }
        for (const [kind, obstacles] of Object.entries(obstacleGroups)) {
          for (const obstacle of obstacles) if (hit(tile, obstacle)) overlaps[kind].push(`${name}:${index}/${obstacle.id}`);
        }
      }
    }
    const hand = [...document.querySelectorAll('#hand button')].map(button => {
      const r = box(button);
      const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        index: Number(button.dataset.index), box: r,
        legal: !button.disabled && button.getAttribute('aria-disabled') !== 'true',
        hit: target?.closest('#hand button') === button,
      };
    });
    const actionButtons = [...document.querySelectorAll('.action-zone button')].filter(visible).map(button => {
      const r = box(button);
      const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { id: button.id, box: r, enabled: !button.disabled, hit: target?.closest('button') === button };
    });
    const first = selector => document.querySelector(selector) ? box(document.querySelector(selector)) : null;
    return {
      stage: { width: document.querySelector('#game').clientWidth, height: document.querySelector('#game').clientHeight, box: first('#game') },
      rotated: document.documentElement.classList.contains('landscape-rotated'),
      table: first('.table'), compass: first('.table-center'), dice: collect('.table-die'),
      hand, counts: Object.fromEntries(Object.entries(groups).map(([name, tiles]) => [name, tiles.length])),
      riverTile: Object.values(groups).flat()[0] || null,
      opponentBack: collect('.opponent-rack .back')[0] || null,
      wallPiece: obstacleGroups.wall[0] || null,
      overlaps, overlapCounts: Object.fromEntries(Object.entries(overlaps).map(([kind, pairs]) => [kind, pairs.length])),
      structures, messages, structureOverlaps,
      publicPerSeat: [0, 1, 2, 3].map(seat => ({ seat, groups: document.querySelectorAll(`#melds-${seat} .meld-group`).length, tiles: document.querySelectorAll(`#melds-${seat} .tile`).length, concealed: document.querySelectorAll(seat === 0 ? '#hand button' : `#backs-${seat} .back`).length })),
      structureOverlapCounts: Object.fromEntries(Object.entries(structureOverlaps).map(([kind, pairs]) => [kind, pairs.length])),
      actionButtons,
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    };
  });
  const inViewport = b => b.x >= -1.1 && b.y >= -1.1 && b.right <= viewport.width + 1.1 && b.bottom <= viewport.height + 1.1;
  check(inViewport(data.stage.box), 'stage outside viewport', { viewport, label, box: data.stage.box });
  check(data.hand.length >= 13 && data.hand.every(tile => inViewport(tile.box)), 'hand outside viewport or incomplete', { viewport, label });
  check(data.hand.filter(tile => tile.legal).every(tile => tile.hit), 'hand hit target obstructed', { viewport, label, hand: data.hand.filter(tile => tile.legal && !tile.hit) });
  check(data.document.width <= viewport.width + 1 && data.document.height <= viewport.height + 1, 'document scroll overflow', { viewport, label, document: data.document });
  check(Object.values(data.overlapCounts).every(count => count === 0), 'river overlaps', { viewport, label, overlapCounts: data.overlapCounts });
  check(Object.values(data.structureOverlapCounts).every(count => count === 0), 'rack/wall overlap with UI or each other', { viewport, label, overlapCounts: data.structureOverlapCounts });
  check(data.structures.rack.length > 0 && data.structures.wall.length > 0, 'rack/wall measurement has no visible DOM nodes', { viewport, label });
  const outside = Object.entries(data.structures).flatMap(([kind, nodes]) => nodes.filter(node => !inViewport(node)).map(node => ({ kind, ...node })));
  check(outside.length === 0, 'rack/wall tiles outside viewport', { viewport, label, outside });
  check(data.actionButtons.every(button => inViewport(button.box) && button.hit), 'action button outside viewport or obstructed', { viewport, label, buttons: data.actionButtons });
  if (label === 'filled') check(data.counts.top === 12 && data.counts.bottom === 12 && data.counts.left === 6 && data.counts.right === 6, 'river limit differs from 12/6', { viewport, counts: data.counts });
  const filename = path.join(output, `reference-${label}-${viewport.width}x${viewport.height}.png`);
  await page.screenshot({ path: filename });
  report.screenshots.push(filename);
  report.geometry.push({ viewport, label, ...data });
  return data;
}

async function unchangedRenders(label) {
  const stats = await page.evaluate(async () => {
    const targets = { hand: document.querySelector('#hand'), rivers: [...document.querySelectorAll('.river')] };
    const stats = { iterations: 20, hand: { records: 0, added: 0, removed: 0 }, rivers: { records: 0, added: 0, removed: 0 } };
    const observers = [];
    for (const kind of ['hand', 'rivers']) {
      const observer = new MutationObserver(records => {
        for (const record of records) {
          stats[kind].records++;
          stats[kind].added += record.addedNodes.length;
          stats[kind].removed += record.removedNodes.length;
        }
      });
      for (const target of [targets[kind]].flat()) observer.observe(target, { childList: true, subtree: true });
      observers.push(observer);
    }
    const start = performance.now();
    for (let iteration = 0; iteration < 20; iteration++) window.renderMahjong();
    stats.durationMs = Number((performance.now() - start).toFixed(2));
    await Promise.resolve();
    for (const observer of observers) observer.disconnect();
    return stats;
  });
  check(stats.hand.records === 0 && stats.rivers.records === 0, 'unchanged renders alter hand/river children', { label, stats });
  report.mutations.push({ label, ...stats });
}

try {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('#room-dialog[open]').waitFor();
  await page.locator('#room-name').fill('版式验收');
  await page.locator('#room-create').click();
  await page.locator('#room-waiting:not([hidden])').waitFor();
  const code = (await page.locator('#room-current-code').textContent()).trim();
  const room = service.rooms.get(code);
  await until(() => room.seats[0].connected, 'owner SSE connected');
  for (const seat of [1, 2, 3]) {
    await page.locator(`.room-bot-add[data-seat="${seat}"]:visible:enabled`).click();
    await until(() => room.seats[seat]?.bot, `bot ${seat} added`);
  }
  await page.locator('#room-ready:enabled').click();
  await until(() => room.seats.every(seat => seat?.ready), 'four seats ready');
  await page.locator('#room-start:visible:enabled').click();
  await until(() => !!room.game, 'real round started');
  room.game = new MahjongGame({ seed: 'reference-layout-2026', names: room.seats.map(seat => seat.name), laizi: room.laizi });
  service._changed(room);
  await until(() => page.evaluate(version => window.mahjongRoom.room?.version >= version && !window.mahjongRoom.busy, room.version), 'fixed opening rendered over SSE');
  await page.locator('#room-dialog:not([open])').waitFor({ state: 'attached' });
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));
  for (const viewport of viewports) {
    await measure(viewport, 'opening');
    const button = page.locator('#hand button[aria-disabled="false"]').first();
    check(await button.count() > 0, 'no selectable opening tile', { viewport });
    if (await button.count()) {
      await button.click();
      const selected = await button.getAttribute('aria-pressed') === 'true';
      report.clicks.push({ viewport, selected });
      check(selected, 'real browser hand selection failed', { viewport });
      await page.evaluate(() => window.renderMahjong());
    }
  }
  await unchangedRenders('opening');
  await page.evaluate(() => {
    const game = window.mahjongGame;
    game.players.forEach((player, index) => { player.discards = Array.from({ length: 24 }, (_, tile) => (index * 7 + tile) % 34); });
    game.pendingDiscard = null;
    window.renderMahjong();
  });
  for (const viewport of viewports) await measure(viewport, 'filled');
  await unchangedRenders('filled');
  await page.evaluate(() => {
    const game = window.mahjongGame;
    game.pendingDiscard = { from: 1, tile: 0 };
    game.phase = { kind: 'claim', discard: game.pendingDiscard };
    game.getActions = () => ({ chi: [[0, 1, 2]], peng: true, gang: true, hu: true, pass: true, redGang: false, piziGang: false, wildGang: false, concealedGangs: [], addedGangs: [] });
    window.renderMahjong();
  });
  for (const viewport of viewports) {
    const data = await measure(viewport, 'all-actions');
    check(data.actionButtons.length === 5 && data.actionButtons.every(button => button.enabled), 'all five response actions must be visible/enabled in visual fixture', { viewport, buttons: data.actionButtons });
    for (const action of ['chi', 'peng', 'gang', 'hu', 'pass']) {
      try {
        await page.locator(`#action-${action}`).click({ trial: true, timeout: 1500 });
        report.actionTrials.push({ viewport, action, reachable: true });
      } catch (error) {
        report.actionTrials.push({ viewport, action, reachable: false });
        check(false, 'real browser actionability trial failed', { viewport, action, error: error.message });
      }
    }
  }
  check(report.errors.length === 0, 'browser console/page errors', { errors: report.errors });
  report.passed = report.failures.length === 0;
  console.log(JSON.stringify({
    passed: report.passed, browser: report.browser, viewports: viewports.length,
    screenshots: report.screenshots.length, errors: report.errors,
    failedChecks: report.failures.length,
    mutations: report.mutations,
    actionTrials: { passed: report.actionTrials.filter(item => item.reachable).length, total: report.actionTrials.length },
    geometry: report.geometry.map(({ viewport, label, overlapCounts, structureOverlapCounts }) => ({
      case: `${label} ${viewport.width}x${viewport.height}`,
      riverOverlaps: Object.values(overlapCounts).reduce((a, b) => a + b, 0),
      structureOverlaps: Object.fromEntries(Object.entries(structureOverlapCounts).filter(([, count]) => count > 0)),
    })),
    report: path.join(output, 'reference-layout.json'),
  }, null, 2));
  assert.equal(report.passed, true, `${report.failures.length} layout checks failed; see output/reference-layout.json`);
} catch (error) {
  report.failure = error.stack;
  throw error;
} finally {
  writeFileSync(path.join(output, 'reference-layout.json'), JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
  service.close();
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
}
