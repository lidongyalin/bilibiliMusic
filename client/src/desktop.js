import { watch } from 'vue'
import { next, prev, seekTo, setVolume, toggleMute, togglePlay } from './player.js'
import { prefs } from './prefs.js'
import { state } from './state.js'

/**
 * 桌面外壳桥。
 *
 * 主窗、迷你窗、桌面歌词窗共用同一份构建产物，靠 URL 参数区分：
 *   （无参数）            主窗
 *   ?mode=mini            迷你窗（F21）
 *   ?mode=desktop-lyrics  桌面歌词窗（F21/F29）
 *
 * 浏览器里 window.desktop 是 undefined，所有分支都退化成主窗模式，
 * 所以这份代码在纯浏览器环境也是安全的。
 *
 * 数据流向：主窗是唯一真相源，它把播放状态推给主进程，主进程再转发给
 * 托盘、缩略图栏和两个辅助窗。辅助窗的按钮不自己播歌，只发命令回主窗执行，
 * 避免出现两个音源。
 */

export function renderMode() {
  try {
    const m = new URLSearchParams(window.location.search).get('mode')
    return m === 'mini' || m === 'desktop-lyrics' ? m : 'main'
  } catch {
    return 'main'
  }
}

export const isDesktop = Boolean(window.desktop)

export function sendCommand(cmd, payload) {
  window.desktop?.sendCommand(cmd, payload)
}

/** 主动要一份当前状态。刚打开的辅助窗赶不上主窗的下一次推送 */
export function requestState() {
  return window.desktop?.requestState()
}

/** 收主窗发来的命令（迷你窗按钮、全局快捷键、托盘菜单） */
export function onCommand(handler) {
  return window.desktop?.onCommand(handler)
}

/** 辅助窗订阅播放状态 */
export function onMediaState(handler) {
  return window.desktop?.onMediaState(handler)
}

/**
 * 桌面歌词窗订阅「光标在不在本窗范围内」。主进程按固定周期用真实系统光标
 * 位置算好推过来——渲染进程自己的 mouseenter/mouseleave 在整窗拖拽区上
 * 不可靠，原因写在 DesktopLyrics.vue 的悬停面板那节。
 */
export function onCursorInside(handler) {
  return window.desktop?.onCursorInside(handler)
}

/**
 * state.lyrics 是响应式 Proxy。ipcRenderer.send 走结构化克隆，
 * Proxy 不在其中——直接塞进去每次都抛 "An object could not be cloned"，
 * 状态从上线起就没推出去过（托盘提示、迷你窗、桌面歌词全在挨饿）。
 * 拷成纯字段对象；歌词数组只在换歌时整体替换（lyrics.js 里的赋值都是
 * 整组替换），按引用缓存，进度推送不用每次重建几百行。
 */
let lyricsCache = { src: null, plain: [] }

function plainLyrics() {
  const src = state.lyrics || []
  if (lyricsCache.src !== src || lyricsCache.plain.length !== src.length) {
    lyricsCache = { src, plain: src.map((l) => ({ time: l.time, text: l.text })) }
  }
  return lyricsCache.plain
}

/** 主窗 → 外壳的状态快照 */
function snapshot() {
  return {
    playing: state.status === 'playing',
    bvid: state.current?.bvid || '',
    title: state.current?.title || '',
    artist: state.current?.author || '',
    cover: state.current?.cover || '',
    duration: state.duration || 0,
    progress: state.progress || 0,
    muted: state.muted,
    volume: state.volume,
    mode: state.mode,
    speed: state.speed,
    lyrics: plainLyrics(),
    lyricOffset: state.lyricOffset || 0,
    lyricStatus: state.lyricStatus,
  }
}

/**
 * 主窗装桥。返回解绑函数；非桌面环境直接返回空操作。
 *
 * 逐字段 watch 而不是整份 state：整份 state 里有数组和对象，
 * 深度监听会把无关字段的变化也算进来，白推好几遍。
 */
export function installDesktopBridge() {
  if (!isDesktop) return () => {}

  // html.has-titlebar 在 main.js 挂载前就挂好了（避免首帧跳动），这里只挂
  // 主窗专属的关闭确认监听。迷你窗 / 桌面歌词窗是 frameless 辅助窗，
  // close 不经过确认流程，也不会收到 ask-close。
  const offAskClose =
    renderMode() === 'main' && ['win32', 'linux'].includes(window.desktop.platform)
      ? window.desktop.onAskClose(({ canTray }) => {
          state.closeAsk = { canTray: Boolean(canTray) }
        })
      : null

  const push = () => window.desktop.pushState(snapshot())

  const offCommand = onCommand((message) => {
    const cmd = message && message.cmd
    const payload = (message && message.payload) || {}

    switch (cmd) {
      case 'toggle':
        void togglePlay()
        break
      case 'next':
        next(false)
        break
      case 'prev':
        prev()
        break
      case 'mute':
        toggleMute()
        break
      case 'seek':
        if (Number.isFinite(Number(payload.at))) seekTo(Number(payload.at))
        break
      case 'volume': {
        const delta = Number(payload.delta)
        if (Number.isFinite(delta)) setVolume(state.volume + delta)
        break
      }
      case 'lyric-offset': {
        // 桌面歌词窗滚轮校准时序：偏移是数字，按 bvid 持久化，不涉及歌词文本
        const offset = Number(payload.offset)
        if (Number.isFinite(offset)) {
          state.lyricOffset = offset
          if (payload.bvid) prefs.setLyricOffset(payload.bvid, offset)
        }
        break
      }
      default:
        break
    }

    push()
  })

  const stoppers = [
    watch(() => state.status, push),
    watch(() => (state.current && state.current.bvid) || '', push),
    watch(() => state.progress, push),
    watch(() => state.volume, push),
    watch(() => state.muted, push),
    watch(() => state.lyrics, push),
    watch(() => state.lyricOffset, push),
  ]

  push()

  return () => {
    offCommand()
    offAskClose?.()
    for (const stop of stoppers) stop()
  }
}
