import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TILE, SUIT, TILE_TYPE_COUNT, isTileCode, isNumbered, suitOf, rankOf, tileCode,
} from '../src/domain/tile.js';
import { tileName, tileSuit, nextWildTile } from '../engine.js';
import * as before from './fixtures/engine-before-domain.js';

test('tile and suit constants are frozen public contracts', () => {
  assert.ok(Object.isFrozen(TILE));
  assert.ok(Object.isFrozen(SUIT));
  assert.throws(() => { TILE.RED = TILE.WHITE; }, TypeError);
  assert.throws(() => { SUIT.MAN = 'other'; }, TypeError);
});

test('every physical tile encoding roundtrips through its suit and one-based rank', () => {
  const encodings = new Set();
  for (let code = TILE.MAN; code < TILE_TYPE_COUNT; code++) {
    assert.ok(isTileCode(code), `legal tile ${code}`);
    const restored = tileCode(suitOf(code), rankOf(code));
    assert.equal(restored, code, `roundtrip tile ${code}`);
    encodings.add(restored);
  }
  assert.equal(encodings.size, TILE_TYPE_COUNT);
});

test('suit boundaries keep one-based ranks and honors in their own cycle', () => {
  const boundaries = [
    [TILE.MAN, SUIT.MAN, 1, true], [TILE.PIN - 1, SUIT.MAN, 9, true],
    [TILE.PIN, SUIT.PIN, 1, true], [TILE.SOU - 1, SUIT.PIN, 9, true],
    [TILE.SOU, SUIT.SOU, 1, true], [TILE.EAST - 1, SUIT.SOU, 9, true],
    [TILE.EAST, SUIT.HONOR, 1, false], [TILE.RED, SUIT.HONOR, 5, false],
    [TILE.GREEN, SUIT.HONOR, 6, false], [TILE.WHITE, SUIT.HONOR, 7, false],
  ];
  for (const [code, suit, rank, numbered] of boundaries) {
    assert.equal(suitOf(code), suit);
    assert.equal(rankOf(code), rank);
    assert.equal(isNumbered(code), numbered);
    assert.equal(tileCode(suit, rank), code);
  }
});

test('invalid codes and suit-rank combinations cannot enter the tile domain', () => {
  for (const code of [-1, TILE_TYPE_COUNT, 1.5, NaN, Infinity, -Infinity, null, undefined, '1', true, {}, []]) {
    assert.equal(isTileCode(code), false, `reject ${String(code)}`);
  }
  for (const [suit, rank] of [
    [SUIT.MAN, 0], [SUIT.PIN, 10], [SUIT.SOU, 1.5], [SUIT.HONOR, 8],
    [SUIT.MAN, NaN], ['unknown', 1], ['toString', 1], ['constructor', 1], ['__proto__', 1],
  ]) {
    assert.throws(() => tileCode(suit, rank), RangeError, `reject ${suit} rank ${rank}`);
  }
});

test('all legacy tile names, suit labels and wild cycles match the frozen pre-migration engine', () => {
  for (let code = TILE.MAN; code < TILE_TYPE_COUNT; code++) {
    assert.equal(tileName(code), before.tileName(code), `name ${code}`);
    assert.equal(tileSuit(code), before.tileSuit(code), `legacy suit ${code}`);
    assert.equal(nextWildTile(code), before.nextWildTile(code), `wild cycle ${code}`);
  }
  for (const code of [-10, -1, 0.5, 26.5, 33.5, TILE_TYPE_COUNT, NaN, Infinity, null, undefined, '9']) {
    assert.equal(tileName(code), before.tileName(code), `invalid name ${String(code)}`);
    assert.equal(tileSuit(code), before.tileSuit(code), `invalid legacy suit ${String(code)}`);
    assert.equal(nextWildTile(code), before.nextWildTile(code), `invalid wild ${String(code)}`);
  }
});
