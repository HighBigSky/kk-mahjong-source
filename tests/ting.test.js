import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { MahjongGame } from '../engine.js';
import { getTingHints } from '../src/ui/ting.js';
import { TILE } from '../src/domain/tile.js';

const groups = [[0, 1, 2], [9, 10, 11], [18, 19, 20], [24, 25, 26]];
const plainWait = [...groups.flat(), 4];
const chi = tiles => ({ kind: 'chi', tiles, concealed: false });
const peng = tile => ({ kind: 'peng', tiles: [tile, tile, tile], concealed: false });
const gang = (tile, concealed = false) => ({ kind: 'gang', tiles: Array(4).fill(tile), concealed });
const waitFor = (hints, type) => hints.waits.find(wait => wait.type === type);

test('closed ordinary 258 waits are self-draw only, with natural copies', () => {
  const hints = getTingHints({ hand: plainWait });
  assert.equal(hints.status, 'ready');
  assert.deepEqual(hints.waits, [{ type: 4, selfDraw: true, claim: false }]);
  assert.equal(hints.discardedTile, null);
  const nonJiang = getTingHints({ hand: [...groups.flat(), 3] });
  assert.deepEqual(nonJiang.waits, [], 'an ordinary four-sequence hand requires a 258 pair');
});

test('a full hand asks for a selection and previews only that selected discard', () => {
  const hand = [...plainWait, TILE.NORTH];
  const before = structuredClone(hand);
  assert.equal(getTingHints({ hand }).status, 'select-discard');
  assert.equal(getTingHints({ hand }, null).status, 'select-discard');
  const hints = getTingHints({ hand }, 13);
  assert.equal(hints.discardedTile, TILE.NORTH);
  assert.deepEqual(hints.waits, [{ type: 4, selfDraw: true, claim: false }]);
  assert.deepEqual(getTingHints({ hand }, 12).waits, []);
  assert.deepEqual(hand, before, 'a preview never sorts or mutates the hand');
});

test('opened ordinary waits accept a discard but concealed kongs keep closed-hand eligibility', () => {
  const hand = [...groups.slice(1).flat(), 4];
  assert.equal(waitFor(getTingHints({ hand, melds: [chi(groups[0])] }), 4).claim, true);
  assert.equal(waitFor(getTingHints({ hand, melds: [peng(TILE.NORTH)] }), 4).claim, true);
  assert.equal(waitFor(getTingHints({ hand, melds: [gang(TILE.NORTH)] }), 4).claim, true);
  assert.equal(waitFor(getTingHints({ hand, melds: [gang(TILE.NORTH, true)] }), 4).claim, false);
});

test('wildcard waits reuse ordinary open-hand wildcard limits', () => {
  const wildTile = TILE.EAST;
  const indicatorTile = TILE.WHITE;
  const options = { wildTile, indicatorTile, visibleTiles: [indicatorTile] };
  assert.ok(waitFor(getTingHints({ ...options, hand: plainWait }), wildTile));
  const hand = [9, 10, wildTile, 18, 19, 20, 24, 25, 26, 4];
  const opened = getTingHints({ ...options, hand, melds: [chi(groups[0])] });
  assert.equal(waitFor(opened, wildTile), undefined, 'a second concealed wildcard cannot complete opened ordinary Hu');
  assert.equal(waitFor(opened, 4).claim, true);
  const concealed = getTingHints({ ...options, hand, melds: [gang(TILE.NORTH, true)] });
  assert.equal(waitFor(concealed, wildTile).claim, false);
});

test('all four confirmed big hands may claim their waits while closed', () => {
  const fixtures = [
    { hand: [0, 0, 2, 2, 3, 3, 5, 5, 6, 6, 8, 8, TILE.SOUTH], type: TILE.SOUTH },
    { hand: [0, 0, 0, 9, 9, 9, 18, 18, 18, TILE.SOUTH, TILE.SOUTH, TILE.SOUTH, 6], type: 6 },
    { hand: [1, 1, 1, 4, 4, 7, 7, 7, 7, 10, 10, 13, 16], type: 25 },
    { hand: [27, 27, 27, 28, 28, 29, 29, 29, 29, 30, 30, 32, 32], type: TILE.WHITE },
  ];
  for (const { hand, type } of fixtures) assert.deepEqual(waitFor(getTingHints({ hand }), type), { type, selfDraw: true, claim: true });
});

test('big hand eligibility includes real public group identities', () => {
  const hand = [1, 1, 1, 4, 4, 7, 7, 7, 7, 10];
  assert.equal(waitFor(getTingHints({ hand, melds: [peng(22)] }), 25).claim, true);
  assert.equal(waitFor(getTingHints({ hand, melds: [chi(groups[2])] }), 25), undefined);
  const triplets = [0, 0, 0, 9, 9, 9, 18, 18, 6, TILE.EAST];
  const options = { hand: triplets, wildTile: TILE.EAST, indicatorTile: TILE.WHITE };
  assert.equal(waitFor(getTingHints({ ...options, melds: [peng(TILE.NORTH)] }), TILE.EAST).claim, true);
  assert.equal(waitFor(getTingHints({ ...options, melds: [chi([21, 22, 23])] }), TILE.EAST), undefined);
});

test('red dragons and indicators must be declared, including selected special tiles', () => {
  for (const special of [TILE.RED, TILE.WHITE]) {
    const options = { hand: [...plainWait, special], indicatorTile: TILE.WHITE };
    assert.equal(getTingHints(options).status, 'special-gang');
    assert.equal(getTingHints(options, 13).status, 'special-gang');
    assert.equal(getTingHints(options, 0).status, 'special-gang');
    assert.deepEqual(getTingHints(options, 13).waits, []);
  }
  const honors = getTingHints({ hand: [27, 27, 27, 28, 28, 29, 29, 29, 29, 30, 30, 32, 32], indicatorTile: TILE.WHITE });
  assert.equal(waitFor(honors, TILE.RED), undefined);
  assert.equal(waitFor(honors, TILE.WHITE), undefined);
});

