// 仅复制公开绘制属性，不读取牌型、不修改规则或动画轨迹。
const SELF_PROPERTIES = ['background', 'box-shadow', 'border-width', 'border-style', 'border-color', 'border-radius', 'overflow', 'isolation'];
const LAYER_PROPERTIES = {background:'background',shadow:'box-shadow','border-top':'border-top','border-right':'border-right','border-bottom':'border-bottom','border-left':'border-left',radius:'border-radius',top:'top',right:'right',bottom:'bottom',left:'left',width:'width',height:'height',transform:'transform'};
const SVG_PROPERTIES = {position:'position',top:'top',right:'right',bottom:'bottom',left:'left',width:'width',height:'height',transform:'transform',radius:'border-radius',shadow:'box-shadow'};
const metricCache=new WeakMap();
const contactPaintCache=new WeakMap(),contactNodeIds=new WeakMap();
let contactNodeId=0;
const used=value=>Math.round(value*64)/64;
const clean=value=>Math.abs(value)<1e-8?0:Number(value.toFixed(6));

// 只在真实牌缝的矩形内绘制背景，不改牌形、热区或选中状态；待定牌的宽间隔不涂满。
function paintHandSeams(hand) {
  if(!hand)return;
  const nodes=[...hand.children].filter(node=>node.matches('.tile'));
  const style=getComputedStyle(hand),rect=hand.getBoundingClientRect();
  const sx=rect.width/used(parseFloat(style.width)),sy=rect.height/used(parseFloat(style.height));
  const images=[],positions=[],sizes=[];
  if(sx>0&&sy>0)for(let index=1;index<nodes.length;index++){
    if(nodes[index].classList.contains('drawn'))continue;
    const left=nodes[index-1].getBoundingClientRect(),right=nodes[index].getBoundingClientRect();
    const gap=(right.left-left.right)/sx;
    if(!(gap>0&&gap<=1))continue;
    const height=Math.min(parseFloat(getComputedStyle(nodes[index-1]).height),parseFloat(getComputedStyle(nodes[index]).height));
    // 两边各退一个浏览器布局量子，避免计算样式的小数序列化误差越过牌缘。
    const guard=1/64,x=(left.right-rect.left)/sx+guard,y=rect.height/sy-parseFloat(style.paddingBottom)-height;
    images.push('var(--hand-seam-paint)');positions.push(`${clean(x)}px ${clean(y)}px`);sizes.push(`${clean(gap-guard*2)}px ${clean(height)}px`);
  }
  for(const [name,value]of Object.entries({'--hand-seam-images':images.join(',')||'none','--hand-seam-positions':positions.join(',')||'0 0','--hand-seam-sizes':sizes.join(',')||'auto'}))
    if(hand.style.getPropertyValue(name)!==value)hand.style.setProperty(name,value);
}

