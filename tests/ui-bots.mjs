import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from '../server.js';
import { RoomService } from '../src/server/rooms.js';
import { MahjongGame, chooseDiscard } from '../engine.js';
import { assertInvariants } from '../src/domain/invariants.js';

// Use an installed Playwright runtime; this project has no package dependency.
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
const output = path.resolve('output');
mkdirSync(output, { recursive: true });
const report = { baseURL, steps: [], errors: [], screenshots: [], viewports: [], round: null };
const contexts = [];
const gameViewports = [{ width: 640, height: 360 }, { width: 844, height: 390 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const redact = text => text.replace(/[a-f0-9]{48}/g, '[redacted]');

async function waitFor(test, message, timeout = 8000) {
  const until = Date.now() + timeout;
  while (!await test()) {
    assert.ok(Date.now() < until, `Timed out: ${message}`);
    await sleep(20);
  }
}

async function openPlayer(name, url = baseURL) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  contexts.push(context);
  await context.addInitScript(() => {
    try { localStorage.setItem('queqi-settings', JSON.stringify({ sound: false, names: false, laizi: false })); }
    catch { /* about:blank intentionally has no local storage origin. */ }
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(redact(error.message)));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(redact(`${name}: ${message.text()} (${message.location().url})`)); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#room-dialog[open]').waitFor();
  await page.locator('#room-name').fill(name);
  return page;
}

async function createRoom(page) {
  await page.locator('#room-create').click();
  await page.locator('#room-waiting:not([hidden])').waitFor();
  const code = (await page.locator('#room-current-code').textContent()).trim();
  const room = service.rooms.get(code);
  await waitFor(() => room.seats[0].connected, 'owner SSE connected');
  return room;
}

async function synchronized(pages, room) {
  const version = room.version;
  await Promise.all(pages.map(page => waitFor(() => page.evaluate(version => window.mahjongRoom.room?.version >= version && !window.mahjongRoom.busy, version), 'browser synchronized with room')));
}

async function settleBots(room) {
  const deadline = Date.now() + 8000;
  let version;
  do {
    assert.ok(Date.now() < deadline, 'pending bot decisions settle');
    version = room.version;
    await sleep(100);
  } while (room.version !== version && room.game.phase.kind !== 'ended');
}

async function addBot(page, room, relativeSeat, absoluteSeat = relativeSeat) {
  const version = room.version;
  await page.locator(`.room-bot-add[data-seat="${relativeSeat}"]:visible:enabled`).click();
  await waitFor(() => room.version > version && room.seats[absoluteSeat]?.bot, `bot added to seat ${absoluteSeat}`);
  await synchronized([page], room);
  assert.equal(room.seats[absoluteSeat].ready, true);
  assert.equal(room.seats[absoluteSeat].connected, true);
}

async function screenshot(page, name) {
  const file = path.join(output, name);
  await page.screenshot({ path: file });
  report.screenshots.push(file);
}

async function assertRevealedHands(page, room, viewer = 0) {
  assert.equal(room.game.phase.kind, 'ended');
  assert.equal(room.game.result.kind, 'win');
  const actual = await page.evaluate(() => {
    const codeOf = tile => {
      const href = tile.querySelector('svg use')?.getAttribute('href');
      const match = href?.match(/^assets\/tiles\.svg#tile-(\d+)$/);
      return match ? Number(match[1]) : null;
    };
    return {
      own: [...document.querySelectorAll('#hand button[data-index]')].map(button => ({
        index: Number(button.dataset.index), code: codeOf(button), disabled: button.disabled,
      })),
      opponents: [1, 2, 3].map(seat => {
        const rack = document.querySelector(`#backs-${seat}`);
        return {
          seat, backs: rack.querySelectorAll('.back').length,
          revealed: rack.classList.contains('is-revealed'),
          codes: [...rack.querySelectorAll('.tile')].map(codeOf),
        };
      }),
    };
  });
  const expected = Array.from({ length: 4 }, (_, seat) => [...room.game.players[(viewer + seat) % 4].hand]);
  assert.equal(actual.own.length, expected[0].length, 'own hand keeps every real tile after Hu');
  assert.equal(new Set(actual.own.map(tile => tile.index)).size, expected[0].length, 'own data-index values remain unique');
  for (const tile of actual.own) {
    assert.ok(tile.index >= 0 && tile.index < expected[0].length, 'own data-index points to the real hand');
    assert.equal(tile.code, expected[0][tile.index], `own SVG matches server hand index ${tile.index}`);
    assert.equal(tile.disabled, true, 'ended hand cannot discard');
  }
  for (const opponent of actual.opponents) {
    assert.equal(opponent.backs, 0, `seat ${opponent.seat} has no concealed backs after Hu`);
    assert.equal(opponent.revealed, true, `seat ${opponent.seat} is marked revealed`);
    assert.deepEqual(opponent.codes, expected[opponent.seat], `seat ${opponent.seat} SVG faces match the relative server hand`);
  }
  return { viewer, ownTiles: actual.own.length, opponentTiles: actual.opponents.map(opponent => opponent.codes.length), exactServerFaces: true };
}

async function checkDialog(page, viewport, expectedAdd, expectedRemove) {
  await page.setViewportSize(viewport);
  assert.equal(await page.locator('.room-bot-add:visible').count(), expectedAdd);
  assert.equal(await page.locator('.room-bot-remove:visible').count(), expectedRemove);
  const geometry = await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const game = document.querySelector('#game');
    const rect = r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
    const dialog = document.querySelector('#room-dialog');
    const box = dialog.getBoundingClientRect();
    return {
      bodyWidth: document.body.scrollWidth,
      dialog: { x: box.x, right: box.right, top: box.top, bottom: box.bottom, width: box.width },
      portrait: game.clientWidth < game.clientHeight && !document.documentElement.classList.contains('in-game'),
      contentFits: dialog.scrollWidth <= dialog.clientWidth + 1,
      buttons: [...dialog.querySelectorAll('.room-bot-add, .room-bot-remove')]
        .filter(button => button.getClientRects().length)
        .map(button => ({ ...rect(button.getBoundingClientRect()), text: button.textContent })),
    };
  });
  assert.equal(geometry.portrait, true, 'waiting room keeps the portrait lobby');
  assert.ok(geometry.bodyWidth <= viewport.width + 1, 'page must not overflow horizontally');
  assert.ok(geometry.contentFits, 'room dialog content must not overflow horizontally');
  assert.ok(geometry.dialog.x >= -1 && geometry.dialog.right <= viewport.width + 1 && geometry.dialog.top >= -1 && geometry.dialog.bottom <= viewport.height + 1, 'waiting dialog remains inside the physical screen');
  assert.ok(geometry.buttons.every(button => button.left >= geometry.dialog.x && button.right <= geometry.dialog.right && button.width >= 44 && button.height >= 36), 'buttons retain their touch-target dimensions and fit the dialog width');
  // A short dialog may scroll, but every operation must remain reachable.
  for (const button of await page.locator('.room-bot-add:visible, .room-bot-remove:visible').all()) {
    await button.scrollIntoViewIfNeeded();
    assert.ok(await button.isVisible());
    const box = await button.boundingBox();
    assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, 'each scrolled bot operation is reachable inside the physical screen');
  }
  await page.locator('#room-current-code').scrollIntoViewIfNeeded();
  report.viewports.push({ ...viewport, dialog: true, portrait: true, noOverflow: true, addButtons: expectedAdd, removeButtons: expectedRemove });
  await screenshot(page, `ui-bots-room-${viewport.width}x${viewport.height}.png`);
}

