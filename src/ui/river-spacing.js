/** 当前居中俯仰桌面相机下的微缝轨道余量；不缩放、不旋转单张牌，不读取牌数或牌面。 */
export function riverSpacing(matrix,anchor,cellWidth,cellHeight,columns,rows,gap) {
  const project=(x,y)=>{const w=matrix[6]*x+matrix[7]*y+matrix[8];return {x:(matrix[0]*x+matrix[1]*y+matrix[2])/w,y:(matrix[3]*x+matrix[4]*y+matrix[5])/w};};
  const xAt=(screenX,y)=>(screenX*(matrix[7]*y+matrix[8])-matrix[1]*y-matrix[2])/(matrix[0]-screenX*matrix[6]);
  const yAt=(screenY,x)=>(screenY*(matrix[6]*x+matrix[8])-matrix[3]*x-matrix[5])/(matrix[4]-screenY*matrix[7]);
  // 留 0.05px 的栅格取整余量；尽量贴近手牌微缝，同时使每个投影包围盒都分离 1–2px。
  const low=1.05,high=1.95,target=Math.max(low,Math.min(high,gap));
  let height=rows*cellHeight+(rows-1)*gap,yPositions=[],rowGaps=[];
  for(let pass=0;pass<8;pass++) {
    const top=anchor.y-height/2;yPositions=[0];rowGaps=[];
    for(let row=0;row<rows-1;row++) {
      const bottom=top+yPositions[row]+cellHeight;
      const next=yAt(project(anchor.x,bottom).y+target,anchor.x);
      rowGaps.push(next-bottom);yPositions.push(next-top);
    }
    height=yPositions.at(-1)+cellHeight;
  }
  const top=anchor.y-height/2;
  let width=columns*cellWidth+(columns-1)*gap,columnGaps=[];
  for(let pass=0;pass<8;pass++) {
    const left=anchor.x-width/2;let x=left;columnGaps=[];
    for(let column=0;column<columns-1;column++) {
      let minimum=-Infinity,maximum=Infinity,preferred=0;
      for(const position of yPositions) {
        const ys=[top+position,top+position+cellHeight];
        const right=Math.max(...ys.map(y=>project(x+cellWidth,y).x));
        const next=distance=>Math.max(...ys.map(y=>xAt(right+distance,y)));
        minimum=Math.max(minimum,next(low));maximum=Math.min(maximum,next(high));preferred+=next(target)/rows;
      }
      const next=Math.max(minimum,Math.min(maximum,preferred));
      columnGaps.push(next-x-cellWidth);x=next;
    }
    width=x-left+cellWidth;
  }
  const average=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
  // CSS 仍是 9×4 / 4×9 显式轨道。余量附在各轨道末端，末轨道恰为一张牌。
  return {width,height,columnSpacing:average(columnGaps),rowSpacing:average(rowGaps),
    columns:[...columnGaps.map(value=>cellWidth+value-gap),cellWidth],
    rows:[...rowGaps.map(value=>cellHeight+value-gap),cellHeight]};
}
