# B 站音乐播放器

本地运行的 B 站音乐播放器：**搜索 → 在线流播放 → 收藏 → 歌单**。前后端都用 Node.js，界面全中文，深色主题，视觉与交互参考网易云音乐。

只做在线流播放，不做离线下载。收藏与歌单都写入本地 JSON 文件，重启不丢失。

## 快速开始

要求 Node.js 20+（在 Node 24 上开发验证）。

```bash
# 安装依赖 + 构建前端（一步到位）
npm run setup

# 启动，浏览器打开 http://127.0.0.1:8788
npm start
```

开发模式（前后端都热更新，前端跑在 Vite 的 5173，`/api` 自动代理到后端）：

```bash
npm run dev
```

`npm start` 用的是 `node server.js`，**不带 `--watch`**，所以改过后端代码要手动重启才生效。旧的进程不会自动退，还会继续占着 8788——这时候新起一个会报 `EADDRINUSE`，而页面上所有新增接口都会返回 `Cannot POST /api/xxx` 的 404，看起来像「功能报错了」，实际是打到了老进程上。排查这类问题时先确认后端是不是最新的（`curl -s http://127.0.0.1:8788/api/playlists` 应返回 JSON 而不是 HTML 错误页）。

其他脚本：

```bash
npm run build        # 只重新构建前端到 client/dist
npm run dev:server   # 只跑后端，带 --watch
npm run dev:client   # 只跑前端
```

前端产物在 `client/dist`，由后端直接托管。没构建时后端会返回明确的 503 提示，不会静默 404。

## 桌面应用

Electron 打包成单个 exe，双击即用，不需要装 Node：

```bash
npm run electron    # 开发调试：直接用本机 Electron 跑，不打包
npm run dist:dir    # 只出未压缩的应用目录，最快，验证打包链用
npm run dist:zip    # Windows 压缩包，解压后 exe 在根目录，双击即跑
npm run dist:win    # Windows 安装包 + 绿色免安装单文件 exe
npm run dist        # 打当前系统的安装包
```

产物在 `release/`：`*-portable.exe` 是单文件免安装版，NSIS 安装包可选安装目录并建桌面快捷方式，zip 解压即用。未压缩的应用目录约 371MB，压缩包约 154MB——大头是自带 Chromium，前端本身只有几 MB。

**`dist:win` 需要能访问 GitHub。** NSIS 和 WiX 的二进制只托管在 GitHub releases，electron-builder 会在打包时联网下载；网络不通就报 `connect ETIMEDOUT ... failedTask=build`。遇到这种情况用 `dist:zip` 或 `dist:dir`，两者不额外下载打包工具（zip 只多下一个 7z）。想换源可以设 `ELECTRON_BUILDER_BINARIES_MIRROR`，但常见的 npmmirror 只镜像了上游 NSIS，没有 electron-builder 重新打包的那个格式，实际换不过去。

**为什么是 Electron，不是 Tauri 或 PWA**：音频流必须经 Node 的 `fetch` 转发（CORS、防盗链、Range 透传、cookie 都在服务端），Tauri 的 Rust + 系统 WebView 塞不下这套逻辑，PWA 根本装不上后端。所以唯一合理形态是 Electron 主进程**同进程内**起 Express，再 `loadURL` 到那个本地端口。顺带说，前端不能用 `file://` 打开 `client/dist`——所有请求都是相对路径 `/api/...`。

为打包改动了 4 处，都是必须改的：

