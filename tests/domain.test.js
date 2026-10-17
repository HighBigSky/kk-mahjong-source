import test from 'node:test';
import assert from 'node:assert/strict';
import { runDomainRegression } from './domain-invariants.mjs';
import { MahjongGame as CurrentGame } from '../engine.js';
import { legacyWallOracle, authorizedWallChanges } from './legacy-wall-oracle.mjs';
const { MahjongGame: OldGame } = legacyWallOracle;
import { assertInvariants } from '../src/domain/invariants.js';

test('domain migration preserves 200 original seeds against the authorized-rules-adapted frozen oracle, every tile, logs, scores and AI decisions', async () => {
  const report = await runDomainRegression();
  assert.equal(report.rounds.length, 200);
  assert.equal(report.mode, 'authorized-rules-adapted-frozen-oracle-vs-domain');
  assert.deepEqual(report.authorizedOracleChanges, [...authorizedWallChanges]);
  assert.equal('seedSubstitutions' in report, false, 'no rounds are skipped or replaced');
  assert.deepEqual(report.rounds.map(entry => entry.seed), [
    ...Array.from({ length: 100 }, (_, index) => `domain-normal-${index}`),
    ...Array.from({ length: 100 }, (_, index) => `domain-wild-${index}`),
  ]);
  for (const entry of report.rounds) assert.equal(entry.oldEventsSha256, entry.newEventsSha256);
});

function preparedGame(Game, { hand, melds = [], discard = null }) {
  const game = new Game({ seed: 'domain-adapter-fixture' });
  const objectPhase = typeof game.phase === 'object';
  const remaining = Array(34).fill(4);
  for (const player of game.players) {
    player.hand = []; player.melds = []; player.redGangs = []; player.piziGangs = []; player.discards = [];
  }
  game.players[0].hand = [...hand].sort((a, b) => a - b);
  game.players[0].melds = structuredClone(melds);
  for (const tile of [...hand, ...melds.flatMap(meld => meld.tiles)]) assert.ok(--remaining[tile] >= 0);
  if (discard !== null) {
    game.players[3].discards.push(discard);
    assert.ok(--remaining[discard] >= 0);
  }
  for (let seat = 1; seat < 4; seat++) {
    for (let draw = 0; draw < 13; draw++) {
      const tile = remaining.findIndex(count => count > 0);
      game.players[seat].hand.push(tile);
      remaining[tile]--;
    }
  }
  game.wall = remaining.flatMap((count, tile) => Array(count).fill(tile));
  game.current = discard === null ? 0 : 3;
  game.pendingDiscard = discard === null ? null : { tile: discard, from: 3 };
  game.phase = objectPhase
    ? discard === null ? { kind: 'discard', seat: 0 } : { kind: 'claim', discard: game.pendingDiscard }
    : discard === null ? 'discard' : 'claim';
  game.lastDraw = discard === null
    ? { player: 0, tile: game.players[0].hand.at(-1), index: game.players[0].hand.length - 1, replacement: false }
    : null;
  game.winner = null;
  game.result = null;
  game.events = [];
  game._responses = Array(4).fill(null);
  return game;
}

function assertAdapterState(oldGame, newGame) {
  assert.equal(JSON.stringify(newGame.events), JSON.stringify(oldGame.events));
  for (const key of ['players', 'wall', 'current', 'pendingDiscard', 'lastDraw', 'result', 'winner']) {
    assert.deepEqual(newGame[key], oldGame[key], key);
  }
  assert.equal(newGame.phase.kind, oldGame.phase);
  assertInvariants(newGame);
}

for (const [mode, aliases, hand, melds] of [
  ['concealed', ['concealedGang', 'concealed-gang', 'anGang'],
    [1, 1, 1, 1, 0, 2, 3, 9, 10, 11, 18, 19, 20, 27], []],
  ['added', ['addedGang', 'added-gang', 'buGang'],
    [1, 0, 2, 3, 9, 10, 11, 18, 19, 20, 27],
    [{ kind: 'peng', tiles: [1, 1, 1], from: 3, concealed: false }]],
]) {
  test(`deprecated claim preserves ${mode} kong aliases and omitted/scalar/array tile defaults`, () => {
    for (const alias of aliases) {
      for (const tiles of [undefined, 1, [1]]) {
        const oldGame = preparedGame(OldGame, { hand, melds });
        const newGame = preparedGame(CurrentGame, { hand, melds });
        assert.equal(oldGame.claim(0, alias, tiles), true);
        assert.equal(newGame.claim(0, alias, tiles), true);
        assertAdapterState(oldGame, newGame);
      }
    }
  });
}

test('deprecated claim preserves the default first chi sequence', () => {
  const options = { hand: [0, 2, 3, 5, 7, 9, 11, 13, 15, 18, 20, 22, 27], discard: 1 };
  const oldGame = preparedGame(OldGame, options);
  const newGame = preparedGame(CurrentGame, options);
  assert.equal(oldGame.claim(0, 'chi'), true);
  assert.equal(newGame.claim(0, 'chi'), true);
  assertAdapterState(oldGame, newGame);
  for (let seat = 1; seat < 4; seat++) {
    if (oldGame.getActions(seat).pass) {
      assert.equal(oldGame.pass(seat), true);
      assert.equal(newGame.pass(seat), true);
      assertAdapterState(oldGame, newGame);
    }
  }
});

test('typed actions reject malformed or mismatched commands without mutating the game', () => {
  const game = new CurrentGame({ seed: 'domain-action-validation' });
  const snapshot = JSON.stringify(game);
  const invalidActions = [
    null, undefined, 'discard', {}, { kind: 'unknown', player: 0 },
    { kind: 'discard', player: 1, index: 0 },
    { kind: 'discard', player: 0, index: -1 },
    { kind: 'discard', player: 0, index: '0' },
    { kind: 'gang', player: 0, tile: 1, mode: 'invalid' },
    { kind: 'gang', player: 0, tile: 1 },
    { kind: 'chi', player: 0, sequence: '012' },
    { kind: 'chi', player: 0, sequence: [0, 1] },
  ];
  for (const action of invalidActions) {
    assert.equal(game.applyAction(0, action), false, JSON.stringify(action));
    assert.equal(JSON.stringify(game), snapshot, 'rejected action has no observable side effects');
  }
  assertInvariants(game);
});
