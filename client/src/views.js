import { state } from './state.js'
import { prefs } from './prefs.js'

/**
 * 视图相关的纯函数：当前视图是哪一种、它的数据列表是什么。
 *
 * 单独一个模块，避免 playlists.js / library.js / history.js 互相 import
 * 才为了拿到「当前列表」——那会变成一圈循环依赖。
 */

const LIST_VIEWS = ['search', 'favorites', 'playlist', 'library', 'smart', 'history', 'group']

/** 当前视图名。group 视图是「曲库下钻」，数据在 libraryGroupSongs 里 */
export function currentView() {
  return state.libraryDrill ? 'group' : state.view
}

/** 当前视图对应的曲目列表 */
export function currentList() {
  const v = currentView()
  if (v === 'favorites') return state.favorites
  if (v === 'playlist') return state.currentPlaylist?.songs || []
  if (v === 'library') return state.library
  if (v === 'group') return state.libraryGroupSongs
  if (v === 'smart') return state.smartSongs
  if (v === 'history') return state.historySongs
  return state.songs
}

/** 当前列表所属视图是否允许批量操作（本地曲库的歌有自己的一套） */
export function isLocalView() {
  return ['library', 'group'].includes(currentView())
}

/** 当前列表的标题 */
export function viewTitle() {
  const v = currentView()
  if (v === 'favorites') return '我的收藏'
  if (v === 'playlist') return state.currentPlaylist?.name || '歌单'
  if (v === 'group') {
    const d = state.libraryDrill
    if (d) return `${groupTypeName(d.type)}：${d.value}`
    return '曲库'
  }
  if (v === 'library') return '本地曲库'
  if (v === 'smart') return smartKindName(state.smartKind)
  if (v === 'history') return '播放历史'
  return state.keyword ? `「${state.keyword}」的搜索结果` : '输入关键词开始搜索'
}

/** 分组类型名，跟后端 type 对齐 */
export function groupTypeName(type) {
  return { artist: '歌手', album: '专辑', folder: '文件夹', year: '年份', genre: '流派' }[type] || '分组'
}

/** 智能歌单名 */
export function smartKindName(kind) {
  return {
    'recently-added': '最近添加',
    'most-played': '最常播放',
    'recently-played': '最近播放',
  }[kind] || '智能歌单'
}

/** 视图切换 */
export function switchView(view) {
  if (currentView() === view) return
  state.view = view
  prefs.setView(view)
  state.libraryDrill = null
  // 离开列表视图时清空多选：选中的 bvid 属于那个视图，切回来再显示就错了
  if (!LIST_VIEWS.includes(view)) {
    state.selectMode = false
    state.selection = new Set()
  }
}
