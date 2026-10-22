// 只消费公开出牌日志，不读取他人暗牌，也不改变对局状态。
const SPEECH_NAMES = Object.freeze({ 中:'红中', 发:'发财', 白:'白板' });

export function createDiscardSpeech({isEnabled, synthesis = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance}) {
  let previous = null;
  const pending = new Set();
  const stop = () => {
    if (pending.size) {
      try { synthesis?.cancel(); } catch { /* 浏览器语音服务不可用时仍可继续对局。 */ }
      pending.clear();
    }
  };
  const resume = () => {
    if (!isEnabled() || !synthesis) return;
    try {
      synthesis.getVoices(); // 在用户交互时预取系统语音列表，列表尚未就绪时仍使用默认中文。
      if (synthesis.paused) synthesis.resume();
    } catch { /* 不支持语音合成的设备保留原提示音。 */ }
  };
  const speak = name => {
    if (!isEnabled() || !synthesis || !Utterance) return;
    let utterance;
    try {
      utterance = new Utterance(SPEECH_NAMES[name] || name);
      utterance.lang = 'zh-CN';
      utterance.rate = 1.15;
      utterance.pitch = 1;
      utterance.volume = 1;
      const voices = synthesis.getVoices();
      const chinese = voices.filter(voice => /^zh(?:[-_]|$)/i.test(voice.lang));
      const voice = chinese.find(voice => /^zh[-_]CN$/i.test(voice.lang) && voice.localService)
        || chinese.find(voice => /^zh[-_]CN$/i.test(voice.lang)) || chinese[0];
      if (voice) utterance.voice = voice;
      // 保留尚未播放完的对象；批量快照按原顺序排队，不能每次出牌都 cancel。
      pending.add(utterance);
      utterance.onend = utterance.onerror = () => pending.delete(utterance);
      if (synthesis.paused) synthesis.resume();
      synthesis.speak(utterance);
    } catch { pending.delete(utterance); }
  };
  return {
    resume, stop,
    update(events, {reset = false} = {}) {
      const before = previous;
      previous = [...events];
      if (reset || before === null) { stop(); return; }
      // 引擎日志最多 80 条，满后会移除头部。按前后快照的重叠段找新增日志，不能按长度计数。
      let overlap = Math.min(before.length, events.length);
      while (overlap > 0 && !before.slice(-overlap).every((entry, index) => entry === events[index])) overlap--;
      // 断线太久或历史整体替换时只重设基线，避免重播整段过期出牌。
      if (!overlap && before.length) return;
      for (const event of events.slice(overlap)) {
        const discarded = /打出(.+?)。$/.exec(event);
        if (discarded) speak(discarded[1]);
      }
    },
  };
}