// 牌体只旋转了 SVG 时不补偿材质；以整牌真实 transform 为准。
export function syncTileMetric(node,box=null) {
  if(!node.matches('.tile,.back')||node.closest('#opening-deal'))return;
  const style=getComputedStyle(node),width=used(box?.width??parseFloat(style.width)),height=used(box?.height??parseFloat(style.height));
  if(!(width>0&&height>0))return;
  const matrix=style.transform==='none'?null:new DOMMatrix(style.transform);
  const angle=clean(matrix?Math.atan2(matrix.b,matrix.a)*180/Math.PI:0),svg=node.querySelector('svg'),ss=svg&&getComputedStyle(svg);
  // SVG旋转90度时需要交换真实正面宽高；复用本次测量，不增加观察器或改变牌框。
  const inner=(axis,start,end)=>used(parseFloat(style[axis]))+(style.boxSizing==='border-box'?-(parseFloat(style['border'+start+'Width'])+parseFloat(style['border'+end+'Width'])):parseFloat(style['padding'+start])+parseFloat(style['padding'+end]));
  const glyphWidth=inner('width','Left','Right'),glyphHeight=inner('height','Top','Bottom');
  // CSS场景参数是唯一光源；连同旋转一起反投影，左右牌河不能把灯随牌转走。
  const lamp={x:Number(style.getPropertyValue('--scene-shadow-x').trim()||-1),y:Number(style.getPropertyValue('--scene-shadow-y').trim()||.25),sx:parseFloat(style.getPropertyValue('--scene-light-x')||92)/100,sy:parseFloat(style.getPropertyValue('--scene-light-y')||32)/100};
  // 显隐或牌面单独旋转后，牌框可能没变；SVG 的尺寸/角度也必须参与材质缓存。
  const key=`${width}:${height}:${angle}:${ss?.width}:${ss?.height}:${ss?.transform}:${glyphWidth}:${glyphHeight}:${lamp.x}:${lamp.y}:${lamp.sx}:${lamp.sy}`;
  if(metricCache.get(node)===key)return;
  metricCache.set(node,key);
  const t=angle*Math.PI/180,c=Math.cos(t),s=Math.sin(t),inverse=(x,y)=>[clean(c*x+s*y),clean(-s*x+c*y)];
  const [lx,ly]=inverse(lamp.x,lamp.y),[ox,oy]=inverse(1,0),globalWidth=Math.abs(c)*width+Math.abs(s)*height,globalHeight=Math.abs(s)*width+Math.abs(c)*height;
  const point=(x,y)=>{const [px,py]=inverse((x-.5)*globalWidth,(y-.5)*globalHeight);return[clean((.5+px/width)*100),clean((.5+py/height)*100)];};
  const shine=point(lamp.sx,lamp.sy),grain=point(.18,.88),topLit=-lamp.x*s+lamp.y*c>0;
  const values={'--tile-model-width':`${Math.min(width,height)}px`,'--tile-model-turn':`${angle}deg`,'--tile-model-light-x':lx,'--tile-model-light-y':ly,'--tile-model-occlusion-x':ox,'--tile-model-occlusion-y':oy,'--tile-model-shine-x':`${shine[0]}%`,'--tile-model-shine-y':`${shine[1]}%`,'--tile-model-grain-x':`${grain[0]}%`,'--tile-model-grain-y':`${grain[1]}%`,'--tile-model-top-paint':topLit?'var(--tile-model-plane-lit)':'var(--tile-model-plane-shade)'};
  if(svg){values['--tile-glyph-box-width']=`${clean(glyphWidth)}px`;values['--tile-glyph-box-height']=`${clean(glyphHeight)}px`;}
  // 右侧略偏前上方的单灯：弧形顶边与直顶边共用同一次光照判定，旋转后不能出现一段亮、一段暗的接缝。
  values['--tile-model-top-curve-tones']=topLit?'var(--tile-model-curve-lit)':'var(--tile-model-curve-shade)';
  // 微描边使用已读取的牌宽给数值，不依赖移动浏览器较新的CSS量纲相除。
  values['--tile-model-glyph-accent']=clean(12/Math.min(width,height));
  values['--tile-model-axis-x']=ox;values['--tile-model-axis-y']=oy;
  const [downX,downY]=inverse(0,1);values['--tile-model-down-x']=downX;values['--tile-model-down-y']=downY;
  for(const prefix of ['shadow','main']){values[`--tile-model-${prefix}-x`]=lx;values[`--tile-model-${prefix}-y`]=ly;}
  for(const [name,value]of Object.entries(values))node.style.setProperty(name,String(value));
}

export function observeTileMetrics(root) {
  const hand=root.querySelector('.hand');
  const resize=new ResizeObserver(entries=>{let handChanged=false;for(const entry of entries){const box=entry.borderBoxSize?.[0]||entry.borderBoxSize;syncTileMetric(entry.target,box?{width:box.inlineSize,height:box.blockSize}:null);if(entry.target===hand||entry.target.parentElement===hand)handChanged=true;}if(handChanged)paintHandSeams(hand);});
  if(hand)resize.observe(hand);
  const cards=node=>node.nodeType===1?[...(node.matches('.tile,.back')?[node]:[]),...node.querySelectorAll('.tile,.back')]:[];
  const watch=node=>{if(!node.closest('#opening-deal')){resize.observe(node);syncTileMetric(node);}};
  for(const node of cards(root))watch(node);
  const mutations=new MutationObserver(records=>{
    for(const record of records)if(record.type==='childList'){
      for(const node of record.removedNodes)for(const card of cards(node))if(!card.isConnected)resize.unobserve(card);
      for(const node of record.addedNodes)for(const card of cards(node))watch(card);
    }else if(record.target.matches('.tile,.back'))watch(record.target);
    else if(record.target===root&&String(record.oldValue).split(/\s+/).includes('is-landscape')!==root.classList.contains('is-landscape'))for(const node of cards(root))watch(node);
    if(records.some(record=>record.target===hand||hand?.contains(record.target)))paintHandSeams(hand);
  });
  mutations.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class'],attributeOldValue:true});
  paintHandSeams(hand);
  return {disconnect(){resize.disconnect();mutations.disconnect();}};
}
// Blink 的 used 宽高以 1/64px 布局，但计算样式字符串只保留四位小数。
// 还原这个精度，避免复制 47.7812px 时被再次向下量化成 47.765625px。
const read=(style,properties)=>Object.fromEntries(Object.entries(properties).map(([name,property])=>{let value=style.getPropertyValue(property);if((property==='width'||property==='height')&&/^-?[\d.]+px$/.test(value))value=`${Math.round(parseFloat(value)*64)/64}px`;if(['border-top','border-right','border-bottom','border-left'].includes(property)&&!parseFloat(style.getPropertyValue(property+'-width')))value='0px none transparent';return[name,value];}));

