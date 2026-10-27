import test from 'node:test';
import assert from 'node:assert/strict';
import { isWinning, chooseDiscard, MahjongGame } from '../engine.js';
import { assertInvariants } from '../src/domain/invariants.js';
import { actionFixture } from './pizi-fixtures.mjs';
import { blockedBotFixture, blockedBotClaimFixture } from './bot-fixtures.mjs';

const standardHand = [0, 1, 2, 3, 4, 5, 9, 10, 11, 27, 27, 27, 19, 19];
const quietHand = [3, 5, 7, 12, 14, 16, 21, 23, 25, 28, 30, 32, 33];

function fixture({ current = 3, hands = {}, melds = {} } = {}) {
  const game = new MahjongGame({ seed: 41 });
  const remaining = Array(34).fill(4);
  for (let seat = 0; seat < 4; seat += 1) {
    game.players[seat].hand = [...(hands[seat] ?? quietHand)].sort((a, b) => a - b);
    game.players[seat].melds = structuredClone(melds[seat] ?? []);
    game.players[seat].discards = [];
    for (const tile of [...game.players[seat].hand, ...game.players[seat].melds.flatMap(meld => meld.tiles)]) {
      remaining[tile] -= 1;
      assert.ok(remaining[tile] >= 0, `test fixture contains more than four copies of ${tile}`);
    }
  }
  game.wall = remaining.flatMap((count, type) => Array(count).fill(type));
  game.current = current;
  game.phase = { kind: 'discard', seat: game.current };
  game.pendingDiscard = null;
  game.lastDraw = { player: current, tile: game.players[current].hand.at(-1) };
  game.winner = null;
  game.result = null;
  return game;
}

function discardTile(game, seat, tile) {
  const index = game.players[seat].hand.indexOf(tile);
  assert.ok(index >= 0);
  assert.equal(game.discard(seat, index), true);
}

function resolveBotResponses(game) {
  for (let step = 0; game.phase.kind === 'claim' && step < 8; step += 1) game.advanceAI();
  assert.notEqual(game.phase.kind, 'claim', 'bot responses must eventually resolve');
}

function physicalTiles(game) {
  return [
    ...game.wall,
    ...game.players.flatMap(player => [
      ...player.hand,
      ...player.discards,
      ...player.redGangs,
      ...player.melds.flatMap(meld => meld.tiles),
    ]),
  ];
}

function assertTileConservation(game) {
  const tiles = physicalTiles(game);
  assert.equal(tiles.length, 136, 'all 136 physical tiles must remain accounted for');
  for (let type = 0; type < 34; type += 1) {
    assert.equal(tiles.filter(tile => tile === type).length, 4, `tile ${type} must have exactly four copies`);
  }
}

test('recognizes a standard winning hand and does not mutate unsorted input', () => {
  const hand = [...standardHand].reverse();
  const before = [...hand];
  assert.equal(isWinning(hand), true);
  assert.deepEqual(hand, before);
});

test('recognizes seven pairs and a concealed hand completed by an exposed meld', () => {
  assert.equal(isWinning([0, 0, 8, 8, 9, 9, 17, 17, 18, 18, 27, 27, 33, 33]), true);
  assert.equal(isWinning([0, 1, 2, 9, 10, 11, 27, 27, 27, 19, 19], 1), true);
});

test('does not treat honors or neighboring suits as sequences', () => {
  assert.equal(isWinning([0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 28, 29, 25, 25]), false);
  assert.equal(isWinning([7, 8, 9, 12, 13, 14, 18, 19, 20, 27, 27, 27, 25, 25]), false);
});

test('former ordinary nine and honor pairs no longer qualify as the required 258 pair', () => {
  assert.equal(isWinning([0, 1, 2, 3, 4, 5, 9, 10, 11, 27, 27, 27, 26, 26]), false);
  assert.equal(isWinning([0, 1, 2, 9, 10, 11, 27, 27, 27, 33, 33], 1), false);
});

