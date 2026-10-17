import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from '../server.js';
import { RoomService } from '../src/server/rooms.js';
import { MahjongGame, chooseDiscard } from '../engine.js';
import { assertInvariants } from '../src/domain/invariants.js';

// Use the installed browser tooling; no project dependency is needed.
let playwright;
try { playwright = createRequire(import.meta.url)('playwright'); }
catch { playwright = createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright'); }
const service = new RoomService({ botDelayMs: 30, disconnectGraceMs: 100 });
const server = createServer({ roomService: service });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseURL = `http://127.0.0.1:${server.address().port}`;
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await playwright.chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) });
const contexts = [];
const expectedHTTPErrorURLs = new Set();
const output = path.resolve('output');
mkdirSync(output, { recursive: true });
const viewports = [
  { width: 390, height: 844 }, { width: 375, height: 667 },
  { width: 844, height: 390 }, { width: 667, height: 375 },
  { width: 1440, height: 900 }, { width: 1080, height: 1920 },
];
const report = { passed: false, baseURL, checks: [], geometry: [], screenshots: [], errors: [], round: null };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const redact = text => text.replace(/[a-f0-9]{48}/g, '[redacted]');

async function waitFor(test, label, timeout = 8000) {
  const until = Date.now() + timeout;
  while (!await test()) {
    assert.ok(Date.now() < until, `Timed out: ${label}`);
    await sleep(20);
  }
}

async function player(name, mode = 'reject') {
  const context = await browser.newContext({ viewport: viewports[0], hasTouch: true });
  contexts.push(context);
  await context.addInitScript(mode => {
    try { localStorage.setItem('queqi-settings', JSON.stringify({ sound: false, names: false, laizi: false })); }
    catch { /* about:blank has no storage origin. */ }
    window.__orientationCalls = { lock: [], unlock: 0, fullscreen: 0, unhandled: [] };
    window.addEventListener('unhandledrejection', event => window.__orientationCalls.unhandled.push(String(event.reason)));
    const rejected = () => Promise.reject(new DOMException('Orientation unavailable in this browser', 'NotSupportedError'));
    if (screen.orientation) Object.defineProperty(screen.orientation, 'lock', {
      configurable: true,
      value: mode === 'unsupported' ? undefined : kind => { window.__orientationCalls.lock.push(kind); return mode === 'resolve' ? Promise.resolve() : rejected(); },
    });
    if (screen.orientation) Object.defineProperty(screen.orientation, 'unlock', {
      configurable: true,
      value: () => { window.__orientationCalls.unlock++; },
    });
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      value: mode === 'unsupported' ? undefined : () => { window.__orientationCalls.fullscreen++; return rejected(); },
    });
  }, mode);
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(redact(`${name}: ${error.message}`)));
  page.on('console', message => {
    if (message.type() === 'error' && !(expectedHTTPErrorURLs.has(message.location().url) && /\b404\b/.test(message.text()))) report.errors.push(redact(`${name}: ${message.text()}`));
  });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('#room-dialog[open]').waitFor();
  await page.locator('#room-name').fill(name);
  return page;
}

async function screenshot(page, name) {
  const file = path.join(output, `ui-orientation-${name}.png`);
  await page.screenshot({ path: file });
  report.screenshots.push(file);
}

async function sync(page, room) {
  await waitFor(() => page.evaluate(version => window.mahjongRoom.room?.version >= version && !window.mahjongRoom.busy, room.version), 'SSE room version rendered');
}

async function entryPortrait(page, label) {
  await waitFor(() => page.evaluate(() => !document.documentElement.classList.contains('in-room')), `${label}: entry mode`);
  const state = await page.evaluate(() => {
    const game = document.querySelector('#game');
    const box = game.getBoundingClientRect();
    const dialog = document.querySelector('#room-dialog');
    return {
      width: game.clientWidth, height: game.clientHeight,
      inRoom: document.documentElement.classList.contains('in-room'),
      rotated: document.documentElement.classList.contains('landscape-rotated'),
      entryVisible: !document.querySelector('#room-entry').hidden,
      dialogOpen: dialog.open,
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
    };
  });
  assert.equal(state.inRoom, false, label);
  assert.equal(state.rotated, false, label);
  assert.ok(state.height > state.width, `${label}: creation UI has a portrait stage`);
  assert.equal(state.entryVisible, true, label);
  assert.equal(state.dialogOpen, true, label);
  report.checks.push({ label, portrait: true, inRoom: false });
}

