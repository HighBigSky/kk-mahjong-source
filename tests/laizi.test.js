import test from 'node:test';
import assert from 'node:assert/strict';
import { MahjongGame, isWinning, nextWildTile, chooseDiscard } from '../engine.js';
import { TILE, RED_DRAGON } from '../src/domain/tile.js';
import { assertInvariants } from '../src/domain/invariants.js';
import { previewWall } from './legacy-wall-oracle.mjs';

const WILD = 32;
const ordinaryWin = [0, 1, 2, 3, 4, 5, 9, 10, 11, 27, 27, 27, 25, 25];

function physicalTiles(game) {
  return [
    ...(game.indicatorTile === null ? [] : [game.indicatorTile]),
    ...game.wall,
    ...game.players.flatMap(player => [
      ...player.hand, ...player.discards, ...player.redGangs, ...player.piziGangs,
      ...player.melds.flatMap(meld => meld.tiles),
    ]),
  ];
}

function assertConservation(game) {
  const tiles = physicalTiles(game);
  assert.equal(tiles.length, 136, 'the revealed indicator is one of the 136 physical tiles');
  for (let tile = 0; tile < 34; tile++) {
    assert.equal(tiles.filter(value => value === tile).length, 4, `tile ${tile} must retain four physical copies`);
  }
}

/** Reserve an indicator, a player hand, and replacement draws before filling the other seats. */
function fixture({ hand = ordinaryWin, melds = [], draws = [], seat = 0 } = {}) {
  const game = new MahjongGame({ seed: 'laizi-fixture', laizi: true });
  game.laiziEnabled = true;
  game.indicatorTile = 33;
  game.wildTile = WILD;
  const counts = Array(34).fill(4);
  for (const tile of [game.indicatorTile, ...hand, ...melds.flatMap(meld => meld.tiles), ...draws]) {
    assert.ok(--counts[tile] >= 0, `fixture exceeds four physical copies of ${tile}`);
  }
  const remaining = counts.flatMap((count, tile) => Array(count).fill(tile));
  for (let player = 0; player < 4; player++) {
    game.players[player].hand = player === seat ? [...hand] : remaining.splice(0, 13);
    game.players[player].melds = player === seat ? structuredClone(melds) : [];
    game.players[player].redGangs = [];
    game.players[player].discards = [];
  }
  game.wall = [...draws, ...remaining];
  game.current = seat;
  game.phase = { kind: 'discard', seat: game.current };
  game.pendingDiscard = null;
  game.lastDraw = { player: seat, tile: hand.at(-1), index: hand.length - 1, replacement: false };
  game._responses = Array(4).fill(null);
  assertConservation(game);
  return game;
}

// This oracle enumerates actual substitutions, independently of the engine's wildcard search.
function oracleWinning(hand, meldCount, wildTile) {
  if (hand.length !== (4 - meldCount) * 3 + 2) return false;
  const physical = Array(34).fill(0);
  for (const tile of hand) if (++physical[tile] > 4) return false;
  const wilds = physical[wildTile];
  physical[wildTile] = 0;
  function naturalWinning(counts) {
    if (meldCount === 0 && counts.every(count => count % 2 === 0)) return true;
    const present = counts.flatMap((count, tile) => count ? [tile] : []);
    // Complete substitutions are evaluated independently of production search.
    // A numeric nonzero meld count cannot prove properties of unknown groups.
    if (meldCount === 0 && (present.every(tile => tile >= 27) ||
      present.every(tile => tile < 27 && [1, 4, 7].includes(tile % 9)))) return true;
    function takeGroups(groups, tripletsOnly) {
      if (groups === 0) return counts.every(count => count === 0);
      const first = counts.findIndex(count => count > 0);
      if (first === -1) return false;
      if (counts[first] >= 3) {
        counts[first] -= 3;
        const won = takeGroups(groups - 1, tripletsOnly);
        counts[first] += 3;
        if (won) return true;
      }
      if (!tripletsOnly && first < 27 && first % 9 <= 6 && counts[first + 1] && counts[first + 2]) {
        counts[first]--; counts[first + 1]--; counts[first + 2]--;
        const won = takeGroups(groups - 1, tripletsOnly);
        counts[first]++; counts[first + 1]++; counts[first + 2]++;
        if (won) return true;
      }
      return false;
    }
    for (let pair = 0; pair < 34; pair++) {
      if (counts[pair] < 2) continue;
      counts[pair] -= 2;
      const ordinary = (meldCount === 0 || wilds <= 1) && pair < 27 &&
        [1, 4, 7].includes(pair % 9) && takeGroups(4 - meldCount, false);
      const won = ordinary || (meldCount === 0 && takeGroups(4, true));
      counts[pair] += 2;
      if (won) return true;
    }
    return false;
  }
  function substitute(left, start) {
    if (left === 0) return naturalWinning(physical);
    for (let tile = start; tile < 34; tile++) {
      physical[tile]++;
      const won = substitute(left - 1, tile);
      physical[tile]--;
      if (won) return true;
    }
    return false;
  }
  return substitute(wilds, 0);
}