test('rejects an incomplete hand and an incorrect exposed-meld count', () => {
  assert.equal(isWinning(standardHand.slice(0, -1)), false);
  assert.equal(isWinning(standardHand, 1), false);
  assert.equal(isWinning([0, 1, 2, 9, 10, 11, 27, 27, 27, 32, 33]), false);
  assert.equal(isWinning([0, 0, 0, 0, 0, 9, 10, 11, 18, 19, 20, 27, 27, 27]), false);
});

test('deals 136 tiles deterministically with one dealer draw', () => {
  const game = new MahjongGame({ seed: 327 });
  assert.deepEqual(game.players.map(player => player.hand.length), [14, 13, 13, 13]);
  assert.equal(game.wall.length, 83);
  assert.equal(game.current, game.dealer);
  assert.equal(game.phase.kind, 'discard');
  assertTileConservation(game);
  const repeat = new MahjongGame({ seed: 327 });
  assert.deepEqual(repeat.players.map(player => player.hand), game.players.map(player => player.hand));
  assert.deepEqual(repeat.wall, game.wall);
});

test('rotates the dealer counterclockwise and deals the extra tile to that seat over eight rounds', () => {
  const game = new MahjongGame({ seed: 432 });
  for (let round = 1; round <= 8; round += 1) {
    const dealer = (round - 1) % 4;
    assert.equal(game.round, round);
    assert.equal(game.dealer, dealer);
    assert.equal(game.current, dealer);
    assert.equal(game.phase.kind, 'discard');
    assert.deepEqual(game.players.map(player => player.hand.length),
      Array.from({ length: 4 }, (_, seat) => seat === dealer ? 14 : 13));
    assert.equal(game.wall.length, 83);
    assert.equal(game.lastDraw.player, dealer);
    assert.equal(game.lastDraw.replacement, false);
    assert.equal(game.players[dealer].hand[game.lastDraw.index], game.lastDraw.tile);
    assert.ok(game.events[0].includes(`${game.players[dealer].name}坐庄`));
    const tiles = physicalTiles(game);
    assert.equal(tiles.filter(tile => tile < 27).length, 108);
    assert.equal(tiles.filter(tile => tile >= 27).length, 28);
    assert.equal(tiles.filter(tile => tile === 31).length, 4, 'all four red dragons remain in the deck');
    assertTileConservation(game);
    for (let seat = 0; seat < 4; seat += 1) {
      if (seat !== dealer) assert.equal(game.discard(seat, 0), false, 'only the dealer may discard first');
    }
    assert.equal(game.discard(dealer, chooseDiscard(game.players[dealer].hand)), true);
    assertTileConservation(game);
    game.newRound(432 + round);
  }
});

test('a restart keeps the current round, dealer and scores while resetting the table', () => {
  const game = new MahjongGame({ seed: 901 });
  game.newRound(902);
  game.newRound(903);
  game.players[0].score = 1030;
  game.players[1].score = 970;
  const scores = game.players.map(player => player.score);
  const dealtHands = game.players.map(player => [...player.hand]);
  const dealtWall = [...game.wall];
  assert.equal(game.discard(game.dealer, 0), true);
  game.newRound(903, { restart: true });
  assert.equal(game.round, 3);
  assert.equal(game.dealer, 2);
  assert.equal(game.current, 2);
  assert.equal(game.lastDraw.player, 2);
  assert.deepEqual(game.players.map(player => player.hand), dealtHands);
  assert.deepEqual(game.wall, dealtWall);
  assert.deepEqual(game.players.map(player => player.score), scores);
  assert.ok(game.players.every(player => player.melds.length === 0 && player.discards.length === 0));
  assert.equal(game.pendingDiscard, null);
  assert.equal(game.winner, null);
  assert.equal(game.result, null);
  assertTileConservation(game);
  game.newRound(904);
  assert.equal(game.round, 4);
  assert.equal(game.dealer, 3);
});

