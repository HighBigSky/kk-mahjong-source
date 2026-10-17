import test from 'node:test';
import assert from 'node:assert/strict';
import { MahjongGame, calculateShanten, classifyWin, hasOpenedMeld, isWinning, tileName } from '../engine.js';
import { ACTION } from '../src/domain/model.js';
import { TILE, TILE_TYPE_COUNT } from '../src/domain/tile.js';
import { assertInvariants, collectPhysicalTiles } from '../src/domain/invariants.js';

const WILD = TILE.EAST;
const INDICATOR = TILE.WHITE;
const chi = tiles => ({ kind: 'chi', tiles, from: 3, concealed: false });
const peng = tile => ({ kind: 'peng', tiles: [tile, tile, tile], from: 3, concealed: false });
const gang = (tile, concealed = false, added = false) => ({
  kind: 'gang', tiles: Array(4).fill(tile), from: concealed ? 0 : 3, concealed, ...(added ? { added: true } : {}),
});
const sequenceGroups = [[0, 1, 2], [9, 10, 11], [18, 19, 20], [24, 25, 26]];
const oneWildPlain = [9, 10, 11, 18, 19, 20, 24, 25, 26, 4, WILD];
const twoWildPlain = [9, 10, WILD, 18, 19, 20, 24, 25, 26, 4, WILD];
const jiangIrregular = [1, 1, 1, 4, 4, 7, 7, 7, 7, 10, 10, 13, 16, 25];
const honorIrregular = [27, 27, 27, 28, 28, 29, 29, 29, 29, 30, 30, 32, 32, 33];

// Deliberately constructed rule states, each allocated from exactly four real
// copies. They are not represented as naturally dealt or full-game histories.
function fixture({ hand, melds = [], seat = 0, discard = null, wildTile = null, indicatorTile = null,
  redGangs = [], piziGangs = [] }) {
  const game = new MahjongGame({ seed: 'confirmed-winning-rules', laizi: false });
  const pool = Array(TILE_TYPE_COUNT).fill(4);
  const take = tiles => tiles.map(tile => {
    assert.ok(--pool[tile] >= 0, `fixture exceeds four physical ${tileName(tile)}`);
    return tile;
  });
  game.indicatorTile = indicatorTile;
  game.wildTile = wildTile;
  game.laiziEnabled = indicatorTile !== null;
  if (indicatorTile !== null) take([indicatorTile]);
  for (const player of game.players) {
    player.hand = []; player.melds = []; player.redGangs = []; player.piziGangs = []; player.discards = [];
  }
  game.players[seat].hand = take(hand);
  game.players[seat].melds = structuredClone(melds);
  take(melds.flatMap(meld => meld.tiles));
  game.players[seat].redGangs = take(redGangs);
  game.players[seat].piziGangs = take(piziGangs);
  const from = (seat + 3) % 4;
  if (discard !== null) game.players[from].discards = take([discard]);
  const remaining = pool.flatMap((count, tile) => Array(count).fill(tile));
  for (let player = 0; player < 4; player++) if (player !== seat) game.players[player].hand = remaining.splice(0, 13);
  game.wall = remaining;
  game.current = discard === null ? seat : from;
  game.pendingDiscard = discard === null ? null : { tile: discard, from };
  game.phase = discard === null ? { kind: 'discard', seat } : { kind: 'claim', discard: game.pendingDiscard };
  game.lastDraw = discard === null
    ? { player: seat, tile: hand.at(-1), index: hand.length - 1, replacement: false } : null;
  game.result = null;
  game.winner = null;
  game.events = [];
  game._responses = Array(4).fill(null);
  game.wallInfo = { dice: [1, 1], indicatorPosition: indicatorTile === null ? null : 0,
    tailDraws: redGangs.length + piziGangs.length };
  conserve(game);
  return game;
}

function conserve(game) {
  assertInvariants(game);
  const tiles = collectPhysicalTiles(game);
  assert.equal(tiles.length, 136);
  for (let tile = 0; tile < TILE_TYPE_COUNT; tile++) {
    assert.equal(tiles.filter(code => code === tile).length, 4, `four physical ${tileName(tile)}`);
  }
}

