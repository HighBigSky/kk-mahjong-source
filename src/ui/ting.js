// @ts-check
import { classifyWin, isSpecialGangTile } from '../../engine.js';
import { COPIES_PER_TILE, TILE_TYPE_COUNT, isTileCode } from '../domain/tile.js';

/** @typedef {import('../domain/tile.js').TileCode} TileCode */
/** @typedef {import('../domain/model.js').MeldLike} MeldLike */
/** @typedef {{type:TileCode, selfDraw:true, claim:boolean}} TingWait */
/** @typedef {{status:'ready'|'select-discard'|'special-gang'|'invalid', waits:TingWait[], discardedTile:TileCode|null}} TingHints */

/**
 * Preview only the local player's waits without reading a wall or opponents' hands.
 * visibleTiles contains every public physical tile, including the local player's
 * melds/kongs and the exposed indicator. Pending discard is already in a river;
 * do not count it twice. Own melds are included at least once even if omitted.
 *
 * A selected discard stays known: it cannot become a fifth drawable copy merely
 * because it left the concealed hand. Remaining counts mean "not publicly seen",
 * never a promise about the wall. No count is exposed by this helper.
 *
 * @param {{hand:readonly TileCode[], melds?:readonly MeldLike[], wildTile?:TileCode|null,
 * indicatorTile?:TileCode|null, visibleTiles?:readonly TileCode[]}} options
 * @param {number|null} [selectedIndex] - -1/null means no selected discard.
 * @returns {TingHints}
 */
export function getTingHints({ hand, melds = [], wildTile = null, indicatorTile = null, visibleTiles = [] }, selectedIndex = -1) {
  /** @param {TingHints['status']} status @param {TileCode|null} [discardedTile] @returns {TingHints} */
  const result = (status, discardedTile = null) => ({ status, waits: [], discardedTile });
  if (!Array.isArray(hand) || !hand.every(isTileCode) || !Array.isArray(visibleTiles) || !visibleTiles.every(isTileCode) ||
      !Array.isArray(melds) || melds.length > 4 || melds.some(meld => !meld ||
        !['chi', 'peng', 'gang'].includes(meld.kind) || !Array.isArray(meld.tiles) ||
        meld.tiles.length !== (meld.kind === 'gang' ? 4 : 3) || !meld.tiles.every(isTileCode)) ||
      (wildTile !== null && !isTileCode(wildTile)) || (indicatorTile !== null && !isTileCode(indicatorTile))) return result('invalid');

  const waitingLength = (4 - melds.length) * 3 + 1;
  const hasSelection = selectedIndex !== null && selectedIndex !== -1;
  if ((hand.length !== waitingLength && hand.length !== waitingLength + 1) ||
      (hasSelection && (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= hand.length))) return result('invalid');

  const publicCounts = Array(TILE_TYPE_COUNT).fill(0);
  const declaredCounts = Array(TILE_TYPE_COUNT).fill(0);
  const handCounts = Array(TILE_TYPE_COUNT).fill(0);
  for (const type of visibleTiles) publicCounts[type]++;
  for (const meld of melds) for (const type of meld.tiles) declaredCounts[type]++;
  for (const type of hand) handCounts[type]++;
  const knownCounts = handCounts.map((count, type) => count + Math.max(publicCounts[type], declaredCounts[type]));
  if (knownCounts.some(count => count > COPIES_PER_TILE)) return result('invalid');
  if (hand.some(type => isSpecialGangTile(type, indicatorTile))) return result('special-gang');

  if (hand.length === waitingLength + 1 && !hasSelection) return result('select-discard');
  if (hand.length === waitingLength && hasSelection) return result('invalid');
  const discardedTile = hasSelection ? hand[/** @type {number} */ (selectedIndex)] : null;
  const remaining = hand.filter((_, index) => !hasSelection || index !== selectedIndex);
  const hints = result('ready', discardedTile);
  for (let type = 0; type < TILE_TYPE_COUNT; type++) {
    if (isSpecialGangTile(type, indicatorTile) || knownCounts[type] >= COPIES_PER_TILE) continue;
    const win = classifyWin([...remaining, type], melds, wildTile, indicatorTile);
    if (!win.winning) continue;
    hints.waits.push({ type, selfDraw: true,
      claim: win.opened || win.sevenPairs || win.allTriplets || win.allJiang || win.allHonors });
  }
  return hints;
}