async function checkGame(page) {
  for (const viewport of gameViewports) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const stage = document.querySelector('#game'), box = stage.getBoundingClientRect();
      return { landscape: stage.classList.contains('is-landscape'), width: stage.clientWidth, height: stage.clientHeight,
        left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight };
    });
    assert.equal(geometry.landscape, true, 'bot game uses the shared landscape surface');
    assert.ok(geometry.width / geometry.height >= 16 / 9 - .01, 'bot game keeps the same landscape layout');
    assert.ok(geometry.left >= -1 && geometry.right <= viewport.width + 1 && geometry.top >= -1 && geometry.bottom <= viewport.height + 1, 'bot game stays inside its viewport');
    assert.ok(geometry.scrollWidth <= viewport.width + 1 && geometry.scrollHeight <= viewport.height + 1, 'bot game has no page overflow');
    report.viewports.push({ ...viewport, landscape: true, stageRatio: 'at-least-16:9', noOverflow: true });
  }
  await page.setViewportSize({ width: 844, height: 390 });
}

function humanCommand(game, player) {
  const actions = game.getActions(player);
  if (actions.hu) return { kind: 'hu' };
  if (actions.pass) return { kind: 'pass' };
  if (game.phase.kind !== 'discard' || game.current !== player) return null;
  if (actions.redGang) return { kind: 'redGang' };
  if (actions.piziGang) return { kind: 'piziGang' };
  if (actions.concealedGangs.length) return { kind: 'gang', mode: 'concealed', tile: actions.concealedGangs[0] };
  if (actions.addedGangs.length) return { kind: 'gang', mode: 'added', tile: actions.addedGangs[0] };
  const visible = [
    ...(game.indicatorTile === null ? [] : [game.indicatorTile]),
    ...game.players.flatMap(seat => [...seat.discards, ...seat.redGangs, ...seat.piziGangs, ...seat.melds.flatMap(meld => meld.tiles)]),
  ];
  return { kind: 'discard', index: chooseDiscard(game.players[player].hand, game.players[player].melds, visible, game.wildTile, game.indicatorTile) };
}

