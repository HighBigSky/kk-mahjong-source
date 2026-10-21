import test from 'node:test';
import assert from 'node:assert/strict';
import {openingDealBatches, openingDealSlots, isOpeningDeal} from '../src/ui/opening-deal.js';
import {MahjongGame} from '../engine.js';
import {assertInvariants} from '../src/domain/invariants.js';

test('四家轮庄都按三轮四张发牌，最后补齐 13 张和庄家第 14 张', () => {
  for (let dealer=0;dealer<4;dealer++) for (const extra of [0,5,13]) {
    const batches=openingDealBatches(dealer,extra);
    assert.equal(batches.length,17);
    assert.ok(batches.slice(0,12).every(batch=>batch.indexes.length===4));
    assert.ok(batches.slice(12).every(batch=>batch.indexes.length===1));
    for (let round=0;round<4;round++) assert.deepEqual(batches.slice(round*4,round*4+4).map(batch=>batch.player),Array.from({length:4},(_,index)=>(dealer+index)%4));
    assert.deepEqual(batches[16],{player:dealer,indexes:[extra]});
    for (let player=0;player<4;player++) {
      const indexes=batches.filter(batch=>batch.player===player).flatMap(batch=>batch.indexes);
      const count=player===dealer?14:13;
      assert.equal(indexes.length,count);
      assert.deepEqual([...new Set(indexes)].sort((a,b)=>a-b),Array.from({length:count},(_,index)=>index));
    }
  }
  assert.deepEqual(openingDealBatches(-1),[]);
  assert.deepEqual(openingDealBatches(0,-1),[]);
  assert.deepEqual(openingDealBatches(0,14),[]);
});

test('动画取牌位置从墙头反向取 53 张且始终跳过翻出的皮子', () => {
  for (const indicator of [null,0,2,10,100,135]) {
    const slots=openingDealSlots(indicator);
    assert.equal(slots.length,53);
    assert.equal(new Set(slots).size,53);
    assert.ok(slots.every((slot,index)=>slot>=0&&slot<136&&slot!==indicator&&(!index||slot<slots[index-1])));
  }
});

test('开局检测不改变发牌，普通消息、杠后补牌和中途重连都不补播', () => {
  const room={status:'playing',paused:false};
  for (const laizi of [false,true]) {
    const game=new MahjongGame({seed:'opening-deal-detection',laizi});
    const before=JSON.stringify(game);
    assert.equal(isOpeningDeal(room,game),true);
    assert.equal(JSON.stringify(game),before);
    assertInvariants(game);
    assert.equal(isOpeningDeal({...room,paused:true},game),false);
    assert.equal(isOpeningDeal({...room,status:'waiting'},game),false);
    const index=game.players[0].hand.findIndex(tile=>tile!==31&&tile!==game.indicatorTile);
    assert.equal(game.discard(0,index),true);
    assert.equal(isOpeningDeal(room,game),false);
    assertInvariants(game);
  }
});
