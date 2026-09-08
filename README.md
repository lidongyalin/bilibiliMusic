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

另外两条踩过的坑，改代码前值得知道：

- **`__playinfo__` 的提取必须用括号配对，不能用正则**。它嵌在视频页 HTML 里，JSON 字符串内部含 `}`，贪婪正则会截错位置（`src/api/bilibili.js` 的 `extractPlayinfo`）。
- **音轨地址解析失败要重试**。buvid 被过度复用后，B 站会返回「`pageinfo.video.numResults = 1000` 但结果列表为空」的降级响应。代码识别这种响应就换一个 buvid 重试一次（`src/api/bilibili.js` 的 `searchSongs` / `resolveAudioUrl`）。

播放链路细节：搜索拿到 `bvid` → 抓视频页 → 从 `__playinfo__` 里选带宽最高的 DASH `audio[].baseUrl` → 缓存 5 分钟（避免每次 Range 都重新抓 230KB 的 HTML）→ 代理转发。

代理必须透传 `Content-Length`：206 响应的分段长度靠它界定，缺失时 `<audio>` 会永远卡在 loading。

m4s 是渐进式 DASH（`ftyp → moov → sidx → (moof+mdat)*`），`moov` 在前，所以拖进度条的 Range seek 直接可用，不需要先下完整个文件。

## 后端 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/search?keyword=&page=` | 搜索，返回 `{keyword, page, list, total, hasMore}` |
| GET | `/api/stream/:bvid` | 音频字节流，支持 `Range` / `Content-Range` / `Accept-Ranges` |
| GET | `/api/probe/:bvid` | 音轨可用性探测，返回时长与带宽 |
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

- **只支持匿名访问**，没有登录能力。付费、会员、仅限粉丝观看的内容拿不到音轨地址，会提示「播放失败，可能是付费或受版权限制的内容」，不影响队列里其他曲目继续播。
- **音源是视频音轨，不是音频区**。原本计划做「音频区 + 视频音轨」双源，但实测 `api.vc.bilibili.com` 的音频区接口全部 404、`search/type?search_type=audio` 返回 `-1200`（被降级），`playurl` 接口返回 `-400`。最后只保留了唯一可用的通道：视频搜索 + 视频页 `__playinfo__` 提取 DASH 音频。
- **收藏是本地单文件**，单机单用户，没有同步、没有账号、没有多端共享。
- **需要联网**，不做离线缓存。断网时给出中文提示，不白屏。
- 搜索结果是 B 站视频搜索的结果，长尾词可能混入非音乐内容；超过 30 分钟的条目会被过滤掉。

## 合规

**仅供个人本地使用。不要公开分发、不要商用、不要做批量抓取或爬取。** 本项目的后端只是为个人播放目的转发 B 站自己的 CDN 资源，请遵守 B 站的条款与版权要求。