function verifyHu(game, seat, expected, selfDraw = true) {
  assert.equal(game.getActions(seat).hu, expected);
  const before = JSON.stringify(game);
  assert.equal(game.applyAction(seat, { kind: ACTION.HU, player: seat, selfDraw }), expected);
  if (expected) {
    for (let player = 0; player < 4 && game.phase.kind === 'claim'; player++) {
      if (player !== seat && game.getActions(player).pass) game.applyAction(player, { kind: ACTION.PASS, player });
    }
    assert.equal(game.result?.kind, 'win');
    assert.equal(game.result.winner, seat);
  } else {
    assert.equal(game.applyAction(seat, { kind: ACTION.HU, player: seat, selfDraw: !selfDraw }), false,
      'changing the claimed draw source cannot bypass the current phase');
    assert.equal(game.claim(seat, 'hu'), false, 'legacy adapter cannot bypass the same rule');
    assert.equal(JSON.stringify(game), before, 'rejected Hu leaves all state untouched');
  }
  conserve(game);
}

test('opening is determined by actual exposed groups rather than a positive meld count alone', () => {
  assert.equal(hasOpenedMeld([]), false);
  assert.equal(hasOpenedMeld([gang(TILE.NORTH, true)]), false);
  for (const group of [chi([0, 1, 2]), peng(TILE.NORTH), gang(TILE.NORTH), gang(TILE.NORTH, false, true)]) {
    assert.equal(hasOpenedMeld([group]), true, `${group.kind}, added=${Boolean(group.added)}`);
    assert.equal(hasOpenedMeld([gang(TILE.SOUTH, true), group]), true);
  }
  assert.equal(hasOpenedMeld(0), false);
  assert.equal(hasOpenedMeld(1), true, 'numeric compatibility conservatively treats unknown public groups as open');
});

test('ordinary mixed-suit sequence hands allow zero or one wildcard after any opening', () => {
  for (const group of [chi([0, 1, 2]), peng(TILE.NORTH), gang(TILE.NORTH), gang(TILE.NORTH, false, true)]) {
    const natural = oneWildPlain.map(tile => tile === WILD ? 4 : tile);
    for (const hand of [natural, oneWildPlain]) {
      const result = classifyWin(hand, [group], WILD, INDICATOR);
      assert.equal(result.winning, true);
      assert.equal(result.ordinary, true);
      assert.equal(result.opened, true);
      assert.equal(result.wildCount, hand.filter(tile => tile === WILD).length);
      assert.equal(result.allTriplets || result.allJiang || result.allHonors || result.sevenPairs, false);
    }
  }
});

test('ordinary opened hands reject two physical wildcards even when one could retain its printed face', () => {
  for (const group of [chi([0, 1, 2]), peng(TILE.NORTH), gang(TILE.NORTH), gang(TILE.NORTH, false, true)]) {
    const result = classifyWin(twoWildPlain, [group], WILD, INDICATOR);
    assert.equal(result.winning, false);
    assert.equal(result.ordinary, false);
    assert.equal(result.wildCount, 2);
    assert.equal(result.opened, true);
  }
});

test('two wildcards may form a closed ordinary Jiang pair but cannot form an opened ordinary pair', () => {
  const closed = [...sequenceGroups.flat(), WILD, WILD];
  const openedHand = [...sequenceGroups.slice(1).flat(), WILD, WILD];
  assert.equal(classifyWin(closed, [], WILD, INDICATOR).ordinary, true);
  assert.equal(isWinning(openedHand, [chi(sequenceGroups[0])], WILD, INDICATOR), false);
  assert.equal(isWinning(twoWildPlain, [gang(TILE.NORTH, true)], WILD, INDICATOR), true,
    'a concealed kong does not trigger the ordinary opening limit');
});

