// 仅复制公开绘制属性，不读取牌型、不修改规则或动画轨迹。
const SELF_PROPERTIES = ['background', 'box-shadow', 'border-width', 'border-style', 'border-color', 'border-radius', 'overflow', 'isolation'];
const LAYER_PROPERTIES = {background:'background',shadow:'box-shadow','border-top':'border-top','border-right':'border-right','border-bottom':'border-bottom','border-left':'border-left',radius:'border-radius',top:'top',right:'right',bottom:'bottom',left:'left',width:'width',height:'height',transform:'transform'};
const SVG_PROPERTIES = {position:'position',top:'top',right:'right',bottom:'bottom',left:'left',width:'width',height:'height',transform:'transform',radius:'border-radius',shadow:'box-shadow'};
const metricCache=new WeakMap();
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
  // 显隐或牌面单独旋转后，牌框可能没变；SVG 的尺寸/角度也必须参与材质缓存。
  const key=`${width}:${height}:${angle}:${ss?.width}:${ss?.height}:${ss?.transform}`;
  if(metricCache.get(node)===key)return;
  metricCache.set(node,key);
  const t=angle*Math.PI/180,c=Math.cos(t),s=Math.sin(t),inverse=(x,y)=>[clean(c*x+s*y),clean(-s*x+c*y)];
  const [lx,ly]=inverse(-1,1),[ox,oy]=inverse(1,0),globalWidth=Math.abs(c)*width+Math.abs(s)*height,globalHeight=Math.abs(s)*width+Math.abs(c)*height;
  const point=(x,y)=>{const [px,py]=inverse((x-.5)*globalWidth,(y-.5)*globalHeight);return[clean((.5+px/width)*100),clean((.5+py/height)*100)];};
  const shine=point(.82,.08),grain=point(.18,.88);
  const values={'--tile-model-width':`${Math.min(width,height)}px`,'--tile-model-turn':`${angle}deg`,'--tile-model-light-x':lx,'--tile-model-light-y':ly,'--tile-model-occlusion-x':ox,'--tile-model-occlusion-y':oy,'--tile-model-shine-x':`${shine[0]}%`,'--tile-model-shine-y':`${shine[1]}%`,'--tile-model-grain-x':`${grain[0]}%`,'--tile-model-grain-y':`${grain[1]}%`,'--tile-model-top-paint':s+c>0?'var(--tile-model-plane-lit)':'var(--tile-model-plane-shade)'};
  // 弧形顶边与直顶边共用同一次光照判定，旋转后不能出现一段亮、一段暗的接缝。
  values['--tile-model-top-curve-tones']=s+c>0?'var(--tile-model-curve-lit)':'var(--tile-model-curve-shade)';
  // 微描边使用已读取的牌宽给数值，不依赖移动浏览器较新的CSS量纲相除。
  values['--tile-model-glyph-accent']=clean(12/Math.min(width,height));
  values['--tile-model-axis-x']=ox;values['--tile-model-axis-y']=oy;
  const [downX,downY]=inverse(0,1);values['--tile-model-down-x']=downX;values['--tile-model-down-y']=downY;
  for(const prefix of ['shadow','main','soft']){values[`--tile-model-${prefix}-x`]=lx;values[`--tile-model-${prefix}-y`]=ly;}
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
