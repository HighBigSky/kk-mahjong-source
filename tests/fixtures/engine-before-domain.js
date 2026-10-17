/** Dependency-free rules and turn orchestration for the four-seat teaching game. */

const SUIT_NAMES = ['万', '筒', '条'];
const NUM_NAMES = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONOR_NAMES = ['东', '南', '西', '北', '中', '发', '白'];
const DEFAULT_NAMES = ['你', '云舟', '阿福', '小棠'];

export function tileName(type) {
  if (!Number.isInteger(type) || type < 0 || type > 33) return '未知牌';
  return type < 27 ? NUM_NAMES[type % 9] + SUIT_NAMES[Math.floor(type / 9)] : HONOR_NAMES[type - 27];
}

export function tileSuit(type) {
  return type >= 27 ? 'honor' : ['wan', 'tong', 'tiao'][Math.floor(type / 9)];
}

function validTile(type) {
  return Number.isInteger(type) && type >= 0 && type < 34;
}

/** Numbered suits wrap at nine; all seven honors share one cycle. */
export function nextWildTile(type) {
  if (!validTile(type)) return null;
  return type < 27 ? Math.floor(type / 9) * 9 + (type + 1) % 9 : 27 + (type - 26) % 7;
}

function countsOf(hand) {
  if (!Array.isArray(hand)) return null;
  const counts = Array(34).fill(0);
  for (const tile of hand) {
    if (!Number.isInteger(tile) || tile < 0 || tile > 33 || ++counts[tile] > 4) return null;
  }
  return counts;
}

function isSevenPairs(hand) {
  const counts = countsOf(hand);
  return hand.length === 14 && counts && counts.every(count => count % 2 === 0);
}

/** Standard four groups + a pair, or seven pairs with no exposed groups. */
export function isWinning(hand, meldCount = 0, wildTile = null) {
  if (!Number.isInteger(meldCount) || meldCount < 0 || meldCount > 4 ||
      !Array.isArray(hand) || hand.length !== (4 - meldCount) * 3 + 2 ||
      (wildTile !== null && !validTile(wildTile))) return false;
  const counts = countsOf(hand);
  if (!counts) return false;
  const wilds = wildTile === null ? 0 : counts[wildTile];
  if (wildTile !== null) counts[wildTile] = 0;
  // In this teaching variant a four-of-a-kind can supply two of the seven pairs.
  if (meldCount === 0 && counts.reduce((odd, count) => odd + count % 2, 0) <= wilds) return true;
  const memo = new Map();
  function groupsRemain(groups, remainingWilds) {
    const first = counts.findIndex(count => count > 0);
    if (first < 0) return remainingWilds === groups * 3;
    if (groups === 0) return false;
    const key = counts.join('') + ':' + groups + ':' + remainingWilds;
    if (memo.has(key)) return memo.get(key);
    let matched = false;
    const naturalTriple = Math.min(3, counts[first]);
    if (3 - naturalTriple <= remainingWilds) {
      counts[first] -= naturalTriple;
      matched = groupsRemain(groups - 1, remainingWilds - (3 - naturalTriple));
      counts[first] += naturalTriple;
    }
    if (!matched && first < 27) {
      const suitStart = Math.floor(first / 9) * 9;
      // A wild can precede the first natural tile, e.g. wild, eight, nine.
      for (let start = Math.max(suitStart, first - 2); start <= Math.min(first, suitStart + 6); start++) {
        const natural = [start, start + 1, start + 2].filter(tile => counts[tile] > 0);
        const neededWilds = 3 - natural.length;
        if (neededWilds > remainingWilds) continue;
        for (const tile of natural) counts[tile]--;
        matched = groupsRemain(groups - 1, remainingWilds - neededWilds);
        for (const tile of natural) counts[tile]++;
        if (matched) break;
      }
    }
    memo.set(key, matched);
    return matched;
  }
  for (let pair = 0; pair < 34; pair++) {
    if (!counts[pair]) continue;
    const natural = Math.min(2, counts[pair]);
    if (2 - natural > wilds) continue;
    counts[pair] -= natural;
    const matched = groupsRemain(4 - meldCount, wilds - (2 - natural));
    counts[pair] += natural;
    if (matched) return true;
  }
  return wilds >= 2 && groupsRemain(4 - meldCount, wilds - 2);
}