test('all four seats enforce the ordinary opened wildcard limit for self-draw and winning discards', () => {
  for (let seat = 0; seat < 4; seat++) {
    for (const group of [chi([0, 1, 2]), peng(TILE.NORTH), gang(TILE.NORTH), gang(TILE.NORTH, false, true)]) {
      const natural = oneWildPlain.map(tile => tile === WILD ? 4 : tile);
      for (const [complete, allowed] of [[natural, true], [oneWildPlain, true], [twoWildPlain, false]]) {
        for (const claimDiscard of [false, true]) {
          const hand = [...complete];
          const discard = claimDiscard ? hand.splice(hand.indexOf(26), 1)[0] : null;
          const melds = [{ ...group, from: (seat + 3) % 4 }];
          const game = fixture({ hand, seat, melds, discard, wildTile: WILD, indicatorTile: INDICATOR });
          verifyHu(game, seat, allowed, !claimDiscard);
        }
      }
    }
  }
});

test('concealed kongs and declared red or indicator kongs do not open a plain hand', () => {
  const concealed = fixture({ hand: twoWildPlain, melds: [gang(TILE.NORTH, true)],
    wildTile: WILD, indicatorTile: INDICATOR });
  verifyHu(concealed, 0, true);
  const closedHand = [0, 1, 2, ...twoWildPlain];
  for (const specials of [{}, { redGangs: [TILE.RED] }, { piziGangs: [INDICATOR] },
    { redGangs: [TILE.RED], piziGangs: [INDICATOR] }]) {
    const game = fixture({ hand: closedHand, wildTile: WILD, indicatorTile: INDICATOR, ...specials });
    verifyHu(game, 0, true);
  }
});

test('seven pairs is a big hand without any Jiang pair and accepts multiple wildcards', () => {
  const natural = [0, 2, 3, 5, 6, 8, TILE.SOUTH].flatMap(tile => [tile, tile]);
  const wild = [0, 0, 3, 3, 6, 6, 9, 9, 12, 12, 15, 15, WILD, WILD];
  for (const hand of [natural, wild]) {
    const result = classifyWin(hand, [], WILD, INDICATOR);
    assert.equal(result.sevenPairs, true);
    assert.equal(result.winning, true);
    assert.equal(result.ordinary, false);
    const game = fixture({ hand, wildTile: WILD, indicatorTile: INDICATOR });
    verifyHu(game, 0, true);
  }
  assert.equal(classifyWin(wild.slice(0, 11), [chi([18, 19, 20])], WILD, INDICATOR).sevenPairs, false,
    'an exposed group cannot coexist with seven pairs');
});

test('all-triplets big hands accept any natural pair and ignore the opened wildcard limit', () => {
  const natural = [0, 0, 0, 9, 9, 9, 18, 18, 18, TILE.SOUTH, TILE.SOUTH, TILE.SOUTH, 6, 6];
  assert.equal(classifyWin(natural).allTriplets, true);
  assert.equal(classifyWin(natural).ordinary, false);
  const hand = [0, 0, 0, 9, 9, 9, 18, 18, WILD, 6, WILD];
  for (const group of [peng(TILE.NORTH), gang(TILE.NORTH), gang(TILE.NORTH, false, true), gang(TILE.NORTH, true)]) {
    const result = classifyWin(hand, [group], WILD, INDICATOR);
    assert.equal(result.allTriplets, true);
    assert.equal(result.winning, true);
    assert.equal(result.wildCount, 2);
    verifyHu(fixture({ hand, melds: [group], wildTile: WILD, indicatorTile: INDICATOR }), 0, true);
  }
  assert.equal(isWinning(hand, [chi([21, 22, 23])], WILD, INDICATOR), false,
    'a real exposed sequence prevents the all-triplets exemption');
});

test('all-Jiang is won by tile category alone even when no meld or seven-pair decomposition exists', () => {
  const result = classifyWin(jiangIrregular);
  assert.equal(result.winning, true);
  assert.equal(result.allJiang, true);
  assert.equal(result.ordinary || result.sevenPairs || result.allTriplets, false);
  assert.equal(calculateShanten(jiangIrregular), -1);
  verifyHu(fixture({ hand: jiangIrregular }), 0, true);
});

