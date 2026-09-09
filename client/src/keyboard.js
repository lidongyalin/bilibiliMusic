import { state } from './state.js'
import { cycleMode, next, prev, seekTo, setVolume, togglePlay } from './player.js'
import { toggleLyricPanel } from './lyrics.js'

let bound = false

/**
 * 全局快捷键。滑杆与输入框聚焦时不接管，避免和它们自己的键盘行为冲突。
 */
export function bindKeyboard() {
  if (bound) return
  bound = true

  window.addEventListener('keydown', (e) => {
    const t = e.target
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
    if (t && t.isContentEditable) return
    if (t && t.closest && t.closest('.el-slider')) return

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
    }
  })
}
