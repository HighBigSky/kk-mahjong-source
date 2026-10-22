import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordedVoice} from '../src/ui/recorded-voice.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({blocked=false,failDecode=false}={}) {
  const sources=[],errors=[];let context,enabled=true,decoded=0;
  class Context {
    constructor(){context=this;this.state=blocked?'suspended':'running';this.sampleRate=24000;}
    createBuffer(){return {silent:true};}
    createBufferSource(){const source={connect(){},disconnect(){},start(){if(!source.buffer.silent)sources.push(source);},stop(){source.onended?.();}};return source;}
    decodeAudioData(bytes){decoded++;return failDecode?Promise.reject(Error('bad clip')):Promise.resolve({key:new TextDecoder().decode(bytes)});}
    resume(){if(!blocked)this.state='running';return Promise.resolve();}
  }
  const bank=Object.fromEntries(['1m','5z','7z','chi','peng','gang','hu','zimo'].map(key=>[key,Buffer.from(key).toString('base64')]));
  const voice=createRecordedVoice({isEnabled:()=>enabled,Context,bank,onError:message=>errors.push(message)});
  return {voice,sources,errors,get context(){return context;},get decoded(){return decoded;},setEnabled:value=>{enabled=value;},unblock:()=>{blocked=false;}};
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
