import {RIVER_LAYOUT,riverCell} from './river-layout.js';
import {riverSpacing} from './river-spacing.js';

const multiply = (a,b) => Array.from({length:9},(_,i)=>
  a[Math.floor(i/3)*3]*b[i%3]+a[Math.floor(i/3)*3+1]*b[3+i%3]+a[Math.floor(i/3)*3+2]*b[6+i%3]);
const inverse = m => {
  const [a,b,c,d,e,f,g,h,i]=m;
  const result=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
  const determinant=a*result[0]+b*result[3]+c*result[6];
  return Math.abs(determinant)>1e-10 ? result.map(value=>value/determinant) : null;
};
const project = (m,x,y) => {const w=m[6]*x+m[7]*y+m[8];return{x:(m[0]*x+m[1]*y+m[2])/w,y:(m[3]*x+m[4]*y+m[5])/w};};

/** 由浏览器真实投影的四角反算平面，不依赖设备方向或人为压扁系数。 */
function projection(node,width,height,stageBox) {
  const style=getComputedStyle(node),bx=parseFloat(style.borderLeftWidth),by=parseFloat(style.borderTopWidth);
  const probe=document.createElement('i');
  probe.style.cssText='position:absolute;width:0;height:0;margin:0;padding:0;border:0;pointer-events:none';
  node.append(probe);
  const p=[[0,0],[width,0],[width,height],[0,height]].map(([x,y])=>{
    probe.style.left=`${x-bx}px`;probe.style.top=`${y-by}px`;
    const rect=probe.getBoundingClientRect();return{x:rect.left-stageBox.left,y:rect.top-stageBox.top};
  });
  probe.remove();
  const dx1=p[1].x-p[2].x,dx2=p[3].x-p[2].x,dx3=p[0].x-p[1].x+p[2].x-p[3].x;
  const dy1=p[1].y-p[2].y,dy2=p[3].y-p[2].y,dy3=p[0].y-p[1].y+p[2].y-p[3].y;
  const denominator=dx1*dy2-dx2*dy1;
  if(Math.abs(denominator)<1e-10)return null;
  const g=(dx3*dy2-dx2*dy3)/denominator,h=(dx1*dy3-dx3*dy1)/denominator;
  return[(p[1].x-p[0].x+g*p[1].x)/width,(p[3].x-p[0].x+h*p[3].x)/height,p[0].x,
    (p[1].y-p[0].y+g*p[1].y)/width,(p[3].y-p[0].y+h*p[3].y)/height,p[0].y,g/width,h/height,1];
}

// 动画与实牌共用浏览器实际测得的平面，避免把透视四边形拉伸成包围盒。
export function tilePlane(node,stage) {
  const style=getComputedStyle(node),width=parseFloat(style.width),height=parseFloat(style.height);
  if(!(width>0&&height>0))return null;
  const matrix=projection(node,width,height,stage.getBoundingClientRect());
  return matrix?{width,height,matrix}:null;
}

export const planeCSS = n => `matrix3d(${[n[0],n[3],0,n[6],n[1],n[4],0,n[7],0,0,1,0,n[2],n[5],0,n[8]].join(',')})`;