test('all-Jiang considers real public groups and permits opened multiple wildcards', () => {
  const hand = [...jiangIrregular.slice(0, 9), WILD, WILD];
  for (const group of [peng(22), gang(22), gang(22, true), gang(22, false, true)]) {
    const result = classifyWin(hand, [group], WILD, INDICATOR);
    assert.equal(result.allJiang, true);
    assert.equal(result.winning, true);
    verifyHu(fixture({ hand, melds: [group], wildTile: WILD, indicatorTile: INDICATOR }), 0, true);
  }
  assert.equal(isWinning(hand, [chi([18, 19, 20])], WILD, INDICATOR), false,
    'one numbered non-Jiang exposed sequence prevents category exemption');
  assert.equal(classifyWin(hand, [peng(TILE.NORTH)], WILD, INDICATOR).allJiang, false);
});

test('all-honors includes all seven honor faces and requires no combination structure', () => {
  const result = classifyWin(honorIrregular);
  assert.equal(result.winning, true);
  assert.equal(result.allHonors, true);
  assert.equal(result.ordinary || result.sevenPairs || result.allTriplets, false);
  const includesRed = [...honorIrregular];
  includesRed[includesRed.indexOf(TILE.WHITE)] = TILE.RED;
  assert.equal(classifyWin(includesRed).allHonors, true, 'the legacy shape helper includes the red honor face');
  assert.equal(calculateShanten(honorIrregular), -1);
  verifyHu(fixture({ hand: honorIrregular }), 0, true);
});

test('all-honors considers the public faces rather than only the concealed hand', () => {
  const hand = honorIrregular.slice(3);
  for (const group of [peng(TILE.EAST), gang(TILE.EAST), gang(TILE.EAST, true)]) {
    assert.equal(classifyWin(hand, [group]).allHonors, true);
    verifyHu(fixture({ hand, melds: [group] }), 0, true);
  }
  assert.equal(isWinning(hand, [peng(0)]), false);
  const wildcardHand = hand.map((tile, index) => index < 2 ? 0 : tile);
  const result = classifyWin(wildcardHand, [peng(TILE.EAST)], 0, 8);
  assert.equal(result.allHonors, true, 'concealed wildcards may substitute for honors');
  assert.equal(result.wildCount, 2);
  assert.equal(result.opened, true);
  verifyHu(fixture({ hand: wildcardHand, melds: [peng(TILE.EAST)], wildTile: 0, indicatorTile: 8 }), 0, true);
});

test('public wildcard faces remain real faces for category big hands', () => {
  const jiangHand = jiangIrregular.slice(0, 11);
  assert.equal(classifyWin(jiangHand, [peng(TILE.EAST)], TILE.EAST, TILE.WHITE).allJiang, false);
  const honorHand = honorIrregular.slice(3);
  assert.equal(classifyWin(honorHand, [peng(0)], 0, 8).allHonors, false);
});

test('invalid concealed lengths or five copies cannot bypass structure through category big hands', () => {
  for (const hand of [jiangIrregular.slice(1), [...jiangIrregular, 1], honorIrregular.slice(1),
    [...honorIrregular, TILE.GREEN], [1, 1, 1, 1, 1, 4, 4, 7, 7, 10, 10, 13, 16, 25]]) {
    assert.equal(isWinning(hand), false);
  }
});

test('undeclared red and indicator tiles still block live big-hand Hu and cannot be bypassed', () => {
  const red = [...honorIrregular];
  red[red.indexOf(TILE.WHITE)] = TILE.RED;
  for (let seat = 0; seat < 4; seat++) {
    verifyHu(fixture({ hand: red, seat }), seat, false);
    verifyHu(fixture({ hand: honorIrregular, seat, indicatorTile: TILE.WHITE, wildTile: TILE.EAST }), seat, false);
    const jiangIndicator = fixture({ hand: jiangIrregular, seat, indicatorTile: 1, wildTile: 2 });
    verifyHu(jiangIndicator, seat, false);
  }
});

test('all four confirmed closed big hands can claim winning discards at every seat', () => {
  const hands = [jiangIrregular, honorIrregular,
    [0, 0, 0, 9, 9, 9, 18, 18, 18, TILE.SOUTH, TILE.SOUTH, TILE.SOUTH, 6, 6],
    [0, 2, 3, 5, 6, 8, TILE.SOUTH].flatMap(tile => [tile, tile])];
  for (let seat = 0; seat < 4; seat++) {
    for (const complete of hands) {
      const hand = [...complete];
      const discard = hand.pop();
      verifyHu(fixture({ hand, seat, discard }), seat, true, false);
    }
  }
});

