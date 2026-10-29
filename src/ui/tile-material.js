// 仅复制公开绘制属性，不读取牌型、不修改规则或动画轨迹。
const SELF_PROPERTIES = ['background', 'box-shadow', 'border-width', 'border-style', 'border-color', 'border-radius', 'overflow', 'isolation'];
const LAYER_PROPERTIES = {background:'background',shadow:'box-shadow','border-top':'border-top','border-right':'border-right','border-bottom':'border-bottom','border-left':'border-left',radius:'border-radius',top:'top',right:'right',bottom:'bottom',left:'left',width:'width',height:'height',transform:'transform'};
const SVG_PROPERTIES = {position:'position',top:'top',right:'right',bottom:'bottom',left:'left',width:'width',height:'height',transform:'transform',radius:'border-radius'};
// Blink 的 used 宽高以 1/64px 布局，但计算样式字符串只保留四位小数。
// 还原这个精度，避免复制 47.7812px 时被再次向下量化成 47.765625px。
const read=(style,properties)=>Object.fromEntries(Object.entries(properties).map(([name,property])=>{let value=style.getPropertyValue(property);if((property==='width'||property==='height')&&/^-?[\d.]+px$/.test(value))value=`${Math.round(parseFloat(value)*64)/64}px`;if(['border-top','border-right','border-bottom','border-left'].includes(property)&&!parseFloat(style.getPropertyValue(property+'-width')))value='0px none transparent';return[name,value];}));

export function captureTileMaterial(node) {
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