test('indicator successors cycle within each numbered suit and all seven honors', () => {
  for (let tile = 0; tile < 34; tile++) {
    const expected = tile < 27 ? Math.floor(tile / 9) * 9 + (tile + 1) % 9 : 27 + (tile - 26) % 7;
    assert.equal(nextWildTile(tile), expected, `successor of tile ${tile}`);
  }
  assert.equal(nextWildTile(30), 31, 'the pure successor helper retains 北→中 before the round override');
  assert.equal(nextWildTile(33), 27, 'a normally revealed 白 cycles to 东');
  for (const tile of [-1, 34, 1.5, null, '30']) assert.equal(nextWildTile(tile), null);
});

test('the optional mode defaults off and enabled games reveal exactly one tile before dealing', () => {
  const plain = new MahjongGame({ seed: 'plain-deal' });
  assert.equal(plain.laiziEnabled, false);
  assert.equal(plain.indicatorTile, null);
  assert.equal(plain.wildTile, null);
  assert.equal(plain.wall.length, 83);
  assertConservation(plain);
  for (let seed = 1; seed <= 48; seed++) {
    const game = new MahjongGame({ seed, laizi: true });
    assert.equal(game.laiziEnabled, true);
    assert.ok(Number.isInteger(game.indicatorTile));
    assert.ok(Number.isInteger(game.wildTile));
    assert.notEqual(game.wildTile, 31, 'red dragons always retain their separate kong role');
    assert.deepEqual(game.players.map(player => player.hand.length), [14, 13, 13, 13]);
    assert.equal(game.wall.length, 82);
    assertConservation(game);
    const repeat = new MahjongGame({ seed, laizi: true });
    assert.equal(repeat.indicatorTile, game.indicatorTile);
    assert.equal(repeat.wildTile, game.wildTile);
    assert.deepEqual(repeat.players, game.players);
    assert.deepEqual(repeat.wall, game.wall);
  }
});

test('a 北 indicator conflict instead exposes a real 白 with 发 wild, while an ordinary 白 still points to 东', () => {
  const conflictSeed = 'wall-candidate-0';
  assert.equal(previewWall(conflictSeed).candidate, TILE.NORTH, 'the independent dice-positioned candidate is 北');
  const conflict = new MahjongGame({ seed: conflictSeed, laizi: true });
  assert.equal(conflict.indicatorTile, 33);
  assert.equal(conflict.wildTile, 32);
  assert.equal(conflict.wall.length, 82);
  const playable = physicalTiles(conflict).filter((_, index) => index !== 0);
  assert.equal(playable.filter(tile => tile === 30).length, 4, 'the initial 北 returns to the playable deck');
  assert.equal(playable.filter(tile => tile === 33).length, 3, 'one actual 白 is held outside the playable deck');
  assert.equal(playable.filter(tile => tile === 31).length, 4, 'all four reds retain their kong role');
  assert.ok(conflict.events.some(event => event.includes('白') && event.includes('发')));
  assertConservation(conflict);

  const whiteSeed = 'wall-candidate-21';
  assert.equal(previewWall(whiteSeed).candidate, TILE.WHITE, 'the independent dice-positioned candidate is 白');
  const naturalWhite = new MahjongGame({ seed: whiteSeed, laizi: true });
  assert.equal(naturalWhite.indicatorTile, 33);
  assert.equal(naturalWhite.wildTile, 27, 'the conflict exception does not globally change 白→东');
  assertConservation(naturalWhite);
});

