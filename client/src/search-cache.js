/**
 * 搜索结果的本地分页缓存。纯函数，不碰 localStorage、不碰 DOM，
 * 所以能在 Node 里直接单测；localStorage 的读写在 prefs.js 里。
 *
 * 为什么要它：B 站对请求频率很敏感，翻页请求多了会被风控拦下（返回 code=0
 * 但 data 里只有 v_voucher）。页缓存让已经翻过的页不再请求，
 * 重新打开应用也立刻有结果，网络请求次数能压到最低。
 *
 * 结构：cache[keyword] = { keyword, pages: { '1': [song...], '2': [...] }, total, hasMore, updatedAt }
 * pages 的 key 用字符串是因为要进 JSON，读的时候再转回数字。
 */

/** 缓存总字节预算。超出就按 LRU 丢最早的关键词 */
export const CACHE_MAX_BYTES = 1.5 * 1024 * 1024
/** 最多记住几个关键词。B 站 numResults 上限 1000，页大小 50，单关键词最多 20 页 */
export const CACHE_MAX_KEYWORDS = 6
/** 单个关键词最多缓存的页数 */
export const CACHE_MAX_PAGES = 20

const keyOf = (keyword) => String(keyword || '').trim()

function byteSize(cache) {
  return new TextEncoder().encode(JSON.stringify(cache)).length
}

/**
 * 写入一页。就地修改传入的 cache 并返回它（调用方拿同一个对象去持久化）。
 *
 * @param data { list, hasMore, total } 后端 /api/search 的返回
 */
export function upsertPage(cache, keyword, page, data, now = Date.now()) {
  const kw = keyOf(keyword)
  if (!kw) return cache

  let entry = cache[kw]
  if (entry) {
    // 刷新 LRU 顺序：删掉再插，让它排在末尾
    delete cache[kw]
  } else {
    entry = { keyword: kw, pages: {}, total: 0, hasMore: false, updatedAt: 0 }
  }
  cache[kw] = entry

  entry.pages[String(page)] = Array.isArray(data && data.list) ? data.list : []
  entry.total = Number(data && data.total) || 0
  entry.hasMore = Boolean(data && data.hasMore)
  entry.updatedAt = now

  trimPages(entry)
  return evict(cache, kw)
}

/** 页数超上限时丢最早的页，保留最新的 */
function trimPages(entry) {
  const keys = Object.keys(entry.pages).sort((a, b) => Number(a) - Number(b))
  const drop = keys.length - CACHE_MAX_PAGES
  if (drop <= 0) return
  for (const k of keys.slice(0, drop)) delete entry.pages[k]
}

/** 超预算就丢最早写入的关键词，但别把刚写的那条挤掉 */
function evict(cache, keep) {
  let keys = Object.keys(cache)
  while (keys.length > 1 && (keys.length > CACHE_MAX_KEYWORDS || byteSize(cache) > CACHE_MAX_BYTES)) {
    const oldest = keys[0]
    if (oldest === keep) break
    delete cache[oldest]
    keys = Object.keys(cache)
  }
  return cache
}

/** 按页码升序返回 [{ page, list }]，直接拼起来就是完整的本地列表 */
export function getPages(cache, keyword) {
  const entry = cache && cache[keyOf(keyword)]
  if (!entry || !entry.pages) return []
  return Object.keys(entry.pages)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => ({ page: Number(k), list: entry.pages[k] }))
}

/** 这一页有没有缓存 */
export function isPageCached(cache, keyword, page) {
  const entry = cache && cache[keyOf(keyword)]
  return Boolean(entry && entry.pages && entry.pages[String(page)])
}

/**
 * 缓存里的元信息：拿到就能不请求网络直接恢复列表状态。
 * 没有任何页时返回 null。
 */
export function getMeta(cache, keyword) {
  const entry = cache && cache[keyOf(keyword)]
  const keys = entry && entry.pages ? Object.keys(entry.pages) : []
  if (!keys.length) return null
  return {
    total: entry.total,
    hasMore: Boolean(entry.hasMore),
    highestPage: Math.max(...keys.map(Number)),
    count: keys.reduce((n, k) => n + (entry.pages[k] || []).length, 0),
  }
}

/** 清空某个关键词的缓存（重新搜索时） */
export function dropKeyword(cache, keyword) {
  if (!cache) return cache
  delete cache[keyOf(keyword)]
  return cache
}

export { byteSize }
