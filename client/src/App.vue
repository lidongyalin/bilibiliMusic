<script setup>
import { onMounted, onBeforeUnmount, watch } from 'vue'
import Sidebar from './components/Sidebar.vue'
import SongList from './components/SongList.vue'
import PlayerBar from './components/PlayerBar.vue'
import LyricPanel from './components/LyricPanel.vue'
import { refreshFavorites } from './favorites.js'
import { bindKeyboard } from './keyboard.js'
import { loadLyrics } from './lyrics.js'
import { state } from './state.js'

// 切歌即取歌词。播放条常驻可见，所以面板开着时歌词会一直跟着更新
watch(
  () => state.current,
  (song) => {
    void loadLyrics(song)
  }
)

/**
 * 歌词面板的底边要对齐播放条顶边。播放条的高度在手机上不是 var(--bar-h)
 * （改成了两行 auto），所以量一次真实高度存进 --bar-real-h，面板用它定位。
 */
function syncBarHeight() {
  const bar = document.querySelector('.player-bar')
  if (!bar) return
  document.documentElement.style.setProperty('--bar-real-h', `${bar.offsetHeight}px`)
}

onMounted(() => {
  bindKeyboard()
  void refreshFavorites()
  syncBarHeight()
  window.addEventListener('resize', syncBarHeight)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncBarHeight)
})
</script>

<template>
  <div class="app-shell">
    <Sidebar />
    <main class="main-area">
      <SongList />
    </main>
    <PlayerBar />
    <LyricPanel />
  </div>
</template>