// Each raw candidate is checked independently under the new dice/stack rule.
for (const seed of ['red-indicator-a-6', 'red-indicator-b-27', 'red-indicator-c-53']) {
  test(`a red indicator becomes a real white indicator with green wild throughout a complete round (${seed})`, t => {
    assert.equal(previewWall(seed).candidate, RED_DRAGON, 'the independent dice-positioned candidate is 红中');
    const game = new MahjongGame({ seed, laizi: true });
    assert.equal(game.indicatorTile, TILE.WHITE);
    assert.equal(game.wildTile, TILE.GREEN);
    assert.equal(game.wall.length, 82);
    const playable = [...game.wall, ...game.players.flatMap(player => player.hand)];
    assert.equal(playable.filter(tile => tile === RED_DRAGON).length, 4, 'the revealed red returns to the playable deck');
    assert.equal(playable.filter(tile => tile === TILE.WHITE).length, 3, 'one real white is reserved as the indicator');
    assert.ok(game.events.includes('翻出皮子白，发为本局癞子。'));
    assertInvariants(game);
    const originalHands = structuredClone(game.players.map(player => player.hand));
    const originalWall = [...game.wall];
    game.newRound(seed, { restart: true });
    assert.deepEqual(game.players.map(player => player.hand), originalHands, 'same seed reproduces the replacement deal');
    assert.deepEqual(game.wall, originalWall);

    let steps = 0;
    while (game.phase.kind !== 'ended' && steps < 1500) {
      const previousPhase = structuredClone(game.phase);
      const actions = game.getActions(0);
      if (game.phase.kind === 'claim' && actions.pass) {
        assert.equal(actions.hu ? game.applyAction(0, { kind: 'hu', player: 0, selfDraw: false }) : game.pass(0), true);
      } else if (game.phase.kind === 'discard' && game.current === 0) {
        if (actions.hu) assert.equal(game.applyAction(0, { kind: 'hu', player: 0, selfDraw: true }), true);
        else if (actions.redGang) assert.equal(game.applyAction(0, { kind: 'redGang', player: 0 }), true);
        else if (actions.piziGang) assert.equal(game.applyAction(0, { kind: 'piziGang', player: 0 }), true);
        else assert.equal(game.discard(0, chooseDiscard(game.players[0].hand, game.players[0].melds, [], game.wildTile, game.indicatorTile)), true);
      } else assert.equal(game.advanceAI(), true, `seed ${seed} makes progress`);
      assertInvariants(game, previousPhase);
      assertConservation(game);
      assert.equal(game.indicatorTile, TILE.WHITE);
      assert.equal(game.wildTile, TILE.GREEN);
      assert.ok(game.players.every(player => !player.discards.includes(RED_DRAGON)));
      steps++;
    }
    assert.equal(game.phase.kind, 'ended');
    assert.equal(game.players.reduce((sum, player) => sum + player.score, 0), 4000);
    t.diagnostic(`${seed}: ${steps} actions, white indicator / green wild, 136 tiles and four copies conserved at every step`);
  });
}

test('new rounds retain the optional mode, and explicit changes and restarts reset it consistently', () => {
  const game = new MahjongGame({ seed: 'round-one', laizi: true });
  game.newRound('round-two');
  assert.equal(game.dealer, 1);
  assert.equal(game.laiziEnabled, true);
  const indicator = game.indicatorTile;
  const wild = game.wildTile;
  const hands = structuredClone(game.players.map(player => player.hand));
  const wall = [...game.wall];
  game.newRound('round-two', { restart: true });
  assert.equal(game.round, 2);
  assert.equal(game.dealer, 1);
  assert.equal(game.indicatorTile, indicator);
  assert.equal(game.wildTile, wild);
  assert.deepEqual(game.players.map(player => player.hand), hands);
  assert.deepEqual(game.wall, wall);
  assertConservation(game);
  game.newRound('disabled', { restart: true, laizi: false });
  assert.equal(game.round, 2);
  assert.equal(game.dealer, 1);
  assert.equal(game.laiziEnabled, false);
  assert.equal(game.indicatorTile, null);
  assert.equal(game.wildTile, null);
  assert.equal(game.wall.length, 83);
  assertConservation(game);
  game.newRound('enabled', { laizi: true });
  assert.equal(game.dealer, 2);
  assert.equal(game.laiziEnabled, true);
  assertConservation(game);
});

