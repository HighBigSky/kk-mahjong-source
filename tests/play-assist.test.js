import test from 'node:test';
import assert from 'node:assert/strict';
import {createHintCalculator, specialGangKind, hintText, settlementCoins} from '../src/ui/play-assist.js';
import {getTingHints} from '../src/ui/ting.js';
import {TILE} from '../src/domain/tile.js';
import {actionFixture, scattered} from './pizi-fixtures.mjs';
import {assertInvariants} from '../src/domain/invariants.js';

const waiting = [0,1,2,9,10,11,18,19,20,24,25,26,4];

test('settlement separates prior gang profits from actual Hu transfers without changing balances', () => {
  for(const [kind,type] of [['redGang',31],['piziGang',33],['wildGang',27]]){
    const game=actionFixture({hand:[9,10,11,18,19,20,24,25,26,4,4],melds:[{kind:'chi',tiles:[0,1,2],from:1,concealed:false}]});
    const index=game.wall.indexOf(type);assert.ok(index>=0);game.wall.splice(index,1);
    (kind==='redGang'?game.players[2].redGangs:game.players[2].piziGangs).push(type);
    game._scoreSpecialGang(2,kind);game.wallInfo.tailDraws++;assertInvariants(game);
    const before=game.players.map(player=>player.score);assert.equal(game.claim(0,'hu'),true);assertInvariants(game);
    const after=game.players.map(player=>player.score),unchanged=JSON.stringify(game);
    for(let viewer=0;viewer<4;viewer++){
      const rotate=items=>items.slice(viewer).concat(items.slice(0,viewer));
      const state={players:rotate(game.players),result:{scoreDelta:rotate(game.result.scoreDelta)},indicatorTile:game.indicatorTile,wildTile:game.wildTile};
      const actual=settlementCoins(state);
      assert.deepEqual(actual.hu,rotate(after.map((score,seat)=>score-before[seat])));
      assert.deepEqual(actual.gang,rotate(game.gangScoreDelta));assert.deepEqual(actual.balance,rotate(after));
      assert.deepEqual(actual.net,rotate(game.result.scoreDelta));
      const loser=(2-viewer+4)%4;assert.ok(actual.net[loser]>0&&actual.hu[loser]<0,'earlier gang winner loses coins at Hu even if whole-round net stays positive');
      settlementCoins(state);assert.equal(JSON.stringify(game),unchanged,'rendering and rerendering never book coins again');
    }
  }
});
test('single tile identity priority is indicator, red, then wild', () => {
  assert.equal(specialGangKind(TILE.RED,TILE.RED,TILE.GREEN),'piziGang');
  assert.equal(specialGangKind(TILE.RED,TILE.NORTH,TILE.RED),'redGang');
  assert.equal(specialGangKind(5,4,5),'wildGang');
  assert.equal(specialGangKind(4,4,5),'piziGang');
  assert.equal(specialGangKind(6,4,5),null);
});
test('authoritative overlapping identities allow one entry, one real tile and one tail draw', () => {
  for (const indicator of [TILE.RED,TILE.NORTH,TILE.WHITE]) {
    const game=actionFixture({indicator,hand:[...scattered,TILE.RED]});
    const actions=game.getActions(0);
    const kind=indicator===TILE.RED?'piziGang':'redGang';
    assert.equal(actions[kind],true);
    assert.equal(actions.wildGang,false);
    if(indicator===TILE.RED)assert.equal(actions.redGang,false);
    const next=game.wall[0];const length=game.wall.length;
    assert.equal(game.claim(0,kind),true);
    assert.equal(game.players[0].hand.includes(TILE.RED),false);
    assert.equal(game.players[0].hand.includes(next),true);
    assert.equal(game.wall.length,length-1);
    assert.equal(game.lastDraw.replacement,true);
    assert.equal(game.claim(0,kind),false);
    assertInvariants(game);
  }
});
test('all discard suggestions reuse existing Hu and retain the selected physical copy in remaining counts', () => {
  const input={hand:[...waiting,27],visibleTiles:[4,4]};
  const calc=createHintCalculator();const result=calc(input);
  assert.equal(result.mode,'discard');assert.ok(result.candidates.length>0&&result.candidates.length<=5);
  for(const candidate of result.candidates){
    const old=getTingHints(input,candidate.index);
    assert.deepEqual(candidate.waits.map(({remaining,...wait})=>wait),old.waits);
    assert.equal(candidate.waits.find(wait=>wait.type===4)?.remaining,1);
    assert.match(hintText(candidate,false),/打【.+】→ 听【.+】（共 \d+ 张）/);
  }
  assert.equal(calc(structuredClone(input)),result,'equal inputs reuse the full calculation');
  const updated=calc({...input,visibleTiles:[4,4,4]});
  assert.notEqual(updated,result);assert.ok(updated.candidates.every(value=>!value.waits.some(wait=>wait.type===4)));
});
test('ready hands and no-wait hands have a single consistent state', () => {
  const calc=createHintCalculator();const ready=calc({hand:waiting});
  assert.equal(ready.mode,'ready');assert.match(hintText(ready.candidates[0],true),/^已听：/);
  assert.equal(calc({hand:[...scattered,27]}).mode,'none');
  assert.equal(calc({hand:[...waiting,TILE.RED]}).mode,'none');
});
test('candidate order follows wait types, unseen copies, then existing score', () => {
  const input={hand:[0,0,1,1,2,2,3,3,4,4,5,5,6,7]};
  const result=createHintCalculator()(input);
  assert.ok(result.candidates.length>1);
  for(let index=1;index<result.candidates.length;index++){
    const a=result.candidates[index-1],b=result.candidates[index];
    assert.ok(a.waits.length>b.waits.length||a.waits.length===b.waits.length&&(a.total>b.total||a.total===b.total&&a.points>=b.points));
  }
});
test('discard hints cannot recommend a face whose confirmation would declare a special gang', () => {
  const input={hand:[...waiting,27],wildTile:27,indicatorTile:33};
  const result=createHintCalculator()(input);
  assert.ok(result.candidates.every(candidate=>![27,31,33].includes(candidate.discardedTile)));
});
test('cold fourteen-tile calculation is below 50ms on representative ordinary, open and wildcard hands', t => {
  const inputs=[{hand:[...waiting,27]},{hand:[9,10,11,18,19,20,24,25,26,4,27],melds:[{kind:'chi',tiles:[0,1,2]}]},
    {hand:[0,1,2,3,4,5,6,7,8,9,10,11,27,27],wildTile:27,indicatorTile:33}];
  const times=[];
  for(let run=0;run<30;run++) {const start=performance.now();createHintCalculator()(inputs[run%inputs.length]);times.push(performance.now()-start);}
  t.diagnostic(`cold max=${Math.max(...times).toFixed(2)}ms; mean=${(times.reduce((a,b)=>a+b,0)/times.length).toFixed(2)}ms`);
  assert.ok(Math.max(...times)<50);
});
