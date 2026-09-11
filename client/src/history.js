import { ElMessage } from 'element-plus'
import { api } from './api.js'
import { prefs } from './prefs.js'
import { state } from './state.js'
import { switchView } from './views.js'

/**
 * 播放历史（F13）与智能歌单（F11）。
 *
 * 智能歌单不存副本，全部由后端从「曲库导入时间 / 播放次数 / 最近播放时间」
 * 实时算出来。切 kind 只是换一个查询条件。
 *
 * 播放记录本身只含元数据快照（标题、歌手、封面地址、时长），不含任何内容。
 */

export const SMART_KINDS = [
  { key: 'recently-added', label: '最近添加', desc: '按导入曲库的时间' },
  { key: 'most-played', label: '最常播放', desc: '按累计播放次数' },
  { key: 'recently-played', label: '最近播放', desc: '按最近一次播放' },
]

export function smartKindLabel(kind) {
  return (SMART_KINDS.find((k) => k.key === kind) || {}).label || '智能歌单'
}

/** 打开某个智能歌单 */
export async function openSmart(kind) {
  if (!SMART_KINDS.some((k) => k.key === kind)) kind = 'recently-added'
  state.smartKind = kind
  prefs.setSmartKind(kind)
  switchView('smart')
  state.smartLoading = true
  state.selectMode = false
  state.selection = new Set()
  try {
    const res = await api.smartSongs(kind)
    // 期间又切了 kind，这份结果不要了
    if (state.smartKind !== kind) return
    state.smartSongs = Array.isArray(res.songs) ? res.songs : []
  } catch (err) {
    ElMessage.error(err.message)
    state.smartSongs = []
  } finally {
    if (state.smartKind === kind) state.smartLoading = false
  }
}

// ---------- 播放历史 ----------

export async function openHistory() {
  switchView('history')
  state.historyLoading = true
  state.selectMode = false
  state.selection = new Set()
  try {
    const res = await api.listHistory()
    state.historySongs = Array.isArray(res.list) ? res.list : []
  } catch (err) {
    ElMessage.error(err.message)
    state.historySongs = []
  } finally {
    state.historyLoading = false
  }
}

export async function deleteHistoryItem(id) {
  try {
    await api.deleteHistory(id)
    state.historySongs = state.historySongs.filter((s) => s.bvid !== id && s.id !== id)
    return true
  } catch (err) {
    ElMessage.error(err.message)
    return false
  }
}

export async function clearHistory() {
  const confirmed = window.confirm('清空全部播放历史？\n「最常播放」「最近播放」两个智能歌单会跟着变空。')
  if (!confirmed) return false
  try {
    await api.clearHistory()
    state.historySongs = []
    ElMessage.success('已清空播放历史')
    return true
  } catch (err) {
    ElMessage.error(err.message)
    return false
  }
}
