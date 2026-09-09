/**
 * 搜索历史与自动加载判定的离线测试（不依赖浏览器，也不联网）。
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

console.log(`\n${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