test('the designated owner starts every round with all four wild tiles and everyone else with none', () => {
  for (const wildOwner of [0, 1, 2, 3]) {
    const game = new MahjongGame({ seed: `owner-wilds-${wildOwner}`, laizi: true, wildOwner });
    assert.equal(game.wildOwner, wildOwner);
    assert.ok(game.wildTile !== null);
    for (let seat = 0; seat < 4; seat++) {
      const wilds = game.players[seat].hand.filter(tile => tile === game.wildTile).length;
      assert.equal(wilds, seat === wildOwner ? 4 : 0, `seat ${seat} wild count in round 1`);
      assert.equal(game.players[seat].hand.length, game.dealer === seat ? 14 : 13, `seat ${seat} hand size in round 1`);
    }
    assertConservation(game);
    // 轮庄后仍由同一房主席位保留 4 张癞子。
    game.newRound(`owner-wilds-next-${wildOwner}`);
    for (let seat = 0; seat < 4; seat++) {
      const wilds = game.players[seat].hand.filter(tile => tile === game.wildTile).length;
      assert.equal(wilds, seat === wildOwner ? 4 : 0, `seat ${seat} wild count in round 2`);
    }
    assertConservation(game);
  }
});

test('the owner wild guarantee is ignored when laizi is disabled or no owner is designated', () => {
  const disabled = new MahjongGame({ seed: 'owner-wilds-disabled', laizi: false, wildOwner: 2 });
  assert.equal(disabled.wildTile, null);
  assert.equal(disabled.wildOwner, 2);
  assertConservation(disabled);
  const random = new MahjongGame({ seed: 'owner-wilds-random', laizi: true });
  assert.equal(random.wildOwner, null);
  for (let seat = 0; seat < 4; seat++) {
    assert.equal(random.players[seat].hand.length, random.dealer === seat ? 14 : 13);
  }
  assertConservation(random);
});

test('wildcards complete sequences at their beginning, middle, and end and can supply the pair', () => {
  const cases = [
    [WILD, 1, 2, 3, 4, 5, 9, 10, 11, 27, 27, 27, 25, 25],
    [0, WILD, 2, 3, 4, 5, 9, 10, 11, 27, 27, 27, 25, 25],
    [0, 1, WILD, 3, 4, 5, 9, 10, 11, 27, 27, 27, 25, 25],
    [7, 8, 10, 11, 18, 19, 20, 27, 27, 27, 25, 25, WILD, WILD],
    [0, 2, 9, 11, 18, 19, 20, 27, 27, 27, 25, 25, WILD, WILD],
    [0, 1, 2, 3, 4, 5, 9, 10, 11, 27, 27, 27, 25, WILD],
    [0, 1, 2, 3, 4, 5, 9, 10, 11, 27, 27, 27, WILD, WILD],
  ];
  for (const hand of cases) {
    const original = [...hand];
    assert.equal(isWinning(hand, 0, WILD), true, `expected a wildcard win: ${hand}`);
    assert.deepEqual(hand, original, 'winning search must not mutate the original hand');
  }
});

test('wildcards support seven pairs, an all-wild group, and exposed-hand remainders', () => {
  assert.equal(isWinning([0, 0, 8, 8, 9, 9, 17, 17, 18, 18, 27, 30, WILD, WILD], 0, WILD), true);
  assert.equal(isWinning([0, 0, 0, 0, 9, 9, 17, 17, 18, 18, 27, 30, WILD, WILD], 0, WILD), true,
    'a natural quad continues to supply two of seven pairs');
  assert.equal(isWinning([2, 3, 4, 9, 10, 11, 18, 19, 20, 27, WILD, WILD, WILD, WILD], 0, WILD), true);
  assert.equal(isWinning([0, 2, 9, 10, 11, 27, 27, 27, 25, 25, WILD], 1, WILD), true);
  assert.equal(isWinning([25, WILD], 4, WILD), true);
  const concealedKongs = Array.from({ length: 4 }, (_, tile) => ({
    kind: 'gang', tiles: Array(4).fill(tile), concealed: true,
  }));
  assert.equal(isWinning([WILD, WILD], concealedKongs, WILD), true);
  assert.equal(isWinning([WILD, WILD], 4, WILD), false,
    'an unknown opened meld count cannot establish the big-win exception to the wildcard limit');
  assert.equal(isWinning([30, WILD], 4, WILD), false, 'a wild cannot turn a natural honor into a 258 pair');
  assert.equal(isWinning([0, 0, 9, 9, 18, 18, 27, 30, WILD, WILD, WILD], 1, WILD), false,
    'seven-pair scoring cannot create a winning shape with exposed melds');
});

test('one wildcard cannot join distinct honors or tiles across a suit boundary into a sequence', () => {
  const rest = [3, 4, 5, 12, 13, 14, 21, 22, 23, 25, 25];
  assert.equal(isWinning([27, 28, WILD, ...rest], 0, WILD), false);
  assert.equal(isWinning([8, 9, WILD, ...rest], 0, WILD), false);
  assert.equal(isWinning([17, 18, WILD, ...rest], 0, WILD), false);
});

