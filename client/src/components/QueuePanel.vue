<script setup>
import { computed, ref } from 'vue'
import { Close, VideoPlay, Delete, Top, Bottom, Sort } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { state } from '../state.js'
import { playAt, togglePlay, removeFromQueue, clearQueue, moveInQueue, addToQueue, isLocalSong } from '../player.js'
import { closeMenu } from '../menu.js'
import { contextOfView } from '../playlists.js'
import { clip } from '../utils.js'

/**
 * 播放队列面板（F3）。
 *
 * 队列和「来源列表」已经解耦：右键「下一首播放 / 加入队列」进来的歌只存在于这里，
 * 不在任何一个歌单或搜索结果里。支持拖动排序、单曲移除、清空。
 */

const open = computed(() => state.queueOpen)
const queue = computed(() => state.queue)
const currentIndex = computed(() => state.queueIndex)

const isPlaying = computed(() => state.status === 'playing')

function close() {
  state.queueOpen = false
  closeMenu()
}

function play(i) {
  void playAt(i)
}

/** 点行：当前曲暂停/继续，其他曲切过去 */
function onRowClick(song, i) {
  if (state.current?.bvid === song.bvid) {
    togglePlay()
    return
  }
  play(i)
}

function onContext(e, song, index) {
  e.preventDefault()
  e.stopPropagation()
  closeMenu()
  // 队列菜单：播放 / 下一首播放 / 移除 / 排序
  state.contextMenu = {
    x: e.clientX,
    y: e.clientY,
    items: [
      { label: '播放这一首', icon: 'play', onClick: () => play(index) },
      { label: '移到顶部', icon: 'next', onClick: () => moveInQueue(index, 0) },
      { label: '移到底部', icon: 'next', onClick: () => moveInQueue(index, queue.value.length - 1) },
      { divider: true },
      {
        label: '从队列移除',
        icon: 'trash',
        danger: true,
        onClick: () => removeFromQueue(song.bvid),
      },
    ],
  }
}

// ---------- 拖动排序 ----------

const dragFrom = ref(-1)

function onDragStart(i) {
  dragFrom.value = i
}

function onDragOver(e, i) {
  e.preventDefault()
  if (dragFrom.value < 0 || dragFrom.value === i) return
  moveInQueue(dragFrom.value, i)
  dragFrom.value = i
}

function onDragEnd() {
  dragFrom.value = -1
}

function clearAll() {
  const n = queue.value.length
  if (!n) return
  const keep = state.current
  const ok = window.confirm(`清空播放队列？\n当前正在播放的「${clip(keep?.title || '…')}」会保留。`)
  if (ok) clearQueue()
}

/** 把当前来源列表追加进队列 */
function addCurrentList() {
  const list = contextOfView()
  const n = addToQueue(list)
  if (n) ElMessage.success(`已加入队列 ${n} 首`)
  else ElMessage.info('队列里都已有这些歌')
}

/** 队列总时长 */
const totalSec = computed(() => queue.value.reduce((n, s) => n + (Number(s.durationSec) || 0), 0))

const summary = computed(() => {
  if (!queue.value.length) return ''
  const m = Math.round(totalSec.value / 60)
  return `${queue.value.length} 首 · ${m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`}`
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="queue-mask" @click="close">
      <aside class="queue-panel" @click.stop>
        <header class="queue-head">
          <div class="queue-title">
            <h3>播放队列</h3>
            <span class="queue-summary">{{ summary }}</span>
          </div>
          <div class="queue-head-actions">
            <button type="button" class="qp-btn" title="把当前列表加入队列" @click="addCurrentList">
              <el-icon><Sort /></el-icon>
            </button>
            <button type="button" class="qp-btn" title="清空队列" @click="clearAll">
              <el-icon><Delete /></el-icon>
            </button>
            <button type="button" class="qp-btn qp-close" title="关闭" @click="close">
              <el-icon><Close /></el-icon>
            </button>
          </div>
        </header>

        <div class="queue-scroll">
          <p v-if="!queue.length" class="queue-empty">
            队列是空的。<br>点「播放全部」或右键「加入队列」往里加歌。
          </p>

          <div
            v-for="(song, i) in queue"
            :key="`${song.bvid}-${i}`"
            class="qrow"
            :class="{ 'is-current': i === currentIndex }"
            draggable="true"
            @dragstart="onDragStart(i)"
            @dragover="onDragOver($event, i)"
            @dragend="onDragEnd"
            @click="onRowClick(song, i)"
            @contextmenu="onContext($event, song, i)"
          >
            <span class="qrow-handle" :class="{ 'is-current': i === currentIndex }">
              <svg v-if="i === currentIndex" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 5v14M17 5v14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
              </svg>
              <span v-else>{{ i + 1 }}</span>
            </span>

            <img v-if="song.cover" :src="song.cover" class="qrow-cover" alt="">
            <span v-else class="qrow-cover qrow-cover-empty">♪</span>

            <div class="qrow-info">
              <div class="qrow-title">{{ song.title }}</div>
              <div class="qrow-author">
                {{ song.author }}
                <span v-if="isLocalSong(song)" class="qrow-local">本地</span>
              </div>
            </div>

            <span class="qrow-dur">{{ song.duration }}</span>
            <button type="button" class="qrow-x" title="从队列移除" @click.stop="removeFromQueue(song.bvid)">
              <el-icon><Close /></el-icon>
            </button>
          </div>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
