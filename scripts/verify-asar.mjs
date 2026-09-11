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
  'src/routes-local.js',
  'src/createApp.js',
  'src/config.js',
  'src/api/http.js',
  'src/api/bilibili.js',
  'src/api/stream.js',
  'src/api/lyrics.js',
  'src/api/localtags.js',
  'src/store/favorites.js',
  'src/store/playlists.js',
  'src/store/library.js',
  'src/store/history.js',
  'src/store/settings.js',
  'electron/main.js',
  'electron/env.js',
  'electron/preload.cjs',
  'electron/icons.js',
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

// 本地播放器：路由要挂上，标签解析与曲库扫描要能拿到
console.log('本地播放器：')
const localRoutes = pick('src/routes-local.js')
show(
  /\/library/.test(localRoutes) && /\/local\/stream/.test(localRoutes) && /\/local\/lrc/.test(localRoutes),
  'routes-local.js 注册了曲库 / 本地流 / 本地歌词路由'
)

const tags = pick('src/api/localtags.js')
show(/export async function readAudioInfo/.test(tags), 'localtags.js 导出了 readAudioInfo')

const lib = pick('src/store/library.js')
show(/export const library/.test(lib) && /scanFolder\s*\(/.test(lib) && /repair\s*\(/.test(lib),
  'library.js 有 scanFolder 与 repair（文件夹监控重扫用）')

// preload 必须是 CJS：沙箱 preload 走 ESM 会直接让渲染进程崩溃。
// 只断言「有 require、没有 export/import 语法」，别用正则匹配行首——注释里可能正好有这些词
const preload = pick('electron/preload.cjs')
show(/require\(['"]electron['"]\)/.test(preload) && !/\bexport\s/.test(preload) && !/\bimport\s*\{/.test(preload),
  'preload.cjs 是 CommonJS')

const icons = pick('electron/icons.js')
show(/export function selfTest/.test(icons), 'icons.js 有字节级自检')

console.log(bad ? `\nFAIL ${bad} 项缺失` : '\nasar 校验通过')
process.exit(bad ? 1 : 0)
