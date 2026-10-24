import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MahjongGame, calculateShanten, chooseDiscard, isSpecialGangTile, isWinning, nextWildTile,
} from '../engine.js';
import { ACTION } from '../src/domain/model.js';
import { RED_DRAGON, TILE, TILE_TYPE_COUNT } from '../src/domain/tile.js';
import { assertInvariants, collectPhysicalTiles } from '../src/domain/invariants.js';

const PIZI = 4;
const ordinary = [0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 27, 27, 25, 25];
const scattered = [0, 2, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22, 24];
const fourMelds = Array.from({ length: 4 }, (_, tile) => ({
  kind: 'peng', tiles: Array(3).fill(tile), from: 3, concealed: false,
}));

/** Reserve actual physical tiles before distributing the remainder. */
function fixture({ hand = [...scattered, PIZI], melds = [], draws = [TILE.WEST], seat = 0, indicator = PIZI } = {}) {
  const game = new MahjongGame({ seed: 'pizi-gang-fixture', laizi: indicator !== null });
  game.indicatorTile = indicator;
  game.wildTile = indicator === null ? null : nextWildTile(indicator);
  game.wallInfo = { dice: [2, 5], indicatorPosition: indicator === null ? null : 2, tailDraws: 0 };
  const counts = Array(TILE_TYPE_COUNT).fill(4);
  for (const tile of [...(indicator === null ? [] : [indicator]), ...hand, ...melds.flatMap(meld => meld.tiles), ...draws]) {
    assert.ok(--counts[tile] >= 0, `fixture exceeds four copies of ${tile}`);
  }
  const remaining = counts.flatMap((count, tile) => Array(count).fill(tile));
  for (let player = 0; player < 4; player++) {
    game.players[player].hand = player === seat ? [...hand] : remaining.splice(0, 13);
    game.players[player].melds = player === seat ? structuredClone(melds) : [];
    game.players[player].redGangs = [];
    game.players[player].piziGangs = [];
    game.players[player].discards = [];
  }
  game.wall = [...draws, ...remaining];
  game.current = seat;
  game.phase = { kind: 'discard', seat };
  game.pendingDiscard = null;
  game.result = null;
  game.winner = null;
  game.lastDraw = { player: seat, tile: hand.at(-1), index: hand.length - 1, replacement: false };
  game._responses = Array(4).fill(null);
  assertConservation(game);
  return game;
}

function assertConservation(game) {
  assertInvariants(game);
  const tiles = collectPhysicalTiles(game);
  assert.equal(tiles.length, 136);
  for (let tile = 0; tile < TILE_TYPE_COUNT; tile++) {
    assert.equal(tiles.filter(value => value === tile).length, 4, `tile ${tile} retains exactly four physical copies`);
  }
}

function stateOf(game) {
  const { _random, _diceRandom, ...state } = game;
  return structuredClone(state);
}

function limitWall(game, length = 0) {
  const removed = game.wall.splice(length);
  const seat = game.players[(game.current + 1) % 4];
  for (const tile of removed) {
    if (tile === RED_DRAGON) seat.redGangs.push(tile);
    else if (tile === game.indicatorTile) seat.piziGangs.push(tile);
    else seat.discards.push(tile);
  }
  assertConservation(game);
}

function injectDiscard(game, from, tile) {
  const index = game.wall.indexOf(tile);
  assert.ok(index >= 0);
  game.wall.splice(index, 1);
  game.players[from].discards.push(tile);
  game.current = from;
  game.pendingDiscard = { tile, from };
  game.phase = { kind: 'claim', discard: game.pendingDiscard };
  game.lastDraw = null;
  game._responses = Array(4).fill(null);
  assertConservation(game);
}

test('the revealed indicator shares special-kong rules, while no-indicator rooms retain ordinary tiles', () => {
  assert.equal(isSpecialGangTile(RED_DRAGON), true);
  assert.equal(isSpecialGangTile(PIZI, PIZI), true);
  assert.equal(isSpecialGangTile(PIZI), false);
  const game = fixture({ indicator: null });
  assert.equal(game.getActions(0).piziGang, false);
  assert.equal(game.claim(0, 'piziGang'), false);
  assert.equal(game.discard(0, game.players[0].hand.indexOf(PIZI)), true);
  assertConservation(game);
});

test('every seat rejects an indicator discard without changing any state', () => {
  for (let seat = 0; seat < 4; seat++) {
    const game = fixture({ seat });
    const before = stateOf(game);
    assert.equal(game.applyAction(seat, { kind: ACTION.DISCARD, player: seat, index: game.players[seat].hand.indexOf(PIZI) }), false);
    assert.deepEqual(stateOf(game), before);
    assertConservation(game);
  }
});