1. **端口用 0，不用 8788**（`electron/main.js`）。固定端口会和用户本机已有的服务冲突。`listen(0)` 让系统分配空闲端口，再从 `server.address().port` 拿真实值。监听地址保持 `127.0.0.1`——桌面应用不需要局域网访问，`0.0.0.0` 等于把带 B 站代理能力的服务暴露到整段局域网。
2. **`DATA_DIR` 指向 `app.getPath('userData')`**（`electron/env.js`）。打包后仓库目录在 `app.asar` 内，asar 里的 fs 是只读的，收藏写不进去。 userData 在 Windows 上是 `%APPDATA%/bilibili-music-player`。这个环境变量**必须在 `config.js` 被求值前设置**，所以 `env.js` 固定写在 `main.js` 的第一个 import 位置（ESM 按声明顺序求值），且不能 import 任何会间接引入 `config.js` 的模块。
3. **单实例锁**（`app.requestSingleInstanceLock`）。收藏是持久化文件，两个实例并发写会互相覆盖，这不是理论风险。第二次双击时聚焦已有窗口而不是再开一个。
4. **抽出 `createApp()` 工厂**（`src/createApp.js`）。原来 Express 应用在 `server.js` 里直接 `listen`，桌面端无法复用。现在工厂只构建应用不监听端口，`server.js`（CLI）和 `electron/main.js` 各自决定监听方式。`npm start` 行为不变。

**应用图标**是 B 站小电视，由 `scripts/make-icon.mjs` 用有向距离场（SDF）光栅化生成，零依赖、可离线重跑：`npm run icon`。图标在 `build/` 下，是 electron-builder 的构建输入，所以要进版本库。改 `LAYERS` 里的矢量定义就能换形状；改完重跑 `npm run dist` 才会进产物。

**系统托盘与关闭行为**：应用常驻一个托盘图标，点它恢复主窗口，右键菜单有「显示主窗口」和「退出」。点窗口右上角的关闭按钮**不会直接退出**，而是弹一个确认框，在「最小化到托盘」和「退出程序」之间选——默认停在「最小化到托盘」，所以误点只是隐藏窗口而不是把播放中的队列一起关掉。真要退出时主进程会先清掉托盘图标再断掉内嵌的 Express 服务，否则端口和托盘资源都留着。托盘图标用的是 `build/icon.png` 缩到 32×32，所以换图标要重跑 `npm run icon` 才会在托盘里生效。

生成脚本自带三重自检，画错会直接抛错而不是静默产出坏图标：大尺寸做关键采样点颜色校验，小尺寸做存在性校验（天线在设计空间只有 3.4 个单位宽，16px 下不足 1px，抗锯齿必然把它和底色混在一起，这是图标固有行为），另外把每个 PNG 反向解码回来和源像素逐字节比对，校验 ICO 目录的偏移与尺寸。脚本最后会打印 ASCII 预览，在没有截图能力的环境下也能肉眼确认图形。

还有一个没解决的事：

- **未签名，首次运行会被 Windows SmartScreen 拦**。未签名的 exe 第一次运行会弹红色警告，要点「更多信息 → 仍要运行」。需要代码签名证书（OV/EV）才能去掉，几百到一两千块一年——这不是代码问题。

数据位置：桌面版存 `%APPDATA%/bilibili-music-player/`（`favorites.json` 收藏、`playlists.json` 歌单），CLI 版存仓库里的 `data/` 下同名文件。两份互不相通，想换回 CLI 版听之前攒的收藏和歌单需要手动挪文件。这两个文件都是运行时生成的用户数据，不入库。

## 功能

