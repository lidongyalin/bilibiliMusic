import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export const CONFIG = {
  HOST: process.env.HOST || '127.0.0.1',
  PORT: Number(process.env.PORT) || 8788,

  /** 模拟桌面 Chrome 的 UA。B 站的部分接口对异常 UA 会直接拒绝。 */
  UA:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

  /** 上游超时：接口请求 */
  API_TIMEOUT_MS: 20_000,
  /** 上游超时：建连到开始播放（音频地址解析 + 首字节） */
  STREAM_TIMEOUT_MS: 30_000,

  /**
   * 音轨地址缓存时长。bilivideo 地址有效期约数小时，5 分钟足够短，
   * 又能避免同一首歌的多次 Range 请求反复抓 230KB 的视频页 HTML。
   */
  RESOLVE_CACHE_TTL_MS: 5 * 60 * 1000,

  /** buvid cookie 有效期。过期后自动重新获取。 */
  COOKIE_TTL_MS: 10 * 60 * 1000,

  /** 超过此时长的视频不作为音乐结果返回（单位：秒） */
  MAX_DURATION_SEC: 1800,

  /** 每页返回条数 */
  PAGE_SIZE: 20,

  /**
   * 收藏等运行时数据的存放目录。默认为仓库内的 data/；
   * 桌面端必须覆盖成 Electron 的 userData——打包后仓库目录在 asar 里是只读的，
   * 写不进去。由 electron/main.js 在启动时注入，CLI 用法不受影响。
   */
  DATA_DIR: process.env.DATA_DIR || resolve(here, '../data'),
  /** 前端构建产物目录（Vite 输出） */
  PUBLIC_DIR: process.env.PUBLIC_DIR || resolve(here, '../client/dist'),
};
