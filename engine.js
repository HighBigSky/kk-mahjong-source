// @ts-check
/** Dependency-free rules and turn orchestration for the four-seat teaching game. */

import {
  TILE, SUIT, RED_DRAGON, TILE_TYPE_COUNT, TOTAL_TILE_COUNT, COPIES_PER_TILE,
  SUIT_SIZE, HONOR_COUNT, MAX_SEQUENCE_START_RANK,
  isTileCode, isNumbered, isJiangTile, suitOf, rankOf, suitStartOf,
} from './src/domain/tile.js';
import { PHASE, ACTION, isPlayerId } from './src/domain/model.js';
import { assertPhaseTransition } from './src/domain/invariants.js';
import { SCORE_RULES, SCORING_TEXT } from './src/domain/scoring.js';

/** @typedef {import('./src/domain/model.js').TileCode} TileCode */
/** @typedef {import('./src/domain/model.js').PlayerId} PlayerId */
/** @typedef {import('./src/domain/model.js').PlayerState} PlayerState */
/** @typedef {import('./src/domain/model.js').Meld} Meld */
/** @typedef {import('./src/domain/model.js').MeldLike} MeldLike */
/** @typedef {import('./src/domain/model.js').Phase} Phase */
/** @typedef {import('./src/domain/model.js').Action} Action */
/** @typedef {import('./src/domain/model.js').AvailableActions} AvailableActions */
/** @typedef {import('./src/domain/model.js').ClaimResponse} ClaimResponse */
/** @typedef {import('./src/domain/model.js').GameResult} GameResult */
/** @typedef {import('./src/domain/model.js').PendingDiscard} PendingDiscard */
/** @typedef {import('./src/domain/model.js').LastDraw} LastDraw */
/** @typedef {import('./src/domain/model.js').WallInfo} WallInfo */
/** @typedef {import('./src/domain/model.js').GameOptions} GameOptions */
/** @typedef {import('./src/domain/model.js').NewRoundOptions} NewRoundOptions */

const SUIT_NAMES = { [SUIT.MAN]: '万', [SUIT.PIN]: '筒', [SUIT.SOU]: '条', [SUIT.HONOR]: '' };
const NUM_NAMES = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONOR_NAMES = ['东', '南', '西', '北', '中', '发', '白'];
const DEFAULT_NAMES = ['你', '云舟', '阿福', '小棠'];
const DICE_SIDES = 6;
const TILES_PER_STACK = 2;

/** @param {unknown} type @returns {string} */
export function tileName(type) {
  if (!isTileCode(type)) return '未知牌';
  return isNumbered(type) ? NUM_NAMES[rankOf(type) - 1] + SUIT_NAMES[suitOf(type)] : HONOR_NAMES[type - TILE.EAST];
}

/** Legacy public suit labels are preserved for existing callers.
 * @param {TileCode} type @returns {'wan'|'tong'|'tiao'|'honor'|undefined}
 */
export function tileSuit(type) {
  const names = /** @type {const} */ (['wan', 'tong', 'tiao']);
  return type >= TILE.EAST ? SUIT.HONOR : names[Math.floor(type / SUIT_SIZE)];
}

/** Numbered suits wrap at nine; all seven honors share one cycle.
 * @param {unknown} type @returns {TileCode|null}
 */
export function nextWildTile(type) {
  if (!isTileCode(type)) return null;
  return isNumbered(type) ? suitStartOf(type) + rankOf(type) % SUIT_SIZE : TILE.EAST + rankOf(type) % HONOR_COUNT;
}

/** Red dragons and this round's exposed indicator are dedicated single-tile kongs.
 * @param {TileCode} tile @param {TileCode|null} [indicatorTile] @returns {boolean}
 */
export function isSpecialGangTile(tile, indicatorTile = null) {
  return tile === RED_DRAGON || (indicatorTile !== null && tile === indicatorTile);
}

/** @param {readonly TileCode[]} hand @returns {number[]|null} */
function countsOf(hand) {
  if (!Array.isArray(hand)) return null;
  /** @type {number[]} */
  const counts = Array(TILE_TYPE_COUNT).fill(0);
  for (const tile of hand) {
    if (!isTileCode(tile) || ++counts[tile] > COPIES_PER_TILE) return null;
  }
  return counts;
}

/** @param {readonly TileCode[]} hand @returns {boolean} */
function isSevenPairs(hand) {
  const counts = countsOf(hand);
  return hand.length === 14 && counts !== null && counts.every(count => count % 2 === 0);
}

/** A numeric legacy count cannot establish the contents of declared groups.
 * @param {readonly MeldLike[]|number} melds @returns {number|null}
 */
function validMeldCount(melds) {
  if (typeof melds === 'number') return Number.isInteger(melds) && melds >= 0 && melds <= 4 ? melds : null;
  if (!Array.isArray(melds) || melds.length > 4 || melds.some(meld => !meld ||
      !['chi', 'peng', 'gang'].includes(meld.kind) || !Array.isArray(meld.tiles) ||
      meld.tiles.length !== (meld.kind === 'gang' ? 4 : 3) || !meld.tiles.every(isTileCode))) return null;
  return melds.length;
}

/** Chi, peng and exposed/added kongs open the hand. Concealed and special kongs do not.
 * With a legacy numeric count, a nonzero count is conservatively treated as open.
 * @param {readonly MeldLike[]|number} [melds] @returns {boolean}
 */
export function hasOpenedMeld(melds = []) {
  return typeof melds === 'number' ? melds > 0 :
    melds.some(meld => meld.kind === 'chi' || meld.kind === 'peng' || (meld.kind === 'gang' && meld.concealed !== true));
}

/** Test the original four-groups-and-pair shape without changing its physical counts.
 * @param {readonly number[]} initialCounts @param {number} wilds @param {number} meldCount
 * @param {boolean} jiangPair @param {boolean} [tripletsOnly] @returns {boolean}
 */
