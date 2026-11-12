// Diagnostic-only browser instrumentation. Never loaded by the product page.
export function installDiscardProbe() {
  const now=()=>performance.now();
  const probe={samples:[],active:null,armed:null,longTasks:[],spans:[],reads:{rect:0,style:0},writes:{sameHandClass:0,handClass:0,sameTileProperty:0,tileProperty:0}};
  const mark=name=>performance.mark(`discard:${probe.active.id}:${name}`);
  probe.arm=metadata=>{probe.active=null;probe.armed=metadata;probe.longTasks=[];probe.spans=[];probe.reads={rect:0,style:0};probe.writes={sameHandClass:0,handClass:0,sameTileProperty:0,tileProperty:0};};
  probe.confirm=index=>{
    if(!probe.armed)return;
    const room=window.mahjongRoom.room,g=window.mahjongGame;
    probe.active={...probe.armed,C0:now(),version:room.version,index,handCount:g.players[0].hand.length,riverCount:g.players[0].discards.length};
    // Kept only in memory to correlate the requesting player's committed discard.
    probe.expected={code:room.code,tile:g.players[0].hand[index]};probe.armed=null;mark('C0');
  };
  probe.span=(name,operation)=>{
    if(!probe.active)return operation();
    const start=now();try{return operation();}finally{probe.spans.push({name,start,duration:now()-start});}
  };
  probe.authority=envelope=>{
    const s=probe.active,p=envelope?.state?.players?.[0];
    if(!s||s.C1==null||s.C2!=null||envelope?.room?.code!==probe.expected.code||envelope.room.version!==s.version+1||
      !p||p.hand.length!==s.handCount-1||p.discards.length!==s.riverCount+1||p.discards[s.riverCount]!==probe.expected.tile)return;
    s.C2=now();s.confirmedVersion=envelope.room.version;mark('C2');
  };
  probe.dom=()=>{
    const s=probe.active;
    if(!s||s.C2==null||s.C3!=null||window.mahjongRoom.room.version!==s.confirmedVersion||
      document.querySelector('#river-0').children.length!==s.riverCount+1)return;
    s.C3=now();mark('C3');
    requestAnimationFrame(()=>{s.rafAfterDOM=now();mark('raf');requestAnimationFrame(()=>{s.secondRAF=now();mark('secondRAF');});});
  };
  probe.busy=value=>{if(probe.active&&!value&&probe.active.C1!=null){probe.active.busyReleased=now();mark('busyReleased');}};
  probe.take=()=>{
    const s=probe.active;if(!s)return null;
    const result={...s,spans:probe.spans,longTasks:probe.longTasks.filter(t=>t.start>=s.C0),reads:{...probe.reads},writes:{...probe.writes}};
    probe.samples.push(result);probe.active=null;probe.expected=null;return result;
  };
  try{new PerformanceObserver(list=>{for(const entry of list.getEntries())probe.longTasks.push({start:entry.startTime,duration:entry.duration});}).observe({type:'longtask',buffered:true});}catch{}
  const originalRect=Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect=function(...args){if(probe.active)probe.reads.rect++;return originalRect.apply(this,args);};
  const originalStyle=window.getComputedStyle;
  window.getComputedStyle=function(...args){if(probe.active)probe.reads.style++;return originalStyle.apply(this,args);};
  const className=Object.getOwnPropertyDescriptor(Element.prototype,'className');
  if(className?.set)Object.defineProperty(Element.prototype,'className',{...className,set(value){
    if(probe.active&&this.parentElement?.id==='hand'){probe.writes.handClass++;if(className.get.call(this)===value)probe.writes.sameHandClass++;}
    return className.set.call(this,value);
  }});
  const setProperty=CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty=function(name,value,...args){
    if(probe.active&&name.startsWith('--tile-')){probe.writes.tileProperty++;if(this.getPropertyValue(name)===String(value))probe.writes.sameTileProperty++;}
    return setProperty.call(this,name,value,...args);
  };
  const originalFetch=window.fetch;
  window.fetch=function(resource,options){
    const s=probe.active,isAction=String(resource).endsWith('/action');
    if(s&&isAction){const body=JSON.parse(options.body);s.requestId=body.requestId;s.requestVersion=body.version;s.actionKind=body.action.kind;s.C1=now();mark('C1');}
    return originalFetch.call(this,resource,options).then(response=>{
      if(!s||!isAction)return response;
      s.httpStatus=response.status;
      const json=response.json.bind(response);
      response.json=async()=>{const value=await json();s.httpComplete=now();if(probe.active===s)mark('httpComplete');return value;};
      return response;
    });
  };
  window.__discardProbe=probe;
}

export function instrumentClientSource(path,source) {
  source=source.replaceAll('\r\n','\n');
  const wrap=(name,{async=false,after=''}={})=>{
    const prefix=async?'async ':'';
    const token=`${prefix}function ${name}(`;
    if(!source.includes(token))throw Error(`Missing diagnostic target: ${path} ${name}`);
    const raw=`__probe_${name}`;
    const wrapper=`${prefix}function ${name}(...args) { ${name==='confirmHand'?'window.__discardProbe.confirm(args[0]);':''} const result=window.__discardProbe.span('${name}',()=>${raw}(...args)); ${after} return result; }\n`;
    source=source.replace(token,wrapper+`${prefix}function ${raw}(`);
  };
  if(path==='/app.js'){
    for(const name of ['renderSelection','interactionChanged','roomChanged','updateRoom','renderTing','updateHandState','updateActionControls'])wrap(name);
    wrap('render',{after:'window.__discardProbe.dom();'});wrap('confirmHand',{async:true});
    source=source.replace("const layoutOpponentView = createFlatOpponentView($('#game'));","const __layoutOpponentView = createFlatOpponentView($('#game')); const layoutOpponentView=(...args)=>window.__discardProbe.span('layoutOpponentView',()=>__layoutOpponentView(...args));");
    source=source.replace('const calculateHints = createHintCalculator();',"const __calculateHints=createHintCalculator(); const calculateHints=(...args)=>window.__discardProbe.span('calculateHints',()=>__calculateHints(...args));");
  }else if(path==='/src/network/client.js'){
    source=source.replace('const receive = envelope => {','const __probeReceive = envelope => {');
    source=source.replace('async function request(path, body, authenticated = true) {',"const receive=envelope=>window.__discardProbe.span('receive',()=>{window.__discardProbe.authority(envelope);return __probeReceive(envelope);});\n  async function request(path, body, authenticated = true) {");
    source=source.replace('const setBusy = value => {','const __probeSetBusy = value => {');
    source=source.replace('const storage = kind =>',"const setBusy=value=>window.__discardProbe.span('setBusy',()=>{const result=__probeSetBusy(value);window.__discardProbe.busy(value);return result;});\n  const storage = kind =>");
  }else if(path==='/src/ui/flat-opponents.js'){
    wrap('projection');
  }else if(path==='/src/ui/tile-material.js'){
    for(const name of ['syncTileMetric','paintHandSeams','paintContactShadows']){
      // Keep exports on the wrapper, not the renamed body.
      source=source.replace(`export function ${name}(`,`function ${name}(`);wrap(name);
      if(name!=='paintHandSeams')source=source.replace(`function ${name}(`,`export function ${name}(`);
    }
    source=source.replace('new MutationObserver(records=>{',"new MutationObserver(records=>window.__discardProbe.span('materialMutation',()=>{")
      .replace('  });\n  mutations.observe','  }));\n  mutations.observe');
  }
  return source;
}