- **搜索**：关键词 400ms 防抖，分页自动加载。每页 50 条，**翻过的每一页都存进 `localStorage`，本地做分页** —— 重新打开应用直接用缓存恢复，一个请求都不发；已经翻过的页也不会再请求。缓存最多记 6 个关键词、单个关键词 20 页、总量 1.5MB，超了按 LRU 丢最早的
- **搜索历史**：点击搜索框展开最近搜过的关键词，支持按当前输入过滤、单项删除、一键清空。回车提交或点选历史项才算一次搜索并写入历史；边打字的防抖搜索不写，否则打一个字存一条。最多留 30 条，重复提交会移到最前而不重复存储。历史只存在浏览器 `localStorage`，换浏览器或清缓存就没了
- **触底自动加载**：列表滚动接近底部时自动请求下一页，底部提示行会显示「正在加载下一页…」/「滚动到底部自动加载」/「没有更多了」，点击它也能立即加载。翻页不重置滚动位置；换成新关键词会回到顶部。B 站返回的 `total` 是估算值，可能出现「空列表但还有下一页」，所以空页一律视为到底，避免连环请求空页
- **被风控拦下不会被误报成「没有更多」**：B 站风控拦截请求时返回 `code=0`、`message="OK"`，但 `data` 里只有一个 `v_voucher`，没有 `result` / `numResults` / `numPages`。只判断 `code` 就会把它当成功，而 `numPages` 缺失会被算成 0，列表于是静默停在一页并显示「没有更多了」。现在后端识别这个字段，换一个 buvid 等 1.2 秒重试一次，还被拦就返回 429 和明确文案；前端收到错误**不清空已有列表、不重置 `hasMore`**，继续往下滚就能重试
  - 页大小实测：`page_size` 20 / 50 正常，100 及以上会触发风控，所以定在 50

自动加载的实现细节，改 `SongList.vue` 前值得知道：

- **`IntersectionObserver` 是主路径，`scroll` 监听兜底**。两者都汇到同一个 `checkLoad()`，靠 `loadMore()` 里的 `loading` / `hasMore` / `keyword` 三重守卫保证不会并发请求。
- **哨兵用 `v-show` 而不是 `v-if`**。哨兵必须一直在 DOM 里，`IntersectionObserver` 才能持续观察；换成 `v-if` 就得在每次条件变化时重新 `observe` / `unobserve`，而且 `display:none` 的元素在初始测量时报的永远是 `isIntersecting: false`。
- **提前量 `PRELOAD_PX = 360` 只写一处**，同时作为 `rootMargin` 和 `scroll` 兜底的判定阈值，不会两处漂移。
- **`watch(..., { flush: 'post' })` 不能省**。加载完成后要再判定一次，把撑不满一屏的短列表补满；默认 `flush: 'pre'` 会在 DOM 更新前跑，量到的是旧列表的几何位置，判定结果就是错的。
- **Element Plus 的弹层类名是连字符命名**（`el-autocomplete-suggestion`、`__header`、`__list`），不是 BEM 式的双下划线（`el-autocomplete__suggestion`），写错就整个下拉没有样式但内容照样渲染，很难察觉。
- **弹层被 `teleport` 到 `body`**，组件的 `<style scoped>` 打不到它，样式必须写在 `base.css` 里。
- **播放**：点行即播；队列默认是当前列表；支持暂停/继续、上一首/下一首、进度拖拽、音量
- **播放模式**：顺序播放 / 单曲循环 / 随机播放
- **失败自动跳过**：某首播放失败时先原地重试一次，仍失败就切下一首，并提示「已切到下一首」。连续 3 首失败则停止自动切换并说明原因，避免断网时把整个队列高速过完。单曲循环是用户明确的选择，不切歌，只原地重试到上限。停在失败状态后按播放键会重新发起加载
- **收藏**：星标乐观更新（先改界面再请求，失败自动回滚），独立收藏视图，侧边栏计数
- **歌单**：侧边栏自建歌单区，支持创建、重命名、删除（删除前确认）。每个歌单有独立视图，头部显示封面、歌数、更新时间，带「播放全部」；曲目可单行加进、可从歌单里移除、可拖拽之外的顺序维护。重名自动加「 2」「 3」后缀，歌单名最多 40 字
- **多选与批量加入**：列表右上角进多选模式，序号列换成勾选框（网格列不变，隐藏掉而不是改列宽，所以退出后布局不会抖），支持全选 / 取消 / 逐个勾选，顶栏显示已选数量。选中的歌可以整批加进指定歌单；选完自动退出多选模式。单选和批量共用同一条后端接口，返回 `added` / `skipped`，重复的曲目按 bvid 去重跳过，缺 bvid 的计入 skipped
- **续播**：每首歌的播放位置存 `localStorage`，下次打开同一首歌自动续播
- **歌词**：右侧滑入面板，当前行高亮并放大、自动滚到视野正中；点击任意一行跳到该时刻。进度条往前拖时歌词跟着回退。当前行已经在视野里就不自动滚，手动往上翻看时不会被顶回去。切歌时按曲名重新匹配，播放很快地切歌也不会串词（过期响应会被丢弃）。「收起」按钮或快捷键 `G` 关闭，开关状态记在 `localStorage`
  - 歌词来自**多个公开接口并行取**（目前网易云音乐 + QQ 音乐）：两边同时搜，候选放在同一把尺子上打分，取最像的一首取它的 LRC。单个源报错不会拖垮另一个，`Promise.allSettled` 收结果；取不到任何一条候选，两个源的结果都不会被丢掉
  - 打分是「曲名相似度 × 0.78 + 歌手能否在标题里对上 × 0.22」，再乘一个**时长因子**做裁决。时长从 QQ 源拿得到（`interval` 秒），网易云不带；因子按绝对差值分档：差 ≤6 秒给满分，6–30 秒从 1.0 线性降到 0.5，30–120 秒从 0.5 降到 0，超过 120 秒直接判 0。所以两源都命中同名歌时，时长对得上的那条会赢
  - **候选自己不带时长时给中性 0.88，不是 0**。这一点不能省：网易云的候选没有时长数据，如果按「缺时长 = 差值 0 = 满分」或者反过来「缺时长 = 差值无穷 = 0 分」处理，都会把对的候选打错。中性值让没时长的候选存活，同时让带精确时长的 QQ 命中仍然胜出
  - 标题噪音词（「百万豪装录音棚大声听」「原版」「C 调」）会额外扣 0.3，分数最后夹到 [0,1]，阈值 0.6 才认。匹配不上的常见原因：标题里全是修饰词、翻唱 / Remix / 纯伴奏谱、标题里夹了一整句歌词。这类直接显示「暂无歌词」，宁缺毋滥——不相关的歌词比空白更糟
  - 匹配到的不是原视频那一版时，面板底部会标注歌词实际取自哪首歌、哪个来源，方便发现串版
  - 歌词只在内存里，**不落盘、不进 `localStorage`、不进 `data/`**。只有「面板是否打开」这个开关会被持久化
  - 实现细节：行定位与滚动判定是纯函数（`client/src/lyric-lines.js`），不掺 DOM 和响应式，所以能在 Node 里直接单测；`LyricPanel.vue` 只负责渲染和把结果喂给 `scrollTo`
