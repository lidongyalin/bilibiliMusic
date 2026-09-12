# B 站音乐播放器

本地运行的音乐播放器：**本地曲库 + B 站搜索 → 播放 → 收藏 → 歌单**。Node.js + Express 后端，Vue 3 + Element Plus 前端，深色主题，界面全中文，视觉与交互参考网易云音乐。

不下载 B 站歌曲，也不做任何离线缓存。本地音乐只播放磁盘上你已有的文件，B 站走在线流。收藏、歌单、播放历史与本地曲库索引都写在本机，重启不丢失。

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

### 三种窗口

前端是同一个构建产物，用 URL 参数分窗，`client/src/desktop.js` 里的 `renderMode()` 决定挂哪个根组件：

| 参数 | 窗口 | 说明 |
|---|---|---|
| （无） | 主窗 | 完整的库 / 搜索 / 播放界面 |
| `?mode=mini` | 迷你模式 | 无边框小播放器，`alwaysOnTop`，只显示封面、曲名和上一首/播放暂停/下一首 |
| `?mode=desktop-lyrics` | 桌面歌词 | 无边框透明浮层，字号 / 颜色 / 透明度 / 描边可调，滚轮逐 0.25 秒校准时序，可锁定 |

三个窗口的状态通过 preload 桥（`electron/preload.cjs`）同步：主窗 `pushState`，辅助窗收到后跟着变；辅助窗按钮反向 `sendCommand` 回主窗。辅助窗窗口建在 `backgroundThrottling: false` 上——否则系统会把后台窗口降频，CSS 过渡和歌词滚动会卡死在中间态。

preload 用 `.cjs` 扩展名是刻意的：沙箱 preload 必须是 CommonJS，而本仓库 `package.json` 里有 `"type": "module"`，`.js` 会被解析成 ESM 然后直接报 `Cannot use import statement outside a module`。

### 桌面版独有

- **迷你模式与桌面歌词有两个入口**：托盘右键菜单，以及「设置 → 桌面窗口」里的开关。以前只有托盘这一条路——开发模式下托盘图标算错了目录（`app.getAppPath()` 在 `electron electron/main.js` 这种跑法下返回的是 `electron/` 不是仓库根），四个候选路径全落空，托盘建不起来，这两个功能就整体消失

