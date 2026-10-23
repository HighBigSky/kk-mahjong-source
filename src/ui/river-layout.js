// 规则推导的单家留河上界仍为 27 张；展示预留 36 格，余量不改变规则或牌序。
const columns = 9;
const rows = 4;
export const RIVER_LAYOUT = Object.freeze({
  columns, rows, capacity:columns * rows,
  // 牌宽只由 CSS 的 --tile-face-width 决定；这里仅定义格位与同心区域。
  radius:.24,
  nearRadius:.24,
  farRadius:.23,
  wallRadius:.355,
  farWallRadius:.343,
  sideWallRadius:.355,
  handRadius:.435,
  farHandRadius:.415,
});

// 从靠桌心一行、出牌者左手边起排，每行九张，再向玩家方向续排；不重排实牌 DOM。
export function riverCell(index, side) {
  const row=Math.floor(index/columns), column=index%columns;
  if(side==='bottom')return {column:column+1,row:row+1};
  if(side==='right')return {column:row+1,row:columns-column};
  if(side==='top')return {column:columns-column,row:rows-row};
  return {column:rows-row,row:column+1};
}
