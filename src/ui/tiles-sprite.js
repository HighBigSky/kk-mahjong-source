// 牌面精灵图内联：把 assets/tiles.svg 的 <symbol> 一次性插进当前文档，
// 之后所有 <use> 都引用同文档的 #tile-N。
// 否则每次重建/移动牌面节点，浏览器都要重新按外部文档解析 <use>，
// 而服务器对静态资源用的是 no-cache 且没有 ETag，等于每次都要重新下载 90 KB，
// 牌面会先画成底色（白色）再补上图案——这就是出牌时那一下闪白。

let inline = false;

/** 把精灵图注入文档；失败时回退到外部引用，不影响功能。 */
export async function loadTilesSprite() {
  try {
    const response = await fetch('assets/tiles.svg', { cache: 'force-cache' });
    if (!response.ok) return;
    const markup = await response.text();
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const sprite = parsed.documentElement;
    if (!sprite || sprite.nodeName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) return;
    sprite.setAttribute('aria-hidden', 'true');
    sprite.setAttribute('id', 'tile-sprite');
    sprite.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    document.body.prepend(document.importNode(sprite, true));
    inline = true;
  } catch {
    inline = false;
  }
}

/** @param {number|string} type */
export function tileHref(type) {
  return inline ? `#tile-${type}` : `assets/tiles.svg#tile-${type}`;
}
