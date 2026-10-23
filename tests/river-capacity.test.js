import test from 'node:test';
import assert from 'node:assert/strict';
import {RIVER_LAYOUT,riverCell} from '../src/ui/river-layout.js';

// 放宽牌型限制的安全上界模型：每家最多四次领取普通副露，任意非出牌者均可领取。
// 普通摸牌消耗一次摸打预算；领取不消耗预算，但从出牌方牌河减一、领取方打出一。
// 暗杠、补杠和单张杠只消耗补牌，不产生额外牌河牌，忽略它们只会放宽上界。
function retainedRiverBound(budget) {
  const combinations=5**4, states=combinations*4;
  const dp=Array.from({length:budget+1},()=>new Int16Array(states).fill(-1000));
  for(let dealer=0;dealer<4;dealer++)dp[1][dealer]=dealer===0?1:0;
  let peak=0;
  for(let used=1;used<=budget;used++)for(let code=0;code<combinations;code++)for(let from=0;from<4;from++) {
    const value=dp[used][code*4+from];if(value<0)continue;
    peak=Math.max(peak,value);
    const next=(from+1)%4;
    if(used<budget) {
      const index=code*4+next;
      dp[used+1][index]=Math.max(dp[used+1][index],value+(next===0?1:0));
    }
    for(let to=0;to<4;to++) {
      const digit=5**to;
      if(to===from||Math.floor(code/digit)%5===4)continue;
      const index=(code+digit)*4+to;
      dp[used][index]=Math.max(dp[used][index],value+(to===0?1:0)-(from===0?1:0));
    }
  }
  return peak;
}

for(const indicatorCount of [1,0]) test(`single-seat river capacity covers every relaxed turn/claim path, indicator count ${indicatorCount}`,()=>{
  const budget=136-indicatorCount-4*13;
  assert.equal(retainedRiverBound(budget),27);
  assert.equal(RIVER_LAYOUT.capacity,27);
  assert.equal(RIVER_LAYOUT.columns*RIVER_LAYOUT.rows,RIVER_LAYOUT.capacity);
});

test('all four rivers have 27 unique cells and grow from the centre toward their owner',()=>{
  const first={bottom:{column:1,row:1},right:{column:1,row:9},top:{column:9,row:3},left:{column:3,row:1}};
  const last={bottom:{column:9,row:3},right:{column:3,row:1},top:{column:1,row:1},left:{column:1,row:9}};
  for(const side of Object.keys(first)) {
    const cells=Array.from({length:RIVER_LAYOUT.capacity},(_,index)=>riverCell(index,side));
    assert.equal(new Set(cells.map(cell=>`${cell.column}:${cell.row}`)).size,27);
    const horizontal=side==='bottom'||side==='top';
    assert.ok(cells.every(cell=>cell.column>=1&&cell.column<=(horizontal?9:3)&&cell.row>=1&&cell.row<=(horizontal?3:9)));
    assert.deepEqual(cells[0],first[side]);assert.deepEqual(cells.at(-1),last[side]);
  }
});
