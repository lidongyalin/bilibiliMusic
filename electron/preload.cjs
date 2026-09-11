/**
 * 渲染进程唯一能碰到系统的口子。
 *
 * 必须是 CommonJS：Electron 的沙箱 preload 不认 ESM，
 * 用 import 会直接报 "Cannot use import statement outside a module" 并让整个 window.desktop 为空。
 * 也必须是 .cjs——package.json 里写了 "type": "module"，
 * 同名 .js 会让工具链把它当 ESM 解析，Electron 却当 CJS 执行，两头对不上。
 *
 * 主窗口设了 contextIsolation + nodeIntegration:false，渲染进程不接触 Node，
 * 所有系统能力（目录选择框、在资源管理器里定位、全局快捷键、托盘、迷你窗）
 * 都从这里进出。浏览器里跑同一份前端时 window.desktop 是 undefined，
 * 调用方一律写 window.desktop?.xxx，所以这条桥不存在也不会报错。
 *
 * 通道方向：
 *   desktop:invoke        请求/响应（只有需要拿返回值的原生对话框用它）
 *   desktop:push-state    主窗 → 主进程，播放状态快照，供托盘/缩略图栏/迷你窗用
 *   desktop:request-state 辅助窗启动时主动要一份，避免空窗等下一次推送
 *   desktop:media-state   主进程 → 迷你窗与桌面歌词窗
 *   desktop:command       双向。辅助窗发命令给主窗，主窗也用它发命令给辅助窗
 *   desktop:lyrics-config 桌面歌词窗的样式与偏移，主窗记进 prefs
 */

const { contextBridge, ipcRenderer } = require('electron');

/** 只转白名单里的字段：状态快照会被搬到另一个渲染进程，别把整个 state 塞过去 */
const STATE_FIELDS = [
  'playing',
  'bvid',
  'title',
  'artist',
  'cover',
  'duration',
  'progress',
  'muted',
  'volume',
  'mode',
  'speed',
  'lyrics',
  'lyricOffset',
  'lyricStatus',
];

function pickState(snapshot) {
  const out = {};
  if (snapshot && typeof snapshot === 'object') {
    for (const key of STATE_FIELDS) {
      if (snapshot[key] !== undefined) out[key] = snapshot[key];
    }
  }
  return out;
}

/** 辅助窗的按钮只认这几个命令，其余忽略 */
const COMMANDS = [
  'toggle',
  'play',
  'pause',
  'next',
  'prev',
  'seek',
  'volume',
  'mute',
  'show-main',
  'lyric-offset',
  'lyric-config',
];

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,

  /** 原生目录选择框。取消返回 null */
  pickDirectory() {
    return ipcRenderer.invoke('desktop:invoke', 'pick-directory');
  },

  /** 在系统文件管理器里定位这个文件（右键「在文件夹中显示」） */
  showItemInFolder(path) {
    if (typeof path === 'string' && path) {
      void ipcRenderer.invoke('desktop:invoke', 'show-item', path);
    }
  },

  /** 外部链接交给系统浏览器 */
  openExternal(url) {
    if (typeof url === 'string' && /^https?:/i.test(url)) {
      void ipcRenderer.invoke('desktop:invoke', 'open-external', url);
    }
  },

  /** 主窗推播放状态。内部过滤字段，调用方直接传整份快照 */
  pushState(snapshot) {
    ipcRenderer.send('desktop:push-state', pickState(snapshot));
  },

  /** 发命令。主窗用它触发托盘/缩略图栏的联动，辅助窗用它回到主窗执行播放动作 */
  sendCommand(cmd, payload) {
    if (typeof cmd === 'string' && COMMANDS.includes(cmd)) {
      ipcRenderer.send('desktop:command', { cmd, payload });
    }
  },

  /** 主窗转发来的命令（辅助窗按钮 → 主窗执行）。返回一个解绑函数 */
  onCommand(handler) {
    const listener = (_e, message) => {
      if (message && COMMANDS.includes(message.cmd)) handler(message);
    };
    ipcRenderer.on('desktop:command', listener);
    return () => ipcRenderer.removeListener('desktop:command', listener);
  },

  /** 迷你窗与桌面歌词窗订阅播放状态。返回一个解绑函数 */
  onMediaState(handler) {
    const listener = (_e, snapshot) => handler(snapshot || {});
    ipcRenderer.on('desktop:media-state', listener);
    return () => ipcRenderer.removeListener('desktop:media-state', listener);
  },

  /**
   * 主动要一份当前状态。刚打开的窗口可能赶不上主窗的下一次推送，
   * 先问一次就能避免空白闪一下。
   */
  requestState() {
    return ipcRenderer.invoke('desktop:request-state');
  },

  /** 桌面歌词窗推样式（字号/颜色/透明度/描边），主窗记进 prefs */
  sendLyricsConfig(patch) {
    if (patch && typeof patch === 'object') {
      ipcRenderer.send('desktop:lyrics-config', patch);
    }
  },

  /** 主窗（或设置面板）推桌面歌词样式给桌面歌词窗。返回一个解绑函数 */
  onLyricsConfig(handler) {
    const listener = (_e, patch) => handler(patch || {});
    ipcRenderer.on('desktop:lyrics-config', listener);
    return () => ipcRenderer.removeListener('desktop:lyrics-config', listener);
  },
});
