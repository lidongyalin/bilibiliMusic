<script setup>
import { computed, watch } from 'vue'
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

watch(
  () => state.view,
  (view) => {
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

    <el-scrollbar class="list-scroll">
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

        <div v-if="state.view === 'search' && state.hasMore" class="load-more-row">
          <el-button :loading="state.loading" @click="loadMore">加载更多</el-button>
        </div>
      </div>
    </el-scrollbar>
  </div>
</template>
