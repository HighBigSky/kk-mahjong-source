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

  function releaseScreen() {
    if (ownsLock) {
      try { screen.orientation?.unlock(); } catch { /* Optional browser API. */ }
      ownsLock = false;
    }
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
    else releaseScreen();
  }

  /** @param {string | null | undefined} value */
  function setRoomState(value) {
    if (!['dealing', 'playing', 'ended'].includes(status)) lobby = false;
    status = value || '';
    updateRoute();
  }

  window.addEventListener('resize', refresh);
  portrait.addEventListener('change', refresh);
  phone.addEventListener('change', refresh);
  document.addEventListener('fullscreenchange', () => {
    refresh();
    if (inGame && document.fullscreenElement) void lockLandscape();
  });
  guide.addEventListener('cancel', event => { if (inGame && phone.matches && portrait.matches) event.preventDefault(); });
  refresh();
  return {
    setRoomState, refresh,
    /** @param {boolean} value */
    setLobby(value) { lobby = value; updateRoute(); },
  };
}
