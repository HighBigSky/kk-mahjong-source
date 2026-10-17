import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

let playwright;
try { playwright = createRequire(import.meta.url)('playwright'); }
catch { playwright = createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright'); }

const output = path.resolve('output');
mkdirSync(output, { recursive:true });
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await playwright.chromium.launch({ headless:true, ...(existsSync(edge) ? { executablePath:edge } : {}) });
const report = { viewports:[], fixtures:0, selections:0, orientationTransitions:0, errors:[], failures:[] };
const sizes = [[280,600],[320,568],[375,667],[390,844],[667,375],[812,375],[360,320],[1440,900]];
const baseURL = process.env.MAHJONG_URL || 'http://localhost:5173';

async function fixture(page, { melds, drawn, names }) {
  return page.evaluate(({ melds, drawn, names }) => {
    const game = window.mahjongGame;
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    const count = (drawn ? 14 : 13) - 3 * melds;
    game.phase = { kind: 'discard', seat: 0 }; game.current = 0; game.pendingDiscard = null;
    game.winner = null; game.result = null; game.wall = [1,3,5,7,9,11,13];
    game.laiziEnabled = true; game.indicatorTile = 33; game.wildTile = 32;
    game.events = ['手牌完整显示检查'];
    game.players[0].hand = [31,32,30,29,27,25,23,21,19,17,15,13,11,9].slice(0, count);
    game.players[0].melds = Array.from({ length:melds }, (_, index) => ({ kind:'gang', tiles:Array(4).fill(index), from:1, concealed:false }));
    game.players[0].redGangs = [];
    game.lastDraw = drawn ? { player:0, tile:game.players[0].hand.at(-1), index:count - 1 } : null;
    const setting = document.querySelector('#names-setting');
    setting.checked = names;
    setting.dispatchEvent(new Event('change', { bubbles:true }));
    window.renderMahjong();
    return { hand:game.players[0].hand.slice(), indexes:[...document.querySelectorAll('#hand button')].map(element => Number(element.dataset.index)) };
  }, { melds, drawn, names });
}

async function inspect(page, state, expected) {
  const result = await page.evaluate(({ expected }) => {
    const issues = [];
    const r = element => {
      const rect = element.getBoundingClientRect();
      return { x:rect.x, y:rect.y, right:rect.right, bottom:rect.bottom, width:rect.width, height:rect.height };
    };
    const inside = (rect, label) => {
      if (rect.x < -.5 || rect.y < -.5 || rect.right > innerWidth + .5 || rect.bottom > innerHeight + .5) issues.push(`${label} exceeds viewport: ${JSON.stringify(rect)}`);
    };
    const disjoint = (a, b) => a.right <= b.x + .2 || b.right <= a.x + .2 || a.bottom <= b.y + .2 || b.bottom <= a.y + .2;
    const checkHits = (element, rect, label) => {
      const insetX = Math.min(2, rect.width * .15);
      const insetY = Math.min(2, rect.height * .15);
      for (const [dx,dy] of [[.5,.5],[0,0],[0,1],[1,0],[1,1]]) {
        const x = rect.x + insetX + dx * (rect.width - 2 * insetX);
        const y = rect.y + insetY + dy * (rect.height - 2 * insetY);
        const hit = document.elementFromPoint(x,y);
        if (!hit || !(hit === element || element.contains(hit))) issues.push(`${label} is occluded at ${x.toFixed(2)},${y.toFixed(2)} by ${hit?.tagName}.${hit?.className?.baseVal ?? hit?.className ?? ''}`);
      }
    };
    const footer = r(document.querySelector('.bottom-bar'));
    const root = r(document.querySelector('#game'));
    inside(root,'game');
    const overflow = { width:Math.max(document.body.scrollWidth,document.documentElement.scrollWidth), height:Math.max(document.body.scrollHeight,document.documentElement.scrollHeight) };
    if (overflow.width > innerWidth + 1 || overflow.height > innerHeight + 1) issues.push(`page overflow: ${JSON.stringify(overflow)} vs ${innerWidth}×${innerHeight}`);
    const buttons = [...document.querySelectorAll('#hand button')];
    if (buttons.length !== expected.hand.length) issues.push(`missing hand tiles: ${buttons.length} rendered vs ${expected.hand.length}`);
    const actualIndexes = buttons.map(button => Number(button.dataset.index));
    if (JSON.stringify(actualIndexes) !== JSON.stringify(expected.indexes)) issues.push('hand indexes changed');
    if (JSON.stringify(window.mahjongGame.players[0].hand) !== JSON.stringify(expected.hand)) issues.push('engine hand changed during layout checks');
    let lowest = 0, leftmost = innerWidth, rightmost = 0, selected = -1;
    const tileRects = [];
    for (const button of buttons) {
      const rect = r(button);
      const index = Number(button.dataset.index);
      if (button.classList.contains('selected')) selected = index;
      tileRects.push(rect);
      inside(rect,`tile ${index}`);
      checkHits(button,rect,`tile ${index}`);
      const face = r(button.querySelector('svg'));
      inside(face,`face ${index}`);
      if (!disjoint(rect,footer)) issues.push(`tile ${index} overlaps footer`);
      for (const child of button.querySelectorAll('.tile-name,.wild-marker,.red-kong-marker')) {
        const childRect = r(child);
        inside(childRect,`${child.className} ${index}`);
        if (!disjoint(childRect,footer)) issues.push(`${child.className} ${index} overlaps footer`);
      }
      lowest = Math.max(lowest,rect.bottom); leftmost = Math.min(leftmost,rect.x); rightmost = Math.max(rightmost,rect.right);
    }
    for (let index=1; index<tileRects.length; index++) if (!disjoint(tileRects[index-1],tileRects[index])) issues.push(`hand tiles ${index-1} and ${index} overlap`);
    for (const meld of document.querySelectorAll('#melds-0 .tile')) {
      const rect = r(meld); inside(rect,'meld tile');
      const face = r(meld.querySelector('svg')); inside(face,'meld face');
      checkHits(meld,rect,'meld tile');
      if (!disjoint(rect,footer)) issues.push('meld tile overlaps footer');
      for (const handRect of tileRects) if (!disjoint(rect,handRect)) issues.push('meld tile overlaps concealed tile');
    }
    return { issues, bounds:{ left:leftmost,right:rightmost,bottom:lowest,footerClearance:footer.y-lowest }, selected, count:buttons.length, drawn:buttons.filter(button=>button.classList.contains('drawn')).length };
  }, { expected });
  report.failures.push(...result.issues.map(issue => `${state}: ${issue}`));
  return result;
}

try {
  for (const [width,height] of sizes) {
    const context = await browser.newContext({ viewport:{ width,height }, reducedMotion:'reduce' });
    await context.addInitScript(() => localStorage.setItem('queqi-settings',JSON.stringify({ sound:false, speed:180, names:false })));
    const page = await context.newPage();
    page.on('pageerror', error=>report.errors.push(error.message));
    page.on('response', response=>{ if(response.status()>=400) report.errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(baseURL,{ waitUntil:'networkidle' });
    await page.waitForFunction(()=>window.mahjongGame && document.querySelectorAll('#hand button').length===14);
    const viewport = { width,height,fixtures:0,selections:0,minFooterClearance:null };
    for (const names of [false,true]) for (const drawn of [false,true]) for (let melds=0; melds<=4; melds++) {
      const state = `${width}×${height}, names ${names}, ${drawn?14:13} base tiles, ${melds} melds`;
      const expected = await fixture(page,{ melds,drawn,names });
      let result = await inspect(page,state,expected);
      report.fixtures++; viewport.fixtures++;
      if (result.drawn !== (drawn?1:0)) report.failures.push(`${state}: drawn tile missing/duplicated`);
      viewport.minFooterClearance = Math.min(viewport.minFooterClearance ?? Infinity,result.bounds.footerClearance);
      const indexes = await page.locator('#hand button[aria-disabled="false"]').evaluateAll(elements=>elements.map(element=>Number(element.dataset.index)));
      for (const index of indexes) {
        await page.locator(`#hand button[data-index="${index}"]`).click();
        result = await inspect(page,`${state}, selected ${index}`,expected);
        if (result.selected !== index) report.failures.push(`${state}: selected ${index} not raised`);
        report.selections++; viewport.selections++;
      }
    }
    // Resizing must not reset, duplicate or silently drop the currently held tiles.
    const expected = await fixture(page,{ melds:0,drawn:true,names:true });
    const selectable = await page.locator('#hand button[aria-disabled="false"]').last().getAttribute('data-index');
    await page.locator(`#hand button[data-index="${selectable}"]`).click();
    for (const next of [{width:height,height:width},{width,height}]) {
      await page.setViewportSize(next);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const result = await inspect(page,`${width}×${height} resized to ${next.width}×${next.height}`,expected);
      if (result.selected !== Number(selectable)) report.failures.push('resizing lost selected hand index');
      report.orientationTransitions++;
    }
    if ((width===390&&height===844)||(width===667&&height===375)) await page.screenshot({path:path.join(output,width===390?'hand-visibility-phone.png':'hand-visibility-landscape.png')});
    report.viewports.push(viewport);
    await context.close();
  }
} finally {
  await browser.close();
  report.failures = [...new Set(report.failures)];
  report.errors = [...new Set(report.errors)];
  writeFileSync(path.join(output,'hand-visibility-report.json'),JSON.stringify(report,null,2));
}
console.log(JSON.stringify({ viewports:report.viewports.length,fixtures:report.fixtures,selections:report.selections,orientationTransitions:report.orientationTransitions,failures:report.failures.length,errors:report.errors.length },null,2));
assert.deepEqual(report.errors,[],'browser errors');
assert.deepEqual(report.failures,[],'hand visibility regressions; see output/hand-visibility-report.json');