- **文件夹监控**：注册进曲库的文件夹会挂 `fs.watch`，新增 / 删除 / 改名后 2 秒防抖自动重扫，正在扫描时跳过。需要重启应用才生效
- **全局快捷键**：`Ctrl` + `Alt` + `空格` 播放/暂停、`Ctrl` + `Alt` + `←`/`→` 切歌，窗口不在前台也能用。设置里关掉就只留窗口内的快捷键
- **Windows 缩略图工具栏**：任务栏缩略图上一首 / 播放暂停 / 下一首加进度条。图标是运行时用 `electron/icons.js` 画的位图 ICO（零依赖，自带字节级自检），写到临时目录再用 `nativeImage.createFromPath` 读——asar 内的路径 `createFromPath` 读不到
- **关闭行为与确认**：见[功能](#功能)一节

数据位置：桌面版在 `%APPDATA%/bilibili-music-player/`，CLI 版在仓库内 `data/`。两份互不相通，需要时手动挪文件。

未签名，首次运行会被 Windows SmartScreen 拦，要点「更多信息 → 仍要运行」——需要代码签名证书才能去掉，这不是代码问题。

## 功能

### 本地音乐

- **导入曲库**：选文件夹递归扫描，支持 MP3 / FLAC / M4A / M4B / AAC / MP4 / OGG / OPUS / WAV / WebM。标签解析零依赖（ID3v1/v2、Vorbis Comment、MP4 `ilst`、RIFF `INFO`），曲名、歌手、专辑、内嵌封面全部从文件里读；读不到才回落文件名；位率优先用标签里的，没有就按文件大小除以时长估算成 kbps。单个文件超过 200MB 直接跳过，免得扫进录屏
- **本地流播放**：走 `/api/local/stream/:id` 代理并透传 `Range`，拖进度、断点续传都不下载整文件。曲库用 `bvid = local-<id>` 与在线曲目标识区分，队列里两类可以混排
- **曲库浏览**：按歌手 / 专辑 / 文件夹分组下钻，任意一层都能「播放全部」或加进歌单
- **排序与筛选**：标题 / 歌手 / 专辑 / 时长 / 添加时间多字段排序，按文件夹与格式过滤
- **本地歌词**：自动找同名 `.lrc` 或含 `[mm:ss.xx]` 时间标记的 `.txt`，双语文件（一行两个时间标记）取第一个。**本地歌词也是每次现读，后端不建任何缓存**，进程不持有歌词文本
- **歌词校准**：歌词面板上的 −/+ 逐 0.1 秒调偏移，桌面歌词窗用滚轮微调。偏移**按曲目存一个数字**，只存偏移量不存歌词
- **音效**：9 段图形均衡器（60Hz 低架 / 120–8k 峰 / 16k 高架，每段 ±12dB）+ 8 组一键预设；总增益 ±15dB 与左右声道平衡，对本地与在线曲目都生效
- **音量均衡**：学习式响度归一——播放时从分析节点采样每首的 RMS（约 8 秒出数），下次播它自动补偿，曲与曲之间不再忽大忽小。补偿上限 ±12dB，目标响度 RMS 0.10（约 -20dBFS）；首次播放一首不补偿，宁可那几秒不齐也不拿猜的值乱拉。只存每首一个数字，设置里可清空重学
- **倍速**：0.5× / 0.75× / 1× / 1.25× / 1.5× / 1.75× / 2×，逐曲生效，切歌恢复默认
- **播放队列**：独立面板，可拖拽重排、移出、清空
- **智能歌单**：按歌手 / 专辑 / 文件夹自动聚合成可直接播放的分组，随时重算，不落盘成静态列表
- **播放历史**：自动记录播放过的曲目，按时间倒序与最常播放两个视角，可直接续播
- **元数据编辑**：右键编辑标题 / 歌手 / 专辑，存成本地覆盖层，**不改动原始文件的标签**——随时可以一键还原回文件里读到的值
- **批量管理**：多选后能播放选中、整批加进歌单、整批移出曲库（移出只删索引，磁盘文件保留）、**整批改标签**（歌手/专辑/专辑歌手/流派/年份，留空的不动，一次请求写一批；标题刻意不给批量改——把整个选区改成同一个标题等于毁掉曲库）
- **重复检测**：标题、歌手、时长（取整秒）三者完全一致判为一组，弹窗按组展示，可直接播放或移出。文件从磁盘被删走或挪走时不会立刻删掉索引，而是标成残缺并从列表里隐藏，下次重扫扫回来了会自动恢复
- **m3u 导入导出**：纯本地路径，不联网，也不改原文件
- **睡眠定时**：15 / 30 / 45 / 60 / 90 / 120 分钟后自动暂停，或「播完当前曲后停止」；到点前 20 秒开始把音量线性压到地板再停，不循环，随时可取消。切歌会清掉「播完即停」——那个意图跟着那首歌走
- **无缝播放**：切歌前预载下一首音频，消除两首之间的静默间隔
- **沉浸式播放页**：全屏封面 + 实时频谱可视化
- **主题**：暗 / 浅主题加 6 种强调色，界面偏好存 `localStorage`

### B 站在线

- **搜索**：400ms 防抖 + 触底自动加载。每页 50 条，翻过的每一页都存进 `localStorage` 本地分页——重新打开直接用缓存恢复，一个请求都不发。缓存最多记 6 个关键词、单个关键词 20 页、总量 1.5MB，超了按 LRU 丢最早的
- **搜索历史**：点搜索框展开最近搜过的词，可按当前输入过滤、单项删除、一键清空。最多 30 条，只存浏览器 `localStorage`
- **风控不会误报成「没有更多」**：B 站风控拦截时返回 `code=0` 但 `data` 里只有 `v_voucher`。后端识别后换 buvid 等 1.2 秒重试一次，还被拦返回 429 和明确文案；前端不清空已有列表，继续往下滚就能重试
- **播放**：点行即播，队列默认是当前列表。暂停/继续、上一首/下一首、进度拖拽、音量、顺序/单曲循环/随机三种模式。队列里本地曲目和 B 站曲目可以混排，切歌逻辑同一套
- **失败自动跳过**：某首失败先原地重试一次，仍失败切下一首并提示。连续 3 首失败停止自动切换，避免断网时把整个队列高速过完
- **收藏**：星标乐观更新（先改界面再请求，失败自动回滚），独立收藏视图，侧栏计数
- **歌单**：创建、重命名、删除（删除前确认）。独立视图带封面、歌数、更新时间、「播放全部」。可单行加进、从歌单移除、重排顺序。重名自动加「 2」「 3」后缀
- **多选与批量加入**：列表右上角进多选模式，序号列换成勾选框，支持全选/取消/逐个勾选，选中后可整批加进指定歌单。单选和批量共用同一条后端接口，重复曲目按 bvid 去重跳过
- **长列表虚拟化**：按滚动位置只渲染可见区间 + 上下各 8 行缓冲，其余用占位撑起总高度。1001 首歌单一屏只挂 18 行：主线程最长阻塞从 5143ms 降到 321ms，DOM 节点从 23384 降到 1015。
  5000 首实测（`node scripts/perf-library.mjs 5000`）：后端扫描入库 705ms、列表接口 92ms、冷启动 399ms、批量改 500 首标签 60ms；浏览器端滚动 34 万 px 零长任务、筛选每键 ≤31ms、DOM 稳定在 1300 左右
- **续播**：播放位置存 `localStorage`，下次打开同一首歌自动续播
- **歌词**：右侧滑入面板，当前行高亮放大并自动滚到视野正中，点击任意一行跳到该时刻。本地曲目优先读同名 `.lrc` / `.txt`；在线曲目多来源并行取（网易云音乐 + QQ 音乐），按「曲名相似度 + 歌手 + 时长」打分取最贴合的一条，匹配不到显示「暂无歌词」而不是放宽阈值硬塞。**歌词只在内存里，不落盘、不进 `localStorage`、不进 `data/`**，只有「面板是否打开」这个开关和「逐曲偏移秒数」会持久化
- **Media Session**：系统级锁屏/耳机/音量键控制
- **系统托盘**：常驻托盘图标，右键菜单能直接在托盘上完成「播放 / 暂停、上一首、下一首、静音、音量 ±10%、迷你模式、桌面歌词、显示主窗口、退出」。菜单项标题跟着当前曲目和播放状态更新（正在播放 / 已暂停 + 进度百分比），图标也随播放暂停切换。Windows 上任务栏缩略图工具栏额外挂了上一首 / 播放暂停 / 下一首和一根进度条
- **关闭行为**：点窗口关闭按钮有三种可配的行为——「询问我」（默认，问最小化到托盘还是退出）、「收进托盘继续播放」、「直接退出」，另有一个「每次都确认」开关。误点只是隐藏窗口，播放不中断
- **快捷键**（焦点在输入框或滑杆时不接管）：

  | 按键 | 作用 |
  |---|---|
  | `空格` | 播放 / 暂停 |
  | `←` `→` | 后退 / 前进 5 秒 |
  | `↑` `↓` | 音量 +/- |
  | `L` | 切换播放模式 |
  | `N` / `P` | 下一首 / 上一首 |
  | `G` | 显示 / 收起歌词面板 |
  | `Q` | 显示 / 收起播放队列 |
  | `E` | 打开 / 关闭均衡器 |
  | `I` | 沉浸式播放页 |
  | `Ctrl` + `,` | 打开设置 |
  | `Esc` | 按优先级关一个浮层（设置 → 元数据 → 均衡器 → 队列 → 沉浸页 → 右键菜单） |

  桌面版还有全局快捷键（窗口不在前台也能用，可在设置里关掉）：`Ctrl` + `Alt` + `空格` 播放/暂停，`Ctrl` + `Alt` + `←`/`→` 上一首 / 下一首。

## 视觉与响应式

深色主题对齐网易云音乐桌面版：强调色用网易云红 `#EC4141`（不是粉色），底色是纯中性炭黑 `#121212` 不带紫蓝调，侧栏选中态是「深一档灰底 + 白字」而不是整块强调色，强调色只落在图标上。所有变量集中在 `client/src/assets/base.css` 顶部。

Element Plus 的变量在两个主题类下都有映射（`html.dark` 与 `html.light`），主色梯度（`light-3/5/7/8/9`）由 `theme.js` 按当前强调色现场推导——浅色往白混、深色往黑混。之前浅色主题没有这段映射，EP 的 `--el-color-primary` 一直是默认蓝 `#409eff`，切强调色对开关、单选钮、下拉高亮毫无作用。

配色有两档文字：`--text-dim` 承载歌手名这类次级信息，`--text-faint` 承载时长 / 播放量 / 序号 / 播放时间。后者曾经是深色 `#666`（在 `#121212` 上 3.26:1）、浅色 `#aaa`（在白底上 2.32:1），都低于 WCAG AA 的 4.5:1，现在是深色 `#8a8a8a`（5.4:1）、浅色 `#7d7d7d`（4.1:1）。**改这两个值前先算对比度**——它们看着是「装饰灰」，实际承载的是必要信息。调色板真正生效的地方是 `client/src/theme.js` 的 `LIGHT` / `DARK` 两张表，`base.css` 的 `:root` 只是首屏兜底，两边必须同步。

播放队列面板和歌词面板一样停在播放条上沿（`height: calc(100% - var(--bar-real-h, var(--bar-h)))`），不盖住播放条右侧的音量 / 倍速 / 定时 / 歌词 / EQ / 设置。滚动条大拇指用 `--scrollbar-thumb`，两个引擎（Chromium 的 `::-webkit-scrollbar` 和 Firefox 的 `scrollbar-color`）一个色。

一套布局从桌面覆盖到手机，按宽度分档，已实测 1920×1080 / 1440×900 / 1024×768 / 768×1024 / 430×932 / 390×844 / 375×667 / 360×740 / 320×568 / 844×390：

| 断点 | 处理 |
|---|---|
| ≤1100px | 侧栏收窄 |
| ≤900px | 侧栏更窄，隐藏播放数列 |
| ≤640px | 侧栏转顶部横条，播放条转两行，触达目标放大到 40–44px；行内「加入歌单」收进长按菜单，只留收藏，操作列从 82px 降到 40px，390px 下曲名可用宽度 140px → 180px |
| ≤380px | 隐藏时长列，封面缩到 38px；顶栏图标缩到 36px，搜索框 `min-width: 0` 让它吸收挤压，操作列改为 `auto` 防止按钮溢出到曲名上 |
| 高度 ≤500px 且横屏 | 播放条压到 72px |
| ≥1700px | 列表限宽 1300px 居中 |

手机竖栏的网格轨道写成 `minmax(0, 1fr)` 而不是 `1fr`：`1fr` 等价于 `minmax(auto, 1fr)`，`auto` 那端取子元素的 min-content，而手机顶栏的搜索框 + 4 个图标 + 歌单按钮加起来超过 320px，会把整条轨道撑到 328、页面跟着横滚。

顶栏的菜单项选择器必须写成 `.sidebar .el-menu.el-menu--vertical .el-menu-item`（四段类）。Element Plus 的 `.el-menu--vertical:not(.el-menu--horizontal) .el-menu-item` 是 0,3,0，而 `element-*.css` 在 `index.html` 里排在应用样式之后，只写 `.sidebar .el-menu-item` 同样是 0,3,0 就会输掉：`padding: 0` 和 `justify-content: center` 被压掉，`padding-left: 20px` 仍然生效，图标被挤到按钮右边 10px 并溢出边界。别把这个选择器「简化」回去。

移动端专门处理了 `100dvh`（`100vh` 在移动浏览器里大于可视高度）、刘海安全区（`viewport-fit=cover` + `env(safe-area-inset-*)`）、进度跑道命中区扩展、`touch-action: manipulation`。故意不加 `user-scalable=no`——禁用缩放是无障碍反模式。`prefers-reduced-motion` 下歌词滚动与手机端底部弹层（Action Sheet / 歌单下拉 / 遮罩 / 弹窗）的入场动画全部关闭；它们的静止位置由 `bottom` / `top` / `margin` 直接给出，关掉不会错位。

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

本地播放器（`src/routes-local.js`，全部只碰本机磁盘）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/library` | 曲库与文件夹列表，含总数 |
| GET | `/api/library/progress` | 扫描进度（是否在进行中、已完成数） |
| POST | `/api/library/folders` | 注册文件夹并扫描，body `{path}` |
| DELETE | `/api/library/folders/:id` | 移除文件夹及其下曲目 |
| POST | `/api/library/repair` | 重扫已注册文件夹：补新增、把磁盘上不存在的标成残缺 |
| GET | `/api/library/groups` | 分组摘要（按歌手 / 专辑 / 文件夹） |
| GET | `/api/library/group` | 单个分组的曲目，query `type` + `key` |
| GET | `/api/library/duplicates` | 重复检测：标题 + 歌手 + 时长三者一致的曲目分组 |
| GET | `/api/library/:id` | 单曲详情（含标签、路径、标签来源） |
| PUT | `/api/library/:id` | 存本地覆盖（**不改原文件标签**），body 可带 `title` / `artist` / `album` / `albumArtist` / `year` / `track` / `genre`；填回原值等于撤销这一项 |
| DELETE | `/api/library/:id/override` | 清掉全部覆盖，回到文件里的标签 |
| POST | `/api/library/remove` | 批量移出曲库，body `{ids}` |
| POST | `/api/library/meta-batch` | 批量改本地标签覆盖（F28），body `{ids, patch}`；只认 artist/album/albumArtist/year/genre，留空不动 |
| GET | `/api/library/export-m3u` | 导出 m3u（query `ids`，缺省全部） |
| POST | `/api/library/import-m3u` | 导入 m3u，body `{text}` |
| GET | `/api/local/stream/:id` | 本地音频字节流，透传 `Range` |
| GET | `/api/local/cover/:id` | 封面：内嵌封面优先，没有则 404 让前端画占位 |
| GET | `/api/local/lrc/:id` | 读同名 `.lrc` / `.txt` 原文，**每次现读，不缓存** |
| GET | `/api/history` | 播放历史，按时间倒序 |
| GET | `/api/history/most-played` | 最常播放排行 |
| POST | `/api/history` | 记一条播放记录 |
| DELETE | `/api/history` | 清空历史 |
| DELETE | `/api/history/:id` | 删一条 |
| GET | `/api/smart` | 智能歌单分组（歌手 / 专辑 / 文件夹），实时计算 |
| GET | `/api/settings` | 桌面与播放器设置 |
| PUT | `/api/settings` | 更新设置，只接受已知键，非法值丢弃而不是回落默认 |

统一错误格式 `{ "error": "中文说明" }`。

## 目录结构

```
├── server.js                 CLI 入口：读配置并监听端口
├── electron/                 桌面主进程
│   ├── env.js                桌面版环境变量（PORT=0、DATA_DIR=userData）
│   ├── main.js               单实例锁、托盘、缩略图栏、三种窗口、全局快捷键、文件夹监控
│   ├── preload.cjs           渲染进程桥（必须是 CJS，见「三种窗口」一节）
│   └── icons.js              缩略图栏图标：字符画 → 位图 ICO，自带字节级自检
├── src/
│   ├── config.js             端口、UA、超时、缓存时长
│   ├── createApp.js          构建 Express 应用（不监听端口），CLI 与桌面共用
│   ├── routes.js             B 站在线相关路由
│   ├── routes-local.js       本地播放器全部路由
│   ├── api/http.js           请求封装、buvid cookie、Referer 注入
│   ├── api/bilibili.js       搜索 + 音轨解析
│   ├── api/stream.js         音频流代理（Range 透传）
│   ├── api/lyrics.js         LRC 解析、多源匹配（网易云 + QQ）、时长打分
│   ├── api/localtags.js      零依赖标签解析（ID3 / Vorbis / MP4 / RIFF）与时长探测
│   └── store/                favorites 歌单 / library 曲库 / history 历史 / settings 设置，全部原子写入
├── client/                   Vite + Vue 3 + Element Plus
│   └── src/
│       ├── App.vue  main.js  state.js  prefs.js  navigation.js  keyboard.js
│       ├── views.js  desktop.js  theme.js  utils.js  api.js  icons.js
│       ├── player.js  audio-engine.js        播放器与 WebAudio 音效链
│       ├── search.js  search-cache.js  favorites.js  playlists.js
│       ├── library.js  history.js            本地曲库 / 播放历史的客户端封装
│       ├── lyrics.js  lyric-lines.js  menu.js 歌词加载 / 行定位纯函数 / 右键菜单状态
│       ├── DesktopMini.vue  DesktopLyrics.vue        迷你窗与桌面歌词窗的根组件
│       ├── components/     Sidebar SearchBox SongList SongRow PlayerBar
│       │                     LyricPanel QueuePanel EqualizerPanel Immersive
│       │                     MetaEditor SettingsDialog ContextMenu
│       │                     PlaylistDialog PlaylistPicker Svg
│       └── assets/base.css 深色主题 + 布局 + 三个窗口的样式
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

- **本地曲库格式有限**，只认 MP3 / FLAC / M4A / M4B / AAC / MP4 / OGG / OPUS / WAV / WebM。APE、DSF、Tidal 这类格式不解析，扫描时直接跳过
- **文件夹监控依赖 `fs.watch`**，不支持的挂载（部分网络盘、某些 NAS 协议）不会自动同步，只能手动点「重新扫描」。监控本身需要重启应用才生效
- **智能歌单是实时算的**，曲库里几千首歌时分组列表会有可感知的延迟；它不落盘成静态列表，就是为了标签改了不用重算
- **曲库索引不跨机器同步**，也没有云端备份。换电脑就得重新扫一遍
- **不会写回原始文件的标签**。元数据编辑全部存成本地覆盖层，磁盘上的文件一个字节都不改。这是有意的：避免误改用户自己的文件，代价是换台电脑覆盖就没了
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
- 歌词文本**只在内存里**，进程退出即消失：不写文件、不进 `localStorage`、不进 `data/`、不进任何备份或日志。本地曲目的 `.lrc` 同样是**每次请求现读现返回**（`/api/local/lrc/:id`），后端不建缓存，进程不长期持有文件内容。本地 `.lrc` 是你自己磁盘上的文件，本功能只是把它读出来按时间对齐显示，不会复制到别处。
- 会被持久化的只有两个界面开关：「歌词面板是否打开」这个布尔值，和「逐曲的校准偏移秒数」这个数字。偏移是校准用的小数，不是歌词内容。歌单的曲目列表不含任何歌词内容，只存曲名、歌手和 bvid 这类元数据，因此歌单文件可以正常落盘。
- 匹配不到就显示「暂无歌词」，不会为了填满面板去放宽阈值。
- 如果版权方要求移除歌词功能，删掉 `src/api/lyrics.js` 与 `client/src/lyrics.js`、`client/src/lyric-lines.js`、`client/src/components/LyricPanel.vue`、`client/src/DesktopLyrics.vue`，并把 `routes.js` 里的 `/lyrics` 路由、`routes-local.js` 里的 `/local/lrc/:id` 和 `api.js` 里的对应方法去掉即可，其余功能不受影响。