test('a single indicator kong moves its actual tile into the public group and supplements from the wall tail', () => {
  const game = fixture({ draws: [TILE.WEST, TILE.NORTH] });
  const wallBefore = [...game.wall];
  const handLength = game.players[0].hand.length;
  const scores = game.players.map(player => player.score);
  assert.equal(game.getActions(0).piziGang, true);
  assert.equal(game.applyAction(0, { kind: ACTION.PIZI_GANG, player: 0 }), true);
  assert.deepEqual(game.wall, wallBefore.slice(1), 'only the tail tile is removed');
  assert.equal(game.lastDraw.tile, TILE.WEST);
  assert.equal(game.lastDraw.replacement, true);
  assert.equal(game.wallInfo.tailDraws, 1);
  assert.equal(game.players[0].hand.length, handLength);
  assert.deepEqual(game.players[0].piziGangs, [PIZI]);
  assert.deepEqual(game.players[0].melds, []);
  assert.equal(game.indicatorTile, PIZI, 'the exposed physical indicator remains in its wall slot');
  assert.deepEqual(game.players.map(player => player.score), scores.map((score,index) => score + (index === 0 ? 30 : -10)), 'single indicator gang charges each opponent one base');
  assert.equal(game.events.at(-2), '你皮子杠五万，补摸一张牌。');
  assertConservation(game);
});

test('numbered, wind, and dragon indicator faces all use the same single-tile kong rule', () => {
  for (let indicator = 0; indicator < TILE_TYPE_COUNT; indicator++) {
    // Red and north candidates are normalized to a white indicator by the
    // established red exception before any hand is dealt.
    if (indicator === RED_DRAGON || indicator === TILE.NORTH) continue;
    const base = Array.from({ length: TILE_TYPE_COUNT }, (_, tile) => tile)
      .filter(tile => tile !== indicator && tile !== RED_DRAGON && tile !== TILE.WHITE).slice(0, 12);
    const game = fixture({ indicator, hand: [...base, indicator, RED_DRAGON], draws: [TILE.WHITE] });
    assert.equal(game.getActions(0).piziGang, true, `indicator ${indicator}`);
    assert.equal(game.discard(0, game.players[0].hand.indexOf(indicator)), false);
    assert.equal(game.claim(0, 'piziGang'), true);
    assert.deepEqual(game.players[0].piziGangs, [indicator]);
    assertConservation(game);
  }
});

test('holding an indicator still permits an ordinary peng, followed by an optional indicator kong before discarding', () => {
  const game = fixture({ hand: [0, 0, ...scattered.filter(tile => tile !== 0).slice(0, 10), PIZI], draws: [0, TILE.WHITE] });
  injectDiscard(game, 3, 0);
  assert.equal(game.claim(0, 'peng'), true);
  for (const seat of [1, 2]) if (game.getActions(seat).pass) game.pass(seat);
  assert.equal(game.phase.kind, 'discard');
  assert.equal(game.current, 0);
  assert.equal(game.lastDraw, null);
  assert.equal(game.getActions(0).piziGang, true);
  assert.equal(game.claim(0, 'piziGang'), true);
  assert.equal(game.lastDraw.replacement, true);
  assert.equal(game.players[0].melds.length, 1);
  assert.deepEqual(game.players[0].piziGangs, [PIZI]);
  assertConservation(game);
});

test('all four indicator copies including the exposed tile can be declared through consecutive tail supplements', () => {
  const game = fixture({ hand: [...scattered.slice(0, 10), PIZI, PIZI, RED_DRAGON, RED_DRAGON], draws: [PIZI, RED_DRAGON, TILE.WEST, TILE.NORTH, TILE.SOUTH, TILE.EAST] });
  for (let step = 0; step < 7; step++) {
    const actions = game.getActions(0);
    assert.equal(game.claim(0, actions.redGang ? 'redGang' : 'piziGang'), true);
    assertConservation(game);
  }
  assert.deepEqual(game.players[0].piziGangs, [PIZI, PIZI, PIZI, PIZI]);
  assert.equal(game.indicatorTaken, true);
  assert.deepEqual(game.players[0].redGangs, [RED_DRAGON, RED_DRAGON, RED_DRAGON]);
  assert.equal(game.wallInfo.tailDraws, 6);
  assert.equal(game.players[0].hand.length, 14);
  assert.equal(game.players[0].hand.some(tile => isSpecialGangTile(tile, PIZI)), false);
});

