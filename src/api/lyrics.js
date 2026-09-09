import { createHash } from 'node:crypto';
import { CONFIG } from '../config.js';
import { ApiError } from './http.js';

/**
 * 歌词来源说明
 *
 * B 站自己不提供歌词数据：视频页 HTML 里没有 lyric 字段，__INITIAL_STATE__ 里没有，
 * view 接口的 desc 里也几乎没有 LRC 时间戳（实测「晴天」前 10 条视频 0 命中，
 * 「歌词」「LRC」为关键词各 12 条也是 0 命中）。
 *
 * 所以按曲名去外部公开接口查：网易云与 QQ 音乐各查一轮，取打分最高的那首。
 * QQ 那条链路能返回候选时长，所以打分时把「时长接近度」也算进去——
 * 歌名能对上的候选里，时长也对得上的那首几乎不可能是错的。
 *
 * 每首歌只查一次，结果在内存里缓存，不落盘——歌词是有版权的内容，
 * 本项目的定位是个人本地使用。两个来源都是公开接口，不打包任何对方 logo 或素材。
 */

const SEARCH_URL = 'https://music.163.com/api/search/get';
const LYRIC_URL = 'https://music.163.com/api/song/lyric';
const REFERER = 'https://music.163.com/';

// ---------- QQ 音乐 ----------

const QQ_SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
const QQ_LYRIC_URL = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';
const QQ_REFERER = 'https://y.qq.com/';
// 公开写死的会话 tk；c.y.qq.com 上不带 cookie 的请求都能用它过检
const QQ_GTK = '538128';
// 公开的签名盐：sign = md5(base + '&&' + 盐)。没有这个 salt 接口会回 retcode:1101
const QQ_SIGN_SALT = 'lZ0io9ZTlj9l7N';

/** 搜索返回的候选数。太少容易漏掉正主，太多没必要 */
const SEARCH_LIMIT = 30;
/** QQ 那侧只要前 10 条：够对上正主，还少发一次请求 */
const QQ_SEARCH_LIMIT = 10;
/** 相似度门槛。低于这个值宁可不显示歌词，也不显示错歌的歌词 */
const MATCH_THRESHOLD = 0.6;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 200;

// ---------- LRC 解析 ----------

const TIME_RE = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/;
const DIRECTIVE_RE = /^\[(ti|ar|al|by|re|offset|length|metadata):/i;
// 「作词 : 周杰伦」「编曲 : 池窪浩一 (Kouichi Ikekubo)」这类信息行。
// 要求标签后面必须有冒号：既能匹配带空格的英文名，又不会误删「作曲的人是我」这种真歌词。
const METADATA_LINE_RE =
  /^(作\s*词|作\s*曲|编\s*曲|录\s*音|混\s*音|母\s*带|制\s*作\s*人|监\s*制|制\s*图|吉\s*他|键\s*盘|贝\s*斯|鼓\s*手|弦\s*乐|口\s*琴|笛\s*声|萨克斯|人\s*声|vocal|lyricist|composer|arranger|producer|album|mixing|mastering|recording|engineer|piano|guitar|bass|drum)[\s]*[:：][\s]*(.*)$/i;

/**
 * 解析 LRC 文本为按时间排序的行。
 * 一个时间戳对应一行；同一行多个时间戳只取第一个（第二个通常是双语文本的罗马音/翻译）。
 * 纯元信息行（作词/作曲等）和 [ti:]/[offset:] 之类的指令行不进入歌词。
 */
export function parseLrc(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];

  const lines = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (DIRECTIVE_RE.test(line)) continue;

    const m = TIME_RE.exec(line);
    if (!m) continue; // 没有时间戳的行忽略（LRC 规范里不该出现）

    const min = Number(m[1]);
    const sec = Number(m[2]);
    // 毫秒位可能只有 1~3 位，按长度补齐
    const ms = Number((m[3] ?? '000').padEnd(3, '0'));
    if (Number.isNaN(min) || Number.isNaN(sec)) continue;

    // 一行可能有多个时间戳（双语文本的两种语言），时间取第一个，
    // 文本里要把所有时间戳标记都剥掉，否则 [mm:ss.xx] 会留在歌词里
    let text = line.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim();
    // 部分 LRC 用字面量 \n 换行
    text = text.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (METADATA_LINE_RE.test(text)) continue;

    lines.push({ time: min * 60 + sec + ms / 1000, text });
  }

  lines.sort((a, b) => a.time - b.time);
  return lines;
}