export function captureTileMaterial(node) {
  syncTileMetric(node);
  const style=getComputedStyle(node),custom={};
  for(let index=0;index<style.length;index++){const name=style[index];if((name.startsWith('--tile-')||name.startsWith('--hand-'))&&!name.startsWith('--tile-snapshot-'))custom[name]=style.getPropertyValue(name);}
  const self=Object.fromEntries(SELF_PROPERTIES.map(name=>[name,style.getPropertyValue(name)]));
  // 输入锁解除会改变按钮 currentColor，但 0px 边框不参与绘制，不应算作材质跳色。
  if(self['border-width'].split(/\s+/).every(value=>parseFloat(value)===0))self['border-color']='rgba(0, 0, 0, 0)';
  return {custom,self,before:read(getComputedStyle(node,'::before'),LAYER_PROPERTIES),after:read(getComputedStyle(node,'::after'),LAYER_PROPERTIES),svg:node.querySelector('svg')?read(getComputedStyle(node.querySelector('svg')),SVG_PROPERTIES):null};
}

export function applyTileMaterial(node,material,copyLayers=true) {
  for(const [name,value]of Object.entries(material.custom))node.style.setProperty(name,value);
  for(const [name,value]of Object.entries(material.self))node.style.setProperty(name,value);
  if(!copyLayers)return;
  node.classList.add('tile-material-snapshot');
  for(const layer of ['before','after','svg'])if(material[layer])for(const [name,value]of Object.entries(material[layer]))node.style.setProperty(`--tile-snapshot-${layer}-${name}`,value);
}

