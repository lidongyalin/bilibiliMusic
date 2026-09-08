<script setup>
import { Search, Close } from '@element-plus/icons-vue'
import { onMounted, ref, watch } from 'vue'
import { state } from '../state.js'
import { switchView } from '../navigation.js'
import { runSearch } from '../search.js'
import { debounce } from '../utils.js'

const input = ref('')
// 输入中不打断当前播放，只做搜索
const doSearch = debounce((kw) => runSearch(kw), 400)

watch(input, (value) => {
  if (value.trim() && state.view !== 'search') switchView('search')
  doSearch(value)
})

function onSubmit() {
  if (!input.value.trim()) return
  doSearch.cancel()
  runSearch(input.value)
}

onMounted(() => {
  if (state.lastKeyword) {
    input.value = state.lastKeyword
    runSearch(state.lastKeyword)
  }
})
</script>

<template>
  <div class="search-wrap">
    <el-input
      v-model="input"
      class="search-input"
      placeholder="搜索歌曲、UP 主…"
      round
      clearable
      :prefix-icon="Search"
      :clear-icon="Close"
      aria-label="搜索关键词"
      @keyup.enter="onSubmit"
    />
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
