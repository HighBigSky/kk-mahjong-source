import test from 'node:test';
import assert from 'node:assert/strict';
import { MahjongGame, isWinning, chooseDiscard } from '../engine.js';

const RED = 31;
const scattered = [0, 2, 4, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22];

/** Reserve the requested hand/draws, then distribute every other physical tile. */
function fixture({ seat = 0, hand = [...scattered, RED], melds = [], draws = [29] } = {}) {
  const game = new MahjongGame({ seed: 'red-gang-tests' });
  const counts = Array(34).fill(4);
  for (const tile of [...hand, ...melds.flatMap(meld => meld.tiles), ...draws]) {
    assert.ok(--counts[tile] >= 0, `fixture has more than four copies of tile ${tile}`);
  }
  const remaining = counts.flatMap((count, type) => Array(count).fill(type));
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
  return game;
}

function physicalTiles(game) {
  return [
    ...game.wall,
    ...game.players.flatMap(player => [
      ...player.hand, ...player.discards, ...player.redGangs,
      ...player.melds.flatMap(meld => meld.tiles),
    ]),
  ];
}

function assertConservation(game) {
  const tiles = physicalTiles(game);
  assert.equal(tiles.length, 136);
  for (let type = 0; type < 34; type++) {
    assert.equal(tiles.filter(tile => tile === type).length, 4, `tile ${type} must retain all four copies`);
  }
}

function state(game) {
  return structuredClone({
    players: game.players, wall: game.wall, current: game.current, phase: game.phase,
    pendingDiscard: game.pendingDiscard, lastDraw: game.lastDraw, events: game.events,
    responses: game._responses, result: game.result, winner: game.winner,
  });
}

/** Exhaust a fixture without inventing any discarded red dragons. */
function limitWall(game, length = 0) {
  const removed = game.wall.splice(length);
  game.players[(game.current + 1) % 4].redGangs.push(...removed.filter(tile => tile === RED));
  game.players[3].discards.push(...removed.filter(tile => tile !== RED));
}

const fourMelds = Array.from({ length: 4 }, (_, tile) => ({
  kind: 'peng', tiles: Array(3).fill(tile), from: 3, concealed: false,
}));

test('red discards are rejected without state changes for every seat', () => {
  for (let seat = 0; seat < 4; seat++) {
    const game = fixture({ seat });
    const index = game.players[seat].hand.indexOf(RED);
    const before = state(game);
    assert.equal(game.discard(seat, index), false, `seat ${seat} cannot discard red`);
    assert.deepEqual(state(game), before);
    assertConservation(game);
  }
});

test('discard hints never select red and distinguish a legal wildcard discard from no legal tile', () => {
  for (const wild of [null, 32, RED]) {
    for (const hand of [[RED], Array(4).fill(RED)]) {
      assert.equal(chooseDiscard(hand, [], [], wild), -1);
    }
    for (const hand of [[RED, 32], [...scattered, RED], [RED, RED, 32, 32]]) {
      const original = [...hand];
      const index = chooseDiscard(hand, [], [], wild);
      assert.ok(index >= 0);
      assert.notEqual(hand[index], RED);
      assert.deepEqual(hand, original);
    }
  }
  assert.equal(chooseDiscard([RED, 32], [], [], 32), 1,
    'the wildcard is a legal discard when its only alternative is a red dragon');
});

test('an injected red discard cannot grant Hu, peng, or an ordinary exposed kong', () => {
  const game = fixture({ hand: [...scattered.slice(0, 10), RED, RED, RED], draws: [RED] });
  const tile = game.wall.shift();
  game.players[3].discards.push(tile);
  game.current = 3; game.lastDraw = null;
  game.pendingDiscard = { tile, from: 3 };
  game.phase = { kind: 'claim', discard: game.pendingDiscard };
  const actions = game.getActions(0);
  assert.equal(actions.hu, false);
  assert.equal(actions.peng, false);
  assert.equal(actions.gang, false);
  assert.deepEqual(actions.chi, []);
  for (const action of ['hu', 'peng', 'gang', 'redGang']) {
    const before = state(game);
    assert.equal(game.claim(0, action), false, action);
    assert.deepEqual(state(game), before);
  }
  assertConservation(game);
});