// ---------- 曲名清洗 ----------

// B 站标题里的非曲名信息。按长度降序匹配，"2160P60" 要先于 "2160P" 命中。
// 不放纯标点（- | 《》 等）：《》和引号在上面单独处理，- 和 | 要留给 segments() 切词段。
// 也不放 '60'/'30' 这类短数字：它们没有边界约束时会误删歌名里的数字，
// 靠 '2160p60'/'1080p60'/'60fps'/'4k60' 这些更具体的写法覆盖实际场景。
const TITLE_NOISE = [
  '无损音质', '无损', '高音质', '音源', '音画同步', '音画', '卡拉OK', '卡拉OK版', '伴奏版',
  '纯音乐', '纯人声', '铃声', '片段', '剪辑', '串烧', '混剪', '翻唱', '翻跳', '教学',
  '弹唱版', '弹唱', '演奏', '简谱', '谱子', '吉他谱', '钢琴谱', '伴奏', '采样', '女声版',
  '男声版', '深情版', '钢琴版', '吉他版', '二胡版', '童声版', '合唱版', '完整版',
  '完整版MV', '官方MV', '官方', '高清版', '超高清', '超清', '修复', '重制', '循环',
  '单曲推荐', '单曲', '推荐', '歌曲分享', '循环播放', 'MV版', 'Audio', 'visualizer',
  '频谱', '音质', '音轨', '视频', 'Live版', '现场版', '现场', 'DJ版', 'Remix',
  'covers', 'cover', '2160P60', '2160P30', '2160P', '1080P60', '1080P30', '1080P',
  '720P', '4K修复', '4K60', '4K30', '60FPS', '30FPS', 'Hi-Res', 'HiRes', 'Hi Res',
  'Lossless', 'Ultra HD', 'Hires', 'FLAC', 'MP3', 'AAC', 'UHd', 'HD', 'MV', '4K',
  'Live', 'DJ', 'MV版',
  // 乐谱/二创类
  '唱谱', '琴谱', '鼓谱', '谱面', '音准', '动态鼓谱', '动态谱', '谱', '还原', '复刻',
  '纪念', '神级', '超长', '光遇', '音游', 'keyword',
  // 版本标注与录音棚营销词
  '原版', '新版', '怀旧金曲', '百万豪装录音棚', '录音棚', '大声听',
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TITLE_NOISE_RE = new RegExp(
  TITLE_NOISE
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|'),
  'gi'
);

// 候选歌名里带这些字样说明是衍生版本，不是正主
const VERSION_NOISE_RE =
  /(钢琴版|吉他版|二胡版|童声版|深情版|女声版|男声版|翻唱版|cover版|伴奏版|纯音乐|纯人声|铃声|教学|谱|采样|钢琴|吉他伴奏|dj版|remix|伴奏|翻唱|cover|live版|现场版)/i;

/** 去掉 B 站标题里的修饰信息，只留可能当曲名用的部分 */
export function cleanTitle(raw) {
  let s = String(raw || '');
  // 搜索接口会把命中关键词包在 <em class= > 里（属性值甚至没有引号），先剥掉
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/【[^】]*】/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  s = s.replace(/〖[^〗]*〗/g, ' ').replace(/《([^》]*)》/g, '$1');
  // 引号里的通常是歌词摘录，整段去掉（中英双引号 + 弯单引号）
  s = s.replace(/["“”‘’][^"“”‘’]{0,60}["“”‘’]/g, ' ');
  s = s.replace(TITLE_NOISE_RE, ' ');
  return s.trim();
}

/** 拆成语义词段，用于和候选歌名逐个比较 */
export function segments(cleaned) {
  const parts = String(cleaned || '')
    .split(/\s*[-–—|,，、]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts : [String(cleaned || '').trim()].filter(Boolean);
}

// ---------- 相似度 ----------

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** 最长公共子串长度 / 较短串长度。对「多出来的修饰词」天然免疫 */
export function lcsRatio(a, b) {
  if (!a || !b) return 0;
  const n = a.length;
  const m = b.length;
  let best = 0;
  let prev = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const cur = new Array(m + 1).fill(0);
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best / Math.min(n, m);
}

/**
 * 时长吻合度：候选时长和实际时长差得越远扣分越多。
 *
 * 分三档：
 *   |差| ≤ 6s      → 1.0（LRC 时间戳本来就有漂移，几秒内算同一首）
 *   6s ~ 30s      → 1.0 线性降到 0.5
 *   30s ~ 120s    → 0.5 线性降到 0
 *   > 120s        → 0（基本可以断定是另一首歌）
 *
 * 不认「相对差」而认「绝对差」：一首 4 分钟的歌差 30s 是 12.5%，
 * 一首 3 分钟的歌差 30s 也是 30s——对播放对齐来说这两个惩罚应当一样。
 */
export function durationFactor(expectedSec, candidateSec) {
  if (!expectedSec || !candidateSec) return 0;
  const gap = Math.abs(expectedSec - candidateSec);
  if (gap <= 6) return 1;
  if (gap <= 30) return 1 - 0.5 * ((gap - 6) / 24);
  if (gap <= 120) return 0.5 - 0.5 * ((gap - 30) / 90);
  return 0;
}

/**
 * 给候选打分。0.78 看歌名相似，0.22 看歌手是否能在标题里对上，
 * 再乘一个时长因子（没有时长数据时按 0.88 计，不奖不罚），衍生版本扣分。
 *
 * 之前是 0.72 标题 + 0.28 歌手：歌手那一项只能命中或不命中，
 * 一旦标题对上而歌手对不上，分数就会掉到 0.43 以下，反而把正主（标题完全一致）刷下去。
 * 把权重让给时长之后，正主的时长通常完全吻合，能稳稳拉开。
 *
 * 长词段要降权：B 站标题里常夹一整句歌词（「原谅我这一生不羁放纵爱自由」），
 * 它和「原谅我」这种短歌名能拿到满相似分，是误配的主要来源。
 * 中文歌名一般不超过 12 字，所以长词段的分数按 0.5 / 0.2 折减。
 */
export function scoreCandidate(cleaned, segs, candidate, expectedDurationSec = 0) {
  const nname = norm(candidate.name || '');
  let best = 0;
  for (const seg of segs) {
    let ratio = lcsRatio(nname, norm(seg));
    const len = seg.length;
    if (len > 20) ratio *= 0.2;
    else if (len > 12) ratio *= 0.5;
    if (ratio > best) best = ratio;
  }
  let base = best * 0.78;

  // 歌手名按非字母数字切开逐个比对：「冯沁苑(买辣椒也用券)」要能对上标题里的「买辣椒也用券」
  const artistChunks = (candidate.artists || [])
    .flatMap((a) => String((a && a.name) || '').split(/[^\p{L}\p{N}]+/u))
    .map((c) => c.trim())
    .filter((c) => c.length >= 2);
  const ncTitle = norm(cleaned);
  if (artistChunks.some((c) => ncTitle.includes(norm(c)))) base += 0.22;

  // 时长因子：只有「候选自己带时长」时才按差值算；候选没时长数据时给中性 0.88。
  // 不能把缺时长当 0 差：那会把网易云这种不带时长的正确候选直接打成 0 分。
  // 中性值给 0.88 而不是 1.0，是为了让「时长完全吻合」的那条盖过「时长未知但标题一样」的那条。
  const candDur = Number(candidate.durationSec) || 0;
  const dFactor = expectedDurationSec && candDur > 0 ? durationFactor(expectedDurationSec, candDur) : 0.88;

  let score = base * dFactor;

  if (VERSION_NOISE_RE.test(candidate.name || '')) score -= 0.3;
  return Math.max(0, Math.min(1, score));
}

// ---------- 抓取 ----------

async function netease(path, params, fetchFn = fetch) {
  const url = new URL(path, 'https://music.163.com');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetchFn(url, {
    headers: { 'User-Agent': CONFIG.UA, Referer: REFERER },
    signal: AbortSignal.timeout(CONFIG.API_TIMEOUT_MS),
  });
  if (!res.ok) throw new ApiError(502, `歌词服务返回 HTTP ${res.status}`);
  return res.json();
}

/** 网易云搜索：返回 {id, name, artists} 形式的候选 */
async function searchSongs(query, fetchFn = fetch) {
  const json = await netease(SEARCH_URL, { s: query, type: '1', limit: String(SEARCH_LIMIT) }, fetchFn);
  return (json.result?.songs || [])
    .filter((s) => Number.isInteger(s.id) && s.name)
    .map((s) => ({
      id: s.id,
      name: s.name,
      artists: (s.artists || []).map((a) => ({ name: a.name })),
    }));
}

async function fetchLrcText(id, fetchFn = fetch) {
  const json = await netease(LYRIC_URL, { id: String(id), lv: '-1', kv: '-1', tv: '-1' }, fetchFn);
  return json.lrc?.lyric || '';
}

// --- QQ 音乐 ---

/** 剥掉 JSONP 回调包裹：MusicJsonCallback({...}) → {...} */
function stripCallback(text) {
  return String(text || '')
    .replace(/^\w+\(/, '')
    .replace(/\)\s*$/, '');
}

/** 签名：md5(拼接好的 base URL + '&&' + 盐)。base 必须不含 sign/from 两个参数 */
function qqSign(base) {
  return createHash('md5').update(`${base}&&${QQ_SIGN_SALT}`).digest('hex');
}

const qqHeaders = { 'User-Agent': CONFIG.UA, Referer: QQ_REFERER };

/** QQ 搜索：接口返回的是 JSONP 包裹的 JSON，字段名和网易云完全不同 */
async function qqSearch(query, fetchFn = fetch) {
  const base = `${QQ_SEARCH_URL}?w=${encodeURIComponent(query)}&p=1&n=${QQ_SEARCH_LIMIT}&cr=1&g_tk=${QQ_GTK}`;
  const res = await fetchFn(`${base}&sign=${qqSign(base)}&from=utc_pc`, {
    headers: qqHeaders,
    signal: AbortSignal.timeout(CONFIG.API_TIMEOUT_MS),
  });
  if (!res.ok) throw new ApiError(502, `歌词服务返回 HTTP ${res.status}`);
  const json = JSON.parse(stripCallback(await res.text()));
  return (json.data?.song?.list || [])
    .filter((s) => s.songmid && s.songname)
    .map((s) => ({
      id: s.songmid,
      name: s.songname,
      artists: (s.singer || []).map((a) => ({ name: a.name })),
      // interval 单位是秒
      durationSec: Number(s.interval) || 0,
    }));
}

/**
 * QQ 歌词。返回的 lyric 字段是 base64，解出来是 UTF-8 文本（不是 UTF-16LE，
 * 用 utf16le 解会把中文全变成乱码，只留 ASCII 时间戳可读）。
 */
async function qqFetchLrc(mid, fetchFn = fetch) {
  const base = `${QQ_LYRIC_URL}?songmid=${encodeURIComponent(mid)}&format=0&g_tk=${QQ_GTK}&inCharset=utf8&outCharset=utf-8&notice=0`;
  const res = await fetchFn(`${base}&sign=${qqSign(base)}&from=utc_pc`, {
    headers: qqHeaders,
    signal: AbortSignal.timeout(CONFIG.API_TIMEOUT_MS),
  });
  if (!res.ok) throw new ApiError(502, `歌词服务返回 HTTP ${res.status}`);
  const json = JSON.parse(stripCallback(await res.text()));
  if (json.retcode !== 0 || !json.lyric) return '';
  try {
    return Buffer.from(String(json.lyric), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

/** 两个来源的声明：同一个 shape，方便在 fetchLyrics 里循环 */
const SOURCES = [
  {
    key: 'netease',
    name: '网易云音乐',
    search: async (q, f) => (await searchSongs(q, f)).map((c) => ({ ...c, sourceKey: 'netease', sourceName: '网易云音乐' })),
    fetchLrc: async (id, f) => fetchLrcText(id, f),
  },
  {
    key: 'qq',
    name: 'QQ 音乐',
    search: async (q, f) => (await qqSearch(q, f)).map((c) => ({ ...c, sourceKey: 'qq', sourceName: 'QQ 音乐' })),
    fetchLrc: async (id, f) => qqFetchLrc(id, f),
  },
];

/** 所有来源并发查一轮，汇总成带 source 信息的候选，按分数降序返回 */
async function searchAll(query, fetchFn = fetch) {
  const settled = await Promise.allSettled(
    SOURCES.map((src) => src.search(query, fetchFn).catch(() => []))
  );
  return settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
}

async function fetchLrcBySource(sourceKey, id, fetchFn = fetch) {
  const src = SOURCES.find((s) => s.key === sourceKey);
  if (!src) return '';
  return src.fetchLrc(id, fetchFn);
}

// 内存缓存：歌词不会变，6 小时足够；只放内存不落盘
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), data });
}

/**
 * 按曲名取歌词。查不到时返回 { lines: [], found: false }，不抛错——
 * 没有歌词是常态，不是异常，前端据此显示「暂无歌词」而不是错误提示。
 *
 * durationSec 是 B 站这侧的总时长，用来给候选打分（时长接近度），
 * 不参与缓存 key——同一首歌的不同版本时长接近，缓存可以复用。
 *
 * @returns {Promise<{ lines: Array, found: boolean, match: ?object, source: string, durationScore: number }>}
 */
export async function fetchLyrics(title, artist = '', durationSec = 0, fetchFn = fetch) {
  const cleaned = cleanTitle(title);
  const segs = segments(cleaned);
  if (!cleaned || !segs.length) {
    return { lines: [], found: false, match: null, source: 'netease', durationScore: 0 };
  }

  const dur = Number(durationSec) > 0 ? Number(durationSec) : 0;
  const key = norm(cleaned) + '|' + norm(artist);
  const cached = cacheGet(key);
  if (cached) return cached;

  // 先用清洗后的标题查一次；查不到再用各词段分别查，取最优。
  // 去重：标题里只有一个词段时，词段就是标题本身，别重复请求。
  const queries = [];
  const seen = new Set();
  for (const q of [cleaned, ...segs.filter((s) => norm(s).length >= 2)]) {
    const n = norm(q);
    if (n.length >= 2 && !seen.has(n)) {
      seen.add(n);
      queries.push(q);
    }
  }
  let best = null;
  let lrcText = '';

  for (const q of queries.slice(0, 4)) {
    if (!norm(q)) continue;
    // 两个来源并发，各自失败互不影响：某个来源挂掉不该让另一条链路的命中作废
    let candidates;
    try {
      candidates = await searchAll(q, fetchFn);
    } catch {
      continue;
    }
    for (const c of candidates) {
      const score = scoreCandidate(cleaned, segs, c, dur);
      if (!best || score > best.score) best = { score, candidate: c };
    }
    if (best && best.score >= MATCH_THRESHOLD) break;
  }

  if (!best || best.score < MATCH_THRESHOLD) {
    const empty = { lines: [], found: false, match: null, source: 'netease', durationScore: 0 };
    cacheSet(key, empty);
    return empty;
  }

  let lines = [];
  try {
    lines = parseLrc(await fetchLrcBySource(best.candidate.sourceKey, best.candidate.id, fetchFn));
  } catch {
    lines = [];
  }
  if (!lines.length) {
    const empty = { lines: [], found: false, match: null, source: 'netease', durationScore: 0 };
    cacheSet(key, empty);
    return empty;
  }

  const result = {
    lines,
    found: true,
    match: {
      id: best.candidate.id,
      name: best.candidate.name,
      artist: (best.candidate.artists || []).map((a) => a.name).join(' / '),
      score: Math.round(best.score * 100) / 100,
      source: best.candidate.sourceName,
      durationSec: best.candidate.durationSec || 0,
    },
    source: best.candidate.sourceKey,
    durationScore: Math.round(durationFactor(dur, best.candidate.durationSec || 0) * 100) / 100,
  };
  cacheSet(key, result);
  return result;
}