test('a red dragon wildcard cannot bypass its dedicated special-kong requirement', () => {
  const hints = getTingHints({ hand: plainWait, wildTile: TILE.RED, indicatorTile: TILE.NORTH });
  assert.equal(waitFor(hints, TILE.RED), undefined);
  assert.equal(getTingHints({ hand: [...plainWait.slice(0, -1), TILE.RED], wildTile: TILE.RED, indicatorTile: TILE.NORTH }).status, 'special-gang');
});

test('four known copies exclude dead waits and selected discarded tiles remain known', () => {
  const options = { hand: plainWait, visibleTiles: [4, 4, 4] };
  assert.deepEqual(getTingHints(options).waits, []);
  const selected = getTingHints({ hand: [...plainWait, 4], visibleTiles: [4, 4] }, 13);
  assert.deepEqual(selected.waits, [], 'the selected fourth copy stays public after the hypothetical discard');
  assert.equal(getTingHints({ hand: plainWait, visibleTiles: [4, 4, 4, 4] }).status, 'invalid');
});

test('own meld physical copies count once when also present in public tiles', () => {
  const hand = [0, 1, 2, 9, 10, 11, 18, 19, 20, 4];
  const melds = [peng(4)];
  assert.deepEqual(getTingHints({ hand, melds }).waits, []);
  const hints = getTingHints({ hand, melds, visibleTiles: [4, 4, 4] });
  assert.equal(hints.status, 'ready');
  assert.deepEqual(hints.waits, [], 'the own fourth copy is already concealed, so a fifth cannot be suggested');
});

test('invalid hand shapes, indices and malformed public input give no hints', () => {
  const fixtures = [
    [{ hand: [] }], [{ hand: [34] }], [{ hand: plainWait }, -2],
    [{ hand: plainWait }, 0], [{ hand: [...plainWait, 27] }, 14],
    [{ hand: [...plainWait, 27] }, 0.5], [{ hand: plainWait, wildTile: 34 }],
    [{ hand: plainWait, indicatorTile: -1 }], [{ hand: plainWait, visibleTiles: [null] }],
    [{ hand: plainWait, melds: [{ kind: 'chi', tiles: [0, 1] }] }],
  ];
  for (const [options, index] of fixtures) {
    const result = getTingHints(options, index);
    assert.equal(result.status, 'invalid');
    assert.deepEqual(result.waits, []);
  }
});

test('hints agree with authoritative self-draw and discard-claim actions for every candidate', () => {
  const fixtures = [
    { hand: plainWait },
    { hand: [...groups.slice(1).flat(), 4], melds: [chi(groups[0])] },
    { hand: [0, 0, 2, 2, 3, 3, 5, 5, 6, 6, 8, 8, TILE.SOUTH] },
    { hand: [9, 10, TILE.EAST, 18, 19, 20, 24, 25, 26, 4], melds: [gang(TILE.NORTH, true)], wildTile: TILE.EAST, indicatorTile: TILE.WHITE },
    { hand: [1, 1, 1, 4, 4, 7, 7, 7, 7, 10, 10, 13, 16] },
  ];
  for (const fixture of fixtures) {
    const hints = getTingHints(fixture);
    const game = new MahjongGame({ seed: 'ting-authoritative-actions', laizi: false });
    game.wildTile = fixture.wildTile ?? null;
    game.indicatorTile = fixture.indicatorTile ?? null;
    game.players[0].melds = fixture.melds ?? [];
    for (let type = 0; type < 34; type++) {
      const ownKnown = [...fixture.hand, ...(fixture.melds ?? []).flatMap(meld => meld.tiles)].filter(tile => tile === type).length;
      if (ownKnown >= 4) continue;
      game.players[0].hand = [...fixture.hand, type];
      game.current = 0;
      game.phase = { kind: 'discard', seat: 0 };
      game.lastDraw = { player: 0, tile: type, index: fixture.hand.length, replacement: false };
      assert.equal(Boolean(waitFor(hints, type)?.selfDraw), game.getActions(0).hu, `self-draw ${type}`);
      game.players[0].hand = [...fixture.hand];
      game.current = 3;
      game.pendingDiscard = { tile: type, from: 3 };
      game.phase = { kind: 'claim', discard: game.pendingDiscard };
      game._responses = Array(4).fill(null);
      assert.equal(Boolean(waitFor(hints, type)?.claim), game.getActions(0).hu, `claim ${type}`);
    }
  }
});

test('hint calculation records actual latency without consulting hidden state', t => {
  const fixtures = [
    { hand: plainWait },
    { hand: [0, 0, 2, 2, 3, 3, 5, 5, 6, 6, 8, 8, TILE.SOUTH] },
    { hand: [0, 1, 3, 7, 9, 10, 11, 15, 18, 20, 24, TILE.EAST, TILE.EAST], wildTile: TILE.EAST, indicatorTile: TILE.WHITE },
  ];
  const durations = [];
  for (let run = 0; run < 120; run++) {
    const start = performance.now();
    getTingHints(fixtures[run % fixtures.length]);
    durations.push(performance.now() - start);
  }
  durations.sort((left, right) => left - right);
  t.diagnostic(`120 calls: median ${durations[60].toFixed(3)} ms; p95 ${durations[114].toFixed(3)} ms; max ${durations.at(-1).toFixed(3)} ms`);
  const input = { ...fixtures[2], visibleTiles: [TILE.WHITE] };
  const before = structuredClone(input);
  getTingHints(input);
  assert.deepEqual(input, before);
});
