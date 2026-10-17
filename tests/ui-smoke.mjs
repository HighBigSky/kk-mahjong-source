import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Bundled runtime is optional; ordinary npm-installed Playwright works as well.
let playwright;
try { playwright = createRequire(import.meta.url)('playwright'); }
catch {
  playwright = createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
}
const baseURL = process.env.MAHJONG_URL || 'http://localhost:5173';
const output = path.resolve('output');
mkdirSync(output, { recursive: true });
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await playwright.chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) });
const failures = [];
const report = { viewports: [], interactions: [], errors: [] };

async function openPage(viewport, deviceScaleFactor = 1) {
  const context = await browser.newContext({ viewport, deviceScaleFactor });
  await context.addInitScript(() => {
    localStorage.setItem('queqi-settings', JSON.stringify({ speed: 180, names: false, sound: false }));
    localStorage.removeItem('queqi-scores');
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.mahjongGame && document.querySelectorAll('#hand button').length === 14);
  return { page, context };
}

async function geometry(page, state) {
  const result = await page.evaluate(() => {
    const rect = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const root = rect('#game');
    const hand = [...document.querySelectorAll('#hand button')].map(button => {
      const r = button.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, selected: button.classList.contains('selected') };
    });
    const actions = [...document.querySelectorAll('.action-button')].map(button => {
      const r = button.getBoundingClientRect();
      return { width: r.width, height: r.height, x: r.x, right: r.right, bottom: r.bottom };
    });
    const names = [...document.querySelectorAll('.tile-name')].map(element => element.getBoundingClientRect().bottom);
    return {
      root, hand, actions, heading: rect('.hand-heading'), footer: rect('.bottom-bar'),
      instruction: rect('.hand-instruction'),
      instructionVisible: getComputedStyle(document.querySelector('.hand-instruction')).visibility !== 'hidden',
      namesBottom: names.length ? Math.max(...names) : null,
      bodyWidth: document.body.scrollWidth, viewportWidth: innerWidth,
      bodyHeight: document.body.scrollHeight, viewportHeight: innerHeight,
      actionZone: rect('.action-zone'),
      table: rect('.table'), turn: rect('.turn-message'), event: rect('.last-event'),
      seats: [...document.querySelectorAll('.player-seat')].map(element => {
        const r = element.getBoundingClientRect();
        return {
          id: element.id, classes: [...element.classList],
          x: r.x, y: r.y, right: r.right, bottom: r.bottom,
          portrait: rect(`#${element.id} .portrait`), copy: rect(`#${element.id} .opponent-copy`),
          lines: ['.opponent-name', '.opponent-score', '.opponent-state'].map(selector => rect(`#${element.id} ${selector}`)),
          badges: [...element.querySelectorAll('.dealer-badge:not([hidden]), .red-gang-badge:not([hidden]), .seat')].map(badge => {
            const r = badge.getBoundingClientRect();
            return { x:r.x, y:r.y, right:r.right, bottom:r.bottom };
          }),
        };
      }),
      current: window.mahjongGame.current,
      activeSeats: [...document.querySelectorAll('.player-seat.is-active')].map(element => element.id),
      melds: [...document.querySelectorAll('#melds-0 .tile')].map(el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      }),
    };
  });
  assert.ok(result.bodyWidth <= result.viewportWidth + 1, `${state}: horizontal page overflow`);
  assert.ok(result.bodyHeight <= result.viewportHeight + 1, `${state}: vertical page overflow`);
  assert.equal(result.actions.length, 5);
  assert.ok(result.actions.every(a => Math.abs(a.width - result.actions[0].width) < .2 && Math.abs(a.height - result.actions[0].height) < .2), `${state}: action sizes differ`);
  assert.ok(result.actionZone.bottom <= result.heading.y, `${state}: action zone overlaps hand heading`);
  const disjoint = (a, b) => a.right <= b.x + .5 || b.right <= a.x + .5 || a.bottom <= b.y + .5 || b.bottom <= a.y + .5;
  assert.equal(result.seats.length, 4, `${state}: all four player seats must appear`);
  assert.equal(new Set(result.seats.map(seat => seat.id)).size, 4, `${state}: duplicate player seats`);
  assert.deepEqual(result.activeSeats, [`opponent-${result.current}`], `${state}: current player's seat is not highlighted`);
  const tableCenterX = (result.table.x + result.table.right) / 2;
  const tableCenterY = (result.table.y + result.table.bottom) / 2;
  const expectedSeats = ['bottom', 'right', 'top', 'left'];
  for (const [index, position] of expectedSeats.entries()) {
    const seat = result.seats.find(seat => seat.id === `opponent-${index}`);
    assert.ok(seat && seat.classes.includes(`seat-${position}`), `${state}: player ${index} must occupy ${position} position`);
    assert.ok(seat.x >= result.root.x - .5 && seat.right <= result.root.right + .5 && seat.y >= result.root.y - .5 && seat.bottom <= result.root.bottom + .5, `${state}: player ${index} exceeds game bounds`);
    if (position === 'top' || position === 'bottom') {
      assert.ok(Math.abs((seat.x+seat.right)/2-tableCenterX) < 1, `${state}: ${position} player is not centered at table`);
      assert.ok(position === 'top' ? seat.bottom <= result.table.y + .5 : seat.y >= result.table.bottom - .5, `${state}: player ${index} overlaps tabletop cards`);
    } else {
      assert.ok(Math.abs((seat.y+seat.bottom)/2-tableCenterY) < 1, `${state}: ${position} player is not centered beside table`);
      assert.ok(position === 'left' ? seat.right <= result.table.x + .5 : seat.x >= result.table.right - .5, `${state}: player ${index} overlaps tabletop cards`);
    }
    assert.ok(disjoint(seat.portrait, seat.copy), `${state}: player ${index} portrait overlaps text`);
    for (const badge of seat.badges) {
      assert.ok(badge.x >= seat.x - .5 && badge.right <= seat.right + .5 && badge.y >= seat.y - .5 && badge.bottom <= seat.bottom + .5, `${state}: player ${index} badge exceeds seat card`);
      assert.ok(disjoint(badge, seat.copy), `${state}: player ${index} badge overlaps text`);
    }
    for (let i = 0; i < seat.badges.length; i++) for (let j = i + 1; j < seat.badges.length; j++) assert.ok(disjoint(seat.badges[i], seat.badges[j]), `${state}: player ${index} badges overlap`);
    for (const line of seat.lines) assert.ok(line.x >= seat.x - .5 && line.right <= seat.right + .5 && line.y >= seat.y - .5 && line.bottom <= seat.bottom + .5, `${state}: player ${index} text exceeds seat card`);
    for (let i = 0; i < seat.lines.length; i++) for (let j = i + 1; j < seat.lines.length; j++) assert.ok(disjoint(seat.lines[i], seat.lines[j]), `${state}: player ${index} text lines overlap`);
  }
  for (let i = 0; i < result.seats.length; i++) for (let j = i + 1; j < result.seats.length; j++) assert.ok(disjoint(result.seats[i], result.seats[j]), `${state}: player seat cards overlap`);
  const bottomSeats = result.seats.filter(seat => seat.classes.includes('seat-bottom'));
  assert.ok(bottomSeats.every(seat => seat.bottom <= result.turn.y + .5), `${state}: bottom player seats overlap turn message`);
  assert.ok(result.turn.bottom <= result.event.y + .5 && result.event.bottom <= result.actionZone.y + .5, `${state}: messages overlap controls`);
  for (let i = 0; i < result.hand.length; i++) {
    const tile = result.hand[i];
    assert.ok(tile.x >= result.root.x - 1 && tile.right <= result.root.right + 1, `${state}: tile exceeds game width`);
    assert.ok(tile.bottom < result.footer.y, `${state}: tile overlaps footer`);
    assert.ok(tile.y >= result.heading.bottom - 1, `${state}: selected tile overlaps hand heading`);
    if (i) assert.ok(tile.x >= result.hand[i - 1].right - .5, `${state}: adjacent hand tiles overlap`);
  }
  if (result.instructionVisible) assert.ok(result.instruction.bottom < result.footer.y, `${state}: instruction overlaps footer`);
  if (result.namesBottom !== null) {
    assert.ok(result.namesBottom < result.footer.y, `${state}: tile labels overlap footer`);
    if (result.instructionVisible) assert.ok(result.namesBottom <= result.instruction.y + .5, `${state}: tile labels overlap instruction`);
  }
  for (const meld of result.melds) {
    for (const tile of result.hand) assert.ok(meld.right <= tile.x || meld.x >= tile.right || meld.bottom <= tile.y || meld.y >= tile.bottom, `${state}: exposed meld overlaps concealed hand`);
  }
  return result;
}