test('invalid physical hands and meld counts remain invalid when wildcards are enabled', () => {
  const winning = [...ordinaryWin.slice(0, -1), WILD];
  for (const hand of [winning.slice(1), [...winning, 0], [34, ...winning.slice(1)], [-1, ...winning.slice(1)],
    [0.5, ...winning.slice(1)], [null, ...winning.slice(1)], [WILD, WILD, WILD, WILD, WILD, ...winning.slice(5)]]) {
    assert.equal(isWinning(hand, 0, WILD), false);
  }
  for (const melds of [-1, 5, 0.5, '0', null]) assert.equal(isWinning(winning, melds, WILD), false);
  for (const wild of [-1, 34, 0.5, '32', {}]) assert.equal(isWinning(winning, 0, wild), false);
  assert.equal(isWinning(null, 0, WILD), false);
});

test('wildcard decomposition agrees with an independent exhaustive substitution oracle', () => {
  let seed = 0x5eed;
  const random = max => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % max;
  };
  const cases = [];
  for (let trial = 0; trial < 96; trial++) {
    const wilds = 1 + trial % 2;
    const hand = [];
    const counts = Array(34).fill(0);
    while (hand.length < 14 - wilds) {
      const tile = random(33);
      if (tile === WILD || counts[tile] === 4) continue;
      counts[tile]++;
      hand.push(tile);
    }
    cases.push([...hand, ...Array(wilds).fill(WILD)]);
  }
  for (let first = 0; first < ordinaryWin.length; first++) {
    for (const second of [first, (first + 5) % ordinaryWin.length]) {
      cases.push(ordinaryWin.map((tile, index) => index === first || index === second ? WILD : tile));
    }
  }
  // Concentrate natural tiles in one or two suits to stress competing decompositions.
  for (let trial = 0; trial < 160; trial++) {
    const hand = [];
    const counts = Array(34).fill(0);
    const wilds = 1 + trial % 2;
    const range = trial % 3 === 0 ? 9 : 18;
    while (hand.length < 14 - wilds) {
      const tile = random(range);
      if (counts[tile] === 4) continue;
      counts[tile]++;
      hand.push(tile);
    }
    cases.push([...hand, ...Array(wilds).fill(WILD)]);
  }
  let wins = 0;
  let losses = 0;
  for (const hand of cases) {
    const expected = oracleWinning(hand, 0, WILD);
    if (expected) wins++; else losses++;
    assert.equal(isWinning(hand, 0, WILD), expected, `wildcard result differs for ${hand}`);
  }
  assert.ok(wins >= 28 && losses >= 30, 'the oracle corpus must exercise successful and unsuccessful searches');
});

test('wildcards enable real self-draw and discard wins without altering physical tile identities', () => {
  const hand = [...ordinaryWin.slice(0, -1), WILD];
  const selfDraw = fixture({ hand });
  assert.equal(isWinning(hand), false);
  assert.equal(selfDraw.getActions(0).hu, true);
  const before = physicalTiles(selfDraw).sort((a, b) => a - b);
  assert.equal(selfDraw.claim(0, 'hu'), true);
  assert.equal(selfDraw.phase.kind, 'ended');
  assert.deepEqual(selfDraw.result.hand, hand);
  assert.deepEqual(physicalTiles(selfDraw).sort((a, b) => a - b), before);
  assert.equal(selfDraw.players.reduce((sum, player) => sum + player.score, 0), 4000);
  assert.ok(selfDraw.result.scoreDelta.every(Number.isFinite));
  assert.deepEqual(selfDraw.result.patterns, ['基础胡牌', '自摸'], 'a substituted shape has no unspecified scoring bonus');
  assertConservation(selfDraw);

  // The wildcard identity check now uses an already-open ordinary hand; the
  // closed ordinary discard-win prohibition has its own explicit regression.
  const discardWin = fixture({ hand: hand.slice(3, -2).concat(WILD), draws: [25],
    melds: [{ kind: 'chi', tiles: hand.slice(0, 3), from: 3, concealed: false }] });
  const tile = discardWin.wall.shift();
  discardWin.players[3].discards.push(tile);
  discardWin.current = 3;
  discardWin.lastDraw = null;
  discardWin.pendingDiscard = { tile, from: 3 };
  discardWin.phase = { kind: 'claim', discard: discardWin.pendingDiscard };
  assert.equal(discardWin.getActions(0).hu, true);
  assert.equal(discardWin.claim(0, 'hu'), true);
  for (let step = 0; discardWin.phase.kind === 'claim' && step < 8; step++) discardWin.advanceAI();
  assert.equal(discardWin.winner, 0);
  assert.equal(discardWin.result.selfDraw, false);
  assert.equal(discardWin.result.from, 3);
  assertConservation(discardWin);
});

