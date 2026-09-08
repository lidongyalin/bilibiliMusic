import { prefs } from './prefs.js'
import { state } from './state.js'

/** 视图切换（搜索结果 / 我的收藏） */
export function switchView(view) {
  if (state.view === view) return
  state.view = view
  prefs.setView(view)
}
