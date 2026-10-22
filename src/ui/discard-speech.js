// 只消费公开出牌日志，不读取他人暗牌，也不改变对局状态。
const SPEECH_NAMES = Object.freeze({ 中:'红中', 发:'发财', 白:'白板' });

export function createDiscardSpeech({isEnabled, voicePlayer}) {
  let previous = null;
  let noticeId = 0;
  const stop = () => {
    voicePlayer?.stop();
  };
  const resume = () => {
    if (isEnabled()) voicePlayer?.unlock();
  };
  const speak = name => {
    if (isEnabled() && name) voicePlayer?.say(SPEECH_NAMES[name] || name);
  };
  return {
    resume, stop, say:speak,
    update(events, {reset = false, notice = null} = {}) {
      const before = previous;
      previous = [...events];
      if (reset || before === null) { noticeId=notice?.id||0; stop(); return; }
      // 引擎日志最多 80 条，满后会移除头部。按前后快照的重叠段找新增日志，不能按长度计数。
      let overlap = Math.min(before.length, events.length);
      while (overlap > 0 && !before.slice(-overlap).every((entry, index) => entry === events[index])) overlap--;
      // 断线太久或历史整体替换时只重设基线，避免重播整段过期出牌。
      const announced=new Set();
      for (const event of !overlap && before.length ? [] : events.slice(overlap)) {
        const discarded = /打出(.+?)。$/.exec(event);
        if (discarded) { speak(discarded[1]); continue; }
        if (/自摸胡牌！/.test(event)) { speak('自摸'); announced.add('hu'); }
        else if (/胡牌！/.test(event)) { speak('胡'); announced.add('hu'); }
        else if (/(?:红中|[皮痞]子|癞子)杠.*，补摸一张牌。$/.test(event) || /(?:明杠|暗杠|补杠).+。$/.test(event)) { speak('杠'); announced.add('gang'); }
        else {
          const claim=/(吃|碰)([一二三四五六七八九][万筒条]|[东南西北中发白])。$/.exec(event);
          if(claim){speak(claim[1]);announced.add(claim[1]==='吃'?'chi':'peng');}
        }
      }
      // 只兜底服务端已生效的公共动作；重复快照、过期提示与刷新均不能重复播报。
      if(notice?.id>noticeId){
        if(!announced.has(notice.kind))speak({chi:'吃',peng:'碰',gang:'杠',hu:'胡'}[notice.kind]);
        noticeId=notice.id;
      }
    },
  };
}