function groupedShape(initialCounts, wilds, meldCount, jiangPair, tripletsOnly = false) {
  const counts = [...initialCounts];
  /** @type {Map<string, boolean>} */
  const memo = new Map();
  /** @param {number} groups @param {number} remainingWilds @returns {boolean} */
  function groupsRemain(groups, remainingWilds) {
    const first = counts.findIndex(count => count > 0);
    if (first < 0) return remainingWilds === groups * 3;
    if (groups === 0) return false;
    const key = counts.join('') + ':' + groups + ':' + remainingWilds;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let matched = false;
    const naturalTriple = Math.min(3, counts[first]);
    if (3 - naturalTriple <= remainingWilds) {
      counts[first] -= naturalTriple;
      matched = groupsRemain(groups - 1, remainingWilds - (3 - naturalTriple));
      counts[first] += naturalTriple;
    }
    if (!matched && !tripletsOnly && isNumbered(first)) {
      const suitStart = suitStartOf(first);
      // A wild can precede the first natural tile, e.g. wild, eight, nine.
      for (let start = Math.max(suitStart, first - 2); start <= Math.min(first, suitStart + MAX_SEQUENCE_START_RANK - 1); start++) {
        const natural = [start, start + 1, start + 2].filter(tile => counts[tile] > 0);
        const neededWilds = 3 - natural.length;
        if (neededWilds > remainingWilds) continue;
        for (const tile of natural) counts[tile]--;
        matched = groupsRemain(groups - 1, remainingWilds - neededWilds);
        for (const tile of natural) counts[tile]++;
        if (matched) break;
      }
    }
    memo.set(key, matched);
    return matched;
  }
  for (let pair = TILE.MAN; pair < TILE_TYPE_COUNT; pair++) {
    if ((jiangPair && !isJiangTile(pair)) || !counts[pair]) continue;
    const natural = Math.min(2, counts[pair]);
    if (2 - natural > wilds) continue;
    counts[pair] -= natural;
    const matched = groupsRemain(4 - meldCount, wilds - (2 - natural));
    counts[pair] += natural;
    if (matched) return true;
  }
  return wilds >= 2 && groupsRemain(4 - meldCount, wilds - 2);
}

/** @typedef {{winning:boolean, ordinary:boolean, sevenPairs:boolean, allTriplets:boolean,
 * allJiang:boolean, allHonors:boolean, opened:boolean, wildCount:number}} WinClassification */

/** Classifies eligibility only: no unconfirmed big-hand scoring is inferred here.
 * Special-kong records are intentionally absent from melds. Exposed wildcards keep
 * their printed identity; only concealed wildcards substitute for another tile.
 * @param {readonly TileCode[]} hand @param {readonly MeldLike[]|number} [melds]
 * @param {TileCode|null} [wildTile] @param {TileCode|null} [indicatorTile] @param {boolean} [replacement]
 * @returns {WinClassification}
 */
export function classifyWin(hand, melds = 0, wildTile = null, indicatorTile = null, replacement = false) {
  /** @type {WinClassification} */
  const result = { winning: false, ordinary: false, sevenPairs: false, allTriplets: false,
    allJiang: false, allHonors: false, opened: false, wildCount: 0 };
  const meldCount = validMeldCount(melds);
  if (meldCount === null || !Array.isArray(hand) || hand.length !== (4 - meldCount) * 3 + 2 ||
      (wildTile !== null && !isTileCode(wildTile)) ||
      (indicatorTile !== null && (!isTileCode(indicatorTile) || hand.includes(indicatorTile)))) return result;
  const counts = countsOf(hand);
  if (!counts) return result;
  result.opened = hasOpenedMeld(melds);
  result.wildCount = wildTile === null ? 0 : counts[wildTile];
  if (wildTile !== null) counts[wildTile] = 0;
  const knownMelds = typeof melds !== 'number' ? melds : melds === 0 ? [] : null;
  const natural = hand.filter(tile => tile !== wildTile);
  // The declared physical tile, rather than its possible wild interpretation,
  // determines whether an existing public group belongs to a category.
  result.allJiang = knownMelds !== null && natural.every(isJiangTile) &&
    knownMelds.every(meld => meld.tiles.every(isJiangTile));
  result.allHonors = knownMelds !== null && natural.every(tile => !isNumbered(tile)) &&
    knownMelds.every(meld => meld.tiles.every(tile => !isNumbered(tile)));
  // Four equal physical tiles still supply two pairs, as in the original game.
  result.sevenPairs = meldCount === 0 && counts.reduce((odd, count) => odd + count % 2, 0) <= result.wildCount;
  result.allTriplets = knownMelds !== null && knownMelds.every(meld => meld.kind !== 'chi') &&
    groupedShape(counts, result.wildCount, meldCount, false, true);
  // 仅杠后墙尾补牌自摸可豁免开口癞子上限；牌形和二五八将仍须成立。
  result.ordinary = (!result.opened || result.wildCount <= 1 || replacement) &&
    groupedShape(counts, result.wildCount, meldCount, true);
  result.winning = result.ordinary || result.sevenPairs || result.allTriplets || result.allJiang || result.allHonors;
  return result;
}

/** Four groups plus a numbered 2/5/8 pair, or one of the four confirmed big hands.
 * Pass actual melds to distinguish concealed kongs and to validate big hands.
 * Legacy numeric counts retain ordinary-hand support without inventing group data.
 * @param {readonly TileCode[]} hand @param {readonly MeldLike[]|number} [melds]
 * @param {TileCode|null} [wildTile] @param {TileCode|null} [indicatorTile] @returns {boolean}
 */
export function isWinning(hand, melds = 0, wildTile = null, indicatorTile = null) {
  return classifyWin(hand, melds, wildTile, indicatorTile).winning;
}

// Every concealed special kong tile must be declared before Hu.
// Closed ordinary hands may only self-draw; confirmed big hands may also claim.
/** @param {readonly TileCode[]} hand @param {readonly MeldLike[]} melds
 * @param {TileCode|null} wildTile @param {TileCode|null} indicatorTile
 * @param {boolean} [selfDraw] @param {boolean} [replacement] @returns {boolean} */
function canWin(hand, melds, wildTile, indicatorTile, selfDraw = true, replacement = false) {
  if (hand.some(tile => isSpecialGangTile(tile, indicatorTile))) return false;
  // 即使调用方传入补牌标记，接炮也绝不能套用杠开例外。
  const win = classifyWin(hand, melds, wildTile, indicatorTile, selfDraw && replacement);
  return win.winning && (selfDraw || win.opened || win.sevenPairs || win.allTriplets || win.allJiang || win.allHonors);
}

/** Natural-tile shape distance; wildcards and category hands are handled outside.
 * @param {readonly number[]} initialCounts @param {number} meldCount
 * @param {boolean} jiangPair @param {boolean} [tripletsOnly] @returns {number}
 */
