import assert from 'node:assert/strict';

// 不取截图：以浏览器计算绘制属性与实际投影牌框证明绘制集合的边界。
// clip + 零外扩边距裁住所有子层；inset 阴影不增加集合面积，圆角只会进一步缩小它。
export async function checkTilePaintBounds(page,selector) {
  const result=await page.locator(selector).evaluateAll(nodes=>{
    const split=value=>value.split(/,(?![^()]*\))/).filter(v=>v.trim()&&v.trim()!=='none');
    const visible=nodes.filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden');
    const rows=visible.map(n=>{
      const s=getComputedStyle(n),r=n.getBoundingClientRect();
      const layers=[s,getComputedStyle(n,'::before'),getComputedStyle(n,'::after'),...Array.from(n.querySelectorAll('svg'),svg=>getComputedStyle(svg))];
      const interactive=n.matches('.selected,.hinted,.last-discard,.is-discard-focus');
      const external=layers.flatMap(layer=>split(layer.boxShadow).filter(v=>!v.includes('inset')));
      const outlineOut=parseFloat(s.outlineWidth)>0&&s.outlineStyle!=='none'?Math.max(0,parseFloat(s.outlineWidth)+parseFloat(s.outlineOffset)):0;
      return {className:n.className,interactive,clip:s.overflow,margin:s.overflowClipMargin,external:outlineOut?external.concat('external outline'):external,
        filters:layers.flatMap(layer=>[layer.filter,layer.backdropFilter]),
        // 普通绘制足迹只能是自身可视牌框的子集，新增的邻牌相交面积因此为 0。
        rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},
        quad:window.visualGeometry.quad(n),
        pseudoPointer:layers.slice(1,3).map(layer=>layer.pointerEvents)};
    });
    let neighbors=0,baseIntersections=0;const unexpected=[];
    for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
      const a=rows[i].rect,b=rows[j].rect;
      if(Math.max(a.left,b.left)<=Math.min(a.right,b.right)+2&&Math.max(a.top,b.top)<=Math.min(a.bottom,b.bottom)+2){
        neighbors++;if(window.visualGeometry.intersects(rows[i].quad,rows[j].quad,.5)){
          baseIntersections++;
          if(!visible[i].closest('.wall-stack')||visible[i].closest('.wall-stack')!==visible[j].closest('.wall-stack'))unexpected.push([i,j]);
        }
      }
    }
    return {rows,neighbors,baseIntersections,unexpected};
  });
  for(const row of result.rows.filter(v=>!v.interactive)){
    assert.equal(row.clip,'clip',`${selector} ${row.className} all pseudo/SVG paint clipped to the original card`);
    assert.equal(parseFloat(row.margin),0,`${selector} no clipping allowance`);
    assert.deepEqual(row.external,[],`${selector} ${row.className} no outward normal shadow or decoration`);
    assert.deepEqual(row.pseudoPointer,['none','none']);
    assert.ok(row.filters.every(v=>v==='none'));
  }
  assert.deepEqual(result.unexpected,[],`${selector} no body overlap outside the original double-height wall stacks`);
  return {cards:result.rows.length,neighborPairs:result.neighbors,existingBodyIntersections:result.baseIntersections,unexpectedBodyIntersections:0,additionalPaintIntersections:0,
    proof:'CSS clipping and inset-shadow bounds; no screenshots or pixel sampling. Existing two-layer wall stack bodies retain their original overlap.'};
}

export async function checkTileInteractionPaint(page) {
  const results=[];
  for(const [selector,state]of [['#hand .tile','selected'],['#hand .tile','hinted'],['#river-0 .tile','is-discard-focus']]){
    const result=await page.locator(selector).first().evaluate((n,state)=>{
      const read=()=>{const s=getComputedStyle(n);return {shadow:s.boxShadow,outline:s.outline,rect:[s.width,s.height],outward:s.boxShadow.split(/,(?![^()]*\))/).some(v=>v.trim()!=='none'&&!v.includes('inset'))};};
      const before=read();n.classList.add(state);const active=read();n.classList.remove(state);const restored=read();
      return {before,active,restored};
    },state);
    assert.equal(result.before.outward,false);assert.equal(result.active.outward,true,`${state} retains its external glow`);
    assert.equal(result.restored.outward,false,`${state} external paint disappears synchronously`);
    assert.deepEqual(result.active.rect,result.before.rect);assert.deepEqual(result.restored,result.before);
    results.push({state,externalActive:true,externalRestored:false});
  }
  return results;
}
