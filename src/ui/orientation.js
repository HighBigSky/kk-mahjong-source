// @ts-check

/** One landscape game canvas; entry and waiting rooms keep the portrait lobby.
 * Direction only controls the phone guide, never the game's layout or route.
 * @param {{onLayout?: () => void}} [options]
 */
export function createRoomOrientation({onLayout = () => {}} = {}) {
  const root = document.documentElement;
  const stage = document.getElementById('game');
  const guide = /** @type {HTMLDialogElement} */ (document.getElementById('rotate-guide'));
  const phone = matchMedia('(pointer:coarse)');
  const portrait = matchMedia('(orientation:portrait)');
  let status = '';
  let lobby = false;
  let inGame = false;
  let entryPending = false;
  let ownsFullscreen = false;
  let ownsLock = false;
  let locking = false;

  function refresh() {
    const needsGuide = inGame && phone.matches && portrait.matches;
    if (needsGuide) {
      if (guide.open && document.querySelector('dialog[open]:not(#rotate-guide)')) guide.close();
      if (!guide.open) guide.showModal();
    } else if (guide.open) guide.close();
    onLayout();
  }

  async function releaseScreen() {
    if (ownsLock) {
      try { screen.orientation?.unlock(); } catch { /* Optional browser API. */ }
      ownsLock = false;
    }
    if (ownsFullscreen && document.fullscreenElement === root) {
      try { await document.exitFullscreen(); } catch { /* Optional browser API. */ }
    }
    ownsFullscreen = false;
  }

  async function lockLandscape() {
    const orientation = /** @type {ScreenOrientation & {lock?: (value: string) => Promise<void>}} */ (screen.orientation);
    if (!inGame || !phone.matches || locking || !orientation?.lock) return;
    locking = true;
    try {
      await orientation.lock('landscape');
      ownsLock = true;
      if (!inGame) { orientation.unlock(); ownsLock = false; }
    } catch { /* The visible guide handles browsers that cannot lock. */ }
    finally { locking = false; refresh(); }
  }

  function updateRoute() {
    const previous = inGame;
    inGame = !lobby && ['dealing', 'playing', 'ended'].includes(status);
    root.classList.toggle('in-game', inGame);
    stage?.classList.toggle('is-landscape', inGame);
    refresh();
    if (previous === inGame) return;
    if (inGame) void lockLandscape();
    else if (!entryPending) void releaseScreen();
  }

  /** @param {string | null | undefined} value */
  function setRoomState(value) {
    if (!['dealing', 'playing', 'ended'].includes(status)) lobby = false;
    status = value || '';
    updateRoute();
  }

  /** Request fullscreen in the start/return gesture, before its HTTP await. */
  function prepareGameEntry() {
    if (!phone.matches) return;
    entryPending = true;
    if (document.fullscreenElement || !root.requestFullscreen) return;
    try {
      void root.requestFullscreen({navigationUI:'hide'}).then(() => {
        ownsFullscreen = document.fullscreenElement === root;
        if (inGame) void lockLandscape();
        else if (!entryPending) void releaseScreen();
      }).catch(() => { /* The guide remains available without fullscreen. */ });
    } catch { /* Some browsers throw synchronously. */ }
  }

  window.addEventListener('resize', refresh);
  portrait.addEventListener('change', refresh);
  phone.addEventListener('change', refresh);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) ownsFullscreen = false;
    refresh();
    if (inGame && document.fullscreenElement) void lockLandscape();
  });
  guide.addEventListener('cancel', event => { if (inGame && phone.matches && portrait.matches) event.preventDefault(); });
  refresh();
  return {
    setRoomState, prepareGameEntry, refresh,
    /** @param {boolean} value */
    setLobby(value) { lobby = value; updateRoute(); },
    /** @param {string | null | undefined} value */
    finishGameEntry(value) { entryPending = false; setRoomState(value); if (!inGame) void releaseScreen(); },
  };
}
