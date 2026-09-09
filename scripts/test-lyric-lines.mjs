/**
 * 前端歌词行定位逻辑的离线单测（不联网、不依赖 DOM 或 Vue）。
 * 跑法：node scripts/test-lyric-lines.mjs
 *
 * 这几行逻辑原本写在 LyricPanel.vue 里，掺着模板和响应式，没法脱离浏览器验证，
 * 所以抽成 client/src/lyric-lines.js 的纯函数——测它等于测面板的高亮与自动滚动决策。
 */
import { currentLineIndex, isLineVisible, scrollToCenter } from '../client/src/lyric-lines.js'

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

const L = (times) => times.map((t) => ({ time: t, text: String(t) }))
const LINES = L([30.5, 34.2, 37.8, 41.0, 45.5, 120.0])

// --- 当前行定位 ---

check('没有歌词返回 -1', currentLineIndex([], 60), -1)
check('歌词不是数组时按空处理', currentLineIndex(undefined, 60), -1)
check('前奏（还没唱到第一句）先亮第一句', currentLineIndex(LINES, 0), 0)
check('刚好唱到第一句', currentLineIndex(LINES, 30.5), 0)
check('两句之间高亮前一句', currentLineIndex(LINES, 35), 1)
check('刚好等于时间戳算这一句', currentLineIndex(LINES, 34.2), 1)
check('时间戳刚过时仍高亮该句', currentLineIndex(LINES, 34.19), 1)
check('到下一句时已经切过去', currentLineIndex(LINES, 37.8), 2)
check('超过最后一句仍高亮最后一句', currentLineIndex(LINES, 999), 5)
check('进度为负时按 0 处理', currentLineIndex(LINES, -5), 0)
check('进度非数字时不报错', currentLineIndex(LINES, Number.NaN), 0)
check('重复时间戳都算命中', currentLineIndex(L([10, 10, 10]), 10), 2)
check('单行歌词永远高亮它', currentLineIndex(L([500]), 3), 0)
check(
  'lookahead：时间戳比音频晚一点时能对上（关掉就亮到上一句）',
  currentLineIndex(LINES, 34.0, 0) === 0 && currentLineIndex(LINES, 34.0) === 1,
  true
)

// --- 是否在可视范围 ---
// 视野是 scrollTop=60、高 500，即纵向 [60, 560]

ok('完全在视野内可见', isLineVisible(100, 40, 60, 500), { top: 100, h: 40, st: 60, vh: 500 })
ok('在视野上方不可见', !isLineVisible(0, 40, 60, 500), { top: 0, h: 40, st: 60, vh: 500 })
ok('在视野下方不可见', !isLineVisible(600, 40, 60, 500), { top: 600, h: 40, st: 60, vh: 500 })
ok('贴到顶部边界算可见', isLineVisible(60, 40, 60, 500), '正好对齐')
ok('贴到底部边界算可见', isLineVisible(520, 40, 60, 500), '底边正好 560')
ok('超出底边 4px 仍在容差内', isLineVisible(524, 40, 60, 500), '底边 564 = 560+4')
ok('超出容差就不可见', !isLineVisible(525, 40, 60, 500, 4), '底边 565 > 564')
ok('行只有一半在视野里也算不可见（要滚到正中）', !isLineVisible(30, 40, 60, 500), { top: 30, h: 40, st: 60, vh: 500 })
ok('容差可以调大（同一个位置，容差 10 可见、容差 4 不可见）',
  isLineVisible(530, 40, 60, 500, 10) && !isLineVisible(530, 40, 60, 500, 4),
  '底边 570，视野 560')

// --- 居中滚动目标 ---

check('常规居中', scrollToCenter(300, 40, 500), 70)
check('目标为负时钳到 0', scrollToCenter(10, 40, 500), 0)
check('行比视野还高时仍返回数值', typeof scrollToCenter(0, 900, 500), 'number')

// --- 端到端：模拟一次播放推进 ---

// 用真实的时间轴跑一遍，确认高亮随进度单调前进，最终停在那一句
{
  const idxs = [0.5, 29.9, 31, 34.2, 37.7, 38, 44, 45.6, 119, 120, 200].map((t) =>
    currentLineIndex(LINES, t)
  )
  check('随进度推进单调前进', idxs, [0, 0, 0, 1, 2, 2, 3, 4, 4, 5, 5])
  ok('高亮从不回退', idxs.every((v, i, a) => i === 0 || v >= a[i - 1]), idxs)
}

console.log(`\n${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
