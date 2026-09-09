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

const MODES = ['list', 'single', 'shuffle']

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
}
