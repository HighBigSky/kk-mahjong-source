import assert from 'node:assert/strict';

// 仅测试本家现有 DOM 的顶面、正面与侧面，不发送游戏动作，不用截图判断材质。
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
      game.events=['立牌顶面与露侧样式验收'];window.renderMahjong();
      if(s.state){const target=document.querySelectorAll('#hand button')[s.index],style=getComputedStyle(target),normal={outline:style.outlineWidth,outlineStyle:style.outlineStyle,transform:style.transform,side:getComputedStyle(target,'::after').backgroundSize};target.classList.add(s.state);return normal;}
      return null;
    },scenario);
    await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all([...document.querySelectorAll('#hand button')].flatMap(n=>n.getAnimations().map(a=>a.finished.catch(()=>{}))));});
    const data=await page.evaluate(()=>{
      const hand=document.querySelector('#hand'),rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
      // 按 CSS 函数括号分层，不能把 rgba() 内的逗号当作另一层材质。
      const splitPaint=value=>{let depth=0,start=0;const layers=[];for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;else if(value[i]===')')depth--;else if(value[i]===','&&depth===0){layers.push(value.slice(start,i).trim());start=i+1;}}layers.push(value.slice(start).trim());return layers;};
      const shadows=value=>splitPaint(value).map(layer=>({inset:layer.includes('inset'),px:[...layer.matchAll(/(-?[\d.]+)px/g)].map(m=>Number(m[1]))}));
      const nodes=[...hand.children];
      // Chromium 命中测试有约 1px 的探测容差；微缝覆盖必须按浮点牌框判断，不能据此误报重叠。
      const gaps=nodes.slice(0,-1).map((n,i)=>{const a=n.getBoundingClientRect(),b=nodes[i+1].getBoundingClientRect(),x=(a.right+b.left)/2,y=(Math.max(a.top,b.top)+Math.min(a.bottom,b.bottom))/2;return {width:b.left-a.right,drawn:nodes[i+1].classList.contains('drawn'),covered:nodes.some(tile=>{const r=tile.getBoundingClientRect();return x>=r.left&&x<r.right&&y>=r.top&&y<r.bottom;})};});
      return {gap:getComputedStyle(hand).gap,wrap:getComputedStyle(hand).flexWrap,box:rect(hand),gaps,tiles:nodes.map(n=>{const s=getComputedStyle(n),after=getComputedStyle(n,'::after'),before=getComputedStyle(n,'::before'),layers=after.backgroundSize.split(','),svg=n.querySelector('svg'),faceLayers=splitPaint(before.backgroundImage);return {
        ...rect(n),width:s.width,height:s.height,radius:s.borderRadius,rightBorder:s.borderRightWidth,bottomBorder:s.borderBottomWidth,
        topDepth:parseFloat(layers[0].trim().split(/\s+/)[1]),sideSizes:layers.slice(1).map(value=>parseFloat(value)),paint:after.backgroundImage,pointer:after.pointerEvents,z:after.zIndex,
        coatRadius:after.borderRadius,coatInset:[after.top,after.right,after.bottom,after.left],coatBorder:after.borderWidth,
        faceBorder:before.borderBottomWidth,faceBackground:before.backgroundImage,svgBottomGap:n.getBoundingClientRect().bottom-svg.getBoundingClientRect().bottom,
        bodyDepth:s.getPropertyValue('--tile-depth').trim(),
        bevelOuter:Math.abs(shadows(before.boxShadow)[2].px[0]),bevelInner:Number((shadows(before.boxShadow)[4].px[3]-Math.abs(shadows(before.boxShadow)[2].px[0])).toFixed(4)),
        faceShadows:shadows(before.boxShadow),faceLayerKinds:faceLayers.map(layer=>layer.split('(')[0]),
        glazeAlphas:[...faceLayers.find(layer=>layer.startsWith('linear-gradient')).matchAll(/rgba\([^()]*,\s*([\d.]+)\)/g)].map(m=>Number(m[1])),
        materialRadials:faceLayers.filter(layer=>layer.startsWith('radial-gradient')).length,
        groundLayers:splitPaint(s.getPropertyValue('--tile-model-contact-shadow')).length,
        coatShadows:shadows(after.boxShadow),filters:[s,before,after,getComputedStyle(svg)].flatMap(style=>[style.filter,style.backdropFilter]),
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
    for(const gap of data.gaps){assert.ok(gap.width>0,label);if(!gap.drawn)assert.ok(Math.abs(gap.width-parseFloat(data.gap))<.05,label);assert.equal(gap.covered,false,JSON.stringify({label,gap}));}
    for(const [index,tile]of data.tiles.entries()) {
      assert.equal(tile.width,first.width,label);assert.equal(tile.height,first.height,label);
      assert.equal(tile.rightBorder,'0px',label);assert.equal(tile.side,'0px',label);assert.equal(tile.bodySide,'0px',label);
      assert.equal(tile.bottomBorder,'0px',label);assert.equal(tile.faceBorder,'0px',label);
      assert.equal(tile.bodyDepth,'0px',label);assert.equal(tile.bottomDepth,0,'face reaches the bottom without a bottom plane');
      assert.ok(Math.abs(tile.svgBottomGap)<.05,'SVG reaches the tile bottom');
      assert.ok(tile.topDepth>=1&&tile.topDepth<=2,'each hand tile has a 1–2px top plane');
      assert.match(tile.paint,/linear-gradient\(rgb\(255, 254, 249\)/,label);
      assert.match(tile.faceBackground,/at 82% 8%/,'glaze light comes from the upper right');
      assert.equal(tile.bevelOuter,1,label);assert.ok(tile.bevelInner>0&&tile.bevelInner<=1,label);
      assert.deepEqual(tile.faceShadows,[{inset:true,px:[0,0,0,1]},{inset:true,px:[1,0,1,0]},{inset:true,px:[-1,1,0,0]},{inset:true,px:[1,-1,0,0]},{inset:true,px:[0,0,0,tile.bevelOuter+tile.bevelInner]}],'integer-pixel transmission, contact shadow and dual bevel');
      assert.equal(tile.faceLayerKinds.filter(kind=>kind==='linear-gradient').length,3,label);assert.equal(tile.materialRadials,2,label);
      assert.ok(tile.faceLayerKinds.includes('repeating-linear-gradient'),'fine resin grain');
      assert.ok(tile.faceLayerKinds.every(kind=>kind==='linear-gradient'||kind==='radial-gradient'||kind==='repeating-linear-gradient'),label);
      assert.ok(tile.glazeAlphas.length>0&&Math.max(...tile.glazeAlphas)<=.08,'diagonal glaze never exceeds 8%');
      assert.equal(tile.groundLayers,3,'three ground shadow layers are retained');
      assert.ok(tile.coatShadows.every(shadow=>shadow.inset),'green side paint and its shadows stay inside the rounded tile');
      assert.ok(tile.filters.every(value=>value==='none'),'material uses no filter or backdrop-filter');
      assert.equal(tile.coatRadius,tile.radius,'top and side share a rounded canvas');
      assert.deepEqual(tile.coatInset,['0px','0px','0px','0px'],label);assert.equal(tile.coatBorder,'0px',label);
      assert.equal(tile.pointer,'none',label);assert.equal(tile.z,'2',label);assert.equal(tile.hit,true,label);assert.deepEqual(tile.clipping,['visible','none'],label);
      if(index>=scenario.count-2){assert.ok(tile.sideSizes.every(w=>w>=1&&w<=2),label);assert.match(tile.paint,/linear-gradient\(rgb\(105, 187, 136\)/,label);}
      else {assert.ok(tile.sideSizes.every(w=>w===0),label);assert.doesNotMatch(tile.paint,/rgb\(105, 187, 136\)/,label);}
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
    results.push({name:scenario.name,width:first.width,height:first.height,gap:data.gap,radius:first.radius,count:scenario.count,topDepths:data.tiles.map(t=>t.topDepth),bottomInsets:data.tiles.map(t=>t.bottomDepth),maxSvgBottomGap:Math.max(...data.tiles.map(t=>Math.abs(t.svgBottomGap))),painted:data.tiles.map((t,i)=>t.sideSizes[0]>0?i:null).filter(i=>i!==null),sideWidths:data.tiles.slice(-2).map(t=>t.sideSizes[0]),drawn:data.tiles.at(-1).drawn,outline:scenario.state||null,bevel:{outer:first.bevelOuter,inner:first.bevelInner},contact:first.faceShadows[1],glazeAlpha:Math.max(...first.glazeAlphas),materialRadials:first.materialRadials,gapCoverage:data.gaps.map(g=>g.covered),filters:first.filters});
  }
  return {size,cases:results};
}
