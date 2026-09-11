<script setup>
import { computed } from 'vue'
import { Close, RefreshLeft } from '@element-plus/icons-vue'
import { state } from '../state.js'
import { setEq, setGain, setBalanceValue, resetAudioFx } from '../player.js'
import {
  EQ_LABELS, EQ_RANGE, GAIN_RANGE, EQ_PRESETS, EQ_PRESET_NAMES,
  isSupported,
} from '../audio-engine.js'

/**
 * 均衡器 + 总增益 + 声道平衡（F5 / F26）。
 *
 * 九段竖滑杆，值和 audio-engine.js 里的 EQ_BANDS 一一对应。
 * 环境不支持 Web Audio 时（老的浏览器内核）显示一行提示，不隐藏整个面板。
 */

const open = computed(() => state.eqOpen)
const eq = computed(() => state.eq)
const gain = computed(() => state.masterGain)
const balance = computed(() => state.balance)
// 只看环境支持，不看 isReady()：没播放过任何歌时 audio 元素还没创建，
// isReady() 是 false，但调 EQ 完全有效——值会存进 prefs，第一次出声时补上
const supported = computed(() => isSupported())

function close() {
  state.eqOpen = false
}

/** 竖滑杆：滑块的 top 由 dB 值映射到 0..100% */
function pctOf(i) {
  const v = Number(eq.value[i]) || 0
  const { min, max } = EQ_RANGE
  return ((v - min) / (max - min)) * 100
}

function applyAt(i, clientY, trackEl) {
  const rect = trackEl.getBoundingClientRect()
  const ratio = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
  const { min, max } = EQ_RANGE
  const next = eq.value.slice()
  next[i] = Math.round((min + ratio * (max - min)) * 10) / 10
  setEq(next)
}

function onSliderDown(e, i) {
  e.preventDefault()
  const track = e.currentTarget
  const move = (ev) => applyAt(i, ev.clientY, track)
  const up = () => {
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = 'ns-resize'
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', up)
  applyAt(i, e.clientY, track)
}

function onWheel(e, i) {
  e.preventDefault()
  const dir = e.deltaY < 0 ? 1 : -1
  const next = eq.value.slice()
  next[i] = Math.max(EQ_RANGE.min, Math.min(EQ_RANGE.max, (Number(next[i]) || 0) + dir))
  setEq(next)
}

function fmt(v) {
  const n = Number(v) || 0
  if (n === 0) return '0'
  return `${n > 0 ? '+' : ''}${n}`
}

/** 当前值最接近的预设名，用来给「平直 / 流行…」按钮一个选中态 */
const activePreset = computed(() => {
  let best = 'flat'
  let bestScore = Infinity
  for (const [name, bands] of Object.entries(EQ_PRESETS)) {
    const score = bands.reduce((s, v, i) => s + Math.abs((Number(eq.value[i]) || 0) - v), 0)
    if (score < bestScore) { bestScore = score; best = name }
  }
  return bestScore <= 1.5 ? best : ''
})

function applyPreset(name) {
  if (EQ_PRESETS[name]) setEq(EQ_PRESETS[name])
}

function balanceLabel(v) {
  const n = Number(v) || 0
  if (n === 0) return '居中'
  return n < 0 ? `左 ${Math.round(-n * 100)}%` : `右 ${Math.round(n * 100)}%`
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="eq-mask" @click="close">
      <section class="eq-panel" @click.stop>
        <header class="eq-head">
          <h3>音效</h3>
          <button type="button" class="eq-x" title="关闭" @click="close">
            <el-icon><Close /></el-icon>
          </button>
        </header>

        <p v-if="!supported" class="eq-unsupported">
          当前环境不支持 Web Audio，均衡器和增益不可用（音量与声道平衡仍然有效）。
        </p>

        <!-- 预设 -->
        <div class="eq-presets">
          <button
            v-for="(name, key) in EQ_PRESET_NAMES"
            :key="key"
            type="button"
            class="eq-preset"
            :class="{ 'is-active': activePreset === key }"
            @click="applyPreset(key)"
          >
            {{ name }}
          </button>
        </div>

        <!-- 九段竖滑杆 -->
        <div class="eq-bands">
          <div v-for="(label, i) in EQ_LABELS" :key="i" class="eq-band">
            <div
              class="eq-track"
              :class="{ 'is-disabled': !supported }"
              @mousedown="onSliderDown($event, i)"
              @wheel="onWheel($event, i)"
              @click.stop
            >
              <span class="eq-fill" :style="{ height: pctOf(i) + '%' }"></span>
              <span class="eq-zero"></span>
              <span class="eq-thumb" :style="{ bottom: pctOf(i) + '%' }"></span>
            </div>
            <span class="eq-val">{{ fmt(eq[i]) }}</span>
            <span class="eq-freq">{{ label }}</span>
          </div>
        </div>

        <!-- 总增益 -->
        <div class="eq-row">
          <label class="eq-label">增益</label>
          <el-slider
            :model-value="gain"
            :min="GAIN_RANGE.min"
            :max="GAIN_RANGE.max"
            :step="0.5"
            :format-tooltip="fmt"
            @input="setGain"
          />
          <span class="eq-num">{{ fmt(gain) }} dB</span>
        </div>

        <!-- 声道平衡 -->
        <div class="eq-row">
          <label class="eq-label">声道</label>
          <el-slider
            :model-value="balance"
            :min="-1"
            :max="1"
            :step="0.05"
            @input="setBalanceValue"
          />
          <span class="eq-num">{{ balanceLabel(balance) }}</span>
        </div>

        <footer class="eq-foot">
          <button type="button" class="eq-reset" @click="resetAudioFx">
            <el-icon><RefreshLeft /></el-icon>
            <span>恢复默认</span>
          </button>
          <span class="eq-hint">增益 &gt; 0 可能引起失真</span>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
