import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from '../server.js';
import { RoomService } from '../src/server/rooms.js';
import { MahjongGame, chooseDiscard } from '../engine.js';
import { RED_DRAGON } from '../src/domain/tile.js';
import { assertInvariants } from '../src/domain/invariants.js';

let playwright;
try { playwright = createRequire(import.meta.url)('playwright'); }
catch { playwright = createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright'); }
const service = new RoomService({ disconnectGraceMs: 200 });
const server = createServer({ roomService: service });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseURL = `http://127.0.0.1:${server.address().port}`;
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await playwright.chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) });
const output = path.resolve('output');
mkdirSync(output, { recursive: true });
const report = { baseURL, steps: [], errors: [], expectedHttpErrors: [], screenshots: [], viewports: [], actionVisibility: { checks: 0, empty: 0, shown: { chi: 0, peng: 0, gang: 0, hu: 0, pass: 0 } } };
const contexts = [];
const expectedRejectedNames = new WeakSet();
const redact = text => text.replace(/[a-f0-9]{48}/g, '[redacted]');

async function waitFor(test, message, timeout = 5000) {
  const until = Date.now() + timeout;
  while (!await test()) {
    assert.ok(Date.now() < until, `Timed out: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function openPlayer(name, viewport = { width: 390, height: 844 }, url = baseURL) {
  const context = await browser.newContext({ viewport });
  contexts.push(context);
  await context.addInitScript(() => {
    try { localStorage.setItem('queqi-settings', JSON.stringify({ sound: false, names: false, laizi: false })); }
    catch { /* about:blank has no storage origin during the intentional disconnect. */ }
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(redact(error.message)));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    // Only this deliberately submitted bad nickname is allowed to return HTTP 400.
    const invalidName = expectedRejectedNames.has(page) && message.location().url === `${baseURL}/api/rooms`
      && /^Failed to load resource:.*\b400\b/.test(message.text());
    if (invalidName) report.expectedHttpErrors.push('Intentional invalid-nickname POST /api/rooms: 400');
    else report.errors.push(redact(message.text()));
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#room-dialog[open]').waitFor();
  await page.locator('#room-name').fill(name);
  return page;
}

async function synchronized(pages, room) {
  const version = room.version;
  await Promise.all(pages.map(page => waitFor(() => page.evaluate(version => window.mahjongRoom.room?.version >= version && !window.mahjongRoom.busy, version), 'four browser snapshots at server version')));
  for (const page of pages) await checkActionVisibility(page, room);
}

async function checkActionVisibility(page, room) {
  const actual = await page.evaluate(() => {
    const visible = element => element.getClientRects().length > 0;
    return {
      seat: window.mahjongRoom.room.seat,
      zone: visible(document.querySelector('.action-zone')),
      shown: [...document.querySelectorAll('.action-button')].filter(visible).map(button => button.dataset.action),
      enabled: [...document.querySelectorAll('.action-button:not(:disabled)')].map(button => button.dataset.action),
    };
  });
  const actions = room.game && !room.seats.some(seat => !seat.connected) ? room.game.getActions(actual.seat) : null;
  const expected = actions ? [
    ...(actions.chi.length ? ['chi'] : []),
    ...(actions.peng ? ['peng'] : []),
    ...(actions.redGang || actions.piziGang || actions.gang || actions.concealedGangs.length || actions.addedGangs.length ? ['gang'] : []),
    ...(actions.hu ? ['hu'] : []),
    ...(actions.pass ? ['pass'] : []),
  ] : [];
  assert.deepEqual(actual.shown, expected, 'only currently legal actions occupy visible space');
  assert.deepEqual(actual.enabled, expected, 'hidden actions cannot be submitted');
  assert.equal(actual.zone, expected.length > 0, 'empty action zone is hidden');
  report.actionVisibility.checks++;
  if (!expected.length) report.actionVisibility.empty++;
  for (const action of expected) report.actionVisibility.shown[action]++;
}

function nextCommand(game) {
  const player = game.phase.kind === 'discard' ? game.current : [0, 1, 2, 3].find(seat => game.getActions(seat).pass);
  assert.ok(Number.isInteger(player), 'claim phase needs an eligible human');
  const actions = game.getActions(player);
  let action;
  if (actions.hu) action = { kind: 'hu', selfDraw: game.phase.kind === 'discard' };
  else if (game.phase.kind === 'claim') action = { kind: 'pass' };
  else if (actions.redGang) action = { kind: 'redGang' };
  else if (actions.piziGang) action = { kind: 'piziGang' };
  else if (actions.concealedGangs.length) action = { kind: 'gang', mode: 'concealed', tile: actions.concealedGangs[0] };
  else if (actions.addedGangs.length) action = { kind: 'gang', mode: 'added', tile: actions.addedGangs[0] };
  else {
    const visible = game.players.flatMap(seat => [...seat.discards, ...seat.redGangs, ...seat.piziGangs, ...seat.melds.flatMap(meld => meld.tiles)]);
    action = { kind: 'discard', index: chooseDiscard(game.players[player].hand, game.players[player].melds, visible, game.wildTile, game.indicatorTile) };
  }
  return { player, action: { ...action, player } };
}

async function clickCommand(page, room, action) {
  const version = room.version;
  if (action.kind === 'discard') {
    const tile = page.locator(`#hand button[data-index="${action.index}"]`);
    await tile.click();
    await tile.click();
  } else if (['gang', 'redGang', 'piziGang'].includes(action.kind)) {
    await page.locator('#action-gang:enabled').click();
    await waitFor(async () => room.version > version || await page.locator('#choice-dialog').evaluate(dialog => dialog.open), 'gang executed or choices opened');
    if (await page.locator('#choice-dialog').evaluate(dialog => dialog.open)) {
      let option = page.locator('#choice-options button').filter({ hasText: action.kind === 'redGang' ? '红中杠' : action.kind === 'piziGang' ? '皮子杠' : action.mode === 'concealed' ? '暗杠' : '补杠' });
      if (action.kind === 'gang') option = option.filter({ has: page.locator(`use[href="assets/tiles.svg#tile-${action.tile}"]`) });
      await option.first().click();
    }
  } else await page.locator(`#action-${action.kind}:enabled`).click();
  await waitFor(() => room.version > version, `server accepted browser ${action.kind}`);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const game = window.mahjongGame;
    return { hand: [...game.players[0].hand], players: game.players.map(player => ({ name: player.name, hand: [...player.hand], discards: [...player.discards] })), phase: game.phase, current: game.current, events: [...game.events], wall: game.wall.length, roomText: document.querySelector('#room-label').textContent, connection: document.querySelector('#connection-status').dataset.state };
  });
}

