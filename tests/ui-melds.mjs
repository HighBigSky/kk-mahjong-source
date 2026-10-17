import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {assertInvariants, collectPhysicalTiles} from '../src/domain/invariants.js';
import {actionFixture, maximumPublicFixture, maximumSpecialHandFixture, scattered} from './pizi-fixtures.mjs';
import {RED_DRAGON} from '../src/domain/tile.js';

let playwright;
try { playwright = createRequire(import.meta.url)('playwright'); }
catch { playwright = createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright'); }
const service = new RoomService({disconnectGraceMs:100});
const server = createServer({roomService:service});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const baseURL = `http://127.0.0.1:${server.address().port}`;
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await playwright.chromium.launch({headless:true, ...(existsSync(edge) ? {executablePath:edge} : {})});
const contexts = [];
const pages = [];
const output = path.resolve('output'); mkdirSync(output, {recursive:true});
const report = {passed:false, errors:[], checks:[], actions:[], viewports:[], screenshots:[], observerChecks:0, fixtureNote:'Action fixtures allocate four real copies of every tile. Commands following each fixture are genuine browser/HTTP/SSE actions; fixtures are not represented as naturally dealt complete rounds.'};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const redact = text => text.replace(/[a-f0-9]{48}/g, '[redacted]');
async function waitFor(test, label, timeout = 8000) {
  const end = Date.now() + timeout;
  while (!await test()) { assert.ok(Date.now() < end, `Timed out: ${label}`); await sleep(20); }
}
async function sync(room) {
  for (const page of pages) await waitFor(() => page.evaluate(version => window.mahjongRoom.room?.version >= version && !window.mahjongRoom.busy, room.version), 'all four SSE states rendered');
}
async function player(name) {
  const context = await browser.newContext({viewport:{width:390, height:844}}); contexts.push(context);
  await context.addInitScript(() => localStorage.setItem('queqi-settings', JSON.stringify({sound:false, laizi:true, names:false})));
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(redact(error.message)));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(redact(message.text())); });
  await page.goto(baseURL, {waitUntil:'domcontentloaded'});
  await page.locator('#room-dialog[open]').waitFor();
  await page.locator('#room-name').fill(name);
  return page;
}
async function publish(room, game) {
  assertInvariants(game); room.game = game; service._changed(room); await sync(room);
}
function expectedGroups(player) {
  return [
    ...player.redGangs.map(code => ({kind:'redGang', codes:[code]})),
    ...player.piziGangs.map(code => ({kind:'piziGang', codes:[code]})),
    ...player.melds.map(meld => ({kind:meld.kind, codes:meld.tiles})),
  ];
}
async function assertAllPublic(room, label) {
  assertInvariants(room.game);
  assert.equal(collectPhysicalTiles(room.game).length, 136);
  for (let viewer = 0; viewer < 4; viewer++) {
    const actual = await pages[viewer].evaluate(() => ({
      groups:[0, 1, 2, 3].map(seat => [...document.querySelectorAll(`#melds-${seat} .meld-group`)].map(group => ({kind:group.dataset.kind, codes:[...group.querySelectorAll('use')].map(use => Number(use.getAttribute('href').split('-').at(-1)))}))),
      adjacent:[0, 1, 2, 3].map(seat => document.querySelector(`#melds-${seat}`).parentElement === document.querySelector(`#rack-${seat}`) && document.querySelector(seat === 0 ? '#hand' : `#backs-${seat}`).parentElement === document.querySelector(`#rack-${seat}`)),
      publicLabels:[...document.querySelectorAll('[id^="melds-"] .meld-group')].every(group => Boolean(group.getAttribute('aria-label'))),
      hiddenHands:window.mahjongGame.players.slice(1).every(player => player.hand.every(code => code === null)),
      handCount:document.querySelectorAll('#hand button').length,
      wallCount:window.mahjongGame.wall.length,
    }));
    const expected = Array.from({length:4}, (_, relative) => expectedGroups(room.game.players[(viewer + relative) % 4]));
    assert.deepEqual(actual.groups, expected, `${label}: viewer ${viewer} sees every actual public tile at the correct relative seat`);
    assert.deepEqual(actual.adjacent, [true, true, true, true], 'public groups share each seat rack with its concealed hand');
    assert.equal(actual.publicLabels, true);
    assert.equal(actual.hiddenHands, true);
    assert.equal(actual.handCount, room.game.players[viewer].hand.length);
    assert.equal(actual.wallCount, room.game.wall.length);
    report.observerChecks++;
  }
}
async function clickCommand(room, seat, action) {
  const page = pages[seat]; const version = room.version;
  if (action.kind === 'chi') {
    await page.locator('#action-chi:visible:enabled').click();
    if (await page.locator('#choice-dialog').evaluate(dialog => dialog.open)) {
      const options = page.locator('#choice-options button');
      for (let index = 0; index < await options.count(); index++) {
        const codes = await options.nth(index).locator('use').evaluateAll(uses => uses.map(use => Number(use.getAttribute('href').split('-').at(-1))));
        if (JSON.stringify(codes) === JSON.stringify(action.sequence)) { await options.nth(index).click(); break; }
      }
    }
  } else if (['redGang', 'piziGang', 'gang'].includes(action.kind)) {
    await page.locator('#action-gang:visible:enabled').click();
    await waitFor(async () => room.version > version || await page.locator('#choice-dialog').evaluate(dialog => dialog.open), 'gang accepted or disambiguated');
    if (await page.locator('#choice-dialog').evaluate(dialog => dialog.open)) {
      const label = action.kind === 'redGang' ? '红中杠' : action.kind === 'piziGang' ? '皮子杠' : action.mode === 'concealed' ? '暗杠' : '补杠';
      let option = page.locator('#choice-options button').filter({hasText:label});
      if (action.kind === 'gang') option = option.filter({has:page.locator(`use[href="assets/tiles.svg#tile-${action.tile}"]`)});
      await option.first().click();
    }
  } else await page.locator(`#action-${action.kind}:visible:enabled`).click();
  await waitFor(() => room.version > version, `server accepts actual browser ${action.kind}`); await sync(room);
  // Real pass responses preserve the normal priority/wait-for-all protocol.
  while (room.game.phase.kind === 'claim') {
    const responder = [0, 1, 2, 3].find(player => room.game.getActions(player).pass);
    assert.notEqual(responder, undefined);
    const before = room.version;
    await pages[responder].locator('#action-pass:visible:enabled').click();
    await waitFor(() => room.version > before, 'other human pass accepted'); await sync(room);
  }
}
async function screenshot(page, filename) {
  const destination = path.join(output, filename); await page.screenshot({path:destination}); report.screenshots.push(destination);
}

