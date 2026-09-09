/**
 * 歌词多源与时长打分的离线单测：通过 fetchFn 注入假的 fetch，
 * 不打真实网络请求。跑法：node scripts/test-lyrics-multisource.mjs
 *
 * 测的是「打分 + 选源 + 来源失败时回退」这条决策链，
 * 不是测网络连通性（那条单独用 scripts/probe-lyrics-live.mjs 验）。
 */
import { fetchLyrics, durationFactor, scoreCandidate, segments } from '../src/api/lyrics.js'

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

function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name} ${extra}`)
  }
}

// --- 时长因子 ---

check('完全一致', durationFactor(269, 269), 1)
check('6 秒内不罚分', durationFactor(269, 274), 1)
check('差 12 秒降到 0.875', durationFactor(269, 281), 0.875)
check('差 30 秒降到 0.5', Math.round(durationFactor(269, 299) * 1000) / 1000, 0.5)
check('差 60 秒约 0.333', Math.round(durationFactor(269, 329) * 1000) / 1000, 0.333)
check('差 120 秒降到 0', durationFactor(269, 389), 0)
check('差 200 秒是 0', durationFactor(269, 469), 0)
check('任一为 0 不奖不罚', durationFactor(0, 269), 0)
check('候选缺时长按 0', durationFactor(269, 0), 0)
check('绝对差而不是相对差', durationFactor(200, 225), durationFactor(150, 175))

// --- 假 fetch ---

function qqSearchReply(list) {
  return jsonResponse(`MusicJsonCallback(${JSON.stringify({ retcode: 0, data: { song: { list } } })})`, true)
}

function jsonResponse(body, jsonp = false) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
    json: async () => (jsonp ? null : JSON.parse(body)),
  }
}

const NEARLY_OK = jsonResponse(
  JSON.stringify({
    result: {
      songs: [
        { id: 101, name: '晴天', artists: [{ id: 1, name: '周杰伦' }] },
        { id: 102, name: '晴天(深情版)', artists: [{ id: 2, name: 'Lucky小爱' }] },
      ],
    },
  })
)

const QQ_RIGHT = qqSearchReply([
  { songmid: '0039MnYb0qxYhV', songname: '晴天', singer: [{ name: '周杰伦' }], interval: 269 },
])

const NE_LRC = jsonResponse(
  JSON.stringify({ lrc: { lyric: '[00:00.00]晴天 - 周杰伦\n[00:02.25]词：周杰伦' } })
)

function qqLyricReply(lrcText) {
  const b64 = Buffer.from(lrcText, 'utf8').toString('base64')
  return jsonResponse(`MusicJsonCallback(${JSON.stringify({ retcode: 0, code: 0, subcode: 0, lyric: b64 })})`, true)
}

const allOk = (url) => {
  if (String(url).includes('client_search_cp')) return QQ_RIGHT
  if (String(url).includes('fcg_query_lyric_new')) return qqLyricReply('[00:00.00]晴天 - 周杰伦\n[00:04.50]故事的小黄花')
  if (String(url).includes('music.163.com/api/search')) return NEARLY_OK
  if (String(url).includes('music.163.com/api/song/lyric')) return NE_LRC
  throw new Error(`没预料到的 URL: ${url}`)
}

// --- 时长信号能压过「标题一样但时长未知」的候选 ---

const r1 = await fetchLyrics('晴天 - 周杰伦', '周杰伦', 269, allOk)
check('命中 QQ 那条（时长吻合）', r1.match?.source, 'QQ 音乐')
check('时长分是满分', r1.durationScore, 1)
check('匹配到正主', r1.match?.name, '晴天')
check('候选时长带回来', r1.match?.durationSec, 269)
check('行结构是 { time, text }', r1.lines.length, 2)
check('首行文本对得上', r1.lines[0]?.text, '晴天 - 周杰伦')
check('时间戳是数字', typeof r1.lines[0]?.time, 'number')
ok('base64 解成 UTF-8 没乱码', r1.lines.some((l) => l.text.includes('周杰伦')), r1.lines.map((l) => l.text))

// --- QQ 搜索挂了，回退到网易云 ---
// 用另一个曲名：缓存是按曲名建的，同曲名会被上一轮的命中直接短路

const qqDown = (url) => {
  if (String(url).includes('client_search_cp')) return Promise.reject(new Error('QQ 搜索挂了'))
  return allOk(url)
}
const r2 = await fetchLyrics('晴天 完整版', '周杰伦', 269, qqDown)
ok('QQ 挂了仍能出歌词', r2.found === true, JSON.stringify(r2))
check('回退到网易云', r2.match?.source, '网易云音乐')
check('回退这条没有时长数据，durationScore 为 0', r2.durationScore, 0)
check('回退后仍能解析出行', r2.lines.length, 2)

// --- 两个来源全挂 ---
// 用不冲突的曲名：缓存按清洗后的曲名建，同曲名会被上一轮的命中短路

const allDown = () => Promise.reject(new Error('全挂了'))
const r3 = await fetchLyrics('晴天测试A', '周杰伦', 269, allDown)
check('全挂返回 found=false', r3.found, false)
check('空数组而不是报错', r3.lines, [])
check('match 为 null', r3.match, null)
check('source 字段还在（前端不崩）', typeof r3.source, 'string')

// --- 分数达不到门槛 ---
// 两个来源都给错的歌：候选名和曲名对不上，分数够不到门槛

const wrongSongs = jsonResponse(
  JSON.stringify({ result: { songs: [{ id: 999, name: '七里香', artists: [{ name: '周杰伦' }] }] } })
)
const wrongQQ = qqSearchReply([{ songmid: 'xxx', songname: '七里香', singer: [{ name: '周杰伦' }], interval: 269 }])
const r4 = await fetchLyrics('晴天测试B', '周杰伦', 269, (url) => {
  if (String(url).includes('client_search_cp')) return wrongQQ
  if (String(url).includes('music.163.com/api/search')) return wrongSongs
  if (String(url).includes('fcg_query_lyric_new')) return qqLyricReply('[00:00.00]晴天')
  if (String(url).includes('music.163.com/api/song/lyric')) return NE_LRC
  throw new Error(`没预料到的 URL: ${url}`)
})
check('门槛没到就返回空', r4.found, false)

// --- 打分本身的时长惩罚 ---

const title = '晴天 - 周杰伦'
const segs = segments(title)
const withDur = scoreCandidate(title, segs, { name: '晴天', artists: [{ name: '周杰伦' }], durationSec: 269 }, 269)
const noDur = scoreCandidate(title, segs, { name: '晴天', artists: [{ name: '周杰伦' }] }, 269)
const wrongDur = scoreCandidate(title, segs, { name: '晴天', artists: [{ name: '周杰伦' }], durationSec: 400 }, 269)
ok('时长吻合 > 时长未知', withDur > noDur, `${withDur} vs ${noDur}`)
ok('时长不吻合最低', wrongDur < noDur, `${wrongDur} vs ${noDur}`)
ok('时长吻合能到满分', Math.abs(withDur - 1) < 0.001, withDur)
ok('时长完全对不上被压到门槛以下', wrongDur < 0.6, wrongDur)

// --- 缓存按曲名而非时长：同曲名的第二次调用走缓存 ---

const fresh = await fetchLyrics('晴天 - 周杰伦', '周杰伦', 284, allOk)
check('第二次调用命中缓存，来源不变', fresh.match?.source, r1.match?.source)
check('缓存的 durationScore 是首次算出来的', fresh.durationScore, r1.durationScore)

console.log(`\n${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