// Red dragons are dedicated single-tile kong tiles. They cannot be discarded,
// and every concealed red must be declared before Hu.
function canWin(hand, meldCount, wildTile) {
  return !hand.includes(31) && isWinning(hand, meldCount, wildTile);
}

/** -1 means complete, 0 means one winning draw away. Used only by the AI/hint. */
export function calculateShanten(hand, meldCount = 0, wildTile = null) {
  const counts = countsOf(hand);
  if (!counts || !Number.isInteger(meldCount) || meldCount < 0 || meldCount > 4 ||
      (wildTile !== null && !validTile(wildTile))) return 8;
  if (wildTile !== null && counts[wildTile] > 0) {
    if (isWinning(hand, meldCount, wildTile)) return -1;
    const natural = hand.filter(tile => tile !== wildTile);
    const estimate = Math.max(0, calculateShanten(natural, meldCount) - counts[wildTile]);
    if (estimate === 0) {
      // Validate ready hands exactly; farther distances remain a compact AI heuristic.
      for (let draw = 0; draw < 34; draw++) {
        if (counts[draw] < 4 && isWinning([...hand, draw], meldCount, wildTile)) return 0;
      }
      return 1;
    }
    return estimate;
  }
  let best = 8;
  const visited = new Set();
  function visit(start, groups, partials, pair) {
    if (best === -1) return;
    while (start < 34 && counts[start] === 0) start++;
    if (start === 34) {
      best = Math.min(best, 8 - 2 * groups - Math.min(partials, 4 - groups) - pair);
      return;
    }
    const key = counts.join('') + ':' + groups + ':' + partials + ':' + pair;
    if (visited.has(key)) return;
    visited.add(key);
    if (groups < 4 && counts[start] >= 3) {
      counts[start] -= 3; visit(start, groups + 1, partials, pair); counts[start] += 3;
    }
    if (groups < 4 && start < 27 && start % 9 <= 6 && counts[start + 1] && counts[start + 2]) {
      counts[start]--; counts[start + 1]--; counts[start + 2]--;
      visit(start, groups + 1, partials, pair);
      counts[start]++; counts[start + 1]++; counts[start + 2]++;
    }
    if (counts[start] >= 2) {
      counts[start] -= 2;
      if (!pair) visit(start, groups, partials, 1);
      if (partials < 4) visit(start, groups, partials + 1, pair);
      counts[start] += 2;
    }
    if (partials < 4 && start < 27) {
      for (const distance of [1, 2]) {
        if (start % 9 + distance > 8 || !counts[start + distance]) continue;
        counts[start]--; counts[start + distance]--;
        visit(start, groups, partials + 1, pair);
        counts[start]++; counts[start + distance]++;
      }
    }
    counts[start]--; visit(start, groups, partials, pair); counts[start]++;
  }
  visit(0, meldCount, 0, 0);
  if (meldCount === 0) {
    const original = countsOf(hand);
    const pairs = original.reduce((total, count) => total + Math.floor(count / 2), 0);
    best = Math.min(best, 6 - pairs);
  }
  return best;
}

function handShape(hand) {
  const counts = countsOf(hand);
  if (!counts) return -1000;
  let value = 0;
  for (let tile = 0; tile < 34; tile++) {
    const count = counts[tile];
    if (!count) continue;
    if (count >= 3) value += 12;
    else if (count === 2) value += tile >= 27 ? 7 : 6;
    else if (tile >= 27) value -= 3;
    if (tile < 27) {
      const rank = tile % 9;
      value += count * (rank >= 2 && rank <= 6 ? 0.12 : 0);
      if (rank <= 7) value += Math.min(count, counts[tile + 1]) * 2.3;
      if (rank <= 6) value += Math.min(count, counts[tile + 2]) * 1.1;
    }
  }
  return value;
}

