import assert from 'node:assert/strict';
import { MahjongGame, nextWildTile } from '../engine.js';
import { assertInvariants } from '../src/domain/invariants.js';
import { TILE, RED_DRAGON } from '../src/domain/tile.js';

// These are deliberately labelled state fixtures. Every tile is allocated from
// four real copies, but they are not claimed to be naturally dealt whole games.
export const scattered = [0, 2, 4, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22];

export function actionFixture({seat = 0, hand = [...scattered.slice(0, 12), RED_DRAGON, TILE.WHITE], melds = [], discard = null, names, indicator = TILE.WHITE} = {}) {
  const game = new MahjongGame({seed:'wall-candidate-21', laizi:true, names});
  assert.equal(game.indicatorTile, TILE.WHITE);
  game.indicatorTile = indicator;
  game.wildTile = nextWildTile(indicator);
  const counts = Array(34).fill(4);
  const take = tiles => tiles.map(tile => {
    assert.ok(--counts[tile] >= 0, `fixture exceeds four copies of ${tile}`);
    return tile;
  });
  take([game.indicatorTile]);
  for (const player of game.players) {
    player.hand = []; player.melds = []; player.redGangs = []; player.piziGangs = []; player.discards = [];
  }
  game.players[seat].hand = take(hand);
  game.players[seat].melds = structuredClone(melds);
  take(melds.flatMap(meld => meld.tiles));
  const from = (seat + 3) % 4;
  if (discard !== null) game.players[from].discards = take([discard]);
  const remaining = counts.flatMap((count, tile) => Array(count).fill(tile));
  for (let player = 0; player < 4; player++) if (player !== seat) game.players[player].hand = remaining.splice(0, 13);
  game.wall = remaining;
  game.current = discard === null ? seat : from;
  game.pendingDiscard = discard === null ? null : {tile:discard, from};
  game.phase = discard === null ? {kind:'discard', seat} : {kind:'claim', discard:game.pendingDiscard};
  game.lastDraw = discard === null ? {player:seat, tile:hand.at(-1), index:hand.length - 1, replacement:false} : null;
  game._responses = Array(4).fill(null);
  game.events = [];
  game.result = null;
  game.winner = null;
  assertInvariants(game);
  return game;
}

/** Largest physical public rack: four red + three indicator kongs + four gangs. */
export function maximumPublicFixture(names) {
  const game = actionFixture({names});
  const pool = Array.from({length:136}, (_, index) => Math.floor(index / 4));
  const take = tiles => tiles.map(tile => {
    const index = pool.indexOf(tile);
    assert.ok(index >= 0, `fixture physical copy ${tile}`);
    return pool.splice(index, 1)[0];
  });
  take([game.indicatorTile]);
  for (const player of game.players) {
    player.hand = []; player.melds = []; player.redGangs = []; player.piziGangs = []; player.discards = [];
  }
  game.players[0].redGangs = take(Array(4).fill(RED_DRAGON));
  game.players[0].piziGangs = take(Array(3).fill(TILE.WHITE));
  let code = 0;
  for (let seat = 0; seat < 4; seat++) {
    for (let group = 0; group < 4; group++) {
      const tile = code++;
      game.players[seat].melds.push({kind:'gang', tiles:take(Array(4).fill(tile)), from:(seat + 3) % 4, concealed:false});
    }
    game.players[seat].hand = take(Array(seat === 0 ? 2 : 1).fill(18 + seat));
  }
  for (let seat = 0; seat < 4; seat++) game.players[seat].discards = pool.splice(0, seat === 0 || seat === 2 ? 12 : 8);
  game.wall = pool;
  game.current = 0;
  game.phase = {kind:'discard', seat:0};
  game.pendingDiscard = null;
  game.lastDraw = null;
  assertInvariants(game);
  return game;
}

/** All seven special kongs coexist with fourteen concealed interactive tiles. */
export function maximumSpecialHandFixture(names) {
  const game = actionFixture({names});
  const pool = Array.from({length:136}, (_, index) => Math.floor(index / 4));
  const take = tile => {
    const index = pool.indexOf(tile); assert.ok(index >= 0);
    return pool.splice(index, 1)[0];
  };
  take(game.indicatorTile);
  for (const player of game.players) {
    player.hand = []; player.melds = []; player.redGangs = []; player.piziGangs = []; player.discards = [];
  }
  game.players[0].redGangs = Array.from({length:4}, () => take(RED_DRAGON));
  game.players[0].piziGangs = Array.from({length:3}, () => take(TILE.WHITE));
  for (let seat = 0; seat < 4; seat++) game.players[seat].hand = pool.splice(0, seat === 0 ? 14 : 13);
  game.wall = pool; game.lastDraw = null;
  assertInvariants(game);
  return game;
}
