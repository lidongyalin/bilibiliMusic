<script setup>
import { computed } from 'vue'
import {
  Star,
  StarFilled,
  VideoPlay,
  VideoPause,
  Loading,
  Film,
} from '@element-plus/icons-vue'
import PlaylistPicker from './PlaylistPicker.vue'
import { state } from '../state.js'
import { togglePlay, isLocalSong } from '../player.js'
import { currentList } from '../views.js'
import { songMenu, songHint } from '../menu.js'
import { isSelected, toggleSelect, addSongsToPlaylist } from '../playlists.js'

const props = defineProps({
  song: { type: Object, required: true },
  index: { type: Number, default: 0 },
  // 歌单视图里显示「从歌单移除」；搜索结果/收藏里不显示
  removable: { type: Boolean, default: false },
  // 歌单 id：removable 为 true 时必填
  playlistId: { type: String, default: '' },
})

const emit = defineEmits(['play', 'favorite', 'remove'])

const isCurrent = computed(() => state.current?.bvid === props.song.bvid)
const isFaved = computed(() => state.favoriteIds.has(props.song.bvid))
const isLoading = computed(() => isCurrent.value && state.status === 'loading')
const isPlaying = computed(() => isCurrent.value && state.status === 'playing')
const isPaused = computed(() => isCurrent.value && state.status === 'paused')
const checked = computed(() => isSelected(props.song.bvid))
const inSelectMode = computed(() => state.selectMode)
const local = computed(() => isLocalSong(props.song))

/** 本地曲目的额外信息：格式 / 大小 / 比特率，替代 B 站那列播放量 */
const localHint = computed(() => {
  const s = props.song
  if (!local.value) return ''
  return songHint(s)
})

/**
 * 点击行：多选模式下只切换勾选（不播放）；
 * 正常模式下点当前曲目 = 暂停/继续，点别的 = 切歌。
 */
function onRowClick() {
  if (inSelectMode.value) {
    toggleSelect(props.song.bvid)
    return
  }
  if (isLoading.value) return
  if (isCurrent.value) {
    togglePlay()
    return
  }
  emit('play', props.song)
}

/** 单首加入歌单：不需要清多选（此时不在多选模式） */
function onAddToPlaylist(id) {
  void addSongsToPlaylist(id, [props.song])
}

/** 右键弹出统一上下文菜单（F16）。本地曲目多几个本地相关的动作 */
function onContextMenu(e) {
  e.preventDefault()
  e.stopPropagation()
  openMenuAt(e.clientX, e.clientY)
}

/** 在指定视口坐标弹出当前曲目的上下文菜单（右键 / 长按共用） */
function openMenuAt(x, y) {
  state.contextMenu = {
    x,
    y,
    items: songMenu(x, y, props.song, currentList()),
  }
}

// ---------- 触屏长按 ----------
// 手机没有右键：按住 500ms 视为「右键」。移动超过阈值视为滚动，取消计时；
// 触发后吞掉随行的 click，避免松手瞬间又把歌切了。

const LONG_PRESS_MS = 500
const MOVE_THRESHOLD = 12

let pressTimer = 0
let pressX = 0
let pressY = 0
let pressHandled = false

function onTouchStart(e) {
  if (inSelectMode.value || pressTimer) return
  const t = e.touches[0]
  if (!t) return
  pressX = t.clientX
  pressY = t.clientY
  pressHandled = false
  pressTimer = window.setTimeout(() => {
    pressTimer = 0
    pressHandled = true
    openMenuAt(pressX, pressY)
  }, LONG_PRESS_MS)
}

function onTouchMove(e) {
  if (!pressTimer) return
  const t = e.touches[0]
  if (!t) return
  if (Math.abs(t.clientX - pressX) > MOVE_THRESHOLD || Math.abs(t.clientY - pressY) > MOVE_THRESHOLD) {
    clearTimeout(pressTimer)
    pressTimer = 0
  }
}

function onTouchEnd() {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = 0
  }
}

function onRowClick() {
  // 长按刚触发过：这次 click 是松手带出来的，不是选择意图
  if (pressHandled) {
    pressHandled = false
    return
  }
  if (inSelectMode.value) {
    toggleSelect(props.song.bvid)
    return
  }
  if (isLoading.value) return
  if (isCurrent.value) {
    togglePlay()
    return
  }
  emit('play', props.song)
}
}
</script>