test('concealed indicators block self-draw Hu until each has been declared, including a wildcard-complete shape', () => {
  const hand = [...ordinary.slice(0, 12), PIZI, PIZI];
  assert.equal(isWinning(hand), true, 'the legacy three-argument helper still checks shapes');
  assert.equal(isWinning(hand, 0, PIZI + 1, PIZI), false);
  const game = fixture({ hand, draws: [25, 25] });
  const before = stateOf(game);
  assert.equal(game.getActions(0).hu, false);
  assert.equal(game.claim(0, 'hu'), false);
  assert.deepEqual(stateOf(game), before);
  assert.equal(game.claim(0, 'piziGang'), true);
  assert.equal(game.getActions(0).hu, false);
  assert.equal(game.claim(0, 'piziGang'), true);
  assert.equal(game.getActions(0).hu, true);
  assert.equal(game.claim(0, 'hu'), true);
  assert.equal(game.result.kind, 'win');
  assert.equal(game.result.points, 30, 'existing base and self-draw plus one base for replacement Hu');
  assert.deepEqual(game.players[0].piziGangs, [PIZI, PIZI]);
  assertConservation(game);
  const wildcardHand = [...ordinary.slice(0, 12), PIZI, PIZI + 1];
  assert.equal(isWinning(wildcardHand, 0, PIZI + 1), true);
  assert.equal(isWinning(wildcardHand, 0, PIZI + 1, PIZI), false);
});

test('a special indicator kong never consumes one of the four ordinary meld slots', () => {
  const game = fixture({ hand: [PIZI, 25], melds: fourMelds, draws: [25] });
  assert.equal(game.getActions(0).piziGang, true);
  assert.equal(game.claim(0, 'piziGang'), true);
  assert.equal(game.players[0].melds.length, 4);
  assert.equal(game.players[0].hand.length, 2);
  assert.equal(game.getActions(0).hu, true);
  assert.equal(game.claim(0, 'hu'), true);
  assertConservation(game);
});

test('an injected indicator discard cannot grant a win, peng, ordinary exposed kong, or chi', () => {
  const game = fixture({ hand: [...scattered.slice(0, 11), PIZI, PIZI], draws: [PIZI] });
  injectDiscard(game, 3, PIZI);
  const actions = game.getActions(0);
  assert.equal(actions.hu, false);
  assert.equal(actions.peng, false);
  assert.equal(actions.gang, false);
  assert.deepEqual(actions.chi, []);
  for (const action of ['hu', 'peng', 'gang', 'chi', 'piziGang']) {
    const before = stateOf(game);
    assert.equal(game.claim(0, action), false, action);
    assert.deepEqual(stateOf(game), before);
  }
  assertConservation(game);
});

test('chi cannot consume a concealed indicator as part of an otherwise ordinary sequence', () => {
  const game = fixture({ hand: [3, PIZI, ...scattered.filter(tile => tile !== 3).slice(0, 11)], draws: [5] });
  injectDiscard(game, 3, 5);
  assert.equal(game.getActions(0).chi.some(sequence => sequence.includes(PIZI)), false);
  const before = stateOf(game);
  assert.equal(game.claim(0, 'chi', [3, 4, 5]), false);
  assert.deepEqual(stateOf(game), before);
  assertConservation(game);
});

test('a ready hand retaining an indicator cannot claim an ordinary winning discard', () => {
  const hand = [...ordinary.slice(3, 12), PIZI];
  const melds = [{ kind: 'chi', tiles: ordinary.slice(0, 3), from: 3, concealed: false }];
  const game = fixture({ hand, melds, draws: [PIZI + 1] });
  injectDiscard(game, 3, PIZI + 1);
  assert.equal(isWinning([...hand, PIZI + 1], melds, PIZI + 1), true);
  assert.equal(game.getActions(0).hu, false);
  assert.equal(game.claim(0, 'hu'), false);
  assertConservation(game);
});

test('legacy ordinary meld APIs cannot upgrade an indicator peng into an added kong', () => {
  // Four copies would otherwise be needed, one already belongs to the visible
  // indicator. This deliberately malformed old group is checked without moving
  // physical tiles, so the ordinary API still cannot accept it.
  const game = fixture();
  game.players[0].melds.push({ kind: 'peng', tiles: [PIZI, PIZI, PIZI], from: 3, concealed: false });
  assert.equal(game.getActions(0).addedGangs.includes(PIZI), false);
  assert.equal(game.getActions(0).concealedGangs.includes(PIZI), false);
  for (const action of ['addedGang', 'added-gang', 'buGang', 'concealedGang', 'concealed-gang', 'anGang']) {
    const before = stateOf(game);
    assert.equal(game.claim(0, action, PIZI), false, action);
    assert.deepEqual(stateOf(game), before);
  }
});