test('closed ordinary hands with zero, one, two or three wildcards may only self-draw at every seat', () => {
  const base = sequenceGroups.flat();
  const completeHands = [
    [...base, 4, 4], [...base, 4, WILD], [...base, WILD, WILD],
    [...base.map(tile => tile === 11 ? WILD : tile), WILD, WILD],
  ];
  for (const complete of completeHands) {
    const classification = classifyWin(complete, [], WILD, INDICATOR);
    assert.equal(classification.ordinary, true);
    assert.equal(classification.opened, false);
    assert.equal(classification.sevenPairs || classification.allTriplets || classification.allJiang || classification.allHonors, false);
    for (let seat = 0; seat < 4; seat++) {
      verifyHu(fixture({ hand: complete, seat, wildTile: WILD, indicatorTile: INDICATOR }), seat, true);
      const hand = [...complete];
      hand.splice(hand.indexOf(26), 1);
      const claimed = fixture({ hand, seat, discard: 26, wildTile: WILD, indicatorTile: INDICATOR });
      verifyHu(claimed, seat, false, false);
    }
  }
});

test('concealed kongs and red or indicator declarations still leave ordinary discard Hu closed', () => {
  const full = [...sequenceGroups.flat(), 4, WILD];
  const withConcealedKong = [
    [...sequenceGroups.slice(1).flat(), 4, 4],
    [...sequenceGroups.slice(1).flat(), 4, WILD],
    [...sequenceGroups.slice(1).flat(), WILD, WILD],
  ];
  for (let seat = 0; seat < 4; seat++) {
    for (const complete of withConcealedKong) {
      const melds = [{ ...gang(TILE.NORTH, true), from: seat }];
      verifyHu(fixture({ hand: complete, melds, seat, wildTile: WILD, indicatorTile: INDICATOR }), seat, true);
      const hand = [...complete]; hand.splice(hand.indexOf(26), 1);
      verifyHu(fixture({ hand, melds, seat, discard: 26, wildTile: WILD, indicatorTile: INDICATOR }), seat, false, false);
    }
    for (const specials of [{ redGangs: [TILE.RED] }, { piziGangs: [INDICATOR] },
      { redGangs: [TILE.RED], piziGangs: [INDICATOR] }]) {
      const hand = [...full]; hand.splice(hand.indexOf(26), 1);
      verifyHu(fixture({ hand, seat, discard: 26, wildTile: WILD, indicatorTile: INDICATOR, ...specials }), seat, false, false);
    }
  }
});

test('numeric meld-count compatibility cannot invent unknown big-hand evidence', () => {
  assert.equal(isWinning([0, 0], 4), false, 'unknown public groups do not prove all-triplets');
  assert.equal(isWinning([1, 1], 4), true, 'ordinary natural Jiang pair remains compatible');
  assert.equal(isWinning([0, 0], [peng(9), peng(18), peng(TILE.EAST), peng(TILE.SOUTH)]), true);
  assert.equal(isWinning([1, 1], [chi([0, 1, 2]), chi([9, 10, 11]), chi([18, 19, 20]), chi([24, 25, 26])]), true);
});

test('one foreign natural tile removes an otherwise irregular category big hand', () => {
  const jiang = [...jiangIrregular];
  jiang[jiang.length - 1] = 0;
  const honors = [...honorIrregular];
  honors[honors.length - 1] = 0;
  for (const hand of [jiang, honors]) {
    assert.equal(isWinning(hand), false);
    verifyHu(fixture({ hand }), 0, false);
  }
});

test('a single-suit hand does not gain an unconfirmed big-hand exemption', () => {
  const natural = [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0];
  assert.equal(isWinning(natural, []), false, 'four same-suit sequences still require a Jiang pair');
  verifyHu(fixture({ hand: natural }), 0, false);
  const hand = [0, 1, 2, 3, 4, 5, 6, 7, TILE.WHITE, 4, TILE.WHITE];
  const group = chi([0, 1, 2]);
  assert.equal(isWinning([...group.tiles, ...hand], [], TILE.WHITE), true,
    'the wildcard-complete ordinary shape can win before any opening');
  const opened = classifyWin(hand, [group], TILE.WHITE, TILE.GREEN);
  assert.equal(opened.winning, false, 'a same-suit ordinary open hand still rejects two wildcards');
  assert.equal(opened.allTriplets || opened.sevenPairs || opened.allJiang || opened.allHonors, false);
  verifyHu(fixture({ hand, melds: [group], wildTile: TILE.WHITE, indicatorTile: TILE.GREEN }), 0, false);
});

