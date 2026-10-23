import {RIVER_LAYOUT,riverCell} from './river-layout.js';

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
  const runs=new Map(),cache=new WeakMap();
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
    const publicScale=parseFloat(tableStyle.getPropertyValue('--table-public-scale'))||1;
    const localPublic=stage.querySelector('.my-melds');
    if(localPublic&&!localPublic.hidden) {
      // 正视副露随手牌上移后，按真实绒布左边界内收，不能贴到木框或影响手牌中心。
      localPublic.style.transform='none';
      localPublic.style.width='';
      // 副露可用宽度以实牌左缘为界；不扩大手牌预留量，避免少牌时副露向上堆到牌墙。
      const handTiles=[...stage.querySelectorAll('#hand button')];
      if(handTiles.length) {
        const publicBox=localPublic.getBoundingClientRect();
        const handLeft=Math.min(...handTiles.map(tile=>tile.getBoundingClientRect().left));
        const gap=parseFloat(getComputedStyle(localPublic).columnGap)||0;
        localPublic.style.width=`${Math.max(publicBox.width,handLeft-publicBox.left-gap)}px`;
      }
      const far=project(tablePlane,left+frameWidth*.055,top+frameHeight*.055);
      const near=project(tablePlane,left+frameWidth*.055,top+frameHeight*.945);
      let inset=0;
      for(const tile of localPublic.querySelectorAll('.tile')) {
        const box=tile.getBoundingClientRect();
        for(const y of [box.top-stageBox.top,box.bottom-stageBox.top]) {
          const edge=far.x+(y-far.y)*(near.x-far.x)/(near.y-far.y);
          inset=Math.max(inset,edge+1-(box.left-stageBox.left));
        }
      }
      localPublic.style.transform=`translateX(${inset}px)`;
    }
    // 原方桌仍作布局坐标；桌框装饰的放大不能改变牌区中心或手牌位置。
    const anchor={x:left+frameWidth/2,y:top+frameHeight/2};
    const groups=[...stage.querySelectorAll('.opponent-rack,.river'),...runs.values()];
    for(const node of groups) {
      if(!node.isConnected||!node.getClientRects().length)continue;
      const style=getComputedStyle(node),width=parseFloat(style.width),height=parseFloat(style.height);
      if(!(width>0&&height>0))continue;
      const side=node.dataset.side||({'rack-1':'right','rack-2':'top','rack-3':'left','river-0':'bottom','river-1':'right','river-2':'top','river-3':'left'}[node.id]);
      const kind=node.classList.contains('flat-wall-run')?'wall':node.classList.contains('river')?'river':'hand';
      if(kind==='river')for(const [index,tile] of [...node.children].entries()) {
        const cell=riverCell(index,side);
        const column=String(cell.column),row=String(cell.row);
        if(tile.style.gridColumn!==column)tile.style.gridColumn=column;
        if(tile.style.gridRow!==row)tile.style.gridRow=row;
      }
      // 固定方桌内分三圈：暗手在外、牌墙居中、27 格牌河在内；近侧为双层墙留出厚度。
      const radius=kind==='river'?(side==='top'?RIVER_LAYOUT.farRadius:side==='bottom'?RIVER_LAYOUT.nearRadius:RIVER_LAYOUT.radius)
        :kind==='wall'?(side==='top'?RIVER_LAYOUT.farWallRadius:side==='bottom'?RIVER_LAYOUT.wallRadius:RIVER_LAYOUT.sideWallRadius)
        :side==='top'?RIVER_LAYOUT.farHandRadius:RIVER_LAYOUT.handRadius;
      const direction={top:[0,-1],bottom:[0,1],left:[-1,0],right:[1,0]}[side];
      const aligned={x:anchor.x+direction[0]*frameWidth*radius,y:anchor.y+direction[1]*frameHeight*radius};
      // 牌河按容量独立定尺寸；牌墙与暗手沿用原牌体大小，四家的牌面朝向不变。
      const face=kind==='river'?node.querySelector('.tile'):null;
      // 空牌河也先对齐中心；第一张牌出现时再按原牌体宽度求等比缩放。
      const size=kind==='river'?(face?frameWidth*RIVER_LAYOUT.tileWidth/parseFloat(getComputedStyle(face).width):1)
        :(kind==='wall'&&side==='bottom'?1:.72)*(kind==='hand'?1:publicScale);
      const key=`${stageBox.width}:${stageBox.height}:${width}:${height}:${aligned.x}:${aligned.y}:${size}`;
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
      const m=multiply(undo,multiply(tablePlane,[size,0,aligned.x-size*x,0,size,aligned.y-size*y,0,0,1]));
      if(Math.abs(m[8])<1e-10)continue;
      const n=m.map(value=>value/m[8]);
      node.style.setProperty('--opponent-view',planeCSS(n));
      cache.set(node,key);
    }
  };
}
