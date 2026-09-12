import './env.js';
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
} from 'electron';
import { watch as fsWatch } from 'node:fs';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/createApp.js';
import { library } from '../src/store/library.js';
import { GLYPHS, writeIcon } from './icons.js';

// env.js 必须在第一个位置：它在 config.js 求值前注入 DATA_DIR。

const TITLE = 'B 站音乐播放器';
const HOST = '127.0.0.1';

const HERE = dirname(fileURLToPath(import.meta.url));
// preload 要绝对路径。必须是 .cjs：沙箱 preload 不认 ESM，
// 而且 package.json 里 type:module 会让 .js 被工具链当 ESM 解析
const PRELOAD = resolve(HERE, 'preload.cjs');

/** 全局快捷键（F8）。Ctrl+Alt 组合避开浏览器与 IME 的常用键位 */
const SHORTCUTS = {
  'CommandOrControl+Alt+Space': 'toggle',
  'CommandOrControl+Alt+Left': 'prev',
  'CommandOrControl+Alt+Right': 'next',
};

let win = null;
let miniWin = null;
let lyricsWin = null;
let httpServer = null;
let tray = null;
let appBase = '';
let thumbIcons = null;
let thumbIconDir = null;

/**
 * 关闭窗口的意图标记。
 *
 * 点窗口右上角的「关闭」会按设置放行还是收进托盘；一旦走到退出，
 * 我们要放行这次 close，否则 close 拦截器会把 app.quit() 触发的窗口关闭
 * 又挡回来，变成永远退不掉。用显式标记而不是 preventDefault 的副作用来判断
 * 「这是不是用户明确要求退出」。
 */
let forcedQuit = false;

/** 播放状态快照。渲染进程推过来，托盘/缩略图栏/迷你窗都看这一份 */
const media = {
  playing: false,
  bvid: '',
  title: '',
  artist: '',
  cover: '',
  duration: 0,
  progress: 0,
  muted: false,
  volume: 1,
};

/** 文件夹监控（F27）：每个曲库文件夹一个 watcher，事件防抖后走一次修库 */
const watchers = new Map();
let rescanTimer = null;
let rescanning = false;

// ---------- 窗口基础操作 ----------

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** 收进托盘：窗口隐藏而不是关闭，播放继续 */
function hideToTray() {
  if (win) win.hide();
}

/** 真正退出：置标记放行 close，再走 app.quit 清理后端和托盘 */
function quitForReal() {
  forcedQuit = true;
  app.quit();
}

function getAppUrl() {
  return appBase || (httpServer ? `http://${HOST}:${httpServer.address().port}` : '');
}

/** 把命令送到主窗执行：迷你窗按钮、全局快捷键、托盘菜单都走这一条 */
function sendCommandToMain(cmd, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('desktop:command', { cmd, payload });
}

// ---------- 图标 ----------

/**
 * 托盘图标加载。候选路径按优先级试，返回第一个能解出内容的 nativeImage。
 *
 * 这里有两个独立的坑，实测（Electron 44.3.0 / Win10）：
 *
 * 1. 必须用 createFromPath 读**真磁盘文件**。这个环境里 createFromBuffer 和
 *    createFromDataURL 对所有格式（PNG/ICO/BMP/GIF）都返回空图，连内存里手搓的
 *    1x1 PNG 都解不出来；PNG 走 createFromPath 同样解不出来。只有 ICO +
 *    createFromPath 这条路是通的，改任何一环图标都是透明的。
 *
 * 2. 图标必须放在 asar 之外。createFromPath 走真实文件路径，不经过 Electron
 *    补丁过的 fs，asar 内的路径读不到。所以 .ico 用 electron-builder 的
 *    extraResources 放到 resources/build/，而不是塞进 app.asar。
 *
 * 两个条件同时满足才有图标；以前哪个都没满足，托盘上一直是空的。
 */
function loadTrayImage(candidates) {
  for (const p of candidates) {
    if (!p || !existsSync(p)) continue;
    const image = nativeImage.createFromPath(p);
    if (!image.isEmpty()) {
      return image.resize({ width: 32, height: 32 });
    }
  }
  console.warn('[desktop] 托盘图标加载失败，候选路径都不可用：', candidates.join(', '));
  return null;
}

/**
 * 缩略图工具栏的四个小图标。
 *
 * 现画 ICO 写进临时目录，不打包进资源：createFromPath 是唯一可用的加载路径，
 * 而临时目录一定在 asar 之外。
 */
