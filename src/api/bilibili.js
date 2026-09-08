import { CONFIG } from '../config.js';
import { ApiError, ensureCookie, resetCookie, upstreamHeaders } from './http.js';

/**
 * 音源说明
 *
 * 计划中的「音频区」接口（api.vc.bilibili.com）已整体下线，全部返回 404；
 * 桌面端 search/type?search_type=audio 需要登录，匿名返回 -1200 被降级。
 * 实测可用的路径是聚合搜索 search/all/v2，再从视频页 __playinfo__ 提取 DASH 音轨。
 */

const SEARCH_URL = 'https://api.bilibili.com/x/web-interface/search/all/v2';

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
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { ...upstreamHeaders(), Cookie: await ensureCookie() },
    signal: AbortSignal.timeout(CONFIG.API_TIMEOUT_MS),
  });
  const json = await res.json().catch(() => null);
  if (!json || json.code !== 0) {
    const reason = json?.message || `上游返回 ${res.status}`;
    throw new ApiError(502, `搜索失败：${reason}`);
  }
  return json;
}

function videoGroup(json) {
  return (json.data?.result || []).find((g) => g.result_type === 'video');
}

/**
 * 搜索音乐。只取 video 类型的结果（B 站默认相关性排序已较合理，保留原序）。
 */
export async function searchSongs(keyword, page = 1) {
  const kw = String(keyword || '').trim();
  if (!kw) throw new ApiError(400, '请输入搜索关键词');

  const params = new URLSearchParams({ keyword: kw, page: String(page), order: '0' });
  let json = await fetchSearch(params);

  // buvid 被过度复用后，B 站会降级返回「有结果数、结果列表为空」的响应。
  // 识别出这种降级响应就换一个 buvid 重试一次。
  if (
    !(videoGroup(json)?.data || []).length &&
    (json.data?.pageinfo?.video?.numResults ?? 0) > 0
  ) {
    resetCookie();
    json = await fetchSearch(params);
  }

  const rawItems = videoGroup(json)?.data || [];

  const songs = rawItems
    .filter((it) => Boolean(it.bvid && it.duration))
    .map(toSong)
    .filter((song) => song.durationSec > 0 && song.durationSec <= CONFIG.MAX_DURATION_SEC);

  const total = json.data?.pageinfo?.video?.numResults ?? songs.length;
  return { keyword: kw, page, list: songs, total, hasMore: page * CONFIG.PAGE_SIZE < total };
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
