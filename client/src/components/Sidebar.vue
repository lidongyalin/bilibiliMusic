<script setup>
import { Search, Collection, Headset, Plus } from '@element-plus/icons-vue'
import SearchBox from './SearchBox.vue'
import { state } from '../state.js'
import { switchView } from '../navigation.js'
import { openPlaylist } from '../playlists.js'

/**
 * 侧栏四段：品牌 / 搜索 / 导航 / 歌单列表。歌单多时这一段自己滚，
 * 别把底部的播放条顶走。
 */
const emit = defineEmits(['create-playlist'])
</script>

<template>
  <aside class="sidebar">
    <header class="brand">
      <div class="brand-title">
        <svg class="brand-mark" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M9 18V7l11-2v11"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="6.5" cy="18" r="2.5" fill="currentColor" />
          <circle cx="17.5" cy="16" r="2.5" fill="currentColor" />
        </svg>
        <h1>B 站音乐</h1>
      </div>
      <p class="brand-sub">搜索 · 播放 · 收藏 · 歌单</p>
    </header>

    <SearchBox />

    <el-menu :default-active="state.view === 'playlist' ? 'favorites' : state.view" @select="switchView">
      <el-menu-item index="search">
        <el-icon><Search /></el-icon>
        <span>搜索结果</span>
      </el-menu-item>
      <el-menu-item index="favorites">
        <el-icon><Collection /></el-icon>
        <span>我的收藏</span>
        <span v-if="state.favoriteCount" class="fav-count">{{ state.favoriteCount }}</span>
      </el-menu-item>
    </el-menu>

    <div class="playlist-block">
      <div class="playlist-head">
        <span>我创建的歌单</span>
        <button
          type="button"
          class="playlist-add"
          title="新建歌单"
          aria-label="新建歌单"
          @click.stop="$emit('create-playlist')"
        >
          <el-icon><Plus /></el-icon>
        </button>
      </div>

      <div class="playlist-scroll">
        <button
          v-for="p in state.playlists"
          :key="p.id"
          type="button"
          class="playlist-item"
          :class="{ 'is-active': state.view === 'playlist' && state.currentPlaylistId === p.id }"
          :title="`${p.name} · ${p.songCount} 首`"
          @click.stop="openPlaylist(p.id)"
        >
          <span class="playlist-icon"><el-icon><Headset /></el-icon></span>
          <span class="playlist-name">{{ p.name }}</span>
          <span class="playlist-count">{{ p.songCount }}</span>
        </button>

        <p v-if="!state.playlists.length && !state.playlistLoading" class="playlist-empty">
          还没有歌单，点右上角 + 创建一个
        </p>
      </div>
    </div>

    <footer class="sidebar-footer">
      <p>数据来源：B 站公开接口<br>仅供个人本地使用</p>
    </footer>
  </aside>
</template>
