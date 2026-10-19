import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';
import {actionFixture, scattered} from './pizi-fixtures.mjs';
import {assertInvariants} from '../src/domain/invariants.js';

// Use the installed browser runtime without adding an application dependency.
let playwright;
for (const location of [import.meta.url, 'C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json']) {
  try { playwright = createRequire(location)('playwright'); break; } catch { /* Next runtime. */ }
}
assert.ok(playwright, 'An installed Playwright runtime is required');
const service = new RoomService({botDelayMs:60000});
const server = createServer({roomService:service});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await playwright.chromium.launch({headless:true, ...(existsSync(edge) ? {executablePath:edge} : {})});
const context = await browser.newContext({viewport:{width:640, height:360}, hasTouch:true, isMobile:true});
const output = path.resolve('output'); mkdirSync(output, {recursive:true});
const report = {passed:false, cases:[], errors:[], fixtureNote:'One human with three idle bots; each injected pre-discard fixture conserves all 136 tiles. Real touch input sends HTTP actions and receives SSE updates.'};
try {
  await context.addInitScript(() => {
    Object.defineProperty(Element.prototype, 'requestFullscreen', {configurable:true, value:() => Promise.reject(new Error('Test CSS orientation fallback'))});
    if (screen.orientation) Object.defineProperty(screen.orientation, 'lock', {configurable:true, value:() => Promise.reject(new Error('Test CSS orientation fallback'))});
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  let discardRequests = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/action') && request.postDataJSON()?.action?.kind === 'discard') discardRequests++;
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`, {waitUntil:'networkidle'});
  await page.locator('#room-name').fill('触摸测试'); await page.locator('#room-create').click();
  await page.locator('#room-waiting:not([hidden])').waitFor();
  const room = service.rooms.get((await page.locator('#room-current-code').textContent()).trim());
  for (const seat of [1,2,3]) await page.locator(`.room-bot-add[data-seat="${seat}"]`).click();
  await page.locator('#room-ready').click(); await page.locator('#room-start').click();
  await page.locator('#room-dialog').waitFor({state:'hidden'});
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const measure = () => page.evaluate(() => ({scale:visualViewport.scale, width:document.querySelector('#game').clientWidth, height:document.querySelector('#game').clientHeight}));
  const sync = async () => {
    await page.waitForFunction(version => window.mahjongRoom.room?.version >= version && !window.mahjongRoom.busy, room.version);
    await frames();
  };
  const fixture = async () => {
    const game = actionFixture({names:room.seats.map(seat => seat.name), hand:[...scattered,24]});
    game.round = room.game.round; assertInvariants(game); room.game = game; service._changed(room); await sync();
    if (await page.locator('#dice-intro').isVisible()) await page.locator('#dice-intro').click();
    await page.evaluate(() => window.renderMahjong()); await frames();
    discardRequests = 0;
  };
  // Follow the real hit target only as far as the nearest scroll container:
  // that is where browsers intersect touch-action permissions for a gesture.
  const policyAt = async point => {
    const chain = await page.evaluate(({x,y}) => {
      const result = [];
      for (let node = document.elementFromPoint(x,y); node; node = node.parentElement) {
        const style = getComputedStyle(node);
        result.push({tag:node.tagName, id:node.id, action:style.touchAction});
        if (node instanceof HTMLElement && /(auto|scroll|hidden)/.test(style.overflowX + ' ' + style.overflowY)) break;
      }
      return result;
    }, point);
    assert.ok(chain.some(item => item.action === 'manipulation'), `Rapid-tap zoom must be disabled before the scrolling ancestor: ${JSON.stringify(chain)}`);
    assert.ok(chain.every(item => item.action === 'auto' || item.action === 'manipulation' || item.action.includes('pinch-zoom')), 'Intentional pinch zoom remains allowed');
    return chain;
  };
  const tap = point => page.touchscreen.tap(point.x, point.y);
  const doubleTap = async point => { await tap(point); await page.waitForTimeout(80); await tap(point); await page.waitForTimeout(350); };
  const stable = async before => { assert.deepEqual(await measure(), before, 'Rapid touch input must preserve viewport scale and table dimensions'); };
  for (const viewport of [{width:640,height:360}, {width:844,height:390}, {width:1280,height:720}, {width:1920,height:1080}]) {
    await page.setViewportSize(viewport); await frames(); await fixture();
    const before = await measure(); assert.equal(before.scale, 1);
    const tile = page.locator('#hand button[data-index="0"]');
    const center = await tile.evaluate(element => { const r = element.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; });
    await policyAt(center); await doubleTap(center); await sync();
    assert.equal(discardRequests, 1, 'Two rapid taps select and send exactly one discard');
    assert.equal(room.game.players[0].discards.length, 1); assert.equal(room.game.players[0].hand.length, 13);
    await doubleTap(center); assert.equal(discardRequests, 1, 'Extra taps after the tile leaves cannot send another discard'); await stable(before);

    await fixture();
    const lowerEdge = await tile.evaluate(element => {
      const r = element.getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.bottom-2};
    });
    await tap(lowerEdge); await page.waitForTimeout(100);
    assert.equal(await tile.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(point => Boolean(document.elementFromPoint(point.x,point.y)?.closest('#hand button')), lowerEdge), false, 'The raised tile exposes a real non-button gap');
    const gapPolicy = await policyAt(lowerEdge); await doubleTap(lowerEdge); await stable(before);
    // Mobile browsers may adjust a near-edge touch back onto the raised button.
    // Either target is valid, but neither may zoom or send duplicate actions.
    assert.ok(discardRequests <= 1, 'Gap taps cannot send duplicate discards');
    const edgeTouchDiscarded = discardRequests === 1;
    if (!edgeTouchDiscarded) {
      const raisedCenter = await tile.evaluate(element => { const r=element.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; });
      await tap(raisedCenter);
    }
    await sync(); assert.equal(discardRequests, 1, 'The selected tile remains usable after gap taps');
    const background = await page.locator('#game').evaluate(element => { const r=element.getBoundingClientRect(); return {x:r.left+r.width*.97,y:r.top+r.height*.7}; });
    await policyAt(background); await doubleTap(background); await stable(before);
    assert.equal(discardRequests, 1); assertInvariants(room.game);
    report.cases.push({viewport, scale:before.scale, twoTapDiscard:true, duplicateDiscard:false, edgeTouchDiscarded, raisedTileGapPolicy:gapPolicy, backgroundStable:true});
  }
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {report.failure=error.stack; throw error;}
finally {
  writeFileSync(path.join(output,'ui-touch-zoom.json'), JSON.stringify(report,null,2));
  await context.close(); await browser.close(); service.close();
  const closed=once(server,'close'); server.close(); server.closeAllConnections(); await closed;
}
