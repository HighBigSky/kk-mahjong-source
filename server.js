import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomService, RoomError } from './src/server/rooms.js';
import { createVoiceIceConfig } from './src/server/voice.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const mime = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp'};
const publicRootFiles = new Set(['index.html', 'app.js', 'engine.js', 'styles.css', 'table-depth.css', 'tiles-depth.css', 'seats-layout.css', 'laizi.css', 'rooms.css', 'wall-layout.css', 'landscape.css']);
const publicModule = /^\/src\/(?:domain|network|ui)\/[a-zA-Z0-9_-]+\.js$/;
const publicAsset = /^\/assets\/[a-zA-Z0-9_-]+\.(?:svg|png|webp)$/;

function json(response, status, body) {
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
  response.end(JSON.stringify(body));
}
function tokenOf(request) { return /^Bearer ([a-f0-9]{48})$/.exec(request.headers.authorization || '')?.[1]; }
function bodyOf(request, maxSize = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0, settled = false;
    const chunks = [];
    request.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > maxSize) {
        settled = true; chunks.length = 0;
        reject(new RoomError(413, 'TOO_LARGE', '请求内容过长。'));
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        // Decode only after joining buffers: a Chinese character can span TCP chunks.
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        resolve(body);
      } catch { reject(new RoomError(400, 'INVALID_JSON', '请求内容必须是 JSON 对象。')); }
    });
    request.on('aborted', () => { settled = true; chunks.length = 0; reject(new RoomError(400, 'REQUEST_ABORTED', '请求已中断。')); });
    request.on('error', reject);
  });
}

/** Start with npm start, or import this factory for isolated integration tests. */
export function createServer({ roomService = new RoomService({ iceServers:createVoiceIceConfig() }), publicOrigin = process.env.PUBLIC_ORIGIN || '' } = {}) {
  const limits = new Map();
  const configuredOrigin = publicOrigin ? new URL(publicOrigin).origin : '';
  function checkLimit(remote, pathname, method) {
    const stamp = Date.now();
    let limit = limits.get(remote);
    if (!limit || stamp - limit.start >= 60000) {
      if (limits.size >= 10000) for (const [key, entry] of limits) if (stamp - entry.start >= 60000) limits.delete(key);
      if (!limits.has(remote) && limits.size >= 10000) throw new RoomError(429, 'RATE_LIMITED', '连接过多，请稍后再试。');
      limit = {start:stamp, count:0, creates:0, joins:0};
      limits.set(remote, limit);
    }
    const creates = method === 'POST' && pathname === '/api/rooms';
    const joins = method === 'POST' && /^\/api\/rooms\/\d{6}\/join$/.test(pathname);
    if (++limit.count > 1200 || (creates && ++limit.creates > 30) || (joins && ++limit.joins > 240)) {
      throw new RoomError(429, 'RATE_LIMITED', '操作过于频繁，请稍后再试。');
    }
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      let url, pathname;
      try { url = new URL(request.url, 'http://localhost'); pathname = decodeURIComponent(url.pathname); }
      catch { throw new RoomError(400, 'INVALID_URL', '请求地址无效。'); }
      if (pathname === '/healthz' && request.method === 'GET') { json(response, 200, {ok:true}); return; }
      if (pathname.startsWith('/api/')) {
        checkLimit(request.socket.remoteAddress || 'unknown', pathname, request.method);
        if (request.method === 'POST') {
          const origin = request.headers.origin;
          const allowed = new Set([`http://${request.headers.host}`, `https://${request.headers.host}`]);
          if (configuredOrigin) allowed.add(configuredOrigin);
          if (origin && !allowed.has(origin)) throw new RoomError(403, 'ORIGIN_REJECTED', '请求来源不受支持。');
          if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw new RoomError(415, 'JSON_REQUIRED', '请发送 JSON 请求。');
        }
        if (pathname === '/api/rooms' && request.method === 'POST') { json(response, 201, roomService.create(await bodyOf(request))); return; }
        const match = /^\/api\/rooms\/(\d{6})\/(join|state|events|ready|start|next|action|leave|addBot|removeBot|removePlayer|voice|signal)$/.exec(pathname);
        if (!match) throw new RoomError(404, 'NOT_FOUND', '接口不存在。');
        const [, code, operation] = match;
        if (operation === 'events' && request.method === 'GET') { roomService.connect(code, url.searchParams.get('token'), response); return; }
        if (operation === 'state' && request.method === 'GET') { json(response, 200, roomService.state(code, tokenOf(request))); return; }
        if (operation === 'voice' && request.method === 'GET') { json(response, 200, roomService.voiceConfig(code, tokenOf(request))); return; }
        if (request.method !== 'POST' || operation === 'events' || operation === 'state') throw new RoomError(405, 'METHOD_NOT_ALLOWED', '请求方法不支持。');
        const body = await bodyOf(request, operation === 'signal' ? 24576 : 8192);
        const result = operation === 'join' ? roomService.join(code, body)
          : operation === 'voice' ? roomService.setVoice(code, tokenOf(request), body)
          : roomService[operation](code, tokenOf(request), body);
        json(response, operation === 'join' ? 201 : 200, result);
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
      const resource = pathname === '/' ? '/index.html' : pathname;
      if (!publicRootFiles.has(resource.slice(1)) && !publicModule.test(resource) && !publicAsset.test(resource)) { response.writeHead(404); response.end('Not found'); return; }
      const target = path.resolve(root, `.${resource}`);
      if (!target.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
      const data = await readFile(target);
      response.writeHead(200, {'Content-Type':mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control':'no-cache'});
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      if (response.headersSent) { response.end(); return; }
      if (error instanceof RoomError) json(response, error.status, {error:error.message, code:error.code});
      else if (error?.code === 'ENOENT') { response.writeHead(404); response.end('Not found'); }
      else { console.error('Request failed:', error.message); json(response, 500, {error:'服务器处理失败，请稍后重试。', code:'SERVER_ERROR'}); }
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('close', () => roomService.close());
  server.roomService = roomService;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 5173);
  const host = process.env.HOST || '0.0.0.0';
  const server = createServer();
  server.listen(port, host, () => console.log(`KK麻将已启动：http://localhost:${port}\n异地好友请访问部署后的公网 HTTPS 地址，再输入同一房间码。按 Ctrl+C 关闭。`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { server.roomService.close(); server.close(() => process.exit(0)); server.closeAllConnections?.(); });
}
