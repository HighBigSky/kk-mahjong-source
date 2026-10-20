// @ts-check
/** 只定义桌面的展示格位；弃牌数组仍保留真实出牌时间顺序。
 * 四家都从靠近中央的一排/列开始，按本人视角从左向右排列，再向外续排。
 * @param {number} seat @param {number} index
 */
export function riverCell(seat, index) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3 || !Number.isInteger(index) || index < 0 || index >= 36) throw new RangeError('无效牌河格位');
  const line = Math.floor(index / 9), position = index % 9;
  if (seat === 0) return {row:line + 1, column:position + 1};
  if (seat === 1) return {row:position + 1, column:line + 1};
  if (seat === 2) return {row:4 - line, column:9 - position};
  return {row:9 - position, column:4 - line};
}
