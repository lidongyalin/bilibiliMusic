import { ElMessage } from 'element-plus'
import { api } from './api.js'
import { prefs } from './prefs.js'
import { dropKeyword, getMeta, getPages, isPageCached, upsertPage } from './search-cache.js'
import { state } from './state.js'

/**
 * 搜索与本地分页
 *
 * 每一页都写进 localStorage（search-cache.js 负责结构与容量控制），
 * 所以已经翻过的页不会再请求。B 站对请求频率很敏感，请求越多越容易被风控拦下。
 * 重新打开应用时先用 restoreSearch 从缓存恢复，不碰网络。
 */
let cache = prefs.getSearchCache()

function persist() {
  prefs.setSearchCache(cache)
}

/**
 * 从本地缓存恢复上次搜到的结果，不发任何请求。
 * @returns {boolean} 恢复成功返回 true；没有可用缓存返回 false（调用方按需走网络）
 */
export function restoreSearch(keyword) {
  const kw = String(keyword || '').trim()
  const meta = kw ? getMeta(cache, kw) : null
  if (!meta || !meta.count) return false

  state.keyword = kw
  state.songs = []
  for (const { list } of getPages(cache, kw)) state.songs.push(...list)
  state.page = meta.highestPage
  state.total = meta.total
  state.hasMore = meta.hasMore
  return true
}

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

  if (!append) {
    state.songs = []
    state.page = 0
    // 重新搜同一个关键词时旧缓存作废，别拿上次的结果冒充这次
    dropKeyword(cache, kw)
    persist()
  }

  // 这一页已经在本地（启动时恢复过），不用再去请求
  if (append && isPageCached(cache, kw, page)) return

  state.loading = true
  try {
    const res = await api.search(kw, page)
    state.keyword = res.keyword
    prefs.setLastKeyword(res.keyword)
    if (commit) prefs.addHistory(res.keyword)
    state.songs.push(...res.list)
    state.page = res.page
    state.total = res.total
    // 后端的 hasMore 是按 numPages 判定的，但本页可能因时长上限过滤而一条不剩；
    // 空页即视为到底，否则触底自动加载会连环请求同样的空页。
    state.hasMore = res.hasMore && res.list.length > 0
    upsertPage(cache, res.keyword, res.page, res)
    persist()
    if (!append && res.list.length === 0) {
      ElMessage.warning('没有找到相关歌曲，换个关键词试试')
    }
  } catch (err) {
    // 风控拦截或网络错误：不清空已有列表、不重置 hasMore，继续往下滚就能重试
    ElMessage.error(err.message)
  } finally {
    state.loading = false
  }
}

export function loadMore() {
  if (state.loading || !state.hasMore || !state.keyword) return
  runSearch(state.keyword, { page: state.page + 1, append: true })
}
