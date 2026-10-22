import { VOICE_BANK } from './voice-bank.js';

const numbers='一二三四五六七八九';
const keys=new Map();
for(const [suit,suffix] of [['万','m'],['筒','p'],['条','s']])for(let i=0;i<9;i++)keys.set(numbers[i]+suit,`${i+1}${suffix}`);
// 上游资源的字牌顺序为东南西北中发白，5z=红中、7z=白板。
for(const [name,key] of Object.entries({东:'1z',南:'2z',西:'3z',北:'4z',中:'5z',红中:'5z',发:'6z',发财:'6z',白:'7z',白板:'7z',吃:'chi',碰:'peng',杠:'gang',胡:'hu',自摸:'zimo'}))keys.set(name,key);

// 只去掉首尾接近静音的样本，保留 8ms/20ms 余量，不变速、不切掉字音。
export function voiceWindow(buffer) {
  if(!buffer.getChannelData)return {offset:0,duration:buffer.duration};
  const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
  const audible=index=>channels.some(channel=>Math.abs(channel[index])>.002);
  let first=0,last=buffer.length-1;
  while(first<last&&!audible(first))first++;
  while(last>first&&!audible(last))last--;
  if(first>=last)return {offset:0,duration:buffer.duration};
  const offset=Math.max(0,first/buffer.sampleRate-.008);
  return {offset,duration:Math.min(buffer.duration,(last+1)/buffer.sampleRate+.02)-offset};
}

// 内置配音只解码一次；正式动作优先于选牌预听，音频失败不能阻塞出牌。
export function createRecordedVoice({isEnabled,Context=globalThis.AudioContext||globalThis.webkitAudioContext,bank=VOICE_BANK,onError=()=>{}}) {
  let context=null,active=null,activeItem=null,pumping=null,generation=0,error='',failures=0;
  const queue=[],buffers=new Map(),ready=new Map(),played=[],timings=[];
  const state=()=>({state:context?.state||'idle',queued:queue.length,playing:!!active,error,played:[...played],timings:[...timings]});
  const decode=key=>{
    if(!buffers.has(key)){
      const bytes=Uint8Array.from(atob(bank[key]),character=>character.charCodeAt(0));
      const promise=context.decodeAudioData(bytes.buffer).then(buffer=>{
        const clip={buffer,...voiceWindow(buffer)};ready.set(key,clip);return clip;
      }).catch(cause=>{buffers.delete(key);throw cause;});
      buffers.set(key,promise);
    }
    return buffers.get(key);
  };
  const pump=async()=>{
    if(pumping===generation||active||!queue.length||!isEnabled()||context?.state!=='running')return;
    pumping=generation;
    const ticket=generation,item=queue[0];
    try {
      // 已预解码的音频直接 start，不必等渲染任务结束后的 Promise 回调。
      const clip=ready.get(item.key)||await decode(item.key);
      if(ticket!==generation||!isEnabled()||context.state!=='running')return;
      const source=context.createBufferSource();source.buffer=clip.buffer;source.connect(context.destination);
      const finish=()=>{source.disconnect();if(active===source){active=null;activeItem=null;void pump();}};
      source.onended=finish;
      // 成功 start 后才移除队首，暂停、解码失败和解锁失败不会悄悄吞掉这次播报。
      source.start(0,clip.offset,clip.duration);queue.shift();active=source;activeItem=item;error='';failures=0;
      played.push(item.name);if(played.length>160)played.shift();
      timings.push({name:item.name,preview:item.preview,startedAt:performance.now(),waitMs:performance.now()-item.at,offset:clip.offset,duration:clip.duration});if(timings.length>160)timings.shift();
    } catch(cause) {
      error=cause?.message||'配音播放失败';
      if(++failures<=2)setTimeout(()=>void pump(),100);
      else onError('配音暂时不可用，请点击音效按钮重新开启');
    } finally {if(pumping===ticket)pumping=null;if(ticket!==generation&&queue.length)void pump();}
  };
  const unlock=()=>{
    if(!isEnabled())return;
    try {
      if(!context){
        if(!Context)throw Error('浏览器不支持音频播放');
        context=new Context({latencyHint:'interactive'});
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
    say(name,{preview=false}={}){
      const key=keys.get(name);
      if(!isEnabled()||!key||!bank[key])return false;
      if(!preview&&activeItem?.preview&&activeItem.key===key){
        // 双击确认的是同一张牌时，沿用已经响起的牌名，不从头再读一遍。
        activeItem.preview=false;
        for(let index=queue.length-1;index>=0;index--)if(queue[index].preview)queue.splice(index,1);
        return true;
      }
      // 选牌预听只保留最新一张；任何正式动作都不能排在过期预听之后。
      const previews=queue.some(item=>item.preview)||activeItem?.preview;
      if(previews){
        generation++;
        for(let index=queue.length-1;index>=0;index--)if(queue[index].preview)queue.splice(index,1);
        if(activeItem?.preview){
          const source=active;active=activeItem=null;
          try{source.stop();source.disconnect();}catch{/* 已结束的预听不再等待。 */}
        }
      }
      // 正式配音期间的预听不插队，避免选牌声音挡住当前出牌。
      if(preview&&(activeItem&&!activeItem.preview||queue.some(item=>!item.preview)))return false;
      queue.push({key,name,preview,at:performance.now()});unlock();return true;
    },
    stop(){
      generation++;queue.length=0;failures=0;
      const source=active;active=activeItem=null;
      if(source){try{source.stop();source.disconnect();}catch{/* 已结束的声音无需重复停止。 */}}
    },
  };
}
