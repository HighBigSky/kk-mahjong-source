// @ts-check
import { tileName, getWinBreakdown } from '../../engine.js';
import { RED_DRAGON } from '../domain/tile.js';
import { getTingHints } from './ting.js';
import { SCORING_TEXT } from '../domain/scoring.js';

export const PLAY_TEXT = Object.freeze({
  hint: '提示', ready: '已听：', discard: '打', listen: '听', total: '共', copies: '张',
  hu: '胡', closeHint: '关闭胡牌提示', openHint: '展开胡牌提示', waits: '可胡牌',
  remaining: '剩', claim: '可接胡', selfDrawOnly: '仅自摸',
  confirm: '再次点击建议牌或「提示」确认出牌', claimOnly:'仅接胡',
  note: '剩余为未见张数估计，包含他人暗手，不代表牌墙实际余量。',
  redGang: SCORING_TEXT.redGang, piziGang: SCORING_TEXT.piziGang, wildGang: SCORING_TEXT.wildGang,
  noSupplement: '当前没有余牌可补杠', single: '单击选中，300ms 内再次点击开杠',
  handInstruction:'点选再点出牌；红中、痞子、癞子双击开杠', drawResult:'本局荒庄，已结算的杠分保留。',
  resultWinner:'赢家：', resultYou:'（你）', resultDiscarder:'点炮：',
  resultSelfDraw:'自摸胡牌', resultDiscardWin:'接炮胡牌', resultDraw:'好牌，下局再来',
});

/** 按同一张牌的实际身份取唯一入口，不把三种单张杠合并进普通杠。
 * @param {number} tile @param {number|null} indicator @param {number|null} wild
 * @returns {'piziGang'|'redGang'|'wildGang'|null}
 */
export function specialGangKind(tile, indicator, wild) {
  if (tile === indicator) return 'piziGang';
  if (tile === RED_DRAGON) return 'redGang';
  return tile === wild ? 'wildGang' : null;
}

/** @typedef {Parameters<typeof getTingHints>[0]} HintInput */
/** @typedef {{type:import('../domain/tile.js').TileCode, selfDraw:boolean, claim:boolean, remaining:number}} Wait */
/** @typedef {{index:number, discardedTile:number|null, waits:Wait[], total:number, points:number}} Candidate */

/** 只读取自己的手牌和已亮出的实牌；缓存与选中态无关，切换建议不重新算牌。 */
export function createHintCalculator() {
  let key = '';
  /** @type {{mode:'discard'|'ready'|'none', candidates:Candidate[]}} */
  let cached = {mode:'none', candidates:[]};
  /** @param {HintInput} input */
  return input => {
    const next = JSON.stringify(input);
    if (next === key) return cached;
    key = next;
    const {hand, melds = [], visibleTiles = [], wildTile = null, indicatorTile = null} = input;
    const known = Array(34).fill(0), publicCounts = Array(34).fill(0), meldCounts = Array(34).fill(0);
    for (const type of hand) known[type]++;
    for (const type of visibleTiles) publicCounts[type]++;
    for (const meld of melds) for (const type of meld.tiles) meldCounts[type]++;
    for (let type = 0; type < 34; type++) known[type] += Math.max(publicCounts[type], meldCounts[type]);
    const discarding = hand.length === (4 - melds.length) * 3 + 2;
    /** @type {Candidate[]} */
    const candidates = [];
    const seen = new Set();
    for (const index of discarding ? hand.map((_, index) => index) : [-1]) {
      // 三类牌的确认动作是单张杠，不能给出“打癞子”却实际执行开杠的建议。
      if (index >= 0 && specialGangKind(hand[index], indicatorTile, wildTile)) continue;
      if (index >= 0 && seen.has(hand[index])) continue;
      if (index >= 0) seen.add(hand[index]);
      const hint = getTingHints(input, index);
      if (hint.status !== 'ready' || !hint.waits.length) continue;
      const waits = hint.waits.map(wait => ({...wait, remaining:Math.max(0, 4 - known[wait.type])}));
      const remaining = hand.filter((_, position) => position !== index);
      // 复用结算的原有分值表排序，不创建第二套番型或计分公式。
      const points = Math.max(...waits.map(wait => getWinBreakdown([...remaining, wait.type], melds, true).reduce((sum, item) => sum + item.points, 0)));
      candidates.push({index, discardedTile:hint.discardedTile, waits, total:waits.reduce((sum, wait) => sum + wait.remaining, 0), points});
    }
    candidates.sort((a, b) => b.waits.length - a.waits.length || b.total - a.total || b.points - a.points || a.index - b.index);
    cached = {mode:candidates.length ? discarding ? 'discard' : 'ready' : 'none', candidates:candidates.slice(0, 5)};
    return cached;
  };
}

/** @param {Candidate} candidate @param {boolean} ready */
export function hintText(candidate, ready) {
  const waits = candidate.waits.map(wait => `${tileName(wait.type)}（${wait.remaining}${PLAY_TEXT.copies}${wait.selfDraw ? '' : '，' + PLAY_TEXT.claimOnly}）`).join(' / ');
  const total = `（${PLAY_TEXT.total} ${candidate.total} ${PLAY_TEXT.copies}）`;
  return ready ? `${PLAY_TEXT.ready}${waits}${total}` : `${PLAY_TEXT.discard}【${tileName(candidate.discardedTile)}】→ ${PLAY_TEXT.listen}【${waits}】${total}`;
}
