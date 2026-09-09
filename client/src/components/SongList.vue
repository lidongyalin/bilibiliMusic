<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import Svg from './Svg.vue'
import SongRow from './SongRow.vue'
import { state } from '../state.js'
import { ICON_PATHS } from '../icons.js'
import { loadMore } from '../search.js'
import { contextOfView, refreshFavorites, toggleFavorite } from '../favorites.js'
import { playSong } from '../player.js'

const list = computed(() => (state.view === 'favorites' ? state.favorites : state.songs))
const rows = computed(() => list.value.map((song, i) => ({ song, index: i + 1 })))

const title = computed(() => {
  if (state.view === 'favorites') return '我的收藏'
  return state.keyword ? `「${state.keyword}」的搜索结果` : '输入关键词开始搜索'
})

const meta = computed(() => {
  if (state.view === 'favorites') {
    return state.favorites.length ? `共 ${state.favorites.length} 首` : ''
  }
  return state.keyword && state.total ? `共约 ${state.total} 个结果` : ''
})

const showEmpty = computed(() => list.value.length === 0 && !state.loading)

const emptyText = computed(() => {
  if (state.view === 'favorites') return '还没有收藏任何歌曲，点击列表右侧的星标即可收藏'
  return state.keyword ? '没有找到相关歌曲，换个关键词试试' : '搜索任意歌曲开始播放'
})

// ---------- 触底自动加载 ----------

const scrollEl = ref(null)
const sentinel = ref(null)
let observer = null

const autoLoad = computed(() => state.view === 'search' && state.hasMore)
const reachedEnd = computed(
  () => state.view === 'search' && !state.hasMore && state.songs.length > 0
)

// 提前加载的距离，也用作 rootMargin，改一处即可。
const PRELOAD_PX = 360

function resetScroll() {
  scrollEl.value?.scrollTo({ top: 0 })
}

// 触底判定：哨兵上边缘距滚动区可视底边小于 PRELOAD_PX 就加载。
// loadMore() 内部有 loading / hasMore / keyword 三重守卫，重复调用是安全的。
function checkLoad() {
  if (!scrollEl.value || !sentinel.value) return
  const gap =
    sentinel.value.getBoundingClientRect().top - scrollEl.value.getBoundingClientRect().bottom
  if (gap < PRELOAD_PX) loadMore()
}

onMounted(() => {
  // 哨兵始终挂在 DOM 上（不需要时 v-show 隐藏），避免 observer 反复 attach/detach。
  // rootMargin 提前触发，等用户滚到底部时下一页通常已经拿到了。
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(
      () => checkLoad(),
      { root: scrollEl.value, rootMargin: `0px 0px ${PRELOAD_PX}px 0px` }
    )
    if (sentinel.value) observer.observe(sentinel.value)
  }
  // scroll 监听兜底：后台标签、无头渲染等环境会节流甚至不触发 IO 回调，
  // 两种触发方式最终都汇到同一个 checkLoad()。
  scrollEl.value?.addEventListener('scroll', checkLoad, { passive: true })
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  scrollEl.value?.removeEventListener('scroll', checkLoad)
})

// 翻页时 page 递增，不动滚动位置；新搜索或清空会把 page 压低，此时回到顶部
watch(
  () => state.page,
  (page, prev) => {
    if (page <= prev) resetScroll()
  }
)

// 结果条数少、列表撑不满一屏时，加载完成后哨兵可能仍落在阈值范围内，
// 再判定一次把它填满，避免留一行「滚动到底部自动加载」却根本滚不动。
// flush: 'post' 关键——默认 pre 会在 DOM 更新前跑，量到的是旧列表的几何位置。
watch(
  () => state.loading,
  (loading) => {
    if (!loading && state.view === 'search') checkLoad()
  },
  { flush: 'post' }
)

// ---------- 交互 ----------

watch(
  () => state.view,
  (view) => {
    resetScroll()
    if (view === 'favorites') void refreshFavorites()
  }
)

function onPlay(song) {
  void playSong(song, contextOfView())
}
</script>

<template>
  <div class="list-wrap">
    <div class="list-header">
      <h2>{{ title }}</h2>
      <span class="list-meta">{{ meta }}</span>
    </div>

    <div ref="scrollEl" class="list-scroll">
      <div class="list-inner">
        <ol class="song-list">
          <SongRow
            v-for="row in rows"
            :key="row.song.bvid"
            :song="row.song"
            :index="row.index"
            @play="onPlay"
            @favorite="toggleFavorite"
          />
        </ol>

        <div v-if="showEmpty" class="list-empty">
          <el-empty :description="emptyText" :image-size="76">
            <template #image>
              <div class="empty-art">
                <Svg :d="ICON_PATHS.music" :size="40" />
              </div>
            </template>
          </el-empty>
        </div>

        <!-- 触底哨兵：自动加载的触发点，同时充当可视的状态提示，点击也可立即加载 -->
        <div
          ref="sentinel"
          v-show="autoLoad || reachedEnd"
          class="load-status"
          :class="{ clickable: autoLoad }"
          :title="autoLoad ? '点击立即加载下一页' : ''"
          @click="loadMore"
        >
          <template v-if="autoLoad && state.loading">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>正在加载下一页…</span>
          </template>
          <template v-else-if="autoLoad">
            <span>滚动到底部自动加载</span>
          </template>
          <template v-else>
            <span>没有更多了</span>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
