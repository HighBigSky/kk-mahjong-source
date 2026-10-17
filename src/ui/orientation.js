// @ts-check

/**
 * Native direction locking is optional in browsers. The CSS stage always uses
 * landscape dimensions in a room, including on devices that reject the lock.
 * @param {{onLayout?: () => void}} [options]
 * @returns {{setInRoom: (value: boolean) => void, prepareEntry: () => void, finishEntry: (joined: boolean) => void}}
 */
export function createRoomOrientation({onLayout = () => {}} = {}) {
  const root = document.documentElement;
  const stage = document.getElementById('game');
  let inRoom = false;
  let entryPending = false;
  let ownsFullscreen = false;
  let ownsLock = false;
  let locking = false;

  for (const side of ['top', 'right', 'bottom', 'left']) {
    root.style.setProperty(`--device-safe-${side}`, `env(safe-area-inset-${side}, 0px)`);
  }

  /** @returns {void} */
  function layout() {
    const viewport = window.visualViewport;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    const style = getComputedStyle(root);
    const safe = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, parseFloat(style.getPropertyValue(`--device-safe-${side}`)) || 0]));
    const availableWidth = Math.max(1, width - safe.left - safe.right);
    const availableHeight = Math.max(1, height - safe.top - safe.bottom);
    const rotated = inRoom && availableHeight > availableWidth;
    root.classList.toggle('in-room', inRoom);
    root.classList.toggle('landscape-rotated', rotated);
    stage?.classList.toggle('is-landscape', inRoom);
    // 够宽的舞台（手机横屏）用铺满版式，接近方形或很窄的窗口回退正方形版式。
    stage?.classList.toggle('is-wide', inRoom && availableWidth / availableHeight >= 1.72);
    root.style.setProperty('--stage-width', `${Math.max(availableWidth, availableHeight)}px`);
    root.style.setProperty('--stage-height', `${Math.min(availableWidth, availableHeight)}px`);
    root.style.setProperty('--stage-center-x', `${(viewport?.offsetLeft || 0) + safe.left + availableWidth / 2}px`);
    root.style.setProperty('--stage-center-y', `${(viewport?.offsetTop || 0) + safe.top + availableHeight / 2}px`);
    onLayout();
  }

  /** @returns {Promise<void>} */
  async function releaseFullscreen() {
    if (ownsFullscreen && document.fullscreenElement === root) {
      try { await document.exitFullscreen(); } catch { /* CSS layout remains available. */ }
    }
    ownsFullscreen = false;
  }

  /** @returns {Promise<void>} */
  async function lockLandscape() {
    const orientation = /** @type {ScreenOrientation & {lock?: (value: string) => Promise<void>}} */ (screen.orientation);
    if (!inRoom || locking || !orientation?.lock) return;
    locking = true;
    try {
      await orientation.lock('landscape');
      ownsLock = true;
      if (!inRoom) { orientation.unlock(); ownsLock = false; }
    } catch { /* iOS and ordinary tabs use the rotated CSS stage. */ }
    finally { locking = false; layout(); }
  }

  /** @param {boolean} value @returns {void} */
  function setInRoom(value) {
    const changed = inRoom !== value;
    inRoom = value;
    if (inRoom) entryPending = false;
    layout();
    if (!changed) return;
    if (inRoom) void lockLandscape();
    else {
      if (ownsLock) {
        try { screen.orientation?.unlock(); } catch { /* Some browsers omit unlocking. */ }
        ownsLock = false;
      }
      void releaseFullscreen();
    }
  }

  /** Request fullscreen inside the create/join gesture, before its HTTP await.
   * @returns {void}
   */
  function prepareEntry() {
    entryPending = true;
    const touchDevice = navigator.maxTouchPoints > 0 || matchMedia('(pointer:coarse)').matches;
    if (!touchDevice || document.fullscreenElement || !root.requestFullscreen) return;
    try {
      void root.requestFullscreen({navigationUI:'hide'}).then(() => {
        ownsFullscreen = document.fullscreenElement === root;
        if (inRoom) void lockLandscape();
        else if (!entryPending) void releaseFullscreen();
      }).catch(() => { /* Unsupported fullscreen does not block joining. */ });
    } catch { /* The fullscreen method can also throw synchronously. */ }
  }

  window.addEventListener('resize', layout);
  window.visualViewport?.addEventListener('resize', layout);
  window.visualViewport?.addEventListener('scroll', layout);
  screen.orientation?.addEventListener('change', layout);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) ownsFullscreen = false;
    layout();
    if (inRoom && document.fullscreenElement) void lockLandscape();
  });
  layout();
  return {
    setInRoom,
    prepareEntry,
    finishEntry(joined) {
      entryPending = false;
      setInRoom(joined);
      if (!joined) void releaseFullscreen();
    },
  };
}