test('four red dragons offer only individual special kongs, with ordinary kong APIs rejected', () => {
  const game = fixture({ hand: [...scattered.slice(0, 10), RED, RED, RED, RED] });
  const actions = game.getActions(0);
  assert.equal(actions.redGang, true);
  assert.equal(actions.concealedGangs.includes(RED), false);
  assert.equal(actions.addedGangs.includes(RED), false);
  for (const action of ['gang', 'concealedGang', 'concealed-gang', 'anGang']) {
    const before = state(game);
    assert.equal(game.claim(0, action, RED), false, action);
    assert.deepEqual(state(game), before);
  }
  assert.equal(game.claim(0, 'redGang'), true);
  assert.equal(game.players[0].hand.filter(tile => tile === RED).length, 3);
  assert.deepEqual(game.players[0].redGangs, [RED]);
  assert.deepEqual(game.players[0].melds, []);
  assertConservation(game);
});

test('a legacy exposed red peng cannot be upgraded through the ordinary added-kong API', () => {
  const game = fixture({ hand: [...scattered.slice(0, 10), RED],
    melds: [{ kind: 'peng', tiles: [RED, RED, RED], from: 3, concealed: false }] });
  assert.equal(game.getActions(0).addedGangs.includes(RED), false);
  for (const action of ['addedGang', 'added-gang', 'buGang']) {
    const before = state(game);
    assert.equal(game.claim(0, action, RED), false, action);
    assert.deepEqual(state(game), before);
  }
  assertConservation(game);
});

test('AI with an empty wall keeps its red and discards an ordinary tile', () => {
  const game = fixture({ seat: 1 });
  limitWall(game);
  assert.equal(game.getActions(1).redGang, false);
  assert.equal(game.advanceAI(), true);
  assert.equal(game.players[1].hand.includes(RED), true);
  assert.equal(game.players[1].discards.length, 1);
  assert.notEqual(game.players[1].discards[0], RED);
  assert.ok(game.players.every(player => !player.discards.includes(RED)));
  assertConservation(game);
});

test('AI with only reds and an empty wall ends the round instead of stalling or discarding red', () => {
  const game = fixture({ seat: 1, hand: [RED, RED], melds: fourMelds });
  limitWall(game);
  const tiles = physicalTiles(game).sort((a, b) => a - b);
  const scores = game.players.map(player => player.score);
  assert.equal(game.advanceAI(), true);
  assert.equal(game.phase.kind, 'ended');
  assert.equal(game.result.kind, 'draw');
  assert.match(game.result.reason, /红中无法补杠/);
  assert.equal(game.advanceAI(), false);
  assert.deepEqual(game.players[1].hand, [RED, RED]);
  assert.deepEqual(game.players.map(player => player.score), scores);
  assert.deepEqual(physicalTiles(game).sort((a, b) => a - b), tiles);
  assert.ok(game.players.every(player => !player.discards.includes(RED)));
  assertConservation(game);
});

test('the human last-wall red draw automatically resolves an otherwise blocked red-only turn', () => {
  const game = fixture({ hand: [RED], melds: fourMelds, draws: [RED] });
  limitWall(game, 1);
  assert.equal(game._drawTile(0), true, 'the last physical draw still succeeds');
  assert.equal(game.phase.kind, 'ended');
  assert.equal(game.result.kind, 'draw');
  assert.match(game.result.reason, /红中无法补杠/);
  assert.deepEqual(game.players[0].hand, [RED, RED]);
  assert.deepEqual(game.players[0].redGangs, []);
  assert.ok(game.players.every(player => !player.discards.includes(RED)));
  assertConservation(game);
});

test('a final replacement red resolves a blocked turn while retaining the declared kong and all tiles', () => {
  const game = fixture({ hand: [RED, RED], melds: fourMelds, draws: [RED] });
  limitWall(game, 1);
  assert.equal(game.claim(0, 'redGang'), true);
  assert.equal(game.phase.kind, 'ended');
  assert.equal(game.result.kind, 'draw');
  assert.deepEqual(game.players[0].redGangs, [RED]);
  assert.deepEqual(game.players[0].hand, [RED, RED]);
  assert.equal(game.wall.length, 0);
  assert.ok(game.players.every(player => !player.discards.includes(RED)));
  assertConservation(game);
});

