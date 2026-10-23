// 136 张牌、最多四组普通副露：将吃碰跳家与被领取牌移出牌河一并计入，
// 单家留河保守上界为 27 张；推导和穷举验证见设计规格及 river-capacity.test.js。
const columns = 9;
const rows = 3;
export const RIVER_LAYOUT = Object.freeze({
  columns, rows, capacity:columns * rows,
  tileWidth:.0315,
  radius:.215,
  nearRadius:.2115,
  // 对家牌河位置固定；手牌与牌墙单独内收，三层牌区仍留出间隔。
  farRadius:.2085,
  wallRadius:.3024,
  farWallRadius:.316,
  sideWallRadius:.315,
  handRadius:.39,
  farHandRadius:.382,
});

// 从靠桌心一行、出牌者左手边起排，每行九张，再向玩家方向续排；不重排实牌 DOM。
export function riverCell(index, side) {
  const row=Math.floor(index/columns), column=index%columns;
  if(side==='bottom')return {column:column+1,row:row+1};
  if(side==='right')return {column:row+1,row:columns-column};
  if(side==='top')return {column:columns-column,row:rows-row};
  return {column:rows-row,row:column+1};
}
