<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Search, Collection, Headset, Plus, Folder, FolderOpened, Clock, Star, Operation } from '@element-plus/icons-vue'
import SearchBox from './SearchBox.vue'
import Svg from './Svg.vue'
import { state } from '../state.js'
import { switchView, currentView } from '../views.js'
import { ICON_PATHS } from '../icons.js'
import { openPlaylist } from '../playlists.js'
import { openLibrary, GROUP_TYPES, openGroups, drillInto, exitDrill } from '../library.js'
import { openSmart, SMART_KINDS } from '../history.js'
import { openHistory } from '../history.js'

/**
 * 侧栏五段：品牌 / 搜索 / 导航 / 智能歌单 / 我创建的歌单。
 * 打开本地曲库时，「我创建的歌单」下面换成「曲库分组」，用来做 F9 的下钻入口。
 *
 * 手机端（≤640px）侧栏变顶栏，三段歌单列表收进「歌单」按钮的下拉面板，
 * 避免全部横排挤在顶栏滚动条里。桌面端 .playlists-wrap 是 display:contents，
 * 不影响原有纵向布局。
 */
const emit = defineEmits(['create-playlist'])

const sheetOpen = ref(false)

function closeSheet() {
  sheetOpen.value = false
}

// 点顶栏以外的地方关闭歌单面板（面板内部点击由 mask 拦截）
function onDocDown(e) {
  if (sheetOpen.value && !e.target.closest('.sidebar')) closeSheet()
}

onMounted(() => document.addEventListener('mousedown', onDocDown, true))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown, true))

const activeIndex = computed(() => {
  if (currentView() === 'group') return 'library'
  return state.view
})

function onNavSelect(index) {
  closeSheet()
  if (index === 'library') void openLibrary()
  else if (index === 'history') void openHistory()
  else switchView(index)
}

// ---------- 曲库分组 ----------

const groupType = ref('artist')
const groups = computed(() => state.libraryGroups)
const inLibrary = computed(() => state.view === 'library')
const drill = computed(() => state.libraryDrill)

function groupActive(key) {
  return drill.value?.type === groupType.value && drill.value?.value === key
}

async function pickGroupType(t) {
  groupType.value = t
  exitDrill()
  await openGroups(t)
}

function pickGroup(g) {
  closeSheet()
  void drillInto(groupType.value, g.key)
}

watch(inLibrary, (v) => {
  if (v) void pickGroupType('artist')
}, { immediate: true })

// ---------- 智能歌单 ----------

function pickSmart(kind) {
  closeSheet()
  void openSmart(kind)
}

function pickPlaylist(id) {
  closeSheet()
  void openPlaylist(id)
}
</script>

