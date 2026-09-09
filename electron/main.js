import './env.js';
import { BrowserWindow, app, shell } from 'electron';
import { createApp } from '../src/createApp.js';

// env.js 必须在第一个位置：它在 config.js 求值前注入 DATA_DIR。

const TITLE = 'B 站音乐播放器';
const HOST = '127.0.0.1';

let win = null;
let httpServer = null;

/**
 * 起后端并等系统分配空闲端口。
 * 固定端口会和用户本机已有的服务冲突（或者用户双击两次），
 * PORT=0 交给 OS 选空闲端口，再用 server.address() 拿真实值。
 * HOST 保持 127.0.0.1：桌面应用不需要局域网访问，
 * 0.0.0.0 等于把带 B 站代理能力的服务暴露到整段局域网。
 */
function startBackend() {
  const expressApp = createApp();
  httpServer = expressApp.listen(0, HOST, () => {
    const port = httpServer.address().port;
    openWindow(`http://${HOST}:${port}`);
  });
}

function openWindow(url) {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    title: TITLE,
    // 与页面 <meta name="theme-color"> 一致，避免白屏闪烁
    backgroundColor: '#141419',
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

  win.loadURL(url);
}

// 双击图标第二次时聚焦已有窗口，而不是再开一个实例。
// 收藏是持久化文件，两个实例并发写会互相覆盖，必须挡在这里。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(startBackend);

  app.on('activate', () => {
    // macOS：点 Dock 图标时若窗口全关了，重开一个
    if (BrowserWindow.getAllWindows().length === 0 && httpServer) {
      const port = httpServer.address().port;
      openWindow(`http://${HOST}:${port}`);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('quit', () => {
    if (httpServer) {
      httpServer.close();
      httpServer = null;
    }
  });
}
