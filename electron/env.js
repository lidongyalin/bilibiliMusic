import { app } from 'electron';

/**
 * 必须在 config.js 被求值之前设置 DATA_DIR。
 *
 * config.js 在模块顶部就冻结了 `DATA_DIR: process.env.DATA_DIR || <仓库内 data/>`，
 * 而 ESM 的 import 是按声明顺序求值的——所以本文件必须写在 electron/main.js 的
 * 第一个 import 位置，且不要 import 任何会间接导入 config.js 的模块。
 *
 * 为什么必须覆盖：打包后仓库目录位于 app.asar 内部，asar 中的 fs 是只读的，
 * 收藏文件写不进去。userData 是 Electron 标准的可写用户数据目录，
 * Windows 上是 %APPDATA%/bilibili-music-player。
 */
app.setName('bilibili-music-player');
process.env.DATA_DIR = app.getPath('userData');
