/**
 * 歌词行的定位与滚动判定。纯函数、无 DOM 依赖，
 * 单独放一个模块是为了能在 Node 里直接跑单测——
 * LyricPanel.vue 里混着模板和响应式，没法脱离浏览器验证。
 */

/**
 * 找当前该高亮的那一行。
 *
 * @param {Array<{time: number, text: string}>} lines 后端已按时间升序
 * @param {number} progress 播放进度（秒）
 * @param {number} lookahead 时间戳普遍比音频晚一点，往前多亮一点点会更顺眼
 * @returns {number} 行下标；没有行时返回 -1
 */
export function currentLineIndex(lines, progress, lookahead = 0.25) {
  const list = Array.isArray(lines) ? lines : []
  const t = Number.isFinite(progress) ? progress : 0
  let idx = -1
  for (let i = 0; i < list.length; i++) {
    if (list[i].time <= t + lookahead) idx = i
    else break // 已排序，后面的都更晚
  }
  // 前奏（还没唱到第一句）先亮第一句，别整屏灰
  if (idx < 0 && list.length) idx = 0
  return idx
}

/** 当前行是否已经在可视范围内（含一点容差）。在就不滚，让手动上翻的人不被顶回去 */
export function isLineVisible(top, height, scrollTop, viewHeight, tolerance = 4) {
  return top >= scrollTop - tolerance && top + height <= scrollTop + viewHeight + tolerance
}

/** 把这一行滚到视野正中 */
export function scrollToCenter(top, height, viewHeight) {
  return Math.max(0, top - (viewHeight - height) / 2)
}
