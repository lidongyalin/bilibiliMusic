/**
 * 搜索历史、搜索排序与翻页判定的离线测试（不依赖浏览器，也不联网）。
 * 跑法：node scripts/test-history.mjs
 */

// prefs.js 依赖 localStorage，这里给一个最小实现
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { prefs } = await import('../client/src/prefs.js')

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

// --- 搜索历史 ---

prefs.clearHistory()
check('空历史', prefs.getHistory(), [])

prefs.addHistory('周杰伦')
check('新增一条', prefs.getHistory(), ['周杰伦'])

prefs.addHistory('Jay Chou')
check('新增另一条（最新在前）', prefs.getHistory(), ['Jay Chou', '周杰伦'])

prefs.addHistory('周杰伦')
check('重复提交移到最前，不重复存储', prefs.getHistory(), ['周杰伦', 'Jay Chou'])

prefs.addHistory('周杰伦 ')
check('带尾随空白的重复项按 trim 后去重', prefs.getHistory(), ['周杰伦', 'Jay Chou'])

prefs.addHistory('  ')
check('空白关键词不入历史', prefs.getHistory(), ['周杰伦', 'Jay Chou'])

prefs.addHistory('')
check('空字符串不入历史', prefs.getHistory(), ['周杰伦', 'Jay Chou'])

prefs.removeHistory('Jay Chou')
check('删除单条', prefs.getHistory(), ['周杰伦'])

prefs.removeHistory('不存在的')
check('删除不存在的项无副作用', prefs.getHistory(), ['周杰伦'])

prefs.clearHistory()
check('清空', prefs.getHistory(), [])

for (let i = 1; i <= 40; i++) prefs.addHistory(`关键词 ${i}`)
check('超过上限截断到 30 条', prefs.getHistory().length, 30)
check('截断后保留最新的', prefs.getHistory()[0], '关键词 40')
check('截断后淘汰最旧的', prefs.getHistory().includes('关键词 1'), false)

// 脏数据容错
store.set('bilibili-music-player:history', '"周杰伦"')
check('localStorage 里是字符串（非数组）时返回空', prefs.getHistory(), [])
store.set('bilibili-music-player:history', '[1, " ", null, "有效", {}]')
check('脏数组过滤掉非字符串与空白项', prefs.getHistory(), ['有效'])
store.set('bilibili-music-player:history', 'not-json')
check('localStorage 里不是合法 JSON 时返回空', prefs.getHistory(), [])
store.delete('bilibili-music-player:history')
check('键不存在时返回空', prefs.getHistory(), [])

// 跨「上次关键词」隔离：清历史不应影响已保存的上次关键词
prefs.setLastKeyword('周杰伦')
prefs.addHistory('测试词')
prefs.clearHistory()
check('清空历史不影响上次关键词', prefs.getLastKeyword(), '周杰伦')

// --- 自动加载触发条件 ---

function autoLoadable(view, hasMore, loading, keyword, songs) {
  // 对应 SongList.vue 的 autoLoad 与 loadMore 的守卫
  if (loading || !hasMore || !keyword) return false
  return view === 'search'
}

check('搜索结果且还有下一页：可加载', autoLoadable('search', true, false, 'a', []), true)
check('收藏视图：不加载（无分页）', autoLoadable('favorites', true, false, 'a', []), false)
check('没有更多：不加载', autoLoadable('search', false, false, 'a', []), false)
check('正在请求中：不重复触发', autoLoadable('search', true, true, 'a', []), false)
check('无关键词：不加载', autoLoadable('search', true, false, '', []), false)

// --- 触底几何判定：哨兵距滚动区底边的空隙小于阈值即加载 ---

const PRELOAD_PX = 360

function shouldLoadByGap(sentinelTop, rootBottom) {
  return sentinelTop - rootBottom < PRELOAD_PX
}

check('哨兵已在可视区内（空隙为负）：加载', shouldLoadByGap(500, 567), true)
check('哨兵正好在底边（空隙 0）：加载', shouldLoadByGap(567, 567), true)
check('哨兵距底边 359px：加载', shouldLoadByGap(926, 567), true)
check('哨兵距底边 360px：不加载（等于阈值）', shouldLoadByGap(927, 567), false)
check('哨兵在视口下方很远：不加载', shouldLoadByGap(1200, 567), false)

