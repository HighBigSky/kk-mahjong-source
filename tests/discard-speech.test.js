import test from 'node:test';
import assert from 'node:assert/strict';
import { MahjongGame } from '../engine.js';
import { createDiscardSpeech } from '../src/ui/discard-speech.js';

function harness() {
  const calls = [];
  let enabled = true, cancels = 0, resumes = 0;
  let active = false;
  const voicePlayer = {say:text => {active=true;calls.push({text});},stop:()=>{if(active)cancels++;active=false;},unlock:()=>resumes++};
  const speech = createDiscardSpeech({isEnabled:() => enabled, voicePlayer});
  return {speech, calls, voicePlayer, setEnabled:value => {enabled = value;},
    get cancels() { return cancels; }, get resumes() { return resumes; }};
}

test('engine rolling 80-entry logs keep announcing every new discard, including batched updates', () => {
  const h = harness(), game = new MahjongGame({seed:123});
  game.events = Array.from({length:79}, (_, i) => `历史摸牌${i}。`);
  h.speech.update(game.events);
  const expected = [];
  for (let batch = 0; batch < 40; batch++) {
    for (let i = 0; i < 3; i++) {
      const name = `${batch * 3 + i + 1}万`;
      game._log(`玩家甲打出${name}。`); game._log(`玩家乙摸牌${batch}:${i}。`);
      expected.push(name);
    }
    h.speech.update(game.events);
    h.speech.update(game.events); // 重复 SSE 快照不能重复读。
  }
  assert.equal(game.events.length, 80);
  assert.deepEqual(h.calls.map(call => call.text), expected);
  assert.equal(h.cancels, 0, '正常排队不能被后一张牌打断');
});

test('initial history, replaced history and new rounds are baselines, not speech replays', () => {
  const h = harness();
  h.speech.update(['甲打出一万。']); assert.equal(h.calls.length, 0);
  h.speech.update(['甲打出一万。', '乙打出二万。']); assert.equal(h.calls.length, 1);
  h.speech.update(['新局开始。', '甲打出三万。'], {reset:true});
  assert.equal(h.calls.length, 1); assert.equal(h.cancels, 1);
  h.speech.update(['完全不同的断线历史。', '甲打出四万。']); assert.equal(h.calls.length, 1);
  h.speech.update(['完全不同的断线历史。', '甲打出四万。', '乙打出五万。']);
  assert.deepEqual(h.calls.map(call => call.text), ['二万', '五万']);
});

test('mute clears pending speech and consumes muted events without replaying on unmute', () => {
  const h = harness(), events = ['开局。']; h.speech.update(events);
  events.push('甲打出一万。'); h.speech.update(events);
  h.setEnabled(false); h.speech.stop(); assert.equal(h.cancels, 1);
  events.push('乙打出二万。'); h.speech.update(events);
  h.setEnabled(true); h.speech.resume(); h.speech.update(events);
  events.push('丙打出三万。'); h.speech.update(events);
  assert.deepEqual(h.calls.map(call => call.text), ['一万', '三万']);
});

test('effective chi peng kong and Hu use authoritative notices without duplicates or hidden draw names', () => {
  const h = harness(), events = ['开局。']; h.speech.update(events);
  events.push('甲打出中。','乙吃一万。','丙碰白。','丁红中杠，补摸一张牌。','甲摸牌。');
  h.speech.update(events,{notice:{id:1,kind:'gang'}});
  h.speech.update(events,{notice:{id:1,kind:'gang'}});
  assert.deepEqual(h.calls.map(call=>call.text),['红中','吃','碰','杠']);
  h.speech.update(events,{notice:{id:2,kind:'hu'}}); // 日志断档也能根据真实公共动作兜底。
  assert.equal(h.calls.at(-1).text,'胡');
  events.push('乙自摸胡牌！基础胡牌，获得30分。');h.speech.update(events,{notice:{id:3,kind:'hu'}});
  assert.equal(h.calls.at(-1).text,'自摸');assert.equal(h.calls.length,6);
  h.speech.say('白');h.speech.resume();assert.equal(h.calls.at(-1).text,'白板');assert.equal(h.resumes,1);
});

test('unsupported speech or a failed platform call cannot break room updates', () => {
  const speech = createDiscardSpeech({isEnabled:() => true, voicePlayer:null});
  speech.update([]); speech.update(['甲打出一万。']); speech.resume(); speech.stop();
});
