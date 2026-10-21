import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from '../server.js';
import { RoomService } from '../src/server/rooms.js';
import { assertInvariants } from '../src/domain/invariants.js';
import { actionFixture, scattered, maximumPublicFixture, maximumSpecialHandFixture } from './pizi-fixtures.mjs';
import { installVisualGeometry } from './browser-geometry.mjs';

let playwright;
try { playwright = createRequire(import.meta.url)('playwright'); }
catch { playwright = createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright'); }
const screens = [
  { width: 640, height: 360, touch: true, ratio: '16:9' },
  { width: 844, height: 390, touch: true, ratio: '19.5:9' },
  { width: 780, height: 360, touch: true, ratio: '19.5:9' },
  { width: 800, height: 360, touch: true, ratio: '20:9' },
  { width: 1920, height: 1080, touch: false, ratio: 'PC 16:9' },
];
const output = path.resolve('output');
mkdirSync(output, { recursive: true });
const report = {
  passed: false, browser: '', screens, geometry: [], hands: [], input: [], failures: [], errors: [], screenshots: [],
  fixtureNote: 'Live rooms are created through HTTP/SSE. Physical fixtures are invariant-checked for input tests. Thirty-six discards per seat are an intentionally impossible, presentation-only stress fixture. Touch is browser emulation, not a physical phone.',
};
const service = new RoomService({ botDelayMs: 600000, disconnectGraceMs: 100 });
const server = createServer({ roomService: service });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseURL = `http://127.0.0.1:${server.address().port}`;
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await playwright.chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) });
report.browser = browser.version();
const contexts = [];
const check = (condition, message, detail = {}) => { if (!condition) report.failures.push({ message, ...detail }); };
const frames = page => page.evaluate(async () => {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await Promise.all(document.querySelector('#hand')?.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})) || []);
});
const inside = (rect, size, tolerance = .9) => rect.left >= -tolerance && rect.right <= size.width + tolerance && rect.top >= -tolerance && rect.bottom <= size.height + tolerance;

async function createPlayer(size) {
  const context = await browser.newContext({ viewport: size, hasTouch: size.touch, isMobile: size.touch, deviceScaleFactor: 1 });
  contexts.push(context);
  await context.addInitScript(() => {
    localStorage.setItem('queqi-settings', JSON.stringify({ sound: false, names: false, laizi: true }));
    Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: () => Promise.reject(new DOMException('Viewport test', 'NotSupportedError')) });
    if (screen.orientation) Object.defineProperty(screen.orientation, 'lock', { configurable: true, value: () => Promise.reject(new DOMException('Viewport test', 'NotSupportedError')) });
  });
  const page = await context.newPage();
  await page.addInitScript(installVisualGeometry);
  page.on('pageerror', error => report.errors.push(error.message));
  let sent = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/action')) sent.push(request.postDataJSON());
  });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.locator('#room-name').fill('第一人称布局验收');
  await page.locator('#room-create').click();
  await page.locator('#room-waiting:not([hidden])').waitFor();
  const room = service.rooms.get((await page.locator('#room-current-code').textContent()).trim());
  for (const seat of [1, 2, 3]) await page.locator(`.room-bot-add[data-seat="${seat}"]`).click();
  await page.locator('#room-ready').click();
  await page.locator('#room-start').click();
  await page.locator('#room-dialog').waitFor({ state: 'hidden' });
  const sync = async () => {
    await page.waitForFunction(version => window.mahjongRoom.room.version >= version && !window.mahjongRoom.busy, room.version);
    await frames(page);
  };
  const publish = async game => {
    clearTimeout(room.botTimer);
    room.botTimer = null;
    game.round = room.game.round + 1;
    assertInvariants(game);
    room.game = game;
    service._changed(room);
    await sync();
    if (await page.locator('#dice-intro').isVisible()) await page.locator('#dice-intro').click();
    await frames(page);
    sent = [];
  };
  return { page, room, publish, sync, sent: () => sent };
}

