/**
 * 本地搜索页缓存的单测（纯逻辑，不依赖 localStorage / DOM）。
 * 跑法：node scripts/test-search-cache.mjs
 */
import {
  upsertPage,
  getPages,
  getMeta,
  isPageCached,
  dropKeyword,
  byteSize,
  CACHE_MAX_PAGES,
  CACHE_MAX_KEYWORDS,
  CACHE_MAX_BYTES,
} from '../client/src/search-cache.js'

let pass = 0
let fail = 0

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}\n       期望 ${e}\n       实际 ${a}`)
  }
}

function ok(name, cond, actual) {
  if (cond) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}\n       实际 ${JSON.stringify(actual)}`)
  }
}

const NOW = 1_700_000_000_000
const song = (i) => ({ id: `BV${i}`, title: `第 ${i} 首`, author: 'UP', duration: '3:00', durationSec: 180 })
const page = (from, n = 3, hasMore = true) => ({
  list: Array.from({ length: n }, (_, k) => song(from + k)),
  hasMore,
  total: 1000,
})

// --- 写入与读取 ---

let c = {}
upsertPage(c, '晴天', 1, page(1), NOW)
check('写入一页后能读回', getPages(c, '晴天').map((p) => p.page), [1])
check('页内的条目原样保留', getPages(c, '晴天')[0].list.length, 3)
check('命中缓存的页', isPageCached(c, '晴天', 1), true)
check('没缓存的页', isPageCached(c, '晴天', 2), false)
check('空缓存不命中', isPageCached({}, '晴天', 1), false)

// --- 多页按页码升序（故意乱序写入） ---

c = {}
upsertPage(c, '晴天', 3, page(11), NOW)
upsertPage(c, '晴天', 1, page(1), NOW)
upsertPage(c, '晴天', 2, page(7), NOW)
check('多页按页码升序返回（忽略写入顺序）', getPages(c, '晴天').map((p) => p.page), [1, 2, 3])
check('各页内容对应正确', getPages(c, '晴天').map((p) => p.list[0].title), ['第 1 首', '第 7 首', '第 11 首'])

// --- 元信息 ---

check('元信息', getMeta(c, '晴天'), { total: 1000, hasMore: true, highestPage: 3, count: 9 })
check('没有缓存时元信息为 null', getMeta(c, '不存在的关键词'), null)
check('空对象不是有效缓存', getMeta({}, '晴天'), null)
check('最后一页 hasMore=false 会带出来', (() => {
  const m = getMeta(c, '晴天')
  upsertPage(c, '晴天', 4, page(15, 2, false), NOW)
  return getMeta(c, '晴天').hasMore
})(), false)
check('最后一页 hasMore=false 时 total 也更新', getMeta(c, '晴天').highestPage, 4)

// --- 重复写同一页：覆盖而不是叠加 ---

c = {}
upsertPage(c, '晴天', 1, page(1, 3), NOW)
upsertPage(c, '晴天', 1, page(100, 3), NOW)
check('重复写同一页覆盖旧内容', getPages(c, '晴天')[0].list[0].title, '第 100 首')
check('重复写不会增加页数', getPages(c, '晴天').length, 1)

// --- 页数上限 ---

c = {}
for (let p = 1; p <= CACHE_MAX_PAGES + 5; p++) upsertPage(c, '晴天', p, page(p * 10, 1), NOW + p)
const pages = getPages(c, '晴天').map((p) => p.page)
check('页数超过上限被裁到上限', pages.length, CACHE_MAX_PAGES)
check('裁掉的是最早的页', pages[0], 6)
check('保留的是最新的页', pages[pages.length - 1], CACHE_MAX_PAGES + 5)
check('裁页后 highestPage 正确', getMeta(c, '晴天').highestPage, CACHE_MAX_PAGES + 5)

// --- 关键词数量上限（LRU） ---