<template>
  <aside class="sidebar" :class="{ 'is-sheet-open': sheetOpen }">
    <!-- 手机端歌单面板的遮罩：点击只关面板，不穿透到底下列表 -->
    <div v-if="sheetOpen" class="sheet-mask" @click="closeSheet"></div>

    <header class="brand">
      <div class="brand-title">
        <svg class="brand-mark" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M9 18V7l11-2v11"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="6.5" cy="18" r="2.5" fill="currentColor" />
          <circle cx="17.5" cy="16" r="2.5" fill="currentColor" />
        </svg>
        <h1>B 站音乐</h1>
      </div>
      <p class="brand-sub">搜索 · 曲库 · 收藏 · 歌单</p>
    </header>

    <SearchBox />

    <el-menu :default-active="activeIndex" @select="onNavSelect">
      <el-menu-item index="search" title="搜索结果">
        <el-icon><Search /></el-icon>
        <span>搜索结果</span>
      </el-menu-item>
      <el-menu-item index="library" title="本地曲库">
        <el-icon><FolderOpened /></el-icon>
        <span>本地曲库</span>
        <span v-if="state.library.length" class="fav-count">{{ state.library.length }}</span>
      </el-menu-item>
      <el-menu-item index="favorites" title="我的收藏">
        <el-icon><Collection /></el-icon>
        <span>我的收藏</span>
        <span v-if="state.favoriteCount" class="fav-count">{{ state.favoriteCount }}</span>
      </el-menu-item>
      <el-menu-item index="history" title="播放历史">
        <el-icon><Clock /></el-icon>
        <span>播放历史</span>
        <span v-if="state.historySongs.length" class="fav-count">{{ state.historySongs.length }}</span>
      </el-menu-item>
    </el-menu>

    <!-- 手机端入口：点开收纳了智能歌单 / 曲库分组 / 我创建的歌单的下拉面板 -->
    <button
      type="button"
      class="playlists-toggle mobile-only"
      :class="{ 'is-active': sheetOpen }"
      :aria-expanded="sheetOpen"
      aria-label="展开歌单列表"
      @click="sheetOpen = !sheetOpen"
    >
      <el-icon><Headset /></el-icon>
      <span>歌单</span>
      <span v-if="state.playlists.length" class="fav-count">{{ state.playlists.length }}</span>
    </button>

    <div class="playlists-wrap">
      <!-- 智能歌单：不存副本，每次点开都从本地记录现算 -->
      <div class="playlist-block">
        <div class="playlist-head">
          <span>智能歌单</span>
        </div>
        <div class="playlist-scroll">
          <button
            v-for="k in SMART_KINDS"
            :key="k.key"
            type="button"
            class="playlist-item"
            :class="{ 'is-active': state.view === 'smart' && state.smartKind === k.key }"
            :title="k.desc"
            @click.stop="pickSmart(k.key)"
          >
            <span class="playlist-icon"><el-icon><Star /></el-icon></span>
            <span class="playlist-name">{{ k.label }}</span>
          </button>
        </div>
      </div>

      <!-- 曲库分组：歌手 / 专辑 / 文件夹 / 年份 / 流派 -->
      <div v-if="inLibrary" class="playlist-block group-block">
        <div class="playlist-head">
          <span>曲库分组</span>
          <button
            v-if="drill"
            type="button"
            class="playlist-add"
            title="返回曲库"
            aria-label="返回曲库"
            @click.stop="exitDrill()"
          >
            <el-icon><Operation /></el-icon>
          </button>
        </div>
        <div class="group-types">
          <button
            v-for="t in GROUP_TYPES"
            :key="t.key"
            type="button"
            class="group-type"
            :class="{ 'is-active': groupType === t.key }"
            @click.stop="pickGroupType(t.key)"
          >
            {{ t.label }}
          </button>
        </div>
        <div class="playlist-scroll">
          <button
            v-for="g in groups"
            :key="g.key"
            type="button"
            class="playlist-item"
            :class="{ 'is-active': groupActive(g.key) }"
            :title="`${g.name} · ${g.songCount} 首 · ${g.duration || ''}`"
            @click.stop="pickGroup(g)"
          >
            <span v-if="groupType === 'folder'" class="playlist-icon"><el-icon><Folder /></el-icon></span>
            <span v-else class="playlist-icon"><Svg :d="ICON_PATHS.music" :size="16" /></span>
            <span class="playlist-name">{{ g.name }}</span>
            <span class="playlist-count">{{ g.songCount }}</span>
          </button>

          <p v-if="!groups.length" class="playlist-empty">
            这一层还没有内容
          </p>
        </div>
      </div>

      <!-- 我创建的歌单 -->
      <div class="playlist-block">
        <div class="playlist-head">
          <span>我创建的歌单</span>
          <button
            type="button"
            class="playlist-add"
            title="新建歌单"
            aria-label="新建歌单"
            @click.stop="$emit('create-playlist')"
          >
            <el-icon><Plus /></el-icon>
          </button>
        </div>

        <div class="playlist-scroll">
          <button
            v-for="p in state.playlists"
            :key="p.id"
            type="button"
            class="playlist-item"
            :class="{ 'is-active': state.view === 'playlist' && state.currentPlaylistId === p.id }"
            :title="`${p.name} · ${p.songCount} 首`"
            @click.stop="pickPlaylist(p.id)"
          >
            <span class="playlist-icon"><el-icon><Headset /></el-icon></span>
            <span class="playlist-name">{{ p.name }}</span>
            <span class="playlist-count">{{ p.songCount }}</span>
          </button>

          <p v-if="!state.playlists.length && !state.playlistLoading" class="playlist-empty">
            还没有歌单，点右上角 + 创建一个
          </p>
        </div>
      </div>
    </div>

    <footer class="sidebar-footer">
      <p>数据来源：B 站公开接口 + 本地音乐库<br>仅供个人本地使用</p>
    </footer>
  </aside>
</template>
