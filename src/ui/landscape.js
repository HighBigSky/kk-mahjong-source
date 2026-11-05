// @ts-check

/** 开局、房间和对局共用固定横屏画布；尺寸变化只重新对齐既有锚点。
 * @param {{onLayout?: () => void}} [options]
 */
export function createLandscapeLayout({onLayout = () => {}} = {}) {
  document.documentElement.classList.add('landscape-app');
  document.getElementById('game')?.classList.add('is-landscape');
  let locking = false;

  function refresh() { onLayout(); }

  // 原生横屏锁定只作全屏增强；不支持时仍使用同一横屏画布。
  async function lockLandscape() {
    const orientation = /** @type {ScreenOrientation & {lock?: (value: string) => Promise<void>}} */ (screen.orientation);
    if (locking || !document.fullscreenElement || !orientation?.lock) return;
    locking = true;
    try { await orientation.lock('landscape'); }
    catch { /* 不弹方向提示，不切换布局。 */ }
    finally { locking = false; refresh(); }
  }

  window.addEventListener('resize', refresh);
  document.addEventListener('fullscreenchange', () => { refresh(); void lockLandscape(); });
  refresh();
  return {refresh};
}