- **Media Session**：系统级锁屏/耳机/音量键控制，封面与曲目信息同步给系统
- **快捷键**（焦点在输入框或滑杆时不接管）：

  | 按键 | 作用 |
  |---|---|
  | `空格` | 播放 / 暂停 |
  | `←` `→` | 后退 / 前进 5 秒 |
  | `↑` `↓` | 音量 +/- |
  | `L` | 切换播放模式 |
  | `N` | 下一首 |
  | `P` | 上一首（已听 3 秒以上则先回到本曲开头） |
  | `G` | 显示 / 收起歌词面板 |

## 响应式适配

从桌面到手机同一套布局，按宽度分档，已实测的分辨率：1920×1080、1440×900、1024×768、768×1024、430×932、390×844、360×740、844×390。

| 断点 | 处理 |
|---|---|
| ≤1100px | 侧栏收窄，播放条间距收紧 |
| ≤900px | 侧栏更窄，隐藏播放数列 |
| ≤640px | 侧栏转为顶部横条（菜单横排），播放条转两行；触达目标放大到 40–44px；进度跑道加高并扩展命中区 |
| ≤380px | 隐藏时长列，封面缩到 38px |
| 高度 ≤500px 且横屏 | 播放条压到 72px，按钮缩小 |
| ≥1700px | 列表限宽 1300px 居中 |

几个为移动端专门处理的点，改 CSS 前值得知道：