test('last-wall chi or peng that leaves only reds also resolves the human turn as a draw', () => {
  const melds = [9, 10, 11].map(tile => ({
    kind: 'peng', tiles: Array(3).fill(tile), from: 3, concealed: false,
  }));
  for (const { action, hand, incoming, sequence } of [
    { action: 'peng', hand: [0, 0, RED, RED], incoming: 0 },
    { action: 'chi', hand: [0, 2, RED, RED], incoming: 1, sequence: [0, 1, 2] },
  ]) {
    const game = fixture({ hand, melds, draws: [incoming] });
    const tile = game.wall.shift();
    game.players[3].discards.push(tile);
    limitWall(game);
    game.current = 3; game.lastDraw = null;
    game.pendingDiscard = { tile, from: 3 };
    game.phase = { kind: 'claim', discard: game.pendingDiscard };
    assert.equal(game.claim(0, action, sequence), true);
    for (let player = 1; player < 3 && game.phase.kind === 'claim'; player++) {
      if (game.getActions(player).pass) assert.equal(game.pass(player), true);
    }
    assert.equal(game.phase.kind, 'ended', `${action} must not leave an unplayable human turn`);
    assert.equal(game.result.kind, 'draw');
    assert.match(game.result.reason, /红中无法补杠/);
    assert.deepEqual(game.players[0].hand, [RED, RED]);
    assert.equal(game.players[0].melds.length, 4);
    assert.ok(game.players.every(player => !player.discards.includes(RED)));
    assertConservation(game);
  }
});

test('a complete concealed red pair blocks self-draw Hu without changing the game', () => {
  // Seven pairs remains exempt from 258; the held reds, rather than an invalid
  // ordinary pair, must still be the reason this otherwise complete shape waits.
  const hand = [0, 0, 1, 1, 2, 2, 9, 9, 10, 10, 11, 11, RED, RED];
  const game = fixture({ hand, draws: [25, 25] });
  assert.equal(isWinning(hand), true, 'shape alone does not grant permission to win');
  assert.equal(game.getActions(0).hu, false);
  const before = state(game);
  assert.equal(game.claim(0, 'hu'), false);
  assert.deepEqual(state(game), before);
  assert.equal(game.claim(0, 'redGang'), true);
  assert.equal(game.players[0].hand.includes(RED), true);
  assert.equal(game.getActions(0).hu, false, 'the last held red still blocks Hu');
  assert.equal(game.claim(0, 'redGang'), true);
  assert.equal(game.getActions(0).hu, true);
  assert.equal(game.claim(0, 'hu'), true);
  assert.deepEqual(game.players[0].redGangs, [RED, RED]);
  assertConservation(game);
});

test('held reds and an incoming red each block a mathematically complete discard win', () => {
  const sets = [0, 1, 2, 3, 4, 5, 9, 10, 11];
  for (const { hand, incoming, melds = [] } of [
    { hand: [...sets.slice(3), RED, RED, RED, 25], incoming: 25,
      melds: [{ kind: 'chi', tiles: sets.slice(0, 3), from: 3, concealed: false }] },
    { hand: [0, 0, 1, 1, 2, 2, 9, 9, 10, 10, 11, 11, RED], incoming: RED },
  ]) {
    const game = fixture({ hand, melds, draws: [incoming] });
    assert.equal(isWinning([...hand, incoming], melds), true);
    const tile = game.wall.shift();
    game.players[3].discards.push(tile);
    game.current = 3; game.lastDraw = null;
    game.pendingDiscard = { tile, from: 3 };
    game.phase = { kind: 'claim', discard: game.pendingDiscard };
    assert.equal(game.getActions(0).hu, false);
    const before = state(game);
    assert.equal(game.claim(0, 'hu'), false);
    assert.deepEqual(state(game), before);
    assertConservation(game);
  }
});

test('a held red cannot be discarded, and declaring it can enable an ordinary winning replacement', () => {
  const hand = [0, 1, 2, 3, 4, 5, 9, 10, 11, 18, 19, 20, 25, RED];
  const game = fixture({ hand, draws: [25] });
  const before = state(game);
  assert.equal(game.discard(0, hand.indexOf(RED)), false);
  assert.deepEqual(state(game), before, 'an invalid red discard must leave every field unchanged');
  assert.equal(game.claim(0, 'redGang'), true);
  assert.equal(game.players[0].hand.includes(RED), false);
  assert.equal(game.getActions(0).hu, true);
  assert.equal(game.claim(0, 'hu'), true);
  assert.deepEqual(game.players[0].discards, []);
  assert.deepEqual(game.players[0].redGangs, [RED]);
  assertConservation(game);
});

