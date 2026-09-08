<script setup>
import { computed, ref, watch } from 'vue'
import {
  DArrowLeft,
  DArrowRight,
  Film,
  Star,
  StarFilled,
  VideoPause,
  VideoPlay,
} from '@element-plus/icons-vue'
import Svg from './Svg.vue'
import { state } from '../state.js'
import { MODE_ICONS, MODE_LABELS, volumeIconPath } from '../icons.js'
import { cycleMode, next, prev, seekTo, setVolume, toggleMute, togglePlay } from '../player.js'
import { isCurrentFaved, toggleFavorite } from '../favorites.js'
import { formatTime } from '../utils.js'

const playing = computed(() => state.status === 'playing')
const hasSong = computed(() => Boolean(state.current))
const currentFaved = computed(() => isCurrentFaved())

// ---------- 进度条 ----------
// 拖动时用本地值显示，松手才真正 seek，避免拖动期间被 timeupdate 顶回去
const display = ref(0)
const scrubbing = ref(false)

watch(
  () => state.progress,
  (value) => {
    if (!scrubbing.value) display.value = value
  }
)
watch(
  () => state.current,
  () => {
    display.value = 0
    scrubbing.value = false
  }
)

const progressMax = computed(() => (state.duration > 0 ? state.duration : 1))

function onScrub(value) {
  scrubbing.value = true
  display.value = value
}

function onScrubEnd(value) {
  scrubbing.value = false
  seekTo(value)
}

// ---------- 音量 ----------
const shownVolume = computed(() => Math.round((state.muted ? 0 : state.volume) * 100))
const volumeIcon = computed(() => volumeIconPath(state.muted, state.volume))

function onVolumeInput(value) {
  setVolume(value / 100)
}

// ---------- 播放模式 / 封面 ----------
const modeIcon = computed(() => MODE_ICONS[state.mode])
const modeLabel = computed(() => MODE_LABELS[state.mode])

const coverOk = ref(true)
watch(
  () => state.current,
  () => {
    coverOk.value = true
  }
)
function onCoverError() {
  coverOk.value = false
}
</script>

<template>
  <footer class="player-bar">
    <div class="now-playing">
      <div class="np-art">
        <img
          v-if="state.current?.cover && coverOk"
          :src="state.current.cover"
          alt=""
          @error="onCoverError"
        />
        <span v-else class="cover-fallback"><el-icon><Film /></el-icon></span>
      </div>

      <div class="np-text">
        <div class="np-title">{{ state.current?.title || '未选择曲目' }}</div>
        <div class="np-author">{{ state.current?.author || '—' }}</div>
      </div>

      <button
        type="button"
        class="row-btn"
        :class="{ 'is-faved': currentFaved }"
        :disabled="!hasSong"
        :title="currentFaved ? '取消收藏' : '收藏'"
        :aria-label="currentFaved ? '取消收藏' : '收藏'"
        @click="toggleFavorite(state.current)"
      >
        <el-icon><StarFilled v-if="currentFaved" /><Star v-else /></el-icon>
      </button>
    </div>

    <div class="player-controls">
      <div class="controls-buttons">
        <el-tooltip :content="modeLabel" placement="top">
          <button
            type="button"
            class="transport-btn mode-btn is-active"
            title="切换播放模式（快捷键 L）"
            aria-label="切换播放模式"
            @click="cycleMode"
          >
            <Svg :d="modeIcon" :size="19" />
          </button>
        </el-tooltip>

        <button
          type="button"
          class="transport-btn"
          :disabled="!hasSong"
          title="上一首（P）"
          aria-label="上一首"
          @click="prev"
        >
          <el-icon><DArrowLeft /></el-icon>
        </button>

        <button
          type="button"
          class="transport-btn play-btn"
          :disabled="!hasSong"
          :title="playing ? '暂停（空格）' : '播放（空格）'"
          :aria-label="playing ? '暂停' : '播放'"
          @click="togglePlay"
        >
          <el-icon><VideoPause v-if="playing" /><VideoPlay v-else /></el-icon>
        </button>

        <button
          type="button"
          class="transport-btn"
          :disabled="!hasSong"
          title="下一首（N）"
          aria-label="下一首"
          @click="next(false)"
        >
          <el-icon><DArrowRight /></el-icon>
        </button>
      </div>

      <div class="progress-row">
        <span class="time">{{ formatTime(state.progress) }}</span>
        <el-slider
          v-model="display"
          class="progress-slider"
          :min="0"
          :max="progressMax"
          :step="0.1"
          :show-tooltip="false"
          :disabled="!hasSong"
          aria-label="播放进度"
          @input="onScrub"
          @change="onScrubEnd"
        />
        <span class="time">{{ formatTime(state.duration) }}</span>
      </div>
    </div>

    <div class="volume-row">
      <button
        type="button"
        class="mute-btn"
        :title="state.muted ? '取消静音' : '静音'"
        :aria-label="state.muted ? '取消静音' : '静音'"
        @click="toggleMute"
      >
        <Svg :d="volumeIcon" :size="18" />
      </button>
      <el-slider
        :model-value="shownVolume"
        :min="0"
        :max="100"
        :step="1"
        :show-tooltip="false"
        aria-label="音量"
        @input="onVolumeInput"
      />
    </div>
  </footer>
</template>
