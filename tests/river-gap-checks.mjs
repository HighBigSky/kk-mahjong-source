import assert from 'node:assert/strict';

export async function readRiverGaps(page) {
  return page.evaluate(()=>{
    const box=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const hand=document.querySelector('#hand'),handTiles=[...hand.querySelectorAll('button')];
    const handBoxes=handTiles.map(box),handStyle=getComputedStyle(hand),handGap=parseFloat(handStyle.columnGap);
    const handGaps=handBoxes.slice(1).map((r,i)=>r.left-handBoxes[i].right);
    const rivers=[0,1,2,3].map(seat=>{
      const root=document.querySelector('#river-'+seat),style=getComputedStyle(root),sideways=seat%2===1;
      const columns=style.gridTemplateColumns.split(/\s+/).map(Number.parseFloat),rows=style.gridTemplateRows.split(/\s+/).map(Number.parseFloat);
      const colGap=parseFloat(style.columnGap),rowGap=parseFloat(style.rowGap),prefix=(tracks,n,gap)=>tracks.slice(0,n).reduce((sum,v)=>sum+v,0)+n*gap;
      const tiles=[...root.querySelectorAll('.tile')].map(node=>{const s=getComputedStyle(node);return {...box(node),column:+node.style.gridColumn,row:+node.style.gridRow,model:[parseFloat(s.width),parseFloat(s.height)],
        cellError:Math.max(Math.abs(node.offsetLeft-prefix(columns,+node.style.gridColumn-1,colGap)-parseFloat(s.marginLeft)),Math.abs(node.offsetTop-prefix(rows,+node.style.gridRow-1,rowGap)-parseFloat(s.marginTop))),
        body:s.backgroundImage,bottomBorder:s.borderBottomWidth,shadow:s.boxShadow,radius:s.borderRadius};});
      const horizontal=[],vertical=[];
      for(const a of tiles)for(const b of tiles){if(a.row===b.row&&b.column===a.column+1)horizontal.push(b.left-a.right);if(a.column===b.column&&b.row===a.row+1)vertical.push(b.top-a.bottom);}
      return {seat,columns:columns.length,rows:rows.length,tiles,horizontal,vertical,gap:[colGap,rowGap],zone:box(root),underlay:style.backgroundColor,
        widthError:Math.abs(parseFloat(style.width)-(columns.length*columns.at(-1)+(columns.length-1)*parseFloat(style.getPropertyValue('--river-column-spacing')))),
        heightError:Math.abs(parseFloat(style.height)-(rows.length*rows.at(-1)+(rows.length-1)*parseFloat(style.getPropertyValue('--river-row-spacing'))))};
    });
    const all=rivers.flatMap(r=>r.tiles.map((t,index)=>({...t,seat:r.seat,index}))),overlaps=[];
    for(const[i,a]of all.entries())for(const b of all.slice(i+1)){const w=Math.min(a.right,b.right)-Math.max(a.left,b.left),h=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);if(w>.5&&h>.5)overlaps.push([a.seat,a.index,b.seat,b.index,w,h]);}
    const hs=getComputedStyle(handTiles[0]);
    return {rivers,hand:{gap:handGap,gaps:handGaps,box:box(hand),tiles:handBoxes,size:[hs.width,hs.height],underlay:handStyle.backgroundColor,wrap:handStyle.flexWrap,hit:handTiles.every(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2));})},overlaps,copies:document.querySelectorAll('#discard-focus .tile').length};
  });
}

export function assertRiverGaps(data,count,baseline) {
  assert.deepEqual(data.overlaps,[]);assert.equal(data.copies,0);
  assert.equal(data.hand.wrap,'nowrap');assert.equal(data.hand.hit,true);assert.equal(data.hand.tiles.length,14);
  assert.deepEqual(data.hand.size,baseline.hand,'hand dimensions remain unchanged');
  assert.ok(data.hand.gap>=.5&&data.hand.gap<=1);assert.equal(data.hand.underlay,'rgba(0, 0, 0, 0)');
  assert.ok(data.hand.gaps.every(g=>Math.abs(g-data.hand.gap)<.03));
  assert.ok(data.hand.tiles.every(t=>t.left>=data.hand.box.left-.5&&t.right<=data.hand.box.right+.5));
  for(const river of data.rivers) {
    assert.equal(river.tiles.length,count);assert.equal(river.columns,river.seat%2?4:9);assert.equal(river.rows,river.seat%2?9:4);
    assert.ok(river.gap.every(g=>g>=1&&g<=2));assert.equal(river.gap[0],river.gap[1]);assert.equal(river.underlay,data.hand.underlay);
    assert.ok(river.widthError<.15&&river.heightError<.15,`zone includes both axes of compensated spacing ${JSON.stringify({seat:river.seat,width:river.widthError,height:river.heightError})}`);
    assert.ok([...river.horizontal,...river.vertical].every(g=>g>=1&&g<=2&&Math.abs(g-river.gap[0])<.35),'projected river gaps retain their own 1-2px rule');
    assert.ok(river.tiles.every(t=>t.cellError<.8&&t.column>=1&&t.column<=river.columns&&t.row>=1&&t.row<=river.rows));
    for(const tile of river.tiles) {
      assert.deepEqual(tile.model,baseline.river,'no river tile shrinks or stretches');
      assert.ok(tile.left>=river.zone.left-.5&&tile.right<=river.zone.right+.5&&tile.top>=river.zone.top-.5&&tile.bottom<=river.zone.bottom+.5);
      assert.equal(tile.bottomBorder,'1px');assert.notEqual(tile.shadow,'none');
      assert.ok(!/rgb\(105, 187, 136\)|rgb\(55, 152, 91\)|rgb\(34, 107, 62\)/.test(tile.body),'no resin-green body painted into the seam');
    }
  }
}
