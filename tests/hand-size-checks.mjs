import assert from 'node:assert/strict';

// 仅构造显示快照，不把极限组合冒充自然发出的牌局，也不向服务端发出命令。
const cases = [
  {name:'no-public'}, {name:'one-peng', melds:1, kind:'peng'},
  {name:'two-pengs', melds:2, kind:'peng'}, {name:'three-gangs', melds:3},
  {name:'thirteen-public', melds:3, red:1}, {name:'four-red', red:4},
  {name:'three-indicator', pizi:3}, {name:'four-wild', wild:4},
  {name:'four-gangs', melds:4}, {name:'seven-specials-full-hand', red:4, pizi:3},
  {name:'twelve-specials-full-hand', red:4, pizi:4, wild:4},
  {name:'twenty-eight-public', melds:4, red:4, pizi:4, wild:4},
  ...[1,2,3,4].map(melds=>({name:`mixed-${melds}-groups`, melds, red:4, pizi:3, wild:4})),
];

export async function checkHandSizes(page, size) {
  await page.setViewportSize({width:size.width, height:size.height});
  const results=[];
  for (const item of cases) {
    await page.evaluate(item=>{
      const game=window.mahjongGame;
      const player=game.players[0], count=14-(item.melds||0)*3;
      player.hand=Array.from({length:count},(_,index)=>18+index%9);
      player.redGangs=Array(item.red||0).fill(31);
      player.piziGangs=[...Array(item.pizi||0).fill(game.indicatorTile),...Array(item.wild||0).fill(game.wildTile)];
      player.melds=Array.from({length:item.melds||0},(_,index)=>({kind:item.kind||'gang',tiles:Array(item.kind==='peng'?3:4).fill(index),from:1,concealed:false}));
      game.phase={kind:'discard',seat:0};game.current=0;game.pendingDiscard=null;game.lastDiscard=null;
      game.lastDraw={player:0,index:count-1,tile:player.hand.at(-1),replacement:true};
      game.events=['固定手牌尺寸验收'];game.actionNotice=null;
      window.renderMahjong();
    },item);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const data=await page.evaluate(()=>{
      const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
      const visible=node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
      const hand=document.querySelector('#hand'), tiles=[...hand.querySelectorAll('button')], style=getComputedStyle(tiles[0]);
      const publicTiles=[...document.querySelectorAll('#melds-0 .tile')];
      const obstacles=[...document.querySelectorAll('#hand button,.action-zone:not([hidden]) button:not([hidden]),.player-seat,.river .tile,#wall-tail .wall-piece:not(.is-empty),.opponent-rack .tile,.opponent-rack .back')].filter(visible);
      const quads=new WeakMap(),quad=node=>{if(!quads.has(node))quads.set(node,window.visualGeometry.quad(node));return quads.get(node);};
      const boxes=new WeakMap(),box=node=>{if(!boxes.has(node))boxes.set(node,node.getBoundingClientRect());return boxes.get(node);};
      // 先排除包围盒完全分离的牌，再测投影四角；断言不变，避免无关牌的探针重排。
      const intersects=(a,b)=>{const p=box(a),q=box(b);return Math.min(p.right,q.right)>Math.max(p.left,q.left)&&Math.min(p.bottom,q.bottom)>Math.max(p.top,q.top)&&window.visualGeometry.intersects(quad(a),quad(b));};
      const overlaps=[];
      for (const [index,tile] of publicTiles.entries()) for (const obstacle of obstacles) {
        if(intersects(tile,obstacle)) overlaps.push({index,target:obstacle.closest('[id]')?.id||obstacle.className});
      }
      for(const [index,tile] of publicTiles.entries()) for(const other of publicTiles.slice(index+1)) {
        if(intersects(tile,other)) overlaps.push({index,target:'public-tile'});
      }
      const publicSizes=[0,1,2,3].map(seat=>[...document.querySelectorAll(`#melds-${seat} .tile`)].map(node=>{const s=getComputedStyle(node);return seat%2?[s.height,s.width]:[s.width,s.height];}));
      return {width:style.width,height:style.height,gap:getComputedStyle(hand).gap,wrap:getComputedStyle(hand).flexWrap,hand:rect(hand),tiles:tiles.map(rect),public:publicTiles.map(rect),publicSizes,overlaps,
        capacity:getComputedStyle(document.querySelector('#game')).getPropertyValue('--public-row-capacity').trim(),
        hits:tiles.every(node=>node.contains(document.elementFromPoint(node.getBoundingClientRect().x+node.getBoundingClientRect().width/2,node.getBoundingClientRect().y+node.getBoundingClientRect().height/2))),
        pageWidth:document.body.scrollWidth};
    });
    const label=JSON.stringify({size,case:item.name});
    assert.equal(data.capacity,'13',label);
    assert.equal(data.width,results[0]?.width||data.width,`fixed hand width ${label}`);
    assert.equal(data.height,results[0]?.height||data.height,`fixed hand height ${label}`);
    assert.ok(Math.abs(parseFloat(data.width)/parseFloat(data.height)-5/7)<.001,label);
    assert.equal(data.wrap,'nowrap',label);assert.equal(data.hits,true,`hand hit areas ${label}`);
    assert.ok(data.pageWidth<=size.width+1,label);
    assert.ok(data.tiles.every(t=>t.left>=data.hand.left-.5&&t.right<=data.hand.right+.5&&Math.abs(t.bottom-data.tiles[0].bottom)<.1),`contained single hand row ${label}`);
    assert.ok(data.public.every(t=>t.left>=0&&t.right<=size.width+.5&&t.top>=0&&t.bottom<=size.height+.5),`public containment ${label}`);
    assert.deepEqual(data.overlaps,[],`independent public area ${label}`);
    const publicSizes=data.publicSizes.flat();
    assert.ok(publicSizes.every(([w,h])=>w===publicSizes[0][0]&&h===publicSizes[0][1]),`same public model in all seats ${label}`);
    results.push({name:item.name,width:data.width,height:data.height,gap:data.gap,handCount:data.tiles.length,publicCount:data.public.length,publicSizes:data.publicSizes.map(s=>s[0]||null),hits:data.hits,overlaps:0});
  }
  return {size,cases:results};
}