c = {}
for (let i = 0; i < CACHE_MAX_KEYWORDS; i++) upsertPage(c, `词${i}`, 1, page(i, 1), NOW + i)
upsertPage(c, '新词', 1, page(99, 1), NOW + 100)
const keys = Object.keys(c)
check('关键词数量被裁到上限', keys.length, CACHE_MAX_KEYWORDS)
ok('最早写入的关键词被丢掉', !keys.includes('词0'), keys)
ok('最新写入的关键词保留', keys.includes('新词'), keys)
ok('刚访问过的关键词仍在', keys.includes(`词${CACHE_MAX_KEYWORDS - 1}`), keys)

// --- LRU 顺序：写过的关键词往后挪 ---

c = {}
upsertPage(c, 'A', 1, page(1, 1), NOW)
upsertPage(c, 'B', 1, page(1, 1), NOW)
upsertPage(c, 'A', 2, page(2, 1), NOW + 1) // A 重新写入
ok('重新写入会把关键词挪到末尾（LRU）', Object.keys(c)[1] === 'A', Object.keys(c))

// --- 字节预算 ---

// 中文一个字符 3 字节，一页塞 120 条 × 400 字 ≈ 150KB，几页就能顶到预算
const list = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i), title: '歌'.repeat(400) }))

c = {}
let p = 0
// 填到明确超过预算，否则刚过 0.9 倍就停下，加第二条时可能还没超预算、evict 不触发
while (byteSize(c) < CACHE_MAX_BYTES * 1.05 && p < CACHE_MAX_PAGES) {
  upsertPage(c, '大词', p + 1, { list: list(120), hasMore: true, total: 1000 }, NOW + p)
  p++
}
const before = Object.keys(c)
ok('单关键词可以填满到接近预算', byteSize(c) > CACHE_MAX_BYTES * 0.5, `${(byteSize(c) / 1024).toFixed(0)}KB`)

upsertPage(c, '第二个词', 1, page(1, 1), NOW + 1000)
const after = Object.keys(c)
ok('超预算时丢最早的关键词', !after.includes('大词'), after)
ok('刚写入的关键词不会被自己挤掉', after.includes('第二个词'), after)
ok('evict 后字节数在预算内或只剩一条', byteSize(c) <= CACHE_MAX_BYTES || after.length === 1, `${(byteSize(c) / 1024).toFixed(0)}KB`)

// --- 中文按 UTF-8 计字节，不是按字符数 ---

c = {}
upsertPage(c, '晴天', 1, { list: [{ title: '歌'.repeat(100) }], hasMore: false, total: 1 }, NOW)
ok('中文字节数大于字符数', byteSize(c) > JSON.stringify(c).length, { bytes: byteSize(c), chars: JSON.stringify(c).length })

// --- 容错 ---

c = {}
upsertPage(c, '晴天', 1, { list: '不是数组', hasMore: true, total: 'x' }, NOW)
check('list 不是数组按空处理', getPages(c, '晴天')[0].list, [])
check('total 不是数字按 0', getMeta(c, '晴天').total, 0)
check('空关键词不写入', (() => {
  const t = {}
  upsertPage(t, '   ', 1, page(1, 1), NOW)
  return Object.keys(t)
})(), [])
check('null 数据不崩', (() => {
  const t = {}
  upsertPage(t, '晴天', 1, null, NOW)
  return getPages(t, '晴天')[0].list
})(), [])

// --- dropKeyword ---

c = { 晴天: { keyword: '晴天', pages: { 1: [song(1)] }, total: 1, hasMore: false, updatedAt: NOW } }
dropKeyword(c, '晴天')
check('dropKeyword 清掉指定关键词', Object.keys(c), [])
check('dropKeyword 不影响其它关键词', (() => {
  const t = {}
  upsertPage(t, 'A', 1, page(1, 1), NOW)
  upsertPage(t, 'B', 1, page(2, 1), NOW)
  dropKeyword(t, 'A')
  return Object.keys(t)
})(), ['B'])

console.log(`\n${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
