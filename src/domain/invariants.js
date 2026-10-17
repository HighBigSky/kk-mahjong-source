// @ts-check

import { COPIES_PER_TILE, RED_DRAGON, TILE_TYPE_COUNT, TOTAL_TILE_COUNT, isTileCode } from './tile.js';
import { PHASE, PLAYER_COUNT, isPlayerId } from './model.js';

/** @typedef {import('./tile.js').TileCode} TileCode */
/** @typedef {import('./model.js').GameState} GameState */
/** @typedef {import('./model.js').Phase} Phase */

/**
 * Collect owning locations only, so a pending discard or last draw is not counted twice.
 * @param {GameState} state
 * @returns {TileCode[]}
 */
export function collectPhysicalTiles(state) {
  return [
    ...state.wall,
    ...state.players.flatMap(player => [
      ...player.hand, ...player.discards, ...player.redGangs, ...(player.piziGangs || []),
      ...player.melds.flatMap(meld => meld.tiles),
    ]),
    ...(state.indicatorTile === null ? [] : [state.indicatorTile]),
  ];
}

/**
 * Check an explicit transition. Repeating a phase may update its payload or be a
 * no-op. A redeal passes through DEALING even when newRound is called mid-round.
 * @param {Phase} previous
 * @param {Phase} next
 * @returns {void}
 */
export function assertPhaseTransition(previous, next) {
  /** @type {Record<Phase['kind'], readonly Phase['kind'][]>} */
  const allowed = {
    [PHASE.DEALING]: [PHASE.DEALING, PHASE.DISCARD],
    [PHASE.DISCARD]: [PHASE.DISCARD, PHASE.CLAIM, PHASE.ENDED, PHASE.DEALING],
    [PHASE.CLAIM]: [PHASE.CLAIM, PHASE.DISCARD, PHASE.ENDED, PHASE.DEALING],
    [PHASE.ENDED]: [PHASE.ENDED, PHASE.DEALING],
  };
  if (!previous || !next || !allowed[previous.kind]?.includes(next.kind)) {
    throw new Error(`Illegal phase transition: ${previous?.kind} -> ${next?.kind}`);
  }
}

/**
 * Assert physical tile ownership and the rules represented in public state.
 * Pass the previous phase to validate a transition without hidden history.
 * @param {GameState} state
 * @param {Phase} [previousPhase]
 * @returns {void}
 */
export function assertInvariants(state, previousPhase) {
  if (state.players.length !== PLAYER_COUNT) throw new Error('A game needs exactly four players.');
  /** @type {number[]} */
  const counts = Array(TILE_TYPE_COUNT).fill(0);
  const tiles = collectPhysicalTiles(state);
  if (tiles.length !== TOTAL_TILE_COUNT) {
    throw new Error(`Tile conservation failed: expected ${TOTAL_TILE_COUNT}, received ${tiles.length}.`);
  }
  for (const tile of tiles) {
    if (!isTileCode(tile)) throw new Error(`Invalid physical tile code: ${tile}.`);
    if (++counts[tile] > COPIES_PER_TILE) throw new Error(`Tile ${tile} has more than ${COPIES_PER_TILE} copies.`);
  }
  for (const player of state.players) {
    if ((player.piziGangs || []).some(tile => tile !== state.indicatorTile || tile === RED_DRAGON)) {
      throw new Error('A declared indicator kong must contain this round\'s indicator tile.');
    }
  }
  const wallInfo = state.wallInfo;
  if (!wallInfo || !Array.isArray(wallInfo.dice) || wallInfo.dice.length !== 2 ||
      wallInfo.dice.some(value => !Number.isInteger(value) || value < 1 || value > 6) ||
      !Number.isInteger(wallInfo.tailDraws) || wallInfo.tailDraws < 0 ||
      wallInfo.tailDraws + state.wall.length + (state.indicatorTile === null ? 0 : 1) > TOTAL_TILE_COUNT) {
    throw new Error('Wall dice and replacement-draw count must be valid.');
  }
  const expectedPosition = (Math.min(...wallInfo.dice) - 1) * 2;
  if (wallInfo.indicatorPosition !== null && wallInfo.indicatorPosition !== expectedPosition) {
    throw new Error('The indicator must occupy the upper tile of the smaller-die stack from the wall tail.');
  }
  if (!state.phase || !Object.values(PHASE).includes(state.phase.kind)) throw new Error('Unknown phase.');
  if (previousPhase) assertPhaseTransition(previousPhase, state.phase);
  if (state.phase.kind === PHASE.DISCARD) {
    if (!isPlayerId(state.phase.seat) || state.phase.seat !== state.current) {
      throw new Error('Discard phase must identify the current player.');
    }
  }
  if (state.phase.kind === PHASE.CLAIM) {
    const discard = state.pendingDiscard;
    if (!discard || !isPlayerId(discard.from) || !isTileCode(discard.tile) ||
        discard.tile !== state.phase.discard.tile || discard.from !== state.phase.discard.from ||
        state.players[discard.from].discards.at(-1) !== discard.tile) {
      throw new Error('Claim phase must identify the pending river tile.');
    }
  }
  if (state.phase.kind === PHASE.ENDED && (!state.result || state.phase.result.kind !== state.result.kind)) {
    throw new Error('Ended phase must include the game result.');
  }
  if (state.result?.kind === 'win') {
    const winner = state.result.winner;
    if (state.phase.kind !== PHASE.ENDED || !isPlayerId(winner) || state.winner !== winner) {
      throw new Error('A winning result must identify the ended game winner.');
    }
    if (state.players[winner].hand.includes(RED_DRAGON)) {
      throw new Error('A winning concealed hand cannot contain an undeclared red dragon.');
    }
    if (state.indicatorTile !== null && state.players[winner].hand.includes(state.indicatorTile)) {
      throw new Error('A winning concealed hand cannot contain an undeclared indicator kong tile.');
    }
  }
}
