<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Loading,
  VideoPlay,
  Headset,
  EditPen,
  Delete,
  Check,
  Close,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import Svg from './Svg.vue'
import SongRow from './SongRow.vue'
import PlaylistPicker from './PlaylistPicker.vue'
import PlaylistDialog from './PlaylistDialog.vue'
import { state } from '../state.js'
import { ICON_PATHS, MODE_ICONS } from '../icons.js'
import { formatDate } from '../utils.js'
import { loadMore } from '../search.js'
import { refreshFavorites, toggleFavorite } from '../favorites.js'
import { playSong, cycleMode } from '../player.js'
import {
  contextOfView,
  refreshPlaylists,
  renamePlaylist,
  deletePlaylist,
  removeSongFromPlaylist,
  enterSelectMode,
  exitSelectMode,
  selectAll,
  clearSelection,
  addSongsToPlaylist,
} from '../playlists.js'

// ---------- 当前视图的数据 ----------

const isPlaylistView = computed(() => state.view === 'playlist')
const isFavoritesView = computed(() => state.view === 'favorites')
const isSearchView = computed(() => state.view === 'search')

const list = computed(() => {
  if (isFavoritesView.value) return state.favorites
  if (isPlaylistView.value) return state.currentPlaylist?.songs || []
  return state.songs
})
const rows = computed(() => list.value.map((song, i) => ({ song, index: i + 1 })))

const title = computed(() => {
  if (isPlaylistView.value) return state.currentPlaylist?.name || '歌单'
  if (isFavoritesView.value) return '我的收藏'
  return state.keyword ? `「${state.keyword}」的搜索结果` : '输入关键词开始搜索'
})

const meta = computed(() => {
  if (isPlaylistView.value) return list.value.length ? `共 ${list.value.length} 首` : ''
  if (isFavoritesView.value) return state.favorites.length ? `共 ${state.favorites.length} 首` : ''
  return state.keyword && state.total ? `共约 ${state.total} 个结果` : ''
})

const showEmpty = computed(() => list.value.length === 0 && !state.loading && !state.playlistDetailLoading)

const emptyText = computed(() => {
  if (isPlaylistView.value) return '这个歌单还是空的，去搜索结果里多选几首再批量加入'
  if (isFavoritesView.value) return '还没有收藏任何歌曲，点击列表右侧的星标即可收藏'
  return state.keyword ? '没有找到相关歌曲，换个关键词试试' : '搜索任意歌曲开始播放'
})

// ---------- 多选 ----------

const selectMode = computed(() => state.selectMode)

const selectedSongs = computed(() =>
  Array.from(state.selection).map((b) => list.value.find((s) => s.bvid === b)).filter(Boolean)
)
const allSelected = computed(
  () => list.value.length > 0 && state.selection.size === list.value.length
)

function toggleSelectMode() {
  if (selectMode.value) exitSelectMode()
  else enterSelectMode()
}

async function batchAdd(id) {
  if (!selectedSongs.value.length) return
  // 没有歌单时下拉里只剩占位项，点它 command 会是空值——静默跳过，别发注定 404 的请求
  if (!id) {
    ElMessage.info('还没有歌单，点「新建歌单…」先建一个')
    return
  }
  const ok = await addSongsToPlaylist(id, selectedSongs.value)
  if (ok) {
    clearSelection()
    exitSelectMode()
  }
}

// ---------- 歌单视图操作 ----------

function onPlay(song) {
  void playSong(song, contextOfView())
}

function onRemove(song) {
  if (!state.currentPlaylistId) return
  void removeSongFromPlaylist(state.currentPlaylistId, song.bvid)
}

async function onPlayAll() {
  if (!list.value.length) return
  void playSong(list.value[0], contextOfView())
}

// 重命名弹窗
const renameVisible = ref(false)

function openRename() {
  renameVisible.value = true
}

async function onRenameConfirm(name) {
  renameVisible.value = false
  if (!state.currentPlaylistId) return
  await renamePlaylist(state.currentPlaylistId, name)
}

// 删除：不可逆，确认一下
async function onDelete() {
  if (!state.currentPlaylistId) return
  const name = state.currentPlaylist?.name || '歌单'
  const n = list.value.length
  const confirmed = window.confirm(`确定删除「${name}」吗？\n里面的 ${n} 首歌会从歌单移除，收藏不受影响。`)
  if (!confirmed) return
  await deletePlaylist(state.currentPlaylistId)
}

/** 批量加入「刚新建的歌单」：先把待加曲目交给 App 的创建弹窗，建完再加 */
function onCreateThenAdd() {
  window.dispatchEvent(
    new CustomEvent('create-playlist-and-add', { detail: selectedSongs.value })
  )
}

// ---------- 触底自动加载 ----------

const scrollEl = ref(null)
const sentinel = ref(null)
let observer = null

const autoLoad = computed(() => isSearchView.value && state.hasMore)
const reachedEnd = computed(
  () => isSearchView.value && !state.hasMore && state.songs.length > 0
)

const PRELOAD_PX = 360

function resetScroll() {
  scrollEl.value?.scrollTo({ top: 0 })
}

function checkLoad() {
  if (!scrollEl.value || !sentinel.value) return
  const gap =
    sentinel.value.getBoundingClientRect().top - scrollEl.value.getBoundingClientRect().bottom
  if (gap < PRELOAD_PX) loadMore()
}