function naturalShapeDistance(initialCounts, meldCount, jiangPair, tripletsOnly = false) {
  const counts = [...initialCounts];
  let best = 8;
  /** @type {Set<string>} */
  const visited = new Set();
  /** @param {number} start @param {number} groups @param {number} partials @param {number} pair @returns {void} */
  function visit(start, groups, partials, pair) {
    if (best === -1) return;
    while (start < TILE_TYPE_COUNT && counts[start] === 0) start++;
    if (start === TILE_TYPE_COUNT) {
      best = Math.min(best, 8 - 2 * groups - Math.min(partials, 4 - groups) - pair);
      return;
    }
    const key = counts.join('') + ':' + groups + ':' + partials + ':' + pair;
    if (visited.has(key)) return;
    visited.add(key);
    if (groups < 4 && counts[start] >= 3) {
      counts[start] -= 3; visit(start, groups + 1, partials, pair); counts[start] += 3;
    }
    if (!tripletsOnly && groups < 4 && isNumbered(start) && rankOf(start) <= MAX_SEQUENCE_START_RANK && counts[start + 1] && counts[start + 2]) {
      counts[start]--; counts[start + 1]--; counts[start + 2]--;
      visit(start, groups + 1, partials, pair);
      counts[start]++; counts[start + 1]++; counts[start + 2]++;
    }
    if (counts[start] >= 2) {
      counts[start] -= 2;
      if (!pair && (!jiangPair || isJiangTile(start))) visit(start, groups, partials, 1);
      if (partials < 4) visit(start, groups, partials + 1, pair);
      counts[start] += 2;
    }
    if (!tripletsOnly && partials < 4 && isNumbered(start)) {
      for (const distance of [1, 2]) {
        if (rankOf(start) + distance > SUIT_SIZE || !counts[start + distance]) continue;
        counts[start]--; counts[start + distance]--;
        visit(start, groups, partials + 1, pair);
        counts[start]++; counts[start + distance]++;
      }
    }
    counts[start]--; visit(start, groups, partials, pair); counts[start]++;
  }
  visit(TILE.MAN, meldCount, 0, 0);
  return best;
}

/** -1 means complete; a 13-equivalent hand returns 0 only if a legal draw wins.
 * Distances farther from ready are heuristics shared by the AI and hint system.
 * @param {readonly TileCode[]} hand @param {readonly MeldLike[]|number} [melds]
 * @param {TileCode|null} [wildTile] @param {TileCode|null} [indicatorTile] @returns {number}
 */
export function calculateShanten(hand, melds = 0, wildTile = null, indicatorTile = null) {
  const original = countsOf(hand);
  const meldCount = validMeldCount(melds);
  if (!original || meldCount === null || hand.includes(RED_DRAGON) || (wildTile !== null && !isTileCode(wildTile)) ||
      (indicatorTile !== null && (!isTileCode(indicatorTile) || hand.includes(indicatorTile)))) return 8;
  if (isWinning(hand, melds, wildTile, indicatorTile)) return -1;
  const counts = [...original];
  const wilds = wildTile === null ? 0 : counts[wildTile];
  if (wildTile !== null) counts[wildTile] = 0;
  const opened = hasOpenedMeld(melds);
  let best = naturalShapeDistance(counts, meldCount, true) - Math.min(wilds, opened ? 1 : wilds);
  if (opened) best = Math.max(best, wilds - 1);
  const knownMelds = typeof melds !== 'number' ? melds : melds === 0 ? [] : null;
  if (meldCount === 0) {
    const pairs = counts.reduce((total, count) => total + Math.floor(count / 2), 0);
    best = Math.min(best, 6 - pairs - wilds);
  }
  if (knownMelds !== null) {
    if (knownMelds.every(meld => meld.kind !== 'chi')) {
      best = Math.min(best, naturalShapeDistance(counts, meldCount, false, true) - wilds);
    }
    const target = (4 - meldCount) * 3 + 2;
    for (const category of [isJiangTile, (/** @type {TileCode} */ tile) => !isNumbered(tile)]) {
      if (!knownMelds.every(meld => meld.tiles.every(category))) continue;
      const matching = hand.filter(tile => tile === wildTile || category(tile)).length;
      best = Math.min(best, target - matching - 1);
    }
  }
  best = Math.max(0, best);
  if (best === 0 && hand.length === (4 - meldCount) * 3 + 1) {
    const declared = knownMelds?.flatMap(meld => meld.tiles) || [];
    for (let draw = TILE.MAN; draw < TILE_TYPE_COUNT; draw++) {
      if (isSpecialGangTile(draw, indicatorTile) || original[draw] + declared.filter(tile => tile === draw).length >= COPIES_PER_TILE) continue;
      if (isWinning([...hand, draw], melds, wildTile, indicatorTile)) return 0;
    }
    return 1;
  }
  return best;
}

/** @param {readonly TileCode[]} hand @returns {number} */
function handShape(hand) {
  const counts = countsOf(hand);
  if (!counts) return -1000;
  let value = 0;
  for (let tile = TILE.MAN; tile < TILE_TYPE_COUNT; tile++) {
    const count = counts[tile];
    if (!count) continue;
    if (count >= 3) value += 12;
    else if (count === 2) value += !isNumbered(tile) ? 7 : 6;
    else if (!isNumbered(tile)) value -= 3;
    if (isNumbered(tile)) {
      const rank = rankOf(tile);
      value += count * (rank >= 3 && rank <= MAX_SEQUENCE_START_RANK ? 0.12 : 0);
      if (rank < SUIT_SIZE) value += Math.min(count, counts[tile + 1]) * 2.3;
      if (rank <= MAX_SEQUENCE_START_RANK) value += Math.min(count, counts[tile + 2]) * 1.1;
    }
  }
  return value;
}

/** Returns a legal discard index, or -1 when no discard is possible.
 * @param {readonly TileCode[]} hand @param {readonly MeldLike[]|number} [melds]
 * @param {readonly TileCode[]} [visible] @param {TileCode|null} [wildTile] @param {TileCode|null} [indicatorTile]
 * @returns {number}
 */
