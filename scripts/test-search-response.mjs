/**
 * 搜索响应分类的离线单测。
 *
 * 背景：B 站风控拦下请求时返回 code=0 / message="OK"，data 里只有一个 v_voucher，
 * 没有 result / numResults / numPages。以前只判断 code 就把这类响应当成功，
 * numPages 缺失被算成 0，前端于是显示「没有更多了」，分页静默停在一页。
 *
 * 跑法：node scripts/test-search-response.mjs
 */
import {
  classifySearchResponse,
  RISK_BLOCKED_MESSAGE,
  RISK_RETRY_DELAY_MS,
} from '../src/api/bilibili.js'

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

// 下面几个响应的形状是实测抓下来的，不是臆造的
const OK_PAGE_1 = {
  code: 0,
  message: 'OK',
  data: {
    numResults: 1000,
    numPages: 50,
    result: [{ bvid: 'BV1d4411N7zD', duration: '04:12', title: '晴天', author: '周杰伦', pic: '', play: 1 }],
  },
}
const BLOCKED = {
  code: 0,
  message: 'OK',
  data: { v_voucher: 'voucher_919222d4-117d-441b-ae4c-859d2cbbf134' },
}

// --- 三类响应 ---

check('正常返回结果', classifySearchResponse(OK_PAGE_1), 'ok')
check('正常返回但确实没有结果', classifySearchResponse({ code: 0, message: 'OK', data: { result: [], numResults: 0, numPages: 0 } }), 'ok')
check('风控拦下（code=0 但只有 v_voucher）', classifySearchResponse(BLOCKED), 'blocked')
check('风控拦下优先级最高（即使 code 也不对）', classifySearchResponse({ code: -101, message: '未登录', data: { v_voucher: 'voucher_x' } }), 'blocked')

check('上游报错 code=-101', classifySearchResponse({ code: -101, message: '账号未登录' }), 'error')
check('上游报错 code=-1200（被降级）', classifySearchResponse({ code: -1200, message: '请求被降级过滤' }), 'error')
check('上游报错 code=500', classifySearchResponse({ code: 500, message: 'Internal Server Error' }), 'error')
check('响应体不是 JSON', classifySearchResponse(null), 'error')
check('响应体是空对象', classifySearchResponse({}), 'error')
check('响应体只有 code 没有 data', classifySearchResponse({ code: 0 }), 'ok')

// --- 关键回归：不能把风控响应当成「到底了」 ---

// 以前 numPages 缺失 → 0 → hasMore=false → 前端显示「没有更多了」
ok(
  '风控响应没有 numPages（这是被误判的根源）',
  BLOCKED.data.numPages === undefined && BLOCKED.data.result === undefined,
  BLOCKED.data
)
ok('所以它必须归类为 blocked 而不是 ok', classifySearchResponse(BLOCKED) !== 'ok')

// --- 对外常量 ---

ok('风控提示是中文且非空', typeof RISK_BLOCKED_MESSAGE === 'string' && RISK_BLOCKED_MESSAGE.length > 4, RISK_BLOCKED_MESSAGE)
ok('重试延迟是有限正数', Number.isFinite(RISK_RETRY_DELAY_MS) && RISK_RETRY_DELAY_MS > 0, RISK_RETRY_DELAY_MS)
ok('重试延迟不至于卡住界面', RISK_RETRY_DELAY_MS <= 5000, RISK_RETRY_DELAY_MS)

console.log(`\n${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