<template>
  <li
    class="song-row"
    :class="{
      'is-current': isCurrent,
      'is-loading': isLoading,
      'is-paused': isPaused,
      'is-selected': checked,
      'select-mode': inSelectMode,
    }"
    :title="`${song.title} — ${song.author}${local ? '\n' + localHint : ''}`"
    @click="onRowClick"
    @contextmenu="onContextMenu"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend.passive="onTouchEnd"
    @touchcancel.passive="onTouchEnd"
  >
    <span v-if="inSelectMode" class="song-check" @click.stop="toggleSelect(song.bvid)">
      <span class="check-box" :class="{ 'is-checked': checked }">
        <svg v-if="checked" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6.5L5 9L9.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    </span>

    <span class="song-index">
      <el-icon v-if="isLoading" class="is-loading"><Loading /></el-icon>
      <span v-else-if="isCurrent && isPlaying" class="eq" aria-label="正在播放">
        <i></i><i></i><i></i>
      </span>
      <el-icon v-else-if="isCurrent && isPaused"><VideoPlay /></el-icon>
      <span v-else class="song-index-num">{{ index }}</span>
    </span>

    <div class="song-cover">
      <!-- 不用 el-image 的 lazy。它靠 getScrollContainer 自己找滚动根，而那个函数把
           overflow: hidden 也算滚动容器——列表里每个封面都被自己的 .el-image 当成根，
           观察目标和根是同一个，实测 500 行里只有 9 个触发过，往下滚再也没加载。
           列表已经虚拟化了，一屏最多挂二十几行，直接 eager 加载就行。 -->
      <el-image v-if="song.cover" :src="song.cover" fit="cover">
        <template #error>
          <span class="cover-fallback"><el-icon><Film /></el-icon></span>
        </template>
      </el-image>
      <span v-else class="cover-fallback"><el-icon><Film /></el-icon></span>

      <span class="cover-mask">
        <el-icon v-if="isLoading" class="is-loading"><Loading /></el-icon>
        <el-icon v-else-if="isCurrent && isPlaying"><VideoPause /></el-icon>
        <el-icon v-else><VideoPlay /></el-icon>
      </span>
    </div>

    <div class="song-info">
      <div class="song-title">
        {{ song.title }}
        <span v-if="song.isPay" class="tag-paid">付费</span>
        <span v-if="local" class="tag-local">本地</span>
        <span v-if="song.hasMetaOverride" class="tag-edit" title="标签已被本地修改">已改</span>
        <span v-if="song.broken" class="tag-broken" title="文件已不存在">缺失</span>
      </div>
      <div class="song-author">{{ song.author }}</div>
    </div>

    <span class="song-meta">{{ song.duration }}</span>
    <span v-if="local" class="song-play-count">{{ localHint }}</span>
    <span v-else class="song-play-count">{{ song.playText }}</span>

    <div class="row-actions" @click.stop>
      <PlaylistPicker v-if="!inSelectMode" :songs="[song]" @command="onAddToPlaylist">
        <button type="button" class="row-btn" title="加入歌单" aria-label="加入歌单">
          <svg class="stroke-icon" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14M12 5v14M17 9l3 3-3 3" />
          </svg>
        </button>
      </PlaylistPicker>

      <button
        v-if="removable"
        type="button"
        class="row-btn row-remove"
        title="从歌单移除"
        aria-label="从歌单移除"
        @click="emit('remove', song)"
      >
        <svg class="stroke-icon" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 7h12M9 7V5h6v2M8 7l1 12h6l1-12" />
        </svg>
      </button>

      <button
        type="button"
        class="row-btn"
        :class="{ 'is-faved': isFaved }"
        :title="isFaved ? '取消收藏' : '收藏'"
        :aria-label="isFaved ? '取消收藏' : '收藏'"
        @click="emit('favorite', song)"
      >
        <el-icon><StarFilled v-if="isFaved" /><Star v-else /></el-icon>
      </button>
    </div>
  </li>
</template>
