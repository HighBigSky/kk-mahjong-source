import test from 'node:test';
import assert from 'node:assert/strict';
import {riverCell} from '../src/ui/river-layout.js';

test('reference rivers start next to the centre and proceed in each owner direction', () => {
  assert.deepEqual([0,1,2,3].map(seat=>riverCell(seat,0)),[{row:1,column:1},{row:1,column:1},{row:4,column:9},{row:9,column:4}]);
  assert.deepEqual([0,1,2,3].map(seat=>riverCell(seat,1)),[{row:1,column:2},{row:2,column:1},{row:4,column:8},{row:8,column:4}]);
  assert.deepEqual([0,1,2,3].map(seat=>riverCell(seat,9)),[{row:2,column:1},{row:1,column:2},{row:3,column:9},{row:9,column:3}]);
});
test('all 36 chronological discards have distinct fixed cells for every seat', () => {
  for (const seat of [0,1,2,3]) {
    const cells=Array.from({length:36},(_,index)=>riverCell(seat,index));
    assert.equal(new Set(cells.map(cell=>`${cell.row}:${cell.column}`)).size,36);
    assert.ok(cells.every(cell=>cell.row>=1&&cell.row<=(seat%2?9:4)&&cell.column>=1&&cell.column<=(seat%2?4:9)));
  }
  for(const args of [[4,0],[0,36],[0,-1],[0,1.5]]) assert.throws(()=>riverCell(...args),RangeError);
});