- **`100dvh` 而不是 `100vh`**。移动浏览器的地址栏会让 `100vh` 大于可视高度，播放条会被压到地址栏后面。
- **列表用原生滚动，不用 `el-scrollbar`**。后者的虚拟 thumb 靠 wheel 事件驱动，触屏上没有 wheel 事件，thumb 位置会停滞错位，还会和原生滚动条重叠。
- **进度跑道的命中区比视觉区大**。10px 高的跑道手指很难点准，用透明伪元素把纵向可点范围扩到约 40px，视觉高度不变。
- **`touch-action: manipulation`** 去掉移动端点按延迟；`overscroll-behavior: none` 禁止滚动链，避免橡皮筋把播放条顶走。
- **刘海安全区**用 `viewport-fit=cover` + `env(safe-area-inset-*)` 处理。
- **故意不加 `user-scalable=no`**。禁用缩放是无障碍反模式。

不做的：PWA / manifest / Service Worker（涉及缓存策略，超出适配范围）。

## 架构

浏览器**无法直接播放 B 站音频**，所以必须走后端代理：

```
浏览器 ──搜索──▶ /api/search  ──▶ B 站搜索接口（注入 UA + buvid cookie）
浏览器 ──/api/stream/:bvid──▶ 后端解析音轨地址 ──▶ 后端代理转发 ──▶ B 站 CDN
```

三个绕不过去的限制，也是这套架构的原因：

1. **音频 CDN 不发 CORS 头**，浏览器直连会被拦截 → 后端转发，前端永远只请求 `/api/stream/...`
2. **音频 CDN 有防盗链**，缺 `Referer` 直接 403 → 后端固定注入 `Referer: https://www.bilibili.com/`
3. **图片 CDN（hdslb.com）也有防盗链**，Referer 来自非 bilibili 域名会返回 403 的 HTML 错误页 → 前端 `index.html` 里加了 `<meta name="referrer" content="no-referrer">`。**改 index.html 时别删这行，否则所有封面变空。**

另外几条踩过的坑，改代码前值得知道：

- **`__playinfo__` 的提取必须用括号配对，不能用正则**。它嵌在视频页 HTML 里，JSON 字符串内部含 `}`，贪婪正则会截错位置（`src/api/bilibili.js` 的 `extractPlayinfo`）。
- **搜索必须走带 WBI 签名的 `wbi/search/type`，不能退回 `search/all/v2`**。`all/v2` 完全忽略 `order` 参数（实测 0~5 返回同一顺序），没法按播放量排序；而 `wbi/search/type` 只认字符串枚举，`order=click` 就是播放量降序，且跨页严格单调（第 2 页最大值 ≤ 第 1 页最小值）。不带签名时该端点返回 `code=0` 但 `data` 里只有 `v_voucher`、结果为空——**静默失败**，看起来像「搜索不到」，实际是签名缺失。签名 key 正常应从 `nav.data.wbi` 取，但该端点要登录（匿名返回 `code=-101`），所以 `src/api/bilibili.js` 里固化了公开常量；上游轮换后同样会静默返回空，改那两个常量即可。
- **翻页终止条件必须用 `data.numPages` 判定，不能靠「空页即到底」**。请求超出总页数时上游会把 `page` 夹回 `numPages+1` 并重复返回同一页，而不是返回空列表；靠空页判断会无限加载重复的同一页。
- **音轨地址解析失败要重试**。buvid 被过度复用后，B 站会返回「`numResults = 1000` 但结果列表为空」的降级响应。代码识别这种响应就换一个 buvid 重试一次（`src/api/bilibili.js` 的 `searchSongs` / `resolveAudioUrl`）。
- **加载失败时 `audio.paused` 返回 `false`**。元素处于「无媒体」状态，所以不能用 `!a.paused` 判断「正在播放」。失败处理里用 `state.status === 'playing'` 过滤切歌遗留的旧 error 事件（`client/src/player.js`）。这个坑在 `togglePlay` 里也踩过：失败态点播放键会被判成「正在播放」而走成 `pause()`，所以失败分支必须放在 `!a.paused` 判断之前。
- **`MediaError.code === 1`（ABORTED）不是失败**。它是我们自己切歌打断上一个加载时产生的，必须排除，否则会误判成失败去重试。

