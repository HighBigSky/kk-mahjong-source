// @ts-check
import { tileName } from '../../engine.js';
import { TOTAL_TILE_COUNT } from '../domain/tile.js';
import { tileHref } from '../ui/tiles-sprite.js';

/** @typedef {{ dice:number[], indicatorPosition:number|null, tailDraws:number }} WallInfo */
/** @typedef {{ wall:{length:number}, wallInfo?:WallInfo|null, indicatorTile:number|null }} WallSnapshot */
/** @typedef {{ element:HTMLSpanElement, face:SVGSVGElement|null, state:string }} PieceView */
/** @typedef {{ element:HTMLDivElement, pieces:PieceView[], label:HTMLSpanElement }} StackView */
/** @typedef {{ title:HTMLElement, count:HTMLElement, position:HTMLSpanElement, stacks:StackView[] }} WallView */

const TILES_PER_STACK = 2;
const STACKS_PER_SIDE = TOTAL_TILE_COUNT / TILES_PER_STACK / 4;
const WALL_SIDES = ['bottom', 'right', 'top', 'left'];
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
/** @type {WeakMap<HTMLElement, WallView>} */
const views = new WeakMap();

/**
 * Create the public wall display once. No hand or hidden wall face enters it.
 * @param {HTMLElement} element
 * @returns {WallView}
 */
function createView(element) {
  const heading = document.createElement('div');
  heading.className = 'wall-tail-heading';
  const title = document.createElement('strong');
  title.className = 'wall-tail-title';
  const counter = document.createElement('span');
  counter.className = 'wall-tail-count';
  const count = document.createElement('strong');
  counter.append('余牌 ', count, ' 张');
  title.append(counter);
  const metadata = document.createElement('div');
  metadata.className = 'wall-tail-meta';
  // 骰子已经搬到牌桌正中央，这里只留「第 N 墩翻痞」的说明文字。
  const position = document.createElement('span');
  position.className = 'wall-indicator-position';
  metadata.append(position);
  heading.append(title, metadata);
  const lane = document.createElement('div');
  lane.className = 'wall-tail-stacks';
  lane.setAttribute('aria-hidden', 'true');
  const stacks = Array.from({length:TOTAL_TILE_COUNT / TILES_PER_STACK}, (_, index) => createStack(index));
  lane.append(...stacks.map(stack => stack.element));
  element.replaceChildren(heading, lane);
  const view = { title, count, position, stacks };
  views.set(element, view);
  return view;
}

/** @param {number} index @returns {StackView} */
function createStack(index) {
  const element = document.createElement('div');
  element.className = 'wall-stack';
  element.dataset.stack = String(index + 1);
  element.dataset.side = WALL_SIDES[Math.floor(index / STACKS_PER_SIDE)];
  element.style.setProperty('--wall-stack-index', String(index % STACKS_PER_SIDE));
  const pieces = [0, 1].map(level => {
    const piece = document.createElement('span');
    piece.className = `wall-piece wall-piece-${level === 0 ? 'upper' : 'lower'} back`;
    piece.dataset.position = String(index * TILES_PER_STACK + level);
    element.append(piece);
    return {element:piece, face:null, state:''};
  });
  const label = document.createElement('span');
  label.className = 'wall-stack-number';
  label.textContent = String(index + 1);
  element.append(label);
  return {element, pieces, label};
}

/**
 * Render all 68 public wall stacks around the table, without hidden tile faces.
 * The original 136 slots never move: the indicator stays face-up in its slot,
 * supplements empty the tail, and ordinary draws empty the opposite head.
 * Every remaining physical wall tile has exactly one visible back. The face-up
 * indicator is a separate owner and is never included in the remaining count.
 * Repeated snapshots retain every unchanged DOM node, including SVG instances.
 * @param {HTMLElement} element
 * @param {WallSnapshot} game
 * @returns {void}
 */