// 在现有牌区背景上画接触影，牌体始终在其上方；不新增元素或改变牌位。
// plane 是已有桌面布局器测得的投影，避免用屏幕包围盒近似透视后的牌缝。
export function paintContactShadows(stage, plane) {
  const stageBox=stage.getBoundingClientRect(),scene=getComputedStyle(stage),enabled=scene.getPropertyValue('--scene-ground-enabled').trim()==='1';
  const config=['--scene-ground-reach-ratio','--scene-ground-ao-ratio','--scene-shadow-x','--scene-shadow-y','--scene-shadow-ink',...['hand','meld','river','wall','back'].map(k=>'--scene-ground-'+k+'-strength')].map(k=>scene.getPropertyValue(k)).join(':');
  const parents=stage.querySelectorAll('.river,.hand,.opponent-rack .backs,.meld-group,.flat-wall-run');
  const write=(node,images=[],positions=[],sizes=[])=>{
    for(const [key,value]of Object.entries({'images':images.join(',')||'none','positions':positions.join(',')||'0 0','sizes':sizes.join(',')||'auto'})){
      const name='--tile-ground-'+key;if(node.style.getPropertyValue(name)!==value)node.style.setProperty(name,value);
    }
  };
  for(const parent of parents) {
    if(!enabled||!parent.getClientRects().length){write(parent);contactPaintCache.delete(parent);continue;}
    const wall=parent.classList.contains('flat-wall-run');
    const cards=[...parent.querySelectorAll(wall?'.wall-piece:not(.is-empty)':':scope > .tile,:scope > .back')].filter(n=>n.getClientRects().length);
    const rect=parent.getBoundingClientRect(),ps=getComputedStyle(parent);
    // 重复快照/布局不重新测投影；一处出牌只更新相关牌河、手牌及牌墙段。
    // 节点身份、牌序、格位、状态、区域矩形和光照全部入缓存，不能按牌数单独缓存。
    const ids=cards.map(n=>{if(!contactNodeIds.has(n))contactNodeIds.set(n,++contactNodeId);return [contactNodeIds.get(n),n.className,n.style.gridColumn,n.style.gridRow,n.style.transform,n.style.width,n.style.height].join(':');}).join('|');
    const key=[config,stageBox.width,stageBox.height,rect.x,rect.y,rect.width,rect.height,ps.transform,ps.width,ps.height,ids].join(';');
    if(contactPaintCache.get(parent)===key)continue;
    const matrix=plane(parent);
    // 当前相机是无横向偏航的桌面投影；不支持的非平面投影不猜测暗区位置。
    if(!matrix||Math.abs(matrix[3])>1e-6||Math.abs(matrix[6])>1e-6){write(parent);continue;}
    const yAt=y=>(y*matrix[8]-matrix[5])/(matrix[4]-y*matrix[7]);
    const xAt=(x,y)=>(x*(matrix[7]*y+matrix[8])-matrix[1]*y-matrix[2])/matrix[0];
    const local=node=>{
      const r=node.getBoundingClientRect(),top=yAt(r.top-stageBox.top),bottom=yAt(r.bottom-stageBox.top);
      return {left:Math.max(xAt(r.left-stageBox.left,top),xAt(r.left-stageBox.left,bottom)),right:Math.min(xAt(r.right-stageBox.left,top),xAt(r.right-stageBox.left,bottom)),top,bottom};
    };
    const boxes=cards.map(node=>{
      const s=getComputedStyle(node),box=local(node);
      return {...box,node,width:Math.min(used(parseFloat(s.width)),used(parseFloat(s.height))),strength:Number(s.getPropertyValue('--tile-ground-strength')),stack:wall?Number(node.parentElement.style.getPropertyValue('--wall-stack-index')):null};
    });
    let contacts=boxes;
    if(wall) {
      // 相邻且仍有实牌的墩合成一段；已取空的墩不留“幽灵坐影”。
      contacts=[];
      for(const stack of [...new Set(boxes.map(b=>b.stack))].sort((a,b)=>a-b)){
        const tiles=boxes.filter(b=>b.stack===stack),last=contacts.at(-1);
        const next={...tiles[0],left:Math.min(...tiles.map(b=>b.left)),right:Math.max(...tiles.map(b=>b.right)),top:Math.min(...tiles.map(b=>b.top)),bottom:Math.max(...tiles.map(b=>b.bottom)),lastStack:stack};
        if(last&&last.lastStack+1===stack){last.left=Math.min(last.left,next.left);last.right=Math.max(last.right,next.right);last.top=Math.min(last.top,next.top);last.bottom=Math.max(last.bottom,next.bottom);last.lastStack=stack;}
        else contacts.push(next);
      }
    }
    const images=[],positions=[],sizes=[],style=scene;
    const reachRatio=Number(style.getPropertyValue('--scene-ground-reach-ratio')),aoRatio=Number(style.getPropertyValue('--scene-ground-ao-ratio'));
    const dx=Number(style.getPropertyValue('--scene-shadow-x')),dy=Number(style.getPropertyValue('--scene-shadow-y'));
    const ink=style.getPropertyValue('--scene-shadow-ink').trim();
    for(const box of contacts) {
      if(!(box.width>0&&box.right>box.left&&box.bottom>box.top))continue;
      const reach=box.width*reachRatio,ao=box.width*aoRatio;
      const cx=(box.left+box.right)/2+reach*dx,cy=(box.top+box.bottom)/2+reach*dy;
      let left=box.left-reach*2,right=box.right+ao,top=box.top-ao,bottom=box.bottom+reach;
      if(!wall)for(const other of boxes)if(other!==box){
        // 每个接触暗区止于两实牌中线，左右旋转后也不会叠加或压暗邻牌。
        if(other.right<=box.left+1/64)left=Math.max(left,(other.right+box.left)/2+1/64);
        if(other.left>=box.right-1/64)right=Math.min(right,(other.left+box.right)/2-1/64);
        if(other.bottom<=box.top+1/64)top=Math.max(top,(other.bottom+box.top)/2+1/64);
        if(other.top>=box.bottom-1/64)bottom=Math.min(bottom,(other.top+box.bottom)/2-1/64);
      }
      // 背景大小就是绘制裁界；中心和半径仍按未裁的实牌宽推导，缩放不改变投影比例。
      const w=right-left,h=bottom-top;if(!(w>0&&h>0))continue;
      const p=value=>clean(value)+'px',alpha=value=>clean(box.strength*value);
      const rx=(box.right-box.left)/2+reach*2,ry=(box.bottom-box.top)/2+reach;
      images.push('radial-gradient(ellipse '+p(rx)+' '+p(ry)+' at '+p(cx-left)+' '+p(cy-top)+', rgb('+ink+' / '+alpha(.9)+') 52%, rgb('+ink+' / '+alpha(.42)+') 80%, rgb('+ink+' / 0) 100%)');
      positions.push(p(left)+' '+p(top));sizes.push(p(w)+' '+p(h));
      // 墙根的贴地暗缝和上缘微反光共用连续矩形，四角由已有圆润牌体自然收口。
      if(wall){
        const vertical=parent.dataset.side==='left'||parent.dataset.side==='right';
        const seam=ao*1.2,span=vertical?h:w;
        images.push('linear-gradient('+(vertical?'90deg':'0deg')+', rgb('+ink+' / 0) 0%, rgb('+ink+' / '+alpha(1)+') 42%, rgb(255 245 223 / .07) 80%, rgb(255 245 223 / 0) 100%)');
        positions.push(p(vertical?box.left-seam*.5:left)+' '+p(vertical?top:box.bottom-seam*.6));
        sizes.push(p(vertical?seam:span)+' '+p(vertical?span:seam));
      }
    }
    write(parent,images,positions,sizes);contactPaintCache.set(parent,key);
  }
}
