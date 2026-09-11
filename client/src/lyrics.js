import { ElMessage } from 'element-plus'
import { api } from './api.js'
import { parseLrcText } from './lyric-lines.js'
import { prefs } from './prefs.js'
import { state } from './state.js'

/**
 * 歌词加载。
 *
 * 本地歌曲优先读同目录的 .lrc——用户自己带的时间戳比在线匹配准得多，
 * 也没有歌词版权争议（文件本来就是用户自己的）。找不到才退回在线匹配。
 *
 * 歌词只在内存里（state.lyrics），不写 localStorage、不写文件——它是版权内容，
 * 本应用只供个人本地播放。偏移量是用户校准出的数字，按 bvid 持久化。
 *
 * 切歌很快时请求会乱序回来，所以用自增序号丢弃过期响应。
 */
let seq = 0

export function clearLyrics() {
  state.lyrics = []
  state.lyricMatch = null
  state.lyricStatus = 'idle'
}

function isLocalSong(song) {
  return typeof song?.bvid === 'string' && song.bvid.startsWith('local-')
}

/** 切换歌曲时把该歌的校准偏移取出来；没有校准过就是 0 */
export function loadOffsetFor(song) {
  state.lyricOffset = song && song.bvid ? prefs.getLyricOffset(song.bvid) : 0
  return state.lyricOffset
}

export async function loadLyrics(song) {
  seq += 1
  const mine = seq

  clearLyrics()
  loadOffsetFor(song)
  if (!song || !song.title) return

  state.lyricStatus = 'loading'
  try {
    if (isLocalSong(song)) {
      // 没带 .lrc 时后端返回 { found: false }，继续走在线匹配
      try {
        const lrc = await api.localLrc(song.bvid)
        if (mine !== seq) return
        const lines = parseLrcText(lrc && lrc.text)
        if (lines.length) {
          state.lyrics = lines
          state.lyricMatch = { source: '本地文件', name: lrc.file || '', local: true }
          state.lyricStatus = 'ok'
          return
        }
      } catch {
        if (mine !== seq) return
      }
    }

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