/** Returns a legal discard index, or -1 when no discard is possible. */
export function chooseDiscard(hand, melds = [], visible = [], wildTile = null) {
  if (!Array.isArray(hand) || hand.length === 0) return -1;
  const meldCount = Number.isInteger(melds) ? melds : melds.length;
  const seen = Array(34).fill(0);
  for (const tile of visible) if (Number.isInteger(tile) && tile >= 0 && tile < 34) seen[tile]++;
  const own = countsOf(hand) || Array(34).fill(0);
  let bestIndex = -1;
  let bestDistance = Infinity;
  let bestValue = -Infinity;
  const visited = new Set();
  const keepWilds = validTile(wildTile) && hand.some(tile => tile !== 31 && tile !== wildTile);
  for (let index = 0; index < hand.length; index++) {
    const tile = hand[index];
    if (tile === 31) continue;
    if (keepWilds && tile === wildTile) continue;
    if (visited.has(tile)) continue;
    visited.add(tile);
    const remaining = hand.filter((_, position) => position !== index);
    const distance = calculateShanten(remaining, meldCount, wildTile);
    if (distance > bestDistance) continue;
    let value = handShape(wildTile === null ? remaining : remaining.filter(value => value !== wildTile)) + Math.min(seen[tile], 3) * 0.2;
    if (distance === 0) {
      // Prefer a ready hand whose winning tiles still have copies outside it.
      let winningCopies = 0;
      for (let draw = 0; draw < 34; draw++) {
        if (isWinning([...remaining, draw], meldCount, wildTile)) {
          winningCopies += Math.max(0, 4 - own[draw] - seen[draw]);
        }
      }
      value += winningCopies * 10;
    }
    if (distance < bestDistance || value > bestValue) {
      bestIndex = index; bestDistance = distance; bestValue = value;
    }
  }
  return bestIndex;
}

