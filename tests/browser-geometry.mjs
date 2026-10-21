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
  window.visualGeometry = {quad, intersects};
}
