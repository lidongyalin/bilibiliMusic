import { ElMessage } from 'element-plus'
import { api } from './api.js'
import { prefs } from './prefs.js'
import { state } from './state.js'
import { switchView } from './navigation.js'
import { clip } from './utils.js'

/**
 * 歌单逻辑。和 favorites.js 同构：接口调用 + 乐观更新 + 失败回滚。
 *
 * 侧栏展示的是摘要（名字 + 曲数），详情（含曲目）只在点开某个歌单时才拉，
 * 避免歌单多了以后每次切换都拉一串完整曲目。
 */

export async function refreshPlaylists() {
  state.playlistLoading = true
  try {
    const { list } = await api.listPlaylists()
    state.playlists = list
    // 上次打开的歌单可能已被删除：无效 id 直接退回搜索结果，别停在空详情页
    if (state.view === 'playlist' && !list.some((p) => p.id === state.currentPlaylistId)) {
      state.currentPlaylistId = ''
      prefs.setLastPlaylist('')
      switchView('search')
    }
  } catch (err) {
    ElMessage.error(err.message)
  } finally {
    state.playlistLoading = false
  }
}

/** 打开某个歌单的详情 */
export async function openPlaylist(id) {
  if (!id) return
  state.view = 'playlist'
  prefs.setView('playlist')
  state.currentPlaylistId = id
  prefs.setLastPlaylist(id)
  state.currentPlaylist = null
  state.playlistDetailLoading = true
  state.selectMode = false
  state.selection = new Set()
  try {
    const { playlist } = await api.getPlaylist(id)
    // 拉完又切走了，这份结果不要了
    if (state.currentPlaylistId !== id) return
    state.currentPlaylist = playlist
    await refreshPlaylists()
  } catch (err) {
    ElMessage.error(err.message)
  } finally {
    if (state.currentPlaylistId === id) state.playlistDetailLoading = false
  }
}

export async function createPlaylist(name = '') {
  try {
    const { playlist } = await api.createPlaylist(name)
    await refreshPlaylists()
    ElMessage.success(`已创建「${clip(playlist.name)}」`)
    return playlist
  } catch (err) {
    ElMessage.error(err.message)
    return null
  }
}

export async function renamePlaylist(id, name) {
  try {
    const { playlist } = await api.renamePlaylist(id, name)
    state.playlists = state.playlists.map((p) => (p.id === id ? { ...p, name: playlist.name } : p))
    if (state.currentPlaylist?.id === id) state.currentPlaylist = { ...state.currentPlaylist, name: playlist.name }
    ElMessage.success('已重命名')
    return true
  } catch (err) {
    ElMessage.error(err.message)
    return false
  }
}

export async function deletePlaylist(id) {
  const name = state.playlists.find((p) => p.id === id)?.name
  try {
    await api.deletePlaylist(id)
    state.playlists = state.playlists.filter((p) => p.id !== id)
    if (state.currentPlaylist?.id === id) {
      state.currentPlaylist = null
      state.currentPlaylistId = ''
      prefs.setLastPlaylist('')
      switchView('search')
    }
    ElMessage.success(name ? `已删除「${clip(name)}」` : '已删除歌单')
    return true
  } catch (err) {
    ElMessage.error(err.message)
    return false
  }
}

/** 批量加歌。成功返回实际新增数，重复的跳过 */
export async function addSongsToPlaylist(id, songs) {
  if (!id || !songs?.length) return false
  try {
    const { added, skipped, playlist } = await api.addSongsToPlaylist(id, songs)
    await refreshPlaylists()
    if (state.currentPlaylist?.id === id) state.currentPlaylist = playlist
    const msg = []
    if (added) msg.push(`新增 ${added} 首`)
    if (skipped) msg.push(`跳过 ${skipped} 首重复`)
    ElMessage.success(`已加入「${clip(playlist.name)}」${msg.length ? '（' + msg.join('，') + '）' : ''}`)
    return true
  } catch (err) {
    ElMessage.error(err.message)
    return false
  }
}

export async function removeSongFromPlaylist(id, bvid) {
  try {
    const { playlist } = await api.removeSongFromPlaylist(id, bvid)
    await refreshPlaylists()
    if (state.currentPlaylist?.id === id) state.currentPlaylist = playlist
    return true
  } catch (err) {
    ElMessage.error(err.message)
    return false
  }
}

export async function reorderPlaylistSongs(id, ordered) {
  try {
    const { playlist } = await api.reorderPlaylistSongs(id, ordered)
    if (state.currentPlaylist?.id === id) state.currentPlaylist = playlist
    return true
  } catch (err) {
    ElMessage.error(err.message)
    return false
  }
}

// ---------- 多选 ----------

export function enterSelectMode() {
  state.selectMode = true
  state.selection = new Set()
}

export function exitSelectMode() {
  state.selectMode = false
  state.selection = new Set()
}

export function toggleSelect(bvid) {
  const next = new Set(state.selection)
  if (next.has(bvid)) next.delete(bvid)
  else next.add(bvid)
  state.selection = next
}

export function selectAll(list) {
  state.selection = new Set(list.map((s) => s.bvid))
}

export function clearSelection() {
  state.selection = new Set()
}

export function isSelected(bvid) {
  return state.selection.has(bvid)
}

/** 当前视图的曲目集合，作为播放队列的上下文 */
export function contextOfView(view = state.view) {
  if (view === 'favorites') return state.favorites
  if (view === 'playlist') return state.currentPlaylist?.songs || []
  return state.songs
}
