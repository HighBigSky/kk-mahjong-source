import test from 'node:test';
import assert from 'node:assert/strict';
import { MahjongGame, calculateShanten, isWinning, tileName } from '../engine.js';
import { ACTION } from '../src/domain/model.js';
import { JIANG_RANKS, TILE, TILE_TYPE_COUNT, isJiangTile } from '../src/domain/tile.js';
import { assertInvariants, collectPhysicalTiles } from '../src/domain/invariants.js';

const jiangTiles = [1, 4, 7, 10, 13, 16, 19, 22, 25];
const sequenceGroups = [[0, 1, 2], [9, 10, 11], [18, 19, 20], [24, 25, 26]];
const plainGroups = sequenceGroups.flat();

// Distinct mixed-suit sequences exclude every big-hand exemption. Every Jiang
// rank occurs at most once here, so a non-Jiang pair cannot be reinterpreted.
function completedWithPair(pair) {
  return [...plainGroups, pair, pair];
}

/** Allocate every fixture tile from the same four-copy physical pool. */
function fixture({ hand, seat = 0, melds = [], discard = null, indicatorTile = null, wildTile = null,
  redGangs = [], piziGangs = [] }) {
  const game = new MahjongGame({ seed: 'jiang-pair-fixture', laizi: false });
  const remaining = Array(TILE_TYPE_COUNT).fill(4);
  const reserve = tiles => tiles.map(tile => {
    assert.ok(--remaining[tile] >= 0, `fixture exceeds four copies of ${tileName(tile)}`);
    return tile;
  });
  game.indicatorTile = indicatorTile;
  game.wildTile = wildTile;
  game.laiziEnabled = indicatorTile !== null;
  if (indicatorTile !== null) reserve([indicatorTile]);
  for (const player of game.players) {
    player.hand = []; player.melds = []; player.redGangs = [];
    player.piziGangs = []; player.discards = [];
  }
  game.players[seat].hand = reserve(hand);
  game.players[seat].melds = structuredClone(melds);
  game.players[seat].redGangs = reserve(redGangs);
  game.players[seat].piziGangs = reserve(piziGangs);
  reserve(melds.flatMap(meld => meld.tiles));
  const from = (seat + 3) % 4;
  if (discard !== null) game.players[from].discards = reserve([discard]);
  const pool = remaining.flatMap((count, tile) => Array(count).fill(tile));
  for (let player = 0; player < 4; player++) {
    if (player !== seat) game.players[player].hand = pool.splice(0, 13);
  }
  game.wall = pool;
  game.current = discard === null ? seat : from;
  game.pendingDiscard = discard === null ? null : { tile: discard, from };
  game.phase = discard === null ? { kind: 'discard', seat } : { kind: 'claim', discard: game.pendingDiscard };
  game.lastDraw = discard === null
    ? { player: seat, tile: hand.at(-1), index: hand.length - 1, replacement: false } : null;
  game._responses = Array(4).fill(null);
  game.events = [];
  game.result = null;
  game.winner = null;
  game.wallInfo = { dice: [1, 1], indicatorPosition: indicatorTile === null ? null : 0,
    tailDraws: redGangs.length + piziGangs.length };
  assertConservation(game);
  return game;
}

function assertConservation(game) {
  assertInvariants(game);
  const physical = collectPhysicalTiles(game);
  assert.equal(physical.length, 136);
  for (let tile = 0; tile < TILE_TYPE_COUNT; tile++) {
    assert.equal(physical.filter(code => code === tile).length, 4, `four physical ${tileName(tile)}`);
  }
}

function finishResponses(game, winner) {
  for (let player = 0; player < 4 && game.phase.kind === 'claim'; player++) {
    if (player !== winner && game.getActions(player).pass) game.applyAction(player, { kind: ACTION.PASS, player });
  }
}