onMounted(() => {
  // 哨兵始终挂在 DOM 上（不需要时 v-show 隐藏），避免 observer 反复 attach/detach。
  // rootMargin 提前触发，等用户滚到底部时下一页通常已经拿到了。
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(
      () => checkLoad(),
      { root: scrollEl.value, rootMargin: `0px 0px ${PRELOAD_PX}px 0px` }
    )
    if (sentinel.value) observer.observe(sentinel.value)
  }
  scrollEl.value?.addEventListener('scroll', checkLoad, { passive: true })
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  scrollEl.value?.removeEventListener('scroll', checkLoad)
})

watch(
  () => state.page,
  (page, prev) => {
    if (page <= prev) resetScroll()
  }
)

// 结果条数少、列表撑不满一屏时，加载完成后哨兵可能仍落在阈值范围内，
// 再判定一次把它填满。flush: 'post' 关键——默认 pre 会在 DOM 更新前跑。
watch(
  () => [state.loading, state.songs.length],
  ([loading]) => {
    if (!loading && isSearchView.value) checkLoad()
  },
  { flush: 'post' }
)

watch(
  () => state.view,
  (view) => {
    resetScroll()
    exitSelectMode()
    if (view === 'favorites') void refreshFavorites()
    if (view === 'playlist') void refreshPlaylists()
  }
)
</script>

<template>
  <div class="list-wrap">
    <!-- 多选工具条：进入多选后顶在列表上方，退出多选时收起 -->
    <div v-if="selectMode" class="select-bar">
      <div class="select-bar-left">
        <button type="button" class="select-bar-icon" @click="toggleSelectMode" title="退出多选">
          <el-icon><Close /></el-icon>
        </button>
        <span class="select-bar-count">已选 {{ state.selection.size }} 首</span>
        <button type="button" class="select-bar-link" @click="allSelected ? clearSelection() : selectAll(list)">
          {{ allSelected ? '取消全选' : '全选' }}
        </button>
      </div>
      <div class="select-bar-right">
        <PlaylistPicker :songs="selectedSongs" @command="batchAdd" @create-then-add="onCreateThenAdd">
          <button type="button" class="select-bar-primary">
            <el-icon><Headset /></el-icon>
            <span>加入歌单</span>
          </button>
        </PlaylistPicker>
      </div>
    </div>

    <!-- 歌单详情头：模仿网易云的歌单封面 + 名字 + 曲数那一块 -->
    <div v-if="isPlaylistView && !selectMode" class="playlist-header">
      <div class="ph-cover">
        <Svg :d="ICON_PATHS.music" :size="40" />
      </div>
      <div class="ph-info">
        <h2 class="ph-title">{{ title }}</h2>
        <p class="ph-sub">我创建的歌单 · {{ list.length }} 首歌</p>
        <p v-if="state.currentPlaylist" class="ph-updated">
          更新于 {{ formatDate(state.currentPlaylist.updatedAt) }}
        </p>
      </div>
      <div class="ph-actions">
        <button type="button" class="header-btn" title="播放全部" @click="onPlayAll">
          <el-icon><VideoPlay /></el-icon>
          <span>播放全部</span>
        </button>
        <button type="button" class="header-btn" title="切换播放模式" @click="cycleMode">
          <Svg :d="MODE_ICONS[state.mode]" :size="17" />
        </button>
        <button type="button" class="header-btn" title="重命名歌单" @click="openRename">
          <el-icon><EditPen /></el-icon>
        </button>
        <button type="button" class="header-btn header-danger" title="删除歌单" @click="onDelete">
          <el-icon><Delete /></el-icon>
        </button>
      </div>
    </div>

    <div v-else class="list-header">
      <h2>{{ title }}</h2>
      <span class="list-meta">{{ meta }}</span>

      <div class="list-actions">
        <template v-if="!selectMode">
          <button type="button" class="header-btn" title="多选并批量加入歌单" @click="toggleSelectMode">
            <el-icon><Check /></el-icon>
            <span>多选</span>
          </button>
        </template>
      </div>
    </div>

    <div ref="scrollEl" class="list-scroll">
      <div class="list-inner">
        <ol class="song-list">
          <SongRow
            v-for="row in rows"
            :key="row.song.bvid"
            :song="row.song"
            :index="row.index"
            :removable="isPlaylistView"
            :playlist-id="state.currentPlaylistId"
            @play="onPlay"
            @favorite="toggleFavorite"
            @remove="onRemove"
          />
        </ol>

        <div v-if="showEmpty" class="list-empty">
          <el-empty :description="emptyText" :image-size="76">
            <template #image>
              <div class="empty-art">
                <Svg :d="ICON_PATHS.music" :size="40" />
              </div>
            </template>
          </el-empty>
        </div>

        <div
          ref="sentinel"
          v-show="autoLoad || reachedEnd"
          class="load-status"
          :class="{ clickable: autoLoad }"
          :title="autoLoad ? '点击立即加载下一页' : ''"
          @click="loadMore"
        >
          <template v-if="autoLoad && state.loading">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>正在加载下一页…</span>
          </template>
          <template v-else-if="autoLoad">
            <span>滚动到底部自动加载</span>
          </template>
          <template v-else>
            <span>没有更多了</span>
          </template>
        </div>
      </div>
    </div>

    <PlaylistDialog v-model="renameVisible" mode="rename" :initial-name="state.currentPlaylist?.name" @confirm="onRenameConfirm" />
  </div>
</template>
