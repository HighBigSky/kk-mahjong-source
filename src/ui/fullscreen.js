// @ts-check

/** Fullscreen follows room membership, independently of lobby/game direction. */
export function createRoomFullscreen() {
  const root = document.documentElement;
  const standalone = matchMedia('(display-mode:standalone)');
  let inRoom = false;
  let entering = false;
  let pending = false;
  let retryOnGesture = false;

  function refresh() {
    const unavailable = inRoom && !pending && !standalone.matches && document.fullscreenElement !== root;
    root.classList.toggle('room-session', inRoom);
    root.classList.toggle('fullscreen-fallback', unavailable);
    document.querySelectorAll('[data-fullscreen-note]').forEach(note => {
      /** @type {HTMLElement} */ (note).hidden = !unavailable;
    });
  }

  async function exit() {
    if (document.fullscreenElement === root) {
      try { await document.exitFullscreen(); } catch { /* Navigation stays usable. */ }
    }
    refresh();
  }

  // Call directly in the gesture, before the room request consumes activation.
  function request() {
    if (pending || document.fullscreenElement === root || standalone.matches) { refresh(); return; }
    if (!root.requestFullscreen) { refresh(); return; }
    pending = true;
    try {
      const result = root.requestFullscreen({navigationUI:'hide'});
      void Promise.resolve(result).catch(() => { /* Use viewport mode and the inline home-screen hint. */ }).finally(() => {
        pending = false;
        if (!inRoom && !entering) void exit();
        refresh();
      });
    } catch { pending = false; refresh(); }
  }

  /** @param {boolean} value */
  function setInRoom(value) {
    const changed = value !== inRoom;
    inRoom = value;
    refresh();
    if (!changed) return;
    if (inRoom) {
      // Restored sessions may have no transient user activation after reload.
      // Try immediately, then retry inside the next ordinary room interaction.
      retryOnGesture = !entering;
      if (!entering) request();
    } else {
      retryOnGesture = false;
      if (!entering) void exit();
    }
  }

  function resume() {
    if (!inRoom || !retryOnGesture) return;
    retryOnGesture = false;
    request();
  }
  document.addEventListener('pointerdown', resume, {capture:true});
  document.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') resume(); }, {capture:true});
  document.addEventListener('fullscreenchange', refresh);
  standalone.addEventListener('change', refresh);
  return {
    setInRoom,
    prepareEntry() { entering = true; retryOnGesture = false; request(); },
    /** @param {boolean} joined */
    finishEntry(joined) { entering = false; setInRoom(joined); if (!joined) void exit(); },
  };
}
