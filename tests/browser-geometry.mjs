// 在 page.evaluate 中安装：用浏览器投影四角检查紧密牌列，避免包围盒相交的误报。
export function installVisualGeometry() {
  function quad(element) {
    const style = getComputedStyle(element);
    if (style.position === 'static' && style.transform === 'none') {
      const r = element.getBoundingClientRect();
      return [{x:r.left,y:r.top},{x:r.right,y:r.top},{x:r.right,y:r.bottom},{x:r.left,y:r.bottom}];
    }
    const width = parseFloat(style.width), height = parseFloat(style.height);
    const bx = parseFloat(style.borderLeftWidth), by = parseFloat(style.borderTopWidth);
    const probe = document.createElement('i');
    probe.style.cssText = 'position:absolute;display:block;width:0;height:0;margin:0;padding:0;border:0;pointer-events:none';
    element.append(probe);
    const points = [[0,0],[width,0],[width,height],[0,height]].map(([x,y]) => {
      probe.style.left = `${x - bx}px`; probe.style.top = `${y - by}px`;
      const r = probe.getBoundingClientRect(); return {x:r.left,y:r.top};
    });
    probe.remove();
    return points;
  }
  function intersects(first, second, tolerance = .4) {
    for (const polygon of [first,second]) for (let index = 0; index < 4; index++) {
      const a = polygon[index], b = polygon[(index + 1) % 4], length = Math.hypot(b.y-a.y,b.x-a.x);
      if (!length) return false;
      const project = points => points.map(point => ((b.y-a.y)*point.x + (a.x-b.x)*point.y) / length);
      const p = project(first), q = project(second);
      if (Math.min(Math.max(...p),Math.max(...q)) - Math.max(Math.min(...p),Math.min(...q)) <= tolerance) return false;
    }
    return true;
  }
  // 反投影到方桌坐标后再验牌身，避免把真实透视误判成模型被压扁。
  function tablePlane(corners) {
    const [a,b,c,d]=corners,dx1=b.x-c.x,dx2=d.x-c.x,dx3=a.x-b.x+c.x-d.x;
    const dy1=b.y-c.y,dy2=d.y-c.y,dy3=a.y-b.y+c.y-d.y,det=dx1*dy2-dx2*dy1;
    const g=(dx3*dy2-dx2*dy3)/det,h=(dx1*dy3-dx3*dy1)/det;
    const m=[b.x-a.x+g*b.x,d.x-a.x+h*d.x,a.x,b.y-a.y+g*b.y,d.y-a.y+h*d.y,a.y,g,h,1];
    const [p,q,r,s,t,u,v,w,z]=m;
    const inverse=[t*z-u*w,r*w-q*z,q*u-r*t,u*v-s*z,p*z-r*v,r*s-p*u,s*w-t*v,q*v-p*w,p*t-q*s];
    return points=>points.map(({x,y})=>{const scale=inverse[6]*x+inverse[7]*y+inverse[8];return{x:(inverse[0]*x+inverse[1]*y+inverse[2])/scale,y:(inverse[3]*x+inverse[4]*y+inverse[5])/scale};});
  }
  window.visualGeometry = {quad, intersects, tablePlane};
}