播放链路细节：搜索拿到 `bvid` → 抓视频页 → 从 `__playinfo__` 里选带宽最高的 DASH `audio[].baseUrl` → 缓存 5 分钟（避免每次 Range 都重新抓 230KB 的 HTML）→ 代理转发。

代理必须透传 `Content-Length`：206 响应的分段长度靠它界定，缺失时 `<audio>` 会永远卡在 loading。

代理层还有三道防御，都是实测踩出来的（`src/api/stream.js`）：

- **上游回 HTML 错误页时不要转发**。CDN 限流或音轨地址失效时会返回 HTML 错误页，**有时还带 206 状态码**。直接转发会让 `<audio>` 拿到无法解码的文本：`duration` 永远为 0、进度条卡住，客户端既播不了也报不出可读的错误。所以在提交任何响应头之前先校验状态码与 `Content-Type`，异常时改回 JSON 502 并清掉音轨地址缓存（下次请求重新解析）。
- **`AbortSignal.timeout` 只能挂在「建连到拿到响应头」这一段**。实测确认这个 signal 在响应体读取期间仍然生效——如果直接挂在 `fetch` 上，播放到超时值附近就会被掐断，而歌曲时长远大于该值。所以要手动 `setTimeout` + `clearTimeout`。
- **CDN 不回 `Content-Length` / `Content-Range` 时不要设成字符串 `"null"`**，那比不设置更糟。

m4s 是渐进式 DASH（`ftyp → moov → sidx → (moof+mdat)*`），`moov` 在前，所以拖进度条的 Range seek 直接可用，不需要先下完整个文件。

## 后端 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/search?keyword=&page=` | 搜索，返回 `{keyword, page, list, total, hasMore}`。被风控拦下时是 `429 + {error: "搜索请求被 B 站风控拦下了，稍后再试一次"}`，不是空列表 |
| GET | `/api/stream/:bvid` | 音频字节流，支持 `Range` / `Content-Range` / `Accept-Ranges` |
| GET | `/api/lyrics?title=&artist=&durationSec=` | 按曲名取歌词，返回 `{ lines: [{time, text}], found, match, source }`。`durationSec` 用于给候选按时长接近度打分，**不是必填**，没有时按中性分处理。查不到是 `200 + found=false`，不是报错；缺曲名才 400 |
| GET | `/api/probe/:bvid` | 音轨可用性探测，返回时长与带宽。**前端目前没调用**，留着给「播放前预检」这类改进用 |
| GET | `/api/favorites` | 全部收藏 |
| POST | `/api/favorites` | 收藏一首（body 含 `bvid`），重复收藏返回 200（幂等），首次 201 |
| GET | `/api/favorites/check?ids=` | 批量查询收藏状态 |
| DELETE | `/api/favorites/:id` | 取消收藏，不存在返回 404 |
| GET | `/api/playlists` | 歌单摘要列表（不含曲目），按更新时间倒序 |
| POST | `/api/playlists` | 创建歌单，body `{name}`；空名字回落默认名，重名自动加后缀 |
| GET | `/api/playlists/:id` | 歌单详情，含曲目；不存在 404 |
| PUT | `/api/playlists/:id` | 重命名，body `{name}`；返回 `{playlist, oldName}` |
| DELETE | `/api/playlists/:id` | 删除歌单，返回被删的详情 |
| POST | `/api/playlists/:id/songs` | 批量加歌，body `{songs: [{bvid, title, ...}]}`；返回 `{playlist, added, skipped}`，按 bvid 去重。空数组返回 400 |
| DELETE | `/api/playlists/:id/songs/:bvid` | 从歌单移除一首，返回 `{removed, playlist}` |
| PUT | `/api/playlists/:id/songs/order` | 重排曲目顺序，body `{songs: [bvid, ...]}`；顺序外的 id 会被丢弃 |