export function chooseDiscard(hand, melds = [], visible = [], wildTile = null, indicatorTile = null) {
  if (!Array.isArray(hand) || hand.length === 0) return -1;
  /** @type {number[]} */
  const seen = Array(TILE_TYPE_COUNT).fill(0);
  for (const tile of visible) if (isTileCode(tile)) seen[tile]++;
  const own = countsOf(hand) || Array(TILE_TYPE_COUNT).fill(0);
  let bestIndex = -1;
  let bestDistance = Infinity;
  let bestValue = -Infinity;
  const visited = new Set();
  const keepWilds = isTileCode(wildTile) && (!hasOpenedMeld(melds) || own[wildTile] <= 1) &&
    hand.some(tile => !isSpecialGangTile(tile, indicatorTile) && tile !== wildTile);
  for (let index = 0; index < hand.length; index++) {
    const tile = hand[index];
    if (isSpecialGangTile(tile, indicatorTile)) continue;
    if (keepWilds && tile === wildTile) continue;
    if (visited.has(tile)) continue;
    visited.add(tile);
    const remaining = hand.filter((_, position) => position !== index);
    const distance = calculateShanten(remaining, melds, wildTile, indicatorTile);
    if (distance > bestDistance) continue;
    let value = handShape(wildTile === null ? remaining : remaining.filter(value => value !== wildTile)) + Math.min(seen[tile], 3) * 0.2;
    if (distance === 0) {
      // Prefer a ready hand whose winning tiles still have copies outside it.
      let winningCopies = 0;
      for (let draw = TILE.MAN; draw < TILE_TYPE_COUNT; draw++) {
        if (!isSpecialGangTile(draw, indicatorTile) && isWinning([...remaining, draw], melds, wildTile, indicatorTile)) {
          winningCopies += Math.max(0, COPIES_PER_TILE - own[draw] - seen[draw]);
        }
      }
      value += winningCopies * 10;
    }
    if (distance < bestDistance || value > bestValue) {
      bestIndex = index; bestDistance = distance; bestValue = value;
    }
  }
  return bestIndex;
}

/** The original seeded random source; also shared by deterministic simulations.
 * @param {unknown} seed @returns {() => number} */
