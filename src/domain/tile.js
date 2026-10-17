// @ts-check

/** The only authority for the game's physical tile encoding. */
export const TILE = Object.freeze({
  MAN: 0, PIN: 9, SOU: 18,
  EAST: 27, SOUTH: 28, WEST: 29, NORTH: 30,
  RED: 31, GREEN: 32, WHITE: 33,
});

export const SUIT = Object.freeze({ MAN: 'man', PIN: 'pin', SOU: 'sou', HONOR: 'honor' });
const NUMBERED_SUITS = /** @type {const} */ ([SUIT.MAN, SUIT.PIN, SUIT.SOU]);
export const RED_DRAGON = TILE.RED;
export const SUIT_SIZE = 9;
export const HONOR_COUNT = 7;
export const TILE_TYPE_COUNT = 34;
export const COPIES_PER_TILE = 4;
export const TOTAL_TILE_COUNT = TILE_TYPE_COUNT * COPIES_PER_TILE;
export const MAX_SEQUENCE_START_RANK = SUIT_SIZE - 2;
export const JIANG_RANKS = Object.freeze([2, 5, 8]);

/** @typedef {number} TileCode A tile kind encoded as an integer from 0 through 33. */
/** @typedef {typeof SUIT[keyof typeof SUIT]} Suit */

/**
 * @param {unknown} tile
 * @returns {tile is TileCode}
 */
export function isTileCode(tile) {
  return typeof tile === 'number' && Number.isInteger(tile) && tile >= TILE.MAN && tile < TILE_TYPE_COUNT;
}

/**
 * @param {TileCode} tile
 * @returns {boolean}
 */
export const isNumbered = tile => tile >= TILE.MAN && tile < TILE.EAST;

/**
 * @param {TileCode} tile
 * @returns {Suit}
 */
export const suitOf = tile => tile < TILE.EAST
  ? NUMBERED_SUITS[(tile / SUIT_SIZE) | 0]
  : SUIT.HONOR;

/**
 * Numbered ranks are 1..9; honor ranks follow east through white as 1..7.
 * @param {TileCode} tile
 * @returns {number}
 */
export const rankOf = tile => tile < TILE.EAST ? (tile % SUIT_SIZE) + 1 : tile - TILE.EAST + 1;

/**
 * A standard winning hand's pair must be a numbered two, five, or eight.
 * Seven pairs is evaluated separately by the rules engine.
 * @param {unknown} tile
 * @returns {tile is TileCode}
 */
export function isJiangTile(tile) {
  return isTileCode(tile) && isNumbered(tile) && JIANG_RANKS.includes(rankOf(tile));
}

/**
 * The encoding base of a tile's suit, including the honor cycle.
 * @param {TileCode} tile
 * @returns {TileCode}
 */
export const suitStartOf = tile => tile < TILE.EAST ? ((tile / SUIT_SIZE) | 0) * SUIT_SIZE : TILE.EAST;

/**
 * Convert a suit and a one-based rank back to the physical tile encoding.
 * @param {Suit} suit
 * @param {number} rank
 * @returns {TileCode}
 */
export function tileCode(suit, rank) {
  const bases = { [SUIT.MAN]: TILE.MAN, [SUIT.PIN]: TILE.PIN, [SUIT.SOU]: TILE.SOU, [SUIT.HONOR]: TILE.EAST };
  const maximum = suit === SUIT.HONOR ? HONOR_COUNT : SUIT_SIZE;
  if (!Object.hasOwn(bases, suit) || !Number.isInteger(rank) || rank < 1 || rank > maximum) {
    throw new RangeError('A tile needs a known suit and a rank within that suit.');
  }
  return bases[suit] + rank - 1;
}
