<script>
import { computed, defineComponent, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { onMediaState, requestState, sendCommand } from './desktop.js'
import { currentLineIndex } from './lyric-lines.js'
import { prefs } from './prefs.js'

const EMPTY = {
  playing: false,
  bvid: '',
  title: '',
  artist: '',
  lyricOffset: 0,
  lyricStatus: 'idle',
  lyrics: [],
  progress: 0,
}

const COLORS = ['#ffffff', '#ffd54a', '#67cb6c', '#50a9ff', '#fb7299', '#ec4141']

/** 滚轮校准时序的步进。0.25 秒够细，又不至于滑一下偏掉半句 */
const WHEEL_STEP = 0.25

/** 关掉桌面歌词窗本体。浏览器里没有这条桥，点了没副作用 */
function closeLyrics() {
  window.desktop?.closeLyrics()
}

/**
 * 桌面歌词窗（F21/F29）。
 *
 * 独立窗口，透明无边框置顶。歌词内容和主窗共用 state 的快照，
 * 样式存在共享的 localStorage（同 origin），所以不用 IPC 就能和主窗保持一致。
 * 只有时序偏移要回推给主窗——主窗的歌词面板也得跟着对齐。
 */
export default defineComponent({
  setup() {
    const s = ref({ ...EMPTY })
    const style = reactive(prefs.getDesktopLyricsStyle())
    let stop = null
    const rootEl = ref(null)

    const lines = computed(() => (Array.isArray(s.value.lyrics) ? s.value.lyrics : []))

    // 偏移参与：高亮哪一行、点哪一行跳到哪
    const idx = computed(() => currentLineIndex(lines.value, s.value.progress - s.value.lyricOffset))

    const current = computed(() => {
      const i = idx.value
      return i >= 0 ? lines.value[i] : null
    })
    const nextLine = computed(() => {
      const i = idx.value
      return i >= 0 && i + 1 < lines.value.length ? lines.value[i + 1] : null
    })

    const offsetText = computed(() => {
      const v = s.value.lyricOffset
      if (!v) return '0s'
      return `${v > 0 ? '+' : '−'}${Math.abs(v)}s`
    })

    const lineStyle = computed(() => ({
      color: style.color,
      fontSize: `${style.size}px`,
      opacity: style.opacity / 100,
      textShadow: style.outline > 0
        ? `0 0 ${style.outline}px rgba(0,0,0,.85), 0 ${style.outline}px ${style.outline * 2}px rgba(0,0,0,.55)`
        : 'none',
    }))

    function saveStyle(patch) {
      Object.assign(style, patch)
      prefs.setDesktopLyricsStyle(patch)
    }

    /** 校准时序：本地先改，再让主窗同步（主窗负责写 prefs） */
    function shiftOffset(delta) {
      if (!s.value.bvid) return
      const offset = Math.round((s.value.lyricOffset + delta) * 10) / 10
      s.value.lyricOffset = offset
      sendCommand('lyric-offset', { bvid: s.value.bvid, offset })
    }

    function onWheel(e) {
      // 锁定的意思是防误触：滚轮、点击都不响应
      if (style.lock) return
      e.preventDefault()
      shiftOffset(e.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP)
    }

    onMounted(async () => {
      try {
        const snap = await requestState()
        if (snap && typeof snap === 'object') s.value = { ...EMPTY, ...snap }
      } catch {
        // 主进程还没装好 handler 时 invoke 会 reject，窗口保持空态等下一次推送
      }

      stop = onMediaState((snap) => {
        s.value = { ...s.value, ...(snap || {}) }
      })

      const el = rootEl.value
      if (el) el.addEventListener('wheel', onWheel, { passive: false })
    })

    onBeforeUnmount(() => {
      if (stop) stop()
      const el = rootEl.value
      if (el) el.removeEventListener('wheel', onWheel)
    })

    return {
      s,
      style,
      rootEl,
      COLORS,
      lines,
      idx,
      current,
      nextLine,
      offsetText,
      lineStyle,
      saveStyle,
      sendCommand,
      closeLyrics,
    }
  },
})
</script>

<template>
  <div
    ref="rootEl"
    class="dl"
    :class="{ 'is-locked': style.lock, 'is-empty': !current }"
  >
    <!-- 歌名行：悬停出现（锁定时常显，否则没有解锁入口）。
         点歌名回主窗；锁定和关闭在右侧。整窗其余部分按住即拖动 -->
    <div class="dl-head">
      <button
        type="button"
        class="dl-song"
        :title="`${s.title || '未在播放'} · 点击打开主窗口`"
        @click="sendCommand('show-main')"
      >
        {{ s.title || '未在播放' }}
      </button>

      <button
        type="button"
        class="dl-iconbtn"
        :class="{ 'is-on': style.lock }"
        :title="style.lock ? '已锁定，点击解锁' : '锁定：忽略滚轮与点击误触'"
        :aria-label="style.lock ? '已锁定' : '未锁定'"
        @click.stop="saveStyle({ lock: !style.lock })"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            v-if="style.lock"
            fill="currentColor"
            d="M5 7V5a3 3 0 016 0v2h1a1 1 0 011 1v5a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1h1zm1 0h4V5a2 2 0 00-4 0z"
          />
          <path
            v-else
            fill="currentColor"
            d="M5 7V5a3 3 0 015.6-1.4l1.1-1.1A4.5 4.5 0 004 5v2H3a1 1 0 00-1 1v5a1 1 0 001 1h9a1 1 0 001-1V8a1 1 0 00-1-1z"
          />
        </svg>
      </button>

      <button
        type="button"
        class="dl-iconbtn"
        title="关闭桌面歌词"
        aria-label="关闭桌面歌词"
        @click.stop="closeLyrics"
      >
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
          <path fill="currentColor" d="M2.3 1 6 4.7 9.7 1 11 2.3 7.3 6l3.7 3.7-1.3 1.3L6 7.3 2.3 11 1 9.7 4.7 6 1 2.3z" />
        </svg>
      </button>
    </div>

    <!-- 歌词正文：按住任意位置都能拖动窗口 -->
    <div class="dl-lyrics">
      <template v-if="current">
        <div class="dl-line dl-line-prev" v-if="nextLine === null && idx > 0">
          {{ lines[idx - 1].text }}
        </div>
        <div class="dl-line dl-line-now" :style="lineStyle">
          {{ current.text }}
        </div>
        <div class="dl-line dl-line-next" v-if="nextLine">
          {{ nextLine.text }}
        </div>
      </template>
      <div v-else class="dl-none">
        <span class="dl-none-mark" aria-hidden="true">♪</span>
        <span class="dl-none-title">
          {{ s.lyricStatus === 'loading' ? '正在读取歌词…' : (s.title ? '这首歌暂时没有歌词' : '未在播放') }}
        </span>
      </div>
    </div>

    <!-- 调节行：悬停展开；锁定时收起（滑杆本来就不响应） -->
    <div class="dl-controls">
      <label class="dl-field">
        <span>字号</span>
        <input
          type="range"
          min="12"
          max="48"
          step="1"
          :value="style.size"
          @input="saveStyle({ size: Number($event.target.value) })"
        />
        <em>{{ style.size }}</em>
      </label>

      <label class="dl-field">
        <span>透明</span>
        <input
          type="range"
          min="20"
          max="100"
          step="1"
          :value="style.opacity"
          @input="saveStyle({ opacity: Number($event.target.value) })"
        />
        <em>{{ style.opacity }}%</em>
      </label>

      <label class="dl-field">
        <span>描边</span>
        <input
          type="range"
          min="0"
          max="6"
          step="1"
          :value="style.outline"
          @input="saveStyle({ outline: Number($event.target.value) })"
        />
        <em>{{ style.outline }}</em>
      </label>

      <div class="dl-colors">
        <button
          v-for="c in COLORS"
          :key="c"
          type="button"
          class="dl-swatch"
          :class="{ 'is-on': style.color === c }"
          :style="{ background: c }"
          :title="`颜色 ${c}`"
          :aria-label="`颜色 ${c}`"
          @click.stop="saveStyle({ color: c })"
        ></button>
      </div>

      <span class="dl-offset" :title="`滚轮微调时序，当前偏移 ${offsetText}`">{{ offsetText }}</span>
    </div>
  </div>
</template>