test('Jiang means exactly the nine numbered 2, 5 and 8 tiles, excluding honor ranks', () => {
  assert.deepEqual(JIANG_RANKS, [2, 5, 8]);
  for (let tile = 0; tile < TILE_TYPE_COUNT; tile++) {
    assert.equal(isJiangTile(tile), jiangTiles.includes(tile), tileName(tile));
  }
  for (const invalid of [-1, 34, 1.5, NaN, Infinity, undefined, null, '1', {}, []]) {
    assert.equal(isJiangTile(invalid), false);
  }
});

test('all nine natural Jiang pairs complete an ordinary four-group hand', () => {
  for (const pair of jiangTiles) assert.equal(isWinning(completedWithPair(pair)), true, tileName(pair));
});

test('every other numbered or honor pair fails the ordinary hand requirement', () => {
  for (let pair = 0; pair < TILE_TYPE_COUNT; pair++) {
    if (!jiangTiles.includes(pair)) assert.equal(isWinning(completedWithPair(pair)), false, tileName(pair));
  }
});

test('a Jiang pair contains two identical tiles, rather than matching ranks across suits', () => {
  const groups = plainGroups;
  assert.equal(isWinning([...groups, TILE.MAN + 1, TILE.PIN + 1]), false);
  assert.equal(isWinning([...groups, TILE.PIN + 4, TILE.SOU + 4]), false);
});

test('having a natural Jiang pair cannot replace the requirement for complete groups', () => {
  const incomplete = [TILE.EAST, TILE.EAST, TILE.EAST, TILE.SOUTH, TILE.SOUTH, TILE.SOUTH,
    TILE.WEST, TILE.WEST, TILE.WEST, 0, 3, 5, 1, 1];
  assert.equal(isWinning(incomplete), false);
});

test('seven natural pairs remain valid without any Jiang pair', () => {
  const sevenPairs = [0, 2, 3, 5, 6, 8, TILE.EAST].flatMap(tile => [tile, tile]);
  assert.equal(sevenPairs.some(isJiangTile), false);
  assert.equal(isWinning(sevenPairs), true);
  assert.equal(isWinning(sevenPairs, 1), false, 'exposed groups cannot be ignored to enable seven pairs');
  assert.equal(isWinning([0, 0, 2, 2, 3, 3, 5, 5, 6, 6, 8], 1), false);
  const fourOfAKind = [0, 0, 0, 0, 2, 2, 3, 3, 5, 5, 6, 6, 8, 8];
  assert.equal(isWinning(fourOfAKind), true, 'the existing four-of-a-kind-as-two-pairs convention remains');
});

test('ordinary exposed melds still require a natural Jiang pair in the remaining concealed hand', () => {
  for (let meldCount = 1; meldCount <= 4; meldCount++) {
    const melds = sequenceGroups.slice(0, meldCount).map(tiles => ({ kind: 'chi', tiles, concealed: false }));
    const groups = sequenceGroups.slice(meldCount).flat();
    assert.equal(isWinning([...groups, 1, 1], melds), true, `${meldCount} exposed groups and a Jiang pair`);
    assert.equal(isWinning([...groups, 0, 0], melds), false, `${meldCount} exposed groups and a non-Jiang pair`);
  }
});

test('each seat can self-draw Hu with every natural Jiang pair and keeps all 136 tiles', () => {
  for (let seat = 0; seat < 4; seat++) {
    for (const pair of jiangTiles) {
      const game = fixture({ seat, hand: completedWithPair(pair) });
      assert.equal(game.getActions(seat).hu, true, `seat ${seat}, ${tileName(pair)}`);
      assert.equal(game.applyAction(seat, { kind: ACTION.HU, player: seat, selfDraw: true }), true);
      assert.equal(game.result.kind, 'win');
      assert.equal(game.result.winner, seat);
      assert.equal(game.result.selfDraw, true);
      assertConservation(game);
    }
  }
});