test('the next round rotates dealer after either a dealer win or a drawn round', () => {
  const won = fixture({ current: 0, hands: { 0: standardHand } });
  assert.equal(won.claim(0, 'hu'), true);
  assert.equal(won.phase.kind, 'ended');
  assert.equal(won.winner, 0);
  const scores = won.players.map(player => player.score);
  won.newRound(1001);
  assert.equal(won.dealer, 1, 'winning does not retain the dealer');
  assert.equal(won.current, 1);
  assert.deepEqual(won.players.map(player => player.score), scores);
  assertTileConservation(won);

  const drawn = fixture({ hands: { 3: [...quietHand, 0] } });
  drawn.players[0].redGangs.push(...drawn.wall.filter(tile => tile === 31));
  drawn.players[3].discards.push(...drawn.wall.filter(tile => tile !== 31));
  drawn.wall = [];
  discardTile(drawn, 3, 0);
  assert.equal(drawn.phase.kind, 'ended');
  assert.equal(drawn.result.kind, 'draw');
  assertTileConservation(drawn);
  drawn.newRound(1002);
  assert.equal(drawn.dealer, 1, 'a drawn round also rotates the dealer');
  assert.equal(drawn.current, 1);
  assertTileConservation(drawn);
});

test('rejects out-of-turn and invalid-index discards without losing tiles', () => {
  const game = new MahjongGame({ seed: 701 });
  const before = physicalTiles(game);
  assert.equal(game.discard((game.current + 1) % 4, 0), false);
  assert.equal(game.discard(game.current, -1), false);
  assert.equal(game.discard(game.current, game.players[game.current].hand.length), false);
  assert.deepEqual(physicalTiles(game), before);
  assertTileConservation(game);
});

test('a legal discard moves exactly one tile from hand to the discard pile', () => {
  const game = new MahjongGame({ seed: 818 });
  const seat = game.current;
  const tile = game.players[seat].hand[0];
  assert.equal(game.discard(seat, 0), true);
  assert.equal(game.players[seat].hand.length, 13);
  assert.equal(game.players[seat].discards.at(-1), tile);
  assertTileConservation(game);
});

test('chi is available only to the next seat and consumes the two matching hand tiles', () => {
  const humanHand = [0, 2, ...quietHand.slice(2)];
  const game = fixture({ hands: { 0: humanHand, 3: [...quietHand, 1] } });
  discardTile(game, 3, 1);
  assert.deepEqual(game.getActions(0).chi, [[0, 1, 2]]);
  assert.equal(game.claim(0, 'chi', [0, 1, 2]), true);
  resolveBotResponses(game);
  assert.equal(game.current, 0);
  assert.equal(game.players[0].hand.length, 11);
  assert.deepEqual(game.players[0].melds[0].tiles, [0, 1, 2]);
  assert.equal(game.players[3].discards.length, 0);
  assertTileConservation(game);

  const wrongSeat = fixture({ current: 1, hands: { 0: humanHand, 1: [...quietHand, 1] } });
  discardTile(wrongSeat, 1, 1);
  assert.deepEqual(wrongSeat.getActions(0).chi, []);
  assert.equal(wrongSeat.claim(0, 'chi', [0, 1, 2]), false);
});

test('peng takes a discard from any seat and gives the claimant a discard without drawing', () => {
  const game = fixture({ current: 2, hands: { 0: [1, 1, ...quietHand.slice(2)], 2: [...quietHand, 1] } });
  discardTile(game, 2, 1);
  const wallLength = game.wall.length;
  assert.equal(game.getActions(0).peng, true);
  assert.equal(game.claim(0, 'peng'), true);
  resolveBotResponses(game);
  assert.equal(game.current, 0);
  assert.equal(game.phase.kind, 'discard');
  assert.equal(game.wall.length, wallLength);
  assert.equal(game.players[0].hand.length, 11);
  assert.equal(game.players[0].melds[0].kind, 'peng');
  assert.deepEqual(game.players[0].melds[0].tiles, [1, 1, 1]);
  assertTileConservation(game);
});

