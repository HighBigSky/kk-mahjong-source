import { createHmac, randomBytes } from 'node:crypto';

/**
 * 解析逗号分隔的 ICE 地址，忽略空白项。
 * @param {string|undefined} value
 * @returns {string[]}
 */
function listOf(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

/**
 * 生成浏览器可用的 ICE 服务器列表。
 * - STUN 由 STUN_URL 提供，默认使用公共 STUN，便于本机/小规模直连。
 * - TURN 支持 coturn 的 use-auth-secret 短期凭证，也支持固定用户名密码。
 * - 未配置任何 TURN 凭证时不会返回 TURN，避免浏览器反复使用无效中继。
 * @param {{[key:string]: string|undefined}} [env]
 * @returns {() => Array<{urls:string|string[], username?:string, credential?:string}>}
 */
export function createVoiceIceConfig(env = process.env) {
  const stunUrls = listOf(env.STUN_URL).length ? listOf(env.STUN_URL) : ['stun:stun.l.google.com:19302'];
  const turnUrls = listOf(env.TURN_URL);
  const turnSecret = env.TURN_SECRET || '';
  const staticUsername = env.TURN_USERNAME || '';
  const staticCredential = env.TURN_CREDENTIAL || '';
  const ttlSeconds = Math.min(86400, Math.max(300, Number(env.TURN_TTL_SECONDS) || 3600));
  if (turnUrls.length && !turnSecret && (!staticUsername || !staticCredential)) {
    console.warn('TURN_URL 已配置，但缺少 TURN_SECRET 或 TURN_USERNAME/TURN_CREDENTIAL，语音将只使用 STUN。');
  }
  return () => {
    /** @type {Array<{urls:string|string[], username?:string, credential?:string}>} */
    const servers = [];
    if (stunUrls.length) servers.push({urls:stunUrls});
    if (turnUrls.length) {
      if (turnSecret) {
        // coturn REST API 约定：用户名中包含过期时间，密码为 HMAC-SHA1(secret, username) 的 Base64。
        const username = `${Math.floor(Date.now() / 1000) + ttlSeconds}:${randomBytes(6).toString('hex')}`;
        const credential = createHmac('sha1', turnSecret).update(username).digest('base64');
        servers.push({urls:turnUrls, username, credential});
      } else if (staticUsername && staticCredential) {
        servers.push({urls:turnUrls, username:staticUsername, credential:staticCredential});
      }
    }
    return servers;
  };
}
