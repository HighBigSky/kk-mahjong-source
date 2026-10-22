# 固定配音素材

来源：https://github.com/BestGuo2020/lianhuaguangdongmahjong
固定版本：`a8cf5440e4258a1a1b60b785ac19a81fed7e30ae`，目录 `public/audio/`。仅使用 34 种牌名和吃、碰、杠、胡、自摸共 39 段短音频，不使用背景音乐或头像。音频是否为真人录制没有独立证明，不标注为真人录制。

保留原 MP3，不变速、不变调。运行时从本服务器的 JS 音频包解码，不请求外部 TTS，也不要求用户安装中文语音。使用 JS 包是为了沿用现有静态模块路由，无须重启服务或清空牌局。重新获取固定版本：`node scripts/build-voice-bank.mjs`。

## 原许可

```text
MIT License

Copyright (c) 2026 BestGuo2020（我叫人员外婆）

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```

## SHA-256

```json
{
  "1m.mp3": "50cf664be1492ce58b530b1f5e0db342743510469655d02cee19d81b0f5df38d",
  "2m.mp3": "afb7f672628e2dfc23717f10d1aee0e58f0a62481568d044708a354a6fca19a2",
  "3m.mp3": "130893b1378757158ff03114f1d5c24a6cafe74689015922ff0104f797f06fb6",
  "4m.mp3": "ca129018695f04a0f4a36c13e6f0f8c486892ffaa678142700a1f90791aa52f9",
  "5m.mp3": "0736ed92e22b7a91c57cc7029c255e0df62ecbdbe8b50782d9fddfb1bf4cc274",
  "6m.mp3": "02e30f28f5803dd07140a379feba80371a8235fb443ce73e97545e83dc9b1aff",
  "7m.mp3": "95796dd32aee5ff10e5724dd38c4cfb78ad8c8b363d6a74ff59f660ee3bbb001",
  "8m.mp3": "54f0781d4766edd638e9b0e07e706019ddefcab0ee65032e5fdb5de836d9bb45",
  "9m.mp3": "69a0559578b7f96d61d01c24df28610511640e79dd7f543440622e0ed0059f28",
  "1p.mp3": "d10cbb6b98a91ba5e8e6f420097edb086b39024c641572926f7e7185932526a6",
  "2p.mp3": "2e7f4413776ef983657c19a4afaf5612cd5b9d27461c1202f49b86850df99da0",
  "3p.mp3": "2b00aa709080865fe458e7100d3d170435e91ddd759f5e3e080ce84f530ea08e",
  "4p.mp3": "9eb918f7fdd41d11ace27b53d7c80e53894bf5a7b04ed2f3579acc39c40730d3",
  "5p.mp3": "7201da88b581bed899da7462c6bb716997ef15797769906bbce9b864221cfd07",
  "6p.mp3": "94f982cd58550886706aaf0238ee266969024aa20c9ad34c4851b1aecfa8d0c8",
  "7p.mp3": "cc3ac96ab0795acc981fe60639f6957c8f22de12e62a66e3eb6d5c7a7baf58fc",
  "8p.mp3": "ac8c432c833e95b3239a8d946d44db52e4e220788788b6948de244e75871632d",
  "9p.mp3": "bdf2226b7cdd75566533c14fbe3281c3b47d94627d0dc4a0ab7b0a4a9d47bf55",
  "1s.mp3": "e6a110a4c8efecbd7346f95ad15bd231f06e0220887d4508fc63d1fa441f2f18",
  "2s.mp3": "563b26c97032f41322e4cdbb0e763a0c1f7acb9576aac07157b6f215a85c01e3",
  "3s.mp3": "0c3045264f7976744d5efb6d43d1aaf88c404a0433d4e5756a156fb1b78918a1",
  "4s.mp3": "3eaf46a327d770722ff23a622bac203d0303a8da077a9ff407afd4f4d50504d5",
  "5s.mp3": "20314385037c6f4b34bb232ea800c021a69f85f43746a0758760c0eb92e7be15",
  "6s.mp3": "e08c20a8a8164bb3baa28429eb9933776e2453a651ff86bf5d594cd55508bc5e",
  "7s.mp3": "a8b7568c6fec6978e4434411b0e6e461c22e1e5fb1173e7d062eb14eb87ac225",
  "8s.mp3": "1f3d093bbfc0d85c0048dddce76b78c2d01821dff6e100227364356080b16b72",
  "9s.mp3": "9571a706a6f57403ca7f99dfe0c8c251be1497932e78f1c0c8801b3b43156e51",
  "1z.mp3": "5cee8abf1c0b03cd1ecdc26b31a5def958dd3342066228cdd44c0e2d33f75e0e",
  "2z.mp3": "be7be1fb7207fbc331d428141df60dff4a569c084ff743f16b4b82387733af20",
  "3z.mp3": "13671a1ab7309ab73b18d2e8251cced19bd4e70f263d9c17e092077ff402a8af",
  "4z.mp3": "59a440a83a0683ff79c0970d11c2163312bbcf713aefe598f248597c0491afed",
  "5z.mp3": "d4f264386c4a5ba695e97b90318f43e1d1ad4cca9750a68128397fdf8ce83348",
  "6z.mp3": "3c9269cb016dbcd1e1b281daf9e7d531af0b48475b0ee3b4bbccdf00197d296f",
  "7z.mp3": "d2ce2dad0e09a1228c3f6e90cc5e355e580d3410432940be9af47869462ea6b0",
  "chi.mp3": "522a994380b67bb429db4c7ccb3cfec70a355f2819ac2d56f0dd7f2f06448f0f",
  "peng.mp3": "ac689e2c8391578dd48e6d675f31dbd90c1142705cb234cbc2fe997ff3f0dce2",
  "gang.mp3": "d7bcc51c4faa0bbca97cb50b3fcdfd49a982811054e451cb7a75fad4f4c6f430",
  "hu.mp3": "cddac70a225814c4f8819132b7ceed223e813ffef50a1e449db636969f2346ae",
  "zimo.mp3": "92637eca8757d30632730ee8fce038a90ee6bed0994e371332e784e2e2b1526f"
}
```
