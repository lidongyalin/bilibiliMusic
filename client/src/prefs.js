/**
 * 本地偏好持久化：播放模式、音量、上次关键词、视图，以及每首歌的播放位置。
 * 位置按 bvid 记录，回到同一首歌时自动续播。
 */

const NS = 'bilibili-music-player:'

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

  getLastKeyword() { return read('keyword', '') },
  setLastKeyword(k) { write('keyword', k) },

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
