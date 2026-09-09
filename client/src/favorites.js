import { ElMessage } from 'element-plus'
import { api } from './api.js'
import { state } from './state.js'
import { clip } from './utils.js'

/** 收藏逻辑：星标点击做乐观更新，失败则回滚并提示。 */

export async function refreshFavorites() {
  state.favLoading = true
  try {
    const { list } = await api.listFavorites()
    state.favorites = list
    state.favoriteIds = new Set(list.map((s) => s.bvid))
    state.favoriteCount = list.length
  } catch (err) {
    ElMessage.error(err.message)
  } finally {
    state.favLoading = false
  }
}

/** 星标点击入口。song 来自搜索结果或收藏列表 */
export async function toggleFavorite(song) {
  if (!song?.bvid) return
  const isFaved = state.favoriteIds.has(song.bvid)

  // 乐观更新：先改界面，再等接口
  const optimistic = new Set(state.favoriteIds)
  if (isFaved) {
    optimistic.delete(song.bvid)
    state.favorites = state.favorites.filter((s) => s.bvid !== song.bvid)
  } else {
    optimistic.add(song.bvid)
  }
  state.favoriteIds = optimistic
  state.favoriteCount = optimistic.size

  try {
    if (isFaved) {
      await api.removeFavorite(song.bvid)
      ElMessage.success(`已取消收藏「${clip(song.title)}」`)
    } else {
      const { song: created } = await api.addFavorite(song)
      // 以后端返回为准，补上 favoriteAt 等字段
      state.favorites = [created, ...state.favorites.filter((s) => s.bvid !== created.bvid)]
      state.favoriteIds = new Set(state.favorites.map((s) => s.bvid))
      state.favoriteCount = state.favorites.length
      ElMessage.success(`已收藏「${clip(song.title)}」`)
    }
  } catch (err) {
    await refreshFavorites() // 回滚乐观更新
    ElMessage.error(err.message)
  }
}

/** 当前曲目是否已收藏 */
export function isCurrentFaved() {
  return Boolean(state.current && state.favoriteIds.has(state.current.bvid))
}
