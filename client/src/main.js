import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import DesktopLyrics from './DesktopLyrics.vue'
import DesktopMini from './DesktopMini.vue'
import { renderMode } from './desktop.js'
import { initTheme } from './theme.js'
import './assets/base.css'

/**
 * 同一份构建产物出三种窗口：
 *   无参数              → 主窗
 *   ?mode=mini          → 迷你窗（F21）
 *   ?mode=desktop-lyrics → 桌面歌词窗（F21/F29）
 *
 * 主题要在第一次绘制前生效，否则深色主题的应用会先闪一下浅色
 */
initTheme()

const mode = renderMode()
const Root = mode === 'mini' ? DesktopMini : mode === 'desktop-lyrics' ? DesktopLyrics : App

// 辅助窗的 html 类：桌面歌词窗要全透明，样式靠这个类去覆盖 body 背景
if (mode !== 'main') document.documentElement.classList.add(`${mode}-mode`)
// 主窗且平台支持 titleBarOverlay（Windows / Linux）：页面顶部要给系统窗口
// 按钮留一条空间。放这里而不是 onMounted，避免首帧内容从 y=0 跳到 y=36
if (
  mode === 'main' &&
  window.desktop &&
  ['win32', 'linux'].includes(window.desktop.platform)
) {
  document.documentElement.classList.add('has-titlebar')
}

createApp(Root).use(ElementPlus, { locale: zhCn }).mount('#app')
