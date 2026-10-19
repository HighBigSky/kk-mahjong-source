// Presentation state only. A shown tile still belongs to its authoritative
// river; this controller never moves a physical tile or advances the game.
export function createDiscardFocusState({storage = null} = {}) {
  let context = null;
  let previous = null;
  let seenKey = null;
  let focus = null;
  let highestNotice = 0;
  const retired = new Set();
  try { for (const key of JSON.parse(storage?.getItem('queqi-discard-retired') || '[]')) retired.add(key); }
  catch { /* Optional session storage may be blocked or malformed. */ }
  const save = () => {
    while (retired.size > 256) retired.delete(retired.values().next().value);
    try { storage?.setItem('queqi-discard-retired', JSON.stringify([...retired])); }
    catch { /* Presentation still works without persistence. */ }
  };
  const retire = () => {
    if (focus) { retired.add(focus.key); save(); }
    focus = null;
  };

  return {
    update({ game, room, connected = true }) {
      if (!room || room.status !== 'playing' || game.phase.kind === 'ended') {
        retire();
        context = previous = seenKey = focus = null;
        highestNotice = 0;
        return null;
      }
      const scope = `${room.code}:${game.round}`;
      const latest = game.lastDiscard || (game.pendingDiscard && {
        ...game.pendingDiscard,
        index:game.players[game.pendingDiscard.from]?.discards.length - 1,
      });
      const valid = latest && game.players[latest.from]?.discards[latest.index] === latest.tile;
      const key = valid ? `${scope}:${latest.from}:${latest.index}:${latest.tile}` : null;
      const sample = {
        version:room.version,
        connected:connected && !room.paused,
        metadata:JSON.stringify([room.owner, room.seat, room.paused, room.status,
          room.seats.map(seat => [seat.name, seat.occupied, seat.connected, seat.voice, seat.ready, seat.bot])]),
        publicActions:JSON.stringify(game.players.map(player => [player.melds, player.redGangs, player.piziGangs || []])),
        notice:game.actionNotice?.id ?? null,
      };
      const show = () => key ? { key, from:latest.from, tile:latest.tile, index:latest.index } : null;
      if (scope !== context) {
        context = scope;
        seenKey = key;
        previous = sample;
        highestNotice = sample.notice || 0;
        // A restored response window is still actionable. An old, already
        // resolved discard is not replayed just because the page was refreshed.
        focus = game.pendingDiscard && game.phase.kind === 'claim' && !retired.has(key) ? show() : null;
        return focus;
      }
      if (previous && sample.version < previous.version) return focus;
      if (key !== seenKey) {
        retire();
        seenKey = key;
        // A genuinely new live discard may reuse a river index after a claim.
        // Seeing that transition arms it again, even when its face is the same.
        if (retired.delete(key)) save();
        focus = show();
      } else if (focus && previous) {
        // The server advances exactly one version for an accepted command.
        // Connection/voice/seat changes have their own public metadata; filter
        // those out, and never infer an action across a reconnect/version gap.
        // This also recognises a pass or queued claim before priority resolves.
        const command = previous.connected && sample.connected
          && sample.version === previous.version + 1
          && sample.metadata === previous.metadata;
        const publicAction = sample.publicActions !== previous.publicActions
          || (sample.notice !== null && sample.notice > highestNotice);
        if (command || publicAction) retire();
      }
      previous = sample;
      highestNotice = Math.max(highestNotice, sample.notice || 0);
      return focus;
    },
  };
}
