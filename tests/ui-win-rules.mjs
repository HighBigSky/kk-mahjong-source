import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {MahjongGame} from '../engine.js';
import {assertInvariants, collectPhysicalTiles} from '../src/domain/invariants.js';
import {TILE, TILE_TYPE_COUNT, TOTAL_TILE_COUNT} from '../src/domain/tile.js';

let playwright;
try { playwright = createRequire(import.meta.url)('playwright'); }
catch { playwright = createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright'); }
const service = new RoomService({disconnectGraceMs:100});
const server = createServer({roomService:service});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const baseURL = `http://127.0.0.1:${server.address().port}`;
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await playwright.chromium.launch({headless:true, ...(existsSync(edge) ? {executablePath:edge} : {})});
const contexts = [], pages = [];
const output = path.resolve('output'); mkdirSync(output, {recursive:true});
const report = {passed:false, errors:[], scenarios:[], screenshots:[], fixtureNote:'Conservation-checked states allocate 136 real tiles. Hu clicks and rejection requests use real browser/HTTP/SSE connections; these fixtures are not naturally dealt complete rounds.'};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(test, label) {
  const end = Date.now() + 8000;
  while (!await test()) { assert.ok(Date.now() < end, `Timed out: ${label}`); await delay(20); }
}
async function sync(room) {
  for (const page of pages) await waitFor(() => page.evaluate(version => window.mahjongRoom.room?.version >= version && !window.mahjongRoom.busy, room.version), 'four clients render the SSE state');
}
async function newPlayer(name) {
  const context = await browser.newContext({viewport:{width:390, height:844}}); contexts.push(context);
  await context.addInitScript(() => localStorage.setItem('queqi-settings', JSON.stringify({sound:false, laizi:true, names:false})));
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(baseURL, {waitUntil:'domcontentloaded'});
  await page.locator('#room-dialog[open]').waitFor();
  await page.locator('#room-name').fill(name);
  return page;
}
function fixture(room, scenario, round) {
  const game = new MahjongGame({seed:`ui-rule-${round}`, laizi:true, names:room.seats.map(seat => seat.name)});
  game.round = round; game.indicatorTile = TILE.GREEN; game.wildTile = TILE.WHITE;
  game.wallInfo = {dice:[1, 1], indicatorPosition:0, tailDraws:0};
  const pool = Array.from({length:TOTAL_TILE_COUNT}, (_, index) => Math.floor(index / 4));
  const take = tiles => tiles.map(tile => {
    const index = pool.indexOf(tile); assert.ok(index >= 0, `fixture exceeds four copies: ${tile}`);
    return pool.splice(index, 1)[0];
  });
  take([game.indicatorTile]);
  for (const player of game.players) {
    player.hand = []; player.melds = []; player.redGangs = []; player.piziGangs = []; player.discards = [];
  }
  const hand = [...scenario.hand];
  const discard = scenario.claim ? hand.pop() : null;
  game.players[0].hand = take(hand);
  game.players[0].melds = structuredClone(scenario.melds || []);
  take(game.players[0].melds.flatMap(meld => meld.tiles));
  // 先预留真实墙尾补牌，避免其他三家分牌耗尽目标牌；杠仍由浏览器实际提交。
  const tail = scenario.gangReplacement ? take([scenario.tailTile]) : [];
  if (discard !== null) game.players[3].discards = take([discard]);
  for (let seat = 1; seat < 4; seat++) game.players[seat].hand = pool.splice(0, 13);
  game.wall = [...tail, ...pool]; game.current = discard === null ? 0 : 3;
  game.pendingDiscard = discard === null ? null : {tile:discard, from:3};
  game.phase = discard === null ? {kind:'discard', seat:0} : {kind:'claim', discard:game.pendingDiscard};
  game.lastDraw = discard === null ? {player:0, tile:hand.at(-1), index:hand.length - 1, replacement:false} : null;
  game.events = []; game.winner = null; game.result = null; game._responses = Array(4).fill(null);
  assertInvariants(game);
  const physical = collectPhysicalTiles(game);
  for (let tile = 0; tile < TILE_TYPE_COUNT; tile++) assert.equal(physical.filter(code => code === tile).length, 4);
  return game;
}
const chi = {kind:'chi', tiles:[0, 1, 2], from:3, concealed:false};
const peng = {kind:'peng', tiles:[0, 0, 0], from:3, concealed:false};
const scenarios = [
  {name:'closed ordinary hand with two wildcards', hand:[0,1,2,9,10,11,18,19,20,24,25,33,4,33], win:true, label:'屁胡'},
  {name:'opened ordinary hand with two wildcards is blocked', melds:[chi], hand:[9,10,11,18,19,20,24,25,33,4,33], win:false},
  {name:'opened ordinary hand with two wildcards wins after real replacement draw', melds:[chi], hand:[9,10,11,18,19,20,24,25,33,33,TILE.RED], gangReplacement:true, tailTile:4, win:true, label:'屁胡'},
  {name:'opened ordinary hand with one wildcard', melds:[chi], hand:[9,10,11,18,19,20,24,25,26,4,33], win:true, label:'屁胡'},
  {name:'ordinary hand with a nine pair is blocked', melds:[chi], hand:[9,10,11,18,19,20,24,25,26,8,8], win:false},
  {name:'seven pairs needs no Jiang pair', hand:[0,0,2,2,3,3,5,5,6,6,8,8,27,27], win:true, label:'七对'},
  {name:'opened all triplets with two wildcards and non-Jiang pair', melds:[peng], hand:[9,9,9,18,18,18,27,27,33,28,33], win:true, label:'碰碰胡'},
  {name:'opened all Jiang without grouped shape', melds:[{kind:'peng',tiles:[1,1,1],from:3,concealed:false}], hand:[1,4,7,10,13,16,19,22,25,33,33], win:true, label:'将一色'},
  {name:'opened all honors without grouped shape', melds:[{kind:'peng',tiles:[27,27,27],from:3,concealed:false}], hand:[27,28,29,30,30,30,30,33,33,33,33], win:true, label:'风一色'},
  {name:'closed ordinary natural hand cannot claim', claim:true, hand:[0,1,2,9,10,11,18,19,20,24,25,26,4,4], win:false},
  {name:'closed ordinary hand with one wildcard cannot claim', claim:true, hand:[0,1,2,9,10,11,18,19,20,24,25,26,4,33], win:false},
  {name:'closed ordinary hand with two wildcards cannot claim', claim:true, hand:[0,1,2,9,10,11,18,19,20,24,25,33,4,33], win:false},
  {name:'opened ordinary hand with two wildcards cannot claim', claim:true, melds:[chi], hand:[9,10,11,18,19,20,24,25,33,33,4], win:false},
  {name:'opened ordinary hand can claim with one wildcard', claim:true, melds:[chi], hand:[9,10,11,18,19,20,24,25,26,4,33], win:true, label:'屁胡'},
  {name:'closed seven pairs can claim', claim:true, hand:[0,0,2,2,3,3,5,5,6,6,8,8,27,27], win:true, label:'七对'},
  {name:'closed all triplets can claim', claim:true, hand:[0,0,0,9,9,9,18,18,18,27,27,27,6,6], win:true, label:'碰碰胡'},
  {name:'closed all Jiang without grouped shape can claim', claim:true, hand:[1,1,1,4,4,7,7,7,7,10,10,13,16,25], win:true, label:'将一色'},
  {name:'closed all honors without grouped shape can claim', claim:true, hand:[27,27,27,28,28,29,29,29,29,30,30,33,33,33], win:true, label:'风一色'},
];
try {
  pages.push(await newPlayer('规则甲')); await pages[0].locator('#room-create').click();
  await pages[0].locator('#room-waiting:not([hidden])').waitFor();
  const code = (await pages[0].locator('#room-current-code').textContent()).trim();
  for (const name of ['规则乙', '规则丙', '规则丁']) {
    const page = await newPlayer(name); pages.push(page);
    await page.locator('#room-code').fill(code); await page.locator('#room-join').click();
    await page.locator('#room-waiting:not([hidden])').waitFor();
  }
  const room = service.rooms.get(code);
  await waitFor(() => room.seats.every(seat => seat.connected), 'four active SSE clients');
  for (const page of pages) await page.locator('#room-ready:enabled').click();
  await waitFor(() => room.seats.every(seat => seat.ready), 'four ready clicks');
  await pages[0].locator('#room-start:enabled').click(); await waitFor(() => room.game, 'real room start'); await sync(room);
  for (const page of pages) await page.locator('#room-dialog:not([open])').waitFor({state:'attached'});
  let round = 1;
  for (const scenario of scenarios) {
    for (const page of pages) {
      if (await page.locator('#result-dialog').evaluate(dialog => dialog.open)) await page.locator('#result-dialog [data-close]').click();
    }
    room.game = fixture(room, scenario, ++round); service._changed(room); await sync(room);
    if (scenario.gangReplacement) {
      const game = room.game, wallLength = game.wall.length, version = room.version;
      assert.equal(game.getActions(0).hu, false, 'before the kong this is not a winning hand');
      assert.equal(await pages[0].locator('#action-hu').isVisible(), false);
      assert.equal(game.wall[0], scenario.tailTile, 'replacement tile starts at the actual wall tail');
      const command = pages[0].waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/action'));
      const red = pages[0].locator(`#hand button[data-index="${game.players[0].hand.indexOf(TILE.RED)}"]`);
      await red.click(); await red.click();
      assert.equal((await command).postDataJSON().action.kind, 'redGang');
      await waitFor(() => room.version > version, 'real kong command accepted'); await sync(room);
      assert.deepEqual(game.players[0].redGangs, [TILE.RED]);
      assert.equal(game.wall.length, wallLength - 1); assert.equal(game.wallInfo.tailDraws, 1);
      assert.equal(game.lastDraw.player, 0); assert.equal(game.lastDraw.replacement, true);
      assert.equal(game.lastDraw.tile, scenario.tailTile);
      assert.equal(game.players[0].hand.filter(tile => tile === game.wildTile).length, 2);
      assert.deepEqual(game.players.map(player => player.score), [1030, 990, 990, 990], 'kong payment is still immediate and unchanged');
      assertInvariants(game);
    }
    assert.equal(await pages[0].locator('#action-hu').isVisible(), scenario.win, scenario.name);
    if (!scenario.win) {
      const before = JSON.stringify(room.game), version = room.version;
      const rejection = await pages[0].request.post(`${baseURL}/api/rooms/${code}/action`, {
        headers:{Authorization:`Bearer ${room.seats[0].token}`},
        data:{action:{kind:'hu'}, version, requestId:`blocked-rule-${round}`},
      });
      assert.equal(rejection.status(), 409); assert.equal((await rejection.json()).code, 'ILLEGAL_ACTION');
      assert.equal(room.version, version); assert.equal(JSON.stringify(room.game), before);
    } else {
      await pages[0].locator('#action-hu:visible:enabled').click();
      await waitFor(() => room.game.phase.kind === 'ended' || room.game._responses[0]?.action === 'hu', 'real Hu response');
      // Other eligible seats must respond before a winning claim resolves.
      for (let seat = 1; seat < 4 && room.game.phase.kind === 'claim'; seat++) {
        if (!room.game.getActions(seat).pass) continue;
        await sync(room);
        const version = room.version;
        await pages[seat].locator('#action-pass:visible:enabled').click();
        await waitFor(() => room.version > version, 'real pass response');
      }
      await waitFor(() => room.game.phase.kind === 'ended', 'real Hu settlement'); await sync(room);
      assert.equal(room.game.result.selfDraw, !scenario.claim, scenario.name);
      if (scenario.gangReplacement) {
        assert.equal(room.game.result.points, 30, 'base 10 + self draw 10 + replacement win 10');
        assert.deepEqual(room.game.result.breakdown.find(item => item.name === '杠上开花'), {name:'杠上开花', points:10});
        assert.deepEqual(room.game.result.scoreDelta, [120, -40, -40, -40], 'ordinary self draw and already-paid red kong settle once');
        assert.deepEqual(room.game.players.map(player => player.score), [1120, 960, 960, 960]);
      }
      for (const [viewer, page] of pages.entries()) {
        await page.locator('#result-dialog[open]').waitFor();
        assert.ok((await page.locator('#result-detail').textContent()).includes(scenario.label), scenario.name);
        if (scenario.gangReplacement) assert.match(await page.locator('#result-detail').textContent(), /杠上开花/);
        const expectedScores = [...room.game.result.scoreDelta.slice(viewer), ...room.game.result.scoreDelta.slice(0, viewer)];
        assert.deepEqual(await page.evaluate(() => window.mahjongGame.result.scoreDelta), expectedScores);
      }
    }
    assertInvariants(room.game);
    report.scenarios.push({name:scenario.name, mode:scenario.claim ? 'claim' : 'selfDraw', huVisible:scenario.win, fourClients:true, conservation:136, deniedActionUnchanged:!scenario.win, ...(scenario.gangReplacement ? {realKongCommand:true, tailDraws:1, wildcardCount:2, replacementBonus:10, points:room.game.result.points, scoreDelta:room.game.result.scoreDelta} : {})});
    if (scenario.name === 'closed ordinary natural hand cannot claim') {
      const screenshot = path.join(output, 'ui-win-rules-closed-ordinary-no-claim-390x844.png');
      await pages[0].screenshot({path:screenshot}); report.screenshots.push(screenshot);
    }
    if (scenario.label === '将一色') {
      const screenshot = path.join(output, 'ui-win-rules-all-jiang-result-390x844.png');
      await pages[0].screenshot({path:screenshot}); report.screenshots.push(screenshot);
    }
  }
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally {
  writeFileSync(path.join(output, 'ui-win-rules.json'), JSON.stringify(report, null, 2));
  await Promise.allSettled(contexts.map(context => context.close())); await browser.close(); service.close();
  const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed;
}
