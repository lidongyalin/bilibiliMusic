import { createRequire } from 'node:module'

/** 打包产物自检：确认后端源码和前端产物都在 asar 里，前端源码没被误打进去 */
const require = createRequire(import.meta.url)
const asar = require('@electron/asar')

const P = 'release/win-unpacked/resources/app.asar'
const raw = asar.listPackage(P)
// Windows 上 listPackage 用反斜杠，统一成正斜杠
const norm = raw.map((x) => x.replace(/\\/g, '/').replace(/^\//, ''))

let bad = 0
const show = (ok, label) => {
  if (!ok) bad++
  console.log(`  ${ok ? 'ok   ' : 'MISS '} ${label}`)
}

console.log('后端源码：')
for (const w of [
  'server.js',
  'package.json',
  'src/routes.js',
  'src/createApp.js',
  'src/config.js',
  'src/api/http.js',
  'src/api/bilibili.js',
  'src/api/stream.js',
  'src/api/lyrics.js',
  'src/store/favorites.js',
  'electron/main.js',
  'electron/env.js',
]) {
  show(norm.includes(w), w)
}

console.log('前端产物：')
const assets = norm.filter((f) => f.startsWith('client/dist/'))
assets.forEach((f) => console.log(`  ${f}`))
show(assets.length >= 2, 'client/dist 产物已打入')
show(!norm.some((f) => f.startsWith('client/src/')), 'client/src 未被打进（前端已编译，不该重复）')

// asar 在这个环境里按平台分隔符查文件，Windows 上要传反斜杠
const pick = (posix) => asar.extractFile(P, posix.split('/').join('\\')).toString('utf8')

const routes = pick('src/routes.js')
show(/\/lyrics/.test(routes), 'routes.js 注册了 /lyrics')

const lrc = pick('src/api/lyrics.js')
show(
  /export function parseLrc/.test(lrc) && /export async function fetchLyrics/.test(lrc),
  'lyrics.js 导出了 parseLrc / fetchLyrics'
)

console.log(bad ? `\nFAIL ${bad} 项缺失` : '\nasar 校验通过')
process.exit(bad ? 1 : 0)
