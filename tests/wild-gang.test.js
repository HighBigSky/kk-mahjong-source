import test from 'node:test';
import assert from 'node:assert/strict';
import { MahjongGame, nextWildTile } from '../engine.js';
import { RED_DRAGON, TILE, TILE_TYPE_COUNT } from '../src/domain/tile.js';
import { assertInvariants, collectPhysicalTiles } from '../src/domain/invariants.js';

const PIZI = 4;          // 五万作皮子
const WILD = nextWildTile(PIZI); // 皮子的下一张

function fixture({ hand, draws = [TILE.WEST], indicator = PIZI } = {}) {
  const game = new MahjongGame({ seed: 'wild-gang-fixture', laizi: true });
  game.indicatorTile = indicator;
  game.wildTile = nextWildTile(indicator);
  game.wallInfo = { dice: [2, 5], indicatorPosition: 2, tailDraws: 0 };
  const counts = Array(TILE_TYPE_COUNT).fill(4);
  for (const tile of [indicator, ...hand, ...draws]) {
    assert.ok(--counts[tile] >= 0, `fixture exceeds four copies of ${tile}`);
  }
  const remaining = counts.flatMap((count, tile) => Array(count).fill(tile));
  for (let player = 0; player < 4; player++) {
    game.players[player].hand = player === 0 ? [...hand] : remaining.splice(0, 13);
    game.players[player].melds = [];
    game.players[player].redGangs = [];
    game.players[player].piziGangs = [];
    game.players[player].discards = [];
  }
  game.wall = [...draws, ...remaining];
  game.current = 0;
  game.phase = { kind: 'discard', seat: 0 };
  game.pendingDiscard = null;
  game.result = null;
  game.winner = null;
  game.lastDraw = { player: 0, tile: hand.at(-1), index: hand.length - 1, replacement: false };
  game._responses = Array(4).fill(null);
  return game;
}

function conservation(game) {
  assertInvariants(game);
  const tiles = collectPhysicalTiles(game);
  assert.equal(tiles.length, 136);
}

test('a wild tile alone can be declared as a special gang and draws from the wall tail', () => {
  const hand = [0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 27, 27, 25, WILD];
  const game = fixture({ hand });
  const actions = game.getActions(0);
  assert.equal(actions.piziGang, false, 'no indicator copy in hand');
  assert.equal(actions.wildGang, true, 'wild tile may be ganged when the indicator is absent');

  const before = game.wall.length;
  assert.equal(game.applyAction(0, { kind: 'wildGang', player: 0 }), true);
  assert.equal(game.players[0].hand.includes(WILD), false, 'the ganged wild leaves the hand');
  assert.deepEqual(game.players[0].piziGangs, [WILD]);
  assert.equal(game.wall.length, before - 1, 'replacement comes from the wall');
  assert.equal(game.phase.kind, 'discard');
  conservation(game);
});

test('the real indicator takes priority over the wild tile when both are held', () => {
  const hand = [0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 27, PIZI, WILD, 25];
  const game = fixture({ hand });
  const actions = game.getActions(0);
  assert.equal(actions.piziGang, true, 'indicator copy is available');
  assert.equal(actions.wildGang, false, 'wild tile is not offered while the indicator is held');

  assert.equal(game.applyAction(0, { kind: 'wildGang', player: 0 }), false, 'a wild gang is rejected while the indicator is held');
  assert.equal(game.applyAction(0, { kind: 'piziGang', player: 0 }), true);
  assert.deepEqual(game.players[0].piziGangs, [PIZI]);
  assert.equal(game.players[0].hand.includes(WILD), true, 'the wild stays in hand as a wildcard');
  conservation(game);
});

test('a ganged wild tile is public as a wild gang rather than an indicator gang', () => {
  const game = fixture({ hand: [0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 27, 27, 25, WILD] });
  game.applyAction(0, { kind: 'wildGang', player: 0 });
  assert.deepEqual(game.players[0].piziGangs, [WILD]);
  assert.notEqual(game.players[0].piziGangs[0], game.indicatorTile, 'the record keeps the wild face');
  assert.equal(game.players[0].piziGangs[0] === game.wildTile, true, 'the record can be told apart by comparing with the wild tile');
  conservation(game);
});

test('a red dragon is rejected as a special gang record', () => {
  const game = fixture({ hand: [0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 27, 27, 25, RED_DRAGON] });
  const index = game.players[0].hand.indexOf(RED_DRAGON);
  const [red] = game.players[0].hand.splice(index, 1);
  game.players[0].piziGangs.push(red);
  assert.throws(() => assertInvariants(game), /declared indicator kong/);
});