// This oracle deliberately uses neither production classification nor its
// group-search helpers. With three known public groups, the concealed five
// tiles can be exhaustively substituted and checked as one group plus a pair.
function fiveTileOracle(hand, melds, wildTile) {
  const jiang = new Set([1, 4, 7, 10, 13, 16, 19, 22, 25]);
  const naturals = hand.filter(tile => tile !== wildTile);
  const visible = melds.flatMap(group => group.tiles);
  if ([...naturals, ...visible].every(tile => jiang.has(tile)) ||
      [...naturals, ...visible].every(tile => tile >= 27)) return true;
  const opened = melds.some(group => group.kind !== 'gang' || !group.concealed);
  const wildcardCount = hand.length - naturals.length;
  const tripletsAllowed = melds.every(group => group.kind !== 'chi');
  const ordinaryAllowed = !opened || wildcardCount <= 1;
  function complete(tiles, tripletsOnly, jiangPair) {
    const sorted = [...tiles].sort((a, b) => a - b);
    for (let index = 0; index < sorted.length - 1; index++) {
      if (sorted[index] !== sorted[index + 1] || (jiangPair && !jiang.has(sorted[index]))) continue;
      const group = sorted.filter((_, tileIndex) => tileIndex !== index && tileIndex !== index + 1);
      if (group[0] === group[1] && group[1] === group[2]) return true;
      if (!tripletsOnly && group[0] < 27 && Math.floor(group[0] / 9) === Math.floor(group[2] / 9) &&
          group[0] + 1 === group[1] && group[1] + 1 === group[2]) return true;
    }
    return false;
  }
  function enumerate(tiles) {
    if (tiles.length === hand.length) {
      return (tripletsAllowed && complete(tiles, true, false)) ||
        (ordinaryAllowed && complete(tiles, false, true));
    }
    for (let replacement = 0; replacement < 34; replacement++) {
      if (enumerate([...tiles, replacement])) return true;
    }
    return false;
  }
  return enumerate(naturals);
}

test('a separate exhaustive substitution oracle agrees on small mixed ordinary and big-hand cases', () => {
  const publicSets = [
    [chi([0, 1, 2]), chi([9, 10, 11]), peng(TILE.NORTH)],
    [peng(3), peng(12), peng(21)],
    [peng(1), peng(4), peng(7)],
    [peng(TILE.NORTH), peng(TILE.GREEN), peng(TILE.WHITE)],
    [gang(TILE.NORTH, true), peng(3), peng(12)],
  ];
  const hands = [
    [18, 19, 20, 4, 4], [18, 19, 20, 0, 0], [18, 18, 18, 0, 0],
    [1, 4, 7, 10, 13], [27, 28, 29, 30, 32], [18, 19, 20, 4, WILD],
    [18, 19, 20, WILD, WILD], [18, 18, WILD, 6, WILD], [1, 4, 7, WILD, WILD],
    [28, 29, 30, WILD, WILD], [2, 2, 2, 3, 3], [1, 1, 2, 3, 4],
  ];
  let accepted = 0;
  let rejected = 0;
  for (const melds of publicSets) {
    for (const hand of hands) {
      const counts = Array(34).fill(0);
      const physical = [...hand, ...melds.flatMap(group => group.tiles)];
      if (physical.some(tile => ++counts[tile] > 4)) continue;
      const expected = fiveTileOracle(hand, melds, WILD);
      assert.equal(isWinning(hand, melds, WILD), expected,
        `independent oracle: ${JSON.stringify({ hand, melds })}`);
      if (expected) accepted++; else rejected++;
    }
  }
  assert.ok(accepted >= 10 && rejected >= 10, `both branches exercised: ${accepted} accepted, ${rejected} rejected`);
});
