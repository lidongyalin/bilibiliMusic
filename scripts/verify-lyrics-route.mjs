import { createRouter } from '../src/routes.js'

/**
 * 路由接线自检：不监听端口，把 /lyrics 的 handler 取出来喂假的 req/res。
 * 这样不需要起服务器，也照样能验证「路由注册 → 参数校验 → 返回结构」这一整条链路。
 */
const router = createRouter()
const layer = router.stack.find((l) => l.route && l.route.path === '/lyrics')
if (!layer) {
  console.log('FAIL 没找到 /api/lyrics 路由')
  process.exit(1)
}
const handler = layer.route.stack[0].handle

function makeRes() {
  const res = { statusCode: 200, body: undefined }
  res.status = (c) => {
    res.statusCode = c
    return res
  }
  res.json = (o) => {
    res.body = o
    return res
  }
  return res
}

// handler 不返回值，所以要拿自己造的 res 来看结果
const call = (query) => {
  const res = makeRes()
  return Promise.resolve(handler({ method: 'GET', path: '/lyrics', query }, res)).then(() => res)
}

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++
  console.log(cond ? `ok   ${name}` : `FAIL ${name} ${extra}`)
}

// 缺参数
let r = await call({})
ok('缺曲名返回 400', r.statusCode === 400 && Boolean(r.body?.error), JSON.stringify(r.body))

// 真实命中
r = await call({ title: '起风了 - 买辣椒也用券', artist: '买辣椒也用券' })
ok('HTTP 200 且 found=true', r.statusCode === 200 && r.body?.found === true, JSON.stringify(r.body).slice(0, 160))
ok('行结构是 { time, text }', r.body?.lines?.length > 0 && typeof r.body.lines[0].time === 'number' && typeof r.body.lines[0].text === 'string')
ok('带来源与匹配分数', r.body.match?.source === '网易云音乐' && typeof r.body.match?.score === 'number')
if (r.body?.lines?.length) {
  console.log(`     行=${r.body.lines.length}  命中=${r.body.match.name} / ${r.body.match.artist}  分=${r.body.match.score}`)
  ok('行按时间升序', r.body.lines.every((l, i, a) => i === 0 || a[i - 1].time <= l.time))
  ok('文本里没有残留时间戳', r.body.lines.every((l) => !/\[\d{1,2}:\d{2}/.test(l.text)))
}

// 查不到
r = await call({ title: 'xyzzy不存在的歌xyzzy', artist: '' })
ok(
  '查不到时 200 + found=false + 空数组',
  r.statusCode === 200 && r.body?.found === false && Array.isArray(r.body.lines) && r.body.lines.length === 0,
  JSON.stringify(r.body).slice(0, 160)
)

console.log(`\n${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
