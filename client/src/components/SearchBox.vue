<script setup>
import { Search, Close, Delete } from '@element-plus/icons-vue'
import { onMounted, ref, watch } from 'vue'
import { state } from '../state.js'
import { prefs } from '../prefs.js'
import { switchView } from '../navigation.js'
import { runSearch } from '../search.js'
import { debounce } from '../utils.js'

const input = ref('')
// 输入中不打断当前播放，只做搜索
const doSearch = debounce((kw) => runSearch(kw), 400)
// 历史列表本地缓存一份，删除时同步刷新，避免依赖弹层重新请求
const history = ref([])

function syncHistory() {
  history.value = prefs.getHistory()
}

/** 历史即建议项：按已输入内容前缀过滤，空输入返回全部 */
function fetchHistory(queryString, callback) {
  const q = String(queryString || '').trim().toLowerCase()
  callback(
    history.value
      .filter((k) => !q || k.toLowerCase().includes(q))
      .map((k) => ({ value: k }))
  )
}

/**
 * 唯一的提交入口：回车（无选中项）、回车（选中项）、鼠标点选历史项都会走到这里。
 * 靠 select-when-unmatched 把「无选中项的回车」也转成 select 事件，
 * 否则回车既不会被本组件处理、也不会触发自己的 keyup 提交。
 */
function onCommit({ value }) {
  window.__commitProbe = { value, at: Date.now() }
  doSearch.cancel()
  void runSearch(value, { commit: true })
}

function removeHistoryItem(keyword) {
  prefs.removeHistory(keyword)
  syncHistory()
}

function clearAllHistory() {
  prefs.clearHistory()
  syncHistory()
}

watch(input, (value) => {
  if (value.trim() && state.view !== 'search') switchView('search')
  doSearch(value)
})

onMounted(() => {
  syncHistory()
  // 恢复上次关键词，但恢复不算提交，不写历史
  if (state.lastKeyword) {
    input.value = state.lastKeyword
    runSearch(state.lastKeyword)
  }
})
</script>

<template>
  <div class="search-wrap">
    <el-autocomplete
      v-model="input"
      class="search-input"
      placeholder="搜索歌曲、UP 主…"
      clearable
      round
      :prefix-icon="Search"
      :clear-icon="Close"
      :fetch-suggestions="fetchHistory"
      :trigger-on-focus="true"
      :select-when-unmatched="true"
      :debounce="0"
      :hide-loading="true"
      popper-class="history-popper"
      aria-label="搜索关键词"
      @select="onCommit"
    >
      <template #header>
        <div class="history-head">
          <span>搜索历史</span>
          <button type="button" class="history-clear" @click.stop="clearAllHistory">清空</button>
        </div>
      </template>
      <template #default="{ item }">
        <span class="history-item">
          <span class="history-item-text">{{ item.value }}</span>
          <el-icon class="history-del" @click.stop="removeHistoryItem(item.value)">
            <Delete />
          </el-icon>
        </span>
      </template>
    </el-autocomplete>
  </div>
</template>

<style scoped>
.search-input {
  --el-input-bg-color: var(--bg);
  --el-input-hover-border-color: var(--accent);
  --el-input-focus-border-color: var(--accent);
}
.search-input :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--line) inset;
  transition: box-shadow 0.15s;
}
.search-input.is-focus :deep(.el-input__wrapper),
.search-input :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--accent) inset, 0 0 0 3px var(--accent-soft);
}
</style>