async function clickCommand(page, room, command) {
  const version = room.version;
  if (command.kind === 'discard') {
    assert.ok(command.index >= 0, 'human has a legal discard');
    await page.locator(`#hand button[data-index="${command.index}"]:enabled`).click();
    await page.locator(`#hand button[data-index="${command.index}"]:enabled`).click();
  } else if (['gang', 'redGang', 'piziGang'].includes(command.kind)) {
    await page.locator('#action-gang:enabled').click();
    await waitFor(async () => room.version > version || await page.locator('#choice-dialog').evaluate(dialog => dialog.open), 'gang sent or choice opened');
    if (await page.locator('#choice-dialog').evaluate(dialog => dialog.open)) {
      let option = page.locator('#choice-options button').filter({ hasText: command.kind === 'redGang' ? '红中杠' : command.kind === 'piziGang' ? '痞子杠' : command.mode === 'concealed' ? '暗杠' : '补杠' });
      if (command.kind === 'gang') option = option.filter({ has: page.locator(`use[href="assets/tiles.svg#tile-${command.tile}"]`) });
      await option.first().click();
    }
  } else await page.locator(`#action-${command.kind}:enabled`).click();
  await waitFor(() => room.version > version, `human ${command.kind} accepted`);
}

async function startRoom(owner, room, humans = [owner]) {
  for (const page of humans) await page.setViewportSize({ width: 844, height: 390 });
  for (const page of humans) await page.locator('#room-ready:enabled').click();
  await waitFor(() => room.seats.every(seat => seat?.ready && seat.connected), 'humans and bots ready');
  await owner.locator('#room-start:enabled').click();
  await waitFor(() => !!room.game, 'game started');
  for (const page of humans) await page.locator('#room-dialog:not([open])').waitFor({ state: 'attached' });
  await synchronized(humans, room);
  for (const page of humans) assert.equal(await page.evaluate(() => {
    const stage = document.querySelector('#game');
    return stage.classList.contains('is-landscape') && stage.clientWidth / stage.clientHeight >= 16 / 9 - .01;
  }), true, 'started room uses the shared landscape game');
  assertInvariants(room.game);
}

