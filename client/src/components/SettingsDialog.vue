<script setup>
import { computed, onMounted, reactive, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api.js'
import { prefs } from '../prefs.js'
import { state } from '../state.js'
import { setTheme, setAccent, ACCENTS } from '../theme.js'
import { setSpeed, setGapless, SLEEP_OPTIONS, SPEED_OPTIONS, startSleepTimer } from '../player.js'
import { EQ_PRESET_NAMES, EQ_PRESETS } from '../audio-engine.js'
import { setEq } from '../player.js'

/**
 * 设置面板（F22 关闭行为 / F24 主题 / F8 快捷键一览 / F2 倍速 / F6 无缝 / F4 睡眠定时）。
 *
 * 界面相关的偏好走 localStorage（prefs），
 * 需要主进程读的（关闭窗口行为）走 /api/settings，两端看同一份。
 */

const open = computed(() => state.settingsOpen)

const form = reactive({
  closeBehavior: 'ask',
  confirmClose: true,
  miniWidth: 460,
  miniHeight: 280,
  desktopLyricsWidth: 640,
  desktopLyricsHeight: 260,
})

async function load() {
  try {
    const { settings } = await api.getSettings()
    for (const k of Object.keys(form)) {
      if (settings[k] !== undefined) form[k] = settings[k]
    }
  } catch { /* 后端不可用时用本地默认 */ }
}

/** 关闭窗口行为立刻生效（主进程关闭时读的就是这份） */
function onBehaviorChange() {
  void api.updateSettings({ closeBehavior: form.closeBehavior, confirmClose: form.confirmClose })
    .then(() => ElMessage.success('已更新关闭行为'))
    .catch((err) => ElMessage.error(err.message))
}

/** 窗口几何只在桌面端有实际窗口，浏览器里改了也不报错 */
function saveGeometry() {
  void api.updateSettings({
    miniWidth: form.miniWidth,
    miniHeight: form.miniHeight,
    desktopLyricsWidth: form.desktopLyricsWidth,
    desktopLyricsHeight: form.desktopLyricsHeight,
  }).catch(() => {})
}

function close() {
  state.settingsOpen = false
}

// ---------- 快捷参考 ----------

const SHORTCUTS = [
  ['Space', '播放 / 暂停'],
  ['← / →', '后退 / 前进 5 秒'],
  ['↑ / ↓', '调大 / 调小音量'],
  ['N', '下一首'],
  ['P', '上一首'],
  ['L', '切换播放模式'],
  ['G', '显示 / 隐藏歌词'],
  ['Q', '显示 / 隐藏播放队列'],
  ['E', '打开 / 关闭均衡器'],
  ['I', '沉浸式播放页'],
  ['Ctrl + ,', '打开设置'],
  ['Esc', '关闭弹窗 / 菜单'],
]

onMounted(() => { void load() })

watch(open, (v) => { if (v) void load() })

function sleepNow(min) {
  if (min === 0) {
    ElMessage.info('睡眠定时已取消')
    return
  }
  startSleepTimer(min)
  ElMessage.success(`${min} 分钟后自动停止播放`)
}
</script>

<template>
  <el-dialog
    :model-value="open"
    width="620px"
    :close-on-click-modal="false"
    class="settings-dialog"
    @close="close"
  >
    <template #header>
      <h3>设置</h3>
    </template>

    <div class="settings-body">
      <!-- 外观 -->
      <section class="st-group">
        <h4>外观</h4>
        <div class="st-row">
          <span class="st-label">主题</span>
          <el-radio-group :model-value="state.theme" @change="setTheme">
            <el-radio-button value="light">浅色</el-radio-button>
            <el-radio-button value="dark">深色</el-radio-button>
            <el-radio-button value="system">跟随系统</el-radio-button>
          </el-radio-group>
        </div>
        <div class="st-row">
          <span class="st-label">强调色</span>
          <div class="swatches">
            <button
              v-for="c in ACCENTS"
              :key="c.value"
              type="button"
              class="swatch"
              :class="{ 'is-active': state.accent === c.value }"
              :style="{ background: c.value }"
              :title="c.label"
              :aria-label="c.label"
              @click="setAccent(c.value)"
            />
          </div>
        </div>
      </section>

      <!-- 播放 -->
      <section class="st-group">
        <h4>播放</h4>
        <div class="st-row">
          <span class="st-label">默认倍速</span>
          <el-select :model-value="state.speed" @change="setSpeed" style="width: 120px">
            <el-option v-for="v in SPEED_OPTIONS" :key="v" :value="v" :label="v === 1 ? '原速' : v + '×'" />
          </el-select>
          <span class="st-hint">1× 是原速；本地文件和 B 站音频都生效</span>
        </div>
        <div class="st-row">
          <span class="st-label">无缝播放</span>
          <el-switch :model-value="state.gapless" @change="setGapless" />
          <span class="st-hint">提前预取下一首，减少切歌时的空档</span>
        </div>
        <div class="st-row">
          <span class="st-label">睡眠定时</span>
          <div class="sleep-row">
            <button
              v-for="m in SLEEP_OPTIONS"
              :key="m"
              type="button"
              class="sleep-btn"
              @click="sleepNow(m)"
            >
              {{ m >= 60 ? `${m / 60} 小时` : `${m} 分钟` }}
            </button>
          </div>
        </div>
        <div class="st-row">
          <span class="st-label">歌词</span>
          <el-switch :model-value="state.lyricOpen" @change="(v) => { state.lyricOpen = v; prefs.setLyricOpen(v) }" />
          <span class="st-hint">歌词只在内存里，不写文件</span>
        </div>
      </section>

      <!-- 音效 -->
      <section class="st-group">
        <h4>音效</h4>
        <div class="st-row">
          <span class="st-label">均衡器</span>
          <button type="button" class="st-link" @click="state.eqOpen = true">打开均衡器面板</button>
        </div>
        <div class="st-row">
          <span class="st-label">一键预设</span>
          <div class="sleep-row">
            <button
              v-for="(name, key) in EQ_PRESET_NAMES"
              :key="key"
              type="button"
              class="sleep-btn"
              @click="setEq(EQ_PRESETS[key])"
            >
              {{ name }}
            </button>
          </div>
        </div>
      </section>

      <!-- 关闭窗口 -->
      <section class="st-group">
        <h4>关闭窗口</h4>
        <div class="st-row">
          <span class="st-label">点关闭按钮时</span>
          <el-radio-group :model-value="form.closeBehavior" @change="onBehaviorChange">
            <el-radio value="ask">询问我</el-radio>
            <el-radio value="tray">收进托盘继续播放</el-radio>
            <el-radio value="quit">直接退出</el-radio>
          </el-radio-group>
        </div>
        <div class="st-row">
          <span class="st-label">每次都确认</span>
          <el-switch :model-value="form.confirmClose" @change="onBehaviorChange" />
          <span class="st-hint">仅在「询问我」时有效</span>
        </div>
      </section>

      <!-- 桌面窗口 -->
      <section class="st-group">
        <h4>桌面窗口（仅桌面版）</h4>
        <div class="st-grid">
          <label class="st-field">
            <span>迷你模式宽度</span>
            <el-input-number v-model="form.miniWidth" :min="320" :max="900" :step="10" @change="saveGeometry" />
          </label>
          <label class="st-field">
            <span>迷你模式高度</span>
            <el-input-number v-model="form.miniHeight" :min="220" :max="500" :step="10" @change="saveGeometry" />
          </label>
          <label class="st-field">
            <span>桌面歌词宽度</span>
            <el-input-number v-model="form.desktopLyricsWidth" :min="320" :max="1200" :step="10" @change="saveGeometry" />
          </label>
          <label class="st-field">
            <span>桌面歌词高度</span>
            <el-input-number v-model="form.desktopLyricsHeight" :min="180" :max="700" :step="10" @change="saveGeometry" />
          </label>
        </div>
      </section>

      <!-- 快捷键 -->
      <section class="st-group">
        <h4>快捷键</h4>
        <table class="shortcut-table">
          <tr v-for="[k, d] in SHORTCUTS" :key="k">
            <td><kbd>{{ k }}</kbd></td>
            <td>{{ d }}</td>
          </tr>
        </table>
      </section>
    </div>

    <template #footer>
      <button type="button" class="st-close" @click="close">完成</button>
    </template>
  </el-dialog>
</template>
