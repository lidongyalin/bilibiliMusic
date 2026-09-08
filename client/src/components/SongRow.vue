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
import { state } from '../state.js'
import { togglePlay } from '../player.js'

const props = defineProps({
  song: { type: Object, required: true },
  index: { type: Number, default: 0 },
})

const emit = defineEmits(['play', 'favorite'])

const isCurrent = computed(() => state.current?.bvid === props.song.bvid)
const isFaved = computed(() => state.favoriteIds.has(props.song.bvid))
const isLoading = computed(() => isCurrent.value && state.status === 'loading')
const isPlaying = computed(() => isCurrent.value && state.status === 'playing')
const isPaused = computed(() => isCurrent.value && state.status === 'paused')

/** 点击当前正在播放的曲目 = 暂停/继续，否则切歌 */
function onRowClick() {
  if (isLoading.value) return
  if (isCurrent.value) {
    togglePlay()
    return
  }
  emit('play', props.song)
}
</script>

<template>
  <li
    class="song-row"
    :class="{ 'is-current': isCurrent, 'is-loading': isLoading, 'is-paused': isPaused }"
    :title="`${song.title} — ${song.author}`"
    @click="onRowClick"
  >
    <span class="song-index">
      <el-icon v-if="isLoading" class="is-loading"><Loading /></el-icon>
      <span v-else-if="isCurrent && isPlaying" class="eq" aria-label="正在播放">
        <i></i><i></i><i></i>
      </span>
      <el-icon v-else-if="isCurrent && isPaused"><VideoPlay /></el-icon>
      <span v-else>{{ index }}</span>
    </span>

    <div class="song-cover">
      <el-image v-if="song.cover" :src="song.cover" fit="cover" lazy>
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

    <div class="row-actions">
      <button
        type="button"
        class="row-btn"
        :class="{ 'is-faved': isFaved }"
        :title="isFaved ? '取消收藏' : '收藏'"
        :aria-label="isFaved ? '取消收藏' : '收藏'"
        @click.stop="emit('favorite', song)"
      >
        <el-icon><StarFilled v-if="isFaved" /><Star v-else /></el-icon>
      </button>
    </div>
  </li>
</template>
