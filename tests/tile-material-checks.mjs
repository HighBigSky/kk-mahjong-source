import assert from 'node:assert/strict';

// 仅检查真实牌框及绘制属性，展示夹具不发送游戏动作、不改变规则与生产 DOM。
export async function materialSnapshot(page,selector,validate=true) {
  const rows=await page.locator(selector).evaluateAll(nodes=>{
    const split=value=>{let depth=0,start=0;const list=[];for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;else if(value[i]===')')depth--;else if(value[i]===','&&!depth){list.push(value.slice(start,i));start=i+1;}}list.push(value.slice(start));return list;};
    return nodes.filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden').map((n,index)=>{
      const s=getComputedStyle(n),b=getComputedStyle(n,'::before'),a=getComputedStyle(n,'::after'),r=n.getBoundingClientRect(),svg=n.querySelector('svg'),svgStyle=svg&&getComputedStyle(svg);
      const number=name=>Number(s.getPropertyValue(name).replace('deg','').trim());
      const px=name=>parseFloat(s.getPropertyValue(name));
      const angle=s.transform==='none'?0:Math.atan2(new DOMMatrix(s.transform).b,new DOMMatrix(s.transform).a)*180/Math.PI;
      const rotate=(x,y)=>{const t=angle*Math.PI/180;return [x*Math.cos(t)-y*Math.sin(t),x*Math.sin(t)+y*Math.cos(t)];};
      return {
        shape:{width:s.width,height:s.height,radius:s.borderRadius,borderWidths:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth],rect:[r.x,r.y,r.width,r.height],margin:s.margin,gap:getComputedStyle(n.parentElement).gap,transform:s.transform,svg:svgStyle?[svgStyle.width,svgStyle.height,svgStyle.transform,svg.getAttribute('viewBox')]:null},
        version:s.getPropertyValue('--tile-model-version').trim(),grade:s.getPropertyValue('--tile-model-grade').trim(),strength:number('--tile-model-strength'),
        back:n.classList.contains('back'),wall:n.classList.contains('wall-piece'),
        paint:n.classList.contains('back')?s.backgroundImage:b.backgroundImage,paintLayers:split(n.classList.contains('back')?s.backgroundImage:b.backgroundImage).map(v=>v.trim()),body:s.backgroundImage,bevel:split(b.boxShadow).map(v=>({inset:v.includes('inset'),px:[...v.matchAll(/(-?(?:\d*\.?\d+)(?:e[+-]?\d+)?)px/g)].map(m=>Number(m[1]))})),
        ivory:s.getPropertyValue('--tile-ivory').trim(),faceColors:['--tile-face-light','--tile-face-base','--tile-ivory','--tile-face-shade'].map(name=>s.getPropertyValue(name).trim()),curve:s.getPropertyValue('--tile-model-face-curve').trim(),
        modelWidth:px('--tile-model-width'),corners:[s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomRightRadius,s.borderBottomLeftRadius].map(parseFloat),
        faceCorners:[b.borderTopLeftRadius,b.borderTopRightRadius,b.borderBottomRightRadius,b.borderBottomLeftRadius].map(parseFloat),
        coatCorners:[a.borderTopLeftRadius,a.borderTopRightRadius,a.borderBottomRightRadius,a.borderBottomLeftRadius].map(parseFloat),backInset:parseFloat(b.top),
        projectedCorners:index===0?window.visualGeometry.quad(n):null,
        svgCorners:svgStyle?[svgStyle.borderTopLeftRadius,svgStyle.borderTopRightRadius,svgStyle.borderBottomRightRadius,svgStyle.borderBottomLeftRadius].map(parseFloat):null,
        svgAngle:svgStyle&&svgStyle.transform!=='none'?Math.atan2(new DOMMatrix(svgStyle.transform).b,new DOMMatrix(svgStyle.transform).a)*180/Math.PI:0,
        glyph:svgStyle?split(svgStyle.boxShadow).map(v=>({inset:v.includes('inset'),px:[...v.matchAll(/(-?(?:\d*\.?\d+)(?:e[+-]?\d+)?)px/g)].map(m=>Number(m[1]))})):[],
        thickness:px('--tile-model-thickness'),ground:split(s.boxShadow).map(v=>({inset:v.includes('inset'),px:[...v.matchAll(/(-?(?:\d*\.?\d+)(?:e[+-]?\d+)?)px/g)].map(m=>Number(m[1])),alpha:Number(v.match(/rgba\([^()]*,\s*([\d.]+)\)/)?.[1]??1)})),
        pseudoCount:[b,a].filter(style=>style.content!=='none'&&style.content!=='normal').length,
        filters:[s,b,a,...(svgStyle?[svgStyle]:[])].flatMap(style=>[style.filter,style.backdropFilter]),
        topSizes:a.backgroundSize,topSize:px('--tile-model-top-size'),rightSize:px('--tile-model-right-size'),backIvorySize:px('--tile-model-back-ivory-size'),bottom:b.bottom,coating:[a.backgroundImage,a.borderRadius,a.boxShadow],
        edgeLayers:split(a.backgroundImage).map(v=>v.trim()),edgeSizes:a.backgroundSize.split(',').map(v=>v.trim()),edgePositions:a.backgroundPosition.split(',').map(v=>v.trim()),
        edgeShadow:split(a.boxShadow).map(v=>({inset:v.includes('inset'),px:[...v.matchAll(/(-?(?:\d*\.?\d+)(?:e[+-]?\d+)?)px/g)].map(m=>Number(m[1]))})),edgeBorder:a.borderWidth,edgeInset:[a.top,a.right,a.bottom,a.left],
        groundCount:split(s.getPropertyValue('--tile-model-contact-shadow')).length,
        light:rotate(px('--tile-model-light-x'),px('--tile-model-light-y')),
        shadow:rotate(number('--tile-model-shadow-x'),number('--tile-model-shadow-y')),
        main:rotate(number('--tile-model-main-x'),number('--tile-model-main-y')),
        soft:rotate(number('--tile-model-soft-x'),number('--tile-model-soft-y')),
        angle,gradientAngle:Number(split(n.classList.contains('back')?s.backgroundImage:b.backgroundImage).map(v=>v.trim()).find(v=>v.startsWith('linear-gradient'))?.match(/linear-gradient\(([-\d.]+)deg/)?.[1]),
      };
    });
  });
  assert.ok(rows.length,`material area exists: ${selector}`);
  if(validate)for(const row of rows) {
    assert.equal(row.version,'resin-v10',selector);assert.ok(row.strength>0&&row.strength<=1,selector);
    const physicalWidth=Math.min(parseFloat(row.shape.width),parseFloat(row.shape.height)),radius=physicalWidth*.09;
    assert.ok(Math.abs(row.modelWidth-physicalWidth)<.0001,`${selector} radius is based on the actual physical tile width`);
    assert.ok(row.corners.every(v=>v>0&&Math.abs(v-radius)<.0001),`${selector} all four corners share the same radius at ${row.angle}deg`);
    assert.ok(row.corners.every(v=>v/physicalWidth<=.12),`${selector} rounded rectangle radius stays within 12% of physical tile width`);
    assert.deepEqual(row.coatCorners,row.corners,`${selector} top and side coating follows all four frame corners`);
    assert.ok(row.faceCorners.every((v,i)=>Math.abs(v-(row.back?Math.max(0,row.corners[i]-row.backInset):row.corners[i]))<.0001),`${selector} face bevel or inset back frame follows the same four-corner profile`);
    if(row.svgCorners)assert.ok(row.svgCorners.every(v=>Math.abs(v-radius)<.0001),`${selector} internal SVG keeps the same four rounded corners independently of rotation`);
    const splitPaint=value=>{let depth=0,start=0;const layers=[];for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;else if(value[i]===')')depth--;else if(value[i]===','&&!depth){layers.push(value.slice(start,i).trim());start=i+1;}}layers.push(value.slice(start).trim());return layers;};
    const stops=paint=>splitPaint(paint.slice(paint.indexOf('(')+1,-1)).filter(part=>/^(?:rgba?\(|#|transparent\b)/.test(part));
    const layers=row.edgeLayers,top=row.back?4:9,side=10;
    assert.equal(layers.length,row.back?6:11,`${selector} visible edges share one rounded coating canvas`);
    assert.match(layers[top],/^linear-gradient\(/,`${selector} curved top transition`);
    assert.ok(stops(layers[top]).length>=5,`${selector} top edge has gradual highlight, middle and shade colors`);
    if(row.rightSize>0){
      assert.match(layers[side],/^linear-gradient\(90deg/,`${selector} side transitions from face to rear`);
      assert.ok(stops(layers[side]).length>=5,`${selector} side transition has intermediate colors`);
      assert.match(layers[0],/^radial-gradient\(/,`${selector} side curvature varies vertically and horizontally`);
      assert.ok(stops(layers[0]).length>=5,`${selector} side curvature includes soft highlight and lower shade`);
    }
    const caps=row.back?[[0,'top',0,0,false],[1,'top',100,0,false],[2,'top',0,0,true],[3,'top',100,0,true]]:[[1,'side',100,0,false],[2,'side',100,100,false],[3,'side',100,0,true],[4,'side',100,100,true],[5,'top',0,0,false],[6,'top',100,0,false],[7,'top',0,0,true],[8,'top',100,0,true]];
    for(const [index,kind,x,y,ring]of caps){
      const size=row.edgeSizes[index].split(/\s+/).map(parseFloat),active=(kind==='top'?row.topSize:row.rightSize)>0,expected=active?radius:0;
      assert.ok(size.length===2&&size.every(value=>Math.abs(value-expected)<.0001),`${selector} ${kind} corner cap follows the existing radius without widening the edge`);
      assert.deepEqual(row.edgePositions[index].split(/\s+/).map(parseFloat),[x,y],`${selector} corner caps meet at the correct tangent`);
      if(active){
        assert.match(layers[index],/^radial-gradient\(/,`${selector} corner paint follows a circular arc`);
        assert.ok(stops(layers[index]).length>=(ring?5:3),`${selector} curved ${kind} ${ring?'ring':'glaze'} has blended color stops`);
        if(ring)assert.match(stops(layers[index])[0],/^rgba\([^()]*,\s*0\)/,`${selector} curved ring begins transparent toward the face`);
      }
    }
    assert.equal(row.edgeBorder,'0px',`${selector} corner joins do not add a second border`);
    assert.deepEqual(row.edgeInset,['0px','0px','0px','0px'],`${selector} curved edge remains inside the original tile frame`);
    assert.ok(row.edgeShadow.length===1&&row.edgeShadow.every(shadow=>shadow.inset),`${selector} soft continuous inner highlight never projects onto another tile`);
    assert.deepEqual([row.thickness,row.strength],({hand:[4,1],meld:[3,.8],wall:[2,.6],river:[1,.4]})[row.grade],`${selector} only four shared tiers`);
    assert.ok(row.bevel.length===2&&row.bevel.every(shadow=>shadow.inset),selector);
    assert.equal((row.paint.match(/radial-gradient/g)||[]).length,row.back?2:3,selector);
    const rgb=value=>value.startsWith('#')?[1,3,5].map(index=>parseInt(value.slice(index,index+2),16)):(value.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
    assert.deepEqual(row.faceColors.map(rgb),[[255,254,246],[246,239,221],[246,239,221],[232,223,201]],`${selector} all areas share the same ivory palette`);
    if(!row.back)assert.match(row.curve,/^radial-gradient\(/,`${selector} shared subtle convex face light`);
    assert.match(row.paint,/linear-gradient/);assert.doesNotMatch(row.paint,/url\(/);
    const textureLayers=row.paint.match(/repeating-linear-gradient\([^;]*?(?=\), (?:repeating-|linear-|radial-)|$)/g)||[];
    assert.equal((row.paint.match(/repeating-linear-gradient/g)||[]).length,row.back?2:1,selector);
    for(const texture of textureLayers)for(const match of texture.matchAll(/rgba\([^()]*,\s*([\d.]+)\)/g))assert.ok(Number(match[1])<=(row.back?.06:.05),`${selector} texture opacity`);
    // 两层内影均在本张牌框；接触/短投影随宽度和档位推导。
    assert.equal(row.ground.length,2,selector);
    for(const [index,shadow]of row.ground.entries()) {
      assert.equal(shadow.inset,true,selector);
      // 牌墙当前摸/补槽的第二层仍为原描边环；它替代主影以遵守两层预算。
      if(index===1&&shadow.px[0]===0&&shadow.px[1]===0&&shadow.px[2]===0&&shadow.px[3]>0)continue;
      const unit=[.025,.045][index]*row.strength*row.modelWidth;
      const t=row.angle*Math.PI/180,[x,y]=shadow.px;
      assert.ok(Math.abs(x*Math.cos(t)-y*Math.sin(t)-unit)<.0001,selector+' inward left edge: '+JSON.stringify({index,shadow,unit,angle:row.angle}));
      assert.ok(Math.abs(x*Math.sin(t)+y*Math.cos(t)+unit*.25)<.0001,selector+' common slope');
      assert.ok(Math.abs(shadow.px[2]-unit)<.0001,selector+' common proportional blur');
    }
    if(!row.back)assert.ok(row.glyph.length===2&&row.glyph.every(v=>v.inset&&v.px.every(x=>Math.abs(x)<=1)),`${selector} recessed glyph region <= 1px`);
    assert.ok(row.pseudoCount<=2,selector);
    assert.ok(row.filters.every(filter=>filter==='none'),selector);assert.equal(row.groundCount,2,selector);
    {
      if(!row.back)assert.equal(row.bottom,'0px',selector);
      assert.ok(row.bevel.every(shadow=>shadow.inset),selector+' bevels stay in frame');
      if(!row.back)assert.ok(Math.abs(Math.hypot(...row.bevel[0].px.slice(0,2))/row.modelWidth-Math.hypot(1,.25)*.025)<.0001,'right-side outer bevel follows common light');
    }
    for(const name of ['light','shadow','main'])assert.ok(row[name].every((v,i)=>Math.abs(v-[-1,.25][i])<1e-6),`${selector} ${name}: ${row[name]}`);
    assert.ok(Math.abs(((row.gradientAngle+row.angle-255)%360+360)%360)<1e-6,`${selector} global glaze direction`);
    if(row.back){assert.match(row.body,/rgb\(119, 211, 154\)/);assert.ok(row.bevel.length===2,`${selector} embossed green back`);}
  }
  return rows;
}

export async function checkMaterialAreas(page,{baseline=false}={}) {
  const areas={hand:'#hand .tile',...Object.fromEntries([0,1,2,3].flatMap(seat=>[[`river-${seat}`,`#river-${seat} .tile`],[`meld-${seat}`,`#melds-${seat} .tile`]])),...Object.fromEntries([1,2,3].map(seat=>[`backs-${seat}`,`#backs-${seat} .back`])),wall:'#wall-tail .wall-piece.back',indicator:'#wall-tail .wall-piece.is-indicator.tile',marker:'.topbar .laizi-summary .tile'};
  const result={};for(const [name,selector]of Object.entries(areas))result[name]=await materialSnapshot(page,selector,!baseline);
  if(!baseline) {
    for(const seat of [0,1,2,3]) {
      assert.ok(result[`river-${seat}`].every(row=>row.topSize>0&&row.rightSize===0),'rivers expose the local top edge toward table center only');
      const melds=result[`meld-${seat}`];assert.ok(melds.every(row=>row.topSize>0),'meld tops');assert.ok(melds.filter(row=>row.rightSize>0).length<=2,'only the terminal one or two melds expose a right side');
    }
    assert.ok([...result.wall,...result.indicator].every(row=>row.topSize>0),'wall tops are visible');
    assert.ok(result.wall.every(row=>row.backIvorySize===0),'wall has no lower ivory plane');
    const groups=[result.hand,result['meld-0'],result.wall,result['river-0']];
    assert.deepEqual(groups.map(rows=>rows[0].thickness),[4,3,2,1],'hand > meld > wall > river thickness');
    assert.deepEqual(groups.map(rows=>rows[0].strength),[1,.8,.6,.4],'contact shadow strength follows thickness');
    assert.ok(groups.every(rows=>{const row=rows.find(row=>row.ground[1].px[2]>0);return row&&Math.abs(row.ground[1].px[2]/row.modelWidth-.045*row.strength)<.0001;}),'short main shadow is proportional to actual width and tier');
    const contactAlpha=groups.map(rows=>rows[0].ground[0].alpha);assert.ok(contactAlpha.every((value,index)=>!index||value<contactAlpha[index-1]),'rendered contact opacity decreases with thickness');
    for(const seat of [0,1,2,3]){assert.ok(result[`river-${seat}`].every(row=>row.thickness===1&&row.strength===.4));assert.ok(result[`meld-${seat}`].every(row=>row.thickness===3&&row.strength===.8));}
    // 在完整桌面透视后验证径向高光仍在右侧略偏前上方，不只检查局部渐变角度。
    const highlights=await page.evaluate(()=>[0,1,2,3].map(seat=>{
      const node=document.querySelector(`#river-${seat} .tile`),s=getComputedStyle(node),corners=window.visualGeometry.quad(node);
      const point=(x,y)=>({x:corners[0].x*(1-x)*(1-y)+corners[1].x*x*(1-y)+corners[2].x*x*y+corners[3].x*(1-x)*y,y:corners[0].y*(1-x)*(1-y)+corners[1].y*x*(1-y)+corners[2].y*x*y+corners[3].y*(1-x)*y});
      const highlight=point(parseFloat(s.getPropertyValue('--tile-model-shine-x'))/100,parseFloat(s.getPropertyValue('--tile-model-shine-y'))/100),center=point(.5,.5);
      return {seat,dx:highlight.x-center.x,dy:highlight.y-center.y};
    }));
    assert.ok(highlights.every(p=>p.dx>0&&p.dy<0),`four projected highlights remain upper right: ${JSON.stringify(highlights)}`);
  }
  return result;
}
