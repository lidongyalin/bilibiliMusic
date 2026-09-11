<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Close, VideoPlay, VideoPause, ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { state } from '../state.js'
import { togglePlay, prev, next, seekTo, cycleMode } from '../player.js'
import { MODE_ICONS, MODE_LABELS } from '../icons.js'
import { getAnalyser, isReady } from '../audio-engine.js'
import { formatTime } from '../utils.js'
import Svg from './Svg.vue'

/**
 * 沉浸式播放页（F25）。
 *
 * 背景是当前曲目的封面拉大模糊，前景是封面 + 音频频谱 + 控制条。
 * 频谱用 audio-engine.js 里挂的 AnalyserNode；Web Audio 不可用时只显示封面。
 */

const open = computed(() => state.immersive)
const song = computed(() => state.current)
const playing = computed(() => state.status === 'playing')

const canvas = ref(null)
let raf = 0
let analyser = null
let bins = null

function close() {
  state.immersive = false
}

function ensureAnalyser() {
  if (analyser) return analyser
  if (!isReady()) return null
  analyser = getAnalyser()
  if (!analyser) return null
  bins = new Uint8Array(analyser.frequencyBinCount)
  return analyser
}

function draw() {
  raf = requestAnimationFrame(draw)
  const el = canvas.value
  const a = ensureAnalyser()
  if (!el || !a) return
  a.getByteFrequencyData(bins)

  const dpr = window.devicePixelRatio || 1
  const w = el.clientWidth
  const h = el.clientHeight
  if (el.width !== w * dpr || el.height !== h * dpr) {
    el.width = w * dpr
    el.height = h * dpr
  }
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  // 只显示前 48 根，高频段对视觉没贡献还浪费绘制
  const n = 48
  const step = Math.max(1, Math.floor(bins.length / n))
  const barW = w / n
  const gap = barW * 0.24
  for (let i = 0; i < n; i += 1) {
    const v = (bins[i * step] || 0) / 255
    const bh = Math.max(2, v * h * 0.92)
    const x = i * barW + gap / 2
    const y = h - bh
    const grad = ctx.createLinearGradient(0, h, 0, y)
    grad.addColorStop(0, 'rgba(255,255,255,0.95)')
    grad.addColorStop(1, 'rgba(255,255,255,0.25)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.roundRect ? ctx.roundRect(x, y, barW - gap, bh, 2) : ctx.rect(x, y, barW - gap, bh)
    ctx.fill()
  }
}

/**
 * 只压掉沉浸层内部的右键菜单——挂在 document 上无条件 preventDefault
 * 会把整站（包括列表右键菜单）都弄坏。
 */
function onBackground(e) {
  if (!e.target.closest('.immersive')) return
  e.preventDefault()
}

function toggle() {
  togglePlay()
}

/** 打开时启动绘制循环，关掉时停掉——不留常驻 rAF */
function startLoop() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(draw)
}
function stopLoop() {
  cancelAnimationFrame(raf)
  raf = 0
}

watch(open, (v) => (v ? startLoop() : stopLoop()))

onMounted(() => {
  document.addEventListener('contextmenu', onBackground, true)
  if (open.value) startLoop()
})
onBeforeUnmount(() => {
  stopLoop()
  document.removeEventListener('contextmenu', onBackground, true)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="immersive">
      <!-- 背景：封面拉满 + 模糊 + 压暗 -->
      <div class="imm-bg">
        <img v-if="song?.cover" :src="song.cover" alt="" class="imm-bg-img" />
        <div v-else class="imm-bg-plain"></div>
        <div class="imm-bg-veil"></div>
      </div>

      <button type="button" class="imm-exit" title="退出沉浸模式（Esc）" @click="close">
        <el-icon><Close /></el-icon>
      </button>

      <div class="imm-main">
        <div class="imm-cover-wrap">
          <img v-if="song?.cover" :src="song.cover" class="imm-cover" alt="" />
          <span v-else class="imm-cover imm-cover-empty" aria-hidden="true">♪</span>
        </div>

        <div class="imm-meta">
          <h2 class="imm-title">{{ song?.title || '未在播放' }}</h2>
          <p v-if="song" class="imm-author">{{ song.author }}</p>
          <p v-if="song?.album" class="imm-album">{{ song.album }}</p>
        </div>

        <!-- 频谱 -->
        <canvas ref="canvas" class="imm-spectrum" aria-hidden="true"></canvas>

        <!-- 控制条 -->
        <div class="imm-controls">
          <button type="button" class="imm-btn" title="切换播放模式" @click="cycleMode">
            <Svg :d="MODE_ICONS[state.mode]" :size="19" />
            <span class="imm-mode">{{ MODE_LABELS[state.mode] }}</span>
          </button>
          <button type="button" class="imm-btn" title="上一首" @click="prev">
            <el-icon><ArrowLeft /></el-icon>
          </button>
          <button type="button" class="imm-btn imm-btn-main" :title="playing ? '暂停' : '播放'" @click="toggle">
            <el-icon :size="26"><VideoPause v-if="playing" /><VideoPlay v-else /></el-icon>
          </button>
          <button type="button" class="imm-btn" title="下一首" @click="next">
            <el-icon><ArrowRight /></el-icon>
          </button>
        </div>

        <!-- 进度 -->
        <div class="imm-progress">
          <span class="imm-time">{{ formatTime(state.progress) }}</span>
          <el-slider
            :model-value="state.duration ? (state.progress / state.duration) * 100 : 0"
            :max="100"
            :show-tooltip="false"
            :disabled="!state.duration"
            @input="(v) => seekTo((v / 100) * state.duration)"
          />
          <span class="imm-time">{{ formatTime(state.duration) }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
