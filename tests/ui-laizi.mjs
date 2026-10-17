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
const browser = await playwright.chromium.launch({headless:true, ...(existsSync(edge) ? {executablePath:edge} : {})});
const report = {viewports:[],interactions:[],errors:[],failures:[]};

async function openPage(viewport, laizi = false, deviceScaleFactor = 1) {
  const context = await browser.newContext({viewport,deviceScaleFactor});
  await context.addInitScript(laizi => {
    if (!sessionStorage.getItem('laizi-ui-initialized')) {
      localStorage.setItem('queqi-settings',JSON.stringify({speed:180,names:false,sound:false,laizi}));
      localStorage.removeItem('queqi-scores');
      sessionStorage.setItem('laizi-ui-initialized','true');
    }
  },laizi);
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(process.env.MAHJONG_URL || 'http://localhost:5173',{waitUntil:'networkidle'});
  await page.waitForFunction(() => window.mahjongGame && document.querySelectorAll('#hand button').length === 14);
  return {page,context};
}

async function state(page) {
  return page.evaluate(() => {
    const g = window.mahjongGame;
    const tiles = [...g.wall,...g.players.flatMap(p => [...p.hand,...p.redGangs,...p.discards,...p.melds.flatMap(m => m.tiles)]),...(g.indicatorTile == null ? [] : [g.indicatorTile])];
    return {
      enabled:g.laiziEnabled,indicator:g.indicatorTile,wild:g.wildTile,wall:g.wall.length,
      round:g.round,dealer:g.dealer,hands:g.players.map(p => p.hand.length),
      count:tiles.length,copies:Array.from({length:34},(_,tile) => tiles.filter(value => value === tile).length),
    };
  });
}

async function verifyHUD(page) {
  const expected = await page.evaluate(async () => {
    const {tileName} = await import('/engine.js');
    const g = window.mahjongGame;
    return {indicator:tileName(g.indicatorTile),wild:tileName(g.wildTile)};
  });
  assert.equal(await page.locator('#laizi-summary').isVisible(),true);
  assert.equal(await page.locator('#indicator-tile .tile').getAttribute('aria-label'),expected.indicator);
  assert.equal(await page.locator('#wild-tile .tile').getAttribute('aria-label'),`${expected.wild}，癞子`);
  assert.equal(await page.locator('#wild-tile .wild-marker').count(),1);
  assert.match(await page.locator('#laizi-summary').getAttribute('aria-label'),new RegExp(`皮子${expected.indicator}，癞子${expected.wild}`));
}

async function verifyGeometry(page, label) {
  const layout = await page.evaluate(() => {
    const rect = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
    };
    return {root:rect('#game'),wallet:rect('.wallet-pill'),hud:rect('#laizi-summary'),tools:rect('.top-tools'),title:rect('.room-heading'),pageWidth:document.body.scrollWidth,pageHeight:document.body.scrollHeight,width:innerWidth,height:innerHeight};
  });
  const disjoint = (a,b) => a.right <= b.x+.5 || b.right <= a.x+.5 || a.bottom <= b.y+.5 || b.bottom <= a.y+.5;
  assert.ok(layout.pageWidth <= layout.width+1 && layout.pageHeight <= layout.height+1,`${label}: page overflow`);
  for (const name of ['wallet','hud','tools','title']) {
    const r = layout[name];
    assert.ok(r.width > 0 && r.height > 0,`${label}: ${name} hidden`);
    assert.ok(r.x >= layout.root.x-.5 && r.right <= layout.root.right+.5 && r.y >= layout.root.y-.5 && r.bottom <= layout.root.bottom+.5,`${label}: ${name} exceeds game bounds`);
  }
  for (const [a,b] of [['wallet','hud'],['hud','tools'],['wallet','tools'],['hud','title']]) assert.ok(disjoint(layout[a],layout[b]),`${label}: ${a} overlaps ${b}`);
  return layout;
}