test('discard hints and shanten never treat a retained indicator as a legal discard or completed hand', () => {
  assert.equal(chooseDiscard([PIZI], [], [], PIZI + 1, PIZI), -1);
  assert.equal(chooseDiscard([RED_DRAGON, PIZI], [], [], PIZI + 1, PIZI), -1);
  assert.equal(chooseDiscard([RED_DRAGON, PIZI, PIZI + 1], [], [], PIZI + 1, PIZI), 2);
  const hand = [...ordinary.slice(0, 12), PIZI, PIZI];
  assert.equal(calculateShanten(hand, 0, PIZI + 1, PIZI), 8);
  for (const wild of [null, PIZI + 1]) {
    const choice = chooseDiscard([...scattered, PIZI], [], [], wild, PIZI);
    assert.ok(choice >= 0);
    assert.notEqual([...scattered, PIZI][choice], PIZI);
  }
});

test('AI declares red and indicator kongs before discarding and preserves every physical tile', () => {
  const game = fixture({ seat: 1, hand: [...scattered.slice(0, 12), RED_DRAGON, PIZI], draws: [TILE.WEST, TILE.NORTH] });
  assert.equal(game.advanceAI(), true);
  assert.deepEqual(game.players[1].redGangs, [RED_DRAGON]);
  assert.deepEqual(game.players[1].piziGangs, []);
  assertConservation(game);
  assert.equal(game.advanceAI(), true);
  assert.deepEqual(game.players[1].piziGangs, [PIZI]);
  assert.equal(game.players[1].discards.length, 0);
  assertConservation(game);
  assert.equal(game.advanceAI(), true);
  assert.equal(game.players[1].discards.length, 1);
  assertConservation(game);
});

test('empty-wall special-only turns finish automatically, while ordinary tiles remain legally discardable', () => {
  for (const hand of [[PIZI, PIZI], [RED_DRAGON, PIZI]]) {
    const game = fixture({ seat: 1, hand, melds: fourMelds });
    limitWall(game);
    const scores = game.players.map(player => player.score);
    assert.equal(game.getActions(1).piziGang, false);
    assert.equal(game.claim(1, 'piziGang'), false);
    assert.equal(game.advanceAI(), true);
    assert.equal(game.result.kind, 'draw');
    assert.match(game.result.reason, /红中或皮子无法补杠/);
    assert.equal(game.advanceAI(), false);
    assert.deepEqual(game.players.map(player => player.score), scores);
    assertConservation(game);
  }
  const game = fixture({ seat: 1 });
  limitWall(game);
  assert.equal(game.advanceAI(), true);
  assert.equal(game.players[1].hand.includes(PIZI), true);
  assert.equal(game.players[1].discards.length, 1);
  assert.notEqual(game.players[1].discards[0], PIZI);
  assertConservation(game);
});

test('drawing the last indicator automatically resolves a human special-only turn without a deadlock', () => {
  const game = fixture({ hand: [PIZI], melds: fourMelds, draws: [PIZI] });
  limitWall(game, 1);
  assert.equal(game._drawTile(0), true);
  assert.equal(game.phase.kind, 'ended');
  assert.equal(game.result.kind, 'draw');
  assert.deepEqual(game.players[0].hand, [PIZI, PIZI]);
  assertConservation(game);
});

test('special actions require the current seat, correct caller, an indicator, and a physical tail supplement', () => {
  const game = fixture();
  for (const [caller, action] of [
    [0, { kind: ACTION.PIZI_GANG, player: 1 }],
    [1, { kind: ACTION.PIZI_GANG, player: 1 }],
    [4, { kind: ACTION.PIZI_GANG, player: 4 }],
  ]) {
    const before = stateOf(game);
    assert.equal(game.applyAction(caller, action), false);
    assert.deepEqual(stateOf(game), before);
  }
  limitWall(game);
  const before = stateOf(game);
  assert.equal(game.claim(0, 'piziGang'), false);
  assert.deepEqual(stateOf(game), before);
  assertConservation(game);
});

test('new rounds and restarts clear all indicator-kong groups and disabling laizi removes the special tile', () => {
  const game = fixture();
  assert.equal(game.claim(0, 'piziGang'), true);
  for (const options of [{ restart: true }, {}, { laizi: false }]) {
    game.newRound('pizi-gang-reset', options);
    assert.ok(game.players.every(player => player.piziGangs.length === 0));
    assert.equal(game.wallInfo.tailDraws, 0);
    assertConservation(game);
  }
  assert.equal(game.indicatorTile, null);
  assert.equal(game.getActions(game.current).piziGang, false);
});

