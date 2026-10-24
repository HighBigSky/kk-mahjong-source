import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as before from './fixtures/engine-before-domain.js';
import { legacyWallOracle, authorizedWallChanges, expectedBaselineHash } from './legacy-wall-oracle.mjs';

const baselineOnly = process.env.MAHJONG_BASELINE_ONLY === '1';
const beforePath = new URL('./fixtures/engine-before-domain.js', import.meta.url);

const hash = value => createHash('sha256').update(value).digest('hex');
const phaseKind = game => typeof game.phase === 'string' ? game.phase : game.phase.kind;

/** The exact pre-refactor seeded PRNG, extracted unchanged for action sampling. */
function makeRandom(seed) {
  let state = 2166136261;
  for (const letter of String(seed)) state = Math.imul(state ^ letter.charCodeAt(0), 16777619);
  if (!state) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** Count physical owners only: pendingDiscard, lastDraw, result.hand are references. */
function physicalTiles(game) {
  return [
    ...game.wall,
    ...game.players.flatMap(player => [
      ...player.hand, ...player.discards, ...player.redGangs, ...(player.piziGangs ?? []),
      ...player.melds.flatMap(meld => meld.tiles),
    ]),
    ...(game.indicatorTile === null || game.indicatorTaken ? [] : [game.indicatorTile]),
  ];
}

function assertPhysicalConservation(game) {
  const tiles = physicalTiles(game);
  assert.equal(tiles.length, 136, 'exactly 136 physical tiles are owned');
  const counts = Array(34).fill(0);
  for (const tile of tiles) {
    assert.ok(Number.isInteger(tile) && tile >= 0 && tile < 34, 'valid physical tile');
    assert.ok(++counts[tile] <= 4, `tile ${tile} has at most four copies`);
  }
  assert.deepEqual(counts, Array(34).fill(4));
  assert.equal(game.players.reduce((sum, player) => sum + player.score, 0), 4000);
}

function observableState(game) {
  return {
    round: game.round, dealer: game.dealer, current: game.current,
    phase: phaseKind(game), wall: game.wall, wallInfo: game.wallInfo, players: game.players,
    laiziEnabled: game.laiziEnabled, indicatorTile: game.indicatorTile, wildTile: game.wildTile,
    indicatorTaken:game.indicatorTaken === true, indicatorTakenBy:game.indicatorTakenBy ?? null,
    pendingDiscard: game.pendingDiscard, lastDraw: game.lastDraw,
    winner: game.winner, result: game.result,
  };
}

function assertEquivalent(oldGame, newGame, context) {
  // Compare the actual serialized text at every step, including the 80-entry rolling log.
  assert.equal(JSON.stringify(newGame.events), JSON.stringify(oldGame.events), `${context}: events bytes`);
  assert.deepEqual(observableState(newGame), observableState(oldGame), `${context}: observable state`);
  assertPhysicalConservation(oldGame);
  assertPhysicalConservation(newGame);
}

function legalActions(game) {
  const phase = phaseKind(game);
  if (phase === 'ended') return [];
  const choices = [];
  const seats = phase === 'claim' ? [0, 1, 2, 3] : [game.current];
  for (const player of seats) {
    const available = game.getActions(player);
    if (available.hu) choices.push({ kind: 'hu', player, selfDraw: phase === 'discard' });
    if (available.redGang) choices.push({ kind: 'redGang', player });
    if (available.piziGang) choices.push({ kind: 'piziGang', player });
    for (const tile of available.concealedGangs) choices.push({ kind: 'gang', player, tile, mode: 'concealed' });
    for (const tile of available.addedGangs) choices.push({ kind: 'gang', player, tile, mode: 'added' });
    if (available.gang) choices.push({ kind: 'gang', player, tile: game.pendingDiscard.tile, mode: 'exposed' });
    if (available.peng) choices.push({ kind: 'peng', player });
    for (const sequence of available.chi) choices.push({ kind: 'chi', player, sequence: [...sequence] });
    if (available.pass) choices.push({ kind: 'pass', player });
    if (phase === 'discard') {
      game.players[player].hand.forEach((tile, index) => {
        if (tile !== 31 && tile !== game.indicatorTile) choices.push({ kind: 'discard', player, index });
      });
    }
  }
  return choices;
}

function chooseRandomAction(game, random) {
  const actions = legalActions(game);
  assert.ok(actions.length, `no legal action in ${phaseKind(game)}`);
  const wins = actions.filter(action => action.kind === 'hu');
  if (wins.length) return wins[Math.floor(random() * wins.length)];
  const special = actions.filter(action => ['redGang', 'piziGang', 'gang'].includes(action.kind));
  if (special.length && random() < 0.75) return special[Math.floor(random() * special.length)];
  return actions[Math.floor(random() * actions.length)];
}

/** Execute the same typed command against the frozen old public API. */
function executeOld(game, action) {
  switch (action.kind) {
    case 'discard': return game.discard(action.player, action.index);
    case 'pass': return game.pass(action.player);
    case 'chi': return game.claim(action.player, 'chi', action.sequence);
    case 'gang': return game.claim(action.player,
      { exposed: 'gang', concealed: 'concealedGang', added: 'addedGang' }[action.mode], action.tile);
    default: return game.claim(action.player, action.kind);
  }
}

function recordAction(report, action) {
  const key = action.kind === 'gang' ? `gang:${action.mode}` : action.kind;
  report.actions[key] = (report.actions[key] ?? 0) + 1;
}

function playRandomPair(oldGame, newGame, random, checkInvariants, report, seed) {
  const transcript = createHash('sha256');
  let steps = 0;
  assertEquivalent(oldGame, newGame, `${seed}: deal`);
  checkInvariants(newGame);
  while (phaseKind(oldGame) !== 'ended') {
    assert.ok(steps < 1000, `${seed}: the round must finish`);
    const action = chooseRandomAction(oldGame, random);
    const previousPhase = structuredClone(newGame.phase);
    assert.equal(executeOld(oldGame, action), true, `${seed}: old legal action ${JSON.stringify(action)}`);
    const executed = baselineOnly ? executeOld(newGame, action) : newGame.applyAction(action.player, action);
    assert.equal(executed, true, `${seed}: new legal action ${JSON.stringify(action)}`);
    assertEquivalent(oldGame, newGame, `${seed}: step ${steps}`);
    checkInvariants(newGame, previousPhase);
    transcript.update(JSON.stringify(newGame.events));
    transcript.update('\n');
    recordAction(report, action);
    steps++;
  }
  assert.deepEqual(newGame.players.map(player => player.score), oldGame.players.map(player => player.score));
  assert.deepEqual(newGame.result, oldGame.result);
  report.steps += steps;
  report.results[oldGame.result.kind]++;
  const entry = {
    seed, steps, laizi: oldGame.laiziEnabled, round: oldGame.round, dealer: oldGame.dealer,
    result: oldGame.result.kind, scores: newGame.players.map(player => player.score),
    indicatorTaken:newGame.indicatorTaken === true,
    indicatorTakenBy:newGame.indicatorTakenBy ?? null,
    oldEventsSha256: hash(JSON.stringify(oldGame.events)),
    newEventsSha256: hash(JSON.stringify(newGame.events)),
    stepLogsSha256: transcript.digest('hex'),
  };
  report.rounds.push(entry);
}

/** AI calls are also compared, so the typed compatibility adapter stays covered. */
function playAIPair(oldGame, newGame, checkInvariants, report, seed) {
  let steps = 0;
  assertEquivalent(oldGame, newGame, `${seed}: AI deal`);
  checkInvariants(newGame);
  while (phaseKind(oldGame) !== 'ended') {
    assert.ok(steps < 1500, `${seed}: AI round must finish`);
    const previousPhase = structuredClone(newGame.phase);
    const available = oldGame.getActions(0);
    let oldResult;
    let newResult;
    if (phaseKind(oldGame) === 'claim' && available.pass) {
      const action = available.hu ? { kind: 'hu', player: 0, selfDraw: false } : { kind: 'pass', player: 0 };
      oldResult = executeOld(oldGame, action);
      newResult = baselineOnly ? executeOld(newGame, action) : newGame.applyAction(0, action);
      recordAction(report, action);
    } else if (phaseKind(oldGame) === 'discard' && oldGame.current === 0) {
      let action;
      if (available.hu) action = { kind: 'hu', player: 0, selfDraw: true };
      else if (available.redGang) action = { kind: 'redGang', player: 0 };
      else if (available.piziGang) action = { kind: 'piziGang', player: 0 };
      else action = {
        kind: 'discard', player: 0,
        index: (baselineOnly ? before : legacyWallOracle).chooseDiscard(oldGame.players[0].hand, oldGame.players[0].melds, [], oldGame.wildTile, oldGame.indicatorTile),
      };
      oldResult = executeOld(oldGame, action);
      newResult = baselineOnly ? executeOld(newGame, action) : newGame.applyAction(0, action);
      recordAction(report, action);
    } else {
      oldResult = oldGame.advanceAI();
      newResult = newGame.advanceAI();
      report.aiCalls++;
    }
    assert.equal(oldResult, true, `${seed}: AI old progress`);
    assert.equal(newResult, true, `${seed}: AI new progress`);
    assertEquivalent(oldGame, newGame, `${seed}: AI step ${steps}`);
    checkInvariants(newGame, previousPhase);
    steps++;
  }
  report.aiSteps += steps;
}

function assertNegativeCases(NewGame, checkInvariants) {
  const missing = new NewGame({ seed: 'negative-missing' });
  missing.wall.pop();
  assert.throws(() => checkInvariants(missing), /./, 'lost physical tile must fail');

  const copies = new NewGame({ seed: 'negative-five-copies' });
  const removed = copies.wall[0];
  copies.wall[0] = (removed + 1) % 34;
  assert.throws(() => checkInvariants(copies), /./, 'five copies must fail even with total 136');

  const redWinner = new NewGame({ seed: 'negative-red-winner' });
  if (!redWinner.players[0].hand.includes(31)) {
    const index = redWinner.wall.indexOf(31);
    assert.ok(index >= 0);
    [redWinner.players[0].hand[0], redWinner.wall[index]] = [redWinner.wall[index], redWinner.players[0].hand[0]];
  }
  redWinner.winner = 0;
  redWinner.result = { kind: 'win', winner: 0 };
  redWinner.phase = { kind: 'ended', result: redWinner.result };
  assertPhysicalConservation(redWinner);
  assert.throws(() => checkInvariants(redWinner), /./, 'red dragon in winning concealed hand must fail');

  const transition = new NewGame({ seed: 'negative-phase' });
  assert.throws(() => checkInvariants(transition, { kind: 'ended', result: { kind: 'draw' } }), /./,
    'ended -> discard without a deal boundary must fail');
}

export async function runDomainRegression({ writeReport = true } = {}) {
  const source = await readFile(beforePath);
  assert.equal(hash(source), expectedBaselineHash, 'frozen pre-refactor engine must never change');
  const current = baselineOnly ? before : await import('../engine.js');
  const oracle = baselineOnly ? before : legacyWallOracle;
  const actionRandom = baselineOnly ? makeRandom : current.makeRandom;
  assert.equal(typeof actionRandom, 'function', 'reuse the engine seeded PRNG');
  if (!baselineOnly) {
    const originalRandom = makeRandom('domain-random-algorithm-proof');
    const domainRandom = actionRandom('domain-random-algorithm-proof');
    for (let index = 0; index < 1000; index++) assert.equal(domainRandom(), originalRandom(), 'seeded PRNG unchanged');
  }
  const checkInvariants = baselineOnly ? assertPhysicalConservation
    : (await import('../src/domain/invariants.js')).assertInvariants;
  const report = {
    mode: baselineOnly ? 'baseline-old-vs-old' : 'authorized-rules-adapted-frozen-oracle-vs-domain',
    authorizedOracleChanges: baselineOnly ? [] : [...authorizedWallChanges],
    baselineSha256: expectedBaselineHash,
    randomRounds: 200, aiRounds: 8, steps: 0, aiSteps: 0, aiCalls: 0,
    results: { win: 0, draw: 0 }, actions: {}, rounds: [], failures: [],
  };
  for (const laizi of [false, true]) {
    const series = laizi ? 'wild' : 'normal';
    const oldGame = new oracle.MahjongGame({ seed: `domain-${series}-0`, laizi });
    const newGame = new current.MahjongGame({ seed: `domain-${series}-0`, laizi });
    for (let round = 0; round < 100; round++) {
      const originalSeed = `domain-${series}-${round}`;
      if (round > 0) {
        const options = { restart: round % 9 === 0, laizi };
        oldGame.newRound(originalSeed, options);
        newGame.newRound(originalSeed, options);
      }
      const seed = originalSeed;
      playRandomPair(oldGame, newGame, actionRandom(`${seed}:actions`), checkInvariants, report, seed);
    }
  }
  for (let round = 0; round < 8; round++) {
    const seed = `domain-ai-${round}`;
    const options = { seed, laizi: round >= 4 };
    playAIPair(new oracle.MahjongGame(options), new current.MahjongGame(options), checkInvariants, report, seed);
  }
  if (!baselineOnly) assert.ok(report.rounds.some(round=>round.indicatorTaken), 'original random seeds exercise the exposed physical indicator transfer');
  if (!baselineOnly) {
    // Closed ordinary hands no longer claim discards, so the unchanged original
    // seeds need not include a human Hu. Add a separately reported real deal;
    // never replace an original seed or fabricate tiles to meet coverage.
    const seed = 'domain-closed-self-draw-coverage-8';
    const oldGame = new oracle.MahjongGame({ seed });
    const newGame = new current.MahjongGame({ seed });
    const coverage = {
      scenario: 'closed-ordinary-self-draw', seed, constructed: false,
      aiSteps: 0, aiCalls: 0, actions: {},
    };
    playAIPair(oldGame, newGame, checkInvariants, coverage, seed);
    assert.equal(coverage.actions.hu, 1, 'the supplemental real deal must exercise an explicit legal Hu');
    assert.equal(newGame.result.kind, 'win');
    assert.equal(newGame.result.winner, 0);
    assert.equal(newGame.result.selfDraw, true, 'the closed hand must win by self draw');
    assert.equal(newGame.players[0].melds.length, 0, 'the supplemental winner has not opened');
    assert.deepEqual(newGame.result.hand, [1, 2, 3, 5, 5, 6, 6, 7, 7, 14, 15, 16, 19, 19],
      'the real dealt hand is the documented ordinary shape, rather than a big-hand exemption');
    report.supplementalCoverage = [{
      ...coverage, winner: newGame.result.winner, selfDraw: newGame.result.selfDraw,
      scores: newGame.players.map(player => player.score),
      oldEventsSha256: hash(JSON.stringify(oldGame.events)),
      newEventsSha256: hash(JSON.stringify(newGame.events)),
    }];
    assertNegativeCases(current.MahjongGame, checkInvariants);
    report.negativeCases = ['lost-tile', 'five-copies', 'red-winning-hand', 'illegal-phase-transition'];
  }
  for (const kind of ['discard', 'chi', 'peng', 'gang:exposed', 'gang:concealed', 'gang:added', 'redGang', ...(!baselineOnly ? ['piziGang'] : []), 'hu', 'pass']) {
    const supplemental = (report.supplementalCoverage ?? [])
      .reduce((total, coverage) => total + (coverage.actions[kind] ?? 0), 0);
    assert.ok((report.actions[kind] ?? 0) + supplemental > 0, `original or explicitly supplemental samples must exercise ${kind}`);
  }
  if (writeReport) {
    const output = new URL('../output/', import.meta.url);
    await mkdir(output, { recursive: true });
    await writeFile(new URL('domain-invariants-report.json', output), JSON.stringify(report, null, 2) + '\n');
    if (baselineOnly) await writeFile(new URL('domain-invariants-baseline-report.json', output), JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runDomainRegression();
  console.log(`PASS ${report.mode}: ${report.randomRounds} seeded rounds against the explicitly rule-adapted frozen oracle, ${report.steps} random steps; ${report.aiRounds} AI rounds, ${report.aiSteps} AI steps.`);
  console.log(`Authorized test-only oracle changes (no seed substitutions): ${JSON.stringify(report.authorizedOracleChanges)}`);
  console.log(`Action coverage: ${JSON.stringify(report.actions)}`);
  if (report.supplementalCoverage) console.log(`Separate supplemental coverage (original seeds unchanged): ${JSON.stringify(report.supplementalCoverage)}`);
  console.log(`Result coverage: ${JSON.stringify(report.results)}`);
  console.log(`Every step: 136 physical tiles, at most 4 copies, identical events bytes, scores and physical state.`);
  console.log(`Sample logs SHA256: ${JSON.stringify(report.rounds[0])}`);
  console.log('Report: output/domain-invariants-report.json');
}
