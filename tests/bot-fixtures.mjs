import { actionFixture } from './pizi-fixtures.mjs';
import { assertInvariants } from '../src/domain/invariants.js';
import { RED_DRAGON, TILE } from '../src/domain/tile.js';

const opened = [
  {kind:'chi',tiles:[0,1,2],from:0,concealed:false},
  {kind:'peng',tiles:[9,9,9],from:2,concealed:false},
  {kind:'peng',tiles:[18,18,18],from:3,concealed:false},
];

// 明确标注的守恒状态夹具；既覆盖牌墙未空，也覆盖补牌耗尽后的特殊牌死角。
export function blockedBotFixture({exhausted=false,names}={}) {
  const game=actionFixture({seat:1,names,hand:exhausted?[TILE.EAST,TILE.EAST,RED_DRAGON,TILE.WHITE]:[TILE.EAST,TILE.EAST],
    melds:exhausted?opened:[...opened,{kind:'peng',tiles:[12,12,12],from:0,concealed:false}]});
  game.lastDraw=null;
  if(exhausted) {
    game.indicatorTaken=true;game.indicatorTakenBy=1;
    game.players[1].hand.push(game.indicatorTile);
    for(const tile of game.wall.splice(0)) {
      if(tile===RED_DRAGON)game.players[0].redGangs.push(tile);
      else if(tile===game.indicatorTile||tile===game.wildTile)game.players[0].piziGangs.push(tile);
      else game.players[0].discards.push(tile);
    }
  }
  assertInvariants(game);
  return game;
}

export function blockedBotClaimFixture(kind) {
  return actionFixture({seat:1,hand:[...(kind==='chi'?[3,5]:[4,4]),TILE.EAST,TILE.EAST],
    melds:opened,discard:4});
}
