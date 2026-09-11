# B 站音乐播放器

本地运行的 B 站音乐播放器：**搜索 → 在线流播放 → 收藏 → 歌单**。Node.js + Express 后端，Vue 3 + Element Plus 前端，深色主题，界面全中文，视觉与交互参考网易云音乐。

只做在线流播放，不做离线下载。收藏与歌单写入本地 JSON，重启不丢失。

## 使用边界（先看这个）

- **本项目不是官方产品**。与 B 站（上海幻电）、网易云音乐（杭州网易云音乐）、QQ 音乐（腾讯音乐娱乐）**均无关联**，也未获得任何一家的授权、合作或背书。三方的名称、商标、标识与内容版权均归各自权利人所有。
- **仅供个人本地使用**，不要公开分发、不要商用、不要做批量抓取或爬取。详见[合规](#合规)。
- **歌词功能来自第三方公开接口**。歌词是有版权的文学内容，本项目只在进程内即时读取并显示，不落盘、不缓存、不打包。请不要把这段代码改成歌词下载器或歌词数据库。
- **fork 与二次使用由你自己负责**。代码按 MIT 授权，但许可只覆盖代码本身，不覆盖你运行它时产生的行为。
- **收到权利人通知**：请通过 GitHub [DMCA 表单](https://github.com/github/dmca) 或提 issue 联系。涉及歌词的部分可按[合规](#合规)一节单独摘除，其余功能不受影响。

### 已知风险

开源前应当知道、目前没有解掉的问题：

1. **歌词功能** — `src/api/lyrics.js` 抓取有版权的歌词正文，用的是网易云与 QQ 音乐**未文档化的内部接口**，QQ 那条还包含逆向出来的请求签名与一个写死的会话令牌。摘除方法见[合规](#合规)。
2. **应用图标复刻了 B 站小电视形象** — `scripts/make-icon.mjs` 用参数化矢量重画了这个形象并使用其品牌色，开源等于公开了可任意重绘的矢量定义。
3. **后端转发 B 站 CDN 音频流** — 个人播放的必要环节，但开源后无法阻止他人拿去做分发服务。
4. **`release/` 下的安装包未做代码签名**，已在 `.gitignore` 中，不会进仓库。请不要把它们上传到 GitHub Releases。

## 快速开始

要求 Node.js 20+。

```bash
npm run setup   # 安装依赖 + 构建前端
npm start       # 打开 http://127.0.0.1:8788
```

开发模式（前后端都热更新，前端在 5173，`/api` 自动代理到后端）：`npm run dev`

其他脚本：`npm run build`（只构建前端）、`npm run dev:server`、`npm run dev:client`、`npm test`（离线单测，不联网）。

前端产物在 `client/dist`，由后端直接托管；没构建时后端返回明确的 503，不会静默 404。

## 桌面应用

Electron 打包成单个 exe，双击即用，不需要装 Node：

| 命令 | 说明 |
|---|---|
| `npm run electron` | 开发调试，直接用本机 Electron 跑，不打包 |
| `npm run dist:dir` | 只出未压缩的应用目录，最快，验证打包链用 |
| `npm run dist:zip` | Windows 压缩包，解压后 exe 在根目录 |
| `npm run dist:win` | Windows 安装包 + 绿色免安装单文件 |
| `npm run dist` | 打当前系统的安装包 |

产物在 `release/`。`dist:win` 需要能访问 GitHub（NSIS/WiX 的构建工具只托管在那里），网络不通时改用 `dist:zip` 或 `dist:dir`。

打包完跑两个自检再发出去：`npm run verify:asar` 查该进去的文件都在，`npm run verify:colors` 查 asar 里的字节是不是新版本。前者管「有没有」，后者管「对不对」——改过 `client/index.html` 却忘了 `npm run build` 时 asar 里还是旧的，两个自检能立刻抓到。

应用图标由 `scripts/make-icon.mjs` 生成（零依赖、可离线重跑）：`npm run icon`，改完重跑 `npm run dist` 才会进产物。

数据位置：桌面版在 `%APPDATA%/bilibili-music-player/`，CLI 版在仓库内 `data/`。两份互不相通，需要时手动挪文件。

未签名，首次运行会被 Windows SmartScreen 拦，要点「更多信息 → 仍要运行」——需要代码签名证书才能去掉，这不是代码问题。

## 功能

- **搜索**：400ms 防抖 + 触底自动加载。每页 50 条，翻过的每一页都存进 `localStorage` 本地分页——重新打开直接用缓存恢复，一个请求都不发。缓存最多记 6 个关键词、单个关键词 20 页、总量 1.5MB，超了按 LRU 丢最早的
- **搜索历史**：点搜索框展开最近搜过的词，可按当前输入过滤、单项删除、一键清空。最多 30 条，只存浏览器 `localStorage`
- **风控不会误报成「没有更多」**：B 站风控拦截时返回 `code=0` 但 `data` 里只有 `v_voucher`。后端识别后换 buvid 等 1.2 秒重试一次，还被拦返回 429 和明确文案；前端不清空已有列表，继续往下滚就能重试
- **播放**：点行即播，队列默认是当前列表。暂停/继续、上一首/下一首、进度拖拽、音量、顺序/单曲循环/随机三种模式
- **失败自动跳过**：某首失败先原地重试一次，仍失败切下一首并提示。连续 3 首失败停止自动切换，避免断网时把整个队列高速过完
- **收藏**：星标乐观更新（先改界面再请求，失败自动回滚），独立收藏视图，侧栏计数
- **歌单**：创建、重命名、删除（删除前确认）。独立视图带封面、歌数、更新时间、「播放全部」。可单行加进、从歌单移除、重排顺序。重名自动加「 2」「 3」后缀
- **多选与批量加入**：列表右上角进多选模式，序号列换成勾选框，支持全选/取消/逐个勾选，选中后可整批加进指定歌单。单选和批量共用同一条后端接口，重复曲目按 bvid 去重跳过
- **长列表虚拟化**：按滚动位置只渲染可见区间 + 上下各 8 行缓冲，其余用占位撑起总高度。1001 首歌单一屏只挂 18 行：主线程最长阻塞从 5143ms 降到 321ms，DOM 节点从 23384 降到 1015
- **续播**：播放位置存 `localStorage`，下次打开同一首歌自动续播
- **歌词**：右侧滑入面板，当前行高亮放大并自动滚到视野正中，点击任意一行跳到该时刻。多来源并行取（网易云音乐 + QQ 音乐），按「曲名相似度 + 歌手 + 时长」打分取最贴合的一条，匹配不到显示「暂无歌词」而不是放宽阈值硬塞。**歌词只在内存里，不落盘、不进 `localStorage`、不进 `data/`**，只有「面板是否打开」这个开关会持久化
- **Media Session**：系统级锁屏/耳机/音量键控制
- **系统托盘与关闭行为**：常驻托盘图标，单击唤回窗口，右键「显示主窗口 / 退出」。点窗口关闭**不会直接退出**，而是问「最小化到托盘 / 退出程序」，默认停在「最小化到托盘」，误点只是隐藏窗口，播放不中断
- **快捷键**（焦点在输入框或滑杆时不接管）：

  | 按键 | 作用 |
  |---|---|
  | `空格` | 播放 / 暂停 |
  | `←` `→` | 后退 / 前进 5 秒 |
  | `↑` `↓` | 音量 +/- |
  | `L` | 切换播放模式 |
  | `N` / `P` | 下一首 / 上一首 |
  | `G` | 显示 / 收起歌词面板 |

## 视觉与响应式

深色主题对齐网易云音乐桌面版：强调色用网易云红 `#EC4141`（不是粉色），底色是纯中性炭黑 `#121212` 不带紫蓝调，侧栏选中态是「深一档灰底 + 白字」而不是整块强调色，强调色只落在图标上。所有变量集中在 `client/src/assets/base.css` 顶部。

一套布局从桌面覆盖到手机，按宽度分档，已实测 1920×1080 / 1440×900 / 1024×768 / 768×1024 / 430×932 / 390×844 / 360×740 / 844×390：

| 断点 | 处理 |
|---|---|
| ≤1100px | 侧栏收窄 |
| ≤900px | 侧栏更窄，隐藏播放数列 |
| ≤640px | 侧栏转顶部横条，播放条转两行，触达目标放大到 40–44px |
| ≤380px | 隐藏时长列，封面缩到 38px |
| 高度 ≤500px 且横屏 | 播放条压到 72px |
| ≥1700px | 列表限宽 1300px 居中 |

移动端专门处理了 `100dvh`（`100vh` 在移动浏览器里大于可视高度）、刘海安全区（`viewport-fit=cover` + `env(safe-area-inset-*)`）、进度跑道命中区扩展、`touch-action: manipulation`。故意不加 `user-scalable=no`——禁用缩放是无障碍反模式。

## 架构

浏览器**无法直接播放 B 站音频**，所以必须走后端代理：

```
浏览器 ──搜索──▶ /api/search  ──▶ B 站搜索接口（注入 UA + buvid cookie）
浏览器 ──/api/stream/:bvid──▶ 后端解析音轨地址 ──▶ 后端代理转发 ──▶ B 站 CDN
```

三个绕不过去的限制，也是这套架构的原因：

1. **音频 CDN 不发 CORS 头**，浏览器直连被拦截 → 后端转发，前端只请求 `/api/stream/...`
2. **音频 CDN 有防盗链**，缺 `Referer` 直接 403 → 后端固定注入 `Referer: https://www.bilibili.com/`
3. **图片 CDN（hdslb.com）也有防盗链**，非 bilibili 域名的 Referer 会返回 403 的 HTML 错误页 → `index.html` 里有 `<meta name="referrer" content="no-referrer">`。**改 index.html 时别删这行，否则所有封面变空。**

音频流代理层有三道防御（`src/api/stream.js`，改前值得看代码注释）：上游回 HTML 错误页时不转发（有时还带 206 状态码，直接转发会让 `<audio>` 拿到无法解码的文本，`duration` 永远为 0）；`AbortSignal.timeout` 只能挂在「建连到拿到响应头」这一段（实测这个 signal 在响应体读取期间仍然生效，直接挂在 `fetch` 上会掐断播放）；CDN 不回 `Content-Length` 时不要设成字符串 `"null"`。

搜索必须走带 WBI 签名的 `wbi/search/type`——`search/all/v2` 完全忽略 `order` 参数，没法按播放量排序。签名常量固化在 `src/api/bilibili.js`，上游轮换后同样会静默返回空，改那两个常量即可。

## 后端 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/search?keyword=&page=` | 搜索，返回 `{keyword, page, list, total, hasMore}`。被风控拦下是 `429 + {error}`，不是空列表 |
| GET | `/api/stream/:bvid` | 音频字节流，支持 `Range` / `Content-Range` / `Accept-Ranges` |
| GET | `/api/lyrics?title=&artist=&durationSec=` | 按曲名取歌词，返回 `{lines, found, match, source}`。`durationSec` 可选，用于按时长接近度打分。查不到是 `200 + found=false` |
| GET | `/api/probe/:bvid` | 音轨可用性探测。**前端目前没调用**，留着给「播放前预检」用 |
| GET | `/api/favorites` | 全部收藏 |
| POST | `/api/favorites` | 收藏一首（body 含 `bvid`），幂等，首次 201 |
| GET | `/api/favorites/check?ids=` | 批量查询收藏状态 |
| DELETE | `/api/favorites/:id` | 取消收藏 |
| GET | `/api/playlists` | 歌单摘要列表（不含曲目） |
| POST | `/api/playlists` | 创建歌单，body `{name}`；空名回落默认名，重名自动加后缀 |
| GET | `/api/playlists/:id` | 歌单详情，含曲目 |
| PUT | `/api/playlists/:id` | 重命名，返回 `{playlist, oldName}` |
| DELETE | `/api/playlists/:id` | 删除歌单 |
| POST | `/api/playlists/:id/songs` | 批量加歌，body `{songs: [...]}`，返回 `{playlist, added, skipped}`，按 bvid 去重 |
| DELETE | `/api/playlists/:id/songs/:bvid` | 从歌单移除一首 |
| PUT | `/api/playlists/:id/songs/order` | 重排曲目顺序 |

统一错误格式 `{ "error": "中文说明" }`。

## 目录结构

```
├── server.js                 CLI 入口：读配置并监听端口
├── electron/                 桌面主进程：单实例锁、PORT=0、托盘、关闭确认
├── src/
│   ├── config.js             端口、UA、超时、缓存时长
│   ├── createApp.js          构建 Express 应用（不监听端口），CLI 与桌面共用
│   ├── routes.js             全部路由
│   ├── api/http.js           请求封装、buvid cookie、Referer 注入
│   ├── api/bilibili.js       搜索 + 音轨解析
│   ├── api/stream.js         音频流代理（Range 透传）
│   ├── api/lyrics.js         LRC 解析、多源匹配（网易云 + QQ）、时长打分
│   └── store/                收藏与歌单持久化（原子写入）
├── client/                   Vite + Vue 3 + Element Plus
│   └── src/
│       ├── App.vue  main.js  state.js  prefs.js  navigation.js  keyboard.js
│       ├── player.js  search.js  favorites.js  playlists.js  search-cache.js
│       ├── lyrics.js  lyric-lines.js            歌词加载 / 行定位纯函数
│       ├── components/     Sidebar SearchBox SongList SongRow PlayerBar
│       │                     LyricPanel PlaylistDialog PlaylistPicker Svg
│       └── assets/base.css 深色主题 + 布局
├── scripts/                  单测与打包自检（均离线，`npm test` 一次跑完）
├── build/                    图标源文件（electron-builder 构建输入）
├── release/                  打包输出（已忽略）
└── data/                     运行时生成（已忽略）
```

收藏与歌单的写入都是原子的：先写临时文件再 `rename`，且写入串行排队，避免并发写坏文件。

## 配置

`src/config.js`，支持环境变量覆盖（应用不读 `.env` 文件，直接读 `process.env`）：

| 配置 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `8788` | 监听端口。桌面版固定用 `0`，让系统分配空闲端口 |
| `PAGE_SIZE` | `50` | 每页条数。实测 100 及以上会触发 B 站风控 |
| `MAX_DURATION_SEC` | `1800` | 超过 30 分钟的视频不作为音乐结果返回 |
| `RESOLVE_CACHE_TTL_MS` | `5 分钟` | 音轨地址缓存 |
| `COOKIE_TTL_MS` | `10 分钟` | buvid cookie 有效期 |
| `DATA_DIR` | `仓库内 data/` | 运行时数据目录。桌面版由 Electron 注入为 userData |
| `PUBLIC_DIR` | `client/dist` | 前端产物目录 |

## 已知限制

- **只支持匿名访问**，没有登录能力。付费、会员、仅限粉丝观看的内容拿不到音轨地址，会像普通失败一样被跳过
- **音源是视频音轨，不是音频区**。实测 `api.vc.bilibili.com` 音频区接口全部 404、`search_type=audio` 返回 `-1200`、`playurl` 返回 `-400`，最后只保留视频搜索 + 视频页 `__playinfo__` 提取 DASH 音频这条通道
- **搜索会被 B 站风控拦下，而且拦得没有规律**。请求太密、`page_size` 太大、或 IP 信誉差（机房 IP 明显更严）时返回只有 `v_voucher` 的空响应。会被识别并提示，但**拦了就是拦了**——只重试一次，不做任何绕过
- **上游临时故障表现为播放失败**。CDN 限流、地址过期、后端 502 都走到同一个 `MEDIA_ERR_SRC_NOT_SUPPORTED`（code 4），浏览器不区分「地址坏了」和「暂时拿不到」，所以统一按「先重试一次再跳过」处理
- **歌词是按曲名猜的，不是这条视频的歌词**。阈值 0.6，偶有串版（同名翻唱、标题里没写歌手），面板底部标注了实际取自哪首歌、哪个来源
- **B 站不提供歌词**，两个外部源也都是按曲名匹配，不是按曲目 ID 精确取
- **收藏与歌单是本地单文件**，单机单用户，没有同步、没有账号、没有多端共享
- **需要联网**，不做离线缓存。断网时给中文提示，不白屏

## 许可与第三方

本项目代码按 **MIT** 许可授权，全文见根目录 `LICENSE`。

依赖的第三方组件均为 MIT：

| 组件 | 版本 | 用途 |
|---|---|---|
| [vue](https://github.com/vuejs/core) | 3.5.42 | 前端框架 |
| [element-plus](https://github.com/element-plus/element-plus) | 2.14.5 | UI 组件库 |
| [@element-plus/icons-vue](https://github.com/element-plus/element-plus) | 2.3.2 | 图标组件 |
| [express](https://github.com/expressjs/express) | 4.22.2 | 后端 HTTP 框架 |
| [electron](https://github.com/electron/electron) | 44.3.0 | 桌面外壳 |
| [electron-builder](https://github.com/electron-userland/electron-builder) | 26.15.3 | 打包工具（仅构建期） |

各自的完整许可文本随 `npm install` 一并安装，在 `node_modules/<包名>/LICENSE`。

打包产物内置 Electron，Electron 内置 Chromium。Chromium 依赖大量第三方开源项目（OpenSSL、Skia、libjpeg-turbo、libpng、FFmpeg 等），其版权声明随 Electron 官方发行包分发，见发行包里的 `LICENSES.chromium.html`（<https://github.com/electron/electron/blob/main/LICENSES.chromium.html>）；electron-builder 默认会把这份文件一并打入产物，分发你的构建时保留即可。

本项目运行时会访问 B 站、网易云音乐、QQ 音乐的公开接口。这些服务的内容、商标与名称归各自权利人所有，本项目不是官方产品，也未获得任何授权。

## 合规

**仅供个人本地使用。不要公开分发、不要商用、不要做批量抓取或爬取。** 本项目的后端只是为个人播放目的转发 B 站自己的 CDN 资源，请遵守 B 站的条款与版权要求。

歌词部分同样是这个前提下的取舍：

- 歌词取自网易云音乐与 QQ 音乐的公开接口，**每播放一首每来源只发一次搜索 + 一次取词请求**，不是批量抓取，也没有做任何频率放大。
- 歌词文本**只在内存里**，进程退出即消失：不写文件、不进 `localStorage`、不进 `data/`、不进任何备份或日志。只有「歌词面板是否打开」这个布尔开关会被持久化。歌单的曲目列表不含任何歌词内容，只存曲名、歌手和 bvid 这类元数据，因此歌单文件可以正常落盘。
- 匹配不到就显示「暂无歌词」，不会为了填满面板去放宽阈值。
- 如果版权方要求移除歌词功能，删掉 `src/api/lyrics.js` 与 `client/src/lyrics.js`、`client/src/lyric-lines.js`、`client/src/components/LyricPanel.vue`，并把 `routes.js` 里的 `/lyrics` 路由和 `api.js` 里的对应方法去掉即可，其余功能不受影响。
