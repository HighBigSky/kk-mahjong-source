// @ts-check

/** @typedef {import('./tile.js').TileCode} TileCode */
/** @typedef {0|1|2|3} PlayerId */

export const PLAYER_COUNT = 4;

export const PHASE = Object.freeze({
  DEALING: 'dealing', DISCARD: 'discard', CLAIM: 'claim', ENDED: 'ended',
});

export const ACTION = Object.freeze({
  DISCARD: 'discard', CHI: 'chi', PENG: 'peng', GANG: 'gang',
  RED_GANG: 'redGang', PIZI_GANG: 'piziGang', WILD_GANG: 'wildGang', HU: 'hu', PASS: 'pass',
});

/**
 * @typedef {{kind:'chi', tiles:TileCode[], from:PlayerId, concealed:false}
 *          | {kind:'peng', tiles:TileCode[], from:PlayerId, concealed:false}
 *          | {kind:'gang', tiles:TileCode[], from:PlayerId, concealed:boolean, added?:boolean}} Meld
 */

/** @typedef {Pick<Meld, 'kind'|'tiles'> & {concealed?:boolean, added?:boolean}} MeldLike */
/** @typedef {{id:string, code:TileCode, drawn:boolean}} HandTile */
/** @typedef {{tile:TileCode, from:PlayerId}} PendingDiscard */
/**
 * Slots count from the wall tail: even positions are upper tiles, odd lower.
 * The exposed indicator owns its tile separately; its original slot stays visible.
 * @typedef {{dice:[number, number], indicatorPosition:number|null, tailDraws:number}} WallInfo
 */
/** @typedef {{name:string, points:number}} ScoreBreakdown */

/**
 * @typedef {{kind:'win', type:'win', winner:PlayerId, from:PlayerId|null, selfDraw:boolean,
 *            points:number, scoreDelta:number[], patterns:string[], breakdown:ScoreBreakdown[],
 *            hand:TileCode[], reason:string, scoringNote:string}
 *          | {kind:'draw', type:'draw', winner:null, from:null, selfDraw:false,
 *            points:0, scoreDelta:number[], patterns:string[], breakdown:ScoreBreakdown[],
 *            reason:string, scoringNote:string}} GameResult
 */

/**
 * @typedef {{kind:'dealing', dealt:number}
 *          | {kind:'discard', seat:PlayerId}
 *          | {kind:'claim', discard:PendingDiscard}
 *          | {kind:'ended', result:GameResult}} Phase
 */

/**
 * @typedef {{kind:'discard', player:PlayerId, index:number}
 *          | {kind:'chi', player:PlayerId, sequence:TileCode[]}
 *          | {kind:'peng', player:PlayerId}
 *          | {kind:'gang', player:PlayerId, tile:TileCode, mode:'exposed'|'concealed'|'added'}
 *          | {kind:'redGang', player:PlayerId}
 *          | {kind:'piziGang', player:PlayerId}
 *          | {kind:'wildGang', player:PlayerId}
 *          | {kind:'hu', player:PlayerId, selfDraw:boolean}
 *          | {kind:'pass', player:PlayerId}} Action
 */

/**
 * @typedef {{name:string, hand:TileCode[], melds:Meld[], redGangs:TileCode[], piziGangs:TileCode[],
 *            discards:TileCode[], score:number}} PlayerState
 */

/**
 * The existing getActions result describes choices, rather than a submitted Action.
 * @typedef {{hu:boolean, peng:boolean, gang:boolean, redGang:boolean, piziGang:boolean, wildGang:boolean, chi:TileCode[][],
 *            pass:boolean, concealedGangs:TileCode[], addedGangs:TileCode[]}} AvailableActions
 */
/** @typedef {AvailableActions} Actions */

/**
 * @typedef {{action:'chi', tiles:TileCode[]}
 *          | {action:'hu', tiles?:undefined}
 *          | {action:'peng', tiles?:TileCode[]}
 *          | {action:'gang', tiles?:undefined}
 *          | {action:'pass', tiles?:undefined}} ClaimResponse
 */

/** @typedef {{player:PlayerId, tile:TileCode, index:number, replacement:boolean}} LastDraw */
/** @typedef {{seed?:unknown, names?:string[], laizi?:boolean, wildOwner?:PlayerId}} GameOptions */
/** @typedef {{restart?:boolean, laizi?:boolean}} NewRoundOptions */

/**
 * The public state shape. Pending discard and last draw reference physical tiles
 * already owned by a river or a hand; they do not own additional copies.
 * @typedef {{players:PlayerState[], wall:TileCode[], phase:Phase, current:PlayerId,
 *            dealer:PlayerId, round:number, pendingDiscard:PendingDiscard|null,
 *            result:GameResult|null, winner:PlayerId|null, lastDraw:LastDraw|null,
 *            events:string[], laiziEnabled:boolean, indicatorTile:TileCode|null,
 *            wildTile:TileCode|null, wallInfo:WallInfo}} GameState
 */

/**
 * @param {unknown} player
 * @returns {player is PlayerId}
 */
export function isPlayerId(player) {
  return typeof player === 'number' && Number.isInteger(player) && player >= 0 && player < PLAYER_COUNT;
}