try {
  const owner = await openPlayer('独乐房主');
  const room = await createRoom(owner);
  assert.equal(await owner.locator('.room-bot-add:visible').count(), 3);
  await addBot(owner, room, 1);
  assert.equal(await owner.locator('.room-bot-remove[data-seat="1"]').textContent(), '移除人机');
  await owner.locator('.room-bot-remove[data-seat="1"]:enabled').click();
  await waitFor(() => room.seats[1] === null, 'bot removed and seat freed');
  await synchronized([owner], room);
  assert.equal(await owner.locator('.room-bot-add[data-seat="1"]:visible').count(), 1);
  for (const seat of [1, 2, 3]) await addBot(owner, room, seat);
  assert.equal(room.seats.filter(seat => seat?.bot).length, 3);
  for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) await checkDialog(owner, viewport, 0, 3);
  report.steps.push('Owner added, removed and re-added bots through actual room buttons; bots auto-ready; 360×640 and 390×844 portrait waiting dialogs fit and operations remain reachable.');
  await startRoom(owner, room);
  const seed = 'online-room-bots-2026';
  room.game = new MahjongGame({ seed, names: room.seats.map(seat => seat.name), laizi: room.laizi });
  service._changed(room);
  await synchronized([owner], room);
  const beforeHuman = JSON.stringify(room.game);
  await sleep(180);
  assert.equal(JSON.stringify(room.game), beforeHuman, 'bots cannot play the human dealer turn');
  assert.equal(room.game.current, 0);
  await checkGame(owner);
  await screenshot(owner, 'ui-bots-playing-844x390.png');
  report.steps.push('One human + three bots started normally; human dealer remained untouched while idle.');
  const clicks = { discard: 0, pass: 0, redGang: 0, piziGang: 0, gang: 0, hu: 0 };
  let humanActions = 0;
  let invariantChecks = 0;
  let observedBotDiscard = false;
  let observedBotMeld = false;
  const fullRoundDeadline = Date.now() + 120000;
  while (room.game.phase.kind !== 'ended') {
    assert.ok(Date.now() < fullRoundDeadline, 'one human + three bots complete a full round without stalling');
    assertInvariants(room.game);
    invariantChecks++;
    observedBotDiscard ||= room.game.players.slice(1).some(player => player.discards.length > 0);
    observedBotMeld ||= room.game.players.slice(1).some(player => player.melds.length > 0 || player.redGangs.length > 0);
    if (!humanCommand(room.game, 0)) { await sleep(20); continue; }
    // Let all pending bot claim responses settle before the human acts. The human
    // response remains pending and cannot be submitted by a bot during this wait.
    await settleBots(room);
    if (room.game.phase.kind === 'ended') break;
    const command = humanCommand(room.game, 0);
    if (!command) continue;
    await synchronized([owner], room);
    await clickCommand(owner, room, command);
    clicks[command.kind]++;
    humanActions++;
  }
  assertInvariants(room.game);
  assert.ok(humanActions > 0);
  assert.ok(observedBotDiscard, 'bots actually discard');
  await synchronized([owner], room);
  await owner.locator('#result-dialog[open]').waitFor();
  assert.equal(await owner.locator('.room-bot-add:visible, .room-bot-remove:visible').count(), 0, 'bot controls only appear before play');
  await screenshot(owner, 'ui-bots-result.png');
  report.round = { seed, humanActions, clicks, result: room.game.result.kind, winner: room.game.winner, scores: room.game.players.map(player => player.score), botDiscard: observedBotDiscard, botMeldOrRedGang: observedBotMeld, invariantChecks, conservation: 136 };
  report.steps.push(`One human + three bots completed a real browser round (${humanActions} human clicks); server bots discarded/responded automatically; tile invariants passed and result dialog appeared.`);
  if (room.game.result.kind === 'win') {
    report.round.revealedHands = await assertRevealedHands(owner, room);
    await owner.locator('#result-dialog [data-close]').click();
    await owner.locator('#result-dialog:not([open])').waitFor({ state: 'attached' });
    await screenshot(owner, 'ui-bots-revealed-hands-844x390.png');
    report.steps.push('After Hu, own data-index SVG faces and all three bot racks exactly matched the relative server hands; no concealed backs remained; the result dialog closed to reveal the table.');
  }

  const host = await openPlayer('双人房主');
  const mixed = await createRoom(host);
  await addBot(host, mixed, 1);
  await addBot(host, mixed, 3);
  const guest = await openPlayer('远方好友', `${baseURL}/?room=${mixed.code}`);
  await guest.locator('#room-join').click();
  await guest.locator('#room-waiting:not([hidden])').waitFor();
  await waitFor(() => mixed.seats[2]?.connected, 'second human occupies absolute seat 2');
  await synchronized([host, guest], mixed);
  assert.equal(await guest.locator('.room-bot-add:visible, .room-bot-remove:visible').count(), 0, 'guest has no owner bot controls');
  assert.equal(await guest.evaluate(() => window.mahjongRoom.room.seats[1].bot), true, 'bot flag rotates with guest seats');
  assert.equal(await guest.evaluate(() => window.mahjongRoom.room.seats[3].bot), true, 'both bot flags rotate');
  await startRoom(host, mixed, [host, guest]);
  const beforeRefresh = JSON.stringify(mixed.game);
  await guest.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(() => guest.evaluate(() => window.mahjongRoom.status === 'connected' && window.mahjongRoom.game.players[0].hand.length >= 13), 'guest refresh restores own hand');
  await synchronized([host, guest], mixed);
  assert.equal(await guest.evaluate(() => window.mahjongRoom.room.seat), 2, 'refresh restores original human seat');
  assert.deepEqual(await guest.evaluate(() => window.mahjongRoom.game.players[0].hand), mixed.game.players[2].hand);
  assert.equal(JSON.stringify(mixed.game), beforeRefresh, 'refresh cannot advance the human dealer');
  report.steps.push('Two humans + two bots joined and started; guest saw no bot management controls; rotated bot flags and refresh restoration matched original seat/hand.');
  await guest.goto('about:blank');
  await waitFor(() => !mixed.seats[2].connected, 'offline human marked disconnected');
  await synchronized([host], mixed);
  assert.equal(await host.evaluate(() => window.mahjongRoom.room.paused), true);
  const paused = JSON.stringify(mixed.game);
  await sleep(300);
  assert.equal(JSON.stringify(mixed.game), paused, 'offline human pauses all bot timers');
  assert.equal(await host.locator('#hand button:not(:disabled)').count(), 0);
  await screenshot(host, 'ui-bots-disconnected-paused.png');
  await guest.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await waitFor(() => mixed.seats[2].connected, 'guest reconnects');
  await synchronized([host, guest], mixed);
  assert.equal(await guest.evaluate(() => window.mahjongRoom.room.seat), 2);
  assert.equal(await host.evaluate(() => window.mahjongRoom.room.paused), false);
  assert.equal(JSON.stringify(mixed.game), paused, 'reconnection leaves human turn pending');
  const botBefore = mixed.game.players.filter((_, seat) => mixed.seats[seat].bot).reduce((sum, player) => sum + player.discards.length, 0);
  // The host dealer may hold red dragons, so clear self-kongs before discarding.
  for (let moves = 0; mixed.game.phase.kind === 'discard' && mixed.game.current === 0 && moves < 5; moves++) {
    await synchronized([host], mixed);
    const command = humanCommand(mixed.game, 0);
    await clickCommand(host, mixed, command);
    if (command.kind === 'discard') break;
  }
  const resumeDeadline = Date.now() + 10000;
  while (mixed.game.phase.kind !== 'ended' && mixed.game.players.filter((_, seat) => mixed.seats[seat].bot).reduce((sum, player) => sum + player.discards.length, 0) <= botBefore) {
    assert.ok(Date.now() < resumeDeadline, 'bot responses resume after reconnect');
    for (const [seat, page] of [[0, host], [2, guest]]) {
      await settleBots(mixed);
      const command = humanCommand(mixed.game, seat);
      if (!command) continue;
      await synchronized([page], mixed);
      await clickCommand(page, mixed, command);
    }
  }
  assertInvariants(mixed.game);
  report.steps.push('Disconnecting the second human paused all bot timers and disabled actions; reconnect restored seat 2; bots resumed after the next real human command.');

  const firstOwner = await openPlayer('初任房主');
  const rotated = await createRoom(firstOwner);
  const newOwner = await openPlayer('接任房主', `${baseURL}/?room=${rotated.code}`);
  await newOwner.locator('#room-join').click();
  await newOwner.locator('#room-waiting:not([hidden])').waitFor();
  await waitFor(() => rotated.seats[1]?.connected, 'future owner occupies absolute seat 1');
  await synchronized([firstOwner, newOwner], rotated);
  await firstOwner.locator('#room-leave').click();
  await waitFor(() => rotated.owner === 1 && rotated.seats[0] === null, 'ownership transfers to human at absolute seat 1');
  await synchronized([newOwner], rotated);
  await addBot(newOwner, rotated, 3, 0);
  assert.equal(await newOwner.evaluate(() => window.mahjongRoom.room.seats[3].bot), true, 'relative seat 3 maps to absolute seat 0');
  await newOwner.locator('.room-bot-remove[data-seat="3"]:enabled').click();
  await waitFor(() => rotated.seats[0] === null, 'rotated remove maps to absolute seat 0');
  await synchronized([newOwner], rotated);
  await addBot(newOwner, rotated, 3, 0);
  await addBot(newOwner, rotated, 1, 2);
  await addBot(newOwner, rotated, 2, 3);
  await startRoom(newOwner, rotated);
  await waitFor(() => rotated.game.phase.kind === 'ended' || rotated.game.players[0].discards.length > 0 || rotated.game.getActions(1).pass, 'bot at absolute seat 0 plays as dealer');
  assertInvariants(rotated.game);
  assert.equal(rotated.seats[1].bot, false);
  assert.equal(await newOwner.evaluate(() => window.mahjongRoom.room.seat), 1);
  report.steps.push('After original owner left, absolute seat 1 became owner; relative seat 3 correctly added/removed the absolute-seat-0 bot, and that bot played the dealer turn.');
  assert.deepEqual(report.errors, []);
  writeFileSync(path.join(output, 'ui-bots.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser.close();
  service.close();
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
}
