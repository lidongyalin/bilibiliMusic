import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CONFIG } from '../config.js';
import { ApiError, upstreamHeaders } from './http.js';
import { resolveAudioUrl } from './bilibili.js';

/**
 * 浏览器无法直接播放 bilivideo 地址（CDN 不发 CORS 头，且强制校验 Referer），
 * 所以由后端代理转发。播放器的拖动进度条依赖 Range 请求，这里必须完整透传。
 */

/** 解析结果缓存：同一首歌的多次 Range 请求不必反复抓视频页 */
const resolveCache = new Map();

function cacheGet(key) {
  const hit = resolveCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CONFIG.RESOLVE_CACHE_TTL_MS) {
    resolveCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  resolveCache.set(key, { at: Date.now(), value });
  if (resolveCache.size > 100) {
    // Map 按插入序迭代，删最旧的即可
    const oldest = resolveCache.keys().next().value;
    if (oldest !== undefined) resolveCache.delete(oldest);
  }
}

export async function resolveAudio(bvid) {
  const hit = cacheGet(bvid);
  if (hit) return hit;
  const value = await resolveAudioUrl(bvid);
  cacheSet(bvid, value);
  return value;
}

export async function handleStream(req, res, bvid) {
  let audio;
  try {
    audio = await resolveAudio(bvid);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 502;
    res.status(status).json({ error: err.message || '音频地址解析失败' });
    return;
  }

  const headers = upstreamHeaders();
  if (req.headers.range) headers.Range = req.headers.range;

  let upstream;
  try {
    upstream = await fetch(audio.url, { headers, signal: AbortSignal.timeout(CONFIG.STREAM_TIMEOUT_MS) });
  } catch (err) {
    res.status(502).json({ error: '音频流连接失败，请稍后重试' });
    return;
  }

  // CDN 忽略 Range 时会回 200 全量，此时不应当伪装成 206
  const partial = upstream.status === 206;
  res.status(partial ? 206 : upstream.status === 200 ? 200 : upstream.status);

  const rawType = upstream.headers.get('content-type') || audio.mimeType || 'audio/mp4';
  // 只取 DASH 音轨（dash.audio[].baseUrl），内容是纯音频，但 CDN 常把它标成
  // video/mp4 或 octet-stream。统一成 audio/mp4，省得客户端按容器嗅探。
  const contentType = /video\/mp4|octet-stream/i.test(rawType) ? 'audio/mp4' : rawType;
  res.setHeader('Content-Type', contentType);
  // Content-Length 必须透传：206 的分段长度靠它界定，
  // 缺失时 <audio> 会一直等数据，卡在 loading 状态不开始解码
  res.setHeader('Content-Length', upstream.headers.get('content-length'));
  if (partial) res.setHeader('Content-Range', upstream.headers.get('content-range'));
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=0');

  if (!upstream.body) {
    res.end();
    return;
  }

  const source = Readable.fromWeb(upstream.body);
  source.on('close', () => {
    // 客户端断开时取消上游请求，避免连接泄漏
    upstream.body.cancel?.().catch(() => {});
  });

  try {
    await pipeline(source, res);
  } catch {
    // 客户端主动中止播放时会抛 ERR_STREAM_PREMATURE_CLOSE，属正常情况
    try { upstream.body.cancel?.().catch(() => {}); } catch { /* ignore */ }
  }
}