async function geometry(page, viewport, label, playing = false) {
  await page.setViewportSize(viewport);
  await waitFor(() => page.evaluate(({ portrait }) => document.documentElement.classList.contains('in-room') && document.documentElement.classList.contains('landscape-rotated') === portrait && document.querySelector('#game').clientWidth > document.querySelector('#game').clientHeight, { portrait: viewport.height > viewport.width }), `${label}: orientation matches viewport`);
  const data = await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const game = document.querySelector('#game');
    const dialog = document.querySelector('dialog[open]');
    const hand = [...document.querySelectorAll('#hand button[data-index]')];
    const visible = element => element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
    const playable = hand.filter(button => !button.disabled && button.getAttribute('aria-disabled') !== 'true');
    const coveredTiles = dialog ? [] : playable.filter(button => {
      const r = rect(button);
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return hit?.closest('#hand button[data-index]') !== button;
    }).map(button => Number(button.dataset.index));
    const table = document.querySelector('.table');
    const areas = ['.table', '.hand-zone', '#opponent-0', '#opponent-1', '#opponent-2', '#opponent-3', '.top-tools', '.action-zone'];
    return {
      inRoom: document.documentElement.classList.contains('in-room'),
      rotated: document.documentElement.classList.contains('landscape-rotated'),
      landscape: game.classList.contains('is-landscape'),
      stage: { width: game.clientWidth, height: game.clientHeight, box: rect(game) },
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      dialog: dialog ? { id: dialog.id, box: rect(dialog), clientWidth: dialog.clientWidth, scrollWidth: dialog.scrollWidth } : null,
      hand: hand.map(button => ({ index: Number(button.dataset.index), box: rect(button), face: !!button.querySelector('svg use') })),
      coveredTiles,
      table: table && rect(table),
      compass: rect(document.querySelector('.table-center')),
      areas: areas.map(selector => [selector, document.querySelector(selector)]).filter(([, element]) => visible(element)).map(([selector, element]) => ({ selector, box: rect(element) })),
    };
  });
  const context = JSON.stringify({ label, viewport, data });
  const inViewport = box => box.left >= -1.1 && box.top >= -1.1 && box.right <= viewport.width + 1.1 && box.bottom <= viewport.height + 1.1;
  assert.equal(data.landscape, true, context);
  assert.ok(data.stage.width > data.stage.height, context);
  assert.equal(data.rotated, viewport.height > viewport.width, context);
  assert.ok(inViewport(data.stage.box), `landscape stage stays inside the physical viewport: ${context}`);
  assert.ok(data.scrollWidth <= viewport.width + 1, `page must not overflow horizontally: ${context}`);
  assert.ok(data.scrollHeight <= viewport.height + 1, `page must not overflow vertically: ${context}`);
  if (data.dialog) {
    assert.ok(inViewport(data.dialog.box), `top-layer modal follows landscape orientation: ${context}`);
    assert.ok(data.dialog.scrollWidth <= data.dialog.clientWidth + 1, `modal has no sideways content overflow: ${context}`);
  }
  if (playing) {
    assert.equal(data.dialog, null, `playing table has no modal: ${context}`);
    assert.ok(data.hand.length >= 13, `complete opening hand is rendered: ${context}`);
    assert.equal(new Set(data.hand.map(tile => tile.index)).size, data.hand.length, 'one button per real hand index');
    assert.ok(data.hand.every(tile => tile.face && tile.box.width > 0 && tile.box.height > 0 && inViewport(tile.box)), `every hand tile is visible: ${context}`);
    assert.deepEqual(data.coveredTiles, [], `all legal hand hit targets are unobstructed: ${context}`);
    assert.ok(inViewport(data.table), `table is visible: ${context}`);
    assert.ok(data.compass.width < Math.min(data.table.width, data.table.height) * .4 && data.compass.height < Math.min(data.table.width, data.table.height) * .4, `compass scales to landscape table height: ${context}`);
    assert.ok(data.areas.every(area => inViewport(area.box)), `major game regions remain inside the screen: ${context}`);
  }
  report.geometry.push({ label, viewport, ...data });
  await screenshot(page, `${label}-${viewport.width}x${viewport.height}`);
}