统一错误格式 `{ "error": "中文说明" }`。

## 目录结构

```
├── server.js                 CLI 入口：读取配置并监听端口
├── electron/
│   ├── main.js               桌面主进程：单实例锁、PORT=0、窗口与导航守卫、系统托盘
│   └── env.js                在 config.js 求值前注入 DATA_DIR
├── src/
│   ├── config.js             端口、UA、超时、缓存时长
│   ├── createApp.js          构建 Express 应用（不监听端口），CLI 与桌面共用
│   ├── routes.js             全部路由
│   ├── api/http.js           请求封装、buvid cookie、Referer 注入
│   ├── api/bilibili.js       搜索 + 音轨解析 + Song 模型
│   ├── api/stream.js         音频流代理（Range 透传）
│   ├── api/lyrics.js         LRC 解析、曲名清洗、多源匹配（网易云 + QQ）、时长打分、内存缓存
│   ├── store/favorites.js    收藏持久化（原子写入）
│   └── store/playlists.js    歌单持久化（原子写入）
├── scripts/dev.js            同时起前后端的开发脚本
├── scripts/verify-stream-guard.mjs  流代理防御逻辑的离线回归测试（不依赖网络）
├── scripts/test-lyrics.mjs   歌词匹配与 LRC 解析的离线单测（不联网）
├── scripts/test-lyrics-multisource.mjs  多源匹配与时长假造 fetch 的单测（不联网）
├── scripts/test-lyric-lines.mjs  前端歌词行定位逻辑的单测（不依赖 DOM）
├── scripts/test-search-response.mjs  搜索响应分类的单测（正常 / 风控 / 报错）
├── scripts/test-search-cache.mjs     本地搜索页缓存的单测（不依赖 localStorage）
├── scripts/test-playlists.mjs        歌单 store 的单测（用 tmpdir，不碰仓库内 data/）
├── scripts/verify-lyrics-route.mjs  /api/lyrics 路由接线自检（不监听端口）
├── scripts/verify-batch-add-e2e.mjs 批量加歌全链路自检（只监听随机端口，跑完即关）
├── scripts/probe-lyrics-live.mjs    联网实测：拿真实搜索结果看匹配质量
├── client/                   Vite + Vue 3 + Element Plus
│   └── src/
│       ├── App.vue  main.js  state.js  prefs.js  navigation.js  keyboard.js
│       ├── player.js  search.js  favorites.js  playlists.js
│       ├── lyrics.js  lyric-lines.js          歌词加载 / 行定位纯函数
│       ├── search-cache.js                   本地分页缓存（LRU + 字节预算）
│       ├── api.js  utils.js  icons.js
│       ├── components/       Sidebar SearchBox SongList SongRow PlayerBar LyricPanel
│       │                       PlaylistDialog PlaylistPicker Svg
│       └── assets/base.css   深色主题 + 布局
├── release/                  electron-builder 输出（已忽略）
└── data/                     运行时生成（favorites.json、playlists.json，均已忽略）
```

收藏与歌单的写入都是原子的：先写临时文件再 `rename`，且写入串行排队，避免并发写坏文件。

## 配置

`src/config.js`，支持环境变量覆盖：

| 配置 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `8788` | 监听端口 |
| `PAGE_SIZE` | `50` | 每页条数。实测 100 及以上会触发 B 站风控，所以定在 50；前端会把每页缓存到本地，页大一点只影响首次加载速度 |
| `MAX_DURATION_SEC` | `1800` | 超过 30 分钟的视频不作为音乐结果返回 |
| `RESOLVE_CACHE_TTL_MS` | `5 分钟` | 音轨地址缓存 |
| `COOKIE_TTL_MS` | `10 分钟` | buvid cookie 有效期 |
| `DATA_DIR` | `仓库内 data/` | 收藏等运行时数据目录。桌面版由 Electron 注入为 userData（见上节） |
| `PUBLIC_DIR` | `client/dist` | 前端产物目录。桌面版自动指向 asar 内的产物，一般不用管 |

