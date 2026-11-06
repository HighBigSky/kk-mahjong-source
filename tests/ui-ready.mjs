// 补齐一真三机后页面会完成准备；只为尚未准备的真人点击一次。
// 旧版静态对照页面没有 aria-busy 属性，仍使用同一个状态约束。
export async function ensureReady(page) {
  await page.waitForFunction(()=>window.mahjongRoom.status==='connected'&&!window.mahjongRoom.busy&&document.querySelector('#room-dialog').getAttribute('aria-busy')!=='true');
  if (!await page.evaluate(()=>window.mahjongRoom.room.seats[0].ready)) {
    await page.locator('#room-ready:enabled').click();
    await page.waitForFunction(()=>window.mahjongRoom.room.seats[0].ready&&!window.mahjongRoom.busy&&document.querySelector('#room-dialog').getAttribute('aria-busy')!=='true');
  }
}
