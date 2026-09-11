import './env.js';
import { BrowserWindow, Menu, Tray, app, dialog, nativeImage, shell } from 'electron';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from '../src/createApp.js';

// env.js 必须在第一个位置：它在 config.js 求值前注入 DATA_DIR。

const TITLE = 'B 站音乐播放器';
const HOST = '127.0.0.1';

let win = null;
let httpServer = null;
let tray = null;

/**
 * 关闭窗口的意图标记。
 *
 * 点窗口右上角的「关闭」会先弹窗问「退出还是收进托盘」；一旦用户选了退出，
 * 我们要放行这次 close，否则托盘的 close 拦截器会把 app.quit() 触发的
 * 窗口关闭又挡回来，变成永远退不掉。用显式标记而不是 preventDefault 的
 * 副作用来判断「这是不是用户明确要求退出」。
 */
let forcedQuit = false;

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

function buildTray() {
  // 托盘图标：用多尺寸 ICO 缩到 32×32。Windows 托盘偏爱 16/32px，
  // 直接用 512 原图会被系统压成马赛克。
  const packaged = resolve(process.resourcesPath ?? '', 'build');
  const dev = resolve(app.getAppPath(), 'build');
  const image = loadTrayImage([
    resolve(packaged, 'icon.ico'),
    resolve(packaged, 'icon.png'),
    resolve(dev, 'icon.ico'),
    resolve(dev, 'icon.png'),
  ]);
  // 图标加载失败就不建托盘：图标空着只会多出一个看不见的占位，
  // 而且 window-all-closed 里的 !tray 判断会让应用退不掉。
  if (!image) return;
  tray = new Tray(image);
  tray.setToolTip(TITLE);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showWindow() },
    { type: 'separator' },
    { label: '退出', click: () => quitForReal() },
  ]));

  // 单击托盘直接唤出窗口，比右键再点菜单快一步
  tray.on('click', () => showWindow());
}

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
      // 渲染进程完全不碰 Node：所有数据都走 /api
      contextIsolation: true,
      nodeIntegration: false,
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
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('did-fail-load', (_event, code, desc) => {
    console.error(`[desktop] 页面加载失败: code=${code} ${desc}`);
  });

  win.on('closed', () => {
    win = null;
  });

  /**
   * 点关闭先问一次：直接退出，还是收进托盘继续播放。
   * 选了托盘只 hide 不 close，播放不中断；选了退出就放行 close。
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

/** 弹「退出还是收进托盘」。默认选中「最小化到托盘」，多数人点关闭是想收起来 */
async function askCloseAction() {
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
  httpServer = expressApp.listen(0, HOST, () => {
    const port = httpServer.address().port;
    openWindow(`http://${HOST}:${port}`);
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
    startBackend();
    buildTray();
  });

  app.on('activate', () => {
    // macOS：点 Dock 图标时若窗口全关了，重开一个
    if (BrowserWindow.getAllWindows().length === 0 && httpServer) {
      const port = httpServer.address().port;
      openWindow(`http://${HOST}:${port}`);
    }
  });

  app.on('window-all-closed', () => {
    // 收进托盘时窗口是 hide 不是 close，这个事件不会触发，播放照常继续。
    // 真的触发说明窗口被关掉了（用户选了退出），此时 app.quit() 已经在跑，
    // 这里再 quit 一次无害；macOS 也照旧保留 app 让 Dock 图标可用。
    if (process.platform !== 'darwin' && !tray) app.quit();
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