async function fixture(page, kind) {
  await page.evaluate(kind => {
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    const g = window.mahjongGame;
    // Completed fixtures use a fresh round so the result dialog's per-round
    // duplicate guard cannot suppress the next independent settlement check.
    g.newRound(`ui-${kind}`, { restart:g.phase.kind !== 'ended' });
    g.players.forEach(player => {
      player.hand = [6,8,10,12,14,16,19,21,23,25,29,30,31];
      player.melds = []; player.redGangs = []; player.discards = []; player.score = 1000;
    });
    g.wall = [25,24,23,22,21];
    g.result = null; g.winner = null; g.events = [`UI smoke: ${kind}`];
    g._responses = [null, null, null, null];
    if (kind === 'hu') {
      g.players[0].hand = [0,1,2,9,10,11,18,19,20,27,27,27,28,28];
      g.phase = { kind: 'discard', seat: 0 }; g.current = 0; g.pendingDiscard = null;
      g.lastDraw = { player: 0, tile: 28, index: 13 };
    } else if (kind === 'concealed-gang') {
      g.players[0].hand = [0,0,0,0,4,4,4,4,9,10,11,12,13,14];
      g.phase = { kind: 'discard', seat: 0 }; g.current = 0; g.pendingDiscard = null;
      g.lastDraw = { player: 0, tile: 14, index: 13 };
    } else if (kind === 'added-gang') {
      g.players[0].hand = [0,9,10,11,12,13,14,18,19,20,27];
      g.players[0].melds = [{ kind:'peng', tiles:[0,0,0], from:3, concealed:false }];
      g.phase = { kind: 'discard', seat: 0 }; g.current = 0; g.pendingDiscard = null;
      g.lastDraw = { player:0, tile:0, index:0 };
    } else if (kind.startsWith('red-gang')) {
      g.players[0].hand = kind === 'red-gang-choice'
        ? [0,0,0,0,9,10,12,14,16,19,21,23,29,31]
        : kind === 'red-gang-four'
        ? [6,8,10,12,14,16,19,21,23,25,31,31,31,31]
        : [6,8,10,12,14,16,19,21,23,25,29,30,31,31];
      if (kind === 'red-gang-empty') g.wall = [];
      g.phase = { kind: 'discard', seat: 0 }; g.current = 0; g.pendingDiscard = null;
      g.lastDraw = { player:0, tile:31, index:13 };
    } else {
      const hands = {
        chi: [0,1,3,4,9,11,13,15,18,20,22,27,28],
        peng: [0,1,2,2,4,9,11,13,18,20,22,27,28],
        gang: [0,1,2,2,2,9,11,13,18,20,22,27,28],
        pass: [0,1,3,4,9,11,13,15,18,20,22,27,28],
        'discard-hu': [0,1,2,9,10,11,18,19,20,27,27,27,28],
      };
      const tile = kind === 'discard-hu' ? 28 : 2;
      g.players[0].hand = hands[kind];
      g.players[3].discards = [tile];
      g.current = 3; g.pendingDiscard = { tile, from: 3 }; g.phase = { kind: 'claim', discard: g.pendingDiscard };
      g.lastDraw = null;
    }
    window.renderMahjong();
  }, kind);
}

