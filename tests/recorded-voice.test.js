import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordedVoice,voiceWindow} from '../src/ui/recorded-voice.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({blocked=false,failDecode=false,holdPreviewDecode=false}={}) {
  const sources=[],errors=[];let context,enabled=true,decoded=0,releasePreview;
  class Context {
    constructor(){context=this;this.state=blocked?'suspended':'running';this.sampleRate=24000;}
    createBuffer(){return {silent:true};}
    createBufferSource(){const source={connect(){},disconnect(){},start(){if(!source.buffer.silent)sources.push(source);},stop(){source.onended?.();}};return source;}
    decodeAudioData(bytes){decoded++;const key=new TextDecoder().decode(bytes);if(holdPreviewDecode&&key==='1m')return new Promise(resolve=>{releasePreview=()=>resolve({key});});return failDecode?Promise.reject(Error('bad clip')):Promise.resolve({key});}
    resume(){if(!blocked)this.state='running';return Promise.resolve();}
  }
  const bank=Object.fromEntries(['1m','5z','7z','chi','peng','gang','hu','zimo'].map(key=>[key,Buffer.from(key).toString('base64')]));
  const voice=createRecordedVoice({isEnabled:()=>enabled,Context,bank,onError:message=>errors.push(message)});
  return {voice,sources,errors,get context(){return context;},get decoded(){return decoded;},setEnabled:value=>{enabled=value;},unblock:()=>{blocked=false;},releasePreview:()=>releasePreview()};
}
test('recorded clips queue in order, reuse decoding, and keep red/white honor mapping correct',async()=>{
  const h=harness();for(const name of ['一万','红中','白板','吃','碰','杠','胡','自摸','一万'])h.voice.say(name);
  await tick();const decoded=h.decoded;
  for(let i=0;i<9;i++){assert.equal(h.sources.length,i+1);h.sources[i].onended();await tick();}
  assert.deepEqual(h.sources.map(source=>source.buffer.key),['1m','5z','7z','chi','peng','gang','hu','zimo','1m']);
  assert.equal(h.decoded,decoded);assert.equal(h.voice.getState().queued,0);assert.equal(h.voice.getState().playing,false);
});
test('autoplay suspension retains the queued name until the next successful gesture unlock',async()=>{
  const h=harness({blocked:true});h.voice.say('一万');await tick();
  assert.equal(h.sources.length,0);assert.equal(h.voice.getState().queued,1);
  h.unblock();h.voice.unlock();await tick();
  assert.equal(h.sources.length,1);assert.equal(h.voice.getState().queued,0);
});
test('mute stops the current audio and drops old queued names without replaying them',async()=>{
  const h=harness();h.voice.say('一万');h.voice.say('红中');await tick();
  h.setEnabled(false);h.voice.stop();h.voice.say('白板');await tick();
  assert.equal(h.voice.getState().queued,0);h.setEnabled(true);h.voice.say('胡');await tick();
  assert.deepEqual(h.sources.map(source=>source.buffer.key),['1m','hu']);
});
test('unavailable playback and decoding failures stay outside game actions and report an actionable error',async()=>{
  const errors=[];const unavailable=createRecordedVoice({isEnabled:()=>true,Context:null,onError:message=>errors.push(message)});
  assert.doesNotThrow(()=>unavailable.say('一万'));assert.equal(errors.length,1);
  const h=harness({failDecode:true});h.voice.say('一万');await new Promise(resolve=>setTimeout(resolve,350));
  assert.ok(h.errors.length>0);assert.equal(h.sources.length,0);assert.equal(h.voice.getState().queued,1);
  h.voice.stop();
});
test('confirmed discards interrupt previews immediately and never wait for obsolete selections',async()=>{
  const h=harness();h.voice.unlock();await tick();
  h.voice.say('一万',{preview:true});await tick();const preview=h.sources[0];
  let stopped=false;preview.stop=()=>{stopped=true;preview.onended();};
  h.voice.say('红中');
  assert.equal(stopped,true);assert.equal(h.sources.length,2,'预解码的确认报牌同步启动，不等待预听结束');
  assert.equal(h.voice.getState().queued,0);assert.equal(h.sources[1].buffer.key,'5z');
  assert.equal(h.voice.say('白板',{preview:true}),false,'正式报牌期间不能再插入选牌预听');
});
test('confirming the same preview keeps its playing voice instead of speaking it twice',async()=>{
  const h=harness();h.voice.unlock();await tick();
  h.voice.say('一万',{preview:true});h.voice.say('一万');
  assert.equal(h.sources.length,1);assert.deepEqual(h.voice.getState().played,['一万']);
  h.voice.say('红中',{preview:true});assert.equal(h.sources.length,1);
});
test('leading/trailing silence is trimmed with consonant safety margins and no speed change',()=>{
  const samples=new Float32Array(1000);samples.fill(.1,300,700);
  const clip=voiceWindow({sampleRate:1000,length:1000,duration:1,numberOfChannels:1,getChannelData:()=>samples});
  assert.ok(Math.abs(clip.offset-.292)<1e-6);assert.ok(Math.abs(clip.duration-.428)<1e-6);
});
test('a slow obsolete preview decoder cannot hold up an already decoded confirmed discard',async()=>{
  const h=harness({holdPreviewDecode:true});h.voice.unlock();await tick();
  h.voice.say('一万',{preview:true});h.voice.say('红中');
  assert.equal(h.sources.length,1);assert.equal(h.sources[0].buffer.key,'5z');
  h.releasePreview();await tick();assert.equal(h.sources.length,1,'迟到的预听解码结果不能重播或覆盖正式声音');
});
