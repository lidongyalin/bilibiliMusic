import { ElMessage } from 'element-plus'
import { api } from './api.js'
import { prefs } from './prefs.js'
import { state } from './state.js'

/**
 * 歌词加载。按当前播放的曲名向后端取，后端会用网易云公开接口匹配最接近的一首。
 *
 * 歌词只在内存里（state.lyrics），不写 localStorage、不写文件——它是版权内容，
 * 本应用只供个人本地播放。
 *
 * 切歌很快时请求会乱序回来，所以用自增序号丢弃过期响应。
 */
let seq = 0

export function clearLyrics() {
  state.lyrics = []
  state.lyricMatch = null
  state.lyricStatus = 'idle'
}

export async function loadLyrics(song) {
  seq += 1
  const mine = seq

  clearLyrics()
  if (!song || !song.title) return

  state.lyricStatus = 'loading'
  try {
    const res = await api.lyrics(song.title, song.author || '', song.durationSec || 0)
    if (mine !== seq) return // 期间又切了歌，这份结果不要了
    const lines = Array.isArray(res.lines) ? res.lines : []
    state.lyrics = lines
    state.lyricMatch = lines.length && res.match ? res.match : null
    state.lyricStatus = lines.length ? 'ok' : 'empty'
  } catch {
    if (mine !== seq) return
    // 后端对「查不到」返回的是正常响应，走到这里一般是网络或服务器问题
    state.lyrics = []
    state.lyricStatus = 'empty'
  }
}

/** 面板开关。只持久化「是否打开」这个布尔值 */
export function setLyricOpen(open) {
  state.lyricOpen = Boolean(open)
  prefs.setLyricOpen(state.lyricOpen)
}

export function toggleLyricPanel() {
  // 没选歌时打开只会看到空面板，不如直接说清楚
  if (!state.lyricOpen && !state.current) {
    ElMessage.info('先选一首歌')
    return
  }
  setLyricOpen(!state.lyricOpen)
}
