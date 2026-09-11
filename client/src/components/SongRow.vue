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
import { togglePlay } from '../player.js'
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
    :title="`${song.title} — ${song.author}`"
    @click="onRowClick"
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
      </div>
      <div class="song-author">{{ song.author }}</div>
    </div>

    <span class="song-meta">{{ song.duration }}</span>
    <span class="song-play-count">{{ song.playText }}</span>

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
