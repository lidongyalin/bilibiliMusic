import { CONFIG } from '../config.js';

/**
 * buvid3/buvid4 是 B 站接口的准入门槛，缺失时搜索接口会返回 -1200「被降级过滤的请求」。
 * 从指纹接口获取后在内存中缓存，过期自动刷新。
 */
let cookie = null;
let cookieExpiresAt = 0;
let cookiePromise = null;

export async function ensureCookie() {
  if (cookie && Date.now() < cookieExpiresAt) return cookie;
  if (!cookiePromise) cookiePromise = fetchCookie().finally(() => (cookiePromise = null));
  return cookiePromise;
}

/** 丢弃当前 buvid，下次请求重新申请。用于上游降级后重试。 */
export function resetCookie() {
  cookie = null;
  cookieExpiresAt = 0;
  cookiePromise = null;
}

async function fetchCookie() {
  const res = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
    headers: { 'User-Agent': CONFIG.UA },
    signal: AbortSignal.timeout(CONFIG.API_TIMEOUT_MS),
  });
  const json = await res.json();
  if (json.code !== 0 || !json.data?.b_3) {
    throw new ApiError(502, '无法获取 B 站访客标识（buvid），请检查网络后重试');
  }
  // 注意字段是 b_3 / b_4，不是 buvid3 / buvid4
  cookie = `buvid3=${json.data.b_3}; buvid4=${json.data.b_4}`;
  cookieExpiresAt = Date.now() + CONFIG.COOKIE_TTL_MS;
  return cookie;
}

/**
 * CDN 强制校验 Referer 是否存在：缺失返回 403，任意值均可通过。
 * 这里固定带 B 站首页。
 */
export function upstreamHeaders(extra = {}) {
  return {
    'User-Agent': CONFIG.UA,
    Referer: 'https://www.bilibili.com/',
    ...extra,
  };
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
