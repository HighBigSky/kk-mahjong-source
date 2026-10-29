import assert from 'node:assert/strict';

// 仅检查真实牌框及绘制属性，展示夹具不发送游戏动作、不改变规则与生产 DOM。
export async function materialSnapshot(page,selector,validate=true) {
  const rows=await page.locator(selector).evaluateAll(nodes=>{
    const split=value=>{let depth=0,start=0;const list=[];for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;else if(value[i]===')')depth--;else if(value[i]===','&&!depth){list.push(value.slice(start,i));start=i+1;}}list.push(value.slice(start));return list;};
    return nodes.filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden').map(n=>{
      const s=getComputedStyle(n),b=getComputedStyle(n,'::before'),a=getComputedStyle(n,'::after'),r=n.getBoundingClientRect(),svg=n.querySelector('svg'),svgStyle=svg&&getComputedStyle(svg);
      const number=name=>Number(s.getPropertyValue(name).replace('deg','').trim());
      const px=name=>parseFloat(s.getPropertyValue(name));
      const angle=s.transform==='none'?0:Math.atan2(new DOMMatrix(s.transform).b,new DOMMatrix(s.transform).a)*180/Math.PI;
      const rotate=(x,y)=>{const t=angle*Math.PI/180;return [x*Math.cos(t)-y*Math.sin(t),x*Math.sin(t)+y*Math.cos(t)];};
      return {
        shape:{width:s.width,height:s.height,radius:s.borderRadius,borderWidths:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth],rect:[r.x,r.y,r.width,r.height],margin:s.margin,gap:getComputedStyle(n.parentElement).gap,transform:s.transform,svg:svgStyle?[svgStyle.width,svgStyle.height,svgStyle.transform,svg.getAttribute('viewBox')]:null},
        version:s.getPropertyValue('--tile-model-version').trim(),grade:s.getPropertyValue('--tile-model-grade').trim(),strength:number('--tile-model-strength'),
        back:n.classList.contains('back'),wall:n.classList.contains('wall-piece'),
        paint:b.backgroundImage,body:s.backgroundImage,bevel:split(b.boxShadow).map(v=>({inset:v.includes('inset'),px:[...v.matchAll(/(-?[\d.]+)px/g)].map(m=>Number(m[1]))})),
        filters:[s,b,a,...(svgStyle?[svgStyle]:[])].flatMap(style=>[style.filter,style.backdropFilter]),
        topSizes:a.backgroundSize,topSize:parseFloat(a.backgroundSize.split(',')[0].trim().split(/\s+/)[1]),rightSize:parseFloat(a.backgroundSize.split(',')[2]||'0'),bottom:b.bottom,coating:[a.backgroundImage,a.borderRadius,a.boxShadow],
        groundCount:split(s.getPropertyValue('--tile-model-contact-shadow')).length,
        light:rotate(px('--tile-model-light-x'),px('--tile-model-light-y')),
        shadow:rotate(number('--tile-model-shadow-x'),number('--tile-model-shadow-y')),
        main:rotate(number('--tile-model-main-x'),number('--tile-model-main-y')),
        soft:rotate(number('--tile-model-soft-x'),number('--tile-model-soft-y')),
        angle,gradientAngle:Number(b.backgroundImage.match(/linear-gradient\(([-\d.]+)deg/)?.[1]),
      };
    });
  });
  assert.ok(rows.length,`material area exists: ${selector}`);
  if(validate)for(const row of rows) {
    assert.equal(row.version,'resin-v2',selector);assert.ok(row.strength>0&&row.strength<=1,selector);
    assert.ok(row.bevel.length>=4&&row.bevel.every(shadow=>shadow.inset),selector);
    assert.equal((row.paint.match(/radial-gradient/g)||[]).length,2,selector);
    assert.match(row.paint,/linear-gradient/);assert.doesNotMatch(row.paint,/url\(/);
    assert.ok(row.filters.every(filter=>filter==='none'),selector);assert.equal(row.groundCount,3,selector);
    if(!row.back)assert.equal(row.bottom,'0px',selector);
    for(const [name,expected] of [['light',[-1,1]],['shadow',[-.1,.16]],['main',[-.2,.5]],['soft',[-.45,1]]])assert.ok(row[name].every((v,i)=>Math.abs(v-expected[i])<1e-6),`${selector} ${name}: ${row[name]}`);
    assert.ok(Math.abs(((row.gradientAngle+row.angle-215)%360+360)%360)<1e-6,`${selector} global glaze direction`);
    if(row.back){assert.match(row.body,/rgb\(119, 211, 154\)/);assert.ok(row.bevel.length>=6,`${selector} embossed green back`);}
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
    assert.ok(result.wall.every(row=>/100% 0px$/.test(row.topSizes)),'wall has no lower ivory plane');
  }
  return result;
}