test('an exposed gang consumes three hand tiles plus the discard and draws a replacement', () => {
  const game = fixture({ hands: { 0: [1, 1, 1, ...quietHand.slice(3)], 3: [...quietHand, 1] } });
  discardTile(game, 3, 1);
  const wallLength = game.wall.length;
  assert.equal(game.getActions(0).gang, true);
  assert.equal(game.claim(0, 'gang'), true);
  resolveBotResponses(game);
  assert.equal(game.current, 0);
  assert.equal(game.wall.length, wallLength - 1);
  assert.equal(game.players[0].hand.length, 11);
  assert.equal(game.players[0].melds[0].kind, 'gang');
  assert.deepEqual(game.players[0].melds[0].tiles, [1, 1, 1, 1]);
  assertTileConservation(game);
});

test('concealed and added gangs each draw exactly one replacement', () => {
  const concealed = fixture({ current: 0, hands: { 0: [1, 1, 1, 1, ...quietHand.slice(3)] } });
  const concealedWall = concealed.wall.length;
  assert.deepEqual(concealed.getActions(0).concealedGangs, [1]);
  assert.equal(concealed.claim(0, 'concealedGang', 1), true);
  assert.equal(concealed.players[0].melds[0].concealed, true);
  assert.equal(concealed.players[0].hand.length, 11);
  assert.equal(concealed.wall.length, concealedWall - 1);
  assertTileConservation(concealed);

  const added = fixture({
    current: 0,
    hands: { 0: [1, ...quietHand.slice(3)] },
    melds: { 0: [{ kind: 'peng', tiles: [1, 1, 1], from: 2 }] },
  });
  const addedWall = added.wall.length;
  assert.deepEqual(added.getActions(0).addedGangs, [1]);
  assert.equal(added.claim(0, 'addedGang', 1), true);
  assert.equal(added.players[0].melds.length, 1);
  assert.equal(added.players[0].melds[0].kind, 'gang');
  assert.deepEqual(added.players[0].melds[0].tiles, [1, 1, 1, 1]);
  assert.equal(added.players[0].hand.length, 11);
  assert.equal(added.wall.length, addedWall - 1);
  assertTileConservation(added);
});

test('AI waits for a human claim response and passing draws for the next player', () => {
  const game = fixture({ hands: { 0: [0, 2, ...quietHand.slice(2)], 3: [...quietHand, 1] } });
  discardTile(game, 3, 1);
  const wallLength = game.wall.length;
  for (let step = 0; step < 6; step += 1) game.advanceAI();
  assert.equal(game.phase.kind, 'claim');
  assert.equal(game.players[0].hand.length, 13);
  assert.equal(game.wall.length, wallLength);
  assert.equal(game.pass(0), true);
  resolveBotResponses(game);
  assert.equal(game.current, 0);
  assert.equal(game.players[0].hand.length, 14);
  assert.equal(game.wall.length, wallLength - 1);
  assertTileConservation(game);
});

test('a higher-priority peng defeats a submitted chi', () => {
  const game = fixture({ hands: {
    0: [0, 2, ...quietHand.slice(2)],
    1: [1, 1, ...quietHand.slice(2)],
    3: [...quietHand, 1],
  } });
  discardTile(game, 3, 1);
  assert.equal(game.claim(0, 'chi', [0, 1, 2]), true);
  resolveBotResponses(game);
  assert.equal(game.current, 1);
  assert.equal(game.players[0].melds.length, 0);
  assert.equal(game.players[0].hand.length, 13);
  assert.equal(game.players[1].melds[0].kind, 'peng');
  assertTileConservation(game);
});

test('hu takes priority over peng and transfers the winning discard into the hand', () => {
  const game = fixture({ hands: {
    0: standardHand.slice(3, -1),
    1: [19, 19, ...quietHand.slice(2)],
    3: [...quietHand, 19],
  }, melds: { 0: [{ kind: 'chi', tiles: [0, 1, 2], from: 3, concealed: false }] } });
  discardTile(game, 3, 19);
  assert.equal(game.getActions(0).hu, true);
  assert.equal(game.getActions(1).peng, true);
  assert.equal(game.claim(0, 'hu'), true);
  resolveBotResponses(game);
  assert.equal(game.phase.kind, 'ended');
  assert.equal(game.winner, 0);
  assert.equal(game.result.from, 3);
  assert.equal(game.result.selfDraw, false);
  assert.equal(game.players[0].hand.length, 11);
  assert.equal(game.players[1].melds.length, 0);
  assert.equal(game.players[3].discards.length, 0);
  assertTileConservation(game);
});

