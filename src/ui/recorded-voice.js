import { VOICE_BANK } from './voice-bank.js';

const numbers='一二三四五六七八九';
const keys=new Map();
for(const [suit,suffix] of [['万','m'],['筒','p'],['条','s']])for(let i=0;i<9;i++)keys.set(numbers[i]+suit,`${i+1}${suffix}`);
// 上游资源的字牌顺序为东南西北中发白，5z=红中、7z=白板。
for(const [name,key] of Object.entries({东:'1z',南:'2z',西:'3z',北:'4z',中:'5z',红中:'5z',发:'6z',发财:'6z',白:'7z',白板:'7z',吃:'chi',碰:'peng',杠:'gang',胡:'hu',自摸:'zimo'}))keys.set(name,key);

// 内置配音只解码一次；串行播放与游戏请求分开，任何音频失败都不能阻塞出牌。
export function createRecordedVoice({isEnabled,Context=globalThis.AudioContext||globalThis.webkitAudioContext,bank=VOICE_BANK,onError=()=>{}}) {
  let context=null,active=null,pumping=false,generation=0,error='',failures=0;
  const queue=[],buffers=new Map(),played=[];
  const state=()=>({state:context?.state||'idle',queued:queue.length,playing:!!active,error,played:[...played]});
  const decode=key=>{
    if(!buffers.has(key)){
      const bytes=Uint8Array.from(atob(bank[key]),character=>character.charCodeAt(0));
      const promise=context.decodeAudioData(bytes.buffer).catch(cause=>{buffers.delete(key);throw cause;});
      buffers.set(key,promise);
    }
    return buffers.get(key);
  };
  const pump=async()=>{
    if(pumping||active||!queue.length||!isEnabled()||context?.state!=='running')return;
    pumping=true;
    const ticket=generation,item=queue[0];
    try {
      const buffer=await decode(item.key);
      if(ticket!==generation||!isEnabled()||context.state!=='running')return;
      const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);
      const finish=()=>{source.disconnect();if(active===source){active=null;void pump();}};
      source.onended=finish;
      // 成功 start 后才移除队首，暂停、解码失败和解锁失败不会悄悄吞掉这次播报。
      source.start();queue.shift();active=source;error='';failures=0;
      played.push(item.name);if(played.length>160)played.shift();
    } catch(cause) {
      error=cause?.message||'配音播放失败';
      if(++failures<=2)setTimeout(()=>void pump(),100);
      else onError('配音暂时不可用，请点击音效按钮重新开启');
    } finally {pumping=false;if(ticket!==generation&&queue.length)void pump();}
  };
  const unlock=()=>{
    if(!isEnabled())return;
    try {
      if(!context){
        if(!Context)throw Error('浏览器不支持音频播放');
        context=new Context();
        context.onstatechange=()=>{if(context.state==='running')void pump();};
        // 首次用户手势中同步启动静音帧，兼容手机的音频解锁限制。
        const silent=context.createBufferSource();silent.buffer=context.createBuffer(1,1,context.sampleRate);
        silent.connect(context.destination);silent.onended=()=>silent.disconnect();silent.start();
        for(const key of Object.keys(bank))void decode(key).catch(()=>{});
      }
      failures=0;
      const resumed=context.resume();
      Promise.resolve(resumed).then(()=>void pump()).catch(cause=>{error=cause.message;onError('点击牌面即可启用报牌声音');});
      void pump();
    } catch(cause){error=cause.message;onError('当前浏览器无法播放配音，请更换浏览器后重试');}
  };
  return {
    unlock,getState:state,
    say(name){
      const key=keys.get(name);
      if(!isEnabled()||!key||!bank[key])return false;
      queue.push({key,name});unlock();return true;
    },
    stop(){
      generation++;queue.length=0;failures=0;
      const source=active;active=null;
      if(source){try{source.stop();source.disconnect();}catch{/* 已结束的声音无需重复停止。 */}}
    },
  };
}