test('AI handles the red prerequisite before declaring an otherwise complete hand', () => {
  const hand = [0, 0, 1, 1, 2, 2, 9, 9, 10, 10, 11, 11, RED, RED];
  const game = fixture({ seat: 1, hand, draws: [25, 25] });
  assert.equal(game.getActions(1).hu, false);
  assert.equal(game.advanceAI(), true);
  assert.deepEqual(game.players[1].redGangs, [RED]);
  assert.equal(game.advanceAI(), true);
  assert.equal(game.getActions(1).hu, true);
  assert.equal(game.advanceAI(), true);
  assert.equal(game.winner, 1);
  assert.equal(game.result.hand.includes(RED), false);
  assertConservation(game);
});

test('one held red dragon is an optional action anywhere in the player’s discard turn', () => {
  const game = fixture();
  game.lastDraw = null;
  const before = state(game);
  assert.equal(game.getActions(0).redGang, true, 'the red need not be the freshly drawn tile');
  assert.equal(game.advanceAI(), false, 'the AI must leave the human’s red-kong choice to the human');
  assert.deepEqual(state(game), before, 'offering a red kong must not force its declaration');
  assert.equal(game.discard(0, 0), true, 'the player can discard another tile instead');
  assert.equal(game.players[0].hand.includes(RED), true);
  assert.deepEqual(game.players[0].redGangs, []);
  assertConservation(game);
});

test('a single-red kong replaces exactly one tile and keeps the player’s turn and ordinary meld slots', () => {
  const game = fixture({ hand: [...scattered.slice(0, 12), RED, RED], draws: [28] });
  const wallLength = game.wall.length;
  const scores = game.players.map(player => player.score);
  assert.equal(game.claim(0, 'redGang'), true);
  assert.equal(game.players[0].hand.length, 14);
  assert.equal(game.players[0].hand.filter(tile => tile === RED).length, 1);
  assert.equal(game.players[0].hand.includes(28), true);
  assert.deepEqual(game.players[0].redGangs, [RED]);
  assert.deepEqual(game.players[0].melds, []);
  assert.equal(game.wall.length, wallLength - 1);
  assert.equal(game.current, 0);
  assert.equal(game.phase.kind, 'discard');
  assert.deepEqual(game.lastDraw, {
    player: 0, tile: 28, index: game.players[0].hand.indexOf(28), replacement: true,
  });
  assert.deepEqual(game.players.map(player => player.score), scores, 'no unspecified red-kong score is applied');
  assertConservation(game);
});

test('each of four held reds can be declared individually without creating four ordinary melds', () => {
  const game = fixture({ hand: [...scattered.slice(0, 10), RED, RED, RED, RED], draws: [27, 28, 29, 30] });
  const wallLength = game.wall.length;
  for (let declared = 1; declared <= 4; declared++) {
    assert.equal(game.getActions(0).redGang, true);
    assert.equal(game.claim(0, 'redGang'), true);
    assert.equal(game.players[0].redGangs.length, declared);
    assert.equal(game.players[0].hand.length, 14);
    assert.equal(game.players[0].hand.filter(tile => tile === RED).length, 4 - declared);
    assert.equal(game.players[0].melds.length, 0);
    assert.equal(game.wall.length, wallLength - declared);
    assertConservation(game);
  }
  const before = state(game);
  assert.equal(game.getActions(0).redGang, false);
  assert.equal(game.claim(0, 'redGang'), false);
  assert.deepEqual(state(game), before);
});

test('a replacement red dragon may itself be declared with a further replacement draw', () => {
  const game = fixture({ draws: [RED, 28] });
  const wallLength = game.wall.length;
  assert.equal(game.claim(0, 'redGang'), true);
  assert.equal(game.lastDraw.tile, RED);
  assert.equal(game.getActions(0).redGang, true);
  assert.equal(game.claim(0, 'redGang'), true);
  assert.deepEqual(game.players[0].redGangs, [RED, RED]);
  assert.equal(game.players[0].hand.includes(RED), false);
  assert.equal(game.players[0].hand.length, 14);
  assert.equal(game.wall.length, wallLength - 2);
  assert.equal(game.lastDraw.tile, 28);
  assertConservation(game);
});

