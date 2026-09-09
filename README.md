# B 站音乐播放器

本地运行的 B 站音乐播放器：**搜索 → 在线流播放 → 收藏**。前后端都用 Node.js，界面全中文，深色主题。

只做在线流播放，不做离线下载。收藏写入本地 JSON 文件，重启不丢失。

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

其他脚本：

```bash
npm run build        # 只重新构建前端到 client/dist
npm run dev:server   # 只跑后端，带 --watch
npm run dev:client   # 只跑前端
```

前端产物在 `client/dist`，由后端直接托管。没构建时后端会返回明确的 503 提示，不会静默 404。

## 功能

- **搜索**：关键词 400ms 防抖，分页「加载更多」，刷新后自动恢复上次关键词与搜索结果
- **播放**：点行即播；队列默认是当前列表；支持暂停/继续、上一首/下一首、进度拖拽、音量
- **播放模式**：顺序播放 / 单曲循环 / 随机播放
- **失败自动跳过**：某首播放失败时先原地重试一次，仍失败就切下一首，并提示「已切到下一首」。连续 3 首失败则停止自动切换并说明原因，避免断网时把整个队列高速过完。单曲循环是用户明确的选择，不切歌，只原地重试到上限。停在失败状态后按播放键会重新发起加载
- **收藏**：星标乐观更新（先改界面再请求，失败自动回滚），独立收藏视图，侧边栏计数
- **续播**：每首歌的播放位置存 `localStorage`，下次打开同一首歌自动续播
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
- **音轨地址解析失败要重试**。buvid 被过度复用后，B 站会返回「`pageinfo.video.numResults = 1000` 但结果列表为空」的降级响应。代码识别这种响应就换一个 buvid 重试一次（`src/api/bilibili.js` 的 `searchSongs` / `resolveAudioUrl`）。
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
| GET | `/api/search?keyword=&page=` | 搜索，返回 `{keyword, page, list, total, hasMore}` |
| GET | `/api/stream/:bvid` | 音频字节流，支持 `Range` / `Content-Range` / `Accept-Ranges` |
| GET | `/api/probe/:bvid` | 音轨可用性探测，返回时长与带宽。**前端目前没调用**，留着给「播放前预检」这类改进用 |
| GET | `/api/favorites` | 全部收藏 |
| POST | `/api/favorites` | 收藏一首（body 含 `bvid`），重复收藏返回 200（幂等），首次 201 |
| GET | `/api/favorites/check?ids=` | 批量查询收藏状态 |
| DELETE | `/api/favorites/:id` | 取消收藏，不存在返回 404 |

统一错误格式 `{ "error": "中文说明" }`。

## 目录结构

```
├── server.js                 HTTP 入口 + 静态托管 + SPA 回退
├── src/
│   ├── config.js             端口、UA、超时、缓存时长
│   ├── routes.js             全部路由
│   ├── api/http.js           请求封装、buvid cookie、Referer 注入
│   ├── api/bilibili.js       搜索 + 音轨解析 + Song 模型
│   ├── api/stream.js         音频流代理（Range 透传）
│   └── store/favorites.js    收藏持久化（原子写入）
├── scripts/dev.js            同时起前后端的开发脚本
├── scripts/verify-stream-guard.mjs  流代理防御逻辑的离线回归测试（不依赖网络）
├── client/                   Vite + Vue 3 + Element Plus
│   └── src/
│       ├── App.vue  main.js  state.js  prefs.js
│       ├── player.js  search.js  favorites.js  keyboard.js
│       ├── api.js  utils.js  icons.js
│       ├── components/       Sidebar SearchBox SongList SongRow PlayerBar Svg
│       └── assets/base.css   深色主题 + 布局
└── data/favorites.json       运行时生成
```

收藏写入是原子的：先写临时文件再 `rename`，且写入串行排队，避免并发写坏文件。

## 配置

`src/config.js`，支持环境变量覆盖：

| 配置 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `8788` | 监听端口 |
| `PAGE_SIZE` | `20` | 每页条数 |
| `MAX_DURATION_SEC` | `1800` | 超过 30 分钟的视频不作为音乐结果返回 |
| `RESOLVE_CACHE_TTL_MS` | `5 分钟` | 音轨地址缓存 |
| `COOKIE_TTL_MS` | `10 分钟` | buvid cookie 有效期 |

## 已知限制

- **只支持匿名访问**，没有登录能力。付费、会员、仅限粉丝观看的内容拿不到音轨地址。因为播放失败会自动跳过，这类曲目会像普通失败一样被跳过并提示一次，不会停下等你确认——批量听的时候要注意。
- **上游临时故障会表现为播放失败**。CDN 限流、音轨地址过期、后端 502 都会走到同一个 `MEDIA_ERR_SRC_NOT_SUPPORTED`（code 4），浏览器不会区分「地址坏了」和「暂时拿不到」，所以客户端统一按「先重试一次，再跳过」处理。后端在失败时已经清掉音轨地址缓存，重试会重新解析到一个新地址，多数临时故障一次重试就能恢复。
- **音源是视频音轨，不是音频区**。原本计划做「音频区 + 视频音轨」双源，但实测 `api.vc.bilibili.com` 的音频区接口全部 404、`search/type?search_type=audio` 返回 `-1200`（被降级），`playurl` 接口返回 `-400`。最后只保留了唯一可用的通道：视频搜索 + 视频页 `__playinfo__` 提取 DASH 音频。
- **收藏是本地单文件**，单机单用户，没有同步、没有账号、没有多端共享。
- **需要联网**，不做离线缓存。断网时给出中文提示，不白屏。
- 搜索结果是 B 站视频搜索的结果，长尾词可能混入非音乐内容；超过 30 分钟的条目会被过滤掉。

## 合规

**仅供个人本地使用。不要公开分发、不要商用、不要做批量抓取或爬取。** 本项目的后端只是为个人播放目的转发 B 站自己的 CDN 资源，请遵守 B 站的条款与版权要求。