test('non-Jiang natural pairs cannot self-draw Hu or bypass getActions through applyAction', () => {
  for (const pair of [0, 2, 3, 5, 6, 8, TILE.EAST, TILE.SOUTH, TILE.WEST, TILE.NORTH, TILE.GREEN, TILE.WHITE]) {
    for (let seat = 0; seat < 4; seat++) {
      const game = fixture({ seat, hand: completedWithPair(pair) });
      assert.equal(game.getActions(seat).hu, false, `seat ${seat}, ${tileName(pair)}`);
      const before = JSON.stringify(game);
      assert.equal(game.applyAction(seat, { kind: ACTION.HU, player: seat, selfDraw: true }), false);
      assert.equal(game.claim(seat, 'hu'), false, 'the deprecated adapter uses the same rule');
      assert.equal(JSON.stringify(game), before, 'rejected Hu must leave the entire game unchanged');
      assertConservation(game);
    }
  }
});

test('each opened seat can claim a winning discard with any natural Jiang pair', () => {
  for (let seat = 0; seat < 4; seat++) {
    for (const pair of jiangTiles) {
      const hand = completedWithPair(pair);
      const tiles = hand.splice(0, 3);
      hand.pop();
      const game = fixture({ seat, hand, discard: pair,
        melds: [{ kind: 'chi', tiles, from: (seat + 3) % 4, concealed: false }] });
      assert.equal(game.getActions(seat).hu, true, `seat ${seat}, ${tileName(pair)}`);
      assert.equal(game.applyAction(seat, { kind: ACTION.HU, player: seat, selfDraw: false }), true);
      finishResponses(game, seat);
      assert.equal(game.result?.kind, 'win');
      assert.equal(game.result.winner, seat);
      assert.equal(game.result.from, (seat + 3) % 4);
      assert.equal(game.result.selfDraw, false);
      assertConservation(game);
    }
  }
});

test('a non-Jiang winning-looking discard is rejected by both action APIs at every seat', () => {
  for (let seat = 0; seat < 4; seat++) {
    for (const pair of [0, 3, 8, TILE.EAST]) {
      const hand = completedWithPair(pair);
      hand.pop();
      const game = fixture({ seat, hand, discard: pair });
      assert.equal(game.getActions(seat).hu, false, `seat ${seat}, ${tileName(pair)}`);
      const before = JSON.stringify(game);
      assert.equal(game.applyAction(seat, { kind: ACTION.HU, player: seat, selfDraw: false }), false);
      assert.equal(game.claim(seat, 'hu'), false);
      assert.equal(JSON.stringify(game), before);
      assertConservation(game);
    }
  }
});

test('seven-pairs exemption reaches live self-draw and discard Hu actions', () => {
  const hand = [0, 2, 3, 5, 6, 8, TILE.EAST].flatMap(tile => [tile, tile]);
  const selfDraw = fixture({ hand });
  assert.equal(selfDraw.getActions(0).hu, true);
  assert.equal(selfDraw.applyAction(0, { kind: ACTION.HU, player: 0, selfDraw: true }), true);
  assertConservation(selfDraw);
  const claimed = fixture({ hand: hand.slice(0, -1), discard: hand.at(-1) });
  assert.equal(claimed.getActions(0).hu, true);
  assert.equal(claimed.applyAction(0, { kind: ACTION.HU, player: 0, selfDraw: false }), true);
  finishResponses(claimed, 0);
  assert.equal(claimed.result?.kind, 'win');
  assertConservation(claimed);
});

test('one wildcard may complete any natural Jiang pair, and two wildcards may form the whole Jiang pair', () => {
  const groups = plainGroups;
  for (const pair of jiangTiles) {
    assert.equal(isWinning([...groups, pair, TILE.GREEN], 0, TILE.GREEN), true, tileName(pair));
  }
  assert.equal(isWinning([...groups, TILE.GREEN, TILE.GREEN], 0, TILE.GREEN), true);
  // A wildcard whose printed rank is itself five can still serve as any Jiang.
  assert.equal(isWinning([...groups, 1, 4], [], 4), true);
});

