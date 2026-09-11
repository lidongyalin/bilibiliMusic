<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import Sidebar from './components/Sidebar.vue'
import SongList from './components/SongList.vue'
import PlayerBar from './components/PlayerBar.vue'
import LyricPanel from './components/LyricPanel.vue'
import PlaylistDialog from './components/PlaylistDialog.vue'
import ContextMenu from './components/ContextMenu.vue'
import QueuePanel from './components/QueuePanel.vue'
import EqualizerPanel from './components/EqualizerPanel.vue'
import MetaEditor from './components/MetaEditor.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import Immersive from './components/Immersive.vue'
import { refreshFavorites } from './favorites.js'
import { bindKeyboard } from './keyboard.js'
import { initTheme } from './theme.js'
import { loadLyrics } from './lyrics.js'
import { state } from './state.js'
import { openPlaylist, refreshPlaylists, createPlaylist, addSongsToPlaylist } from './playlists.js'
import { refreshLibrary } from './library.js'
import { openSmart, openHistory } from './history.js'

// 主题要在第一次绘制前生效，否则深色主题的应用会先闪一下浅色
initTheme()

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

// ---------- 新建歌单弹窗 ----------
// 两个入口共用同一个弹窗：侧栏的「+」（只新建），
// 多选工具条的「新建歌单…」（新建完把选中的歌塞进去）。
// 用 pendingSongs 区分这两种意图，而不是开两个弹窗。
const createVisible = ref(false)
const pendingSongs = ref([])

function openCreateDialog(songs = []) {
  pendingSongs.value = songs
  createVisible.value = true
}

async function onCreateConfirm(name) {
  createVisible.value = false
  const created = await createPlaylist(name)
  // 从「批量加入」入口过来时，建完直接把选中的歌塞进去
  if (created && pendingSongs.value.length) {
    await addSongsToPlaylist(created.id, pendingSongs.value)
  }
  pendingSongs.value = []
}

/** 多选工具条「新建歌单…」的回调：把待加曲目放进弹窗的上下文 */
function onCreateAndAdd(e) {
  openCreateDialog(Array.isArray(e?.detail) ? e.detail : [])
}

onMounted(() => {
  bindKeyboard()
  void refreshFavorites()
  void refreshPlaylists()
  // 上次停在歌单视图，把详情补拉回来
  if (state.view === 'playlist' && state.currentPlaylistId) {
    void openPlaylist(state.currentPlaylistId)
  }
  // 启动时落在本地曲库 / 智能歌单 / 播放历史，也要把数据补上
  // （SongList 里的 watch 不带 immediate，冷启动那一次不会触发）
  if (state.view === 'library' && !state.library.length) void refreshLibrary()
  if (state.view === 'smart') void openSmart(state.smartKind)
  if (state.view === 'history') void openHistory()
  syncBarHeight()
  window.addEventListener('resize', syncBarHeight)
  window.addEventListener('create-playlist-and-add', onCreateAndAdd)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncBarHeight)
  window.removeEventListener('create-playlist-and-add', onCreateAndAdd)
})
</script>

<template>
  <div class="app-shell">
    <Sidebar @create-playlist="openCreateDialog" />
    <main class="main-area">
      <SongList />
    </main>
    <PlayerBar />
    <LyricPanel />

    <PlaylistDialog v-model="createVisible" mode="create" @confirm="onCreateConfirm" />

    <!-- 浮层：全部 Teleport 到 body，跟着 state 开关 -->
    <ContextMenu />
    <QueuePanel />
    <EqualizerPanel />
    <MetaEditor />
    <SettingsDialog />
    <Immersive />
  </div>
</template>
