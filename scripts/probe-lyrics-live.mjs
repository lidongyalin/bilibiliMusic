/** 联网验证 fetchLyrics 的匹配质量。跑法：node scripts/probe-lyrics-live.mjs */
import { ensureCookie, upstreamHeaders } from '../src/api/http.js'
import { CONFIG } from '../src/config.js'
import { fetchLyrics, cleanTitle, segments } from '../src/api/lyrics.js'

const H = async () => ({ ...upstreamHeaders(), Cookie: await ensureCookie() })

async function searchBvids(kw, n = 6) {
  const sr = await (await fetch(
    'https://api.bilibili.com/x/web-interface/search/all/v2?keyword=' + encodeURIComponent(kw) + '&page=1&order=0',
    { headers: await H(), signal: AbortSignal.timeout(CONFIG.API_TIMEOUT_MS) }
  )).json()
  return ((sr.data?.result || []).find((g) => g.result_type === 'video')?.data || []).slice(0, n)
}

let found = 0
for (const kw of ['晴天 周杰伦', '月亮代表我的心', '海阔天空  Beyond', '起风了']) {
  const vids = await searchBvids(kw, 5)
  console.log(`\n===== 关键词「${kw}」 =====`)
  for (const v of vids) {
    const t0 = Date.now()
    const r = await fetchLyrics(v.title, v.author)
    const dt = Date.now() - t0
    if (r.found) found++
    const match = r.match
    console.log(
      `  ${v.bvid}  ${r.found ? '✓' : '✗'}  ${dt}ms  行=${r.lines.length}\n` +
      `      标题: ${cleanTitle(v.title)} | 段: ${segments(cleanTitle(v.title)).join(' / ')}\n` +
      (match ? `      命中: ${match.name} - ${match.artist}（分 ${match.score}）\n` : '') +
      (r.lines[0] ? `      首行: ${r.lines[0].text.slice(0, 40)}` : '')
    )
  }
}
console.log(`\n总计命中 ${found} 条`)