async function verifyTurnGeometry(page, label) {
  const layout = await page.evaluate(() => {
    const rect = selector => {
      const r=document.querySelector(selector).getBoundingClientRect();
      return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};
    };
    return {root:rect('#game'),text:rect('#turn-text'),turn:rect('.turn-message'),seat:rect('#opponent-0'),event:rect('.last-event'),actions:rect('.action-zone')};
  });
  assert.ok(layout.text.x >= layout.root.x-.5 && layout.text.right <= layout.root.right+.5,`${label}: explanatory text exceeds game width`);
  assert.ok(layout.seat.bottom <= layout.turn.y+.5,`${label}: red prerequisite message overlaps player seat`);
  assert.ok(layout.turn.bottom <= layout.event.y+.5,`${label}: red prerequisite message overlaps last event`);
  assert.ok(layout.event.bottom <= layout.actions.y+.5,`${label}: last event overlaps actions`);
}

async function restart(page) {
  await page.locator('#restart-btn').click();
  await page.locator('#confirm-restart').click();
}

async function fixture(page, winning = false) {
  await page.evaluate(winning => {
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    const g = window.mahjongGame;
    g.newRound('ui-laizi-interaction',{restart:true,laizi:true});
    g.indicatorTile = 4; g.wildTile = 5;
    g.players.forEach(p => {p.hand=[27,27,28,28,29,29,30,30,32,32,33,33,18];p.melds=[];p.discards=[];p.redGangs=[];});
    g.players[0].hand = winning
      ? [0,1,2,9,10,11,18,19,20,27,27,27,28,5]
      : [3,17,2,19,5,20,27,30,12,28,14,10,29,22];
    g.wall=[25,24,23,22,21];
    g.result=null;g.winner=null;g.phase = { kind: 'discard', seat: 0 };g.current=0;g.pendingDiscard=null;
    g._responses=[null,null,null,null];
    g.lastDraw={player:0,tile:g.players[0].hand.at(-1),index:13};
    window.renderMahjong();
  },winning);
}

async function redBlockedFixture(page, discardWin = false) {
  await page.evaluate(discardWin => {
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    const g = window.mahjongGame;
    g.newRound('ui-held-red-blocks-hu',{restart:true,laizi:true});
    g.indicatorTile=4;g.wildTile=5;
    g.players.forEach(p => {p.melds=[];p.discards=[];p.redGangs=[];});
    g.players[0].hand = [0,1,2,9,10,11,18,19,20,27,27,27,31,31];
    g.wall=[25,28,28];
    g.result=null;g.winner=null;g.phase = { kind: 'discard', seat: 0 };g.current=0;g.pendingDiscard=null;
    g._responses=[null,null,null,null];g.lastDraw={player:0,tile:31,index:13};
    if (discardWin) {
      g.players[0].hand.splice(11,1);
      g.players[3].discards=[27];
      g.current=3;g.pendingDiscard = {tile:27,from:3}; g.phase = { kind: 'claim', discard: g.pendingDiscard };g.lastDraw=null;
    }
    window.renderMahjong();
  },discardWin);
}