function buildThumbIcons() {
  const out = {};
  let dir = null;
  try {
    dir = mkdtempSync(join(app.getPath('temp'), 'bm-icons-'));
    for (const [name, art] of Object.entries(GLYPHS)) {
      const image = nativeImage.createFromPath(writeIcon(dir, name, art));
      if (!image.isEmpty()) out[name] = image;
    }
  } catch (err) {
    console.warn(`[desktop] 缩略图图标生成失败：${err.message}`);
  }
  if (!Object.keys(out).length) {
    if (dir) rmSync(dir, { recursive: true, force: true });
    return null;
  }
  thumbIconDir = dir;
  return out;
}

// ---------- 缩略图工具栏（F20） ----------

/**
 * 任务栏缩略图里的三个按钮。Windows 与 Linux 支持；
 * 其它平台调用会抛错，包在 try 里静默跳过。
 */
function setThumbnailToolbar() {
  if (!win || win.isDestroyed() || !thumbIcons) return;

  const percent = media.duration > 0
    ? Math.round((media.progress / media.duration) * 100)
    : 0;

  try {
    win.setThumbnailToolBar([
      { tooltip: '上一首', icon: thumbIcons.prev, click: () => sendCommandToMain('prev') },
      {
        tooltip: media.playing ? '暂停' : '播放',
        icon: media.playing ? thumbIcons.pause : thumbIcons.play,
        click: () => sendCommandToMain('toggle'),
      },
      { tooltip: '下一首', icon: thumbIcons.next, click: () => sendCommandToMain('next') },
    ]);
    win.setThumbnailProgress(percent);
    win.setThumbnailToolTip(formatNowPlaying());
  } catch {
    // 平台不支持时忽略
  }
}

// ---------- 托盘（F18/F19/F23） ----------

/** tooltip 文案：状态 + 歌名 - 艺术家 + 进度百分比 */
function formatNowPlaying() {
  const name = (media.title || media.artist || '未在播放').trim();
  const who = media.title && media.artist ? ` - ${media.artist}` : '';
  const pct = media.duration > 0 ? ` ${Math.round((media.progress / media.duration) * 100)}%` : '';
  return `${media.playing ? '正在播放' : '已暂停'} ${name}${who}${pct}`;
}

function trayMenuTemplate() {
  return [
    { label: media.playing ? '暂停' : '播放', click: () => sendCommandToMain('toggle') },
    { label: '上一首', click: () => sendCommandToMain('prev') },
    { label: '下一首', click: () => sendCommandToMain('next') },
    { type: 'separator' },
    { label: media.muted ? '取消静音' : '静音', click: () => sendCommandToMain('mute') },
    { label: '音量 +10%', click: () => sendCommandToMain('volume', { delta: 0.1 }) },
    { label: '音量 -10%', click: () => sendCommandToMain('volume', { delta: -0.1 }) },
    { type: 'separator' },
    { label: miniWin ? '关闭迷你窗' : '迷你模式', click: () => toggleMini() },
    { label: lyricsWin ? '关闭桌面歌词' : '桌面歌词', click: () => toggleLyrics() },
    { type: 'separator' },
    { label: '显示主窗口', click: () => showWindow() },
    { label: '退出', click: () => quitForReal() },
  ];
}

function rebuildTrayMenu() {
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
}

function buildTray() {
  // 托盘图标：用多尺寸 ICO 缩到 32×32。Windows 托盘偏爱 16/32px，
  // 直接用 512 原图会被系统压成马赛克。
  //
  // 候选路径必须覆盖两种跑法：
  //   打包后  process.resourcesPath/build   ← extraResources 放的
  //   开发    electron/main.js 直接跑，app.getAppPath() 返回的是 electron/
  //          目录而不是仓库根，得从 main.js 自己的位置往上找一级。
  //          之前只算到 electron/build，四个候选全落空 → 托盘建不起来
  //          → 迷你模式和桌面歌词的入口跟着消失。
  const packaged = resolve(process.resourcesPath ?? '', 'build');
  const devRoot = resolve(HERE, '..', 'build');
  const image = loadTrayImage([
    resolve(packaged, 'icon.ico'),
    resolve(packaged, 'icon.png'),
    resolve(devRoot, 'icon.ico'),
    resolve(devRoot, 'icon.png'),
  ]);
  // 图标加载失败就不建托盘：图标空着只会多出一个看不见的占位，
  // 而且 window-all-closed 里的 !tray 判断会让应用退不掉。
  if (!image) return;
  tray = new Tray(image);
  tray.setToolTip(formatNowPlaying());
  rebuildTrayMenu();

  // 单击托盘直接唤出窗口，比右键再点菜单快一步
  tray.on('click', () => showWindow());
}