async function checkHandSelectionStability(page, room) {
  const before = { version: room.version, events: await page.evaluate(() => [...window.mahjongGame.events]), game: JSON.stringify(room.game), url: page.url() };
  let navigations = 0;
  const navigated = frame => { if (frame === page.mainFrame()) navigations++; };
  page.on('framenavigated', navigated);
  const selectable = await page.evaluate(() => {
    const containers = [...document.querySelectorAll('#hand, .river, [id^="melds-"], [id^="backs-"], #indicator-tile, #wild-tile')];
    const regression = {
      containers: containers.map(element => ({ element, nodes: [...element.querySelectorAll('*')] })),
      players: window.mahjongGame.players,
      removedFaces: 0,
    };
    regression.observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.removedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && (node.matches('.tile, .back, svg') || node.querySelector('.tile, .back, svg'))) regression.removedFaces++;
      }
    });
    regression.observer.observe(document.querySelector('#game'), { childList: true, subtree: true });
    window.__handSelectionRegression = regression;
    return [...document.querySelectorAll('#hand button[aria-disabled="false"]')].map(button => Number(button.dataset.index));
  });
  assert.ok(selectable.length >= 2, 'initial dealer hand has two ordinary selectable tiles');
  const readSelection = () => page.evaluate(() => {
    const regression = window.__handSelectionRegression;
    const indices = selector => [...document.querySelectorAll(selector)].map(button => Number(button.dataset.index));
    return {
      selected: indices('#hand button.selected'),
      hinted: indices('#hand button.hinted'),
      pressed: indices('#hand button[aria-pressed="true"]'),
      focused: document.activeElement?.id || document.activeElement?.dataset.index,
      nodesRetained: regression.containers.every(({ element, nodes }) => {
        const current = [...element.querySelectorAll('*')];
        return element.isConnected && current.length === nodes.length && current.every((node, index) => node === nodes[index]);
      }),
      removedFaces: regression.removedFaces,
      events: [...window.mahjongGame.events],
      version: window.mahjongRoom.room.version,
    };
  });
  const unchanged = async label => {
    const state = await readSelection();
    assert.equal(state.nodesRetained, true, `${label}: hand buttons/SVG, rivers, melds, backs and indicator nodes retain identity`);
    assert.equal(state.removedFaces, 0, `${label}: local UI input must not remove and repaint tile faces`);
    assert.equal(state.version, before.version, `${label}: no network move submitted`);
    assert.deepEqual(state.events, before.events, `${label}: game log unchanged`);
    assert.equal(room.version, before.version);
    assert.equal(JSON.stringify(room.game), before.game, `${label}: server game unchanged`);
    assert.equal(navigations, 0, `${label}: no document navigation`);
    assert.equal(page.url(), before.url);
    return state;
  };
  try {
    for (let click = 0; click < 6; click++) {
      const index = selectable[click % 2];
      await page.locator(`#hand button[data-index="${index}"]`).click();
      const state = await unchanged(`ordinary tile click ${click + 1}`);
      assert.deepEqual(state.selected, [index]);
      assert.deepEqual(state.pressed, [index]);
      assert.deepEqual(state.hinted, []);
      assert.equal(state.focused, String(index), 'selected tile keeps keyboard focus');
    }
    const previous = selectable[1];
    await page.keyboard.press('ArrowRight');
    const right = selectable[(selectable.indexOf(previous) + 1) % selectable.length];
    let state = await unchanged('ArrowRight');
    assert.deepEqual(state.selected, [right]);
    assert.deepEqual(state.pressed, [right]);
    assert.equal(state.focused, String(right));
    await page.keyboard.press('ArrowLeft');
    state = await unchanged('ArrowLeft');
    assert.deepEqual(state.selected, [previous]);
    assert.deepEqual(state.pressed, [previous]);
    assert.equal(state.focused, String(previous));

    const actions = room.game.getActions(0);
    await page.locator('#hint-btn').click();
    state = await unchanged('discard hint');
    if (actions.redGang || actions.piziGang) {
      assert.deepEqual(state.selected, []);
      assert.deepEqual(state.hinted, []);
      assert.equal(state.focused, 'action-gang', 'red dragon hint directs focus to the legal kong action');
    } else {
      const visible = [...room.game.players.flatMap(player => [...player.discards, ...player.redGangs, ...player.piziGangs, ...player.melds.flatMap(meld => meld.tiles)]), ...(room.game.indicatorTile == null ? [] : [room.game.indicatorTile])];
      const expected = chooseDiscard(room.game.players[0].hand, room.game.players[0].melds, visible, room.game.wildTile, room.game.indicatorTile);
      assert.deepEqual(state.hinted, [expected]);
      assert.deepEqual(state.selected, [expected]);
      assert.deepEqual(state.pressed, [expected]);
    }
    const redIndex = room.game.players[0].hand.indexOf(RED_DRAGON);
    if (redIndex >= 0) {
      const selectionBeforeRed = state;
      // ARIA marks red dragons undiscardable, but the physical click explains how to kong them.
      await page.locator(`#hand button[data-index="${redIndex}"]`).click({ force: true });
      state = await unchanged('red dragon click');
      assert.deepEqual(state.selected, selectionBeforeRed.selected);
      assert.deepEqual(state.hinted, selectionBeforeRed.hinted);
      assert.match(await page.locator('#toast').textContent(), /红中只能/);
    }
    const beforeRefresh = state;
    for (const stream of room.seats[0].streams) service._write(stream, service.snapshot(room, 0));
    await waitFor(() => page.evaluate(() => window.mahjongGame.players !== window.__handSelectionRegression.players), 'same-version SSE snapshot received');
    state = await unchanged('same-version server snapshot');
    assert.deepEqual(state.selected, beforeRefresh.selected, 'same-version snapshot preserves local selection');
    assert.deepEqual(state.hinted, beforeRefresh.hinted, 'same-version snapshot preserves local hint');
    report.selectionStability = { clicks: 6, arrowKeys: 2, hint: actions.redGang ? 'redGang' : 'discard', redClick: redIndex >= 0, sameVersionSnapshot: true, nodesRetained: true, removedFaces: 0, navigations: 0, gameUnchanged: true };
    report.steps.push('Alternating hand clicks, arrow keys, hint and same-version SSE retained tile nodes and local selection without navigation or any game action; red dragon click checked when dealt.');
  } finally {
    page.off('framenavigated', navigated);
    await page.evaluate(() => {
      window.__handSelectionRegression.observer.disconnect();
      delete window.__handSelectionRegression;
      window.renderMahjong();
    });
  }
}