// 只变换现有公开 DOM，不复制牌面、不读取暗牌，不改变 136 个槽位、排序或游戏状态。
export function createFlatOpponentView(stage) {
  const runs=new Map(),cache=new WeakMap(),spacingCache=new WeakMap();
  stage.style.setProperty('--river-long-count',String(RIVER_LAYOUT.columns));
  stage.style.setProperty('--river-short-count',String(RIVER_LAYOUT.rows));
  return function layout() {
    if(!stage.classList.contains('is-landscape'))return;
    const wall=stage.querySelector('#wall-tail'),stacks=wall?.querySelector('.wall-tail-stacks');
    if(stacks&&!wall.hidden)for(const side of ['top','left','right','bottom']) {
      if(runs.get(side)?.isConnected)continue;
      const run=document.createElement('div');run.className='flat-wall-run';run.dataset.side=side;
      const members=[...stacks.querySelectorAll(`.wall-stack[data-side="${side}"]`)];
      stacks.insertBefore(run,members[0]);run.append(...members);runs.set(side,run);
    }
    const stageBox=stage.getBoundingClientRect();
    const table=stage.querySelector('.table'),tableStyle=getComputedStyle(table),surface=getComputedStyle(table,'::before');
    const tablePlane=projection(table,parseFloat(tableStyle.width),parseFloat(tableStyle.height),stageBox);
    if(!tablePlane)return;
    const left=parseFloat(surface.left),top=parseFloat(surface.top),frameWidth=parseFloat(surface.width),frameHeight=parseFloat(surface.height);
    // 原方桌仍作布局坐标；桌框装饰的放大不能改变牌区中心或手牌位置。
    const anchor={x:left+frameWidth/2,y:top+frameHeight/2};
    const groups=[...stage.querySelectorAll('.opponent-rack,.river'),...runs.values()];
    for(const node of groups) {
      if(!node.isConnected||!node.getClientRects().length)continue;
      const side=node.dataset.side||({'rack-1':'right','rack-2':'top','rack-3':'left','river-0':'bottom','river-1':'right','river-2':'top','river-3':'left'}[node.id]);
      const kind=node.classList.contains('flat-wall-run')?'wall':node.classList.contains('river')?'river':'hand';
      if(kind==='river')for(const [index,tile] of [...node.children].entries()) {
        const cell=riverCell(index,side);
        const column=String(cell.column),row=String(cell.row);
        if(tile.style.gridColumn!==column)tile.style.gridColumn=column;
        if(tile.style.gridRow!==row)tile.style.gridRow=row;
      }
      // 固定方桌内分三圈：暗手与换行副露在外、牌墙居中、36 格牌河在内。
      const radius=kind==='river'?(side==='top'?RIVER_LAYOUT.farRadius:side==='bottom'?RIVER_LAYOUT.nearRadius:RIVER_LAYOUT.radius)
        :kind==='wall'?(side==='top'?RIVER_LAYOUT.farWallRadius:side==='bottom'?RIVER_LAYOUT.wallRadius:RIVER_LAYOUT.sideWallRadius)
        :side==='top'?RIVER_LAYOUT.farHandRadius:RIVER_LAYOUT.handRadius;
      const direction={top:[0,-1],bottom:[0,1],left:[-1,0],right:[1,0]}[side];
      const aligned={x:anchor.x+direction[0]*frameWidth*radius,y:anchor.y+direction[1]*frameHeight*radius};
      if(kind==='river') {
        const gap=parseFloat(getComputedStyle(node).columnGap);
        aligned.x+=direction[0]*gap*RIVER_LAYOUT.sideGapClearance;
        const spacingKey=`${frameWidth}:${frameHeight}:${tablePlane.join(':')}:${gap}:${side}`;
        if(spacingCache.get(node)!==spacingKey) {
          const probe=document.createElement('span');probe.className='tile';
          probe.style.cssText='position:absolute;pointer-events:none';
          node.append(probe);const measured=getComputedStyle(probe),w=parseFloat(measured.width),h=parseFloat(measured.height);probe.remove();
          const sideways=side==='left'||side==='right';
          node.style.setProperty('--river-cell-width',`${sideways?h:w}px`);
          node.style.setProperty('--river-cell-height',`${sideways?w:h}px`);
          const spacing=riverSpacing(tablePlane,aligned,sideways?h:w,sideways?w:h,sideways?RIVER_LAYOUT.rows:RIVER_LAYOUT.columns,sideways?RIVER_LAYOUT.columns:RIVER_LAYOUT.rows,gap);
          node.style.setProperty('--river-column-spacing',`${spacing.columnSpacing}px`);
          node.style.setProperty('--river-row-spacing',`${spacing.rowSpacing}px`);
          node.style.setProperty('--river-column-tracks',spacing.columns.map(value=>`${value}px`).join(' '));
          node.style.setProperty('--river-row-tracks',spacing.rows.map(value=>`${value}px`).join(' '));
          spacingCache.set(node,spacingKey);
        }
      }
      const style=getComputedStyle(node),width=parseFloat(style.width),height=parseFloat(style.height);
      if(!(width>0&&height>0))continue;
      // CSS 已统一真实牌宽；此处只平移到桌面锚点，不按牌区或座位再次缩放。
      const key=`${stageBox.width}:${stageBox.height}:${width}:${height}:${aligned.x}:${aligned.y}`;
      if(cache.get(node)===key)continue;
      node.style.setProperty('--opponent-view','none');
      const source=projection(node,width,height,stageBox),undo=source&&inverse(source);
      if(!undo)continue;
      let x=width/2,y=height/2;
      if(node.classList.contains('flat-wall-run')) {
        const bounds=[...node.children].map(n=>({x:n.offsetLeft,y:n.offsetTop,w:n.offsetWidth,h:n.offsetHeight}));
        x=(Math.min(...bounds.map(b=>b.x))+Math.max(...bounds.map(b=>b.x+b.w)))/2;
        y=(Math.min(...bounds.map(b=>b.y))+Math.max(...bounds.map(b=>b.y+b.h)))/2;
      }
      const m=multiply(undo,multiply(tablePlane,[1,0,aligned.x-x,0,1,aligned.y-y,0,0,1]));
      if(Math.abs(m[8])<1e-10)continue;
      const n=m.map(value=>value/m[8]);
      node.style.setProperty('--opponent-view',planeCSS(n));
      cache.set(node,key);
    }
    const localPublic=stage.querySelector('.my-melds');
    if(localPublic&&!localPublic.hidden) {
      // 正视公开区独立排放；只使用固定尺寸手牌之外的空位，不回写手牌宽高。
      const stageStyle=getComputedStyle(stage),publicStyle=getComputedStyle(localPublic);
      const zoom=Number(stageStyle.getPropertyValue('--table-frame-zoom'));
      const trim=parseFloat(surface.clipPath.replace('inset(','').split(' ')[1])/frameWidth;
      const paintedPoint=(x,y)=>project(tablePlane,left+frameWidth/2+(x-.5)*frameWidth*zoom,top+frameHeight/2+(y-.5)*frameHeight*zoom);
      const farLeft=paintedPoint(trim+.055,.055),nearLeft=paintedPoint(trim+.055,.945);
      const farRight=paintedPoint(1-trim-.055,.055),nearRight=paintedPoint(1-trim-.055,.945);
      const edge=(a,b,y)=>stageBox.left+a.x+(y-stageBox.top-a.y)*(b.x-a.x)/(b.y-a.y);
      const box=localPublic.getBoundingClientRect(),gap=parseFloat(publicStyle.columnGap),rowGap=parseFloat(publicStyle.rowGap);
      const capacity=Number(stageStyle.getPropertyValue('--public-row-capacity'));
      const obstacles=[...stage.querySelectorAll('#hand button,.player-seat,.action-zone:not([hidden]),#play-assist:not([hidden]),#hint-details:not([hidden]),.river .tile,#wall-tail .wall-piece:not(.is-empty),.opponent-rack .tile,.opponent-rack .back')]
        .filter(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden')
        .map(node=>node.getBoundingClientRect());
      const groups=[...localPublic.children];
      for(const group of groups) { group.style.position='absolute';group.style.left='0px';group.style.top='0px'; }
      const sizes=groups.map(group=>group.getBoundingClientRect());
      const rowHeight=Math.max(...sizes.map(size=>size.height))+rowGap;
      const rows=[];
      for(const [index,group] of groups.entries()) {
        const size=sizes[index],count=group.querySelectorAll('.tile').length;
        // 从近侧向上换行，保留组内顺序；末行较短，可避开前方牌墙。
        for(let row=0;row*rowHeight+size.height<=box.height+.1;row++) {
          if((rows[row]||0)+count>capacity)continue;
          const bottom=box.bottom-row*rowHeight,top=bottom-size.height;
          let x=Math.max(edge(farLeft,nearLeft,top),edge(farLeft,nearLeft,bottom),stageBox.left)+1;
          const limit=Math.min(edge(farRight,nearRight,top),edge(farRight,nearRight,bottom),stageBox.right)-1;
          // 只移动公开牌，按实测矩形跳过手牌、牌墙、玩家信息与按钮热区。
          while(x+size.width<=limit) {
            const collision=obstacles.find(other=>Math.min(x+size.width,other.right)-Math.max(x,other.left)>0&&Math.min(bottom,other.bottom)-Math.max(top,other.top)>0);
            if(collision) { x=collision.right+gap;continue; }
            group.style.left=`${x-box.left}px`;group.style.top=`${top-box.top}px`;
            obstacles.push({left:x-gap,right:x+size.width+gap,top:top-rowGap,bottom:bottom+rowGap});
            rows[row]=(rows[row]||0)+count;
            break;
          }
          if(x+size.width<=limit)break;
        }
      }
    }
  };
}