export function renderWall(element, game) {
  const info = game.wallInfo;
  if (!info || info.dice.length !== 2 || !info.dice.every(value => Number.isInteger(value) && value >= 1 && value <= 6)) {
    element.hidden = true;
    return;
  }
  element.hidden = false;
  const view = views.get(element) || createView(element);
  const indicator = game.indicatorTile !== null && info.indicatorPosition !== null ? info.indicatorPosition : -1;
  const remaining = Math.max(0, Math.min(TOTAL_TILE_COUNT, game.wall.length));
  const tailCount = Math.max(0, Math.min(TOTAL_TILE_COUNT, info.tailDraws));
  const headCount = Math.max(0, TOTAL_TILE_COUNT - remaining - tailCount - (indicator >= 0 ? 1 : 0));
  const removed = new Set();
  let removedAtTail = 0;
  for (let slot = 0; slot < TOTAL_TILE_COUNT && removedAtTail < tailCount; slot++) {
    if (slot === indicator) continue;
    removed.add(slot);
    removedAtTail++;
  }
  let removedAtHead = 0;
  for (let slot = TOTAL_TILE_COUNT - 1; slot >= 0 && removedAtHead < headCount; slot--) {
    if (slot === indicator || removed.has(slot)) continue;
    removed.add(slot);
    removedAtHead++;
  }
  let next = -1;
  let head = -1;
  if (remaining > 0) {
    for (let slot = 0; slot < TOTAL_TILE_COUNT; slot++) {
      if (slot !== indicator && !removed.has(slot)) { next = slot; break; }
    }
    for (let slot = TOTAL_TILE_COUNT - 1; slot >= 0; slot--) {
      if (slot !== indicator && !removed.has(slot)) { head = slot; break; }
    }
  }
  const nextStack = next < 0 ? -1 : Math.floor(next / TILES_PER_STACK);
  const headStack = head < 0 ? -1 : Math.floor(head / TILES_PER_STACK);
  const indicatorStack = indicator < 0 ? -1 : Math.floor(indicator / TILES_PER_STACK);

  view.count.textContent = String(remaining);
  view.position.textContent = indicator >= 0 ? `第 ${indicatorStack + 1} 墩翻痞` : '未翻痞';
  view.title.title = remaining > 0 ? '青色标记处普通摸牌，金色标记处杠后补牌；牌背数量与余牌数同步' : '牌墙已空，无牌可补';

  for (const [stackId, stack] of view.stacks.entries()) {
    stack.element.classList.toggle('is-next', stackId === nextStack);
    stack.element.classList.toggle('is-head', stackId === headStack);
    stack.element.classList.toggle('has-indicator', stackId === indicatorStack);
    stack.label.textContent = stackId === indicatorStack ? `痞·${stackId + 1}` : '';
    for (const [level, piece] of stack.pieces.entries()) {
      const slot = stackId * TILES_PER_STACK + level;
      const isIndicator = slot === indicator;
      const empty = removed.has(slot);
      const state = isIndicator ? `indicator-${game.indicatorTile}` : empty ? 'empty' : 'back';
      piece.element.classList.toggle('is-next-piece', slot === next);
      piece.element.classList.toggle('is-head-piece', slot === head);
      if (piece.state === state) continue;
      piece.state = state;
      piece.element.classList.toggle('is-empty', empty);
      piece.element.classList.toggle('is-indicator', isIndicator);
      piece.element.classList.toggle('tile', isIndicator);
      piece.element.classList.toggle('back', !isIndicator && !empty);
      if (isIndicator) {
        const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
        svg.setAttribute('viewBox', '0 0 60 84');
        const use = document.createElementNS(SVG_NAMESPACE, 'use');
        use.setAttribute('href', tileHref(game.indicatorTile));
        svg.append(use);
        piece.element.replaceChildren(svg);
        piece.face = svg;
      } else {
        piece.element.replaceChildren();
        piece.face = null;
      }
    }
  }
  const diceText = `骰子 ${info.dice[0]} 点和 ${info.dice[1]} 点，取较小点数 ${Math.min(...info.dice)}`;
  const indicatorText = indicator >= 0 ? `，痞子${tileName(/** @type {number} */ (game.indicatorTile))}在末端第 ${indicatorStack + 1} 墩上面一张` : '，未启用翻痞子';
  const nextText = next >= 0 ? `，下一张杠后补牌在第 ${nextStack + 1} 墩${next % TILES_PER_STACK === 0 ? '上面' : '下面'}一张，金色标记所指处` : '，牌墙已空，不能补牌';
  const headText = head >= 0 ? `，下一张普通摸牌在第 ${headStack + 1} 墩${head % TILES_PER_STACK === 0 ? '上面' : '下面'}一张，青色标记所指处` : '';
  element.setAttribute('aria-label', `四方牌墙，剩余 ${remaining} 张。${diceText}${indicatorText}${nextText}${headText}`);
  element.title = element.getAttribute('aria-label') || '';
}
