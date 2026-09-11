import { state } from './state.js'
import { cycleMode, next, prev, seekTo, setVolume, togglePlay } from './player.js'
import { toggleLyricPanel } from './lyrics.js'
import { closeMenu } from './menu.js'

let bound = false

/**
 * 全局快捷键（F8）。滑杆与输入框聚焦时不接管，避免和它们自己的键盘行为冲突。
 *
 * 只处理不带修饰键的单键，Ctrl/Cmd 组合在 Electron 主进程里注册成全局快捷键，
 * 浏览器环境只保留 Ctrl+, 这一条（打开设置）。
 */
export function bindKeyboard() {
  if (bound) return
  bound = true

  window.addEventListener('keydown', (e) => {
    const t = e.target
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
    if (t && t.isContentEditable) return
    if (t && t.closest && t.closest('.el-slider')) return

    if ((e.ctrlKey || e.metaKey) && e.code === 'Comma') {
      e.preventDefault()
      state.settingsOpen = true
      return
    }

    switch (e.code) {
      case 'Space':
        e.preventDefault()
        togglePlay()
        break
      case 'ArrowLeft':
        e.preventDefault()
        seekTo(state.progress - 5)
        break
      case 'ArrowRight':
        e.preventDefault()
        seekTo(state.progress + 5)
        break
      case 'ArrowUp':
        e.preventDefault()
        setVolume(state.muted ? 0.8 : state.volume + 0.05)
        break
      case 'ArrowDown':
        e.preventDefault()
        setVolume(Math.max(0, (state.muted ? 0 : state.volume) - 0.05))
        break
      case 'KeyL':
        cycleMode()
        break
      case 'KeyG':
        toggleLyricPanel()
        break
      case 'KeyN':
        next(false)
        break
      case 'KeyP':
        prev()
        break
      case 'KeyQ':
        state.queueOpen = !state.queueOpen
        break
      case 'KeyE':
        state.eqOpen = !state.eqOpen
        break
      case 'KeyI':
        state.immersive = !state.immersive
        break
      case 'Escape':
        closeOverlay()
        break
    }
  })
}

/** Esc 按优先级关一个浮层，不一次关掉所有 */
function closeOverlay() {
  if (state.settingsOpen) state.settingsOpen = false
  else if (state.metaEditor) state.metaEditor = null
  else if (state.eqOpen) state.eqOpen = false
  else if (state.queueOpen) state.queueOpen = false
  else if (state.immersive) state.immersive = false
  else if (state.contextMenu) closeMenu()
}
