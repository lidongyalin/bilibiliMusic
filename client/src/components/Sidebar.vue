<script setup>
import { Search, Collection } from '@element-plus/icons-vue'
import SearchBox from './SearchBox.vue'
import { state } from '../state.js'
import { switchView } from '../navigation.js'
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
      <p class="brand-sub">搜索 · 播放 · 收藏</p>
    </header>

    <SearchBox />

    <el-menu :default-active="state.view" @select="switchView">
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

    <footer class="sidebar-footer">
      <p>数据来源：B 站公开接口<br>仅供个人本地使用</p>
    </footer>
  </aside>
</template>