test('a wildcard substitutes only in winning evaluation and cannot fabricate a chi or peng', () => {
  const game = fixture({ hand: [0, WILD, 4, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22], draws: [1] });
  const tile = game.wall.shift();
  game.players[3].discards.push(tile);
  game.current = 3;
  game.pendingDiscard = { tile, from: 3 };
  game.phase = { kind: 'claim', discard: game.pendingDiscard };
  game.lastDraw = null;
  assert.deepEqual(game.getActions(0).chi, []);
  assert.equal(game.getActions(0).peng, false);
  assert.equal(game.getActions(0).gang, false);
  assert.equal(game.claim(0, 'chi', [0, 1, 2]), false);
  assert.equal(game.claim(0, 'peng'), false);
  assertConservation(game);
});

test('red dragons stay optional single-tile kongs alongside a distinct wildcard', () => {
  // This seven-pair shape remains complete without 258, but the single held
  // red must be declared before its wildcard-assisted pair may grant Hu.
  const pairs = [0, 0, 1, 1, 2, 2, 9, 9, 10, 10, 25, 25];
  const game = fixture({ hand: [...pairs, 31, WILD], draws: [30] });
  const original = [...game.players[0].hand];
  const indicator = game.indicatorTile;
  assert.equal(game.getActions(0).redGang, true);
  assert.equal(isWinning(original, 0, WILD), true, 'a wildcard can complete the mathematical hand shape');
  assert.equal(game.getActions(0).hu, false, 'actual play must clear the held red dragon before declaring a win');
  assert.deepEqual(game.players[0].hand, original, 'a red dragon is not automatically declared');
  assert.equal(game.claim(0, 'redGang'), true);
  assert.deepEqual(game.players[0].redGangs, [31]);
  assert.equal(game.players[0].hand.length, 14);
  assert.equal(game.players[0].hand.includes(WILD), true);
  assert.equal(game.players[0].melds.length, 0);
  assert.equal(game.indicatorTile, indicator);
  assert.equal(game.wildTile, WILD);
  assert.equal(game.getActions(0).hu, true);
  assertConservation(game);
});

test('eight complete optional-mode AI rounds conserve tiles, scores, and the revealed indicator', () => {
  const game = new MahjongGame({ seed: 'laizi-ai-round-0', laizi: true });
  for (let round = 0; round < 8; round++) {
    const indicator = game.indicatorTile;
    const wild = game.wildTile;
    let step = 0;
    while (game.phase.kind !== 'ended' && step < 1500) {
      const actions = game.getActions(0);
      if (game.phase.kind === 'claim' && actions.pass) {
        assert.equal(actions.hu ? game.claim(0, 'hu') : game.pass(0), true);
      } else if (game.phase.kind === 'discard' && game.current === 0) {
        if (actions.hu) assert.equal(game.claim(0, 'hu'), true);
        else if (actions.redGang) assert.equal(game.claim(0, 'redGang'), true);
        else if (actions.piziGang) assert.equal(game.claim(0, 'piziGang'), true);
        else assert.equal(game.discard(0, chooseDiscard(game.players[0].hand, game.players[0].melds, [], wild, indicator)), true);
      } else {
        assert.equal(game.advanceAI(), true, `round ${round + 1} stalled at action ${step}`);
      }
      assert.equal(game.indicatorTile, indicator);
      assert.equal(game.wildTile, wild);
      assertConservation(game);
      assert.ok(game.players.every(player => !player.discards.includes(31)), 'red dragons never enter a discard river');
      step++;
    }
    assert.equal(game.phase.kind, 'ended', `round ${round + 1} exceeds the action limit`);
    assert.ok(game.result);
    assert.equal(game.players.reduce((sum, player) => sum + player.score, 0), 4000);
    assert.ok(game.players.every(player => Number.isFinite(player.score)));
    const scores = game.players.map(player => player.score);
    game.newRound(`laizi-ai-round-${round + 1}`);
    assert.equal(game.dealer, (round + 1) % 4);
    assert.equal(game.laiziEnabled, true);
    assert.deepEqual(game.players.map(player => player.score), scores);
    assertConservation(game);
  }
});
