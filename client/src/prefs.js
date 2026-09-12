/**
 * 本地偏好持久化：播放模式、音量、上次关键词、搜索历史、视图，以及每首歌的播放位置。
 * 位置按 bvid 记录，回到同一首歌时自动续播。
 */

const NS = 'bilibili-music-player:'

/** 搜索历史条数上限 */
const HISTORY_MAX = 30

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value))
  } catch {
    // 隐私模式或配额超限时静默失败，功能不受影响
  }
}

/** 读回来可能是什么都可能有：夹到 [min,max]，不合法值落回默认 */
function clampInt(raw, fallback, min, max) {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

/** 桌面歌词的默认外观 */
const DESKTOP_LYRICS_STYLE_DEFAULT = { size: 22, color: '#ffffff', opacity: 92, outline: 2, lock: false }

const MODES = ['list', 'single', 'shuffle']
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const SMART_KINDS = ['recently-added', 'most-played', 'recently-played']
const SORT_KEYS = ['title', 'author', 'album', 'durationSec', 'addedAt', 'year', 'bitrate']
const SEARCH_SORT_KEYS = ['default', 'duration', 'title', 'author']

export const prefs = {
  getVolume() {
    const v = read('volume', 0.8)
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8
  },
  setVolume(v) { write('volume', v) },

  getMode() {
    const m = read('mode', 'list')
    return MODES.includes(m) ? m : 'list'
  },
  setMode(m) { write('mode', m) },

  getView() { return read('view', 'search') },
  setView(v) { write('view', v) },

  // 上次打开的歌单 id。歌单 id 是后端给的随机串，删掉后 id 也失效，
  // 所以读回来还要校验一遍它仍在歌单列表里，无效就退回搜索结果
  getLastPlaylist() { return read('lastPlaylist', '') },
  setLastPlaylist(id) { write('lastPlaylist', String(id || '')) },

  // 只存「是否打开歌词面板」这个开关。歌词文本本身属于版权内容，只放在内存里，不落任何持久化存储
  getLyricOpen() { return Boolean(read('lyricOpen', false)) },
  setLyricOpen(v) { write('lyricOpen', Boolean(v)) },

  getLastKeyword() { return read('keyword', '') },
  setLastKeyword(k) { write('keyword', k) },

  /**
   * 搜索页缓存：翻过的页存下来，本地做分页。
   * 结构在 search-cache.js 里定义，这里只负责读写。
   * 超预算或被浏览器配额拒绝时静默失败——缓存丢了只是下次多几个请求，不该影响功能。
   */
  getSearchCache() {
    const c = read('searchCache', {})
    return c && typeof c === 'object' ? c : {}
  },
  setSearchCache(c) { write('searchCache', c) },

  /**
   * 搜索历史。只记录用户明确提交的关键词（回车或点选历史项），
   * 不记录输入过程中的中间值——否则打一个字存一条，历史全是碎片。
   */
  getHistory() {
    const list = read('history', [])
    if (!Array.isArray(list)) return []
    return list.filter((k) => typeof k === 'string' && k.trim()).slice(0, HISTORY_MAX)
  },
  addHistory(keyword) {
    const kw = String(keyword || '').trim()
    if (!kw) return
    const lower = kw.toLowerCase()
    const rest = this.getHistory().filter((k) => k.toLowerCase() !== lower)
    write('history', [kw, ...rest].slice(0, HISTORY_MAX))
  },
  removeHistory(keyword) {
    write('history', this.getHistory().filter((k) => k !== keyword))
  },
  clearHistory() {
    write('history', [])
  },

  getPositions() { return read('positions', {}) },
  getPosition(bvid) {
    const v = read('positions', {})[bvid]
    return Number.isFinite(v) ? v : 0
  },
  setPosition(bvid, sec) {
    if (!bvid || !Number.isFinite(sec) || sec < 10) return
    const all = read('positions', {})
    all[bvid] = sec
    const keys = Object.keys(all)
    if (keys.length > 200) {
      for (const k of keys.slice(0, keys.length - 200)) delete all[k]
    }
    write('positions', all)
  },
  clearPosition(bvid) {
    const all = read('positions', {})
    delete all[bvid]
    write('positions', all)
  },

  // ---------- 倍速 ----------
  // 允许的值固定这几档，避免存进 1.37 这种没意义的数字
  getSpeed() {
    const v = Number(read('speed', 1))
    return SPEEDS.includes(v) ? v : 1
  },
  setSpeed(v) { write('speed', v) },

  // ---------- 均衡器 / 增益 / 声道平衡 ----------
  // 存的是九段 dB 数组，不是歌词之类的版权内容，可以落盘
  getEq() {
    const v = read('eq', [])
    return Array.isArray(v) ? v : []
  },
  setEq(v) { write('eq', v) },

  getGain() {
    const v = Number(read('gain', 0))
    return Number.isFinite(v) ? Math.max(-15, Math.min(15, v)) : 0
  },
  setGain(v) { write('gain', v) },

  getBalance() {
    const v = Number(read('balance', 0))
    return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0
  },
  setBalance(v) { write('balance', v) },

  // ---------- 音量均衡（F26）：学习式响度归一 ----------
  // 只存「开关」和「每首的 RMS 数字」，不存音频也不存歌词
  getNormEnabled() { return Boolean(read('normEnabled', false)) },
  setNormEnabled(v) { write('normEnabled', Boolean(v)) },

  getLoudnessMap() {
    const m = read('loudnessMap', {})
    return m && typeof m === 'object' ? m : {}
  },
  setLoudnessMap(m) { write('loudnessMap', m && typeof m === 'object' ? m : {}) },

  // ---------- 智能歌单 / 排序 ----------
  getSmartKind() {
    const k = read('smartKind', 'recently-added')
    return SMART_KINDS.includes(k) ? k : 'recently-added'
  },
  setSmartKind(k) { write('smartKind', k) },

  getSortKey() {
    const k = read('sortKey', 'title')
    return SORT_KEYS.includes(k) ? k : 'title'
  },
  setSortKey(k) { write('sortKey', k) },

  getSortDir() {
    const d = read('sortDir', 'asc')
    return d === 'desc' ? 'desc' : 'asc'
  },
  setSortDir(d) { write('sortDir', d) },

  // ---------- 搜索结果排序（client 端排，记住上次的选择） ----------
  getSearchSortKey() {
    const k = read('searchSortKey', 'default')
    return SEARCH_SORT_KEYS.includes(k) ? k : 'default'
  },
  setSearchSortKey(k) { write('searchSortKey', k) },

  getSearchSortDir() {
    const d = read('searchSortDir', 'desc')
    return d === 'asc' ? 'asc' : 'desc'
  },
  setSearchSortDir(d) { write('searchSortDir', d) },

  // ---------- 主题 ----------
  // light / dark / system（跟随系统）
  getTheme() {
    const t = read('theme', 'dark')
    return ['light', 'dark', 'system'].includes(t) ? t : 'dark'
  },
  setTheme(t) { write('theme', t) },

  // 默认强调色跟 base.css 的 :root 保持一致（网易云红）；
  // 写别的值会让第一次启动时先闪一下另一种颜色
  getAccent() { return read('accent', '#ec4141') },
  setAccent(c) { write('accent', c) },

  // ---------- 歌词偏移 ----------
  // 只存「偏移秒数」，按 bvid 记录；歌词文本一律不落盘
  // 保留到 0.1 秒：步进是 0.5 秒，但用户拖过之后可能有半格的残值
  getLyricOffset(bvid) {
    const v = read('lyricOffsets', {})[bvid]
    return Number.isFinite(v) ? Math.round(v * 10) / 10 : 0
  },
  setLyricOffset(bvid, sec) {
    const all = read('lyricOffsets', {})
    if (!bvid) return
    const rounded = Math.round(sec * 10) / 10
    if (!rounded) delete all[bvid]
    else all[bvid] = rounded
    write('lyricOffsets', all)
  },

  // ---------- 桌面歌词外观（F29） ----------
  // 桌面歌词窗和主窗同一个 origin，共用 localStorage，
  // 所以样式不用 IPC 就能互相看见；只有时序偏移要回推给主窗
  getDesktopLyricsStyle() {
    const def = DESKTOP_LYRICS_STYLE_DEFAULT
    const v = read('desktopLyricsStyle', {})
    if (!v || typeof v !== 'object') return { ...def }
    return {
      size: clampInt(v.size, def.size, 12, 48),
      color: typeof v.color === 'string' ? v.color : def.color,
      opacity: clampInt(v.opacity, def.opacity, 20, 100),
      outline: clampInt(v.outline, def.outline, 0, 6),
      lock: Boolean(v.lock),
    }
  },
  setDesktopLyricsStyle(patch) {
    const cur = this.getDesktopLyricsStyle()
    write('desktopLyricsStyle', { ...cur, ...patch })
  },

  // ---------- 播放模式：随机/顺序之外还有「是否开启无缝播放」 ----------
  getGapless() { return Boolean(read('gapless', true)) },
  setGapless(v) { write('gapless', Boolean(v)) },

  // 睡眠定时：只记上次选的分钟数，方便下次快速复用；运行中的定时不落盘
  getSleepMinutes() { return Number(read('sleepMinutes', 0)) || 0 },
  setSleepMinutes(v) { write('sleepMinutes', v) },
}
