import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from '../server.js';
import { RoomService } from '../src/server/rooms.js';

// Reuse installed browser tooling without adding an application dependency.
let playwright;
try { playwright = createRequire(import.meta.url)('playwright'); }
catch { playwright = createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright'); }
const output = path.resolve('output');
mkdirSync(output, { recursive: true });
const report = { passed: false, browser: '', checks: [], geometry: [], screenshots: [], errors: [] };
const service = new RoomService({ botDelayMs: 60000, disconnectGraceMs: 100 });
const server = createServer({ roomService: service });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const baseURL = `http://127.0.0.1:${server.address().port}`;
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await playwright.chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) });
report.browser = browser.version();
const contexts = [];
const portrait = { width: 360, height: 640 };
const landscape = { width: 640, height: 360 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!await test()) { assert.ok(Date.now() < deadline, `Timed out: ${label}`); await sleep(20); }
}
async function state(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => {
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const stage = document.querySelector('#game');
    const guide = document.querySelector('#rotate-guide');
    const room = document.querySelector('#room-dialog');
    return {
      inGame: document.documentElement.classList.contains('in-game'),
      landscape: stage.classList.contains('is-landscape'),
      stage: rect(stage), transform: getComputedStyle(stage).transform,
      coarse: matchMedia('(pointer: coarse)').matches,
      guide: guide?.open || false, room: room.open,
      roomBox: rect(room), status: window.mahjongRoom.room?.status || null,
      scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      calls: window.__orientationCalls,
    };
  });
}
async function capture(page, label) {
  const file = path.join(output, `ui-orientation-${label}.png`);
  await page.screenshot({ path: file }); report.screenshots.push(file);
}
async function player(name, mode, mobile) {
  const context = await browser.newContext({ viewport: portrait, hasTouch: mobile, deviceScaleFactor: 1 }); contexts.push(context);
  await context.addInitScript(mode => {
    localStorage.setItem('queqi-settings', JSON.stringify({ sound: false, names: false, laizi: false }));
    window.__orientationCalls = { lock: [], unlock: 0, fullscreen: 0, unhandled: [] };
    window.addEventListener('unhandledrejection', event => window.__orientationCalls.unhandled.push(String(event.reason)));
    const rejected = () => Promise.reject(new DOMException('Unavailable in browser test', 'NotSupportedError'));
    if (screen.orientation) Object.defineProperty(screen.orientation, 'lock', {
      configurable: true,
      value: mode === 'unsupported' ? undefined : kind => { window.__orientationCalls.lock.push(kind); return mode === 'resolve' ? Promise.resolve() : rejected(); },
    });
    if (screen.orientation) Object.defineProperty(screen.orientation, 'unlock', {
      configurable: true, value: () => { window.__orientationCalls.unlock++; },
    });
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      value: mode === 'unsupported' ? undefined : () => { window.__orientationCalls.fullscreen++; return rejected(); },
    });
  }, mode);
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(`${name}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(`${name}: ${message.text()}`); });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('#room-dialog[open]').waitFor(); await page.locator('#room-name').fill(name);
  return page;
}
async function assertLobby(page, label) {
  await until(() => page.evaluate(() => !document.documentElement.classList.contains('in-game')), label);
  const data = await state(page); const viewport = page.viewportSize();
  assert.equal(data.inGame, false, label); assert.equal(data.landscape, false, label);
  assert.equal(data.guide, false, label); assert.equal(data.room, true, label);
  if (data.coarse) assert.ok(data.stage.height > data.stage.width, `${label}: portrait lobby`);
  assert.ok(data.roomBox.left >= -1 && data.roomBox.right <= viewport.width + 1, `${label}: room horizontal fit`);
  assert.ok(data.roomBox.top >= -1 && data.roomBox.bottom <= viewport.height + 1, `${label}: room vertical fit`);
  assert.ok(data.scroll.width <= viewport.width + 1 && data.scroll.height <= viewport.height + 1, `${label}: no document scroll`);
  report.checks.push({ label, ...data });
}
async function createAndStart(page) {
  await page.locator('#room-create').click(); await page.locator('#room-waiting:not([hidden])').waitFor();
  const code = (await page.locator('#room-current-code').textContent()).trim(); const room = service.rooms.get(code);
  await until(() => room.seats[0].connected, 'owner SSE connected');
  await assertLobby(page, 'waiting stays portrait');
  assert.equal((await state(page)).calls.lock.length, 0, 'room creation must not lock orientation');
  for (const seat of [1, 2, 3]) {
    await page.locator(`.room-bot-add[data-seat="${seat}"]:visible:enabled`).click();
    await until(() => room.seats[seat]?.bot, `bot ${seat} seated`);
  }
  await page.locator('#room-ready:enabled').click(); await until(() => room.seats.every(seat => seat?.ready), 'all ready');
  await page.locator('#room-start:visible:enabled').click();
  await until(async () => room.game && await page.evaluate(() => document.documentElement.classList.contains('in-game')), 'start enters landscape game');
  await page.locator('#room-dialog:not([open])').waitFor({ state: 'attached' }); return room;
}
async function assertGame(page, label, guide) {
  await until(() => page.evaluate(expected => Boolean(document.querySelector('#rotate-guide')?.open) === expected, guide), `${label}: guide state`);
  const data = await state(page); const viewport = page.viewportSize(); const context = `${label}: ${JSON.stringify(data)}`;
  assert.equal(data.inGame, true, context); assert.equal(data.landscape, true, context); assert.equal(data.guide, guide, context);
  assert.ok(data.stage.width + 1 >= data.stage.height * 16 / 9, `${context}: landscape canvas stays at least 16:9`);
  assert.ok(Math.abs(data.stage.width - viewport.width) <= 1 && Math.abs(data.stage.height - Math.min(viewport.height, viewport.width * 9 / 16)) <= 1, `${context}: one canvas fills landscape viewports and centers in taller windows`);
  assert.ok(data.stage.left >= -1 && data.stage.top >= -1 && data.stage.right <= viewport.width + 1 && data.stage.bottom <= viewport.height + 1, `${context}: stage fits viewport`);
  assert.ok(Math.abs((data.stage.left + data.stage.right) / 2 - viewport.width / 2) < 1.1, `${context}: horizontally centered`);
  assert.ok(Math.abs((data.stage.top + data.stage.bottom) / 2 - viewport.height / 2) < 1.1, `${context}: vertically centered`);
  assert.ok(data.scroll.width <= viewport.width + 1 && data.scroll.height <= viewport.height + 1, `${context}: no document scroll`);
  const rotated = await page.evaluate(() => {
    const transform = getComputedStyle(document.querySelector('#game')).transform;
    if (transform === 'none') return false;
    const matrix = new DOMMatrix(transform); return Math.abs(matrix.b) > .001 || Math.abs(matrix.c) > .001;
  });
  assert.equal(rotated, false, 'game stage must never be rotated with CSS');
  assert.deepEqual(data.calls.unhandled, [], 'native orientation rejections are handled');
  report.geometry.push({ label, viewport, ...data }); return data;
}

try {
  for (const mode of ['reject', 'unsupported', 'resolve']) {
    const page = await player(`手机-${mode}`, mode, true);
    await assertLobby(page, `${mode}: creation 360x640`); await capture(page, `${mode}-entry-360x640`);
    const room = await createAndStart(page);
    const data = await assertGame(page, `${mode}: portrait game requires rotation`, true);
    assert.equal(data.coarse, true, 'phone uses coarse input');
    assert.ok((await page.locator('#rotate-guide').textContent()).includes('横屏'), 'guide explains landscape use');
    await capture(page, `${mode}-rotate-guide-360x640`);
    if (mode === 'unsupported') assert.equal(data.calls.lock.length, 0);
    else assert.ok(data.calls.lock.length > 0 && data.calls.lock.every(kind => kind === 'landscape'), 'game entry attempts landscape lock');
    if (mode === 'unsupported') {
      await page.evaluate(() => {
        window.__roundGuideCloses = 0;
        document.querySelector('#rotate-guide').addEventListener('close', () => window.__roundGuideCloses++);
      });
      const previousRound = room.game.round;
      room.game.newRound('orientation-next-round-guide-2026'); service._changed(room);
      await until(() => page.evaluate(round => window.mahjongGame?.round > round && window.mahjongRoom?.status === 'connected', previousRound), 'next-round SSE snapshot reaches portrait phone');
      await assertGame(page, 'unsupported: next round preserves portrait rotation guide', true);
      await sleep(100);
      assert.equal(await page.evaluate(() => window.__roundGuideCloses), 0, 'round transition never closes the active rotation guide');
      await capture(page, 'unsupported-next-round-guide-360x640');
      report.checks.push({ nextRoundSnapshotKeepsRotationGuideOpen: true, nativeOrientationAPI: 'unsupported', viewport: portrait });
    }
    await page.setViewportSize(landscape); await assertGame(page, `${mode}: physical landscape dismisses guide`, false);
    await capture(page, `${mode}-playing-640x360`);
    await page.setViewportSize({ width: 844, height: 390 }); await assertGame(page, `${mode}: phone landscape fills 844x390`, false);
    await capture(page, `${mode}-playing-844x390`);
    await page.setViewportSize(landscape);
    await page.locator('#settings-btn').click(); await page.locator('#settings-home').click();
    await assertLobby(page, `${mode}: room route returns to portrait`);
    await page.setViewportSize(portrait); await assertLobby(page, `${mode}: portrait room route`);
    if (mode === 'resolve') assert.ok((await state(page)).calls.unlock > 0, 'returning to room releases native lock');
    await page.locator('#room-close').click(); await assertGame(page, `${mode}: closing room returns to game`, true);
    await page.locator('#rotate-return').click(); await assertLobby(page, `${mode}: rotation guide returns to room`);
    await page.locator('#room-close').click(); await page.reload({ waitUntil: 'domcontentloaded' });
    await until(() => page.evaluate(() => window.mahjongRoom?.status === 'connected' && window.mahjongRoom.room?.status === 'playing'), 'restore playing session');
    await assertGame(page, `${mode}: refresh restores game and guide`, true);
    await page.setViewportSize(landscape); await assertGame(page, `${mode}: refreshed game accepts landscape`, false);
    report.checks.push({ mode, mobile: true, createWaitingPortrait: true, startLandscape: true, guideTracksPhysicalRotation: true, roomRoutePortrait: true, restoredGameLandscape: true });
  }
  const desktop = await player('PC窗口', 'resolve', false); await assertLobby(desktop, 'desktop creation'); const desktopRoom = await createAndStart(desktop);
  for (const viewport of [portrait, landscape, { width: 844, height: 390 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await desktop.setViewportSize(viewport); const data = await assertGame(desktop, `desktop ${viewport.width}x${viewport.height}`, false);
    assert.equal(data.coarse, false); assert.deepEqual(data.calls.lock, [], 'desktop never locks orientation');
    assert.ok(data.calls.fullscreen > 0, 'desktop warms fullscreen when creating the room');
    await capture(desktop, `desktop-playing-${viewport.width}x${viewport.height}`);
  }
  await desktop.locator('#settings-btn').click(); await desktop.locator('#settings-home').click(); await assertLobby(desktop, 'desktop room route');
  // A deterministic terminal-state fixture checks the result route without
  // coupling this presentation test to bot strategy or a particular winner.
  // Its incoming snapshot must preserve the explicitly selected lobby route,
  // including after the deferred result dialog timer has had time to run.
  desktopRoom.game._finishDraw(); service._changed(desktopRoom);
  await until(() => desktop.evaluate(() => window.mahjongRoom.room?.status === 'ended'), 'ended room snapshot');
  await sleep(500);
  await assertLobby(desktop, 'ended snapshot preserves explicitly selected room route');
  assert.equal(await desktop.locator('#result-dialog').evaluate(dialog => dialog.open), false, 'result timer cannot cover the selected room route');
  await capture(desktop, 'ended-snapshot-preserves-room-route');
  report.checks.push({ endedSnapshotPreservesRoomRoute: true, resultDeferredUntilRoomClosed: true });
  await desktop.locator('#room-close').click();
  await desktop.locator('#result-dialog[open]').waitFor();
  await assertGame(desktop, 'ended game retains landscape', false);
  await desktop.locator('#result-dialog [data-close]').click();
  await desktop.locator('#settings-btn').click(); await desktop.locator('#settings-home').click();
  await assertLobby(desktop, 'ended game room route');
  await desktop.locator('#room-leave:enabled').click(); await assertLobby(desktop, 'leaving returns to room creation');
  assert.equal((await state(desktop)).status, null);
  report.checks.push({ desktopAnyWindowUsesSameLandscape: true, desktopNeverLocksOrShowsGuide: true });
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify({ passed: true, browser: report.browser, checks: report.checks.length, geometry: report.geometry.length, screenshots: report.screenshots.length, errors: report.errors, report: path.join(output, 'ui-orientation.json') }, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally {
  writeFileSync(path.join(output, 'ui-orientation.json'), JSON.stringify(report, null, 2));
  await Promise.allSettled(contexts.map(context => context.close())); await browser.close(); service.close();
  const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed;
}
