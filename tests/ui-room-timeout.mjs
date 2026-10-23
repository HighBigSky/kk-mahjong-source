import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {createServer} from '../server.js';
import {RoomService} from '../src/server/rooms.js';

const {chromium} = createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
// 浏览器用短期限覆盖真实 HTTP/SSE；十分钟精确边界由虚拟时钟单测覆盖。
const service = new RoomService({disconnectGraceMs:20,reconnectTimeoutMs:2500,botDelayMs:600000});
const server = createServer({roomService:service});
server.listen(0,'127.0.0.1'); await once(server,'listening');
const browser = await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const errors = [];
try {
  const contexts = await Promise.all([0,1].map(() => browser.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true})));
  const pages = await Promise.all(contexts.map(async context => {
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.mahjongRoom);
    return page;
  }));
  const [owner, friend] = pages;
  await owner.evaluate(() => window.mahjongRoom.create('超时验收'));
  await owner.waitForFunction(() => window.mahjongRoom.status === 'connected');
  const code = await owner.evaluate(() => window.mahjongRoom.room.code);
  await friend.evaluate(code => window.mahjongRoom.join(code,'掉线好友'),code);
  await friend.waitForFunction(() => window.mahjongRoom.status === 'connected');
  await owner.evaluate(async () => {
    await window.mahjongRoom.addBot(2); await window.mahjongRoom.addBot(3); await window.mahjongRoom.ready(true);
  });
  await friend.evaluate(() => window.mahjongRoom.ready(true));
  await owner.evaluate(() => window.mahjongRoom.start());
  await friend.waitForFunction(() => window.mahjongRoom.room?.status === 'playing');
  await contexts[1].setOffline(true);
  await owner.waitForFunction(() => window.mahjongRoom.room?.paused);
  assert.match(await owner.locator('#room-status').textContent(),/10分钟/);
  await owner.waitForFunction(() => window.mahjongRoom.room === null);
  assert.equal(service.rooms.has(code),false);
  await contexts[1].setOffline(false);
  await friend.waitForFunction(() => window.mahjongRoom.room === null);
  for (const page of pages) {
    assert.equal(await page.evaluate(() => window.mahjongRoom.sessionCode()),null);
    assert.equal(await page.evaluate(() => localStorage.getItem('queqi-room-session')),null);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: Edge 844x390 touch, active game offline -> deadline dissolves room -> online player and reconnecting player clear expired session.');
} finally {
  await browser.close(); service.close();
  server.close(); server.closeAllConnections();
}
