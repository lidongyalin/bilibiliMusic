import { prefs } from './prefs.js'
import { state } from './state.js'

/** 视图切换（搜索结果 / 我的收藏 / 某个歌单） */
export function switchView(view) {
  if (state.view === view) return
  state.view = view
  prefs.setView(view)
  // 离开歌单时清空多选状态：选中的是那个歌单的 bvid，切回来再显示就错了
  if (view !== 'playlist') {
    state.selectMode = false
    state.selection = new Set()
  }
}
