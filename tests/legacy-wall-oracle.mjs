import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const expectedBaselineHash = '56093a20c2c02563463d7202dda9615c6c219f8423e771ea95b9d0e5cea57111';
export const authorizedWallChanges = Object.freeze([
  'Independent seeded dice choose the upper tile of the smaller-die stack from the wall tail.',
  'A red or north candidate swaps with a physical white dragon at that position; green becomes wild.',
  'Every kong replacement draws from the wall tail; ordinary draws still use the wall head.',
  'Held indicator copies follow red-dragon single-tile kong rules: optional declaration, no discard or concealed win, no ordinary meld use, no normal meld slot, and a tail supplement.',
  '2026-10-24 authorized wall rule: the exposed physical indicator enters the drawing hand when the head or tail reaches its slot, without reducing the concealed-wall count; the indicator face type remains fixed.',
  'Ordinary four-group wins and their AI estimates require a same-code numbered 2/5/8 pair; seven pairs is exempt, and wildcards may supply one or both tiles of the required pair.',
  'Seven pairs, all triplets, all numbered 2/5/8 tiles, and all honors are big wins with unrestricted pair and wildcard count; all-258/all-honor wins need the valid hand size but no group decomposition.',
  'Only ordinary wins after chi, peng, exposed or added kong are limited to one concealed wildcard; concealed and single-tile special kongs do not open the hand.',
  '2026-10-23 authorized exception: only a matching wall-tail replacement self draw waives the opened ordinary wildcard cap; ordinary draw and claim restrictions, shape and scoring remain unchanged.',
  'An ordinary hand without chi, peng, exposed or added kong may win only by self draw; seven pairs, all triplets, all numbered 2/5/8 tiles, and all honors may still claim a winning discard while closed.',
  'AI and hints evaluate actual public groups, all four big-win distances, and legal ready draws; held red/indicator tiles are never ready. The frozen natural-shape scoring gate and all scoring values stay unchanged.',
  '2026-10-27 authorized AI-only policy: never discard a wildcard, including after opening, multiple wildcards, and replacement draws; no ordinary candidate ends the AI turn as a drawn round. Human discard legality is unchanged.',
  '2026-10-20 authorized scoring: single red/indicator gangs charge each other player 10 immediately; replacement self-draw adds 10; ordinary discard wins charge one player one share, big wins charge all three; drawn rounds retain gang deltas.',
  '2026-10-21 authorized claim restriction: wild tiles cannot be claimed by chi/peng or consumed as concealed chi partners; red and indicator claim restrictions stay in force.',
]);