/** 上次重建托盘菜单时的状态指纹，用来跳过无意义的重建 */
let lastMenuKey = '';

/** 播放状态变了就刷新托盘提示与缩略图栏 */
function refreshTrayChrome() {
  if (tray) {
    tray.setToolTip(formatNowPlaying());
    // 菜单标签只跟播放/静音状态有关；进度每帧都在变，
    // 不判一下就会每秒重建好几次 Menu
    const key = `${media.playing}|${media.muted}`;
    if (key !== lastMenuKey) {
      lastMenuKey = key;
      rebuildTrayMenu();
    }
  }
  setThumbnailToolbar();
}

// ---------- 迷你窗与桌面歌词窗（F21/F29） ----------

function auxWindow(options) {
  return new BrowserWindow({
    title: TITLE,
    autoHideMenuBar: true,
    backgroundColor: options.transparent ? '#00000000' : '#121212',
    transparent: Boolean(options.transparent),
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD,
      // 桌面歌词要一直滚，别让系统把后台窗口降频
      backgroundThrottling: false,
    },
  });
}

/** 主屏右上角偏一点的位置，别盖住屏幕中央 */
function auxPosition(w, h) {
  try {
    const area = screen.getPrimaryDisplay().workArea;
    return { x: area.x + area.width - w - 24, y: area.y + 72 };
  } catch {
    return { x: 120, y: 96 };
  }
}

async function openMini() {
  if (miniWin && !miniWin.isDestroyed()) {
    miniWin.show();
    miniWin.focus();
    return;
  }
  const base = getAppUrl();
  if (!base) return;
  const s = await fetchSettings();
  const w = s.miniWidth || 460;
  const h = s.miniHeight || 280;

  miniWin = auxWindow({ transparent: false });
  miniWin.setContentSize(w, h);
  const pos = auxPosition(w, h);
  miniWin.setPosition(pos.x, pos.y);
  miniWin.setMenu(null);
  miniWin.on('closed', () => {
    miniWin = null;
    rebuildTrayMenu();
  });
  // 页面起来后先喂一次状态，别让窗口空着等下一次播放事件
  miniWin.webContents.on('did-finish-load', () => {
    pushMediaToAux();
    setTimeout(() => pushMediaToAux(), 400);
  });
  void miniWin.loadURL(`${base}/index.html?mode=mini`);
}

async function openLyrics() {
  if (lyricsWin && !lyricsWin.isDestroyed()) {
    lyricsWin.show();
    lyricsWin.focus();
    return;
  }
  const base = getAppUrl();
  if (!base) return;
  const s = await fetchSettings();
  const w = s.desktopLyricsWidth || 640;
  const h = s.desktopLyricsHeight || 260;

  lyricsWin = auxWindow({ transparent: true });
  lyricsWin.setContentSize(w, h);
  const pos = auxPosition(w, h);
  lyricsWin.setPosition(pos.x, pos.y);
  lyricsWin.setMenu(null);
  lyricsWin.on('closed', () => {
    lyricsWin = null;
    rebuildTrayMenu();
  });
  lyricsWin.webContents.on('did-finish-load', () => {
    pushMediaToAux();
    setTimeout(() => pushMediaToAux(), 400);
  });
  void lyricsWin.loadURL(`${base}/index.html?mode=desktop-lyrics`);
}

function toggleMini() {
  if (miniWin && !miniWin.isDestroyed()) miniWin.close();
  else void openMini();
}

function toggleLyrics() {
  if (lyricsWin && !lyricsWin.isDestroyed()) lyricsWin.close();
  else void openLyrics();
}

/** 把状态推给迷你窗和桌面歌词窗 */
function pushMediaToAux() {
  const payload = { ...media };
  for (const target of [miniWin, lyricsWin]) {
    if (target && !target.isDestroyed()) {
      target.webContents.send('desktop:media-state', payload);
    }
  }
}

// ---------- 设置 ----------

/** 从后端取一份设置。后端没起来时给空对象，调用方自己兜默认值 */
async function fetchSettings() {
  const base = getAppUrl();
  if (!base) return {};
  try {
    const res = await fetch(`${base}/api/settings`);
    const body = await res.json();
    return body && body.settings ? body.settings : {};
  } catch {
    return {};
  }
}