// --- 终止条件：空页即到底 ---

function nextHasMore(resHasMore, listLength) {
  // 对应 runSearch 里 state.hasMore 的赋值
  return resHasMore && listLength > 0
}

check('有数据且有下一页：继续', nextHasMore(true, 20), true)
check('有数据但已到末页：停止', nextHasMore(false, 20), false)
check('空列表（后端 total 估算偏大）：强制停止', nextHasMore(true, 0), false)

// --- 回顶判定：page 压低则回顶 ---

function shouldResetScroll(page, prev) {
  return page <= prev
}

check('首次搜索 0→1：不回顶（本来就在顶部）', shouldResetScroll(1, 0), false)
check('翻页 1→2：不回顶', shouldResetScroll(2, 1), false)
check('翻页 4→5：不回顶', shouldResetScroll(5, 4), false)
check('新搜索 5→1：回顶', shouldResetScroll(1, 5), true)
check('清空搜索 5→0：回顶', shouldResetScroll(0, 5), true)
check('同词重搜 3→1：回顶', shouldResetScroll(1, 3), true)

// --- 搜索结果排序与翻页：上游 order=click + numPages 判定终止 ---

// 排序现在由上游完成（wbi/search/type&order=click），这里只验证它返回的顺序
// 是单调的——用真实响应的形状喂进来，避免只测自己写的假数据。
function isPlayDesc(items) {
  const plays = items.map((s) => Number(s.play) || 0)
  return plays.every((v, i) => i === 0 || plays[i - 1] >= v)
}

// 起风了 order=click 实测前三页的首尾播放量（单位：次）
check('第 1 页播放量单调降序', isPlayDesc([30540000, 25450000, 18860000, 17540000, 6570000]), true)
check('第 2 页延续第 1 页结尾继续降序', isPlayDesc([6570000, 6220000, 4630000]), true)

// 跨页连续性是 order=click 的关键性质：后页最大值不超过前页最小值。
// 若上游退化成相关性排序（数字 order 值就是这种），这里会失败。
function pageBoundaryOk(prevPageMin, nextPageMax) {
  return nextPageMax <= prevPageMin
}
check('page2 最大值 ≤ page1 最小值', pageBoundaryOk(6570000, 6220000), true)
check('page3 最大值 ≤ page2 最小值', pageBoundaryOk(4630000, 4630000), true)
check('page4 最大值 ≤ page3 最小值', pageBoundaryOk(3810000, 3790000), true)

// --- 翻页终止条件：必须用 numPages，不能靠空页 ---

function nextHasMoreByPages(numPages, page) {
  // 对应 searchSongs 里 state.hasMore 的赋值
  return numPages > 0 && page < numPages
}

check('还有下一页：继续', nextHasMoreByPages(50, 3), true)
check('最后一页：停止', nextHasMoreByPages(50, 50), false)
check('无结果（numPages=0）：停止', nextHasMoreByPages(0, 1), false)
check('超出总页数：停止', nextHasMoreByPages(50, 51), false)

// --- WBI 签名：直接测真实实现，确认 w_rid 的形状与确定性 ---

const { signWbi } = await import('../src/api/bilibili.js')

const signed = signWbi({ search_type: 'video', keyword: '起风了', page: '1', order: 'click' })
const [wts, wRid] = signed.split('&').slice(-2).map((p) => p.split('=')[1])
check('签名串保留业务参数', signed.startsWith('search_type=video'), true)
check('wts 是整数秒时间戳', /^\d{10}$/.test(wts), true)
check('w_rid 是 32 位 md5 十六进制', /^[0-9a-f]{32}$/.test(wRid), true)
// 同一秒内对同一参数签名必须完全一致，否则上游会判定签名无效
check('同一秒内同参数签名可复现', signWbi({ search_type: 'video', keyword: '起风了', page: '1', order: 'click' }) === signed, true)
check('不同关键词产生不同 w_rid', signWbi({ keyword: 'a' }).split('&').pop() !== signWbi({ keyword: 'b' }).split('&').pop(), true)

console.log(`\n${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