## 已知限制

- **只支持匿名访问**，没有登录能力。付费、会员、仅限粉丝观看的内容拿不到音轨地址。因为播放失败会自动跳过，这类曲目会像普通失败一样被跳过并提示一次，不会停下等你确认——批量听的时候要注意。
- **上游临时故障会表现为播放失败**。CDN 限流、音轨地址过期、后端 502 都会走到同一个 `MEDIA_ERR_SRC_NOT_SUPPORTED`（code 4），浏览器不会区分「地址坏了」和「暂时拿不到」，所以客户端统一按「先重试一次，再跳过」处理。后端在失败时已经清掉音轨地址缓存，重试会重新解析到一个新地址，多数临时故障一次重试就能恢复。
- **音源是视频音轨，不是音频区**。原本计划做「音频区 + 视频音轨」双源，但实测 `api.vc.bilibili.com` 的音频区接口全部 404、`search/type?search_type=audio` 返回 `-1200`（被降级），`playurl` 接口返回 `-400`。最后只保留了唯一可用的通道：视频搜索 + 视频页 `__playinfo__` 提取 DASH 音频。
- **收藏是本地单文件**，单机单用户，没有同步、没有账号、没有多端共享。
- **需要联网**，不做离线缓存。断网时给出中文提示，不白屏。
- 搜索结果是 B 站视频搜索的结果，长尾词可能混入非音乐内容；超过 30 分钟的条目会被过滤掉。
- **搜索会被 B 站风控拦下，而且拦得没有规律**。请求太密、`page_size` 太大、或 IP 信誉差（机房 / 数据中心 IP 明显更严）时，会返回只有 `v_voucher` 的空响应。现在会被识别并提示，不会静默停列表，但**拦了就是拦了** —— 只重试一次，不做任何绕过。家用宽带一般没事；连续翻很多页仍被拦时，等几分钟再试，或先让列表用本地缓存顶着。
- **歌词是按曲名猜出来的，不是这条视频的歌词**。匹配靠曲名相似度 + 歌手 + 时长打分，阈值 0.6，所以偶有串版（同名翻唱、标题里没写歌手）。面板底部标注了实际取自哪首歌、哪个来源，看一眼就能发现。
- **歌单是本地单文件**，跟收藏一样是单机单用户，没有同步、没有账号、没有多端共享。
- **B 站不提供歌词**，所以没有「视频自带歌词」这条路可走；两个外部源也都是按曲名匹配，不是按曲目 ID 精确取。

## 合规

**仅供个人本地使用。不要公开分发、不要商用、不要做批量抓取或爬取。** 本项目的后端只是为个人播放目的转发 B 站自己的 CDN 资源，请遵守 B 站的条款与版权要求。

歌词部分同样是这个前提下的取舍：

- 歌词取自网易云音乐与 QQ 音乐的公开接口，**每播放一首每来源只发一次搜索 + 一次取词请求**，不是批量抓取，也没有做任何频率放大。
- 歌词文本**只在内存里**，进程退出即消失：不写文件、不进 `localStorage`、不进 `data/`、不进任何备份或日志。只有「歌词面板是否打开」这个布尔开关会被持久化。歌单的曲目列表不含任何歌词内容，只存曲名、歌手和 bvid 这类元数据，因此歌单文件可以正常落盘。
- 匹配不到就显示「暂无歌词」，不会为了填满面板去放宽阈值。
- 如果版权方要求移除歌词功能，删掉 `src/api/lyrics.js` 与 `client/src/lyrics.js`、`client/src/lyric-lines.js`、`client/src/components/LyricPanel.vue`，并把 `routes.js` 里的 `/lyrics` 路由和 `api.js` 里的对应方法去掉即可，其余功能不受影响。