test('competing hu claims choose the nearest seat after the discarder', () => {
  const game = fixture({ current: 0, hands: {
    0: [...quietHand, 19],
    1: standardHand.slice(3, -1),
    2: [15, 16, 17, 21, 22, 23, 29, 29, 29, 19],
  }, melds: {
    1: [{ kind: 'chi', tiles: [0, 1, 2], from: 0, concealed: false }],
    2: [{ kind: 'chi', tiles: [6, 7, 8], from: 1, concealed: false }],
  } });
  discardTile(game, 0, 19);
  assert.equal(game.getActions(1).hu, true);
  assert.equal(game.getActions(2).hu, true);
  assert.equal(game.claim(2, 'hu'), true);
  assert.equal(game.claim(1, 'hu'), true);
  resolveBotResponses(game);
  assert.equal(game.winner, 1);
  assert.equal(game.result.from, 0);
  assertTileConservation(game);
});

test('seeded AI rounds finish without stalls or creating or losing physical tiles', () => {
  let firstOutcome;
  for (const seed of [1, 11, 77, 235, 902, 1]) {
    const game = new MahjongGame({ seed });
    let step = 0;
    while (game.phase.kind !== 'ended' && step < 1500) {
      const actions = game.getActions(0);
      if (game.phase.kind === 'claim' && actions.pass) {
        if (actions.hu) assert.equal(game.claim(0, 'hu'), true);
        else assert.equal(game.pass(0), true);
      } else if (game.phase.kind === 'discard' && game.current === 0) {
        if (actions.hu) assert.equal(game.claim(0, 'hu'), true);
        else if (actions.redGang) assert.equal(game.claim(0, 'redGang'), true);
        else assert.equal(game.discard(0, chooseDiscard(game.players[0].hand, game.players[0].melds)), true);
      } else {
        game.advanceAI();
      }
      assertTileConservation(game);
      assert.ok(game.players.every(player => !player.discards.includes(31)), 'red dragons never enter a discard river');
      step += 1;
    }
    assert.equal(game.phase.kind, 'ended', `seed ${seed} stalled after ${step} actions`);
    assert.ok(game.result, `seed ${seed} must report a round result`);
    assert.equal(game.players.reduce((sum, player) => sum + player.score, 0), 4000);
    if (seed === 1) {
      const outcome = { result: game.result, players: game.players, wall: game.wall, steps: step };
      if (firstOutcome) assert.deepEqual(outcome, firstOutcome, 'replaying a seed must produce the same outcome');
      else firstOutcome = structuredClone(outcome);
    }
    const scores = game.players.map(player => player.score);
    game.newRound(seed + 1);
    assert.equal(game.phase.kind, 'discard');
    assert.deepEqual(game.players.map(player => player.score), scores);
    assert.deepEqual(game.players.map(player => player.hand.length), [13, 14, 13, 13]);
    assertTileConservation(game);
  }
});

test('AI keeps every wildcard after opening, consistently picks an ordinary tile, and leaves inputs intact', () => {
  const melds=[{kind:'chi',tiles:[0,1,2],from:3,concealed:false}];
  const hand=[27,27,31,33,3,5,7,12,14,21,25],before=structuredClone({hand,melds});
  const indices=Array.from({length:20},()=>chooseDiscard(hand,melds,[4,9,18],27,33));
  assert.ok(indices.every(index=>index===indices[0]&&index>=0));
  assert.ok(![27,31,33].includes(hand[indices[0]]));
  assert.deepEqual({hand,melds},before);
  for(const special of [[27],[27,27],[27,31,33],[27,27,31,33],[]])assert.equal(chooseDiscard(special,melds,[],27,33),-1);
  assert.equal(chooseDiscard([27,27,31,33,5],melds,[],27,33),4);
});

