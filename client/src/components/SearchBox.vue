<script setup>
import { Search, Close, Delete } from '@element-plus/icons-vue'
import { onMounted, ref, watch } from 'vue'
import { state } from '../state.js'
import { prefs } from '../prefs.js'
import { switchView } from '../navigation.js'
import { runSearch } from '../search.js'
import { debounce } from '../utils.js'

const input = ref('')
// el-autocomplete 实例：删除/清空历史后要主动刷新下拉里已渲染的列表
const ac = ref(null)
// 输入中不打断当前播放，只做搜索
const doSearch = debounce((kw) => runSearch(kw), 400)

/**
 * 历史即建议项：按已输入内容过滤，空输入返回全部。
 * 每次都从 prefs 现读，不缓存到本地 ref——提交新关键词会改写历史，
 * 缓存会导致下拉一直显示上一次搜索前的旧数据。
 */
function fetchHistory(queryString, callback) {
  const q = String(queryString || '').trim().toLowerCase()
  callback(
    prefs
      .getHistory()
      .filter((k) => !q || k.toLowerCase().includes(q))
      .map((k) => ({ value: k }))
  )
}

function refreshSuggestions() {
  ac.value?.getData(input.value)
}

/**
 * 唯一的提交入口。靠 select-when-unmatched 把「无选中项的回车」也转成 select 事件：
 * 回车无高亮 → select(当前输入)；回车有高亮 / 鼠标点选 → select(该项)。
 * 三条路径都从这里走，避免 keyup.enter 与 select 重复触发搜索。
 */
function onCommit({ value }) {
  doSearch.cancel()
  void runSearch(value, { commit: true })
}

function removeHistoryItem(keyword) {
  prefs.removeHistory(keyword)
  refreshSuggestions()
}

function clearAllHistory() {
  prefs.clearHistory()
  refreshSuggestions()
}

watch(input, (value) => {
  if (value.trim() && state.view !== 'search') switchView('search')
  doSearch(value)
})

onMounted(() => {
  // 恢复上次关键词；恢复不算用户提交，不写历史
  if (state.lastKeyword) {
    input.value = state.lastKeyword
    runSearch(state.lastKeyword)
  }
})
</script>

<template>
  <div class="search-wrap">
    <el-autocomplete
      ref="ac"
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
