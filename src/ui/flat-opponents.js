const multiply = (a,b) => Array.from({length:9},(_,i)=>
  a[Math.floor(i/3)*3]*b[i%3]+a[Math.floor(i/3)*3+1]*b[3+i%3]+a[Math.floor(i/3)*3+2]*b[6+i%3]);
const inverse = m => {
  const [a,b,c,d,e,f,g,h,i]=m;
  const result=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
  const determinant=a*result[0]+b*result[3]+c*result[6];
  return Math.abs(determinant)>1e-10 ? result.map(value=>value/determinant) : null;
};

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
  return function layout() {
    if(!stage.classList.contains('is-landscape'))return;
    const wall=stage.querySelector('#wall-tail'),stacks=wall?.querySelector('.wall-tail-stacks');
    if(stacks&&!wall.hidden)for(const side of ['top','left','right']) {
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
    // 牌区回到桌面的同一平面，只保留原有等比尺寸；牌体样式和模型不变。
    const anchor={x:left+frameWidth/2,y:top+frameHeight/2};
    const groups=[...stage.querySelectorAll('.opponent-rack,#river-1,#river-2,#river-3'),...runs.values()];
    for(const node of groups) {
      if(!node.isConnected||!node.getClientRects().length)continue;
      const style=getComputedStyle(node),width=parseFloat(style.width),height=parseFloat(style.height);
      if(!(width>0&&height>0))continue;
      const side=node.dataset.side||({'rack-1':'right','rack-2':'top','rack-3':'left','river-1':'right','river-2':'top','river-3':'left'}[node.id]);
      const kind=node.classList.contains('flat-wall-run')?'wall':node.classList.contains('river')?'river':'hand';
      // 各家共用同心分区：外圈手牌、中圈牌墙、内圈牌河，不再沿用零散的旧坐标。
      const radius=kind==='river'?(side==='top'?.16:.20):kind==='wall'?(side==='top'?.265:.28):.39;
      const direction={top:[0,-1],left:[-1,0],right:[1,0]}[side];
      const aligned={x:anchor.x+direction[0]*frameWidth*radius,y:anchor.y+direction[1]*frameHeight*radius};
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
      const size=node.id==='river-2' ? .70 : ['river-1','river-3'].includes(node.id) ? .90 : .72;
      const m=multiply(undo,multiply(tablePlane,[size,0,aligned.x-size*x,0,size,aligned.y-size*y,0,0,1]));
      if(Math.abs(m[8])<1e-10)continue;
      const n=m.map(value=>value/m[8]);
      node.style.setProperty('--opponent-view',planeCSS(n));
      cache.set(node,key);
    }
  };
}
