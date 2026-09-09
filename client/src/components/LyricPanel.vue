<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import { currentLineIndex, isLineVisible, scrollToCenter } from '../lyric-lines.js'
import { seekTo } from '../player.js'
import { setLyricOpen } from '../lyrics.js'
import { state } from '../state.js'

const scrollEl = ref(null)

const currentIdx = computed(() => currentLineIndex(state.lyrics, state.progress))

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
  if (line) seekTo(line.time)
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
      <button
        type="button"
        class="lp-close"
        title="收起歌词"
        aria-label="收起歌词"
        @click="setLyricOpen(false)"
      >
        ×
      </button>
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
        歌词来自{{ state.lyricMatch.source }}《{{ state.lyricMatch.name }}》
      </footer>
    </template>
  </aside>
</template>
