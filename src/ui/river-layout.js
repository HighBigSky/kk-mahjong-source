// 136 张牌、最多四组普通副露：将吃碰跳家与被领取牌移出牌河一并计入，
// 单家留河保守上界为 27 张；推导和穷举验证见设计规格及 river-capacity.test.js。
const columns = 9;
const rows = 3;
export const RIVER_LAYOUT = Object.freeze({
  columns, rows, capacity:columns * rows,
  tileWidth:.0315,
  radius:.215,
  nearRadius:.2115,
  wallRadius:.3024,
  sideWallRadius:.315,
  handRadius:.39,
});

// 从出牌者左手边起排，每行九张，满行后向桌心排下一行；只安排格位，不重排实牌 DOM。
export function riverCell(index, side) {
  const row=Math.floor(index/columns), column=index%columns;
  if(side==='bottom')return {column:column+1,row:rows-row};
  if(side==='right')return {column:rows-row,row:columns-column};
  if(side==='top')return {column:columns-column,row:row+1};
  return {column:row+1,row:column+1};
}
