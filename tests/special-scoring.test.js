import test from 'node:test';
import assert from 'node:assert/strict';
import {actionFixture,scattered} from './pizi-fixtures.mjs';
import {assertInvariants} from '../src/domain/invariants.js';

const opened=[{kind:'chi',tiles:[0,1,2],from:1,concealed:false}];
const ordinary=[9,10,11,18,19,20,24,25,26,4,4];
test('all seats settle each special gang once at 1/1/2 base and preserve balances on draw', () => {
 for(const seat of [0,1,2,3])for(const [kind,type,multiple] of [['redGang',31,1],['piziGang',33,1],['wildGang',27,2]]){
  const game=actionFixture({seat,hand:[...scattered,type]});
  const next=game.wall.findIndex(tile=>![27,31,33].includes(tile));[game.wall[0],game.wall[next]]=[game.wall[next],game.wall[0]];
  assert.equal(game.claim(seat,kind),true);
  const expected=game.players.map((_,index)=>index===seat?multiple*30:-multiple*10);
  assert.deepEqual(game.gangScoreDelta,expected);assert.deepEqual(game.players.map(player=>player.score),expected.map(value=>1000+value));
  assert.equal(game.claim(seat,kind),false);assert.deepEqual(game.gangScoreDelta,expected);
  game._finishDraw();assert.deepEqual(game.result.scoreDelta,expected);assert.deepEqual(game.players.map(player=>player.score),expected.map(value=>1000+value));
  assert.equal(game.players.reduce((sum,player)=>sum+player.score,0),4000);assertInvariants(game);
  game.newRound();assert.deepEqual(game.gangScoreDelta,[0,0,0,0]);assert.deepEqual(game.players.map(player=>player.score),expected.map(value=>1000+value));
 }
});
test('ordinary discard wins charge only the discarder, ordinary self draws charge three', () => {
 for(const selfDraw of [false,true]){
  const game=actionFixture({hand:ordinary,melds:opened});
  game._finishWin(0,selfDraw?null:3,selfDraw);
  assert.equal(game.result.points,selfDraw?20:10);
  assert.deepEqual(game.result.scoreDelta,selfDraw?[60,-20,-20,-20]:[10,0,0,-10]);
 }
});
test('all four big-win categories charge three payers even on a discard win', () => {
 const hands=[
  [0,0,2,2,3,3,5,5,6,6,8,8,28,28],
  [0,0,0,9,9,9,18,18,18,28,28,28,4,4],
  [1,1,1,4,4,7,7,7,7,10,10,13,16,25],
  [27,27,27,28,28,29,29,29,29,30,30,32,32,32],
 ];
 for(const hand of hands){const game=actionFixture({hand});game._finishWin(0,3,false);const points=game.result.points;assert.deepEqual(game.result.scoreDelta,[points*3,-points,-points,-points]);}
});
test('replacement self-draw adds exactly one base for every single gang and does not double-book gang scores', () => {
 for(const [kind,type,multiple] of [['redGang',31,1],['piziGang',33,1],['wildGang',27,2]]){
  const game=actionFixture({hand:[...ordinary.slice(0,-1),type],melds:opened});
  const owner=game.players.slice(1).find(player=>player.hand.includes(4));
  if(owner){const index=owner.hand.indexOf(4);[game.wall[0],owner.hand[index]]=[owner.hand[index],game.wall[0]];}
  else {const index=game.wall.indexOf(4);assert.ok(index>=0);[game.wall[0],game.wall[index]]=[game.wall[index],game.wall[0]];}
  assert.equal(game.claim(0,kind),true);assert.equal(game.getActions(0).hu,true);assert.equal(game.claim(0,'hu'),true);
  assert.equal(game.result.points,30);assert.equal(game.result.patterns.filter(name=>name==='杠上开花').length,1);
  const expected=[multiple*30+90,-multiple*10-30,-multiple*10-30,-multiple*10-30];
  assert.deepEqual(game.result.scoreDelta,expected);assert.deepEqual(game.players.map(player=>player.score),expected.map(value=>1000+value));
  assert.equal(game.claim(0,'hu'),false);assert.deepEqual(game.players.map(player=>player.score),expected.map(value=>1000+value));assertInvariants(game);
 }
});