async function geometry(page) {
  return page.evaluate(() => {
    const boxes = new WeakMap();
    const rect = node => {
      if (boxes.has(node)) return boxes.get(node);
      const r = node.getBoundingClientRect();
      const result = { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, quad:window.visualGeometry.quad(node) };
      boxes.set(node,result); return result;
    };
    const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    const list = selector => [...document.querySelectorAll(selector)].filter(visible).map((node, index) => ({ id: node.id || `${selector}[${index}]`, ...rect(node) }));
    const stage = document.querySelector('#game');
    const table = document.querySelector('.table');
    const style = getComputedStyle(table);
    const surface = getComputedStyle(table, '::before');
    // 零尺寸探针通过浏览器自己的投影获得桌角，不把 CSS 透视参数再实现一遍。
    const point = (x, y) => {
      const probe = document.createElement('i');
      probe.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:0;height:0;pointer-events:none`;
      table.append(probe);
      const r = probe.getBoundingClientRect();
      probe.remove();
      return { x: r.left, y: r.top };
    };
    const left = parseFloat(surface.left), top = parseFloat(surface.top);
    const width = parseFloat(surface.width), height = parseFloat(surface.height);
    const corners = [point(left, top), point(left + width, top), point(left + width, top + height), point(left, top + height)];
    // 方框木边占 4.2%，额外留 1.3% 安全带；牌必须落在绒布内，不能只落在外框内。
    const feltCorners = [[.055,.055],[.945,.055],[.945,.945],[.055,.945]].map(([x,y])=>point(left+width*x,top+height*y));
    const tableContents = list('.table .river .tile,.opponent-rack .tile,.opponent-rack .back,#wall-tail .wall-piece:not(.is-empty)');
    const insideFrame = p => corners.every((a,index)=>{
      const b=corners[(index+1)%4];
      return ((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x))/Math.hypot(b.x-a.x,b.y-a.y)>=-.8;
    });
    const outsideFrame = tableContents.filter(tile=>!tile.quad.every(insideFrame)).map(tile=>tile.id);
    const outsideFelt = tableContents.filter(tile=>!tile.quad.every(p=>feltCorners.every((a,index)=>{
      const b=feltCorners[(index+1)%4];
      return ((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x))/Math.hypot(b.x-a.x,b.y-a.y)>=-.8;
    }))).map(tile=>tile.id);
    // 本家为屏幕平面中的兄弟节点，也必须由桌内绒布完整承托，不能漏验。
    const allSeatTiles = list('#hand button,.my-melds .tile,.table .river .tile,.opponent-rack .tile,.opponent-rack .back,#wall-tail .wall-piece:not(.is-empty)');
    const outsideAllSeatFelt = allSeatTiles.filter(tile=>!tile.quad.every(p=>feltCorners.every((a,index)=>{
      const b=feltCorners[(index+1)%4];
      return ((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x))/Math.hypot(b.x-a.x,b.y-a.y)>=-.8;
    }))).map(tile=>tile.id);
    const outsideViewport = tableContents.filter(tile=>tile.quad.some(p=>p.x<-.8||p.y<-.8||p.x>stage.clientWidth+.8||p.y>stage.clientHeight+.8)).map(tile=>tile.id);
    const tableHudOverlaps = [];
    const controls = list('.player-seat,.top-left>div,.top-tools,.room-meta,.turn-message,.last-event,.action-zone:not([hidden]),#hand button,.my-melds .tile');
    for (const tile of tableContents) for (const control of controls) {
      if(window.visualGeometry.intersects(tile.quad,control.quad)) tableHudOverlaps.push({tile:tile.id,control:control.id,tileQuad:tile.quad,controlQuad:control.quad});
    }
    const rackWallOverlaps = [];
    const rackFaces = list('.opponent-rack .tile,.opponent-rack .back');
    const wallFaces = list('#wall-tail .wall-piece:not(.is-empty)');
    for(const rack of rackFaces) for(const wall of wallFaces) {
      if(window.visualGeometry.intersects(rack.quad,wall.quad)) rackWallOverlaps.push(`${rack.id}/${wall.id}`);
    }
    const hand = [...document.querySelectorAll('#hand button')].map(node => {
      const r = rect(node);
      const hits = [];
      for (const x of [.25, .5, .75]) for (const y of [.25, .5, .75]) hits.push(document.elementFromPoint(r.left + r.width * x, r.top + r.height * y)?.closest('#hand button') === node);
      return { index: Number(node.dataset.index), ...r, transform: getComputedStyle(node).transform, hits: hits.filter(Boolean).length, centerHit: hits[4] };
    });
    const overlap = (a, b) => window.visualGeometry.intersects(a.quad,b.quad);
    const rivers = [0, 1, 2, 3].map(seat => ({
      seat, box: rect(document.querySelector(`#river-${seat}`)), tiles: list(`#river-${seat} .tile`),
    }));
    const allRiver = rivers.flatMap(river => river.tiles.map((tile, index) => ({ ...tile, id: `${river.seat}:${index}` })));
    const obstacles = list('.player-seat,.action-zone:not([hidden]),#play-assist:not([hidden]),#hand button,.opponent-rack .tile,.opponent-rack .back,.my-melds .tile,#wall-tail .wall-piece:not(.is-empty),.table-center');
    const riverOverlaps = [];
    for (let i = 0; i < allRiver.length; i++) {
      for (let j = i + 1; j < allRiver.length; j++) if (overlap(allRiver[i], allRiver[j])) riverOverlaps.push(`${allRiver[i].id}/${allRiver[j].id}`);
      for (const node of obstacles) if (overlap(allRiver[i], node)) riverOverlaps.push(`${allRiver[i].id}/${node.id}`);
    }
    const actions = [...document.querySelectorAll('.action-zone button')].filter(visible).map(node => {
      const r = rect(node);
      return { id: node.id, ...r, hit: document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)?.closest('button') === node };
    });
    const hud = ['.topbar', '.seat-top', '.seat-left', '.seat-right', '.seat-bottom', '.action-zone', '#play-assist']
      .map(selector => document.querySelector(selector)).filter(visible).map(node => ({ id: node.id || node.className, inTableProjection: table.contains(node), ...rect(node) }));
    const back = document.querySelector('#backs-2 .back');
    const panel = document.querySelector('#play-assist');
    return {
      stage: rect(stage), table: rect(table), corners, tableTransform: style.transform, tableOrigin: style.transformOrigin,
      surface: { left, top, width, height }, nearWidth: corners[2].x - corners[3].x, farWidth: corners[1].x - corners[0].x,
      tableDepth: (corners[2].y + corners[3].y - corners[0].y - corners[1].y) / 2,
      hand, handZone: rect(document.querySelector('.hand-zone')), riverOverlaps, rivers, actions, hud, outsideFrame, feltCorners, outsideFelt, outsideAllSeatFelt, outsideViewport, tableHudOverlaps, rackWallOverlaps, allSeatGeometry:allSeatTiles,
      farTile: back ? rect(back) : null, hint: visible(panel) ? rect(panel) : null,
      scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      canvasScroll: [stage.scrollLeft, stage.scrollTop],
      camera: Object.fromEntries(['--table-view-distance', '--table-view-tilt', '--table-surface-width', '--rack-width'].map(name => [name, getComputedStyle(stage).getPropertyValue(name).trim()])),
      sideHands: [...document.querySelectorAll('.backs-left .back,.backs-right .back')].map(node => ({...rect(node), transform:getComputedStyle(node).transform})),
    };
  });
}