test('local AI ends an unplayable turn once with or without remaining wall tiles', () => {
  for(const exhausted of [false,true]) {
    const game=blockedBotFixture({exhausted}),scores=game.players.map(p=>p.score);
    assert.equal(chooseDiscard(game.players[1].hand,game.players[1].melds,[],game.wildTile,game.indicatorTile),-1);
    assert.equal(game.advanceAI(),true);
    assert.equal(game.phase.kind,'ended');assert.equal(game.result.kind,'draw');
    assert.match(game.result.reason,/人机没有可打出的普通牌/);
    assert.deepEqual(game.players[1].discards,[]);assert.deepEqual(game.players.map(p=>p.score),scores);
    assertInvariants(game);
    const settled=JSON.stringify(game);assert.equal(game.advanceAI(),false);assert.equal(JSON.stringify(game),settled);
  }
});

test('bot chi and peng simulations decline claims that would leave only wildcards to discard', () => {
  for(const kind of ['chi','peng']) {
    const game=blockedBotClaimFixture(kind),actions=game.getActions(1),before=JSON.stringify(game);
    assert.ok(kind==='chi'?actions.chi.length>0:actions.peng);
    assert.equal(actions.hu,false);
    assert.deepEqual(game._botClaim(1,actions),{action:'pass'});
    assert.equal(JSON.stringify(game),before);assertInvariants(game);
  }
});

test('human wildcard discards remain legal independently of the AI candidate filter', () => {
  const game=actionFixture({hand:[0,2,4,6,8,10,12,14,16,18,20,22,27,27]});
  assert.equal(game.discard(0,game.players[0].hand.indexOf(game.wildTile)),true);
  assertInvariants(game);
});

test('200 fixed-seed optional-mode AI rounds never put a wildcard into any river', t => {
  let totalActions=0,openedMultiWildTurns=0,replacementTurns=0;
  for(let seed=0;seed<200;seed++) {
    const game=new MahjongGame({seed:`no-wild-discard-${seed}`,laizi:true});
    for(let step=0;game.phase.kind!=='ended'&&step<1500;step++) {
      const actions=game.getActions(0);
      if(game.phase.kind==='discard') {
        const seat=game.players[game.current];
        if(seat.melds.length&&seat.hand.filter(tile=>tile===game.wildTile).length>=2)openedMultiWildTurns++;
        if(game.lastDraw?.replacement)replacementTurns++;
      }
      if(game.phase.kind==='claim'&&actions.pass)assert.equal(actions.hu?game.claim(0,'hu'):game.pass(0),true);
      else if(game.phase.kind==='discard'&&game.current===0) {
        // 仅测试代理座位 0；其余三家始终使用真实 advanceAI()，四家共享同一候选过滤。
        if(actions.hu)assert.equal(game.claim(0,'hu'),true);
        else if(actions.redGang)assert.equal(game.claim(0,'redGang'),true);
        else if(actions.piziGang)assert.equal(game.claim(0,'piziGang'),true);
        else {
          const index=chooseDiscard(game.players[0].hand,game.players[0].melds,game._visibleTiles(),game.wildTile,game.indicatorTile);
          if(index<0)game._finishDraw('测试代理无普通牌可打');
          else assert.equal(game.discard(0,index),true);
        }
      } else assert.equal(game.advanceAI(),true,`seed ${seed}, action ${step}`);
      assertInvariants(game);
      assert.ok(game.players.every(p=>!p.discards.includes(game.wildTile)),`seed ${seed}, action ${step}: no wildcard in any river`);
      totalActions++;
    }
    assert.equal(game.phase.kind,'ended',`seed ${seed} must finish`);assert.ok(game.result);
    assert.equal(game.players.reduce((sum,p)=>sum+p.score,0),4000);
  }
  assert.ok(openedMultiWildTurns>0);assert.ok(replacementTurns>0);
  t.diagnostic(`200 seeded rounds, ${totalActions} actions, ${openedMultiWildTurns} opened multi-wild turns, ${replacementTurns} replacement turns; four rivers contain no wildcards.`);
});
