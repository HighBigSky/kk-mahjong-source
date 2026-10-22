// 仅在更新配音素材时运行；运行中的游戏不访问第三方服务，也不依赖生成工具。
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const revision='a8cf5440e4258a1a1b60b785ac19a81fed7e30ae';
const base=`https://raw.githubusercontent.com/BestGuo2020/lianhuaguangdongmahjong/${revision}`;
const files=[...['m','p','s'].flatMap(suit=>Array.from({length:9},(_,i)=>`${i+1}${suit}`)),...Array.from({length:7},(_,i)=>`${i+1}z`),'chi','peng','gang','hu','zimo'];
await mkdir('output/voice-source',{recursive:true});
const bank={},hashes={};
let cursor=0;
await Promise.all(Array.from({length:5},async()=>{
  while(cursor<files.length){
    const key=files[cursor++],path=`output/voice-source/${key}.mp3`;
    const response=await fetch(`${base}/public/audio/${key}.mp3`);if(!response.ok)throw Error(`${key}: ${response.status}`);
    const data=Buffer.from(await response.arrayBuffer());await writeFile(path,data);
    bank[key]=data.toString('base64');hashes[key]=createHash('sha256').update(data).digest('hex');
  }
}));
const ordered=Object.fromEntries(files.map(key=>[key,bank[key]]));
const response=await fetch(`${base}/LICENSE`);if(!response.ok)throw Error('license download failed');
const license=await response.text();
await writeFile('src/ui/voice-bank.js',`// 固定配音素材；哈希见 docs/voice-assets.md。由 scripts/build-voice-bank.mjs 生成。\n/* Source: ${base}/public/audio/\n${license}\n*/\nexport const VOICE_BANK = Object.freeze(${JSON.stringify(ordered,null,2)});\n`);
await writeFile('docs/voice-assets.md',`# 固定配音素材\n\n来源：https://github.com/BestGuo2020/lianhuaguangdongmahjong\n固定版本：\`${revision}\`，目录 \`public/audio/\`。仅使用 34 种牌名和吃、碰、杠、胡、自摸共 39 段短音频，不使用背景音乐或头像。音频是否为真人录制没有独立证明，不标注为真人录制。\n\n保留原 MP3，不变速、不变调。运行时从本服务器的 JS 音频包解码，不请求外部 TTS，也不要求用户安装中文语音。使用 JS 包是为了沿用现有静态模块路由，无须重启服务或清空牌局。重新获取固定版本：\`node scripts/build-voice-bank.mjs\`。\n\n## 原许可\n\n\`\`\`text\n${license}\n\`\`\`\n\n## SHA-256\n\n\`\`\`json\n${JSON.stringify(Object.fromEntries(files.map(key=>[`${key}.mp3`,hashes[key]])),null,2)}\n\`\`\`\n`);
console.log(JSON.stringify({files:files.length,bytes:Buffer.byteLength(JSON.stringify(ordered)),revision}));
