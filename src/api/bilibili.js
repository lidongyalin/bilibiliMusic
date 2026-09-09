import { createHash } from 'node:crypto';
import { CONFIG } from '../config.js';
import { ApiError, ensureCookie, resetCookie, upstreamHeaders } from './http.js';

/**
 * 音源说明
 *
 * 计划中的「音频区」接口（api.vc.bilibili.com）已整体下线，全部返回 404；
 * 桌面端 search/type?search_type=audio 需要登录，匿名返回 -1200 被降级。
 * 实测可用的路径是视频搜索 wbi/search/type?search_type=video，
 * 再从视频页 __playinfo__ 提取 DASH 音轨。
 *
 * 排序：该端点忽略数字 order 值（0~5 返回完全相同的顺序），只认字符串枚举。
 * order=click 按播放量降序，且跨页严格单调（实测第 2 页最大值 ≤ 第 1 页最小值），
 * 所以排序交给上游，前端不需要再排。
 *
 * 翻页：请求超出 numPages 时上游会把 page 夹回 numPages+1 并重复返回同一页，
 * 而不是返回空列表，所以终止条件必须用 numPages 判定，不能靠「空页即到底」。
 */

const SEARCH_URL = 'https://api.bilibili.com/x/web-interface/wbi/search/type';

/** 播放量从高到低。其余取值：totalrank / pubdate / dm / stow / scores */
const ORDER_BY_PLAY = 'click';

/**
 * WBI 签名常量。key 正常应从 nav.data.wbi 读取，但该端点需要登录
 * （匿名返回 code -101 且不携带 wbi），只能用公开的固定值。
 * 上游偶尔轮换这两个常量，轮换后搜索会静默返回空结果，届时改这里即可。
 */
const WBI_MIXIN_ORIG = 'fNBDcEh89LgqKv9470wH1n3zJyXa5r2m6yGZb7sTQdPuAJoCkRl';
const WBI_IMG_KEY = '7cd08797d8a00a6a292ba9cc42f842b4';
const WBI_SUB_KEY = 'e8862e026f44c27853b2d88f8c74c737';

const WBI_MIXIN_KEY = [...WBI_MIXIN_ORIG]
  .filter((c) => (WBI_IMG_KEY + WBI_SUB_KEY).includes(c))
  .join('');

/** 业务参数 → 带 wts / w_rid 的查询串 */
export function signWbi(params) {
  const qs = new URLSearchParams(params).toString();
  const wts = Math.floor(Date.now() / 1000);
  const wRid = createHash('md5').update(`${qs}&wts=${wts}${WBI_MIXIN_KEY}`).digest('hex');
  return `${qs}&wts=${wts}&w_rid=${wRid}`;
}

const HTML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/** 去掉搜索接口给标题加的 <em class="keyword"> 高亮标签，并反转义残留的 HTML 实体 */
function cleanText(raw) {
  return String(raw || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => HTML_ENTITIES[m])
    .replace(/\s+/g, ' ')
    .trim();
}

/** 协议相对地址补全为 https */
function absoluteUrl(raw) {
  if (!raw) return '';
  if (raw.startsWith('//')) return 'https:' + raw;
  return raw;
}

/**
 * "4:3" → 243，"1:02:03" → 3723。B 站搜索接口给的是 M:S / MM:SS / H:MM:SS 混合格式。
 */
