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

// ---------- 本地 LRC 解析 ----------
//
// /api/local/lrc 返回的是用户自己放在曲库旁边的原始文本，解析放前端。
// 在线歌词那条路要按曲名匹配、算相似度，跟这里只做时间戳切分是两件事。

/** 时间戳 [mm:ss.xx] 或 [mm:ss,xxx]；毫秒位可能只有 1~3 位 */
const TIME_RE = /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/

/** 双语文本一行会挂两个标记，剥掉全部标记后取第一个时间 */
const TIME_TAG_RE = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g

/** 纯制作信息行不进歌词 */
const META_RE = /^(作\s*词|作\s*曲|编\s*曲|录\s*音|混\s*音|母\s*带|制\s*作\s*人|监\s*制|制\s*图|吉\s*他|键\s*盘|贝\s*斯|鼓\s*手|人\s*声|vocal|lyricist|composer|arranger|producer|album)\s*[:：]/i

/** LRC 指令行 [ti:] / [ar:] / [offset:]：方括号开头但没时间戳 */
const DIRECTIVE_RE = /^\[[a-zA-Z][a-zA-Z0-9]*[:：]/

/** 解析 LRC 文本为按时间升序的 { time, text } 行 */
export function parseLrcText(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return []

  const lines = []
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || DIRECTIVE_RE.test(line)) continue

    const m = TIME_RE.exec(line)
    if (!m) continue

    const min = Number(m[1])
    const sec = Number(m[2])
    if (!Number.isFinite(min) || !Number.isFinite(sec)) continue

    // 毫秒位按 3 位补齐：[00:01.5] 是 0.5 秒，不是 0.500 秒之外的东西
    const ms = Number((m[3] || '0').padEnd(3, '0'))

    let text = line.replace(TIME_TAG_RE, '').trim()
    text = text.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim()
    if (!text || META_RE.test(text)) continue

    lines.push({ time: min * 60 + sec + ms / 1000, text })
  }

  lines.sort((a, b) => a.time - b.time)
  return lines
}
