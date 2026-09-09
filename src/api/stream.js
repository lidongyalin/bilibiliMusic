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

/** 音轨地址失效时清掉缓存，让下一次请求重新解析而不是继续用坏地址 */
export function invalidate(bvid) {
  resolveCache.delete(bvid);
}

/** 安全地丢弃上游响应体，避免连接泄漏 */
function cancelBody(upstream) {
  try {
    const p = upstream.body?.cancel?.();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* ignore */ }
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

  // 超时只覆盖「建连到拿到响应头」这一段。
  // 如果直接把 AbortSignal 挂在 fetch 上，它会在整个响应体读取期间一直生效，
  // 播到 30 秒左右会被掐断——歌曲时长远大于这个值。
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), CONFIG.STREAM_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(audio.url, { headers, signal: controller.signal });
  } catch {
    res.status(502).json({ error: '音频流连接失败，请稍后重试' });
    return;
  } finally {
    clearTimeout(deadline);
  }

  // CDN 限流或地址失效时会回 HTML 错误页，有时甚至带 206 状态码。
  // 直接转发会让 <audio> 拿到无法解码的文本：duration 一直为 0、进度条卡住，
  // 客户端既播不了也报不出可读的错误。所以在提交任何响应头之前先校验。
  const rawType = upstream.headers.get('content-type') || '';
  const looksLikeHtml = /text\/html|text\/xml|application\/xml/i.test(rawType);
  if (upstream.status !== 200 && upstream.status !== 206 || looksLikeHtml) {
    cancelBody(upstream);
    invalidate(bvid);
    res.status(502).json({
      error: looksLikeHtml
        ? '音频流暂不可用（上游返回了错误页），请重新播放或稍后再试'
        : `音频流暂不可用（上游 HTTP ${upstream.status}），请重新播放或稍后再试`,
    });
    return;
  }

  // CDN 忽略 Range 时会回 200 全量，此时不应当伪装成 206
  const partial = upstream.status === 206;
  res.status(partial ? 206 : 200);

  // 只取 DASH 音轨（dash.audio[].baseUrl），内容是纯音频，但 CDN 常把它标成
  // video/mp4 或 octet-stream。统一成 audio/mp4，省得客户端按容器嗅探。
  const type = rawType || audio.mimeType || 'audio/mp4';
  res.setHeader('Content-Type', /video\/mp4|octet-stream/i.test(type) ? 'audio/mp4' : type);
  // Content-Length / Content-Range 必须透传：206 的分段边界靠它们界定，
  // 缺失时 <audio> 会一直等数据，卡在 loading 状态不开始解码。
  // CDN 偶尔不回这些头，此时不要设成 "null"，那比不设置更糟。
  const length = upstream.headers.get('content-length');
  if (length) res.setHeader('Content-Length', length);
  if (partial) {
    const range = upstream.headers.get('content-range');
    if (range) res.setHeader('Content-Range', range);
  }
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=0');

  if (!upstream.body) {
    res.end();
    return;
  }

  const source = Readable.fromWeb(upstream.body);
  source.on('close', () => {
    // 客户端断开时取消上游请求，避免连接泄漏
    cancelBody(upstream);
  });

  try {
    await pipeline(source, res);
  } catch {
    // 客户端主动中止播放时会抛 ERR_STREAM_PREMATURE_CLOSE，属正常情况
    cancelBody(upstream);
  }
}
