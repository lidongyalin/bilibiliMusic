<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import { currentLineIndex, isLineVisible, scrollToCenter } from '../lyric-lines.js'
import { seekTo } from '../player.js'
import { setLyricOpen } from '../lyrics.js'
import { prefs } from '../prefs.js'
import { state } from '../state.js'

const scrollEl = ref(null)

// 偏移量要同时作用在两处：算高亮行、点行跳转。只改一处的话校准后歌词看起来对上了，
// 但一点某行又跳回没校准的时间点。
const currentIdx = computed(() => currentLineIndex(state.lyrics, state.progress - state.lyricOffset))

const offsetText = computed(() => {
  const v = state.lyricOffset
  if (!v) return '0s'
  return `${v > 0 ? '+' : '−'}${Math.abs(v)}s`
})

/** 校准步进 0.5 秒；偏移按 bvid 持久化，只存数字不存歌词文本 */
function shiftOffset(delta) {
  if (!state.current) return
  setOffset(state.lyricOffset + delta)
}

function setOffset(sec) {
  const clamped = Math.round(sec * 10) / 10
  state.lyricOffset = clamped
  if (state.current) prefs.setLyricOffset(state.current.bvid, clamped)
}

function resetOffset() {
  setOffset(0)
}

/**
 * 自动滚动：等 DOM 更新完再量位置，否则量到的是旧列表的几何。
 * 当前行已经在视野里就不滚，用户手动往上翻的时候不会被顶回去。
 */
watch(
  [() => state.lyrics, () => state.lyricStatus, () => currentIdx.value],
  async ([lyrics]) => {
    if (!state.lyricOpen || !lyrics.length) return
    const idx = currentIdx.value
    if (idx < 0) return
    await nextTick()

    const el = scrollEl.value
    if (!el) return
    const line = el.children[idx]
    if (!line || typeof line.offsetTop !== 'number') return

    const top = line.offsetTop
    const height = line.offsetHeight
    if (isLineVisible(top, height, el.scrollTop, el.clientHeight)) return

    el.scrollTo({ top: scrollToCenter(top, height, el.clientHeight), behavior: 'smooth' })
  }
)

function onLineClick(i) {
  const line = state.lyrics[i]
  if (line) seekTo(line.time + state.lyricOffset)
}
</script>

<template>
  <aside
    class="lyric-panel"
    :class="{ 'is-open': state.lyricOpen }"
    :aria-hidden="!state.lyricOpen"
    aria-label="歌词"
  >
    <header class="lp-header">
      <div class="lp-song">
        <div class="lp-title">{{ state.current?.title || '未选择曲目' }}</div>
        <div class="lp-author">{{ state.current?.author || '—' }}</div>
      </div>
      <div class="lp-tools">
        <div class="lp-cal">
          <button
            v-if="state.lyricOffset"
            type="button"
            class="lp-cal-val is-set"
            :title="`已偏移 ${offsetText}，点击复位`"
            @click="resetOffset"
          >{{ offsetText }}</button>
          <span v-else class="lp-cal-val" title="歌词时序偏移">{{ offsetText }}</span>
          <div class="lp-cal-btns">
            <button type="button" class="lp-cal-step" title="歌词提前 0.5 秒" @click="shiftOffset(-0.5)">−</button>
            <button type="button" class="lp-cal-step" title="歌词延后 0.5 秒" @click="shiftOffset(0.5)">+</button>
          </div>
        </div>
        <button
          type="button"
          class="lp-close"
          title="收起歌词"
          aria-label="收起歌词"
          @click="setLyricOpen(false)"
        >
          ×
        </button>
      </div>
    </header>

    <div v-if="state.lyricStatus === 'loading'" class="lp-placeholder">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>正在查找歌词…</span>
    </div>

    <div v-else-if="!state.lyrics.length" class="lp-placeholder">
      <span>暂无歌词</span>
      <span class="lp-hint">这首没找到匹配的歌词</span>
    </div>

    <template v-else>
      <div class="lp-scroll" ref="scrollEl">
        <div class="lp-pad" aria-hidden="true"></div>
        <p
          v-for="(line, i) in state.lyrics"
          :key="i"
          class="lp-line"
          :class="{ 'is-active': i === currentIdx }"
          @click="onLineClick(i)"
        >
          {{ line.text }}
        </p>
        <div class="lp-pad" aria-hidden="true"></div>
      </div>

      <footer v-if="state.lyricMatch" class="lp-footer">
        <template v-if="state.lyricMatch.local">歌词来自本地文件 {{ state.lyricMatch.name }}</template>
        <template v-else>歌词来自{{ state.lyricMatch.source }}《{{ state.lyricMatch.name }}》</template>
      </footer>
    </template>
  </aside>
</template>
