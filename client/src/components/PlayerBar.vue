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
  AlarmClock,
  Setting,
  Sort,
  FullScreen,
} from '@element-plus/icons-vue'
import Svg from './Svg.vue'
import { state } from '../state.js'
import { ICON_PATHS, MODE_ICONS, MODE_LABELS, volumeIconPath } from '../icons.js'
import {
  cancelSleepTimer, cycleMode, next, prev, seekTo, setVolume, toggleMute, togglePlay,
  setSpeed, speedLabel, sleepRemaining, startSleepAfterCurrent, startSleepTimer, SLEEP_OPTIONS,
} from '../player.js'
import { toggleLyricPanel } from '../lyrics.js'
import { isCurrentFaved, toggleFavorite } from '../favorites.js'
import { openMenu, playerMenu } from '../menu.js'
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

// ---------- 附加控制：倍速 / 睡眠定时 / 队列 / 均衡器 / 沉浸 / 设置 ----------

const speedText = computed(() => speedLabel(state.speed))
const sleepText = computed(() => {
  if (state.sleepAfterCurrent) return '播完即停'
  const s = sleepRemaining()
  if (!s) return '睡眠定时'
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `定时 ${m}:${String(ss).padStart(2, '0')}`
})
const sleepActive = computed(() => sleepRemaining() > 0 || state.sleepAfterCurrent)
const queueCount = computed(() => state.queue.length)

function onSpeedChange(v) {
  setSpeed(v)
}

/**
 * 睡眠定时：选分钟数启动定时（已有定时在跑时再选就是取消），
 * 选「播完即停」切到播完当前曲模式，再点一次取消。
 */
function onSleepChange(v) {
  if (v === 'after-current') {
    if (state.sleepAfterCurrent) return cancelSleepTimer()
    return startSleepAfterCurrent()
  }
  const n = Math.round(Number(v) || 0)
  if (!n) return cancelSleepTimer()
  if (state.sleepAfterCurrent || !state.sleepEndsAt) return startSleepTimer(n)
  cancelSleepTimer()
}

/**
 * 「更多」菜单：手机端播放条收起的控制（收藏/模式/上一首/歌词/倍速/定时/EQ/队列/沉浸/设置）
 * 都从这里进。复用 contextMenu 通道——手机上是底部 Action Sheet，窄窗口下是普通菜单。
 */
function openPlayerMenu() {
  openMenu(window.innerWidth / 2, window.innerHeight - 80, playerMenu())
}
</script>

<template>
  <footer class="player-bar">
    <div class="now-playing">
      <div
        class="np-art"
        role="button"
        tabindex="0"
        :title="hasSong ? '打开沉浸式播放页' : ''"
        @click="state.immersive = true"
        @keydown.enter="state.immersive = true"
      >
        <img
          v-if="state.current?.cover && coverOk"
          :src="state.current.cover"
          alt=""
          @error="onCoverError"
        />
        <span v-else class="cover-fallback"><el-icon><Film /></el-icon></span>
      </div>

      <div
        class="np-text"
        role="button"
        tabindex="0"
        :title="hasSong ? '打开沉浸式播放页' : ''"
        @click="state.immersive = true"
        @keydown.enter="state.immersive = true"
      >
        <div class="np-title">{{ state.current?.title || '未选择曲目' }}</div>
        <div class="np-author">{{ state.current?.author || '—' }}</div>
      </div>

      <button
        type="button"
        class="row-btn more-btn mobile-only"
        :disabled="!hasSong"
        title="更多操作"
        aria-label="更多操作"
        @click="openPlayerMenu"
      >
        <Svg :d="ICON_PATHS.more" :size="19" />
      </button>

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
          class="transport-btn prev-btn"
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

        <button
          type="button"
          class="transport-btn queue-btn mobile-only"
          :class="{ 'is-active': state.queueOpen }"
          :title="`播放队列（${queueCount} 首）`"
          aria-label="播放队列"
          @click="state.queueOpen = !state.queueOpen"
        >
          <Svg :d="ICON_PATHS.queue" :size="19" />
        </button>

        <button
          type="button"
          class="transport-btn lyric-toggle"
          :class="{ 'is-active': state.lyricOpen }"
          :title="state.lyricOpen ? '收起歌词（G）' : '显示歌词（G）'"
          :aria-label="state.lyricOpen ? '收起歌词' : '显示歌词'"
          :aria-pressed="state.lyricOpen"
          @click="toggleLyricPanel()"
        >
          <Svg :d="ICON_PATHS.lyrics" :size="18" />
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

    <div class="right-col">
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

      <div class="util-row">
        <el-dropdown trigger="click" @command="onSpeedChange">
          <button
            type="button"
            class="util-btn"
            :class="{ 'is-active': state.speed !== 1 }"
            title="倍速播放"
            aria-label="倍速播放"
          >
            {{ speedText }}
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="v in [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]"
                :key="v"
                :command="v"
                :class="{ 'is-active': state.speed === v }"
              >
                {{ v === 1 ? '原速' : v + '×' }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-dropdown trigger="click" @command="onSleepChange">
          <button
            type="button"
            class="util-btn"
            :class="{ 'is-active': sleepActive }"
            :title="sleepActive ? '点击取消定时' : '设置定时停止'"
            aria-label="睡眠定时"
          >
            <el-icon><AlarmClock /></el-icon>
            <span v-if="sleepActive">{{ sleepText }}</span>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="m in SLEEP_OPTIONS"
                :key="m"
                :command="m"
              >
                {{ m >= 60 ? `${m / 60} 小时` : `${m} 分钟` }}后停止
              </el-dropdown-item>
              <el-dropdown-item divided command="after-current">
                {{ state.sleepAfterCurrent ? '✓ 播完当前曲后停止' : '播完当前曲后停止' }}
              </el-dropdown-item>
              <el-dropdown-item v-if="sleepActive" command="0">立即停止</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <button
          type="button"
          class="util-btn"
          :class="{ 'is-active': state.queueOpen }"
          :title="`播放队列（${queueCount} 首）· 快捷键 Q`"
          aria-label="播放队列"
          @click="state.queueOpen = !state.queueOpen"
        >
          <el-icon><Sort /></el-icon>
          <span v-if="queueCount" class="util-count">{{ queueCount }}</span>
        </button>

        <button
          type="button"
          class="util-btn"
          :class="{ 'is-active': state.eqOpen }"
          :title="`均衡器${state.masterGain ? `（${state.masterGain > 0 ? '+' : ''}${state.masterGain}dB）` : ''} · 快捷键 E`"
          aria-label="均衡器"
          @click="state.eqOpen = !state.eqOpen"
        >
          <span class="util-glyph">EQ</span>
        </button>

        <button
          type="button"
          class="util-btn"
          :class="{ 'is-active': state.immersive }"
          title="沉浸式播放页（I）"
          aria-label="沉浸式播放页"
          @click="state.immersive = !state.immersive"
        >
          <el-icon><FullScreen /></el-icon>
        </button>

        <button
          type="button"
          class="util-btn"
          title="设置（Ctrl+,）"
          aria-label="设置"
          @click="state.settingsOpen = true"
        >
          <el-icon><Setting /></el-icon>
        </button>
      </div>
    </div>
  </footer>
</template>
