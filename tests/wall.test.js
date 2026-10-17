import test from 'node:test';
import assert from 'node:assert/strict';
import { MahjongGame } from '../engine.js';
import { TILE, RED_DRAGON } from '../src/domain/tile.js';
import { assertInvariants, collectPhysicalTiles } from '../src/domain/invariants.js';
import { previewWall, seedRandom } from './legacy-wall-oracle.mjs';

function shuffledWall(random) {
  const wall = Array.from({ length: 136 }, (_, index) => Math.floor(index / 4));
  for (let index = wall.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [wall[index], wall[target]] = [wall[target], wall[index]];
  }
  return wall;
}

// This expected physical deal is independent of MahjongGame.newRound. Honor
// successors here are checked explicitly, rather than calling nextWildTile.
function expectedDeal(original, dice, laizi, dealer = 0) {
  const wall = [...original];
  const position = laizi ? (Math.min(...dice) - 1) * 2 : null;
  let indicator = null;
  let wild = null;
  if (laizi) {
    const candidate = wall[position];
    if (candidate === TILE.RED || candidate === TILE.NORTH) {
      const white = wall.lastIndexOf(TILE.WHITE);
      [wall[position], wall[white]] = [wall[white], wall[position]];
      wild = TILE.GREEN;
    } else {
      wild = candidate < TILE.EAST
        ? Math.floor(candidate / 9) * 9 + (candidate + 1) % 9
        : TILE.EAST + (candidate - TILE.EAST + 1) % 7;
    }
    indicator = wall.splice(position, 1)[0];
  }
  const hands = [[], [], [], []];
  for (let deal = 0; deal < 13; deal++) for (const hand of hands) hand.push(wall.pop());
  const dealerDraw = wall.pop();
  hands[dealer].push(dealerDraw);
  for (const hand of hands) hand.sort((left, right) => left - right);
  return { wall, hands, indicator, wild, position, dealerDraw };
}

function assertExactDeal(game, expected, context) {
  assert.deepEqual(game.wall, expected.wall, `${context}: exact remaining physical wall order`);
  assert.deepEqual(game.players.map(player => player.hand), expected.hands, `${context}: exact deal`);
  assert.equal(game.indicatorTile, expected.indicator, `${context}: indicator`);
  assert.equal(game.wildTile, expected.wild, `${context}: wild`);
  assert.equal(game.wallInfo.indicatorPosition, expected.position, `${context}: physical upper-tile slot`);
  assert.equal(game.lastDraw.tile, expected.dealerDraw, `${context}: dealer draws from the ordinary head`);
  assertInvariants(game);
}

test('all 36 dice pairs reveal the smaller-die stack upper tile counted from the wall tail', t => {
  const raw = previewWall('forced-dice-stack').wall;
  for (let first = 1; first <= 6; first++) {
    for (let second = 1; second <= 6; second++) {
      const game = new MahjongGame({ seed: 'forced-dice-stack', laizi: true });
      game._random = seedRandom('forced-dice-stack');
      const rolls = [first, second];
      game._diceRandom = () => (rolls.shift() - 0.5) / 6;
      game.newRound(undefined, { restart: true });
      const context = `dice ${first},${second}`;
      assert.deepEqual(game.wallInfo.dice, [first, second], context);
      assert.equal(game.wallInfo.tailDraws, 0, context);
      assertExactDeal(game, expectedDeal(raw, [first, second], true), context);
    }
  }
  t.diagnostic('36/36 pairs: tail stack n upper index = 2 × (min(dice) − 1); lower tile is not selected.');
});

