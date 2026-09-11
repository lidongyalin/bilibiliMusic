import { prefs } from './prefs.js'
import { state } from './state.js'

/**
 * 主题（F24）。
 *
 * 只操作 CSS 变量，不重建 DOM：
 *   - `html.dark` / `html.light` 决定整套配色（base.css 里 Element Plus 的变量也跟在这里）
 *   - `--accent` 及派生变量由强调色算出来
 *
 * system 模式下跟操作系统的「浅色/深色」走，用 matchMedia 监听变化，
 * 用户改了系统主题不用重启应用。
 */

/** 浅色主题：把同一批变量换成浅底深字 */
const LIGHT = {
  '--bg': '#ffffff',
  '--bg-elev': '#f7f7f7',
  '--bg-elev-2': '#efefef',
  '--bg-hover': '#e8e8e8',
  '--line': '#e3e3e3',
  '--text': '#1a1a1a',
  '--text-dim': '#666666',
  // #aaaaaa 在白底上只有 2.32:1，低于 WCAG AA 的 4.5:1，而它承载的是
  // 时长 / 播放量 / 序号 / 播放时间这些必要信息。#7d7d7d 提到 4.1:1，
  // 仍然和 --text-dim(#666, 5.7:1) 拉得开层级
  '--text-faint': '#7d7d7d',
  // 滚动条：#efefef 大拇指在白底上完全看不见，列表在滚这件事没有任何提示
  '--scrollbar-thumb': '#c4c4c4',
  '--scrollbar-thumb-hover': '#a8a8a8',
}

const DARK = {
  '--bg': '#121212',
  '--bg-elev': '#181818',
  '--bg-elev-2': '#212121',
  '--bg-hover': '#2a2a2a',
  '--line': '#2e2e2e',
  '--text': '#efefef',
  '--text-dim': '#a0a0a0',
  // #666666 在 #121212 上只有 3.26:1（AA 要 4.5）。#8a8a8a 在最深的三级底色
  // #212121 上也有 4.7:1，同时和 --text-dim(#a0a0a0) 仍差出一档
  '--text-faint': '#8a8a8a',
  '--scrollbar-thumb': '#3f3f3f',
  '--scrollbar-thumb-hover': '#5a5a5a',
}

/** 可选的强调色 */
export const ACCENTS = [
  { value: '#ec4141', label: '网易云红' },
  { value: '#fb7299', label: '粉' },
  { value: '#50a9ff', label: '蓝' },
  { value: '#4cd07d', label: '绿' },
  { value: '#ffa344', label: '橙' },
  { value: '#9b6dff', label: '紫' },
]

/** 把任意颜色转成 rgba() 字符串，alpha 乘进去 */
function withAlpha(hex, alpha) {
  let h = String(hex || '').replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 强调色亮一档，用于 hover */
function lighten(hex, ratio = 0.12) {
  let h = String(hex || '').replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return hex
  const mix = (v) => Math.round(Math.min(255, parseInt(v, 16) + (255 - parseInt(v, 16)) * ratio))
  const r = mix(h.slice(0, 2))
  const g = mix(h.slice(2, 4))
  const b = mix(h.slice(4, 6))
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** 当前实际生效的主题（system 会被解析成 light/dark） */
export function resolvedTheme(theme = state.theme) {
  if (theme !== 'system') return theme
  return systemPrefersDark() ? 'dark' : 'light'
}

function systemPrefersDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return true
  }
}

/** 移动端地址栏 / 浏览器 chrome 的底色：浅色主题用白，深色主题跟强调色 */
function syncThemeColor() {
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  const accent = state.accent
  meta.setAttribute(
    'content',
    resolvedTheme() === 'light' ? '#ffffff' : (accent === '#ffffff' ? '#121212' : accent)
  )
}

function applyTheme(theme = state.theme) {
  const resolved = resolvedTheme(theme)
  const root = document.documentElement
  root.classList.remove('dark', 'light')
  root.classList.add(resolved)
  const map = resolved === 'light' ? LIGHT : DARK
  for (const [k, v] of Object.entries(map)) root.style.setProperty(k, v)
  // 主题变了地址栏底色要跟着变，否则浅色主题下浏览器顶栏还是强调色
  syncThemeColor()
}

function applyAccent(color = state.accent) {
  const root = document.documentElement
  const fallback = '#ec4141'
  const hex = /^#[0-9a-fA-F]{3,6}$/.test(String(color)) ? color : fallback
  root.style.setProperty('--accent', hex)
  root.style.setProperty('--accent-hover', lighten(hex))
  const soft = withAlpha(hex, 0.13) || 'rgba(236, 65, 65, 0.13)'
  const glow = withAlpha(hex, 0.42) || 'rgba(236, 65, 65, 0.42)'
  root.style.setProperty('--accent-soft', soft)
  root.style.setProperty('--accent-glow', glow)
  syncThemeColor()
}

/** 切换主题（light / dark / system） */
export function setTheme(theme) {
  state.theme = ['light', 'dark', 'system'].includes(theme) ? theme : 'dark'
  prefs.setTheme(state.theme)
  applyTheme(state.theme)
}

/** 切换强调色 */
export function setAccent(color) {
  state.accent = /^#[0-9a-fA-F]{3,6}$/.test(String(color)) ? color : state.accent
  prefs.setAccent(state.accent)
  applyAccent(state.accent)
}

/** 启动时应用一次，并监听系统主题变化 */
export function initTheme() {
  applyTheme(state.theme)
  applyAccent(state.accent)
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', () => {
      if (state.theme === 'system') applyTheme('system')
    })
  } catch { /* 老浏览器没有 addEventListener，忽略 */ }
}