try {
  for (const viewport of [{width:375,height:667},{width:390,height:844},{width:1080,height:1920},{width:1440,height:900}]) {
    const { page, context } = await openPage(viewport);
    await page.evaluate(() => { window.mahjongGame.newRound('ui-layout', { restart:true }); window.renderMahjong(); });
    assert.equal(await page.locator('#hand button').count(), 14);
    assert.equal(await page.locator('#hand button.drawn').count(), 1);
    const initial = await geometry(page, `${viewport.width} initial`);
    await page.locator('#hand button:not([aria-disabled="true"])').first().click();
    assert.equal(await page.locator('#hand button.selected').count(), 1);
    await geometry(page, `${viewport.width} selected`);
    await page.locator('#settings-btn').click();
    const dialogFits = await page.locator('#settings-dialog').evaluate(dialog => {
      const r = dialog.getBoundingClientRect(), g = document.querySelector('#game').getBoundingClientRect();
      return r.width <= g.width && r.x >= g.x && r.right <= g.right && r.y >= g.y && r.bottom <= g.bottom;
    });
    assert.ok(dialogFits, `${viewport.width}: settings dialog exceeds game bounds`);
    await page.locator('#names-setting').check();
    await page.locator('#settings-dialog .primary-button').click();
    await geometry(page, `${viewport.width} labels`);
    await page.screenshot({path:path.join(output, `ui-${viewport.width}x${viewport.height}.png`)});
    report.viewports.push({ ...viewport, game: initial.root, passed:true });
    await context.close();
  }

  const { page, context } = await openPage({width:390,height:844});
  await page.locator('#rules-btn').click();
  assert.equal(await page.locator('#rules-dialog').evaluate(d => d.open), true);
  await page.locator('#rules-dialog .primary-button').click();
  await page.locator('#settings-btn').click();
  await page.locator('#speed-setting').selectOption('180');
  await page.locator('#names-setting').check();
  await page.locator('#settings-dialog .primary-button').click();
  assert.equal(await page.locator('.tile-name').count(), 14);
  await page.locator('#sound-btn').click();
  assert.equal(await page.locator('#sound-btn').getAttribute('aria-pressed'), 'true');
  await page.locator('#sound-btn').click();
  const initialRound = await page.evaluate(() => window.mahjongGame.round);
  await page.locator('#restart-btn').click();
  await page.locator('#restart-dialog .secondary-button').click();
  assert.equal(await page.evaluate(() => window.mahjongGame.round), initialRound);
  await page.locator('#restart-btn').click();
  await page.locator('#confirm-restart').click();
  assert.equal(await page.evaluate(() => window.mahjongGame.round), initialRound);
  assert.equal(await page.evaluate(() => window.mahjongGame.dealer), 0);
  assert.equal(await page.locator('.dealer-badge:not([hidden])').getAttribute('id'), 'dealer-0');
  report.interactions.push('rules, settings, sound, restart-confirm/cancel preserves round and dealer');

  await page.locator('#hand button:not([aria-disabled="true"])').first().click();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.index), await page.locator('#hand button.selected').getAttribute('data-index'));
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.index), await page.locator('#hand button.selected').getAttribute('data-index'));
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.mahjongGame.players[0].discards.length), 1);
  await page.locator('#settings-btn').click();
  const pausedState = await page.evaluate(() => JSON.stringify({phase:window.mahjongGame.phase.kind,current:window.mahjongGame.current,events:window.mahjongGame.events}));
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => JSON.stringify({phase:window.mahjongGame.phase.kind,current:window.mahjongGame.current,events:window.mahjongGame.events})), pausedState, 'AI continued while modal open');
  await page.locator('#settings-dialog .primary-button').click();
  report.interactions.push('keyboard selection retains focus; Enter discards; modal pauses AI');

  await page.evaluate(() => { window.mahjongGame.newRound('ui-live-play', { restart:true }); window.renderMahjong(); });
  let humanDiscards = 0;
  const deadline = Date.now() + 30000;
  while (humanDiscards < 8 && Date.now() < deadline) {
    const state = await page.evaluate(() => ({phase:window.mahjongGame.phase.kind,current:window.mahjongGame.current,pass:window.mahjongGame.getActions(0).pass,hu:window.mahjongGame.getActions(0).hu}));
    if (state.phase === 'ended') break;
    if (state.pass) { await page.locator('#action-pass').click(); continue; }
    if (state.phase === 'discard' && state.current === 0) {
      await page.locator('#hint-btn').click();
      if (await page.locator('#hand button.selected').count() === 0) {
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'action-gang', 'red hint must focus the legal kong action');
        await page.locator('#action-gang').click();
        continue;
      }
      assert.equal(await page.locator('#hand button.selected[aria-disabled="true"]').count(), 0, 'hint selected a non-discardable red');
      await page.locator('#hand button.selected').click();
      humanDiscards++;
    } else await page.waitForTimeout(100);
  }
  assert.ok(humanDiscards >= 6, `AI loop advanced only ${humanDiscards} human discards`);
  assert.ok(await page.evaluate(() => window.mahjongGame.players.slice(1).some(p => p.discards.length > 0)), 'AI did not discard');
  report.interactions.push(`${humanDiscards} human hint/discard turns with real AI`);
  await page.locator('#river-0').click();
  assert.ok(await page.locator('#history-tiles .tile').count() > 0);
  await page.locator('#history-dialog .primary-button').click();
  report.interactions.push('discard-history dialog');

  await fixture(page, 'chi');
  await page.locator('#action-chi').click();
  assert.equal(await page.locator('#choice-options button').count(), 3);
  await page.locator('#choice-options button').first().click();
  assert.equal(await page.evaluate(() => window.mahjongGame.players[0].melds[0].kind), 'chi');
  assert.equal(await page.locator('#hand button').count(), 11);
  await page.locator('#hand button').first().click();
  await geometry(page, 'selected hand after chi with names');
  report.interactions.push('three chi choices, chi execution, selected meld layout');

  await fixture(page, 'red-gang');
  const redStart = await page.evaluate(() => ({hand:window.mahjongGame.players[0].hand.length,wall:window.mahjongGame.wall.length}));
  const redSnapshot = () => page.evaluate(() => {
    const g=window.mahjongGame,p=g.players[0];
    return {hand:p.hand,wall:g.wall,reds:p.redGangs,discards:p.discards,phase:g.phase.kind,current:g.current,events:g.events};
  });
  const beforeRedClick = await redSnapshot();
  const redButton = page.locator('#hand button.red-kong-tile').first();
  assert.equal(await page.locator('#hand button.red-kong-tile').count(), 2);
  assert.equal(await redButton.getAttribute('aria-disabled'), 'true');
  assert.match(await redButton.getAttribute('aria-label'), /只能杠/);
  await redButton.click({force:true});
  await redButton.click({force:true});
  assert.equal(await page.locator('#hand button.selected').count(), 0, 'red cannot be selected for discard');
  assert.match(await page.locator('#toast').innerText(), /红中.*只能.*杠/);
  await redButton.focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await redSnapshot(), beforeRedClick, 'red click or Enter altered play state');
  for (let press=0; press<16; press++) {
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#hand button.selected').count(), 1);
    assert.equal(await page.locator('#hand button.selected.red-kong-tile').count(), 0, 'keyboard selected a red');
  }
  for (let press=0; press<16; press++) {
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#hand button.selected.red-kong-tile').count(), 0, 'reverse keyboard navigation selected a red');
  }
  await page.locator('#hint-btn').click();
  assert.equal(await page.locator('#hand button.selected,#hand button.hinted').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'action-gang');
  assert.deepEqual(await redSnapshot(), beforeRedClick, 'red hint altered play state');
  assert.equal(await page.locator('#action-gang').isEnabled(), true);
  for (const count of [1,2]) {
    await page.locator('#action-gang').click();
    assert.equal(await page.locator('#choice-dialog').evaluate(dialog => dialog.open), false, 'single red kong should execute directly');
    const redState = await page.evaluate(() => {
      const g = window.mahjongGame, player = g.players[0];
      return {phase:g.phase.kind,current:g.current,hand:player.hand.length,reds:player.hand.filter(tile => tile === 31).length,redGangs:player.redGangs,melds:player.melds.length,wall:g.wall.length};
    });
    assert.deepEqual(redState, {phase:'discard',current:0,hand:redStart.hand,reds:2-count,redGangs:Array(count).fill(31),melds:0,wall:redStart.wall-count});
    assert.equal(await page.locator('#red-gangs-0').innerText(), `中×${count}`);
    await geometry(page, `${count} declared red kong badges`);
  }
  assert.equal(await page.locator('#action-gang').isEnabled(), false);
  await page.locator('#river-0').click();
  assert.equal(await page.locator('#history-red-record').isVisible(), true);
  assert.equal(await page.locator('#history-red-tiles .tile').count(), 2);
  assert.equal(await page.locator('#history-tiles .tile').count(), 0);
  await page.locator('#history-dialog .primary-button').click();
  report.interactions.push('red click/Enter cannot discard; keyboard skips red; hint focuses kong; repeated single red replacement draws, badge geometry and separate history record');

  await fixture(page, 'red-gang-four');
  assert.equal(await page.evaluate(() => window.mahjongGame.getActions(0).concealedGangs.includes(31)), false);
  await page.locator('#action-gang').click();
  assert.equal(await page.locator('#choice-dialog').evaluate(dialog => dialog.open), false, 'four reds must not offer an ordinary four-tile kong');
  assert.deepEqual(await page.evaluate(() => {
    const g=window.mahjongGame,p=g.players[0];
    return {hand:p.hand.length,reds:p.hand.filter(tile=>tile===31).length,redGangs:p.redGangs,melds:p.melds.length,wall:g.wall.length};
  }), {hand:14,reds:3,redGangs:[31],melds:0,wall:4});
  report.interactions.push('four held reds offer only single special kong and replace exactly one tile');

  await fixture(page, 'red-gang-choice');
  await page.locator('#action-gang').click();
  assert.equal(await page.locator('#choice-options button').count(), 2);
  const redOption = page.locator('#choice-options button').filter({hasText:'红中杠'});
  assert.equal(await redOption.locator('.tile').count(), 1);
  assert.equal(await page.locator('#choice-options button').filter({hasText:'暗杠'}).locator('.tile').count(), 4);
  await redOption.click();
  assert.equal(await page.evaluate(() => window.mahjongGame.players[0].redGangs.length), 1);
  assert.equal(await page.evaluate(() => window.mahjongGame.players[0].melds.length), 0);
  await page.locator('#action-gang').click();
  assert.equal(await page.evaluate(() => window.mahjongGame.players[0].melds[0].kind), 'gang');
  assert.equal(await page.evaluate(() => window.mahjongGame.players[0].redGangs.length), 1);
  await geometry(page, 'red kong and ordinary concealed kong coexist');
  report.interactions.push('red kong and normal concealed kong choices coexist');

  await fixture(page, 'red-gang-empty');
  assert.equal(await page.locator('#action-gang').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.mahjongGame.getActions(0).redGang), false);
  const emptyBefore = await redSnapshot();
  await page.locator('#hand button.red-kong-tile').first().click({force:true});
  assert.deepEqual(await redSnapshot(), emptyBefore, 'empty wall cannot make red discardable');
  await page.locator('#hint-btn').click();
  assert.equal(await page.locator('#hand button.hinted').count(), 1);
  assert.equal(await page.locator('#hand button.hinted.red-kong-tile').count(), 0, 'empty-wall hint selected red');
  const emptyHintTile = await page.locator('#hand button.hinted').evaluate(button => window.mahjongGame.players[0].hand[Number(button.dataset.index)]);
  await page.locator('#hand button.hinted').click();
  assert.equal(await page.evaluate(() => window.mahjongGame.players[0].discards.at(-1)), emptyHintTile);
  assert.notEqual(emptyHintTile, 31);
  assert.equal(await page.evaluate(() => window.mahjongGame.players[0].hand.filter(tile=>tile===31).length), 2);
  report.interactions.push('empty replacement wall disables red kong and keeps red non-discardable; normal hinted discard remains legal');

  for (const kind of ['peng','gang','concealed-gang','added-gang','pass']) {
    await fixture(page, kind);
    await page.locator(`#action-${kind === 'concealed-gang' || kind === 'added-gang' ? 'gang' : kind}`).click();
    if (kind === 'concealed-gang') {
      assert.equal(await page.locator('#choice-options button').count(), 2);
      await page.locator('#choice-options button').first().click();
    }
    const game = await page.evaluate(() => ({phase:window.mahjongGame.phase.kind,current:window.mahjongGame.current,melds:window.mahjongGame.players[0].melds,hand:window.mahjongGame.players[0].hand}));
    assert.equal(game.phase, 'discard');
    assert.equal(game.current, 0);
    assert.equal(game.hand.length, kind === 'pass' ? 14 : 11);
    if (kind !== 'pass') assert.equal(game.melds[0].tiles.length, kind === 'peng' ? 3 : 4);
    await geometry(page, `${kind} layout`);
    report.interactions.push(`${kind} button execution`);
  }

  for (const meldCount of [2,3,4]) {
    await page.evaluate(meldCount => {
      const g = window.mahjongGame;
      g.players[0].melds = Array.from({length:meldCount},(_,index) => ({kind:'gang',tiles:Array(4).fill(index),from:0,concealed:true}));
      g.players[0].hand = [9,10,11,18,19,20,27,28].slice(0,14-meldCount*3);
      g.phase = { kind: 'discard', seat: 0 };g.current=0;g.pendingDiscard=null;g._responses=[null,null,null,null];
      g.lastDraw={player:0,tile:g.players[0].hand.at(-1),index:g.players[0].hand.length-1};
      window.renderMahjong();
    },meldCount);
    await page.locator('#hand button').first().click();
    await geometry(page, `${meldCount} exposed gangs, selected hand, labels`);
  }
  report.interactions.push('two, three, four exposed gang layouts');

  await page.evaluate(() => {
    const g = window.mahjongGame;
    g.players.slice(1).forEach((player, index) => {
      player.hand = [27];
      player.melds = Array.from({length:4}, (_,meld) => ({kind:'gang',tiles:Array(4).fill(index*9+meld),from:0,concealed:false}));
      player.discards = Array.from({length:12}, (_,tile) => tile);
    });
    g.players[0].discards = Array.from({length:12}, (_,tile) => tile+12);
    window.renderMahjong();
  });
  await geometry(page, 'all three opponents with four exposed gangs');
  const botMeldLayout = await page.locator('.table .tile').evaluateAll(tiles => tiles.map(tile => {
    const r = tile.getBoundingClientRect();
    return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};
  }));
  for (let i=0;i<botMeldLayout.length;i++) for (let j=i+1;j<botMeldLayout.length;j++) {
    const a=botMeldLayout[i],b=botMeldLayout[j];
    assert.ok(a.right<=b.x+.5 || b.right<=a.x+.5 || a.bottom<=b.y+.5 || b.bottom<=a.y+.5, 'maximum opponent melds overlap table tiles');
  }
  report.interactions.push('four exposed gangs for all three opponents with full discard rivers');

  await fixture(page, 'hu');
  await page.locator('#action-hu').click();
  await page.waitForFunction(() => document.querySelector('#result-dialog').open);
  assert.match(await page.locator('#result-detail').innerText(), /自摸/);
  assert.equal(await page.locator('#result-hand .tile').count(), 14);
  assert.equal(await page.locator('#score').innerText(), '1,060');
  const huRound = await page.evaluate(() => window.mahjongGame.round);
  const huDealer = await page.evaluate(() => window.mahjongGame.dealer);
  await page.locator('#next-round').click();
  assert.equal(await page.evaluate(() => window.mahjongGame.round), huRound + 1);
  const nextDealer = (huDealer + 1) % 4;
  assert.equal(await page.evaluate(() => window.mahjongGame.dealer), nextDealer);
  assert.equal(await page.locator('.dealer-badge:not([hidden])').getAttribute('id'), `dealer-${nextDealer}`);
  assert.equal(await page.locator('#score').innerText(), '1,060');
  assert.equal(await page.evaluate(() => window.mahjongGame.players[0].hand.length), 13);
  await page.waitForFunction(dealer => window.mahjongGame.players[dealer].discards.length > 0, nextDealer, {timeout:5000});
  report.interactions.push('self-draw settlement, score update, next dealer badge and automatic bot opening discard');
  await page.locator('#restart-btn').click();
  await page.locator('#confirm-restart').click();
  assert.equal(await page.evaluate(() => window.mahjongGame.round), huRound + 1);
  assert.equal(await page.evaluate(() => window.mahjongGame.dealer), nextDealer);
  assert.equal(await page.locator('.dealer-badge:not([hidden])').getAttribute('id'), `dealer-${nextDealer}`);
  await page.waitForFunction(dealer => window.mahjongGame.players[dealer].discards.length > 0, nextDealer, {timeout:5000});
  report.interactions.push('restart preserves nonhuman dealer and resumes bot opening discard');

  await fixture(page, 'discard-hu');
  await page.locator('#action-hu').click();
  await page.waitForFunction(() => document.querySelector('#result-dialog').open);
  assert.match(await page.locator('#result-detail').innerText(), /点炮/);
  assert.equal(await page.locator('#score').innerText(), '1,030');
  report.interactions.push('discard-win settlement');
  await context.close();

  const preview = await openPage({width:540,height:960}, 2);
  const previewState = await preview.page.evaluate(async () => {
    const { chooseDiscard } = await import('/engine.js');
    const g = window.mahjongGame;
    let discards = 0;
    for (let seed = 0; seed < 10; seed++) {
      g.newRound(`portrait-preview-${seed}`, { restart:true }); discards = 0;
      for (let step = 0; step < 180 && discards < 9 && g.phase.kind !== 'ended'; step++) {
        if (g.phase.kind === 'discard' && g.current === 0) {
          g.discard(0, chooseDiscard(g.players[0].hand, g.players[0].melds)); discards++;
        } else if (g.getActions(0).pass) g.pass(0);
        else if (!g.advanceAI()) break;
      }
      for (let step = 0; step < 100 && g.phase.kind !== 'ended' && !(g.phase.kind === 'discard' && g.current === 0); step++) {
        if (g.getActions(0).pass) g.pass(0); else if (!g.advanceAI()) break;
      }
      if (discards >= 8 && g.phase.kind !== 'ended') break;
    }
    window.renderMahjong();
    return {discards,phase:g.phase.kind,current:g.current};
  });
  assert.ok(previewState.discards >= 8 && previewState.phase === 'discard' && previewState.current === 0);
  const tableLayout = await preview.page.evaluate(() => {
    const tiles=[...document.querySelectorAll('.table .tile')].map(el => {
      const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};
    });
    return {tiles, modalOpen:!!document.querySelector('dialog[open]'), discards:window.mahjongGame.players.reduce((sum,p) => sum+p.discards.length,0)};
  });
  assert.equal(tableLayout.modalOpen,false);
  assert.ok(tableLayout.discards>=12);
  for(let i=0;i<tableLayout.tiles.length;i++) for(let j=i+1;j<tableLayout.tiles.length;j++) {
    const a=tableLayout.tiles[i],b=tableLayout.tiles[j];
    assert.ok(a.right<=b.x+.5 || b.right<=a.x+.5 || a.bottom<=b.y+.5 || b.bottom<=a.y+.5, 'preview central table tiles overlap');
  }
  await geometry(preview.page, '1080x1920 midgame preview');
  await preview.page.locator('#game').screenshot({path:path.join(output,'game-preview-1080x1920.png')});
  copyFileSync(path.join(output,'game-preview-1080x1920.png'),path.join(output,'game-four-sides-preview-1080x1920.png'));
  await preview.context.close();
  const sharp = createRequire('C:/Users/gk200/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('sharp');
  await sharp(path.join(output,'game-preview-1080x1920.png')).resize(540,960).toFile(path.join(output,'game-preview.png'));
  copyFileSync(path.join(output,'game-preview.png'),path.join(output,'game-four-sides-preview.png'));
  const image = await sharp(path.join(output,'game-preview-1080x1920.png')).metadata();
  assert.equal(image.width,1080); assert.equal(image.height,1920);
  assert.deepEqual(report.errors,[], 'console/network errors');
  report.preview = { ...previewState, width:image.width,height:image.height };
} catch (error) {
  failures.push(error.stack);
} finally {
  await browser.close();
  report.failures = failures;
  writeFileSync(path.join(output,'ui-test-report.json'), JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report,null,2));
if (failures.length) process.exitCode = 1;
