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
  Plus,
  Search,
  Sort,
  Download,
  RefreshRight,
  CopyDocument,
  FolderDelete,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import Svg from './Svg.vue'
import SongRow from './SongRow.vue'
import PlaylistPicker from './PlaylistPicker.vue'
import PlaylistDialog from './PlaylistDialog.vue'
import { state } from '../state.js'
import { ICON_PATHS, MODE_ICONS } from '../icons.js'
import { formatDate } from '../utils.js'
import { currentView, currentList, viewTitle, groupTypeName, isLocalView as isLocalViewOf } from '../views.js'
import {
  SORT_OPTIONS, setSort, setLibraryFilter, scanFolder, repairLibrary, removeFolder,
  findDuplicates, exportM3U, exitDrill, sortedLibrary, listMeta, refreshLibrary,
  removeSongs,
} from '../library.js'
import { openSmart, openHistory, clearHistory, SMART_KINDS, smartKindLabel } from '../history.js'
import { playlistMenu } from '../menu.js'
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

const view = computed(() => currentView())
const isPlaylistView = computed(() => state.view === 'playlist')
const isFavoritesView = computed(() => state.view === 'favorites')
const isSearchView = computed(() => state.view === 'search')
const isLibraryView = computed(() => ['library', 'group'].includes(view.value))
const isSmartView = computed(() => view.value === 'smart')
const isHistoryView = computed(() => view.value === 'history')
const isLocalView = computed(() => isLocalViewOf())

/** 列表内容。曲库视图额外应用排序与筛选（F12） */
const list = computed(() => {
  const base = currentList()
  if (view.value === 'group') return base
  if (view.value === 'library') return sortedLibrary()
  return base
})
const rows = computed(() => list.value.map((song, i) => ({ song, index: i + 1 })))

const title = computed(() => {
  if (view.value === 'group') {
    const d = state.libraryDrill
    return d ? `${groupTypeName(d.type)}：${d.value}` : '曲库'
  }
  return viewTitle()
})

const meta = computed(() => {
  if (state.keyword && state.total && isSearchView.value) return `共约 ${state.total} 个结果`
  // 用筛选/排序后的列表算数量，不然筛选掉一半时标题栏还显示总数
  return listMeta(list.value)
})

const showEmpty = computed(() => {
  if (list.value.length) return false
  if (state.loading || state.playlistDetailLoading || state.libraryLoading || state.smartLoading || state.historyLoading) return false
  return !state.scanProgress?.running
})

