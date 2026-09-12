<script>
import { computed, defineComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { onMediaState, requestState, sendCommand } from './desktop.js'
import { formatTime } from './utils.js'

/** 关掉迷你窗本体（窗口销毁，播放不受影响）。浏览器里没有这条桥，点了没副作用 */
function closeMini() {
  window.desktop?.closeMini()
}

const EMPTY = {
  playing: false,
  bvid: '',
  title: '',
  artist: '',
  cover: '',
  duration: 0,
  progress: 0,
  muted: false,
  volume: 1,
}

/**
 * 迷你窗（F21）：极简置顶小窗。
 *
 * 自己不播歌——所有按钮只发命令给主窗，音源只有一个。
 * 无边框窗口靠 -webkit-app-region: drag 拖动，按钮区域用 no-drag 接住点击。
 */
export default defineComponent({
  setup() {
    const s = ref({ ...EMPTY })
    let stop = null

    const percent = computed(() =>
      s.value.duration > 0 ? Math.min(100, (s.value.progress / s.value.duration) * 100) : 0
    )

    const hasCover = ref(Boolean(s.value.cover))
    function onCoverError() {
      hasCover.value = false
    }

    onMounted(async () => {
      try {
        const snap = await requestState()
        if (snap && typeof snap === 'object') s.value = { ...EMPTY, ...snap }
        hasCover.value = Boolean(s.value.cover)
      } catch {
        // 主进程还没装好 handler 时 invoke 会 reject，窗口保持空态等下一次推送
      }
      stop = onMediaState((snap) => {
        s.value = { ...s.value, ...(snap || {}) }
        if (s.value.cover) hasCover.value = true
      })
    })

    onBeforeUnmount(() => {
      if (stop) stop()
    })

    return {
      s,
      percent,
      hasCover,
      onCoverError,
      sendCommand,
      closeMini,
      formatTime,
    }
  },
})
</script>

<template>
  <div class="mini">
    <!-- 封面高斯模糊铺满 + 压暗层：整窗拖拽区的底，没有封面时只有压暗层 -->
    <div
      v-if="hasCover && s.cover"
      class="mini-bg"
      :style="{ backgroundImage: `url(${s.cover})` }"
      aria-hidden="true"
    ></div>
    <div class="mini-shade" aria-hidden="true"></div>

    <button
      type="button"
      class="mini-close"
      title="关闭迷你窗"
      aria-label="关闭迷你窗"
      @mousedown.stop
      @mouseup.stop
      @click.stop="closeMini"
    >
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
        <path fill="currentColor" d="M2.3 1 6 4.7 9.7 1 11 2.3 7.3 6l3.7 3.7-1.3 1.3L6 7.3 2.3 11 1 9.7 4.7 6 1 2.3z" />
      </svg>
    </button>

    <div class="mini-main">
      <button type="button" class="mini-cover" title="打开主窗口" @click="sendCommand('show-main')">
        <img v-if="hasCover && s.cover" :src="s.cover" alt="" @error="onCoverError" />
        <span v-else class="mini-cover-empty">♪</span>
        <span v-if="s.playing" class="mini-cover-pulse" aria-hidden="true"></span>
      </button>

      <div class="mini-meta">
        <button type="button" class="mini-name" :title="s.title || '未在播放'" @click="sendCommand('show-main')">
          {{ s.title || '未在播放' }}
        </button>
        <div class="mini-artist">{{ s.artist || '—' }}</div>
      </div>
    </div>

    <div class="mini-progress">
      <div class="mini-progress-bar">
        <div class="mini-progress-fill" :style="{ width: percent + '%' }"></div>
      </div>
      <span class="mini-time">{{ formatTime(s.progress) }}</span>
      <span class="mini-time">{{ formatTime(s.duration) }}</span>
    </div>

    <div class="mini-controls">
      <button type="button" class="mini-btn" title="上一首" aria-label="上一首" @click="sendCommand('prev')">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path fill="currentColor" d="M3 2h1.6v12H3zM13.4 2.2v11.6L4.6 8z" />
        </svg>
      </button>

      <button
        type="button"
        class="mini-btn mini-play"
        :title="s.playing ? '暂停' : '播放'"
        :aria-label="s.playing ? '暂停' : '播放'"
        @click="sendCommand('toggle')"
      >
        <svg v-if="s.playing" viewBox="0 0 16 16" width="17" height="17" aria-hidden="true">
          <path fill="currentColor" d="M3.5 2h3.2v12H3.5zM9.3 2h3.2v12H9.3z" />
        </svg>
        <svg v-else viewBox="0 0 16 16" width="17" height="17" aria-hidden="true">
          <path fill="currentColor" d="M4 2v12l9-6z" />
        </svg>
      </button>

      <button type="button" class="mini-btn" title="下一首" aria-label="下一首" @click="sendCommand('next')">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path fill="currentColor" d="M11.4 2h1.6v12h-1.6zM2.6 2.2v11.6L11.4 8z" />
        </svg>
      </button>
    </div>
  </div>
</template>