function parseDuration(raw) {
  if (!raw) return 0;
  const parts = String(raw).split(':').map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** 时长秒数 → "4:03" / "1:02:03" */
export function formatDuration(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** 播放量计数格式化：78806 → "7.9 万" */
export function formatPlayCount(n) {
  n = Number(n) || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + ' 亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + ' 万';
  return String(n);
}

/** 搜索结果项 → 统一 Song 模型 */
function toSong(item) {
  const durationSec = parseDuration(item.duration);
  return {
    id: item.bvid,
    type: 'video',
    bvid: item.bvid,
    aid: item.aid,
    title: cleanText(item.title),
    author: cleanText(item.author) || '未知 UP 主',
    cover: absoluteUrl(item.pic),
    duration: formatDuration(durationSec),
    durationSec,
    play: Number(item.play) || 0,
    playText: formatPlayCount(item.play),
    isPay: Boolean(item.is_pay) || Boolean(item.badgepay),
  };
}

async function fetchSearch(params) {
  const res = await fetch(`${SEARCH_URL}?${signWbi(params)}`, {
    headers: { ...upstreamHeaders(), Cookie: await ensureCookie() },
    signal: AbortSignal.timeout(CONFIG.API_TIMEOUT_MS),
  });
  const json = await res.json().catch(() => null);
  if (!json || json.code !== 0) {
    const reason = json.message || `上游返回 ${res.status}`;
    throw new ApiError(502, `搜索失败：${reason}`);
  }
  return json;
}

/** 风控挑战的提示文案。这个响应顶着 code=0 回来，最容易当成「没有更多」 */
export const RISK_BLOCKED_MESSAGE = '搜索请求被 B 站风控拦下了，稍后再试一次';

/** 风控重试前的等待。立刻重试只会再烧一个请求，把封锁加重 */
export const RISK_RETRY_DELAY_MS = 1200;

/**
 * 给上游搜索响应分三类。抽成纯函数是为了能离线单测——这条分类错了，
 * 用户看到的就是「列表莫名其妙停在一页，还显示没有更多了」。
 *
 * @returns {'ok' | 'blocked' | 'error'}
 */
export function classifySearchResponse(json) {
  // 风控/滑块验证挑战：code 是 0，message 是 "OK"，但 data 里只有 v_voucher，
  // 没有 result / numResults / numPages。必须单独识别，不能靠 code 判断。
  if (json && json.data && typeof json.data.v_voucher === 'string') return 'blocked';
  if (!json || json.code !== 0) return 'error';
  return 'ok';
}

function parseSearchPage(json, kw, page) {
  const songs = (json.data?.result || [])
    .filter((it) => Boolean(it.bvid && it.duration))
    .map(toSong)
    .filter((song) => song.durationSec > 0 && song.durationSec <= CONFIG.MAX_DURATION_SEC);

  // 超页请求不会被上游拒绝，而是夹回 numPages+1 重复返回，所以必须用它判定终止。
  const numPages = json.data?.numPages ?? 0;
  const total = json.data?.numResults ?? songs.length;
  return { keyword: kw, page, list: songs, total, hasMore: numPages > 0 && page < numPages };
}

/**
 * 搜索音乐。只取 video 类型的结果，按播放量从高到低排序。
 * 排序由上游完成（order=click）且跨页保持单调，前端无需再排。
 */
export async function searchSongs(keyword, page = 1) {
  const kw = String(keyword || '').trim();
  if (!kw) throw new ApiError(400, '请输入搜索关键词');

  const params = {
    search_type: 'video',
    keyword: kw,
    page: String(page),
    page_size: String(CONFIG.PAGE_SIZE),
    order: ORDER_BY_PLAY,
  };
  let json = await fetchSearch(params);

  if (classifySearchResponse(json) === 'blocked') {
    // 换一个 buvid 等一会儿再试一次。只试一次：还被拦就说明不是 buvid 的问题，
    // 继续重试只会让封锁更久。
    resetCookie();
    await new Promise((r) => setTimeout(r, RISK_RETRY_DELAY_MS));
    json = await fetchSearch(params);
    if (classifySearchResponse(json) === 'blocked') {
      throw new ApiError(429, RISK_BLOCKED_MESSAGE);
    }
    if (classifySearchResponse(json) === 'error') {
      const reason = json?.message || `上游返回 ${json ? json.code : '异常'}`;
      throw new ApiError(502, `搜索失败：${reason}`);
    }
  }

  return parseSearchPage(json, kw, page);
}

/**
 * 从视频页 HTML 里提取 __playinfo__。用括号配对而不是正则，
 * 因为 JSON 字符串里可能含 "}" 字符，贪婪正则会截错位置。
 */
function extractPlayinfo(html) {
  const match = html.search(/__playinfo__\s*=\s*/);
  if (match < 0) return null;
  const start = html.indexOf('{', match);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/**
 * 解析某视频的音频流地址，取带宽最高的一档。
 */
export async function resolveAudioUrl(bvid) {
  if (!/^BV[0-9A-Za-z]+$/u.test(bvid)) throw new ApiError(400, '无效的视频编号');

  const fetchPage = async () => {
    const res = await fetch(`https://www.bilibili.com/video/${bvid}/`, {
      headers: { ...upstreamHeaders(), Cookie: await ensureCookie() },
      signal: AbortSignal.timeout(CONFIG.API_TIMEOUT_MS),
    });
    if (!res.ok) throw new ApiError(502, `无法读取视频页（HTTP ${res.status}）`);
    return extractPlayinfo(await res.text());
  };

  let playinfo = await fetchPage();
  // 页面被降级时拿不到 __playinfo__，换一个 buvid 重试一次
  if (!playinfo) {
    resetCookie();
    playinfo = await fetchPage();
  }
  if (!playinfo) throw new ApiError(502, '未找到播放信息，视频可能已删除或需要登录');

  const data = playinfo.data || {};
  const tracks = data.dash?.audio || [];
  if (!tracks.length) {
    throw new ApiError(
      404,
      data.durl?.length
        ? '该视频为单文件混合流，不支持单独提取音轨'
        : '该视频没有可提取的音轨（可能是付费或受版权限制内容）'
    );
  }

  const best = tracks.reduce((a, b) => (Number(b.bandwidth) > Number(a.bandwidth) ? b : a));
  return {
    url: best.baseUrl,
    aid: data.aid,
    cid: data.cid,
    title: data.timeline?.title || data.tl_out?.title || '',
    durationSec: (data.timelength || 0) / 1000,
    bandwidth: Number(best.bandwidth) || 0,
    mimeType: best.mimeType || 'audio/mp4',
    seekType: data.seek_type || 0,
  };
}
