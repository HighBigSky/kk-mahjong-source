// Diagnostic transport only: delay action uplink and every API response chunk.
// Unlike CDP latency on an existing EventSource, this also covers SSE delivery.
import http from 'node:http';
import {once} from 'node:events';

export async function createDiagnosticTransport(upstreamPort) {
  let halfRTT=0;
  const server=http.createServer((request,response)=>{
    const timers=new Set();let upstream;
    const later=(operation,delay)=>{
      if(!delay){operation();return;}
      const timer=setTimeout(()=>{timers.delete(timer);if(!response.destroyed)operation();},delay);
      timers.add(timer);
    };
    const api=request.url.startsWith('/api/');
    const forward=()=>{
      upstream=http.request({hostname:'127.0.0.1',port:upstreamPort,path:request.url,method:request.method,headers:request.headers},incoming=>{
        response.writeHead(incoming.statusCode,incoming.headers);
        incoming.on('data',chunk=>later(()=>response.write(chunk),api?halfRTT:0));
        incoming.on('end',()=>later(()=>response.end(),api?halfRTT:0));
      });
      upstream.on('error',()=>{if(!response.destroyed)response.destroy();});
      request.pipe(upstream);
    };
    later(forward,request.method==='POST'&&request.url.endsWith('/action')?halfRTT:0);
    response.on('close',()=>{for(const timer of timers)clearTimeout(timer);upstream?.destroy();});
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return {url:`http://127.0.0.1:${server.address().port}`,setRTT:milliseconds=>{halfRTT=milliseconds/2;},close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