async function createRoom(page) {
  await page.locator('#room-create').click();
  await page.locator('#room-waiting:not([hidden])').waitFor();
  const code = (await page.locator('#room-current-code').textContent()).trim();
  const room = service.rooms.get(code);
  await waitFor(() => room.seats[0].connected, 'creator connected to SSE');
  await sync(page, room);
  return room;
}

function humanCommand(game) {
  const actions = game.getActions(0);
  if (actions.hu) return { kind: 'hu' };
  if (actions.pass) return { kind: 'pass' };
  if (game.phase.kind !== 'discard' || game.current !== 0) return null;
  if (actions.redGang) return { kind: 'redGang' };
  if (actions.piziGang) return { kind: 'piziGang' };
  if (actions.concealedGangs.length) return { kind: 'gang', mode: 'concealed', tile: actions.concealedGangs[0] };
  if (actions.addedGangs.length) return { kind: 'gang', mode: 'added', tile: actions.addedGangs[0] };
  const visible = [
    ...(game.indicatorTile === null ? [] : [game.indicatorTile]),
    ...game.players.flatMap(player => [...player.discards, ...player.redGangs, ...player.piziGangs, ...player.melds.flatMap(meld => meld.tiles)]),
  ];
  return { kind: 'discard', index: chooseDiscard(game.players[0].hand, game.players[0].melds, visible, game.wildTile, game.indicatorTile) };
}

async function settleBots(room) {
  const until = Date.now() + 8000;
  let version;
  do {
    assert.ok(Date.now() < until, 'bot claims settle');
    version = room.version;
    await sleep(100);
  } while (room.version !== version && room.game.phase.kind !== 'ended');
}

async function clickCommand(page, room, command) {
  const version = room.version;
  if (command.kind === 'discard') {
    assert.ok(command.index >= 0, 'human has a legal discard');
    await page.locator(`#hand button[data-index="${command.index}"]:enabled`).click();
    await page.locator(`#hand button[data-index="${command.index}"]:enabled`).click();
  } else if (['gang', 'redGang', 'piziGang'].includes(command.kind)) {
    await page.locator('#action-gang:enabled').click();
    await waitFor(async () => room.version > version || await page.locator('#choice-dialog').evaluate(dialog => dialog.open), 'kong or choice');
    if (await page.locator('#choice-dialog').evaluate(dialog => dialog.open)) {
      let option = page.locator('#choice-options button').filter({ hasText: command.kind === 'redGang' ? '红中杠' : command.kind === 'piziGang' ? '皮子杠' : command.mode === 'concealed' ? '暗杠' : '补杠' });
      if (command.kind === 'gang') option = option.filter({ has: page.locator(`use[href="assets/tiles.svg#tile-${command.tile}"]`) });
      await option.first().click();
    }
  } else await page.locator(`#action-${command.kind}:enabled`).click();
  await waitFor(() => room.version > version, `real UI ${command.kind} accepted`);
}

