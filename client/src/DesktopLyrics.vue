<script>
import { computed, defineComponent, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { onCursorInside, onMediaState, requestState, sendCommand } from './desktop.js'
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

    // ---------- 悬停面板 ----------
    //
    // 面板的点亮不能只依赖渲染进程的 mouseenter/mouseleave。这个窗是
    // 透明 + 无边框 + 置顶 + 整窗 -webkit-app-region: drag，指针压在拖拽区上时
    // 鼠标事件能否稳定送到渲染进程取决于浏览器进程的命中处理，会漏；
    // .dl-head / .dl-controls 悬停时又把 pointer-events 从 none 切成 auto，
    // 命中目标一变，父级 .dl 还会收到虚假的 mouseleave。两条叠加就是
    // 「背景只在移入瞬间闪一下」。
    //
    // 权威信号放到主进程：按固定周期取真实系统光标位置和窗口边界比较，
    // 跟渲染进程收不收得到鼠标事件毫无关系。渲染进程的鼠标事件只当快速通道，
    // 让点亮不等下一轮轮询；收起一律走延迟缓冲，轮询晚一拍也不会把面板抖掉。
    const isHover = ref(false)
    let leaveTimer = null
    let offCursor = null

    // 主进程每 100ms 报一次。缓冲给到 350ms：报「在外面」之后还有两三轮
    // 机会在缓冲到期前报回「在里面」，一次漏测不会把面板抖掉。
    const LEAVE_DELAY = 350

    function showPanel() {
      // 锁定时整窗进入「只读」状态：不点亮面板、不显示背景，
      // 只有锁定按钮（锁定态常显）还能点，避免误触拖动 / 点击 / 滚轮
      if (style.lock) return
      if (leaveTimer) {
        clearTimeout(leaveTimer)
        leaveTimer = null
      }
      isHover.value = true
    }

    function scheduleHide() {
      // 已经在倒计时就不要重置：轮询每 100ms 报一次「在外面」，每次都重排的话
      // 缓冲永远到不了期，面板就永远收不起来。
      if (leaveTimer) return
      leaveTimer = setTimeout(() => {
        leaveTimer = null
        isHover.value = false
      }, LEAVE_DELAY)
    }

    /** 主进程光标轮询的结果：光标在不在歌词窗范围内 */
    function onCursor({ inside }) {
      if (inside) showPanel()
      else scheduleHide()
    }

    function onWheel(e) {
      // 滚轮同样是「指针还在窗里」的证据，先撤销收起计时再处理
      showPanel()
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
      offCursor = onCursorInside(onCursor)

      const el = rootEl.value
      if (el) el.addEventListener('wheel', onWheel, { passive: false })
    })

    onBeforeUnmount(() => {
      if (stop) stop()
      if (offCursor) offCursor()
      if (leaveTimer) clearTimeout(leaveTimer)
      const el = rootEl.value
      if (el) el.removeEventListener('wheel', onWheel)
    })

    return {
      s,
      style,
      rootEl,
      isHover,
      showPanel,
      scheduleHide,
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
    :class="{ 'is-hover': isHover, 'is-locked': style.lock, 'is-empty': !current }"
    @mouseenter="showPanel"
    @mousemove="showPanel"
    @mouseover="showPanel"
    @mouseleave="scheduleHide"
  >
    <!-- 关闭按钮：右上角常显，不跟悬停走。窗口无边框也不进任务栏，
         藏进悬停行里用户只能去托盘翻「关闭桌面歌词」，很多人找不到出口 -->
    <button
      type="button"
      class="dl-close"
      title="关闭桌面歌词"
      aria-label="关闭桌面歌词"
      @click.stop="closeLyrics"
    >
      <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
        <path fill="currentColor" d="M2.3 1 6 4.7 9.7 1 11 2.3 7.3 6l3.7 3.7-1.3 1.3L6 7.3 2.3 11 1 9.7 4.7 6 1 2.3z" />
      </svg>
    </button>

    <!-- 顶栏：只保留锁定按钮（悬停出现，锁定时常显）。
         去掉了原来的歌名行——桌面歌词只显示歌词本身，顶上不再有歌名。
         整窗其余部分按住即拖动；锁定时根拖拽区被关掉，只有这个按钮可点 -->
    <div class="dl-head">
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
