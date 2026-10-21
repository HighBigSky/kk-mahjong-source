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
    const groups=[...stage.querySelectorAll('.opponent-rack,#river-1,#river-2,#river-3'),...runs.values()];
    for(const node of groups) {
      if(!node.isConnected||!node.getClientRects().length)continue;
      const style=getComputedStyle(node),width=parseFloat(style.width),height=parseFloat(style.height);
      if(!(width>0&&height>0))continue;
      const key=`${stageBox.width}:${stageBox.height}:${width}:${height}`;
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
      const centre=project(source,x,y),unit=project(source,x+1,y);
      const size=node.id==='river-2' ? .70 : ['river-1','river-3'].includes(node.id) ? .90 : .72;
      const scale=Math.hypot(unit.x-centre.x,unit.y-centre.y)*size;
      // 原投影中心不动，只把组内平面映射为等比矩形；长宽比、方向和命中区一起更新。
      const m=multiply(undo,[scale,0,centre.x-scale*x,0,scale,centre.y-scale*y,0,0,1]);
      if(Math.abs(m[8])<1e-10)continue;
      const n=m.map(value=>value/m[8]);
      node.style.setProperty('--opponent-view',`matrix3d(${[n[0],n[3],0,n[6],n[1],n[4],0,n[7],0,0,1,0,n[2],n[5],0,1].join(',')})`);
      cache.set(node,key);
    }
  };
}