async function screenshot(page, name) {
  const file = path.join(output, name);
  await page.screenshot({ path: file });
  report.screenshots.push(file);
}

try {
  const pages = [];
  pages.push(await openPlayer('房主甲'));
  // Invalid markup is rejected and never inserted as executable HTML.
  await pages[0].locator('#room-name').fill('<img src=x>');
  expectedRejectedNames.add(pages[0]);
  await pages[0].locator('#room-create').click();
  await pages[0].locator('#room-error:not([hidden])').waitFor();
  await pages[0].waitForTimeout(50);
  expectedRejectedNames.delete(pages[0]);
  assert.equal(await pages[0].locator('#room-members img').count(), 0);
  await pages[0].locator('#room-name').fill('房主甲');
  await pages[0].locator('#room-create').click();
  await pages[0].locator('#room-waiting:not([hidden])').waitFor();
  const code = (await pages[0].locator('#room-current-code').textContent()).trim();
  assert.match(code, /^\d{6}$/);
  await pages[0].locator('#room-copy').click();
  await waitFor(async () => (await pages[0].locator('#toast').textContent()).includes('邀请') || (await pages[0].locator('#room-status').textContent()).includes('复制'), 'copy invitation feedback');
  report.steps.push(`Created room ${code}; invalid markup name rejected; invitation copy feedback shown.`);
  for (const name of ['好友乙', '好友丙', '好友丁']) {
    const invited = name === '好友乙';
    const page = await openPlayer(name, undefined, invited ? `${baseURL}/?room=${code}` : baseURL);
    if (invited) assert.equal(await page.locator('#room-code').inputValue(), code, 'invitation link prefills the room code');
    else await page.locator('#room-code').fill(code);
    await page.locator('#room-join').click();
    await page.locator('#room-waiting:not([hidden])').waitFor();
    pages.push(page);
  }
  const room = service.rooms.get(code);
  await waitFor(() => room.seats.every(seat => seat?.connected), 'all four SSE clients connected');
  assert.equal(new Set(room.seats.map(seat => seat.token)).size, 4);
  for (const page of pages) {
    assert.equal((await page.locator('#room-current-code').textContent()).trim(), code);
    assert.equal(await page.locator('#room-members .room-member-name').filter({ hasText: '等待好友' }).count(), 0);
    await page.locator('#room-ready').click();
  }
  await waitFor(() => room.seats.every(seat => seat.ready), 'all four ready');
  await pages[0].locator('#room-start:enabled').waitFor();
  await screenshot(pages[0], 'online-room-ready.png');
  await pages[0].locator('#room-start').click();
  await waitFor(() => !!room.game, 'server dealt round');
  for (const page of pages) {
    await page.locator('#room-dialog:not([open])').waitFor({ state: 'attached' });
    await waitFor(async () => (await snapshot(page)).hand.length >= 13, 'own hand rendered');
  }
  for (let viewer = 0; viewer < 4; viewer++) {
    const state = await snapshot(pages[viewer]);
    assert.deepEqual(state.hand, room.game.players[viewer].hand);
    assert.equal(state.players[0].name, room.seats[viewer].name);
    assert.equal(state.current, (4 - viewer) % 4);
    assert.equal(state.connection, 'connected');
    assert.ok(state.players.slice(1).every(player => player.hand.every(tile => tile === null)));
    assert.equal(await pages[viewer].locator('#hand .tile').count(), state.hand.length);
  }
  report.steps.push('Four independent sessions joined, readied, started; every own hand and seat rotation matched server; opponents concealed.');
  await checkHandSelectionStability(pages[0], room);
  await screenshot(pages[0], 'online-playing-390x844.png');
  const gameBefore = JSON.stringify(room.game);
  // A remote player's refresh must restore the original identity, not join a new seat.
  await pages[2].reload({ waitUntil: 'domcontentloaded' });
  await waitFor(async () => (await snapshot(pages[2])).connection === 'connected' && (await snapshot(pages[2])).hand.length === 13, 'refresh restores player 2');
  assert.equal(JSON.stringify(room.game), gameBefore, 'refresh must not draw or trigger computer play');
  assert.equal((await snapshot(pages[2])).players[0].name, '好友丙');
  const tileIndex = room.game.players[0].hand.findIndex(tile => tile !== RED_DRAGON && tile !== room.game.indicatorTile);
  const discarded = room.game.players[0].hand[tileIndex];
  const button = pages[0].locator(`#hand button[data-index="${tileIndex}"]`);
  await button.click();
  await button.click();
  await waitFor(() => room.game.players[0].discards.length === 1, 'real hand button sends discard');
  for (const page of pages) {
    await waitFor(async () => (await snapshot(page)).players.some(player => player.name === '房主甲' && player.discards.includes(discarded)), 'discard broadcast');
  }
  report.steps.push('Refreshing player 2 recovered their original seat/hand; a real two-click discard synchronized to all four clients.');
  // Human claims use the current enabled pass buttons. There is no local AI advance.
  let passes = 0;
  while (room.game.phase.kind === 'claim' && passes < 4) {
    const seat = [0, 1, 2, 3].find(player => room.game.getActions(player).pass);
    assert.ok(Number.isInteger(seat));
    await pages[seat].locator('#action-pass:enabled').click();
    await waitFor(() => room.game.phase.kind !== 'claim' || !room.game.getActions(seat).pass, 'human pass accepted');
    passes++;
  }
  assert.equal(room.game.phase.kind, 'discard');
  const current = room.game.current;
  for (let viewer = 0; viewer < 4; viewer++) await waitFor(async () => (await snapshot(pages[viewer])).current === (current - viewer + 4) % 4, 'next player synchronized');
  report.steps.push(`Claim responses completed by ${passes} real pass clicks; next human turn synchronized.`);
  const beforeDisconnect = JSON.stringify(room.game);
  await pages[3].goto('about:blank');
  await waitFor(() => !room.seats[3].connected, 'departed browser disconnected');
  await synchronized(pages.slice(0, 3), room);
  for (const page of pages.slice(0, 3)) {
    assert.equal(await page.evaluate(() => window.mahjongRoom.room.paused), true);
    assert.equal(await page.locator('#hand button:not(:disabled)').count(), 0);
    assert.equal(await page.locator('.action-buttons button:not(:disabled)').count(), 0);
  }
  await pages[0].waitForTimeout(600);
  assert.equal(JSON.stringify(room.game), beforeDisconnect, 'offline human must never be replaced by local or server AI');
  await screenshot(pages[0], 'online-disconnected-paused.png');
  await pages[3].goto(baseURL, { waitUntil: 'domcontentloaded' });
  await waitFor(() => room.seats.every(seat => seat.connected), 'returning browser reconnected');
  await synchronized(pages, room);
  assert.equal((await snapshot(pages[3])).players[0].name, '好友丁');
  assert.deepEqual((await snapshot(pages[3])).hand, room.game.players[3].hand);
  assert.equal(JSON.stringify(room.game), beforeDisconnect, 'reconnect must not play a turn');
  report.steps.push('Leaving one browser paused all actions; returning to the original tab restored its seat/hand; no AI takeover or unsolicited turn.');
  const dimensions = [{ width: 375, height: 667 }, { width: 390, height: 844 }, { width: 1080, height: 1920 }, { width: 1440, height: 900 }];
  for (const viewport of dimensions) {
    await pages[0].setViewportSize(viewport);
    const geometry = await pages[0].evaluate(() => {
      const game = document.querySelector('#game').getBoundingClientRect();
      const tiles = [...document.querySelectorAll('#hand button')].map(element => { const r = element.getBoundingClientRect(); return { x: r.x, right: r.right, bottom: r.bottom }; });
      return { width: innerWidth, height: innerHeight, scrollWidth: document.body.scrollWidth, game: { x: game.x, right: game.right, bottom: game.bottom }, tiles };
    });
    assert.ok(geometry.scrollWidth <= viewport.width + 1);
    assert.ok(geometry.tiles.every(tile => tile.x >= geometry.game.x - 1 && tile.right <= geometry.game.right + 1 && tile.bottom <= geometry.game.bottom + 1));
    report.viewports.push({ ...viewport, tiles: geometry.tiles.length, noOverflow: true });
    await screenshot(pages[0], `online-playing-${viewport.width}x${viewport.height}.png`);
  }
  const finished = JSON.stringify(room.game);
  await pages[0].locator('#restart-btn').click();
  await pages[0].locator('#room-dialog[open]').waitFor();
  assert.equal(await pages[0].locator('#room-leave').isDisabled(), true, 'live games cannot silently abandon the seat');
  await pages[0].locator('#room-close').click();
  assert.equal(JSON.stringify(room.game), finished, 'opening room dialog must not advance a turn');
  const seed = 'online-four-friends-2026';
  const names = room.seats.map(seat => seat.name);
  const oracle = new MahjongGame({ seed, names, laizi: room.laizi });
  room.game = new MahjongGame({ seed, names, laizi: room.laizi });
  service._changed(room);
  await synchronized(pages, room);
  const clicks = { discard: 0, pass: 0, redGang: 0, piziGang: 0, gang: 0, hu: 0 };
  let commands = 0;
  while (oracle.phase.kind !== 'ended' && commands < 500) {
    const { player, action } = nextCommand(oracle);
    await clickCommand(pages[player], room, action);
    await synchronized(pages, room);
    assert.equal(oracle.applyAction(player, action), true);
    assert.deepEqual(room.game.events, oracle.events, `exact event parity after browser command ${commands + 1}`);
    assert.deepEqual(room.game.players.map(seat => seat.score), oracle.players.map(seat => seat.score));
    assertInvariants(room.game);
    clicks[action.kind]++;
    commands++;
  }
  assert.ok(commands > 20 && commands < 500);
  assert.equal(room.game.phase.kind, 'ended');
  assert.deepEqual(room.game.result, oracle.result);
  for (let viewer = 0; viewer < 4; viewer++) {
    await pages[viewer].locator('#result-dialog[open]').waitFor();
    const scores = await pages[viewer].evaluate(() => window.mahjongGame.players.map(seat => seat.score));
    assert.deepEqual(scores, [...oracle.players.slice(viewer), ...oracle.players.slice(0, viewer)].map(seat => seat.score));
    assert.equal(await pages[viewer].locator('#next-round').isDisabled(), viewer !== 0);
  }
  await screenshot(pages[0], 'online-four-humans-result.png');
  assert.ok(report.actionVisibility.empty > 0, 'covered turns with no action buttons');
  for (const [action, count] of Object.entries(report.actionVisibility.shown)) assert.ok(count > 0, `covered legal ${action} visibility`);
  report.round = { seed, commands, clicks, result: oracle.result.kind, winner: oracle.winner, scores: oracle.players.map(seat => seat.score), exactEvents: true, events: oracle.events.length, invariantChecks: commands, conservation: 136 };
  await pages[0].locator('#next-round:enabled').click();
  await waitFor(() => room.game.round === 2, 'owner starts next round');
  await synchronized(pages, room);
  assert.equal(room.game.dealer, 1);
  assert.deepEqual(room.game.players.map(seat => seat.score), oracle.players.map(seat => seat.score));
  for (const page of pages) assert.equal(await page.locator('#result-dialog').evaluate(dialog => dialog.open), false);
  assertInvariants(room.game);
  report.steps.push(`All four humans completed ${commands} actual browser actions with exact seeded events/scores; all four result dialogs appeared; owner started round 2 with dealer rotation and preserved scores.`);
  assert.deepEqual(report.errors, []);
  report.steps.push('All four target sizes retained full hands; room dialog does not trigger a turn; no browser errors.');
  writeFileSync(path.join(output, 'ui-multiplayer.json'), JSON.stringify(report, null, 2));
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