test('red-kong calls outside the owner’s discard turn leave the game unchanged', () => {
  for (const scenario of ['another seat', 'claim phase', 'ended phase', 'invalid player', 'no held red']) {
    const game = fixture(scenario === 'no held red' ? { hand: [...scattered, 30] } : {});
    let player = 0;
    if (scenario === 'another seat') game.current = 1;
    if (scenario === 'claim phase') {
      game.pendingDiscard = { tile: game.players[1].hand[0], from: 1 };
      game.phase = { kind: 'claim', discard: game.pendingDiscard };
    }
    if (scenario === 'ended phase') game.phase = { kind: 'ended', result: game.result };
    if (scenario === 'invalid player') player = 4;
    const before = state(game);
    assert.equal(game.getActions(player).redGang, false, scenario);
    assert.equal(game.claim(player, 'redGang'), false, scenario);
    assert.deepEqual(state(game), before, scenario);
    assertConservation(game);
  }
});

test('an empty wall disables red kong, while the last wall tile can supply one final replacement', () => {
  const empty = fixture();
  limitWall(empty);
  const before = state(empty);
  assert.equal(empty.getActions(0).redGang, false);
  assert.equal(empty.claim(0, 'redGang'), false);
  assert.deepEqual(state(empty), before);
  assertConservation(empty);

  const last = fixture({ hand: [...scattered.slice(0, 12), RED, RED], draws: [28] });
  limitWall(last, 1);
  assert.equal(last.claim(0, 'redGang'), true);
  assert.equal(last.wall.length, 0);
  assert.equal(last.phase.kind, 'discard', 'the replacement still leaves a normal discard opportunity');
  assert.equal(last.players[0].hand.length, 14);
  assert.equal(last.getActions(0).redGang, false, 'the remaining red cannot be declared without a replacement');
  const after = state(last);
  assert.equal(last.claim(0, 'redGang'), false);
  assert.deepEqual(state(last), after);
  assertConservation(last);
});

test('red declarations stay separate from both concealed and exposed winning hand shapes', () => {
  for (const exposed of [false, true]) {
    const melds = exposed ? [
      { kind: 'chi', tiles: [0, 1, 2], from: 3 },
      { kind: 'chi', tiles: [3, 4, 5], from: 3 },
      { kind: 'chi', tiles: [9, 10, 11], from: 3 },
      { kind: 'chi', tiles: [18, 19, 20], from: 3 },
    ] : [];
    const hand = exposed ? [25, RED] : [0, 1, 2, 3, 4, 5, 9, 10, 11, 18, 19, 20, 25, RED];
    const game = fixture({ hand, melds, draws: [25] });
    assert.equal(game.getActions(0).hu, false);
    assert.equal(game.getActions(0).redGang, true, 'all four ordinary meld slots may already be occupied');
    assert.equal(game.claim(0, 'redGang'), true);
    assert.equal(game.players[0].melds.length, exposed ? 4 : 0);
    assert.equal(game.getActions(0).hu, true, 'the declared red must not count toward the ordinary meld requirement');
    assert.equal(game.claim(0, 'hu'), true);
    assert.equal(game.phase.kind, 'ended');
    assert.equal(game.result.selfDraw, true);
    assert.equal(game.result.hand.includes(RED), false);
    assert.deepEqual(game.players[0].redGangs, [RED]);
    assertConservation(game);
  }
});

test('AI declares its single red, draws once, then continues with its discard', () => {
  const game = fixture({ seat: 1 });
  const wallLength = game.wall.length;
  assert.equal(game.advanceAI(), true);
  assert.deepEqual(game.players[1].redGangs, [RED]);
  assert.equal(game.players[1].hand.length, 14);
  assert.equal(game.players[1].discards.length, 0);
  assert.equal(game.wall.length, wallLength - 1);
  assert.equal(game.current, 1);
  assert.equal(game.advanceAI(), true);
  assert.equal(game.players[1].hand.length, 13);
  assert.equal(game.players[1].discards.length, 1);
  assert.deepEqual(game.players[1].redGangs, [RED]);
  assertConservation(game);
});

test('restarting or advancing a round clears every declared red and redeals all 136 tiles', () => {
  for (const restart of [true, false]) {
    const game = fixture();
    assert.equal(game.claim(0, 'redGang'), true);
    const previousRound = game.round;
    game.players[0].score = 1050;
    game.players[1].score = 950;
    game.newRound('reset-reds', { restart });
    assert.equal(game.round, previousRound + (restart ? 0 : 1));
    assert.ok(game.players.every(player => player.redGangs.length === 0));
    assert.deepEqual(game.players.map(player => player.score), [1050, 950, 1000, 1000]);
    assertConservation(game);
  }
});