try {
  const {page,context} = await openPage({width:390,height:844});
  const initial = await state(page);
  assert.equal(initial.enabled,false);
  assert.equal(initial.wall,83);
  assert.equal(await page.locator('#laizi-summary').isVisible(),false);
  await page.locator('#settings-btn').click();
  await page.locator('#laizi-setting').check();
  assert.deepEqual(await state(page),initial,'changing preference mutated the active round');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('queqi-settings')).laizi),true);
  await page.locator('#settings-dialog .primary-button').click();
  await restart(page);
  const active = await state(page);
  assert.equal(active.enabled,true);
  assert.equal(active.round,initial.round);
  assert.equal(active.dealer,initial.dealer);
  assert.equal(active.wall,82);
  assert.deepEqual(active.hands,[14,13,13,13]);
  assert.equal(active.count,136);
  assert.deepEqual(active.copies,Array(34).fill(4));
  await verifyHUD(page);
  report.interactions.push('optional setting waits for next deal; restart preserves dealer/round; public indicator outside 82-tile wall; all 136 physical tiles conserved');

  await page.reload({waitUntil:'networkidle'});
  assert.equal((await state(page)).enabled,true);
  await verifyHUD(page);
  await page.locator('#settings-btn').click();
  assert.equal(await page.locator('#laizi-setting').isChecked(),true);
  await page.locator('#laizi-setting').uncheck();
  assert.equal((await state(page)).enabled,true,'disabling preference mutated active round');
  await page.locator('#settings-dialog .primary-button').click();
  await restart(page);
  const disabled = await state(page);
  assert.equal(disabled.enabled,false);
  assert.equal(disabled.indicator,null);
  assert.equal(disabled.wild,null);
  assert.equal(disabled.wall,83);
  assert.equal(await page.locator('#laizi-summary').isVisible(),false);
  assert.equal(await page.locator('.is-wild,.wild-marker').count(),0);
  report.interactions.push('saved preference survives reload; disabling waits for deal then clears indicator, wild markers and restores 83-tile wall');

  await fixture(page);
  await verifyHUD(page);
  const wildButton = page.locator('#hand button.is-wild');
  assert.equal(await wildButton.count(),1);
  assert.equal(await wildButton.getAttribute('data-index'),'4','descending sort changed original tile index');
  assert.match(await wildButton.getAttribute('aria-label'),/六万，癞子/);
  await wildButton.locator('.wild-marker').click();
  assert.equal(await page.locator('#hand button.selected').getAttribute('data-index'),'4');
  await page.locator('#hand button.selected').click();
  assert.equal(await page.evaluate(() => window.mahjongGame.players[0].discards.at(-1)),5);
  assert.equal(await page.locator('#river-0 .is-wild .wild-marker').count(),1);
  report.interactions.push('descending wild hand selection keeps engine index; clicking wild badge selects and discards actual tile; river retains wild marker');

  await fixture(page);
  await page.locator('#hint-btn').click();
  assert.equal(await page.locator('#hand button.hinted').count(),1);
  assert.equal(await page.locator('#hand button.hinted.is-wild').count(),0,'hint discarded the only wild while isolated normal tiles exist');
  const hintedIndex = await page.locator('#hand button.hinted').getAttribute('data-index');
  const hintedTile = await page.evaluate(index => window.mahjongGame.players[0].hand[Number(index)],hintedIndex);
  await page.locator('#hand button.hinted').click();
  assert.equal(await page.evaluate(() => window.mahjongGame.players[0].discards.at(-1)),hintedTile);
  report.interactions.push('wild-aware hint preserves wild tile and discards selected original index');

  await fixture(page,true);
  assert.equal(await page.evaluate(async () => {
    const {isWinning}=await import('/engine.js');
    return isWinning(window.mahjongGame.players[0].hand);
  }),false,'wild fixture unexpectedly wins without a substitution');
  assert.equal(await page.locator('#action-hu').isEnabled(),true);
  await page.locator('#action-hu').click();
  await page.waitForFunction(() => document.querySelector('#result-dialog').open);
  assert.match(await page.locator('#result-detail').innerText(),/自摸/);
  assert.equal(await page.locator('#result-hand .tile').count(),14);
  assert.equal(await page.locator('#result-hand .is-wild .wild-marker').count(),1);
  report.interactions.push('wild substitution enables real self-draw win and settlement displays physical wild tile');
  await page.locator('#next-round').click();

  await redBlockedFixture(page);
  assert.equal(await page.evaluate(async () => {
    const {isWinning}=await import('/engine.js');
    return isWinning(window.mahjongGame.players[0].hand);
  }),true,'red pair fixture must be an otherwise winning natural hand');
  assert.equal(await page.locator('#action-hu').isDisabled(),true);
  assert.match(await page.locator('#turn-text').innerText(),/红中/);
  assert.equal(await page.locator('#action-context').innerText(),'先杠出红中，才能胡牌');
  const beforeRedHint = await page.evaluate(() => {
    const g=window.mahjongGame,p=g.players[0];
    return {hand:p.hand,redGangs:p.redGangs,discards:p.discards,wall:g.wall,phase:g.phase.kind,current:g.current};
  });
  await page.locator('#hint-btn').click();
  assert.equal(await page.locator('#hand button.hinted,#hand button.selected').count(),0,'red hint must not select a non-discardable red');
  assert.equal(await page.evaluate(() => document.activeElement?.id),'action-gang','red hint must focus the legal single red kong');
  assert.match(await page.locator('#toast').innerText(),/红中.*杠/);
  assert.deepEqual(await page.evaluate(() => {
    const g=window.mahjongGame,p=g.players[0];
    return {hand:p.hand,redGangs:p.redGangs,discards:p.discards,wall:g.wall,phase:g.phase.kind,current:g.current};
  }),beforeRedHint,'hint unexpectedly changed red or replacement tiles');
  await page.locator('#action-gang').click();
  assert.equal(await page.evaluate(() => window.mahjongGame.players[0].hand.filter(tile => tile===31).length),1);
  assert.equal(await page.locator('#action-hu').isDisabled(),true,'one remaining held red still blocks Hu');
  assert.equal(await page.locator('#action-context').innerText(),'先杠出红中，才能胡牌');
  await page.locator('#action-gang').click();
  assert.equal(await page.evaluate(() => window.mahjongGame.players[0].hand.includes(31)),false);
  assert.equal(await page.locator('#red-gangs-0').innerText(),'中×2');
  assert.equal(await page.locator('#action-hu').isEnabled(),true,'removing final red must unblock a winning replacement hand');
  await page.locator('#action-hu').click();
  await page.waitForFunction(() => document.querySelector('#result-dialog').open);
  assert.match(await page.locator('#result-detail').innerText(),/自摸/);
  assert.equal(await page.evaluate(() => window.mahjongGame.phase.kind),'ended');
  report.interactions.push('natural red-pair win blocked until both single red kongs; hint focuses kong without selecting a red; final replacement enables actual self-draw settlement');

  await redBlockedFixture(page,true);
  assert.equal(await page.evaluate(async () => {
    const {isWinning}=await import('/engine.js');
    const g=window.mahjongGame;
    return isWinning([...g.players[0].hand,g.pendingDiscard.tile]);
  }),true,'discard red-block fixture must form a winning shape');
  assert.equal(await page.locator('#action-hu').isDisabled(),true);
  assert.equal(await page.locator('#action-peng').isEnabled(),true,'held-red win block must retain other legal responses');
  assert.equal(await page.locator('#action-pass').isEnabled(),true);
  assert.match(await page.locator('#turn-text').innerText(),/红中/);
  assert.equal(await page.locator('#action-context').innerText(),'先杠出红中，才能胡牌');
  for (const viewport of [{width:375,height:667},{width:390,height:844},{width:1080,height:1920},{width:1440,height:900}]) {
    await page.setViewportSize(viewport);
    await verifyTurnGeometry(page,`${viewport.width} held red blocks discard Hu message`);
    await redBlockedFixture(page);
    assert.match(await page.locator('#turn-text').innerText(),/红中.*只能杠/);
    await verifyTurnGeometry(page,`${viewport.width} red can only kong during own turn message`);
    await page.locator('#hint-btn').click();
    assert.equal(await page.locator('#hand button.hinted,#hand button.selected').count(),0);
    assert.equal(await page.evaluate(() => document.activeElement?.id),'action-gang');
    await redBlockedFixture(page,true);
  }
  report.interactions.push('held red blocks discard win while retaining legal peng/pass response and red prerequisite message');
  await context.close();

  for (const viewport of [{width:375,height:667},{width:390,height:844},{width:1080,height:1920},{width:1440,height:900}]) {
    const current = await openPage(viewport,true);
    await verifyHUD(current.page);
    const layout = await verifyGeometry(current.page,`${viewport.width} active laizi HUD`);
    report.viewports.push({...viewport,game:layout.root,passed:true});
    await current.context.close();
  }

  const preview = await openPage({width:540,height:960},true,2);
  const previewState = await preview.page.evaluate(() => {
    const g=window.mahjongGame;
    let seed;
    for (let i=0;i<2000;i++) {
      seed=`laizi-portrait-${i}`;
      g.newRound(seed,{restart:true,laizi:true});
      if (g.indicatorTile === 4 && g.players[0].hand.includes(g.wildTile)) break;
    }
    window.renderMahjong();
    return {seed,indicator:g.indicatorTile,wild:g.wildTile,visibleWild:g.players[0].hand.includes(g.wildTile)};
  });
  assert.deepEqual({indicator:previewState.indicator,wild:previewState.wild,visibleWild:previewState.visibleWild},{indicator:4,wild:5,visibleWild:true});
  await verifyGeometry(preview.page,'1080x1920 laizi portrait preview');
  await preview.page.locator('#game').screenshot({path:path.join(output,'game-laizi-preview-1080x1920.png')});
  report.preview=previewState;
  await preview.context.close();
  assert.deepEqual(report.errors,[],'console/network errors');
} catch (error) { report.failures.push(error.stack); }
finally {
  await browser.close();
  writeFileSync(path.join(output,'ui-laizi-report.json'),JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report,null,2));
if (report.failures.length) process.exitCode=1;