try {
  pages.push(await player('公开甲'));
  await pages[0].locator('#room-create').click();
  await pages[0].locator('#room-waiting:not([hidden])').waitFor();
  const code = (await pages[0].locator('#room-current-code').textContent()).trim();
  for (const name of ['公开乙', '公开丙', '公开丁']) {
    const page = await player(name); pages.push(page); await page.locator('#room-code').fill(code); await page.locator('#room-join').click(); await page.locator('#room-waiting:not([hidden])').waitFor();
  }
  const room = service.rooms.get(code);
  await waitFor(() => room.seats.every(seat => seat.connected), 'four independent browser SSE connections');
  for (const page of pages) await page.locator('#room-ready:enabled').click();
  await waitFor(() => room.seats.every(seat => seat.ready), 'four human ready clicks');
  await pages[0].locator('#room-start:enabled').click(); await waitFor(() => room.game, 'real game start'); await sync(room);
  for (const page of pages) await page.locator('#room-dialog:not([open])').waitFor({state:'attached'});
  const names = room.seats.map(seat => seat.name);
  await publish(room, actionFixture({names}));
  for (const kind of ['redGang', 'piziGang']) {
    const tail = room.game.wall[0]; const wallCount = room.game.wall.length;
    await clickCommand(room, 0, {kind});
    assert.equal(room.game.lastDraw.tile, tail);
    assert.equal(room.game.wall.length, wallCount - 1);
    await assertAllPublic(room, `real ${kind}`);
    report.actions.push({kind, absoluteSeat:0, actualBrowserClick:true, fourObservers:true, realTail:true, conservation:136});
  }
  await screenshot(pages[0], 'ui-melds-real-specials-390x844.png');
  const scenarios = [
    {seat:1, hand:[0, 2, ...scattered.filter(tile => tile !== 0 && tile !== 2).slice(0, 11)], discard:1, action:{kind:'chi', sequence:[0, 1, 2]}},
    {seat:2, hand:[27, 27, ...scattered.slice(0, 11)], discard:27, action:{kind:'peng'}},
    {seat:3, hand:[28, 28, 28, ...scattered.slice(0, 10)], discard:28, action:{kind:'gang', tile:28, mode:'exposed'}},
    {seat:1, hand:[29, 29, 29, 29, ...scattered.slice(0, 10)], action:{kind:'gang', tile:29, mode:'concealed'}},
    {seat:2, hand:[30, ...scattered.slice(0, 10)], melds:[{kind:'peng', tiles:[30, 30, 30], from:1, concealed:false}], action:{kind:'gang', tile:30, mode:'added'}},
  ];
  for (const scenario of scenarios) {
    await publish(room, actionFixture({...scenario, names}));
    await clickCommand(room, scenario.seat, scenario.action);
    const meld = room.game.players[scenario.seat].melds.at(-1);
    assert.equal(meld.kind, scenario.action.kind === 'gang' ? 'gang' : scenario.action.kind);
    await assertAllPublic(room, `real ${scenario.action.mode ?? scenario.action.kind}`);
    report.actions.push({kind:scenario.action.kind, mode:scenario.action.mode, absoluteSeat:scenario.seat, actualBrowserClick:true, fourObservers:true, conservation:136});
  }
  report.checks.push('Four real browser sessions create/join/ready/start and submit red kong, indicator kong, chi, peng, exposed kong, concealed kong and added kong; all four relative-seat DOMs match every public snapshot tile while concealed opponents remain private.');

  await publish(room, maximumPublicFixture(names));
  await assertAllPublic(room, 'maximum physical public groups');
  report.maximum = {physicalTiles:collectPhysicalTiles(room.game).length, red:4, indicators:3, ordinaryGangsPerSeat:4, concealedCounts:room.game.players.map(player => player.hand.length), publicTiles:room.game.players.map(player => expectedGroups(player).flatMap(group => group.codes).length)};
  for (const viewport of [{width:375, height:667}, {width:390, height:844}, {width:1080, height:1920}, {width:1440, height:900}]) {
    for (let viewer = 0; viewer < 4; viewer++) {
      const page = pages[viewer]; await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await page.evaluate(() => {
        const rect = element => { const r = element.getBoundingClientRect(); return {left:r.left, right:r.right, top:r.top, bottom:r.bottom}; };
        const publicTiles = [...document.querySelectorAll('[id^="melds-"] .tile')].map((element, index) => ({...rect(element), index, seat:element.closest('[id^="melds-"]').id}));
        const protectedAreas = [...document.querySelectorAll('.river .tile, #wall-tail .wall-piece:not(.is-empty), .opponent .portrait, .backs .back, #hand button, .action-zone:not([hidden]) button:not([hidden]), #hint-btn')].map((element, index) => ({...rect(element), name:element.closest('.river') ? `river ${index}` : element.closest('#wall-tail') ? `wall ${index}` : element.closest('.opponent') ? `avatar ${index}` : element.closest('.backs') ? `concealed ${index}` : element.closest('#hand') ? `hand ${index}` : `button ${index}`}));
        const overlaps = publicTiles.flatMap(tile => protectedAreas.flatMap(area => {
          const width = Math.min(tile.right, area.right) - Math.max(tile.left, area.left);
          const height = Math.min(tile.bottom, area.bottom) - Math.max(tile.top, area.top);
          return width > .5 && height > .5 ? [{tile:tile.index, seat:tile.seat, area:area.name, width, height}] : [];
        }));
        const interTile = publicTiles.flatMap((tile, index) => publicTiles.slice(index + 1).flatMap(other => {
          const width = Math.min(tile.right, other.right) - Math.max(tile.left, other.left);
          const height = Math.min(tile.bottom, other.bottom) - Math.max(tile.top, other.top);
          return width > .5 && height > .5 ? [{tile:tile.index, other:other.index, width, height}] : [];
        }));
        return {publicTiles, overlaps, interTile, pageWidth:document.body.scrollWidth, handCount:document.querySelectorAll('#hand button').length};
      });
      assert.equal(geometry.publicTiles.length, 71);
      assert.ok(geometry.pageWidth <= viewport.width + 1);
      assert.ok(geometry.publicTiles.every(tile => tile.left >= -1 && tile.right <= viewport.width + 1 && tile.top >= -1 && tile.bottom <= viewport.height + 1), `all public faces on screen ${JSON.stringify({viewport, viewer, geometry})}`);
      assert.deepEqual(geometry.overlaps, [], `public faces avoid walls, rivers, avatars, hand and buttons ${JSON.stringify({viewport, viewer})}`);
      assert.deepEqual(geometry.interTile, [], `public faces do not overlap one another ${JSON.stringify({viewport, viewer})}`);
      report.viewports.push({...viewport, viewer, publicTiles:71, handCount:geometry.handCount, noOverlap:true});
      if (viewer === 0 || viewport.width === 390) await screenshot(page, `ui-melds-maximum-seat${viewer}-${viewport.width}x${viewport.height}.png`);
    }
  }
  report.checks.push('Maximum conservation-checked display fixture: one player has all four red + all three indicator kongs + four ordinary gangs, every seat has four ordinary gangs, and every river reaches its visible cap. All 71 public faces fit, avoid other tiles and keep hands/buttons/avatars/walls clear for every viewer at all four viewports.');

  await publish(room, maximumSpecialHandFixture(names));
  await assertAllPublic(room, 'seven special kongs with fourteen concealed tiles');
  report.specialFullHandViewports = [];
  for (const viewport of [{width:375, height:667}, {width:390, height:844}, {width:1080, height:1920}, {width:1440, height:900}]) {
    for (let viewer = 0; viewer < 4; viewer++) {
      const page = pages[viewer]; await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await page.evaluate(() => {
        const rect = element => { const r = element.getBoundingClientRect(); return {left:r.left, right:r.right, top:r.top, bottom:r.bottom}; };
        const publicTiles = [...document.querySelectorAll('[id^="melds-"] .tile')].map(rect);
        const protectedAreas = [...document.querySelectorAll('.river .tile, #wall-tail .wall-piece:not(.is-empty), .opponent .portrait, .backs .back, #hand button, .action-zone:not([hidden]) button:not([hidden]), #hint-btn')].map(rect);
        const overlaps = publicTiles.flatMap((tile, index) => protectedAreas.flatMap((area, target) => {
          const width = Math.min(tile.right, area.right) - Math.max(tile.left, area.left);
          const height = Math.min(tile.bottom, area.bottom) - Math.max(tile.top, area.top);
          return width > .5 && height > .5 ? [{tile:index, target, width, height}] : [];
        }));
        const hand = [...document.querySelectorAll('#hand button')].map(rect);
        return {publicTiles, overlaps, hand, pageWidth:document.body.scrollWidth};
      });
      assert.equal(geometry.publicTiles.length, 7);
      assert.equal(geometry.hand.length, viewer === 0 ? 14 : 13);
      assert.ok(geometry.pageWidth <= viewport.width + 1);
      assert.ok([...geometry.publicTiles, ...geometry.hand].every(tile => tile.left >= -1 && tile.right <= viewport.width + 1 && tile.top >= -1 && tile.bottom <= viewport.height + 1));
      assert.deepEqual(geometry.overlaps, [], `seven special groups remain clear beside a full hand ${JSON.stringify({viewport, viewer})}`);
      report.specialFullHandViewports.push({...viewport, viewer, publicTiles:7, handCount:geometry.hand.length, noOverlap:true});
      if (viewer === 0 && viewport.width === 390) await screenshot(page, 'ui-melds-seven-specials-full-hand-390x844.png');
    }
  }
  report.checks.push('A separate conserved fixture retains a full fourteen-tile hand after all four red + three indicator kongs; all seven public groups stay visible beside full concealed hands for all four viewers at all four target sizes.');

  await publish(room, maximumPublicFixture(names));

  await pages[0].setViewportSize({width:390, height:844});
  await pages[0].evaluate(() => {
    window.__meldNodes = {nodes:[...document.querySelectorAll('[id^="melds-"] *')], players:window.mahjongGame.players, removed:0};
    window.__meldNodes.observer = new MutationObserver(records => { for (const record of records) for (const node of record.removedNodes) if (node.nodeType === 1 && (node.matches('.tile, svg') || node.querySelector('.tile, svg'))) window.__meldNodes.removed++; });
    for (const group of document.querySelectorAll('[id^="melds-"]')) window.__meldNodes.observer.observe(group, {subtree:true, childList:true});
  });
  const unchangedGame = JSON.stringify(room.game); const version = room.version;
  for (const stream of room.seats[0].streams) service._write(stream, service.snapshot(room, 0));
  await pages[0].evaluate(() => new Promise(resolve => {
    const key = 'queqi-room-session';
    const {code, token} = JSON.parse(sessionStorage.getItem(key));
    const probe = new EventSource(`/api/rooms/${code}/events?token=${encodeURIComponent(token)}`);
    probe.addEventListener('state', () => { probe.close(); requestAnimationFrame(() => requestAnimationFrame(resolve)); }, {once:true});
  }));
  assert.equal(await pages[0].evaluate(() => window.__meldNodes.players === window.mahjongGame.players), true, 'same-version snapshot keeps state references');
  for (const index of [0, 1, 0, 1, 0, 1]) await pages[0].locator(`#hand button[data-index="${index}"]`).click();
  const stable = await pages[0].evaluate(() => {
    const current = [...document.querySelectorAll('[id^="melds-"] *')];
    return {retained:current.length === window.__meldNodes.nodes.length && current.every((node, index) => node === window.__meldNodes.nodes[index]), removed:window.__meldNodes.removed};
  });
  assert.deepEqual(stable, {retained:true, removed:0});
  assert.equal(room.version, version); assert.equal(JSON.stringify(room.game), unchangedGame);
  report.stability = {sameVersionSSE:true, localSelections:6, retained:true, removed:0, serverUnchanged:true};
  await pages[0].evaluate(() => { window.__meldNodes.observer.disconnect(); delete window.__meldNodes; });
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally {
  writeFileSync(path.join(output, 'ui-melds.json'), JSON.stringify(report, null, 2));
  await Promise.allSettled(contexts.map(context => context.close())); await browser.close(); service.close();
  const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed;
}