// ---------- 全局快捷键（F8） ----------

function registerGlobalShortcuts(enabled) {
  globalShortcut.unregisterAll();
  if (!enabled) return;
  for (const [accelerator, cmd] of Object.entries(SHORTCUTS)) {
    try {
      globalShortcut.register(accelerator, () => sendCommandToMain(cmd));
    } catch (err) {
      console.warn(`[desktop] 注册快捷键失败 ${accelerator}: ${err.message}`);
    }
  }
}

// ---------- 文件夹监控（F27） ----------

function startFolderWatch() {
  stopFolderWatch();
  void (async () => {
    let folders = [];
    try {
      folders = (await library.list()).folders || [];
    } catch {
      return;
    }
    for (const f of folders) addWatcher(f.path);
    console.log(`[desktop] 已监控 ${watchers.size} 个曲库文件夹`);
  })();
}

function stopFolderWatch() {
  for (const w of watchers.values()) {
    try { w.close(); } catch { /* ignore */ }
  }
  watchers.clear();
}

function addWatcher(path) {
  if (!path || watchers.has(path)) return;
  let watcher;
  try {
    watcher = fsWatch(path, { persistent: false }, () => scheduleRescan());
  } catch (err) {
    console.warn(`[desktop] 监控 ${path} 失败：${err.message}`);
    return;
  }
  watchers.set(path, watcher);
}

/**
 * fs.watch 在 Windows 上对新建、删除、改名都发 'rename'，不区分方向，
 * 而且拖拽过程中会连临时文件一起报。所以事件只做起防抖：
 * 到点再走一次修库（它同时补进新文件、标掉已消失的文件）。
 */
function scheduleRescan() {
  if (rescanTimer) clearTimeout(rescanTimer);
  rescanTimer = setTimeout(async () => {
    rescanTimer = null;
    if (rescanning) return;
    if (library.progress().running) return; // 用户正在手动扫描，别打架
    rescanning = true;
    try {
      const r = await library.repair();
      if (r.added || r.missing) {
        console.log(`[desktop] 文件夹变动同步：新增 ${r.added}，缺失 ${r.missing}`);
      }
    } catch (err) {
      console.warn(`[desktop] 自动同步失败：${err.message}`);
    } finally {
      rescanning = false;
    }
  }, 2000);
}

// ---------- IPC ----------

function registerIpc() {
  // 请求/响应：只有需要拿返回值的原生对话框用它
  ipcMain.handle('desktop:invoke', async (_event, action, arg) => {
    switch (action) {
      case 'pick-directory': {
        const res = await dialog.showOpenDialog(win, {
          title: '选择音乐文件夹',
          properties: ['openDirectory'],
        });
        return res.canceled ? null : (res.filePaths[0] || null);
      }
      case 'show-item':
        if (typeof arg === 'string' && arg) shell.showItemInFolder(arg);
        return null;
      case 'open-external':
        if (typeof arg === 'string' && /^https?:/i.test(arg)) void shell.openExternal(arg);
        return null;
      // 迷你模式 / 桌面歌词的应用内入口（F21）。之前只有托盘菜单能开，
      // 浏览器里没有托盘，这两个功能对不翻托盘的人来说等于不存在
      case 'open-mini':
        void openMini();
        return null;
      case 'open-lyrics':
        void openLyrics();
        return null;
      case 'close-mini':
        miniWin?.close();
        return null;
      case 'close-lyrics':
        lyricsWin?.close();
        return null;
      case 'aux-state':
        return {
          mini: Boolean(miniWin && !miniWin.isDestroyed()),
          lyrics: Boolean(lyricsWin && !lyricsWin.isDestroyed()),
        };
      default:
        return null;
    }
  });

  // 主窗推播放状态
  ipcMain.on('desktop:push-state', (_event, snapshot) => {
    if (!snapshot || typeof snapshot !== 'object') return;
    Object.assign(media, snapshot);
    refreshTrayChrome();
    pushMediaToAux();
  });

  // 迷你窗与桌面歌词窗启动时先要一份当前状态
  ipcMain.handle('desktop:request-state', () => ({ ...media }));

  // 迷你窗与桌面歌词窗发来的命令 → 转发给主窗执行
  ipcMain.on('desktop:command', (_event, message) => {
    if (!message || typeof message !== 'object') return;
    if (message.cmd === 'show-main') showWindow();
    else sendCommandToMain(message.cmd, message.payload);
  });

  // 桌面歌词窗的样式与偏移 → 交给主窗写进 prefs
  ipcMain.on('desktop:lyrics-config', (_event, patch) => {
    if (patch && typeof patch === 'object') sendCommandToMain('lyric-config', patch);
  });
}

