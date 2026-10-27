import assert from 'node:assert/strict';

// 仅测试本家现有 DOM 的材质分层，不发送游戏动作，不用截图判断可见侧面。
export async function checkHandSides(page,size) {
  await page.setViewportSize({width:size.width,height:size.height});
  const scenarios=[
    {name:'fourteen',count:14},{name:'thirteen',count:13},
    {name:'meld',count:11,meld:true},{name:'drawn',count:14,drawn:true},
    {name:'meld-drawn',count:11,meld:true,drawn:true},
    {name:'selected-front',count:14,state:'selected',index:3},
    {name:'selected-side',count:14,state:'selected',index:13},
    {name:'hinted-front',count:14,state:'hinted',index:3},
    {name:'hinted-side',count:14,state:'hinted',index:12},
  ];
  const results=[];
  for(const scenario of scenarios) {
    const normal=await page.evaluate(s=>{
      const game=window.mahjongGame,player=game.players[0];
      player.hand=Array.from({length:s.count},(_,i)=>i);player.redGangs=[];player.piziGangs=[];
      player.melds=s.meld?[{kind:'peng',tiles:[20,20,20],from:1,concealed:false}]:[];
      game.current=0;game.phase={kind:'discard',seat:0};game.pendingDiscard=null;game.lastDiscard=null;game.actionNotice=null;
      game.lastDraw=s.drawn?{player:0,tile:player.hand.at(-1),index:s.count-1,replacement:false}:null;
      game.events=['手牌露侧样式验收'];window.renderMahjong();
      if(s.state){const target=document.querySelectorAll('#hand button')[s.index],style=getComputedStyle(target),normal={outline:style.outlineWidth,outlineStyle:style.outlineStyle,transform:style.transform,side:getComputedStyle(target,'::after').backgroundSize};target.classList.add(s.state);return normal;}
      return null;
    },scenario);
    await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all([...document.querySelectorAll('#hand button')].flatMap(n=>n.getAnimations().map(a=>a.finished.catch(()=>{}))));});
    const data=await page.evaluate(()=>{
      const hand=document.querySelector('#hand'),rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
      return {gap:getComputedStyle(hand).gap,wrap:getComputedStyle(hand).flexWrap,box:rect(hand),tiles:[...hand.children].map(n=>{const s=getComputedStyle(n),after=getComputedStyle(n,'::after'),before=getComputedStyle(n,'::before');return {
        ...rect(n),width:s.width,height:s.height,radius:s.borderRadius,rightBorder:s.borderRightWidth,bottomBorder:s.borderBottomWidth,
        sideSizes:after.backgroundSize.split(',').map(value=>parseFloat(value)),paint:after.backgroundImage,pointer:after.pointerEvents,z:after.zIndex,
        side:s.getPropertyValue('--tile-side').trim(),bodySide:s.getPropertyValue('--tile-model-body-side').trim(),
        bottomDepth:parseFloat(before.bottom),outline:s.outlineWidth,outlineStyle:s.outlineStyle,transform:s.transform,order:s.zIndex,drawn:n.classList.contains('drawn'),hit:(()=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2));})(),
        clipping:[s.overflow,s.clipPath],shadow:s.boxShadow};})};
    });
    const label=JSON.stringify({size,scenario:scenario.name});
    assert.equal(data.tiles.length,scenario.count,label);assert.equal(data.wrap,'nowrap',label);
    const first=data.tiles[0],baseline=results[0];
    if(baseline){assert.equal(first.width,baseline.width,label);assert.equal(first.height,baseline.height,label);assert.equal(data.gap,baseline.gap,label);assert.equal(first.radius,baseline.radius,label);}
    assert.ok(Math.abs(parseFloat(first.width)/parseFloat(first.height)-5/7)<.001,label);
    assert.ok(data.tiles.every((t,i)=>t.left>=data.box.left-.5&&t.right<=data.box.right+.5&&(!i||t.left>data.tiles[i-1].left)),label);
    for(const [index,tile]of data.tiles.entries()) {
      assert.equal(tile.width,first.width,label);assert.equal(tile.height,first.height,label);
      assert.equal(tile.rightBorder,'0px',label);assert.equal(tile.side,'0px',label);assert.equal(tile.bodySide,'0px',label);
      assert.equal(tile.bottomBorder,'1px',label);assert.ok(tile.bottomDepth>0,'existing bottom depth is retained');
      assert.equal(tile.pointer,'none',label);assert.equal(tile.z,'2',label);assert.equal(tile.hit,true,label);assert.deepEqual(tile.clipping,['visible','none'],label);
      if(index>=scenario.count-2){assert.ok(tile.sideSizes.every(w=>w>=1&&w<=2),label);assert.match(tile.paint,/linear-gradient\(rgb\(105, 187, 136\)/,label);}
      else {assert.ok(tile.sideSizes.every(w=>w===0),label);assert.ok(!tile.paint.includes('gradient'),label);}
    }
    assert.deepEqual(data.tiles.at(-1).sideSizes,data.tiles.at(-2).sideSizes,label);
    assert.equal(data.tiles.at(-1).paint,data.tiles.at(-2).paint,label);
    if(scenario.state) {
      const tile=data.tiles[scenario.index];assert.ok(parseFloat(tile.outline)>0&&tile.outlineStyle==='solid',label);
      assert.equal(tile.order,scenario.state==='selected'?'2':'1',label);
      if(scenario.state==='selected')assert.notEqual(tile.transform,'none',label);
      await page.evaluate(({state,index})=>document.querySelectorAll('#hand button')[index].classList.remove(state),scenario);
      const restored=await page.evaluate(async index=>{const n=document.querySelectorAll('#hand button')[index];await Promise.all(n.getAnimations().map(a=>a.finished.catch(()=>{})));const s=getComputedStyle(n);return {width:s.width,height:s.height,outline:s.outlineWidth,outlineStyle:s.outlineStyle,transform:s.transform,side:getComputedStyle(n,'::after').backgroundSize};},scenario.index);
      assert.equal(restored.width,first.width);assert.equal(restored.height,first.height);assert.equal(restored.outline,normal.outline);assert.equal(restored.outlineStyle,normal.outlineStyle);assert.equal(restored.transform,normal.transform);assert.equal(restored.side,normal.side);
    }
    results.push({name:scenario.name,width:first.width,height:first.height,gap:data.gap,radius:first.radius,count:scenario.count,painted:data.tiles.map((t,i)=>t.sideSizes[0]>0?i:null).filter(i=>i!==null),sideWidths:data.tiles.slice(-2).map(t=>t.sideSizes[0]),drawn:data.tiles.at(-1).drawn,outline:scenario.state||null});
  }
  return {size,cases:results};
}