test('a single wildcard cannot promote a non-Jiang numbered or honor singleton into the pair', () => {
  for (let candidate = 0; candidate < TILE_TYPE_COUNT; candidate++) {
    if (jiangTiles.includes(candidate) || candidate === TILE.GREEN) continue;
    const groups = plainGroups;
    assert.equal(isWinning([...groups, candidate, TILE.GREEN], 0, TILE.GREEN), false, tileName(candidate));
  }
  const groups = plainGroups;
  assert.equal(isWinning([...groups, 0, 4], [], 4), false, 'a printed five wildcard cannot pair with a natural one');
});

test('neither a wildcard nor a natural Jiang pair can repair an additional missing group tile', () => {
  const groups = sequenceGroups.slice(0, 3).flat();
  const isolated = [TILE.SOUTH, TILE.WEST, TILE.NORTH];
  assert.equal(isWinning([...groups, ...isolated, 1, TILE.GREEN], [], TILE.GREEN), false);
  assert.equal(isWinning([...groups, ...isolated, TILE.GREEN, TILE.GREEN], [], TILE.GREEN), false);
});

test('wildcard Jiang pairs can self-draw while closed ordinary hands cannot claim discards', () => {
  const groups = plainGroups;
  const indicatorTile = TILE.WHITE;
  const wildTile = TILE.EAST;
  for (let seat = 0; seat < 4; seat++) {
    for (const [pair, allowed] of [[[4, wildTile], true], [[wildTile, wildTile], true], [[0, wildTile], false]]) {
      for (const claimDiscard of [false, true]) {
        const hand = [...groups, ...pair];
        const discard = claimDiscard ? hand.shift() : null;
        const game = fixture({ hand, seat, discard, indicatorTile, wildTile });
        const permitted = allowed && !claimDiscard;
        assert.equal(game.getActions(seat).hu, permitted,
          `seat ${seat}, pair ${pair.map(tileName)}, discard=${claimDiscard}`);
        const before = JSON.stringify(game);
        assert.equal(game.applyAction(seat, { kind: ACTION.HU, player: seat, selfDraw: !claimDiscard }), permitted);
        if (permitted) {
          finishResponses(game, seat);
          assert.equal(game.result?.kind, 'win');
        } else {
          assert.equal(game.claim(seat, 'hu'), false);
          assert.equal(JSON.stringify(game), before);
        }
        assertConservation(game);
      }
    }
  }
});

test('AI completion and ready-hand distance agree with every natural Jiang pair', () => {
  const groups = [0, 1, 2, 9, 10, 11, 18, 19, 20, 24, 25, 26];
  for (const pair of jiangTiles) {
    assert.equal(calculateShanten([...groups, pair, pair]), -1, `complete ${tileName(pair)} pair`);
    assert.equal(calculateShanten([...groups, pair]), 0, `waiting for ${tileName(pair)}`);
  }
  const sevenPairs = [0, 2, 3, 5, 6, 8, TILE.EAST].flatMap(tile => [tile, tile]);
  assert.equal(calculateShanten(sevenPairs), -1, 'AI keeps the natural seven-pairs exemption');
});

test('AI does not call a plain hand ready when its only prospective pair is a non-Jiang honor', () => {
  const groups = [0, 1, 2, 9, 10, 11, 18, 19, 20, 24, 25, 26];
  const thirteen = [...groups, TILE.WHITE];
  for (let draw = 0; draw < TILE_TYPE_COUNT; draw++) {
    assert.equal(isWinning([...thirteen, draw]), false, `no winning draw: ${tileName(draw)}`);
  }
  assert.ok(calculateShanten(thirteen) >= 1, 'a nonexistent winning draw cannot be reported as ready');
  assert.notEqual(calculateShanten([...groups, TILE.WHITE, TILE.WHITE]), -1,
    'a non-Jiang pair cannot be reported as a completed plain hand');
});

