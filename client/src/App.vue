<script setup>
import { onMounted } from 'vue'
import Sidebar from './components/Sidebar.vue'
import SongList from './components/SongList.vue'
import PlayerBar from './components/PlayerBar.vue'
import { refreshFavorites } from './favorites.js'
import { bindKeyboard } from './keyboard.js'

onMounted(() => {
  bindKeyboard()
  void refreshFavorites()
})
</script>

<template>
  <div class="app-shell">
    <Sidebar />
    <main class="main-area">
      <SongList />
    </main>
    <PlayerBar />
  </div>
</template>
