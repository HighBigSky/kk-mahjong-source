import test from 'node:test';
import assert from 'node:assert/strict';
import { MahjongGame } from '../engine.js';
import { createDiscardSpeech } from '../src/ui/discard-speech.js';

function harness() {
  const calls = [], voices = [];
  let enabled = true, cancels = 0, resumes = 0;
  const synthesis = {paused:false, getVoices:() => voices,
    speak:utterance => calls.push(utterance), cancel:() => cancels++,
    resume:() => { resumes++; synthesis.paused = false; }};
  class Utterance { constructor(text) { this.text = text; } }
  const speech = createDiscardSpeech({isEnabled:() => enabled, synthesis, Utterance});
  return {speech, calls, voices, synthesis, setEnabled:value => {enabled = value;},
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

test('paused speech resumes and delayed Chinese voices are selected without losing early discards', () => {
  const h = harness(), events = ['开局。']; h.speech.update(events);
  events.push('甲打出中。'); h.speech.update(events);
  assert.equal(h.calls[0].text, '红中'); assert.equal(h.calls[0].lang, 'zh-CN');
  const chinese = {lang:'zh-CN', localService:true};
  h.voices.push({lang:'en-US'}, chinese); h.synthesis.paused = true;
  events.push('乙打出白。', '丙打出发。'); h.speech.update(events);
  assert.equal(h.resumes, 1);
  assert.deepEqual(h.calls.map(call => call.text), ['红中', '白板', '发财']);
  assert.equal(h.calls[1].voice, chinese);
  for (const call of h.calls) call.onend();
  h.speech.stop(); assert.equal(h.cancels, 0, '已播放完成的对象已清理');
});

test('unsupported speech or a failed platform call cannot break room updates', () => {
  const speech = createDiscardSpeech({isEnabled:() => true, synthesis:null, Utterance:null});
  speech.update([]); speech.update(['甲打出一万。']); speech.resume(); speech.stop();
  const h = harness(); h.synthesis.speak = () => { throw Error('unavailable'); };
  h.speech.update([]); assert.doesNotThrow(() => h.speech.update(['甲打出一万。']));
  h.speech.stop(); assert.equal(h.cancels, 0);
});