test('invariants reject an undeclared winning indicator and malformed public indicator groups', () => {
  const game = fixture({ hand: [...ordinary.slice(0, 12), PIZI, PIZI] });
  game._finishWin(0, null, true);
  assert.throws(() => assertInvariants(game), /undeclared indicator/);
  const malformed = fixture();
  const ordinaryIndex = malformed.players[0].hand.findIndex(tile => tile !== PIZI);
  malformed.players[0].piziGangs.push(malformed.players[0].hand.splice(ordinaryIndex, 1)[0]);
  assert.throws(() => assertInvariants(malformed), /declared indicator kong/);
});

for (const replacement of [false, true]) {
  test(`${replacement ? 'tail supplement' : 'head draw'} transfers the exposed indicator without consuming a back`, () => {
    const game = fixture({hand:scattered, seat:1, draws:[TILE.WEST]});
    if (replacement) game.wallInfo.tailDraws = game.wallInfo.indicatorPosition;
    else limitWall(game, game.wallInfo.indicatorPosition);
    const before = {count:game.wall.length, tail:game.wallInfo.tailDraws, scores:game.players.map(player=>player.score)};
    assert.equal(game._drawTile(1, replacement), true);
    assert.equal(game.indicatorTaken, true);
    assert.equal(game.indicatorTakenBy, 1);
    assert.equal(game.indicatorTile, PIZI);
    assert.equal(game.wildTile, nextWildTile(PIZI));
    assert.deepEqual(game.lastDraw, {player:1,tile:PIZI,index:game.players[1].hand.lastIndexOf(PIZI),replacement});
    assert.equal(game.players[1].hand.length, 14);
    assert.equal(game.wall.length, before.count);
    assert.equal(game.wallInfo.tailDraws, before.tail);
    assert.deepEqual(game.players.map(player=>player.score), before.scores);
    assert.equal(game.getActions(1).piziGang, true);
    assert.equal(game.getActions(1).hu, false);
    assert.equal(game.discard(1, game.lastDraw.index), false);
    assertConservation(game);

    const next = game.wall[0];
    assert.equal(game.claim(1, 'piziGang'), true);
    assert.deepEqual(game.players[1].piziGangs, [PIZI]);
    assert.equal(game.wall.length, before.count - 1);
    assert.equal(game.wallInfo.tailDraws, before.tail + 1);
    assert.equal(game.lastDraw.tile, next);
    assert.equal(game.lastDraw.replacement, true);
    assert.deepEqual(game.players.map(player=>player.score), before.scores.map((score,seat)=>score+(seat===1?30:-10)));
    const settled = stateOf(game);
    assert.equal(game.claim(1, 'piziGang'), false, 'the same physical tile cannot be declared twice');
    assert.deepEqual(stateOf(game), settled);
    assertConservation(game);
  });
}

test('a player may retain the exposed indicator and discard an ordinary tile without declaring or scoring a kong', () => {
  const game = fixture({hand:scattered, seat:2});
  game.wallInfo.tailDraws = game.wallInfo.indicatorPosition;
  assert.equal(game._drawTile(2, true), true);
  const scores = game.players.map(player=>player.score);
  const ordinaryIndex = game.players[2].hand.findIndex(tile=>!isSpecialGangTile(tile, PIZI));
  assert.equal(game.discard(2, ordinaryIndex), true);
  assert.ok(game.players[2].hand.includes(PIZI));
  assert.deepEqual(game.players[2].piziGangs, []);
  assert.deepEqual(game.players.map(player=>player.score), scores);
  assert.equal(game.indicatorTakenBy, 2);
  assertConservation(game);
});

test('the last physical exposed indicator enters the hand before a special-only turn ends in a draw', () => {
  const game = fixture({hand:[], draws:[]});
  limitWall(game, 0);
  game.wallInfo.tailDraws = game.wallInfo.indicatorPosition;
  assert.equal(game._drawTile(0, true), true);
  assert.deepEqual(game.players[0].hand, [PIZI]);
  assert.equal(game.indicatorTaken, true);
  assert.equal(game.indicatorTakenBy, 0);
  assert.equal(game.phase.kind, 'ended');
  assert.equal(game.result.kind, 'draw');
  assert.equal(game.wall.length, 0);
  assert.equal(game.getActions(0).piziGang, false);
  assertConservation(game);
});
