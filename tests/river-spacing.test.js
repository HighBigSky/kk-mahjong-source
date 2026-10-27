import test from 'node:test';
import assert from 'node:assert/strict';
import {riverSpacing} from '../src/ui/river-spacing.js';

test('projected river tracks retain tile size and capacity with shared 1-2px screen seams',()=>{
  // 与实际居中、仅绕 X 轴俯仰的桌面相机相同，X=360 的桌心投影仍在画面中心。
  for(const matrix of [[1,0,0,0,1,0,0,0,1],[1,-.18,0,0,.7,30,0,-.0005,1]])for(const gap of [1,1.5,2])for(const sideways of [false,true]) {
    const [w,h,columns,rows]=sideways?[42,30,4,9]:[30,42,9,4],anchor={x:360,y:260},before=JSON.stringify({matrix,anchor});
    const result=riverSpacing(matrix,anchor,w,h,columns,rows,gap);
    assert.equal(JSON.stringify({matrix,anchor}),before);assert.equal(result.columns.length,columns);assert.equal(result.rows.length,rows);
    assert.ok([...result.columns,...result.rows].every(v=>Number.isFinite(v)&&v>0));
    assert.ok(Math.abs(result.width-(columns*w+(columns-1)*result.columnSpacing))<1e-8);
    assert.ok(Math.abs(result.height-(rows*h+(rows-1)*result.rowSpacing))<1e-8);
    const starts=(tracks,length)=>Array.from({length},(_,i)=>tracks.slice(0,i).reduce((sum,v)=>sum+v,0)+i*gap);
    const xs=starts(result.columns,columns),ys=starts(result.rows,rows);
    const project=(x,y)=>{const scale=matrix[6]*x+matrix[7]*y+matrix[8];return [(matrix[0]*x+matrix[1]*y+matrix[2])/scale,(matrix[3]*x+matrix[4]*y+matrix[5])/scale];};
    const boxes=ys.map(y=>xs.map(x=>{
      const points=[[0,0],[w,0],[w,h],[0,h]].map(([dx,dy])=>project(anchor.x-result.width/2+x+dx,anchor.y-result.height/2+y+dy));
      return {left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))};
    }));
    for(let row=0;row<rows;row++)for(let column=0;column<columns;column++) {
      if(column+1<columns){const distance=boxes[row][column+1].left-boxes[row][column].right;assert.ok(distance>=1&&distance<=2);}
      if(row+1<rows){const distance=boxes[row+1][column].top-boxes[row][column].bottom;assert.ok(distance>=1&&distance<=2);}
    }
    assert.equal(boxes.flat().length,36);
  }
});
