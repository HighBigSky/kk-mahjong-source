// @ts-check

/** 开局、房间和对局共用固定横屏画布；尺寸变化只重新对齐既有锚点。
 * @param {{onLayout?: () => void}} [options]
 */
export function createLandscapeLayout({onLayout = () => {}} = {}) {
  document.documentElement.classList.add('landscape-app');
  document.getElementById('game')?.classList.add('is-landscape');
  function refresh() { onLayout(); }

  window.addEventListener('resize', refresh);
  document.addEventListener('fullscreenchange', refresh);
  refresh();
  return {refresh};
}