const emptyText = computed(() => {
  const v = view.value
  if (v === 'playlist') return '这个歌单还是空的，去搜索结果里多选几首再批量加入'
  if (v === 'favorites') return '还没有收藏任何歌曲，点击列表右侧的星标即可收藏'
  if (v === 'library') return state.libraryFolders.length ? '这个筛选条件下没有曲目' : '还没有添加文件夹。点右上角「添加文件夹」开始建库'
  if (v === 'group') return '这个分组里还没有曲目'
  if (v === 'smart') return '还没有播放记录，先听几首歌再来'
  if (v === 'history') return '还没有播放历史'
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

/** 播放选中：选中的歌作为播放上下文，播完从队列顺序往下走 */
function onPlaySelected() {
  const picks = selectedSongs.value
  if (!picks.length) return
  void playSong(picks[0], picks)
  clearSelection()
  exitSelectMode()
}

/** 移出曲库：批量删除选中项（磁盘文件保留） */
async function onRemoveSelected() {
  const picks = selectedSongs.value
  if (!picks.length) return
  const n = await removeSongs(picks)
  if (n) {
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

// ---------- 曲库工具条（F1 导入 / F12 排序筛选 / F14 导出 / F15 重复 / F28 批量） ----------

/** 选目录。桌面端走原生文件夹选择框，浏览器环境提示用桌面版 */
async function onAddFolder() {
  if (window.desktop?.pickDirectory) {
    const path = await window.desktop.pickDirectory()
    if (path) void scanFolder(path)
    return
  }
  ElMessage.info('添加文件夹需要桌面版（原生目录选择框）')
}

async function onRemoveFolder() {
  if (!state.libraryFolders.length) return
  const f = state.libraryFolders[0]
  const ok = window.confirm(`移出「${f.name}」？\n里面的 ${f.songCount} 首会从曲库移除，磁盘文件不删。`)
  if (ok) await removeFolder(f.id)
}

// 重复检测弹窗（F15）：dialog 开合由本地 ref 控制，state.duplicates 只存数据
const dupDialogOpen = ref(false)

async function onDuplicates() {
  const groups = await findDuplicates()
  state.duplicates = groups
  dupDialogOpen.value = true
}

function closeDuplicates() {
  dupDialogOpen.value = false
}

/** 从结果里移除一首，剩下的不足两首就不再算一组 */
async function onDupRemove(song) {
  await removeSongs([song])
  state.duplicates = state.duplicates
    .map((g) => g.filter((s) => s.bvid !== song.bvid))
    .filter((g) => g.length > 1)
  if (!state.duplicates.length) dupDialogOpen.value = false
}

/** 标题栏右键：整批操作（F17）。歌单视图把重命名/删除入口一并交给菜单 */
function onHeaderContext(e) {
  e.preventDefault()
  const songs = list.value
  let kind = 'search'
  if (state.view === 'playlist') kind = 'playlist'
  else if (state.view === 'library' || state.view === 'group') kind = 'local'
  const target = kind === 'playlist' ? { onRename: openRename, onDelete } : null
  state.contextMenu = { x: e.clientX, y: e.clientY, items: playlistMenu(e.clientX, e.clientY, kind, target, songs) }
}

function onSort(key) {
  setSort(key)
}

function backToLibrary() {
  exitDrill()
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

/** 批量修正标签（F28）：交给 MetaEditor 的批量模式 */
function onBatchEditMeta() {
  const ids = selectedSongs.value
    .filter((s) => String(s.bvid || '').startsWith('local-'))
    .map((s) => String(s.bvid).replace(/^local-/, ''))
  if (!ids.length) {
    ElMessage.info('选中的没有本地曲目，B 站曲目没有标签可改')
    return
  }
  state.metaBatch = { ids, count: ids.length }
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

// ---------- 虚拟滚动 ----------
//
// 不挂满整个列表。500 首歌单一次挂 500 行会变成一个 5 秒级的单块长任务
// （每行带一个 el-dropdown 和 5~6 个 el-icon，实测 23k DOM 节点、主线程阻塞 5.14s），
// 用户点一下歌单要等半分钟才有反应。这里按滚动位置只挂可见区间 + 上下缓冲区。
//
// 滚动容器仍然是 .list-scroll，所以触底加载的哨兵和 IntersectionObserver 完全不用改；
// 上下两块占位撑起总高度，scrollHeight 和哨兵位置都还是对的。
//
// 行高用运行时测量而不是在 CSS 里再写一份常量：各断点 padding 和封面尺寸不同
// （桌面 68 / 手机 56 / 窄屏 54 / 横屏矮屏 48），写死容易和 CSS 漂移。
// 行高是确定的——标题和作者都是 nowrap + ellipsis，不会换行撑高。

const ROW_H_DEFAULT = 68
const BUFFER_ROWS = 8

const rowH = ref(ROW_H_DEFAULT)
const startIdx = ref(0)
const endIdx = ref(20)

function measureRowH() {
  const el = scrollEl.value?.querySelector(".song-row")
  if (!el) return rowH.value
  // offsetHeight 是整数且带浏览器缓存，滚动时反复读不会强制重排。
  const h = el.offsetHeight
  if (h > 0 && h !== rowH.value) rowH.value = h
  return rowH.value
}

function recomputeWindow() {
  const el = scrollEl.value
  const n = rows.value.length
  if (!el || !n) {
    startIdx.value = 0
    endIdx.value = 0
    return
  }
  // 每次都量一遍行高：断点切换是靠 resize 事件触发的，事件万一漏了（比如某些内嵌
  // webview 不发），这里会在下一次滚动时自愈，不至于让占位块一直用旧的 68px。
  const h = measureRowH()
  const top = el.scrollTop
  startIdx.value = Math.max(0, Math.floor(top / h) - BUFFER_ROWS)
  endIdx.value = Math.min(n, Math.ceil((top + el.clientHeight) / h) + BUFFER_ROWS)
}

const visibleRows = computed(() => rows.value.slice(startIdx.value, endIdx.value))
const topSpacer = computed(() => startIdx.value * rowH.value)
const bottomSpacer = computed(
  () => Math.max(0, (rows.value.length - endIdx.value) * rowH.value)
)

function handleScroll() {
  checkLoad()
  recomputeWindow()
}

function resetScroll() {
  scrollEl.value?.scrollTo({ top: 0 })
  recomputeWindow()
}

function checkLoad() {
  if (!scrollEl.value || !sentinel.value) return
  const gap =
    sentinel.value.getBoundingClientRect().top - scrollEl.value.getBoundingClientRect().bottom
  if (gap < PRELOAD_PX) loadMore()
}

function handleResize() {
  recomputeWindow()
}

onMounted(() => {
  // 哨兵始终挂在 DOM 上（不需要时 v-show 隐藏），避免 observer 反复 attach/detach。
  // rootMargin 提前触发，等用户滚到底部时下一页通常已经拿到了。
  if (typeof IntersectionObserver === "function") {
    observer = new IntersectionObserver(
      () => checkLoad(),
      { root: scrollEl.value, rootMargin: `0px 0px ${PRELOAD_PX}px 0px` }
    )
    if (sentinel.value) observer.observe(sentinel.value)
  }
  scrollEl.value?.addEventListener("scroll", handleScroll, { passive: true })
  window.addEventListener("resize", handleResize)
  recomputeWindow()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  scrollEl.value?.removeEventListener("scroll", handleScroll)
  window.removeEventListener("resize", handleResize)
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
  { flush: "post" }
)

// 数据变了要重算窗口：换视图 / 加页 / 批量加入都会改列表。
// post 保证 DOM 已经渲染，recomputeWindow 才能量到真实行高。
watch(
  () => rows.value.length,
  () => recomputeWindow(),
  { flush: "post" }
)

watch(
  () => state.view,
  (view) => {
    resetScroll()
    exitSelectMode()
    if (view === "favorites") void refreshFavorites()
    if (view === "playlist") void refreshPlaylists()
    if (view === "library") {
      if (!state.library.length) void refreshLibrary()
    }
    if (view === "smart") void openSmart(state.smartKind)
    if (view === "history") void openHistory()
  }
)

// 曲库视图下的列表长度变化（扫描完成 / 排序）要重算虚拟滚动窗口
watch(
  () => [state.library.length, state.libraryGroupSongs.length, state.smartSongs.length, state.historySongs.length],
  () => recomputeWindow(),
  { flush: "post" }
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
        <button
          type="button"
          class="select-bar-action"
          title="播放选中的曲目"
          @click="onPlaySelected"
        >
          <el-icon><VideoPlay /></el-icon>
          <span>播放选中</span>
        </button>

        <template v-if="isLocalView">
          <button
            type="button"
            class="select-bar-action"
            title="把选中的导出为 m3u"
            @click="exportM3U(selectedSongs.map((s) => s.bvid))"
          >
            <el-icon><Download /></el-icon>
            <span>导出 m3u</span>
          </button>
          <button
            type="button"
            class="select-bar-action select-bar-danger"
            title="从曲库移除选中（不删磁盘文件）"
            @click="onRemoveSelected"
          >
            <el-icon><Delete /></el-icon>
            <span>移出曲库</span>
          </button>
          <button
            type="button"
            class="select-bar-action"
            title="给选中的曲目统一设置歌手 / 专辑 / 流派等（留空的不改）"
            @click="onBatchEditMeta"
          >
            <el-icon><EditPen /></el-icon>
            <span>批量编辑标签</span>
          </button>
        </template>

        <PlaylistPicker :songs="selectedSongs" @command="batchAdd" @create-then-add="onCreateThenAdd">
          <button type="button" class="select-bar-primary">
            <el-icon><Headset /></el-icon>
            <span>加入歌单</span>
          </button>
        </PlaylistPicker>
      </div>
    </div>

    <!-- 歌单详情头：网易云那套——大封面 + 大字号歌单名 + 一枚红色「播放全部」 -->
    <div v-if="isPlaylistView && !selectMode" class="playlist-header">
      <div class="ph-cover">
        <Svg :d="ICON_PATHS.music" :size="58" />
      </div>
      <div class="ph-info">
        <h2 class="ph-title">{{ title }}</h2>
        <p class="ph-sub">我创建的歌单 · {{ list.length }} 首歌</p>
        <p v-if="state.currentPlaylist" class="ph-updated">
          更新于 {{ formatDate(state.currentPlaylist.updatedAt) }}
        </p>
        <div class="ph-play-row">
          <button type="button" class="play-all-btn" title="播放全部" aria-label="播放全部" @click="onPlayAll">
            <el-icon><VideoPlay /></el-icon>
          </button>
          <span class="ph-play-label">播放全部</span>
        </div>
      </div>
      <div class="ph-actions">
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
      <!-- 曲库下钻的面包屑 -->
      <div v-if="view === 'group' && state.libraryDrill" class="lib-crumb">
        <button type="button" class="crumb-link" @click="backToLibrary">本地曲库</button>
        <span class="crumb-sep">/</span>
        <span class="crumb-cur">{{ groupTypeName(state.libraryDrill.type) }}：{{ state.libraryDrill.value }}</span>
      </div>

      <div class="list-header-main">
        <h2 :title="'右键看整批操作'" @contextmenu="onHeaderContext">{{ title }}</h2>
        <span class="list-meta">{{ meta }}</span>

        <div class="list-actions">
          <template v-if="!selectMode">
            <button type="button" class="header-btn" title="播放全部" @click="onPlayAll">
              <el-icon><VideoPlay /></el-icon>
            </button>
            <button type="button" class="header-btn" title="多选并批量操作" @click="toggleSelectMode">
              <el-icon><Check /></el-icon>
              <span>多选</span>
            </button>
          </template>

          <!-- 曲库专用操作 -->
          <template v-if="isLibraryView && !selectMode">
            <button type="button" class="header-btn" title="添加文件夹" @click="onAddFolder">
              <el-icon><Plus /></el-icon>
              <span>添加文件夹</span>
            </button>
            <button
              v-if="state.libraryFolders.length"
              type="button"
              class="header-btn"
              :title="`移出「${state.libraryFolders[0].name}」`"
              @click="onRemoveFolder"
            >
              <el-icon><FolderDelete /></el-icon>
            </button>
            <button type="button" class="header-btn" title="检查文件是否还在、补进新文件" @click="repairLibrary()">
              <el-icon><RefreshRight /></el-icon>
            </button>
            <button type="button" class="header-btn" title="查找重复曲目" @click="onDuplicates">
              <el-icon><CopyDocument /></el-icon>
            </button>
            <button type="button" class="header-btn" title="导出为 m3u" @click="exportM3U(selectedSongs.length ? selectedSongs.map((s) => s.bvid) : [])">
              <el-icon><Download /></el-icon>
            </button>
          </template>

          <!-- 智能歌单切换 -->
          <template v-if="isSmartView && !selectMode">
            <el-dropdown trigger="click" @command="openSmart">
              <button type="button" class="header-btn" title="切换智能歌单">
                <el-icon><Sort /></el-icon>
                <span>{{ smartKindLabel(state.smartKind) }}</span>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="k in SMART_KINDS" :key="k.key" :command="k.key">
                    {{ k.label }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>

          <!-- 播放历史：清空 -->
          <template v-if="isHistoryView && !selectMode && state.historySongs.length">
            <button type="button" class="header-btn" title="清空播放历史" @click="clearHistory()">
              <el-icon><Delete /></el-icon>
            </button>
          </template>
        </div>
      </div>

      <!-- 曲库的排序与筛选（F12） -->
      <div v-if="isLibraryView && !selectMode" class="lib-toolbar">
        <div class="lib-filter">
          <el-icon><Search /></el-icon>
          <input
            type="text"
            class="lib-filter-input"
            placeholder="按歌名 / 歌手 / 专辑 / 路径筛选"
            :value="state.libraryFilter"
            @input="state.libraryFilter = $event.target.value"
          />
          <button
            v-if="state.libraryFilter"
            type="button"
            class="lib-filter-x"
            title="清空筛选"
            @click="setLibraryFilter('')"
          >
            <el-icon><Close /></el-icon>
          </button>
        </div>

        <el-dropdown trigger="click" @command="onSort">
          <button type="button" class="lib-sort-btn">
            <span>排序：</span>
            <span class="lib-sort-cur">{{ (SORT_OPTIONS.find((o) => o.key === state.librarySortKey) || {}).label || '歌名' }}</span>
            <el-icon><Sort /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="o in SORT_OPTIONS" :key="o.key" :command="o.key">
                {{ o.label }}
                <span class="sort-arrow" :class="{ 'is-asc': state.librarySortDir === 'asc' }">
                  {{ state.librarySortKey === o.key ? (state.librarySortDir === 'asc' ? '↑' : '↓') : '' }}
                </span>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <span v-if="state.scanProgress?.running" class="lib-scan">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>
            {{ state.scanProgress.phase }}
            {{ state.scanProgress.total ? `${state.scanProgress.current} / ${state.scanProgress.total}` : '' }}
          </span>
        </span>
      </div>
    </div>

    <div ref="scrollEl" class="list-scroll">
      <div class="list-inner">
        <!-- 上下占位撑起完整列表高度：滚动条长度和触底哨兵的位置都依赖它 -->
        <div v-if="topSpacer > 0" class="list-spacer" :style="{ height: topSpacer + 'px' }" aria-hidden="true"></div>

        <ol class="song-list">
          <SongRow
            v-for="(row, i) in visibleRows"
            :key="row.song.bvid"
            :song="row.song"
            :index="startIdx + i + 1"
            :removable="isPlaylistView"
            :playlist-id="state.currentPlaylistId"
            @play="onPlay"
            @favorite="toggleFavorite"
            @remove="onRemove"
          />
        </ol>

        <div v-if="bottomSpacer > 0" class="list-spacer" :style="{ height: bottomSpacer + 'px' }" aria-hidden="true"></div>

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

    <!-- 重复检测（F15） -->
    <el-dialog
      :model-value="dupDialogOpen"
      width="680px"
      :close-on-click-modal="false"
      class="dup-dialog"
      @close="closeDuplicates"
    >
      <template #header>
        <div class="dup-head">
          <h3>疑似重复曲目</h3>
          <span v-if="state.duplicates.length" class="dup-count">
            {{ state.duplicates.length }} 组 ·
            {{ state.duplicates.reduce((n, g) => n + g.length, 0) }} 首
          </span>
        </div>
      </template>

      <div v-if="state.duplicates.length" class="dup-groups">
        <div v-for="(g, gi) in state.duplicates" :key="gi" class="dup-group">
          <p v-if="g.length > 1" class="dup-hint">这 {{ g.length }} 首相同：歌名、歌手、时长一致</p>
          <div v-for="s in g" :key="s.bvid" class="dup-row">
            <img v-if="s.cover" :src="s.cover" class="dup-cover" alt="">
            <span v-else class="dup-cover dup-cover-empty">♪</span>
            <div class="dup-info">
              <div class="dup-title">{{ s.title }}</div>
              <div class="dup-author">
                {{ s.author }} · {{ s.duration }} · {{ s.format || '' }}{{ s.sizeText ? ` · ${s.sizeText}` : '' }}
              </div>
              <div class="dup-path" :title="s.path">{{ s.path }}</div>
            </div>
            <button type="button" class="dup-remove" title="从曲库移除这一首（不删磁盘文件）" @click="onDupRemove(s)">
              <el-icon><Delete /></el-icon>
            </button>
          </div>
        </div>
      </div>
      <el-empty v-else description="没有发现重复曲目" :image-size="72" />

      <template #footer>
        <button type="button" class="st-close" @click="closeDuplicates">关闭</button>
      </template>
    </el-dialog>
  </div>
</template>
