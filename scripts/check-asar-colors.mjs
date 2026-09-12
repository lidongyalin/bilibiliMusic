/**
 * 打包产物内容自检：确认打进去的 CSS/JS/HTML/主进程源码真的是新版本。
 * 用法：node scripts/check-asar-colors.mjs [app.asar 路径]
 *
 * verify-asar.mjs 只查「文件在不在」，这个查「内容对不对」。
 * 踩过一次坑：改完 client/index.html 忘了重新 build，asar 里还是旧配色，
 * 肉眼看不出，只能直接断言打包后的字节。
 *
 * 前端断言只挑字符串字面量。Vite 默认 esbuild 压缩会把函数名和标识符改名，
 * installDesktopBridge / parseLrcText 这类名字在产物里查不到，
 * 但 'desktop-lyrics'、'lyric-offset' 这类字面量会原样保留。
 *
 * 不依赖 asar npm 包：当前装的 @electron/asar 3.4.1 在 Windows 上 extractFile
 * 读不到嵌套路径（getNode 用 path.dirname 但 searchNodeFromDirectory 只按
 * path.sep 切分，正斜杠路径会整段当成一个键名），而 listPackage 给的路径又
 * 带着一个开头分隔符，两种写法都取不到文件。头部结构很简单，自己解更省事。
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

const P = process.argv[2] ?? 'release/win-unpacked/resources/app.asar'
if (!existsSync(P)) {
  console.error(`找不到 ${P}`)
  process.exit(2)
}
const raw = readFileSync(P)

// 头部是 pickle 格式，JSON 起点不固定（这里是 16），所以先定位 {"files" 再回退
// 4 字节读长度；数据区紧接在 JSON 之后，中间可能有 1 字节的 null 结尾。
const i = raw.indexOf(Buffer.from('{"files"'))
if (i < 4) {
  console.error('找不到 asar 头部 {"files"')
  process.exit(1)
}
const jsonLen = raw.readUInt32LE(i - 4)
const meta = JSON.parse(raw.subarray(i, i + jsonLen).toString('utf8'))
const base = i + jsonLen

// 必须记 size：asar 里文件是紧密排列的，多读一字节就越界到下一个文件，
// 色值断言会误报（index.html 紧接在 index-*.css 后面，正好被踩过）。
const files = {}
function walk(node, p) {
  if (node.files) {
    for (const [k, v] of Object.entries(node.files)) walk(v, `${p}/${k}`)
    return
  }
  if (node.offset != null && !node.unpacked) {
    files[p] = { offset: Number(node.offset) + base, size: Number(node.size) }
  }
}
// meta.files 本身就是「文件名 -> 节点」映射，不是目录节点，
// 要包一层 {files: ...} 才能走上面的递归（否则整棵树返回 0 条）。
walk({ files: meta.files }, '')

const read = (key) => {
  const f = files[key]
  return f ? raw.subarray(f.offset, f.offset + f.size).toString('utf8') : ''
}

const clientFiles = Object.keys(files).filter((k) => k.startsWith('/client/'))
const cssKey = clientFiles.find((k) => /index-.*\.css$/.test(k))
const jsKeys = clientFiles.filter((k) => k.endsWith('.js'))
const htmlKey = clientFiles.find((k) => k.endsWith('/index.html'))

// 托盘图标走 extraResources，落在 asar 旁边的 resources/build/ 下。
// createFromPath 不经过 Electron 补丁过的 fs，asar 内的路径读不到，
// 所以这个只能在文件系统上验，asar 里反而不该有它。
const resourcesDir = dirname(P)

const cssText = read(cssKey ?? '')
const jsAll = jsKeys.map(read).join('\n')
const htmlText = read(htmlKey ?? '')
// 后端在 asar 里是原样源码，express.json 的 body 上限就在这里
const backend = Object.keys(files).filter((k) => /^\/src\/.*\.js$/.test(k)).map(read).join('\n')
// electron 主进程 + preload 同样是原样源码。preload 是 .cjs（沙箱要求的 CJS），
// 只 glob .js 会把它漏掉，preload 桥的内容就验不到了。
const electron = Object.keys(files)
  .filter((k) => /^\/electron\/.*\.(?:js|cjs)$/.test(k))
  .map(read).join('\n')

console.log(`asar: ${P}`)
console.log(`CSS: ${cssKey || '(未找到)'}`)
console.log(`前端 JS: ${jsKeys.length} 个 | index.html: ${htmlKey || '(未找到)'}`)
console.log('')

const checks = [
  ['CSS 含网易云红 #ec4141', cssText.includes('#ec4141')],
  ['CSS 含纯中性炭黑 #121212', cssText.includes('#121212')],
  ['CSS 歌单大封面 128px', /width:\s*128px/.test(cssText)],
  ['CSS 红色圆形「播放全部」', cssText.includes('.play-all-btn')],
  ['CSS 行封面 52px', /width:\s*52px/.test(cssText)],
  ['CSS 侧栏选中态用中性灰底', /background:\s*var\(--bg-hover\)/.test(cssText)],
  ['后端批量加歌 body 上限 1mb', backend.includes("limit: '1mb'")],
  ['CSS 含虚拟滚动占位 .list-spacer', cssText.includes('.list-spacer')],
  ['后端重命名只包一层 playlist', backend.includes('playlist: updated.playlist')],
  ['托盘 ICO 在 asar 之外的 resources/build/', existsSync(join(resourcesDir, 'build', 'icon.ico')) && statSync(join(resourcesDir, 'build', 'icon.ico')).size > 10000],
  ['托盘 PNG 也随 extraResources 带上', existsSync(join(resourcesDir, 'build', 'icon.png'))],
  ['asar 内无托盘图标（createFromPath 读不到 asar）', !files['/build/icon.ico'] && !files['/build/icon.png']],
  ['主进程用 createFromPath + ICO 读托盘图标', /createFromPath\s*\(/.test(electron) && electron.includes('icon.ico') && !/createFromBuffer\s*\(/.test(electron)],
  ['主进程底色 #121212 且无旧紫底', electron.includes("backgroundColor: '#121212'") && !electron.includes('#141419')],
  ['前端空歌单提示文案', jsAll.includes('还没有歌单')],
  ['前端批量提交只带必要字段', jsAll.includes('durationSec')],
  ['index.html theme-color #121212', htmlText.includes('theme-color" content="#121212"')],
  ['index.html favicon 用网易云红', htmlText.includes('%23ec4141')],
  ['CSS 无旧紫底 #141419', !cssText.includes('#141419')],
  ['CSS 无旧绿色歌单图标 #3aa675', !cssText.includes('#3aa675')],
  // 粉色 #fb7299 现在是 F24 强调色板和 F29 桌面歌词色板里的一个可选项，
  // 属于刻意保留。约束改成「它只能出现在 JS 色板数组里，不得进 CSS 结构样式」。
  ['CSS 未把 #fb7299 用于结构样式', !cssText.includes('#fb7299')],
  ['JS 色板保留粉色 #fb7299（用户可选）', jsAll.includes('#fb7299')],
  ['index.html 无旧紫底', !htmlText.includes('#141419')],
  ['index.html 无旧粉 favicon', !htmlText.includes('%23fb7299')],

  // ---- 本地播放器新增能力：样式层 ----
  ['CSS 含迷你窗独立窗口样式 .mini-mode', cssText.includes('.mini-mode')],
  // 桌面歌词重设计后控制条换成「悬停整窗黑色半透明面板」：
  // .dl.is-hover 面板 + 歌名行 .dl-head + 调节行 .dl-controls。
  // 悬停态是 JS 打的类而不是 CSS :hover——透明置顶窗下 :hover 会抖导致面板闪。
  // 面板色 rgba(8,8,10,.66)，压缩器可能折成 #08080aa8，两种形态都认
  ['CSS 含桌面歌词窗样式 .dl-head', cssText.includes('.dl-head')],
  ['CSS 桌面歌词悬停整窗半透明黑面板',
    cssText.includes('.dl.is-hover') && /rgba\(8,\s*8,\s*10|08080a/i.test(cssText)],
  ['CSS 歌词校准控件 .lp-cal', cssText.includes('.lp-cal')],
  ['CSS 拖拽区 webkit-app-region: drag', /webkit-app-region:\s*drag/.test(cssText)],
  ['CSS 控件区 webkit-app-region: no-drag', /webkit-app-region:\s*no-drag/.test(cssText)],
  ['CSS 移动端用 100dvh 兜地址栏', cssText.includes('100dvh')],
  ['CSS 含新中性色阶 #181818/#212121/#2a2a2a', cssText.includes('#181818') && cssText.includes('#212121') && cssText.includes('#2a2a2a')],

  // ---- 本地播放器新增能力：前端行为（只断言字符串字面量，函数名会被压缩掉）----
  ['JS 含三种窗口模式标识 desktop-lyrics', jsAll.includes('desktop-lyrics')],
  ['JS 含歌词偏移回流命令 lyric-offset', jsAll.includes('lyric-offset')],
  ['JS 歌词来源标注「本地文件」（本地 .lrc）', jsAll.includes('本地文件')],
  ['JS 桌面歌词样式持久化键 desktopLyricsStyle', jsAll.includes('desktopLyricsStyle')],
  ['JS 设置面板含文件夹监控开关', jsAll.includes('monitorFolders')],
  ['JS 设置面板含全局快捷键开关', jsAll.includes('globalShortcuts')],
  ['JS 桌面歌词色板 6 色齐全',
    ['#ffffff', '#ffd54a', '#67cb6c', '#50a9ff', '#fb7299', '#ec4141'].every((c) => jsAll.includes(c))],

  // ---- 后端 ----
  ['后端 settings schema 含 monitorFolders（F27）', backend.includes('monitorFolders')],
  ['后端 settings schema 含 globalShortcuts（F8）', backend.includes('globalShortcuts')],
  ['后端曲库 repair() 供文件夹监控重扫', backend.includes('repair')],

  // ---- Electron 主进程与 preload ----
  ['asar 打包了 electron/preload.cjs', Boolean(files['/electron/preload.cjs'])],
  ['asar 打包了 electron/icons.js', Boolean(files['/electron/icons.js'])],
  ['主进程引用 preload.cjs（沙箱 preload 必须是 CJS）', electron.includes("preload.cjs")],
  ['preload 是 CJS 而非 ESM', !/^\s*import\s/.test(read('/electron/preload.cjs') || '')],
  ['preload 暴露 requestState / pushState', read('/electron/preload.cjs').includes('requestState') && read('/electron/preload.cjs').includes('pushState')],
  ['主进程注册全局快捷键', electron.includes('globalShortcut') && electron.includes('CommandOrControl+Alt+Space')],
  ['主进程打开迷你窗与桌面歌词窗', electron.includes('mode=mini') && electron.includes('mode=desktop-lyrics')],
  ['主进程含 Windows 缩略图工具栏', electron.includes('setThumbnailToolbar')],
  ['主进程含系统托盘', electron.includes('new Tray') || electron.includes('Tray(')],
  ['主进程含文件夹监控 fs.watch', electron.includes('fs.watch')],
  ['主进程含关闭行为分流 closeBehavior', electron.includes('closeBehavior')],
  ['主进程辅助窗不降频 backgroundThrottling', electron.includes('backgroundThrottling: false')],
]

let bad = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? '  OK  ' : '  FAIL'} ${label}`)
  if (!ok) bad++
}
console.log('')
console.log(bad ? `❌ ${bad} 项未通过` : '✅ 全部通过')
process.exit(bad ? 1 : 0)