test('dice have an independent seeded stream and never change the plain shuffle or ordinary deal', () => {
  const seed = 'independent-dice-plain';
  const game = new MahjongGame({ seed });
  const wallRandom = seedRandom(seed);
  const diceRandom = seedRandom(`dice:${seed}`);
  for (let round = 0; round < 4; round++) {
    if (round > 0) game.newRound();
    const raw = shuffledWall(wallRandom);
    const dice = [1 + Math.floor(diceRandom() * 6), 1 + Math.floor(diceRandom() * 6)];
    assert.deepEqual(game.wallInfo, { dice, indicatorPosition: null, tailDraws: 0 });
    assertExactDeal(game, expectedDeal(raw, dice, false, round), `continuous seeded round ${round + 1}`);
  }
});

test('explicit same-seed restart resets both random streams and all wall metadata', () => {
  const seed = 'repeat-wall-and-dice';
  const game = new MahjongGame({ seed, laizi: true });
  const before = structuredClone({ wall: game.wall, wallInfo: game.wallInfo, players: game.players,
    indicator: game.indicatorTile, wild: game.wildTile, events: game.events });
  game._drawTile(0, true);
  assert.equal(game.wallInfo.tailDraws, 1);
  game.newRound(seed, { restart: true });
  assert.deepEqual({ wall: game.wall, wallInfo: game.wallInfo, players: game.players,
    indicator: game.indicatorTile, wild: game.wildTile, events: game.events }, before);
  assertInvariants(game);
});

for (const [candidate, seed] of [
  [TILE.NORTH, 'wall-candidate-0'],
  [RED_DRAGON, 'wall-candidate-30'],
  [TILE.WHITE, 'wall-candidate-21'],
]) {
  test(`dice-positioned candidate ${candidate} retains exact physical ownership after indicator selection`, () => {
    const preview = previewWall(seed);
    assert.equal(preview.candidate, candidate, 'raw candidate checked before the production deal');
    const game = new MahjongGame({ seed, laizi: true });
    assertExactDeal(game, expectedDeal(preview.wall, preview.dice, true), `candidate ${candidate}`);
    const playable = [...game.wall, ...game.players.flatMap(player => player.hand)];
    assert.equal(playable.filter(tile => tile === TILE.WHITE).length, 3);
    assert.equal(playable.filter(tile => tile === RED_DRAGON).length, 4);
    assert.equal(game.indicatorTile, TILE.WHITE);
    assert.equal(game.wildTile, candidate === TILE.WHITE ? TILE.EAST : TILE.GREEN);
  });
}

function kongFixture(kind) {
  const game = new MahjongGame({ seed: `wall-kong-${kind}` });
  const tile = 13;
  const ordinary = [0, 2, 4, 6, 8, 9, 11, 15, 17, 18, 20, 22, 24];
  const hand = kind === 'redGang' ? [...ordinary, RED_DRAGON]
    : kind === 'concealed' ? [tile, tile, tile, tile, ...ordinary.slice(0, 10)]
    : kind === 'added' ? [tile, ...ordinary.slice(0, 10)]
    : [tile, tile, tile, ...ordinary.slice(0, 10)];
  const melds = kind === 'added'
    ? [{ kind: 'peng', tiles: [tile, tile, tile], from: 2, concealed: false }] : [];
  const discard = kind === 'exposed' ? tile : null;
  const remaining = Array(34).fill(4);
  for (const code of [...hand, ...melds.flatMap(meld => meld.tiles),
    ...(discard === null ? [] : [discard]), TILE.EAST, TILE.SOUTH]) {
    assert.ok(--remaining[code] >= 0);
  }
  for (let seat = 0; seat < 4; seat++) {
    game.players[seat].hand = seat === 0 ? [...hand] : [];
    game.players[seat].melds = seat === 0 ? melds : [];
    game.players[seat].redGangs = [];
    game.players[seat].discards = seat === 3 && discard !== null ? [discard] : [];
    if (seat > 0) for (let count = 0; count < 13; count++) {
      const code = remaining.findIndex(amount => amount > 0);
      game.players[seat].hand.push(code);
      remaining[code]--;
    }
  }
  game.wall = [TILE.EAST, ...remaining.flatMap((count, code) => Array(count).fill(code)), TILE.SOUTH];
  game.wallInfo.tailDraws = 0;
  game.current = discard === null ? 0 : 3;
  game.pendingDiscard = discard === null ? null : { tile: discard, from: 3 };
  game.phase = discard === null ? { kind: 'discard', seat: 0 } : { kind: 'claim', discard: game.pendingDiscard };
  game.lastDraw = discard === null ? { player: 0, tile: hand.at(-1), index: hand.length - 1, replacement: false } : null;
  game._responses = Array(4).fill(null);
  assertInvariants(game);
  return { game, tile };
}