const bytes = await readFile(new URL('./fixtures/engine-before-domain.js', import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedBaselineHash,
  'the frozen pre-domain engine must remain byte-for-byte unchanged');
let source = bytes.toString('utf8').replace(/\r\n/g, '\n');
const frozenWinningStart = source.indexOf('export function isWinning(');
const frozenWinningEnd = source.indexOf('\n// Red dragons are dedicated', frozenWinningStart);
const frozenWinning = source.slice(frozenWinningStart, frozenWinningEnd);
assert.ok(frozenWinningStart > 0 && frozenWinningEnd > frozenWinningStart, 'frozen pure winning search has exact boundaries');
const frozenDistanceStart = source.indexOf('export function calculateShanten(');
const frozenDistanceEnd = source.indexOf('\nfunction handShape(', frozenDistanceStart);
const frozenDistance = source.slice(frozenDistanceStart, frozenDistanceEnd);
assert.ok(frozenDistanceStart > 0 && frozenDistanceEnd > frozenDistanceStart, 'frozen AI distance has exact boundaries');

// This oracle retains the frozen rules, AI and scoring. Only the expressly
// authorized rule changes above are adapted, entirely inside the test process.
// Exact single-match anchors make unrelated baseline edits fail loudly.
function replaceOnce(before, after, label) {
  assert.equal(source.split(before).length - 1, 1, `${label}: exactly one frozen source anchor`);
  source = source.replace(before, after);
}

replaceOnce(
  '    this._random = makeRandom(options.seed ?? `${Date.now()}-${Math.random()}`);',
  '    const initialSeed = options.seed ?? `${Date.now()}-${Math.random()}`;\n' +
  '    this._random = makeRandom(initialSeed);\n' +
  '    this._diceRandom = makeRandom(`dice:${String(initialSeed)}`);',
  'independent constructor dice seed',
);
replaceOnce(
  '    if (seed !== undefined) this._random = makeRandom(seed);',
  '    if (seed !== undefined) {\n' +
  '      this._random = makeRandom(seed);\n' +
  '      this._diceRandom = makeRandom(`dice:${String(seed)}`);\n' +
  '    }',
  'explicit redeal dice seed',
);
replaceOnce(
  '    this.laiziEnabled = Boolean(laizi);',
  '    const dice = [1 + Math.floor(this._diceRandom() * 6), 1 + Math.floor(this._diceRandom() * 6)];\n' +
  '    this.wallInfo = { dice, indicatorPosition: null, tailDraws: 0 };\n' +
  '    this.laiziEnabled = Boolean(laizi);',
  'dice after unchanged shuffle',
);
replaceOnce(
  `    if (this.laiziEnabled) {
      const candidate = this.wall.pop();
      if (nextWildTile(candidate) === 31) {
        // A red-dragon wildcard conflicts with its special kong role. This
        // table instead exposes a real white dragon and uses green as wild.
        this.wall.push(candidate);
        this.indicatorTile = this.wall.splice(this.wall.lastIndexOf(33), 1)[0];
        this.wildTile = 32;
      } else {
        this.indicatorTile = candidate;
        this.wildTile = nextWildTile(candidate);
      }
    }`,
  `    if (this.laiziEnabled) {
      const position = (Math.min(...dice) - 1) * 2;
      this.wallInfo.indicatorPosition = position;
      const candidate = this.wall[position];
      if (candidate === 31 || nextWildTile(candidate) === 31) {
        const whitePosition = this.wall.lastIndexOf(33);
        [this.wall[position], this.wall[whitePosition]] = [this.wall[whitePosition], this.wall[position]];
        this.indicatorTile = this.wall.splice(position, 1)[0];
        this.wildTile = 32;
      } else {
        this.indicatorTile = this.wall.splice(position, 1)[0];
        this.wildTile = nextWildTile(candidate);
      }
    }`,
  'tail stack indicator and physical white swap',
);
replaceOnce(
  '    const tile = this.wall.pop();',
  '    const tile = replacement ? this.wall.shift() : this.wall.pop();\n' +
  '    if (replacement) this.wallInfo.tailDraws++;',
  'kong replacement direction',
);

// The frozen file stays untouched. This explicit test-only extension mirrors
// the newly authorized indicator and win rules. Scoring keeps the old shape
// search, and no production winning or AI implementation is imported.
function replaceChecked(before, after, expected, label) {
  assert.equal(source.split(before).length - 1, expected, `${label}: exact frozen source anchors`);
  source = source.split(before).join(after);
}

replaceOnce('export function isWinning(hand, meldCount = 0, wildTile = null) {',
  'export function isWinning(hand, meldCount = 0, wildTile = null, indicatorTile = null) {\n' +
  '  if (indicatorTile !== null && Array.isArray(hand) && hand.includes(indicatorTile)) return false;',
  'optional indicator-aware win evaluation');
replaceOnce('function canWin(hand, meldCount, wildTile) {\n  return !hand.includes(31) && isWinning(hand, meldCount, wildTile);',
  'function canWin(hand, meldCount, wildTile, indicatorTile) {\n' +
  '  return !hand.includes(31) && !hand.includes(indicatorTile) && isWinning(hand, meldCount, wildTile, indicatorTile);',
  'concealed special tiles prevent actual wins');
replaceOnce('export function calculateShanten(hand, meldCount = 0, wildTile = null) {',
  'export function calculateShanten(hand, meldCount = 0, wildTile = null, indicatorTile = null) {\n' +
  '  if (indicatorTile !== null && Array.isArray(hand) && hand.includes(indicatorTile)) return 8;',
  'indicator-aware ready-hand estimate');
replaceOnce('export function chooseDiscard(hand, melds = [], visible = [], wildTile = null) {',
  'export function chooseDiscard(hand, melds = [], visible = [], wildTile = null, indicatorTile = null) {',
  'indicator-aware hint API');
replaceOnce('hand.some(tile => tile !== 31 && tile !== wildTile)',
  'hand.some(tile => tile !== 31 && tile !== indicatorTile && tile !== wildTile)', 'legal alternative for wild discard');
replaceOnce('    if (tile === 31) continue;', '    if (tile === 31 || tile === indicatorTile) continue;', 'never hint an indicator discard');
replaceOnce('calculateShanten(remaining, meldCount, wildTile);',
  'calculateShanten(remaining, meldCount, wildTile, indicatorTile);', 'hint indicator estimate');
replaceOnce('hand: [], melds: [], redGangs: [], discards: [], score: 1000,',
  'hand: [], melds: [], redGangs: [], piziGangs: [], discards: [], score: 1000,', 'own physical indicator kongs');
replaceOnce('player.hand = []; player.melds = []; player.redGangs = []; player.discards = [];',
  'player.hand = []; player.melds = []; player.redGangs = []; player.piziGangs = []; player.discards = [];', 'reset indicator kongs');
replaceOnce('redGang: false, chi: []', 'redGang: false, piziGang: false, chi: []', 'indicator kong availability');
replaceOnce('    if (tile === 31) return actions;',
  '    if (tile === 31 || tile === this.indicatorTile) return actions;', 'no claims on injected indicator discard');
replaceOnce('canWin([...seat.hand, tile], seat.melds.length, this.wildTile)',
  'canWin([...seat.hand, tile], seat.melds.length, this.wildTile, this.indicatorTile)', 'claim win special restriction');
replaceOnce('if (needed.every(value => counts[value] > 0)) actions.chi.push(sequence);',
  'if (!sequence.includes(this.indicatorTile) && !sequence.includes(this.wildTile) && needed.every(value => counts[value] > 0)) actions.chi.push(sequence);', 'chi cannot use indicator or wild faces');
replaceOnce('actions.peng = counts[tile] >= 2;',
  'actions.peng = tile !== this.wildTile && counts[tile] >= 2;', 'wild cannot be claimed by peng');
replaceOnce('canWin(seat.hand, seat.melds.length, this.wildTile)',
  'canWin(seat.hand, seat.melds.length, this.wildTile, this.indicatorTile)', 'self-draw win special restriction');
replaceOnce('      actions.redGang = counts[31] > 0;',
  '      actions.redGang = counts[31] > 0;\n      actions.piziGang = this.indicatorTile !== null && counts[this.indicatorTile] > 0;',
  'indicator single-tile kong availability');
replaceOnce('count === 4 && tile !== 31 ? [tile] : []',
  'count === 4 && tile !== 31 && tile !== this.indicatorTile ? [tile] : []', 'indicator is never an ordinary concealed kong');
replaceOnce("meld.kind === 'peng' && meld.tiles[0] !== 31 && counts[meld.tiles[0]] > 0",
  "meld.kind === 'peng' && meld.tiles[0] !== 31 && meld.tiles[0] !== this.indicatorTile && counts[meld.tiles[0]] > 0",
  'indicator is never an ordinary added kong');
replaceOnce('    if (seat.hand[index] === 31) return false;',
  '    if (seat.hand[index] === 31 || seat.hand[index] === this.indicatorTile) return false;', 'indicator discard rejected');
replaceOnce("      if (action === 'concealedGang' || action === 'addedGang') {",
  "      if (action === 'piziGang' && actions.piziGang) {\n" +
  '        const seat = this.players[player];\n' +
  '        removeTiles(seat.hand, [this.indicatorTile]);\n' +
  '        seat.piziGangs.push(this.indicatorTile);\n' +
  '        this.lastDraw = null;\n' +
  '        this._log(`${seat.name}皮子杠${tileName(this.indicatorTile)}，补摸一张牌。`);\n' +
  '        this._drawTile(player, true);\n' +
  '        return true;\n' +
  '      }\n' +
  "      if (action === 'concealedGang' || action === 'addedGang') {", 'declare one real indicator tile');
replaceChecked('hand.every(value => value === 31)',
  'hand.every(value => value === 31 || value === this.indicatorTile)', 2, 'only undeclarable specials at empty wall');
replaceChecked("this._finishDraw('牌墙已空，红中无法补杠，本局流局');",
  "this._finishDraw(this.players[this.current].hand.includes(this.indicatorTile) ? '牌墙已空，红中或皮子无法补杠，本局流局' : '牌墙已空，红中无法补杠，本局流局');",
  3, 'empty-wall reason names the held special');
replaceOnce('...player.discards, ...player.redGangs, ...player.melds.flatMap(meld => meld.tiles)',
  '...player.discards, ...player.redGangs, ...player.piziGangs, ...player.melds.flatMap(meld => meld.tiles)', 'public indicator tiles affect AI visibility');
replaceOnce('calculateShanten(seat.hand, seat.melds.length, this.wildTile);',
  'calculateShanten(seat.hand, seat.melds.length, this.wildTile, this.indicatorTile);', 'bot claim before estimate');
replaceOnce('calculateShanten(remaining, melds.length, this.wildTile);',
  'calculateShanten(remaining, melds.length, this.wildTile, this.indicatorTile);', 'bot claim after estimate');
replaceChecked('this._visibleTiles(), this.wildTile);',
  'this._visibleTiles(), this.wildTile, this.indicatorTile);', 2, 'bot discard special restriction');
replaceOnce("    if (actions.redGang) return this.claim(player, 'redGang');",
  "    if (actions.redGang) return this.claim(player, 'redGang');\n    if (actions.piziGang) return this.claim(player, 'piziGang');", 'bot clears red then indicator');

// Preserve the frozen any-pair gate used solely by its original scoring code.
// The new legal-win classifier below delegates decomposition to an independent
// adaptation of the frozen search, rather than to production domain helpers.
const legacyScoringShape = frozenWinning.replace('export function isWinning(', 'function legacyScoringShape(');
const groupedShape = frozenWinning
  .replace('export function isWinning(hand, meldCount = 0, wildTile = null)',
    'function oracleGroupShape(hand, meldCount = 0, wildTile = null, jiangOnly = false, tripletsOnly = false)')
  .replace('  if (meldCount === 0 && counts.reduce((odd, count) => odd + count % 2, 0) <= wilds) return true;', '')
  .replace('    if (!matched && first < 27) {', '    if (!matched && !tripletsOnly && first < 27) {')
  .replace('    if (!counts[pair]) continue;',
    '    if (!counts[pair] || (jiangOnly && (pair >= 27 || ![1, 4, 7].includes(pair % 9)))) continue;');

function oracleMeldContext(melds) {
  if (typeof melds === 'number') return {
    valid: Number.isInteger(melds) && melds >= 0 && melds <= 4,
    count: melds, known: melds === 0, opened: melds > 0, groups: [],
  };
  if (!Array.isArray(melds) || melds.length > 4) return { valid: false };
  const valid = melds.every(meld => meld && ['chi', 'peng', 'gang'].includes(meld.kind) &&
    Array.isArray(meld.tiles) && meld.tiles.length === (meld.kind === 'gang' ? 4 : 3) &&
    meld.tiles.every(tile => Number.isInteger(tile) && tile >= 0 && tile < 34));
  return { valid, count: melds.length, known: true,
    opened: melds.some(meld => meld.kind !== 'gang' || meld.concealed !== true), groups: melds };
}

function oracleClassifyWin(hand, melds = 0, wildTile = null, indicatorTile = null, replacement = false) {
  const ctx = oracleMeldContext(melds);
  const no = { winning: false, ordinary: false, sevenPairs: false, allTriplets: false,
    allJiang: false, allHonors: false, opened: Boolean(ctx.opened), wildCount: 0 };
  if (!ctx.valid || !Array.isArray(hand) || hand.length !== (4 - ctx.count) * 3 + 2 ||
    (wildTile !== null && !validTile(wildTile)) ||
    (indicatorTile !== null && (!validTile(indicatorTile) || hand.includes(indicatorTile)))) return no;
  const counts = countsOf(hand);
  if (!counts) return no;
  const wildCount = wildTile === null ? 0 : counts[wildTile];
  if (wildTile !== null) counts[wildTile] = 0;
  const natural = hand.filter(tile => tile !== wildTile);
  const exposed = ctx.groups.flatMap(meld => meld.tiles);
  const jiang = tile => tile < 27 && [1, 4, 7].includes(tile % 9);
  const sevenPairs = ctx.count === 0 && counts.reduce((total, count) => total + count % 2, 0) <= wildCount;
  const allTriplets = ctx.known && ctx.groups.every(meld => meld.kind !== 'chi') &&
    oracleGroupShape(hand, ctx.count, wildTile, false, true);
  const allJiang = ctx.known && exposed.every(jiang) && natural.every(jiang);
  const allHonors = ctx.known && exposed.every(tile => tile >= 27) && natural.every(tile => tile >= 27);
  const ordinary = (!ctx.opened || wildCount <= 1 || replacement) && oracleGroupShape(hand, ctx.count, wildTile, true, false);
  return { winning: sevenPairs || allTriplets || allJiang || allHonors || ordinary,
    ordinary, sevenPairs, allTriplets, allJiang, allHonors, opened: ctx.opened, wildCount };
}

function oracleLegalWinning(hand, melds = 0, wildTile = null, indicatorTile = null) {
  return oracleClassifyWin(hand, melds, wildTile, indicatorTile).winning;
}

// Discard-win context is separate from the shape and self-draw checks. The
// independently computed big-hand flags exempt only the four authorized types.
function oracleCanClaimWin(hand, melds, wildTile, indicatorTile) {
  if (hand.includes(31) || hand.includes(indicatorTile)) return false;
  const win = oracleClassifyWin(hand, melds, wildTile, indicatorTile);
  return win.winning && (win.opened || win.sevenPairs || win.allTriplets || win.allJiang || win.allHonors);
}

function oracleCanSelfDrawWin(hand, melds, wildTile, indicatorTile, replacement) {
  if (hand.includes(31) || hand.includes(indicatorTile)) return false;
  return oracleClassifyWin(hand, melds, wildTile, indicatorTile, replacement).winning;
}

const frozenVisit = frozenDistance.slice(frozenDistance.indexOf('  let best = 8;'),
  frozenDistance.indexOf('  if (meldCount === 0) {'));
const naturalDistance = 'function oracleNaturalDistance(initialCounts, meldCount, jiangOnly, tripletsOnly = false) {\n' +
  '  const counts = [...initialCounts];\n' + frozenVisit
    .replace('if (groups < 4 && start < 27 &&', 'if (!tripletsOnly && groups < 4 && start < 27 &&')
    .replace('      if (!pair) visit(start, groups, partials, 1);',
      '      if (!pair && (!jiangOnly || (start < 27 && [1, 4, 7].includes(start % 9)))) visit(start, groups, partials, 1);')
    .replace('if (partials < 4 && start < 27)', 'if (!tripletsOnly && partials < 4 && start < 27)') +
  '  return best;\n}';

function oracleShanten(hand, melds = 0, wildTile = null, indicatorTile = null) {
  const ctx = oracleMeldContext(melds);
  const original = countsOf(hand);
  if (!original || hand.includes(31) || !ctx.valid || (wildTile !== null && !validTile(wildTile)) ||
    (indicatorTile !== null && (!validTile(indicatorTile) || hand.includes(indicatorTile)))) return 8;
  if (isWinning(hand, melds, wildTile, indicatorTile)) return -1;
  const counts = [...original];
  const wilds = wildTile === null ? 0 : counts[wildTile];
  if (wildTile !== null) counts[wildTile] = 0;
  const ordinary = oracleNaturalDistance(counts, ctx.count, true) - Math.min(wilds, ctx.opened ? 1 : wilds);
  const candidates = [ctx.opened ? Math.max(ordinary, wilds - 1) : ordinary];
  if (ctx.count === 0) candidates.push(6 - counts.reduce((total, count) => total + Math.floor(count / 2), 0) - wilds);
  if (ctx.known) {
    if (ctx.groups.every(meld => meld.kind !== 'chi')) candidates.push(oracleNaturalDistance(counts, ctx.count, false, true) - wilds);
    for (const category of [tile => tile < 27 && [1, 4, 7].includes(tile % 9), tile => tile >= 27]) {
      if (ctx.groups.some(meld => meld.tiles.some(tile => !category(tile)))) continue;
      candidates.push((4 - ctx.count) * 3 + 2 - hand.filter(tile => tile === wildTile || category(tile)).length - 1);
    }
  }
  const distance = Math.max(0, Math.min(...candidates));
  if (distance !== 0 || hand.length !== (4 - ctx.count) * 3 + 1) return distance;
  const declared = ctx.groups.flatMap(meld => meld.tiles);
  for (let tile = 0; tile < 34; tile++) {
    if (tile === 31 || tile === indicatorTile || original[tile] + declared.filter(value => value === tile).length >= 4) continue;
    if (isWinning([...hand, tile], melds, wildTile, indicatorTile)) return 0;
  }
  return 1;
}

const adaptedWinningStart = source.indexOf('export function isWinning(');
const adaptedWinningEnd = source.indexOf('\n// Red dragons are dedicated', adaptedWinningStart);
assert.ok(adaptedWinningStart > 0 && adaptedWinningEnd > adaptedWinningStart, 'adapted pure winning search has exact boundaries');
source = source.slice(0, adaptedWinningStart) + [legacyScoringShape, groupedShape,
  oracleMeldContext.toString(), oracleClassifyWin.toString(),
  oracleLegalWinning.toString().replace('function oracleLegalWinning(', 'export function isWinning('),
  oracleCanClaimWin.toString(),
  oracleCanSelfDrawWin.toString(),
].join('\n\n') + '\n' + source.slice(adaptedWinningEnd);
const adaptedDistanceStart = source.indexOf('export function calculateShanten(');
const adaptedDistanceEnd = source.indexOf('\nfunction handShape(', adaptedDistanceStart);
assert.ok(adaptedDistanceStart > 0 && adaptedDistanceEnd > adaptedDistanceStart, 'adapted AI distance has exact boundaries');
source = source.slice(0, adaptedDistanceStart) + naturalDistance + '\n\n' +
  oracleShanten.toString().replace('function oracleShanten(', 'export function calculateShanten(') +
  '\n' + source.slice(adaptedDistanceEnd);
replaceOnce('    const naturalWin = isWinning(seat.hand, seat.melds.length);',
  '    const naturalWin = legacyScoringShape(seat.hand, seat.melds.length);', 'scoring retains the frozen any-pair shape gate');
replaceChecked('canWin([...seat.hand, tile], seat.melds.length, this.wildTile, this.indicatorTile)',
  'oracleCanClaimWin([...seat.hand, tile], seat.melds, this.wildTile, this.indicatorTile)', 1,
  'claim evaluates actual meld context and closed ordinary hands cannot claim a discard');
replaceChecked('canWin(seat.hand, seat.melds.length, this.wildTile, this.indicatorTile)',
  'oracleCanSelfDrawWin(seat.hand, seat.melds, this.wildTile, this.indicatorTile, this.lastDraw?.player === player && this.lastDraw.replacement === true)', 1, 'self draw evaluates actual meld and matching replacement context');
replaceOnce('  const meldCount = Number.isInteger(melds) ? melds : melds.length;\n', '', 'discard estimator retains full declared meld context');
replaceOnce('calculateShanten(remaining, meldCount, wildTile, indicatorTile);',
  'calculateShanten(remaining, melds, wildTile, indicatorTile);', 'discard distance includes actual melds');
replaceOnce('isWinning([...remaining, draw], meldCount, wildTile)',
  'draw !== 31 && draw !== indicatorTile && isWinning([...remaining, draw], melds, wildTile, indicatorTile)',
  'discard ready-copy count considers only legal draws and actual meld context');
replaceOnce('const keepWilds = validTile(wildTile) && hand.some(tile => tile !== 31 && tile !== indicatorTile && tile !== wildTile);',
  'const keepWilds = validTile(wildTile);',
  'AI always keeps wildcards, regardless of melds and alternatives');
// 仅适配新授权的人机策略；冻结文件、真人出牌入口、胡牌搜索与计分比对保持原样。
replaceOnce("if (discard < 0) {\n      this._finishDraw(this.players[this.current].hand.includes(this.indicatorTile) ? '牌墙已空，红中或皮子无法补杠，本局流局' : '牌墙已空，红中无法补杠，本局流局');",
  "if (discard < 0) {\n      this._finishDraw(this.players[this.current].hand.includes(this.wildTile) ? '人机没有可打出的普通牌，本局流局' : this.players[this.current].hand.includes(this.indicatorTile) ? '牌墙已空，红中或皮子无法补杠，本局流局' : '牌墙已空，红中无法补杠，本局流局');",
  'AI blocked by held wildcards uses a draw reason without claiming the wall is empty');
replaceOnce('calculateShanten(seat.hand, seat.melds.length, this.wildTile, this.indicatorTile);',
  'calculateShanten(seat.hand, seat.melds, this.wildTile, this.indicatorTile);', 'bot claim distance includes actual prior melds');
replaceOnce('calculateShanten(remaining, melds.length, this.wildTile, this.indicatorTile);',
  'calculateShanten(remaining, melds, this.wildTile, this.indicatorTile);', 'bot claim distance includes actual candidate melds');

// 在冻结规则的独立预期中只调整本次明确授权的结算，不读取生产结算实现。
replaceOnce('    if (!restart || this.round === 0) this.round++;',
  '    if (!restart || this.round === 0) this.round++;\n    this.gangScoreDelta = [0,0,0,0];', 'new-round score ledger');
for (const anchor of ['        seat.redGangs.push(31);','        seat.piziGangs.push(this.indicatorTile);']) {
  replaceOnce(anchor, anchor + '\n        for (let payer = 0; payer < 4; payer++) { const delta = payer === player ? 30 : -10; this.players[payer].score += delta; this.gangScoreDelta[payer] += delta; }', 'immediate special gang transfer');
}
replaceOnce("    if (selfDraw) breakdown.push({ name: '自摸', points: 10 });",
  "    if (selfDraw) breakdown.push({ name: '自摸', points: 10 });\n    if (selfDraw && this.lastDraw?.player === winner && this.lastDraw.replacement) breakdown.push({name:'杠上开花',points:10});", 'replacement Hu bonus');
replaceOnce('    if (selfDraw) {\n      for (let player',
  '    const classification = oracleClassifyWin(seat.hand, seat.melds, this.wildTile, this.indicatorTile);\n    if (selfDraw || classification.sevenPairs || classification.allTriplets || classification.allJiang || classification.allHonors) {\n      for (let player', 'ordinary/big win payers');
replaceOnce('      scoreDelta[from] = -points * 3; scoreDelta[winner] = points * 3;',
  '      scoreDelta[from] = -points; scoreDelta[winner] = points;', 'ordinary discard one share');
replaceOnce('    for (let player = 0; player < 4; player++) this.players[player].score += scoreDelta[player];',
  '    for (let player = 0; player < 4; player++) this.players[player].score += scoreDelta[player];\n    for (let player = 0; player < 4; player++) scoreDelta[player] += this.gangScoreDelta[player];', 'round net includes already settled gangs once');
replaceOnce('points: 0, scoreDelta: [0, 0, 0, 0], patterns:', 'points: 0, scoreDelta: [...this.gangScoreDelta], patterns:', 'draw retains gang ledger');
const scoreNote = '底分10；红中杠、痞子杠其余三家各付10，赖子杠各付20；开杠立即结算，荒庄保留杠分。原番型分值不变，杠上开花额外加10。屁胡自摸三家各付一份，屁胡接胡放铳一家付一份；大胡三家各付一份。';
source = source.replace(/scoringNote: '[^']*'/g, 'scoringNote: ' + JSON.stringify(scoreNote));
// 冻结文件不变；独立预期把明示实牌临时插回其位置，验证不跳牌且只转移一次归属。
replaceOnce('    this.indicatorTile = null;',
  '    this.indicatorTile = null;\n    this.indicatorTaken = false;\n    this.indicatorTakenBy = null;', 'reset exposed indicator ownership');
replaceChecked('this.wall.length > 0', 'this._canDrawTile()', 2, 'kong availability includes the final exposed tile');
replaceOnce('  _drawTile(player, replacement = false) {',
  `  _canDrawTile() {
    return this.wall.length > 0 || (this.indicatorTile !== null && !this.indicatorTaken && this.wallInfo.indicatorPosition === this.wallInfo.tailDraws);
  }

  _drawTile(player, replacement = false) {`, 'pending indicator counts as a physical drawable tile');
replaceOnce('    if (!this.wall.length) {', '    if (!this._canDrawTile()) {', 'empty physical wall guard');
replaceOnce('    const tile = replacement ? this.wall.shift() : this.wall.pop();\n    if (replacement) this.wallInfo.tailDraws++;',
  `    const physical = [...this.wall];
    const index = this.wallInfo.indicatorPosition - this.wallInfo.tailDraws;
    const pending = this.indicatorTile !== null && !this.indicatorTaken && index >= 0 && index <= physical.length;
    if (pending) physical.splice(index, 0, this.indicatorTile);
    const takeIndicator = pending && index === (replacement ? 0 : physical.length - 1);
    const tile = takeIndicator ? this.indicatorTile : replacement ? this.wall.shift() : this.wall.pop();
    if (takeIndicator) { this.indicatorTaken = true; this.indicatorTakenBy = player; }
    else if (replacement) this.wallInfo.tailDraws++;`, 'draw the real exposed tile at its insertion position');
const drawLog = '    this._log(player === 0 ? `你${replacement ? \'补\' : \'摸\'}到${tileName(tile)}。` : `${this.players[player].name}${replacement ? \'补牌\' : \'摸牌\'}。`);';
replaceOnce(drawLog, drawLog + '\n    if (takeIndicator) this._log(`${this.players[player].name}${replacement ? \'补牌\' : \'摸牌\'}取走明示皮子${tileName(tile)}。`);', 'public exposed-tile transfer log');
replaceChecked('this.wall.length === 0 &&', '!this._canDrawTile() &&', 2, 'special-only hands exhaust after the exposed tile is taken');
replaceOnce('...(this.indicatorTile === null ? [] : [this.indicatorTile]),',
  '...(this.indicatorTile === null || this.indicatorTaken ? [] : [this.indicatorTile]),', 'do not count the taken indicator twice in visible owners');
export const legacyWallOracle = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

/** Independent seeded shuffle/roll prediction for rule-specific fixtures. */
export function previewWall(seed) {
  // Deliberately retain an independent copy of the frozen PRNG in the test
  // oracle. Do not use the production dice or dealing implementation here.
  const random = seedRandom(seed);
  const wall = Array.from({ length: 136 }, (_, index) => Math.floor(index / 4));
  for (let index = wall.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [wall[index], wall[target]] = [wall[target], wall[index]];
  }
  const diceRandom = seedRandom(`dice:${String(seed)}`);
  const dice = [1 + Math.floor(diceRandom() * 6), 1 + Math.floor(diceRandom() * 6)];
  const indicatorPosition = (Math.min(...dice) - 1) * 2;
  return { wall, dice, indicatorPosition, candidate: wall[indicatorPosition] };
}

export function seedRandom(seed) {
  let state = 2166136261;
  for (const letter of String(seed)) state = Math.imul(state ^ letter.charCodeAt(0), 16777619);
  if (!state) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** Find a deterministic fixture whose raw, dice-positioned candidate is exact. */
export function findCandidateSeed(candidate, prefix = 'wall-candidate', start = 0) {
  for (let index = start; index < start + 10000; index++) {
    const seed = `${prefix}-${index}`;
    if (previewWall(seed).candidate === candidate) return seed;
  }
  assert.fail(`No fixture seed for tile ${candidate}`);
}