async function screenshot(page, size, scenario) {
  const filename = path.join(output, `seated-view-${size.width}x${size.height}-${scenario}.png`);
  await page.screenshot({ path: filename });
  report.screenshots.push(filename);
}

try {
  for (const size of screens) {
    const player = await createPlayer(size);
    const { page, room, publish, sync } = player;
    const names = room.seats.map(seat => seat.name);
    await publish(actionFixture({ names, hand: [...scattered, 24] }));
    const initial = await geometry(page);
    // 本轮仅放大视觉方桌，手牌、牌河、牌墙和 HUD 仍沿用原坐标。
    const bodyWidthRatio = (initial.nearWidth + initial.farWidth) / 2 / size.width;
    check(bodyWidthRatio >= .70 && bodyWidthRatio <= .76, 'enlarged table supports all four seats without filling the entire width', { size, bodyWidthRatio });
    check(initial.nearWidth / size.width >= .85 && initial.nearWidth / size.width <= .91, 'near table edge expands uniformly to support the local hand', { size, widthRatio: initial.nearWidth / size.width });
    check(Math.abs(initial.surface.width / initial.surface.height - 1) < .003, 'physical tabletop stays square rather than a squeezed long table', {size, surface:initial.surface});
    check(Math.abs(Number(initial.tableTransform.slice(9,-1).split(',')[0])-1)<.0001, 'table projection has no horizontal scale compression', {size,transform:initial.tableTransform});
    check(initial.outsideFrame.length===0 && initial.rackWallOverlaps.length===0, 'reanchored hands and walls fit the square frame without obstruction', {size,outside:initial.outsideFrame,overlaps:initial.rackWallOverlaps});
    check(initial.outsideFelt.length===0, 'all tabletop hands, rivers and walls stay on felt inside the wooden rim', {size,outside:initial.outsideFelt});
    check(initial.outsideAllSeatFelt.length===0, 'all four hands including the local flat hand stay fully inside felt', {size,outside:initial.outsideAllSeatFelt});
    check(initial.outsideViewport.length===0 && initial.tableHudOverlaps.length===0, 'enlarged table keeps every physical tile clear of viewport edges and flat HUD', {size,outside:initial.outsideViewport,overlaps:initial.tableHudOverlaps});
    check(initial.sideHands.length > 0 && initial.sideHands.every(tile => tile.width > 0 && tile.height > 0 && tile.transform === 'none'), 'side concealed hands restore the flat pre-first-person tile model', {size, sideHands:initial.sideHands});
    check(initial.farWidth < initial.nearWidth * .95, 'far rail visibly narrows through one table perspective', { size, nearWidth: initial.nearWidth, farWidth: initial.farWidth });
    check(initial.corners[2].y > size.height && initial.feltCorners[2].y >= initial.handZone.bottom, 'near felt extends beneath the entire local hand, with the wooden apron allowed off screen', { size, corners: initial.corners, felt:initial.feltCorners,hand:initial.handZone });
    check(initial.farTile && initial.farTile.height < initial.hand[0].height * .7, 'far hand is clearly smaller than the local hand', { size, far: initial.farTile, near: initial.hand[0] });
    check(initial.hud.every(node => !node.inTableProjection), 'labels and operation HUD stay outside the table projection', { size, hud: initial.hud });
    await screenshot(page, size, 'normal');
    if (process.env.KK_TABLE_BASELINE) {
      const before = await page.addStyleTag({content:readFileSync(process.env.KK_TABLE_BASELINE,'utf8')});
      await frames(page);
      const original = await geometry(page);
      await screenshot(page,size,'before-frame-only');
      const stable = data => ({tiles:data.allSeatGeometry,hand:data.hand.map(({left,top,width,height})=>({left,top,width,height})),rivers:data.rivers,hud:data.hud,sideHands:data.sideHands,farTile:data.farTile,tableTransform:data.tableTransform});
      check(JSON.stringify(stable(original))===JSON.stringify(stable(initial)), 'only table frame changes: all tiles, player information, controls and projection remain pixel-identical', {size});
      await before.evaluate(node=>node.remove()); await frames(page);
    }

    // 通过改变展示副本验证牌数变化；输入测试另用完整 136 张的服务端夹具。
    for (const count of [1, 2, 7, 14]) {
      await page.evaluate(count => {
        const game = window.mahjongGame;
        game.players[0].hand = [0, 2, 4, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22, 24].slice(0, count);
        game.lastDraw = null;
        window.renderMahjong();
      }, count);
      await frames(page);
      const data = await geometry(page);
      const center = (Math.min(...data.hand.map(tile => tile.left)) + Math.max(...data.hand.map(tile => tile.right))) / 2;
      const centerError = Math.abs(center - (data.stage.left + data.stage.right) / 2);
      check(centerError <= 1, 'hand visual bounds remain centered for every count', { size, count, centerError });
      check(data.hand.every(tile => tile.centerHit && tile.hits >= 7 && inside(tile, size)), 'transformed cards remain visible and internally hit-testable', { size, count, cards: data.hand });
      check(data.outsideAllSeatFelt.length===0, 'every hand count remains inside the expanded felt', {size,count,outside:data.outsideAllSeatFelt});
      check(data.hand.every((tile, index) => !index || tile.left > data.hand[index - 1].left), 'hand stays one ordered row without wrapping', { size, count });
      check(data.hand.every(tile => tile.transform === 'none' || Math.abs(Number(tile.transform.slice(7, -1).split(',')[1])) < .0001), 'local hand has no perspective or fan rotation', { size, count });
      check(data.scroll[0] <= size.width + 1 && data.scroll[1] <= size.height + 1, 'viewport has no scrolling or stretching', { size, count, scroll: data.scroll });
      report.hands.push({ size, count, centerError, hand: data.hand });
    }

    for (const [scenario, fixture] of [
      ['full-rivers', actionFixture({ names, hand: [...scattered, 24] })],
      ['maximum-public', maximumPublicFixture(names)],
      ['maximum-special', maximumSpecialHandFixture(names)],
    ]) {
      await publish(fixture);
      await page.evaluate(() => {
        const game = window.mahjongGame;
        for (const [seat, player] of game.players.entries()) player.discards = Array.from({ length: 36 }, (_, index) => (seat * 9 + index) % 34);
        game.events = ['布局验收打出一万。'];
        game.pendingDiscard = null;
        game.lastDiscard = null;
        game.actionNotice = null;
        window.renderMahjong();
      });
      await frames(page);
      const data = await geometry(page);
      check(data.rivers.every(river => river.tiles.length === 36 && river.tiles.every(tile => inside(tile, size))), 'all four full 36-tile rivers remain visible', { size, scenario, rivers: data.rivers });
      const order = await page.evaluate(() => [...document.querySelectorAll('.river')].every(river => {
        const columns=river.id==='river-0'||river.id==='river-2'?9:4;
        return [...river.children].every((tile,index)=>tile.style.gridArea==='' && (index===0 || tile.offsetTop>=river.children[index-1].offsetTop) && (index%columns!==0 || index===0 || tile.offsetTop>river.children[index-1].offsetTop) && new DOMMatrix(getComputedStyle(tile).transform).is2D);
      }));
      check(order, 'all four rivers restore chronological row-major grids and flat tile rotation', {size,scenario});
      check(data.riverOverlaps.length === 0, 'full rivers avoid other tiles, controls and player information', { size, scenario, overlaps: data.riverOverlaps });
      check(data.outsideFrame.length===0 && data.rackWallOverlaps.length===0, 'maximum racks and full rivers remain within the physical square frame', {size,scenario,outside:data.outsideFrame,overlaps:data.rackWallOverlaps});
      check(data.outsideFelt.length===0, 'maximum racks and full rivers retain a clear felt safety margin', {size,scenario,outside:data.outsideFelt});
      check(data.outsideAllSeatFelt.length===0, 'full rivers and maximum public groups including the local rack fit on felt', {size,scenario,outside:data.outsideAllSeatFelt});
      check(data.outsideViewport.length===0 && data.tableHudOverlaps.length===0, 'maximum table contents stay visible without covering HUD or local hand', {size,scenario,outside:data.outsideViewport,overlaps:data.tableHudOverlaps});
      check(data.scroll[0] <= size.width + 1 && data.scroll[1] <= size.height + 1, 'full table creates no page scrolling', { size, scenario, scroll: data.scroll });
      report.geometry.push({ size, scenario, ...data });
      await screenshot(page, size, scenario);
    }

    await publish(actionFixture({ names, hand: [...scattered, 24] }));
    await page.evaluate(() => {
      window.__seatedOriginalActions = window.mahjongRoom.availableActions;
      window.mahjongRoom.availableActions = () => ({ chi: [[0, 1, 2]], peng: true, gang: true, hu: true, pass: true, redGang: false, piziGang: false, wildGang: false, concealedGangs: [], addedGangs: [] });
      const game = window.mahjongGame;
      game.pendingDiscard = { from: 1, tile: 0 };
      game.phase = { kind: 'claim', discard: game.pendingDiscard };
      window.renderMahjong();
    });
    await frames(page);
    const actions = (await geometry(page)).actions;
    check(actions.length === 5 && actions.every(action => action.hit && inside(action, size)), 'all five response buttons are visible and hit-testable', { size, actions });
    for (const action of actions) {
      try { await page.locator(`#${action.id}`).click({ trial: true, timeout: 1000 }); }
      catch (error) { check(false, 'browser pointer actionability trial failed', { size, action: action.id, error: error.message }); }
    }
    // 还原实例方法，随后必须由服务端真实可用操作验证双击，不能沿用展示桩。
    await page.evaluate(() => {
      window.mahjongRoom.availableActions = window.__seatedOriginalActions;
      delete window.__seatedOriginalActions;
    });
    for (const [type, kind] of [[24, 'discard'], [31, 'redGang'], [33, 'piziGang'], [27, 'wildGang']]) {
      const fixture = actionFixture({ names, hand: [...scattered, type] });
      if (kind !== 'discard') {
        const tail = fixture.wall.findIndex(tile => ![31, fixture.indicatorTile, fixture.wildTile].includes(tile));
        [fixture.wall[0], fixture.wall[tail]] = [fixture.wall[tail], fixture.wall[0]];
      }
      await publish(fixture);
      const target = page.locator('#hand button[data-index="13"]');
      if (size.touch) await target.tap(); else await target.click();
      check(player.sent().length === 0 && await target.getAttribute('aria-pressed') === 'true', 'first real pointer selects exactly the targeted card', { size, type });
      if (size.touch) await target.tap(); else await target.click();
      await sync();
      await page.waitForTimeout(450);
      check(player.sent().length === 1 && player.sent()[0].action.kind === kind, 'second real pointer sends exactly the intended authoritative action', { size, type, kind, sent: player.sent().map(item => item.action.kind) });
      assertInvariants(fixture);
      report.input.push({ size, type, kind, requests: player.sent().length });
    }
    await publish(actionFixture({ names, hand: [0, 1, 2, 9, 10, 11, 18, 19, 20, 24, 25, 26, 4, 28] }));
    await page.locator('#play-assist:not([hidden])').waitFor();
    const hinted = await geometry(page);
    check(hinted.canvasScroll.every(value => value === 0), 'focus never scrolls the table canvas', { size, canvasScroll: hinted.canvasScroll });
    check(hinted.hint && inside(hinted.hint, size) && hinted.hint.right < hinted.handZone.left && Math.abs(hinted.hint.top - hinted.handZone.top) <= 1, 'unified hint stays left-aligned with the hand top and unobscured', { size, hint: hinted.hint, handZone: hinted.handZone });
    await page.locator('#hint-btn').click();
    check(player.sent().length === 0 && await page.locator('#hand .hinted').count() === 1, 'hint first click only highlights', { size });
    const hintTarget = page.locator('#hand .hinted');
    if (size.touch) await hintTarget.tap(); else await hintTarget.click();
    await sync();
    check(player.sent().length === 1 && player.sent()[0].action.kind === 'discard', 'highlighted projected card confirms only the suggested discard', { size });
    await screenshot(page, size, 'hint-confirmed');
  }
  check(report.errors.length === 0, 'no browser JavaScript errors', { errors: report.errors });
  report.passed = report.failures.length === 0;
  console.log(JSON.stringify({ passed: report.passed, browser: report.browser, geometryCases: report.geometry.length, handCases: report.hands.length, inputCases: report.input.length, failures: report.failures, errors: report.errors }, null, 2));
  assert.ok(report.passed, `Seated-view checks failed; see ${path.join(output, 'ui-seated-view.json')}`);
} catch (error) {
  report.failure = error.stack;
  throw error;
} finally {
  writeFileSync(path.join(output, 'ui-seated-view.json'), JSON.stringify(report, null, 2));
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser.close();
  service.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