for (const kind of ['redGang', 'concealed', 'added', 'exposed']) {
  test(`${kind} kong draws exactly the wall-tail tile while leaving the ordinary head untouched`, () => {
    const { game, tile } = kongFixture(kind);
    const wall = [...game.wall];
    const action = kind === 'redGang' ? { kind, player: 0 }
      : { kind: 'gang', player: 0, tile, mode: kind };
    assert.equal(game.applyAction(0, action), true);
    for (let seat = 1; game.phase.kind === 'claim' && seat < 4; seat++) {
      if (game.getActions(seat).pass) assert.equal(game.pass(seat), true);
    }
    assert.equal(game.phase.kind, 'discard');
    assert.equal(game.lastDraw.replacement, true);
    assert.equal(game.lastDraw.tile, wall[0]);
    assert.equal(game.wallInfo.tailDraws, 1);
    assert.deepEqual(game.wall, wall.slice(1));
    assert.equal(game.wall.at(-1), TILE.SOUTH, 'ordinary head was not used for a kong');
    assertInvariants(game);
  });
}

test('mixed ordinary and replacement draws keep the flipped physical indicator outside both wall ends', () => {
  const game = new MahjongGame({ seed: 'drain-both-wall-ends', laizi: true });
  const expected = [...game.wall];
  const indicator = game.indicatorTile;
  const position = game.wallInfo.indicatorPosition;
  let replacements = 0;
  let step = 0;
  while (expected.length) {
    const replacement = step++ % 2 === 0;
    const tile = replacement ? expected.shift() : expected.pop();
    assert.equal(game._drawTile(0, replacement), true);
    assert.equal(game.lastDraw.tile, tile);
    if (replacement) replacements++;
    assert.equal(game.wallInfo.tailDraws, replacements);
    assert.equal(game.indicatorTile, indicator);
    assert.equal(game.wallInfo.indicatorPosition, position, 'flipped slot stays in the physical wall diagram');
    assert.deepEqual(game.wall, expected);
    assertInvariants(game);
  }
  const playable = game.players.flatMap(player => player.hand);
  assert.equal(playable.filter(tile => tile === indicator).length, 3, 'the fourth physical copy remains flipped');
  assert.equal(collectPhysicalTiles(game).length, 136);
  assert.equal(game._drawTile(0, true), false, 'an empty wall cannot supply a replacement');
  assert.equal(game.wallInfo.tailDraws, replacements, 'empty-wall attempts do not move the tail');
  assert.equal(game.phase.kind, 'ended');
  assertInvariants(game);
});

test('wall invariants reject invalid dice, a lower indicator slot and impossible replacement counts', () => {
  const game = new MahjongGame({ seed: 'wall-negative-cases', laizi: true });
  const valid = structuredClone(game.wallInfo);
  for (const invalid of [
    { ...valid, dice: [0, 6] },
    { ...valid, dice: [7, 1] },
    { ...valid, dice: [1] },
    { ...valid, indicatorPosition: valid.indicatorPosition + 1 },
    { ...valid, tailDraws: -1 },
    { ...valid, tailDraws: 137 },
  ]) {
    game.wallInfo = invalid;
    assert.throws(() => assertInvariants(game));
  }
  game.wallInfo = valid;
  assertInvariants(game);
});
