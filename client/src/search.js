import { ElMessage } from 'element-plus'
import { api } from './api.js'
import { prefs } from './prefs.js'
import { state } from './state.js'

/** 搜索与分页 */

/**
 * 执行搜索。
 * @param {boolean} opts.append 追加到已有结果（翻页用）
 * @param {boolean} opts.commit 写入搜索历史。只由「回车提交 / 点选历史项」这类明确动作传 true，
 *   输入过程中的防抖搜索不传——否则打一个字存一条。
 */
export async function runSearch(keyword, { page = 1, append = false, commit = false } = {}) {
  const kw = String(keyword || '').trim()

  if (!kw) {
    state.keyword = ''
    state.songs = []
    state.page = 0
    state.hasMore = false
    state.total = 0
    return
  }

  state.loading = true
  try {
    const res = await api.search(kw, page)
    state.keyword = res.keyword
    prefs.setLastKeyword(res.keyword)
    if (commit) prefs.addHistory(res.keyword)
    if (!append) {
      state.songs = []
      state.page = 0
    }
    state.songs.push(...res.list)
    state.page = res.page
    // hasMore 由后端的 numPages 判定，但本页可能因时长上限过滤而一条不剩；
    // 空页即视为到底，否则触底自动加载会连环请求同样的空页。
    state.hasMore = res.hasMore && res.list.length > 0
    state.total = res.total
    if (!append && res.list.length === 0) {
      ElMessage.warning('没有找到相关歌曲，换个关键词试试')
    }
  } catch (err) {
    ElMessage.error(err.message)
  } finally {
    state.loading = false
  }
}

export function loadMore() {
  if (state.loading || !state.hasMore || !state.keyword) return
  runSearch(state.keyword, { page: state.page + 1, append: true })
}