export function makeRandom(seed) {
  let state = 2166136261;
  for (const letter of String(seed)) state = Math.imul(state ^ letter.charCodeAt(0), 16777619);
  if (!state) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** 原结算表的纯函数版本，供结算与提示排序共用；不改变分值。
 * @param {readonly TileCode[]} hand @param {readonly MeldLike[]} melds @param {boolean} selfDraw @param {boolean} [replacement]
 * @returns {import('./src/domain/model.js').ScoreBreakdown[]}
 */
export function getWinBreakdown(hand, melds, selfDraw, replacement = false) {
  const allTiles = [...hand, ...melds.flatMap(meld => meld.tiles)];
  const breakdown = [{ name: '基础胡牌', points: 10 }];
  // Shape bonuses use only an independently valid natural interpretation;
  // wildcard substitutions have no specified bonus schedule yet.
  const naturalCounts = countsOf(hand);
  const naturalWin = naturalCounts !== null &&
    ((melds.length === 0 && isSevenPairs(hand)) || groupedShape(naturalCounts, 0, melds.length, false));
  if (naturalWin && melds.length === 0 && isSevenPairs(hand)) breakdown.push({ name: '七对', points: 10 });
  else if (naturalWin) {
    const counts = countsOf(hand);
    if (melds.every(meld => meld.kind !== 'chi') && counts &&
        counts.filter(count => count === 2).length === 1 && counts.every(count => count === 0 || count === 2 || count === 3)) {
      breakdown.push({ name: '碰碰胡', points: 10 });
    }
  }
  const suits = new Set(allTiles.map(tileSuit));
  if (naturalWin && suits.size === 1) breakdown.push({ name: suits.has('honor') ? '字一色' : '清一色', points: suits.has('honor') ? 30 : 20 });
  if (selfDraw) breakdown.push({ name: '自摸', points: 10 });
  if (selfDraw && replacement) breakdown.push({name:SCORING_TEXT.replacementWin, points:SCORE_RULES.base * SCORE_RULES.replacementWin});
  return breakdown;
}

/** @returns {AvailableActions} */
function emptyActions() {
  return { hu: false, peng: false, gang: false, redGang: false, piziGang: false, wildGang: false, chi: [], pass: false, concealedGangs: [], addedGangs: [] };
}

/** @param {AvailableActions} actions @returns {boolean} */
function hasClaim(actions) {
  return actions.hu || actions.peng || actions.gang || actions.chi.length > 0;
}

/** @param {TileCode[]} hand @param {readonly TileCode[]} tiles @returns {boolean} */
function removeTiles(hand, tiles) {
  const remaining = [...hand];
  for (const tile of tiles) {
    const index = remaining.indexOf(tile);
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  hand.splice(0, hand.length, ...remaining);
  return true;
}

/** @param {unknown} left @param {readonly TileCode[]} right @returns {boolean} */
function sameSequence(left, right) {
  return Array.isArray(left) && left.length === right.length &&
    [...left].sort((a, b) => a - b).every((tile, index) => tile === right[index]);
}

/**
 * Human is seat 0. Call advanceAI() until it returns false after each human move.
 * Claim responses are collected before priority is resolved; a lower claim can lose.
 * No flower tiles, dead wall, multiple winners, or robbing an added kong in this variant.
 */
export class MahjongGame {
  /** @type {TileCode[]} */
  wall = [];
  /** @type {PlayerId} */
  dealer = 0;
  /** @type {PlayerId} */
  current = 0;
  /** @type {Phase} */
  phase = { kind: PHASE.DEALING, dealt: 0 };
  /** @type {PendingDiscard|null} */
  pendingDiscard = null;
  /** Most recent public river tile; retained after passing, removed on a claim.
   * @type {{from:PlayerId,tile:TileCode,index:number}|null} */
  lastDiscard = null;
  /** @type {PlayerId|null} */
  winner = null;
  /** @type {GameResult|null} */
  result = null;
  /** @type {LastDraw|null} */
  lastDraw = null;
  /** @type {string[]} */
  events = [];
  /** @type {(ClaimResponse|null)[]} */
  _responses = [];
  /** @type {TileCode|null} */
  indicatorTile = null;
  /** @type {TileCode|null} */
  wildTile = null;
  /** @type {WallInfo} */
  wallInfo = { dice: [1, 1], indicatorPosition: null, tailDraws: 0 };
  /** @type {number[]} */
  gangScoreDelta = [0, 0, 0, 0];

  /** @param {GameOptions|string|number|boolean|null} [options] */
  constructor(options = {}) {
    if (typeof options !== 'object' || options === null) options = { seed: options };
    /** @type {PlayerState[]} */
    this.players = DEFAULT_NAMES.map((name, index) => ({
      name: options.names?.[index] || name,
      hand: [], melds: [], redGangs: [], piziGangs: [], discards: [], score: 1000,
    }));
    this.round = 0;
    this.laiziEnabled = Boolean(options.laizi);
    const seed = options.seed ?? `${Date.now()}-${Math.random()}`;
    this._random = makeRandom(seed);
    this._diceRandom = makeRandom(`dice:${String(seed)}`);
    this.newRound();
  }

  /** A restart redeals the current round; a new round rotates the dealer counterclockwise.
   * @param {unknown} [seed] @param {NewRoundOptions} [options] @returns {this}
   */
  newRound(seed, { restart = false, laizi = this.laiziEnabled } = {}) {
    this._setPhase({ kind: PHASE.DEALING, dealt: 0 });
    if (seed !== undefined) {
      this._random = makeRandom(seed);
      this._diceRandom = makeRandom(`dice:${String(seed)}`);
    }
    if (!restart || this.round === 0) this.round++;
    this.gangScoreDelta = [0, 0, 0, 0];
    // Seats are bottom (0), right (1), top (2), and left (3).
    this.dealer = /** @type {PlayerId} */ ((this.round - 1) % 4);
    this.wall = Array.from({ length: TOTAL_TILE_COUNT }, (_, index) => Math.floor(index / COPIES_PER_TILE));
    for (let index = this.wall.length - 1; index > 0; index--) {
      const target = Math.floor(this._random() * (index + 1));
      [this.wall[index], this.wall[target]] = [this.wall[target], this.wall[index]];
    }
    this.laiziEnabled = Boolean(laizi);
    this.indicatorTile = null;
    this.wildTile = null;
    this.wallInfo = {
      dice: [Math.floor(this._diceRandom() * DICE_SIDES) + 1, Math.floor(this._diceRandom() * DICE_SIDES) + 1],
      indicatorPosition: null,
      tailDraws: 0,
    };
    if (this.laiziEnabled) {
      const position = (Math.min(...this.wallInfo.dice) - 1) * TILES_PER_STACK;
      const candidate = this.wall[position];
      this.wallInfo.indicatorPosition = position;
      if (candidate === RED_DRAGON || nextWildTile(candidate) === RED_DRAGON) {
        // Red dragons keep their special kong role, whether revealed directly
        // or reached as the wildcard. Exchange an actual white into this slot.
        const whitePosition = this.wall.lastIndexOf(TILE.WHITE);
        [this.wall[position], this.wall[whitePosition]] = [this.wall[whitePosition], this.wall[position]];
        this.indicatorTile = this.wall.splice(position, 1)[0];
        this.wildTile = TILE.GREEN;
      } else {
        this.indicatorTile = this.wall.splice(position, 1)[0];
        this.wildTile = nextWildTile(candidate);
      }
    }
    for (const player of this.players) {
      player.hand = []; player.melds = []; player.redGangs = []; player.piziGangs = []; player.discards = [];
    }
    for (let deal = 0; deal < 13; deal++) {
      for (const player of this.players) player.hand.push(/** @type {TileCode} */ (this.wall.pop()));
    }
    for (const player of this.players) player.hand.sort((a, b) => a - b);
    this.current = /** @type {PlayerId} */ (this.dealer);
    this._setPhase({ kind: PHASE.DISCARD, seat: this.current });
    this.pendingDiscard = null;
    this.lastDiscard = null;
    this.winner = null;
    this.result = null;
    this.lastDraw = null;
    this.events = [];
    this._responses = Array(4).fill(null);
    this._log(`第 ${this.round} 局开始，${this.players[this.dealer].name}坐庄，庄家先出牌。`);
    if (this.laiziEnabled) this._log(`翻出皮子${tileName(this.indicatorTile)}，${tileName(this.wildTile)}为本局癞子。`);
    this._drawTile(/** @type {PlayerId} */ (this.dealer));
    return this;
  }

  /** @param {Phase} next @returns {void} */
  _setPhase(next) {
    assertPhaseTransition(this.phase, next);
    this.phase = next;
  }

  /** @param {string} message @returns {void} */
  _log(message) {
    this.events.push(message);
    if (this.events.length > 80) this.events.shift();
  }

  /** @param {unknown} player @returns {player is PlayerId} */
  _validPlayer(player) {
    return isPlayerId(player);
  }

  /** @param {number} player @returns {AvailableActions} */
  _rawClaimActions(player) {
    const actions = emptyActions();
    if (this.phase.kind !== PHASE.CLAIM || !this.pendingDiscard || !this._validPlayer(player) || player === this.pendingDiscard.from) return actions;
    const seat = this.players[player];
    const tile = this.pendingDiscard.tile;
    if (isSpecialGangTile(tile, this.indicatorTile)) return actions;
    const counts = countsOf(seat.hand);
    if (!counts) return actions;
    actions.hu = canWin([...seat.hand, tile], seat.melds, this.wildTile, this.indicatorTile, false, false);
    if (seat.melds.length < 4) {
      // 癞子不能按原牌面吃碰，也不能作为手中搭子参与吃；杠和胡沿用各自规则。
      actions.peng = tile !== this.wildTile && counts[tile] >= 2;
      actions.gang = counts[tile] >= 3 && this.wall.length > 0;
      if (tile !== this.wildTile && player === (this.pendingDiscard.from + 1) % 4 && isNumbered(tile)) {
        for (let start = tile - 2; start <= tile; start++) {
          if (start < TILE.MAN || suitOf(start) !== suitOf(tile) || rankOf(start) > MAX_SEQUENCE_START_RANK) continue;
          const sequence = [start, start + 1, start + 2];
          const needed = sequence.filter(value => value !== tile);
          if (needed.every(value => value !== this.wildTile && counts[value] > 0 && !isSpecialGangTile(value, this.indicatorTile))) actions.chi.push(sequence);
        }
      }
    }
    actions.pass = hasClaim(actions);
    return actions;
  }

  /** @param {number} [player] @returns {AvailableActions} */
  getActions(player = 0) {
    const actions = emptyActions();
    if (!this._validPlayer(player) || this.phase.kind === PHASE.ENDED) return actions;
    if (this.phase.kind === PHASE.CLAIM) {
      return this._responses[player] ? actions : this._rawClaimActions(player);
    }
    if (this.phase.kind !== PHASE.DISCARD || this.current !== player) return actions;
    const seat = this.players[player];
    const counts = countsOf(seat.hand);
    if (!counts) return actions;
    const replacement = this.lastDraw?.player === player && this.lastDraw.replacement === true;
    actions.hu = this.lastDraw?.player === player && canWin(seat.hand, seat.melds, this.wildTile, this.indicatorTile, true, replacement);
    if (this.wall.length > 0) {
      // 同牌多重身份只开放最高优先级入口：皮子 > 红中 > 癞子。
      actions.redGang = this.indicatorTile !== RED_DRAGON && counts[RED_DRAGON] > 0;
      actions.piziGang = this.indicatorTile !== null && counts[this.indicatorTile] > 0;
      actions.wildGang = this.wildTile !== null && this.wildTile !== RED_DRAGON && this.wildTile !== this.indicatorTile && counts[this.wildTile] > 0;
      if (seat.melds.length < 4) {
        actions.concealedGangs = counts.flatMap((count, tile) => count === COPIES_PER_TILE && !isSpecialGangTile(tile, this.indicatorTile) ? [tile] : []);
      }
      actions.addedGangs = seat.melds
        .filter(meld => meld.kind === 'peng' && !isSpecialGangTile(meld.tiles[0], this.indicatorTile) && counts[meld.tiles[0]] > 0)
        .map(meld => meld.tiles[0]);
    }
    return actions;
  }

  /** @param {number} player @param {number} index @returns {boolean} */
  discard(player, index) {
    if (!this._validPlayer(player) || this.phase.kind !== PHASE.DISCARD || this.current !== player ||
        !Number.isInteger(index) || index < 0 || index >= this.players[player].hand.length) return false;
    const seat = this.players[player];
    if (isSpecialGangTile(seat.hand[index], this.indicatorTile)) return false;
    const [tile] = seat.hand.splice(index, 1);
    seat.discards.push(tile);
    this.lastDiscard = { from:player, tile, index:seat.discards.length - 1 };
    this.pendingDiscard = { tile, from: player };
    this._setPhase({ kind: PHASE.CLAIM, discard: this.pendingDiscard });
    this.lastDraw = null;
    this._responses = Array(4).fill(null);
    this._log(`${seat.name}打出${tileName(tile)}。`);
    this._tryResolveClaims();
    return true;
  }

  /** Submit a typed command. The command seat must agree with its caller.
   * @param {number} player @param {Action} action @returns {boolean}
   */
  applyAction(player, action) {
    if (!this._validPlayer(player) || !action || typeof action !== 'object' || action.player !== player) return false;
    if (action.kind === ACTION.DISCARD) return this.discard(player, action.index);
    if (action.kind === ACTION.PASS) return this.pass(player);
    const actions = this.getActions(player);
    if (this.phase.kind === PHASE.DISCARD && this.current === player) {
      if (action.kind === ACTION.HU && action.selfDraw === true && actions.hu) {
        this._finishWin(player, null, true); return true;
      }
      if (action.kind === ACTION.RED_GANG && actions.redGang) {
        const seat = this.players[player];
        removeTiles(seat.hand, [RED_DRAGON]);
        seat.redGangs.push(RED_DRAGON);
        this._scoreSpecialGang(player, 'redGang');
        this.lastDraw = null;
        this._log(`${seat.name}红中杠，补摸一张牌。`);
        this._drawTile(player, true);
        return true;
      }
      if (action.kind === ACTION.PIZI_GANG && actions.piziGang && this.indicatorTile !== null) {
        const seat = this.players[player];
        removeTiles(seat.hand, [this.indicatorTile]);
        seat.piziGangs.push(this.indicatorTile);
        this._scoreSpecialGang(player, 'piziGang');
        this.lastDraw = null;
        this._log(`${seat.name}皮子杠${tileName(this.indicatorTile)}，补摸一张牌。`);
        this._drawTile(player, true);
        return true;
      }
      if (action.kind === ACTION.WILD_GANG && actions.wildGang && this.wildTile !== null) {
        const seat = this.players[player];
        removeTiles(seat.hand, [this.wildTile]);
        seat.piziGangs.push(this.wildTile);
        this._scoreSpecialGang(player, 'wildGang');
        this.lastDraw = null;
        this._log(`${seat.name}癞子杠${tileName(this.wildTile)}，补摸一张牌。`);
        this._drawTile(player, true);
        return true;
      }
      if (action.kind === ACTION.GANG && (action.mode === 'concealed' || action.mode === 'added')) {
        const choices = action.mode === 'concealed' ? actions.concealedGangs : actions.addedGangs;
        if (!choices.includes(action.tile)) return false;
        this._selfGang(player, action.mode, action.tile); return true;
      }
      return false;
    }
    if (this.phase.kind !== PHASE.CLAIM || this._responses[player]) return false;
    if (action.kind === ACTION.CHI) {
      const selected = actions.chi.find(candidate => sameSequence(action.sequence, candidate));
      if (!selected) return false;
      this._responses[player] = { action: ACTION.CHI, tiles: [...selected] };
    } else if (action.kind === ACTION.HU && action.selfDraw === false && actions.hu) {
      this._responses[player] = { action: ACTION.HU };
    } else if (action.kind === ACTION.PENG && actions.peng) {
      this._responses[player] = { action: ACTION.PENG };
    } else if (action.kind === ACTION.GANG && action.mode === 'exposed' &&
               action.tile === this.pendingDiscard?.tile && actions.gang) {
      this._responses[player] = { action: ACTION.GANG };
    } else return false;
    this._tryResolveClaims();
    return true;
  }

  /** Legacy strings and optional tiles are translated into one typed command.
   * @deprecated Use applyAction(player, action).
   * @param {number} player @param {string} action
   * @param {TileCode|TileCode[]|null} [tiles] @returns {boolean}
   */
  claim(player, action, tiles) {
    if (!this._validPlayer(player)) return false;
    /** @type {Record<string, string>} */
    const aliases = { 'concealed-gang': 'concealedGang', 'added-gang': 'addedGang', anGang: 'concealedGang', buGang: 'addedGang' };
    const kind = aliases[action] || action;
    if (kind === ACTION.HU) return this.applyAction(player, { kind: ACTION.HU, player, selfDraw: this.phase.kind === PHASE.DISCARD });
    if (kind === ACTION.RED_GANG) return this.applyAction(player, { kind: ACTION.RED_GANG, player });
    if (kind === ACTION.PIZI_GANG) return this.applyAction(player, { kind: ACTION.PIZI_GANG, player });
    if (kind === ACTION.WILD_GANG) return this.applyAction(player, { kind: ACTION.WILD_GANG, player });
    if (kind === ACTION.PENG) return this.applyAction(player, { kind: ACTION.PENG, player });
    if (kind === ACTION.GANG) {
      if (!this.pendingDiscard) return false;
      return this.applyAction(player, { kind: ACTION.GANG, player, tile: this.pendingDiscard.tile, mode: 'exposed' });
    }
    if (kind === ACTION.CHI) {
      const sequence = tiles ?? this.getActions(player).chi[0];
      return Array.isArray(sequence) && this.applyAction(player, { kind: ACTION.CHI, player, sequence });
    }
    if (kind === 'concealedGang' || kind === 'addedGang') {
      const choices = this.getActions(player)[kind === 'concealedGang' ? 'concealedGangs' : 'addedGangs'];
      const tile = Array.isArray(tiles) ? tiles[0] : tiles ?? choices[0];
      if (tile === undefined) return false;
      return this.applyAction(player, { kind: ACTION.GANG, player, tile, mode: kind === 'concealedGang' ? 'concealed' : 'added' });
    }
    return false;
  }

  /** @param {number} [player] @returns {boolean} */
  pass(player = 0) {
    if (!this._validPlayer(player) || this.phase.kind !== PHASE.CLAIM || this._responses[player] || !this.getActions(player).pass) return false;
    this._responses[player] = { action: 'pass' };
    this._tryResolveClaims();
    return true;
  }

  /** @returns {boolean} */
  _tryResolveClaims() {
    if (this.phase.kind !== PHASE.CLAIM || !this.pendingDiscard) return false;
    for (let player = 0; player < 4; player++) {
      if (hasClaim(this._rawClaimActions(player)) && !this._responses[player]) return false;
    }
    const { from } = this.pendingDiscard;
    const priority = { hu: 3, gang: 2, peng: 2, chi: 1 };
    const choices = this._responses
      .flatMap((response, player) => response && response.action !== ACTION.PASS && isPlayerId(player) ? [{ ...response, player }] : [])
      .sort((left, right) => priority[right.action] - priority[left.action] ||
        (left.player - from + 4) % 4 - (right.player - from + 4) % 4);
    if (choices.length) this._executeClaim(choices[0]);
    else {
      this.pendingDiscard = null;
      this._responses = Array(4).fill(null);
      this._drawTile(/** @type {PlayerId} */ ((from + 1) % 4));
    }
    return true;
  }

  /** @param {Exclude<ClaimResponse, {action:'pass'}> & {player:PlayerId}} response @returns {void} */
  _executeClaim(response) {
    const { player, action } = response;
    const { tile, from } = /** @type {PendingDiscard} */ (this.pendingDiscard);
    const seat = this.players[player];
    const river = this.players[from].discards;
    // Claimed tiles leave the river; each physical tile belongs to exactly one place.
    const riverIndex = river.lastIndexOf(tile);
    if (riverIndex >= 0) river.splice(riverIndex, 1);
    this.lastDiscard = null;
    this.pendingDiscard = null;
    this._responses = Array(4).fill(null);
    this.current = player;
    this.lastDraw = null;
    if (action === 'hu') {
      seat.hand.push(tile);
      seat.hand.sort((a, b) => a - b);
      this._finishWin(player, from, false);
      return;
    }
    const meldTiles = action === 'chi' ? response.tiles : Array(action === 'gang' ? 4 : 3).fill(tile);
    const needed = [...meldTiles];
    needed.splice(needed.indexOf(tile), 1);
    removeTiles(seat.hand, needed);
    seat.melds.push({ kind: action, tiles: [...meldTiles], from, concealed: false });
    this._setPhase({ kind: PHASE.DISCARD, seat: player });
    this._log(`${seat.name}${{ chi: '吃', peng: '碰', gang: '明杠' }[action]}${tileName(tile)}。`);
    if (action === 'gang') this._drawTile(player, true);
    else if (this.wall.length === 0 && seat.hand.length > 0 && seat.hand.every(value => isSpecialGangTile(value, this.indicatorTile))) {
      this._finishDraw(this._blockedSpecialGangReason(seat.hand));
    }
  }

  /** @param {PlayerId} player @param {'concealed'|'added'} mode @param {TileCode} tile @returns {void} */
  _selfGang(player, mode, tile) {
    const seat = this.players[player];
    if (mode === 'concealed') {
      removeTiles(seat.hand, Array(4).fill(tile));
      seat.melds.push({ kind: 'gang', tiles: Array(4).fill(tile), from: player, concealed: true });
      this._log(`${seat.name}暗杠${tileName(tile)}。`);
    } else {
      removeTiles(seat.hand, [tile]);
      const meld = /** @type {Meld} */ (seat.melds.find(group => group.kind === 'peng' && group.tiles[0] === tile));
      const upgraded = /** @type {Extract<Meld, {kind:'gang'}>} */ (meld);
      upgraded.kind = 'gang'; upgraded.tiles.push(tile); upgraded.added = true;
      this._log(`${seat.name}补杠${tileName(tile)}。`);
    }
    this.lastDraw = null;
    this._drawTile(player, true);
  }

  /** @param {PlayerId} player @param {boolean} [replacement] @returns {boolean} */
  _drawTile(player, replacement = false) {
    this.current = player;
    if (!this.wall.length) {
      this._finishDraw(); return false;
    }
    const tile = /** @type {TileCode} */ (replacement ? this.wall.shift() : this.wall.pop());
    if (replacement) this.wallInfo.tailDraws++;
    const hand = this.players[player].hand;
    hand.push(tile); hand.sort((a, b) => a - b);
    this._setPhase({ kind: PHASE.DISCARD, seat: player });
    this.lastDraw = { player, tile, index: hand.lastIndexOf(tile), replacement };
    this._log(player === 0 ? `你${replacement ? '补' : '摸'}到${tileName(tile)}。` : `${this.players[player].name}${replacement ? '补牌' : '摸牌'}。`);
    if (this.wall.length === 0 && hand.length > 0 && hand.every(value => isSpecialGangTile(value, this.indicatorTile))) {
      this._finishDraw(this._blockedSpecialGangReason(hand));
    }
    return true;
  }

  /** @returns {TileCode[]} */
  _visibleTiles() {
    return [
      ...(this.indicatorTile === null ? [] : [this.indicatorTile]),
      ...this.players.flatMap(player => [...player.discards, ...player.redGangs, ...player.piziGangs, ...player.melds.flatMap(meld => meld.tiles)]),
    ];
  }

  /** @param {PlayerId} player @param {AvailableActions} actions @returns {ClaimResponse} */
  _botClaim(player, actions) {
    if (actions.hu) return { action: 'hu' };
    const pending = /** @type {PendingDiscard} */ (this.pendingDiscard);
    if (pending.tile === this.wildTile) return { action: 'pass' };
    if (actions.gang) return { action: 'gang' };
    const seat = this.players[player];
    const tile = pending.tile;
    const before = calculateShanten(seat.hand, seat.melds, this.wildTile, this.indicatorTile);
    /** @type {ClaimResponse|null} */
    let best = null;
    let bestDistance = before;
    /** @type {(Extract<ClaimResponse, {action:'peng'|'chi'}> & {tiles:TileCode[]})[]} */
    const candidates = [];
    if (actions.peng) candidates.push({ action: 'peng', tiles: Array(3).fill(tile) });
    for (const sequence of actions.chi) candidates.push({ action: 'chi', tiles: sequence });
    for (const candidate of candidates) {
      const remaining = [...seat.hand];
      const needed = [...candidate.tiles]; needed.splice(needed.indexOf(tile), 1);
      if (!removeTiles(remaining, needed)) continue;
      const melds = [...seat.melds, { kind: candidate.action, tiles: candidate.tiles }];
      const discard = chooseDiscard(remaining, melds, this._visibleTiles(), this.wildTile, this.indicatorTile);
      if (discard < 0) continue;
      remaining.splice(discard, 1);
      const after = calculateShanten(remaining, melds, this.wildTile, this.indicatorTile);
      if (after < bestDistance || (after === bestDistance && !best && (this.wall.length < 48 || candidate.action === 'peng'))) {
        best = candidate; bestDistance = after;
      }
    }
    return best || { action: 'pass' };
  }

  /** Advance one AI response or turn, leaving human decisions pending.
   * @returns {boolean}
   */
  advanceAI() {
    if (this.phase.kind === PHASE.ENDED) return false;
    if (this.phase.kind === PHASE.CLAIM) {
      const from = this.phase.discard.from;
      for (let distance = 1; distance < 4; distance++) {
        const player = /** @type {PlayerId} */ ((from + distance) % 4);
        if (player === 0 || this._responses[player]) continue;
        const actions = this._rawClaimActions(player);
        if (!hasClaim(actions)) continue;
        const choice = this._botClaim(player, actions);
        if (choice.action === 'pass') this.pass(player);
        else this.claim(player, choice.action, choice.tiles);
        return true;
      }
      return this._tryResolveClaims();
    }
    if (this.phase.kind !== PHASE.DISCARD || this.current === 0) return false;
    const player = this.current;
    const actions = this.getActions(player);
    if (actions.hu) return this.claim(player, 'hu');
    if (actions.redGang) return this.claim(player, 'redGang');
    if (actions.piziGang) return this.claim(player, 'piziGang');
    const concealed = actions.concealedGangs.find(tile => tile !== this.wildTile);
    if (concealed !== undefined) return this.claim(player, 'concealedGang', concealed);
    const added = actions.addedGangs.find(tile => tile !== this.wildTile);
    if (added !== undefined) return this.claim(player, 'addedGang', added);
    const discard = chooseDiscard(this.players[player].hand, this.players[player].melds, this._visibleTiles(), this.wildTile, this.indicatorTile);
    if (discard < 0) {
      this._finishDraw(this._blockedSpecialGangReason(this.players[player].hand));
      return true;
    }
    return this.discard(player, discard);
  }

  /** @param {readonly TileCode[]} hand @returns {string} */
  _blockedSpecialGangReason(hand) {
    return hand.some(tile => tile !== RED_DRAGON)
      ? '牌墙已空，红中或皮子无法补杠，本局流局'
      : '牌墙已空，红中无法补杠，本局流局';
  }

  /** 单张杠的实牌已经移入公开区后才记账；失败请求与重放均到不了这里。
   * @param {PlayerId} player @param {'redGang'|'piziGang'|'wildGang'} kind
   */
  _scoreSpecialGang(player, kind) {
    const points = SCORE_RULES.base * SCORE_RULES[kind];
    for (let seat = 0; seat < 4; seat++) {
      const delta = seat === player ? points * 3 : -points;
      this.players[seat].score += delta;
      this.gangScoreDelta[seat] += delta;
    }
  }

  /** @param {PlayerId} winner @param {PlayerId|null} from @param {boolean} selfDraw @returns {void} */
  _finishWin(winner, from, selfDraw) {
    const seat = this.players[winner];
    const replacement = selfDraw && this.lastDraw?.player === winner && this.lastDraw.replacement === true;
    const breakdown = getWinBreakdown(seat.hand, seat.melds, selfDraw, replacement);
    const points = breakdown.reduce((total, item) => total + item.points, 0);
    const scoreDelta = Array(4).fill(0);
    const classification = classifyWin(seat.hand, seat.melds, this.wildTile, this.indicatorTile, replacement);
    const bigWin = classification.sevenPairs || classification.allTriplets || classification.allJiang || classification.allHonors;
    if (selfDraw || bigWin) {
      for (let player = 0; player < 4; player++) if (player !== winner) scoreDelta[player] = -points;
      scoreDelta[winner] = points * 3;
    } else {
      scoreDelta[/** @type {PlayerId} */ (from)] = -points; scoreDelta[winner] = points;
    }
    for (let player = 0; player < 4; player++) this.players[player].score += scoreDelta[player];
    // 杠分已在开杠时入账；结算界面展示整局净分，但不能再次加到余额。
    for (let player = 0; player < 4; player++) scoreDelta[player] += this.gangScoreDelta[player];
    this.winner = winner;
    this.current = winner;
    this.pendingDiscard = null;
    this.result = {
      kind: 'win', type: 'win', winner, from, selfDraw, points, scoreDelta,
      patterns: breakdown.map(item => item.name), breakdown, hand: [...seat.hand],
      reason: selfDraw ? '自摸' : `${this.players[/** @type {PlayerId} */ (from)].name}点炮`,
      scoringNote: SCORING_TEXT.note,
    };
    this._setPhase({ kind: PHASE.ENDED, result: this.result });
    this._log(`${seat.name}${selfDraw ? '自摸胡牌' : '胡牌'}！${this.result.patterns.join(' · ')}，获得 ${scoreDelta[winner]} 分。`);
  }

  /** @param {string} [reason] @returns {void} */
  _finishDraw(reason = '牌墙已空，本局流局') {
    this.pendingDiscard = null;
    this.winner = null;
    this.lastDraw = null;
    this.result = {
      kind: 'draw', type: 'draw', winner: null, from: null, selfDraw: false,
      points: 0, scoreDelta: [...this.gangScoreDelta], patterns: [], breakdown: [],
      reason, scoringNote: SCORING_TEXT.note,
    };
    this._setPhase({ kind: PHASE.ENDED, result: this.result });
    this._log(`${reason}。`);
  }
}