// ---------- 主窗口 ----------

function openWindow(url) {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    title: TITLE,
    // 与页面 <meta name="theme-color">、--bg 三者一致，避免白屏闪烁
    backgroundColor: '#121212',
    autoHideMenuBar: true,
    webPreferences: {
      // 渲染进程不碰 Node：所有数据走 /api，系统能力走 preload 桥
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD,
    },
  });

  const homeOrigin = new URL(url).origin;

  // 封面图来自 hdslb.com 的 <img> 直连，走 webRequest 而非导航，不受这里影响。
  win.webContents.on('will-navigate', (event, target) => {
    let origin;
    try {
      origin = new URL(target).origin;
    } catch {
      origin = '';
    }
    if (origin !== homeOrigin) event.preventDefault();
  });

  // 页内 window.open / target=_blank 一律拒绝，外部链接交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });

  win.webContents.on('did-fail-load', (_event, code, desc) => {
    console.error(`[desktop] 页面加载失败: code=${code} ${desc}`);
  });

  win.on('closed', () => {
    win = null;
  });

  /**
   * 点关闭按「关闭行为」设置走：ask 弹确认，tray 直接收进托盘，quit 直接退出。
   * confirmClose 为 false 时 ask 退化成 tray（跳过弹窗）。
   */
  win.on('close', (event) => {
    if (forcedQuit) {
      forcedQuit = false;
      return;
    }
    event.preventDefault();
    void askCloseAction();
  });

  win.loadURL(url);
}

async function askCloseAction() {
  const s = await fetchSettings();
  const behavior = s.closeBehavior || 'ask';
  const confirm = s.confirmClose !== false;

  if (behavior === 'quit') return quitForReal();
  if (behavior === 'tray') return tray ? hideToTray() : quitForReal();
  if (!confirm) return tray ? hideToTray() : quitForReal();

  const res = await dialog.showMessageBox(win, {
    type: 'question',
    title: '关闭窗口',
    message: '退出程序，还是最小化到系统托盘继续播放？',
    detail:
      '最小化到托盘后应用仍在后台运行，点托盘图标可以唤回窗口，正在播放的歌曲不会中断。',
    buttons: ['最小化到托盘', '退出程序'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (res.response === 1 || !tray) {
    // 没建成托盘时不能走「最小化到托盘」：窗口 hide 掉后没有托盘可唤回，
    // 也没有可见的退出入口，应用会永远挂在后台。这种情况下直接退出。
    quitForReal();
  } else {
    hideToTray();
  }
}

function startBackend() {
  const expressApp = createApp();
  httpServer = expressApp.listen(0, HOST, async () => {
    appBase = `http://${HOST}:${httpServer.address().port}`;
    openWindow(appBase);
    const s = await fetchSettings();
    registerGlobalShortcuts(s.globalShortcuts !== false);
    if (s.monitorFolders !== false) startFolderWatch();
  });
}

// 双击图标第二次时聚焦已有窗口，而不是再开一个实例。
// 收藏和歌单都是持久化文件，两个实例并发写会互相覆盖，必须挡在这里。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
  });

  app.whenReady().then(() => {
    thumbIcons = buildThumbIcons();
    registerIpc();
    startBackend();
    buildTray();
  });

  app.on('activate', () => {
    // macOS：点 Dock 图标时若窗口全关了，重开一个
    if (BrowserWindow.getAllWindows().length === 0 && httpServer) {
      openWindow(getAppUrl());
    }
  });

  app.on('window-all-closed', () => {
    // 收进托盘时窗口是 hide 不是 close，这个事件不会触发，播放照常继续。
    // 真的触发说明窗口被关掉了（用户选了退出），此时 app.quit() 已经在跑，
    // 这里再 quit 一次无害；macOS 也照旧保留 app 让 Dock 图标可用。
    if (process.platform !== 'darwin' && !tray) app.quit();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopFolderWatch();
    if (rescanTimer) clearTimeout(rescanTimer);
    if (thumbIconDir) {
      rmSync(thumbIconDir, { recursive: true, force: true });
      thumbIconDir = null;
    }
  });

  app.on('quit', () => {
    if (httpServer) {
      httpServer.close();
      httpServer = null;
    }
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });
}