try {
  const owner = await player('横屏房主');
  await entryPortrait(owner, 'before creating');
  await screenshot(owner, 'portrait-entry-390x844');
  const room = await createRoom(owner);
  for (const viewport of viewports) await geometry(owner, viewport, 'waiting');
  const safeProperties = await owner.evaluate(() => {
    const root = document.documentElement;
    const previous = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, root.style.getPropertyValue(`--device-safe-${side}`)]));
    for (const [side, value] of Object.entries({ top: 34, right: 8, bottom: 21, left: 12 })) root.style.setProperty(`--device-safe-${side}`, `${value}px`);
    window.dispatchEvent(new Event('resize'));
    return previous;
  });
  await geometry(owner, viewports[0], 'safe-area-waiting');
  const safeStage = report.geometry.at(-1).stage.box;
  assert.ok(safeStage.left >= 11 && safeStage.right <= viewports[0].width - 7 && safeStage.top >= 33 && safeStage.bottom <= viewports[0].height - 20, 'rotated stage respects all simulated asymmetric notch/home-indicator insets');
  await owner.evaluate(previous => {
    for (const [side, value] of Object.entries(previous)) document.documentElement.style.setProperty(`--device-safe-${side}`, value);
    window.dispatchEvent(new Event('resize'));
  }, safeProperties);
  report.checks.push({ asymmetricSafeArea: true, insets: { top: 34, right: 8, bottom: 21, left: 12 } });
  const calls = await owner.evaluate(() => window.__orientationCalls);
  assert.ok(calls.lock.length > 0 && calls.lock.every(kind => kind === 'landscape'), 'native landscape lock is attempted');
  assert.ok(calls.fullscreen > 0, 'touch entry attempts fullscreen inside the create gesture');
  assert.deepEqual(calls.unhandled, [], 'denied orientation/fullscreen requests are handled');
  report.checks.push({ nativeLockRejected: true, fullscreenRejected: true, fallbackEffective: true, lockAttempts: calls.lock.length, fullscreenAttempts: calls.fullscreen });

  const guest = await player('横屏好友', 'unsupported');
  await entryPortrait(guest, 'before joining');
  await guest.locator('#room-code').fill('12');
  await guest.locator('#room-join').click();
  await guest.locator('#room-error:not([hidden])').waitFor();
  await entryPortrait(guest, 'invalid room code remains portrait');
  assert.equal(service.rooms.has('000000'), false);
  expectedHTTPErrorURLs.add(`${baseURL}/api/rooms/000000/join`);
  await guest.locator('#room-code').fill('000000');
  const [notFound] = await Promise.all([
    guest.waitForResponse(response => response.url() === `${baseURL}/api/rooms/000000/join` && response.request().method() === 'POST'),
    guest.locator('#room-join').click(),
  ]);
  assert.equal(notFound.status(), 404);
  await guest.locator('#room-error:not([hidden])').waitFor();
  await entryPortrait(guest, 'nonexistent room remains portrait');
  report.checks.push({ invalidRoomCodeStaysPortrait: true, nonexistentRoom404StaysPortrait: true });
  await guest.locator('#room-code').fill(room.code);
  await guest.locator('#room-join').click();
  await guest.locator('#room-waiting:not([hidden])').waitFor();
  await waitFor(() => room.seats[1]?.connected, 'guest connected');
  await geometry(guest, viewports[0], 'guest-waiting');
  assert.deepEqual(await guest.evaluate(() => window.__orientationCalls.unhandled), []);
  report.checks.push({ orientationAPIUnsupported: true, guestFallbackEffective: true });
  await guest.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(() => guest.evaluate(() => window.mahjongRoom.status === 'connected'), 'guest refresh restores session');
  await geometry(guest, viewports[0], 'guest-restored');
  await guest.locator('#room-leave').click();
  await waitFor(() => room.seats[1] === null, 'guest leaves waiting room');
  await entryPortrait(guest, 'after leaving');
  await screenshot(guest, 'portrait-after-leave-390x844');

  const native = await player('原生横屏房主', 'resolve');
  const nativeRoom = await createRoom(native);
  await geometry(native, viewports[0], 'native-lock-success');
  await waitFor(() => native.evaluate(() => window.__orientationCalls.lock.length > 0), 'successful native lock called');
  await native.locator('#room-leave').click();
  await waitFor(() => !service.rooms.has(nativeRoom.code), 'last native-lock owner leaves room');
  await entryPortrait(native, 'native lock leave restores portrait');
  const nativeCalls = await native.evaluate(() => window.__orientationCalls);
  assert.equal(nativeCalls.unlock, 1, 'leaving releases the owned native orientation lock exactly once');
  assert.deepEqual(nativeCalls.unhandled, []);
  report.checks.push({ nativeLockSuccess: true, leaveUnlocksNativeOrientation: true, unlockCalls: nativeCalls.unlock });

  await owner.setViewportSize(viewports[0]);
  for (const seat of [1, 2, 3]) {
    await owner.locator(`.room-bot-add[data-seat="${seat}"]:visible:enabled`).click();
    await waitFor(() => room.seats[seat]?.bot, `bot ${seat} added`);
    await sync(owner, room);
  }
  await owner.locator('#room-ready:enabled').click();
  await waitFor(() => room.seats.every(seat => seat?.ready), 'all players ready');
  await owner.locator('#room-start:visible:enabled').click();
  await waitFor(() => !!room.game, 'round starts');
  await owner.locator('#room-dialog:not([open])').waitFor({ state: 'attached' });
  const seed = 'online-room-bots-2026';
  room.game = new MahjongGame({ seed, names: room.seats.map(seat => seat.name), laizi: room.laizi });
  service._changed(room);
  await sync(owner, room);
  for (const viewport of viewports) await geometry(owner, viewport, 'playing', true);
  for (const viewport of [viewports[0], viewports[2]]) {
    await owner.setViewportSize(viewport);
    for (const [button, dialog] of [['#settings-rules', '#rules-dialog'], ['#settings-btn', '#settings-dialog']]) {
      // 玩法说明现在挂在右上角设置里：先开设置，再由设置里的入口打开规则。
      await owner.locator('#settings-btn').click();
      await owner.locator('#settings-dialog[open]').waitFor();
      if (button !== '#settings-btn') {
        await owner.locator(button).click();
      }
      await owner.locator(`${dialog}[open]`).waitFor();
      await geometry(owner, viewport, dialog.slice(1));
      await owner.locator(`${dialog} .modal-close`).click();
      await owner.locator(`${dialog}:not([open])`).waitFor({ state: 'attached' });
    }
  }
  report.checks.push({ topLayerRulesAndSettingsFollowOrientation: true });
  await owner.setViewportSize(viewports[0]);
  await owner.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(() => owner.evaluate(() => window.mahjongRoom.status === 'connected' && window.mahjongRoom.game.players[0].hand.length >= 13), 'refresh restores playing state');
  await geometry(owner, viewports[0], 'playing-restored', true);
  report.checks.push({ createImmediatelyLandscape: true, joinImmediatelyLandscape: true, resizeBothDirections: true, leaveRestoresPortrait: true, refreshKeepsLandscape: true });

  // Complete an actual HTTP/SSE round through rotated browser hit targets.
  const clicks = { discard: 0, pass: 0, redGang: 0, piziGang: 0, gang: 0, hu: 0 };
  let invariantChecks = 0;
  const deadline = Date.now() + 120000;
  while (room.game.phase.kind !== 'ended') {
    assert.ok(Date.now() < deadline, 'landscape round must not stall');
    assertInvariants(room.game);
    invariantChecks++;
    if (!humanCommand(room.game)) { await sleep(20); continue; }
    await settleBots(room);
    if (room.game.phase.kind === 'ended') break;
    const command = humanCommand(room.game);
    if (!command) continue;
    await sync(owner, room);
    await clickCommand(owner, room, command);
    clicks[command.kind]++;
  }
  assertInvariants(room.game);
  await sync(owner, room);
  await owner.locator('#result-dialog[open]').waitFor();
  await geometry(owner, viewports[0], 'result');
  assert.ok(clicks.discard > 0, 'human really discarded via rotated UI');
  report.round = { seed, clicks, invariantChecks, result: room.game.result.kind, winner: room.game.winner, scores: room.game.players.map(player => player.score), conservation: 136 };
  report.checks.push({ realBrowserRoundCompleted: true, resultDialogLandscape: true, rotatedButtonsClickable: true });
  for (const context of contexts) for (const page of context.pages()) assert.deepEqual(await page.evaluate(() => window.__orientationCalls?.unhandled ?? []), [], 'no unhandled orientation promises');
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, geometryChecks: report.geometry.length, viewports, screenshots: report.screenshots.length, errors: report.errors, round: report.round, report: path.join(output, 'ui-orientation.json') }, null, 2));
} catch (error) {
  report.failure = redact(error.stack);
  throw error;
} finally {
  writeFileSync(path.join(output, 'ui-orientation.json'), JSON.stringify(report, null, 2));
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser.close();
  service.close();
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
}