function makeRandom(seed) {
  let state = 2166136261;
  for (const letter of String(seed)) state = Math.imul(state ^ letter.charCodeAt(0), 16777619);
  if (!state) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function emptyActions() {
  return { hu: false, peng: false, gang: false, redGang: false, chi: [], pass: false, concealedGangs: [], addedGangs: [] };
}

function hasClaim(actions) {
  return actions.hu || actions.peng || actions.gang || actions.chi.length > 0;
}

function removeTiles(hand, tiles) {
  const remaining = [...hand];
  for (const tile of tiles) {
    const index = remaining.indexOf(tile);
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  hand.splice(0, hand.length, ...remaining);
  return true;
}

function sameSequence(left, right) {
  return Array.isArray(left) && left.length === right.length &&
    [...left].sort((a, b) => a - b).every((tile, index) => tile === right[index]);
}

/**
 * Human is seat 0. Call advanceAI() until it returns false after each human move.
 * Claim responses are collected before priority is resolved; a lower claim can lose.
 * No flower tiles, dead wall, multiple winners, or robbing an added kong in this variant.
 */
export class MahjongGame {
  constructor(options = {}) {
    if (typeof options !== 'object' || options === null) options = { seed: options };
    this.players = DEFAULT_NAMES.map((name, index) => ({
      name: options.names?.[index] || name,
      hand: [], melds: [], redGangs: [], discards: [], score: 1000,
    }));
    this.round = 0;
    this.laiziEnabled = Boolean(options.laizi);
    this._random = makeRandom(options.seed ?? `${Date.now()}-${Math.random()}`);
    this.newRound();
  }

  /** A restart redeals the current round; a new round rotates the dealer counterclockwise. */
  newRound(seed, { restart = false, laizi = this.laiziEnabled } = {}) {
    if (seed !== undefined) this._random = makeRandom(seed);
    if (!restart || this.round === 0) this.round++;
    // Seats are bottom (0), right (1), top (2), and left (3).
    this.dealer = (this.round - 1) % 4;
    this.wall = Array.from({ length: 136 }, (_, index) => Math.floor(index / 4));
    for (let index = this.wall.length - 1; index > 0; index--) {
      const target = Math.floor(this._random() * (index + 1));
      [this.wall[index], this.wall[target]] = [this.wall[target], this.wall[index]];
    }
    this.laiziEnabled = Boolean(laizi);
    this.indicatorTile = null;
    this.wildTile = null;
    if (this.laiziEnabled) {
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
    }
    for (const player of this.players) {
      player.hand = []; player.melds = []; player.redGangs = []; player.discards = [];
    }
    for (let deal = 0; deal < 13; deal++) {
      for (const player of this.players) player.hand.push(this.wall.pop());
    }
    for (const player of this.players) player.hand.sort((a, b) => a - b);
    this.current = this.dealer;
    this.phase = 'discard';
    this.pendingDiscard = null;
    this.winner = null;
    this.result = null;
    this.lastDraw = null;
    this.events = [];
    this._responses = Array(4).fill(null);
    this._log(`第 ${this.round} 局开始，${this.players[this.dealer].name}坐庄，庄家先出牌。`);
    if (this.laiziEnabled) this._log(`翻出皮子${tileName(this.indicatorTile)}，${tileName(this.wildTile)}为本局癞子。`);
    this._drawTile(this.dealer);
    return this;
  }

  _log(message) {
    this.events.push(message);
    if (this.events.length > 80) this.events.shift();
  }

  _validPlayer(player) {
    return Number.isInteger(player) && player >= 0 && player < 4;
  }

  _rawClaimActions(player) {
    const actions = emptyActions();
    if (this.phase !== 'claim' || !this.pendingDiscard || !this._validPlayer(player) || player === this.pendingDiscard.from) return actions;
    const seat = this.players[player];
    const tile = this.pendingDiscard.tile;
    if (tile === 31) return actions;
    const counts = countsOf(seat.hand);
    if (!counts) return actions;
    actions.hu = canWin([...seat.hand, tile], seat.melds.length, this.wildTile);
    if (seat.melds.length < 4) {
      actions.peng = counts[tile] >= 2;
      actions.gang = counts[tile] >= 3 && this.wall.length > 0;
      if (player === (this.pendingDiscard.from + 1) % 4 && tile < 27) {
        for (let start = tile - 2; start <= tile; start++) {
          if (start < 0 || Math.floor(start / 9) !== Math.floor(tile / 9) || start % 9 > 6) continue;
          const sequence = [start, start + 1, start + 2];
          const needed = sequence.filter(value => value !== tile);
          if (needed.every(value => counts[value] > 0)) actions.chi.push(sequence);
        }
      }
    }
    actions.pass = hasClaim(actions);
    return actions;
  }

  getActions(player = 0) {
    const actions = emptyActions();
    if (!this._validPlayer(player) || this.phase === 'ended') return actions;
    if (this.phase === 'claim') {
      return this._responses[player] ? actions : this._rawClaimActions(player);
    }
    if (this.phase !== 'discard' || this.current !== player) return actions;
    const seat = this.players[player];
    const counts = countsOf(seat.hand);
    if (!counts) return actions;
    actions.hu = this.lastDraw?.player === player && canWin(seat.hand, seat.melds.length, this.wildTile);
    if (this.wall.length > 0) {
      actions.redGang = counts[31] > 0;
      if (seat.melds.length < 4) {
        actions.concealedGangs = counts.flatMap((count, tile) => count === 4 && tile !== 31 ? [tile] : []);
      }
      actions.addedGangs = seat.melds
        .filter(meld => meld.kind === 'peng' && meld.tiles[0] !== 31 && counts[meld.tiles[0]] > 0)
        .map(meld => meld.tiles[0]);
    }
    return actions;
  }

  discard(player, index) {
    if (!this._validPlayer(player) || this.phase !== 'discard' || this.current !== player ||
        !Number.isInteger(index) || index < 0 || index >= this.players[player].hand.length) return false;
    const seat = this.players[player];
    if (seat.hand[index] === 31) return false;
    const [tile] = seat.hand.splice(index, 1);
    seat.discards.push(tile);
    this.pendingDiscard = { tile, from: player };
    this.phase = 'claim';
    this.lastDraw = null;
    this._responses = Array(4).fill(null);
    this._log(`${seat.name}打出${tileName(tile)}。`);
    this._tryResolveClaims();
    return true;
  }

  claim(player, action, tiles) {
    if (!this._validPlayer(player)) return false;
    action = ({ 'concealed-gang': 'concealedGang', 'added-gang': 'addedGang', 'anGang': 'concealedGang', 'buGang': 'addedGang' })[action] || action;
    const actions = this.getActions(player);
    if (this.phase === 'discard' && this.current === player) {
      if (action === 'hu' && actions.hu) {
        this._finishWin(player, null, true); return true;
      }
      if (action === 'redGang' && actions.redGang) {
        const seat = this.players[player];
        removeTiles(seat.hand, [31]);
        seat.redGangs.push(31);
        this.lastDraw = null;
        this._log(`${seat.name}红中杠，补摸一张牌。`);
        this._drawTile(player, true);
        return true;
      }
      if (action === 'concealedGang' || action === 'addedGang') {
        const choices = action === 'concealedGang' ? actions.concealedGangs : actions.addedGangs;
        const tile = Array.isArray(tiles) ? tiles[0] : tiles ?? choices[0];
        if (!choices.includes(tile)) return false;
        this._selfGang(player, action, tile); return true;
      }
      return false;
    }
    if (this.phase !== 'claim' || this._responses[player]) return false;
    if (action === 'chi') {
      const sequence = tiles ?? actions.chi[0];
      const selected = actions.chi.find(candidate => sameSequence(sequence, candidate));
      if (!selected) return false;
      this._responses[player] = { action, tiles: [...selected] };
    } else if (['hu', 'peng', 'gang'].includes(action) && actions[action]) {
      this._responses[player] = { action };
    } else return false;
    this._tryResolveClaims();
    return true;
  }

  pass(player = 0) {
    if (!this._validPlayer(player) || this.phase !== 'claim' || this._responses[player] || !this.getActions(player).pass) return false;
    this._responses[player] = { action: 'pass' };
    this._tryResolveClaims();
    return true;
  }

  _tryResolveClaims() {
    if (this.phase !== 'claim' || !this.pendingDiscard) return false;
    for (let player = 0; player < 4; player++) {
      if (hasClaim(this._rawClaimActions(player)) && !this._responses[player]) return false;
    }
    const { from } = this.pendingDiscard;
    const priority = { hu: 3, gang: 2, peng: 2, chi: 1 };
    const choices = this._responses
      .map((response, player) => response && priority[response.action] ? { ...response, player } : null)
      .filter(Boolean)
      .sort((left, right) => priority[right.action] - priority[left.action] ||
        (left.player - from + 4) % 4 - (right.player - from + 4) % 4);
    if (choices.length) this._executeClaim(choices[0]);
    else {
      this.pendingDiscard = null;
      this._responses = Array(4).fill(null);
      this._drawTile((from + 1) % 4);
    }
    return true;
  }

  _executeClaim(response) {
    const { player, action } = response;
    const { tile, from } = this.pendingDiscard;
    const seat = this.players[player];
    const river = this.players[from].discards;
    // Claimed tiles leave the river; each physical tile belongs to exactly one place.
    const riverIndex = river.lastIndexOf(tile);
    if (riverIndex >= 0) river.splice(riverIndex, 1);
    this.pendingDiscard = null;
    this._responses = Array(4).fill(null);
    this.current = player;
    this.lastDraw = null;
    if (action === 'hu') {
      seat.hand.push(tile);
      seat.hand.sort((a, b) => a - b);
      this._finishWin(player, from, false);
      return;
    }
    const meldTiles = action === 'chi' ? response.tiles : Array(action === 'gang' ? 4 : 3).fill(tile);
    const needed = [...meldTiles];
    needed.splice(needed.indexOf(tile), 1);
    removeTiles(seat.hand, needed);
    seat.melds.push({ kind: action, tiles: [...meldTiles], from, concealed: false });
    this.phase = 'discard';
    this._log(`${seat.name}${{ chi: '吃', peng: '碰', gang: '明杠' }[action]}${tileName(tile)}。`);
    if (action === 'gang') this._drawTile(player, true);
    else if (this.wall.length === 0 && seat.hand.length > 0 && seat.hand.every(value => value === 31)) {
      this._finishDraw('牌墙已空，红中无法补杠，本局流局');
    }
  }

  _selfGang(player, action, tile) {
    const seat = this.players[player];
    if (action === 'concealedGang') {
      removeTiles(seat.hand, Array(4).fill(tile));
      seat.melds.push({ kind: 'gang', tiles: Array(4).fill(tile), from: player, concealed: true });
      this._log(`${seat.name}暗杠${tileName(tile)}。`);
    } else {
      removeTiles(seat.hand, [tile]);
      const meld = seat.melds.find(group => group.kind === 'peng' && group.tiles[0] === tile);
      meld.kind = 'gang'; meld.tiles.push(tile); meld.added = true;
      this._log(`${seat.name}补杠${tileName(tile)}。`);
    }
    this.lastDraw = null;
    this._drawTile(player, true);
  }

  _drawTile(player, replacement = false) {
    this.current = player;
    if (!this.wall.length) {
      this._finishDraw(); return false;
    }
    const tile = this.wall.pop();
    const hand = this.players[player].hand;
    hand.push(tile); hand.sort((a, b) => a - b);
    this.phase = 'discard';
    this.lastDraw = { player, tile, index: hand.lastIndexOf(tile), replacement };
    this._log(player === 0 ? `你${replacement ? '补' : '摸'}到${tileName(tile)}。` : `${this.players[player].name}${replacement ? '补牌' : '摸牌'}。`);
    if (this.wall.length === 0 && hand.length > 0 && hand.every(value => value === 31)) {
      this._finishDraw('牌墙已空，红中无法补杠，本局流局');
    }
    return true;
  }

  _visibleTiles() {
    return [
      ...(this.indicatorTile === null ? [] : [this.indicatorTile]),
      ...this.players.flatMap(player => [...player.discards, ...player.redGangs, ...player.melds.flatMap(meld => meld.tiles)]),
    ];
  }

  _botClaim(player, actions) {
    if (actions.hu) return { action: 'hu' };
    if (this.pendingDiscard.tile === this.wildTile) return { action: 'pass' };
    if (actions.gang) return { action: 'gang' };
    const seat = this.players[player];
    const tile = this.pendingDiscard.tile;
    const before = calculateShanten(seat.hand, seat.melds.length, this.wildTile);
    let best = null;
    let bestDistance = before;
    const candidates = [];
    if (actions.peng) candidates.push({ action: 'peng', tiles: Array(3).fill(tile) });
    for (const sequence of actions.chi) candidates.push({ action: 'chi', tiles: sequence });
    for (const candidate of candidates) {
      const remaining = [...seat.hand];
      const needed = [...candidate.tiles]; needed.splice(needed.indexOf(tile), 1);
      if (!removeTiles(remaining, needed)) continue;
      const melds = [...seat.melds, { kind: candidate.action, tiles: candidate.tiles }];
      const discard = chooseDiscard(remaining, melds, this._visibleTiles(), this.wildTile);
      if (discard < 0) continue;
      remaining.splice(discard, 1);
      const after = calculateShanten(remaining, melds.length, this.wildTile);
      if (after < bestDistance || (after === bestDistance && !best && (this.wall.length < 48 || candidate.action === 'peng'))) {
        best = candidate; bestDistance = after;
      }
    }
    return best || { action: 'pass' };
  }

  advanceAI() {
    if (this.phase === 'ended') return false;
    if (this.phase === 'claim') {
      const from = this.pendingDiscard.from;
      for (let distance = 1; distance < 4; distance++) {
        const player = (from + distance) % 4;
        if (player === 0 || this._responses[player]) continue;
        const actions = this._rawClaimActions(player);
        if (!hasClaim(actions)) continue;
        const choice = this._botClaim(player, actions);
        if (choice.action === 'pass') this.pass(player);
        else this.claim(player, choice.action, choice.tiles);
        return true;
      }
      return this._tryResolveClaims();
    }
    if (this.phase !== 'discard' || this.current === 0) return false;
    const player = this.current;
    const actions = this.getActions(player);
    if (actions.hu) return this.claim(player, 'hu');
    if (actions.redGang) return this.claim(player, 'redGang');
    const concealed = actions.concealedGangs.find(tile => tile !== this.wildTile);
    if (concealed !== undefined) return this.claim(player, 'concealedGang', concealed);
    const added = actions.addedGangs.find(tile => tile !== this.wildTile);
    if (added !== undefined) return this.claim(player, 'addedGang', added);
    const discard = chooseDiscard(this.players[player].hand, this.players[player].melds, this._visibleTiles(), this.wildTile);
    if (discard < 0) {
      this._finishDraw('牌墙已空，红中无法补杠，本局流局');
      return true;
    }
    return this.discard(player, discard);
  }

  _finishWin(winner, from, selfDraw) {
    const seat = this.players[winner];
    const allTiles = [...seat.hand, ...seat.melds.flatMap(meld => meld.tiles)];
    const breakdown = [{ name: '基础胡牌', points: 10 }];
    // Shape bonuses use only an independently valid natural interpretation;
    // wildcard substitutions have no specified bonus schedule yet.
    const naturalWin = isWinning(seat.hand, seat.melds.length);
    if (naturalWin && seat.melds.length === 0 && isSevenPairs(seat.hand)) breakdown.push({ name: '七对', points: 10 });
    else if (naturalWin) {
      const counts = countsOf(seat.hand);
      if (seat.melds.every(meld => meld.kind !== 'chi') && counts &&
          counts.filter(count => count === 2).length === 1 && counts.every(count => count === 0 || count === 2 || count === 3)) {
        breakdown.push({ name: '碰碰胡', points: 10 });
      }
    }
    const suits = new Set(allTiles.map(tileSuit));
    if (naturalWin && suits.size === 1) breakdown.push({ name: suits.has('honor') ? '字一色' : '清一色', points: suits.has('honor') ? 30 : 20 });
    if (selfDraw) breakdown.push({ name: '自摸', points: 10 });
    const points = breakdown.reduce((total, item) => total + item.points, 0);
    const scoreDelta = Array(4).fill(0);
    if (selfDraw) {
      for (let player = 0; player < 4; player++) if (player !== winner) scoreDelta[player] = -points;
      scoreDelta[winner] = points * 3;
    } else {
      scoreDelta[from] = -points * 3; scoreDelta[winner] = points * 3;
    }
    for (let player = 0; player < 4; player++) this.players[player].score += scoreDelta[player];
    this.winner = winner;
    this.current = winner;
    this.phase = 'ended';
    this.pendingDiscard = null;
    this.result = {
      kind: 'win', type: 'win', winner, from, selfDraw, points, scoreDelta,
      patterns: breakdown.map(item => item.name), breakdown, hand: [...seat.hand],
      reason: selfDraw ? '自摸' : `${this.players[from].name}点炮`,
      scoringNote: '演示计分：基础 10；七对、碰碰胡、自摸各加 10，清一色加 20，字一色加 30。自摸其余三家各付单份，点炮一家付三份。杠不单独计分。',
    };
    this._log(`${seat.name}${selfDraw ? '自摸胡牌' : '胡牌'}！${this.result.patterns.join(' · ')}，获得 ${scoreDelta[winner]} 分。`);
  }

  _finishDraw(reason = '牌墙已空，本局流局') {
    this.phase = 'ended';
    this.pendingDiscard = null;
    this.winner = null;
    this.lastDraw = null;
    this.result = {
      kind: 'draw', type: 'draw', winner: null, from: null, selfDraw: false,
      points: 0, scoreDelta: [0, 0, 0, 0], patterns: [], breakdown: [],
      reason, scoringNote: '演示计分，流局不扣分。',
    };
    this._log(`${reason}。`);
  }
}
