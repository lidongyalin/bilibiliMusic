<script setup>
import { computed, ref, watch } from 'vue'
import { state } from '../state.js'

/**
 * 应用内「关闭窗口」确认框。
 *
 * 之前用原生 dialog.showMessageBox：深色应用里弹一块纯白的系统窗，
 * 主题色管不到它，也没有「记住我的选择」。改成画在主窗页面里的弹窗后：
 *   - 配色走同一套 CSS 变量，深浅主题、强调色都自动跟随；
 *   - 勾上「记住我的选择」，主进程会把选择写进设置（closeBehavior），
 *     下次点关闭直接执行，不再询问。想改回「每次都问」去设置面板选「询问我」。
 *
 * 打开与答复的通道见 electron/preload.cjs 的 onAskClose / respondClose。
 */
const open = computed(() => Boolean(state.closeAsk))
const canTray = computed(() => Boolean(state.closeAsk && state.closeAsk.canTray))
const remember = ref(false)

// 每次打开都重置：上一次勾的「记住」不该悄悄带到这一次
let answered = false
watch(open, (v) => {
  if (v) {
    remember.value = false
    answered = false
  }
})

function respond(action) {
  answered = true
  window.desktop?.respondClose({ action, remember: remember.value })
  state.closeAsk = null
}

function onDialogClose() {
  // × / Esc：既不收托盘也不退出，窗口保持原样。必须答复，
  // 否则主进程等到超时会再弹一次原生兜底框
  if (!answered) {
    answered = true
    window.desktop?.respondClose({ action: 'dismiss' })
  }
}
</script>

<template>
  <el-dialog
    :model-value="open"
    width="440px"
    align-center
    class="close-ask-dialog"
    :close-on-click-modal="false"
    @close="onDialogClose"
  >
    <div class="cd-body">
      <h3 class="cd-title">关闭窗口</h3>
      <p class="cd-message">退出程序，还是最小化到系统托盘继续播放？</p>
      <p class="cd-detail">
        最小化到托盘后应用仍在后台运行，点托盘图标可以唤回窗口，正在播放的歌曲不会中断。
      </p>
      <p v-if="!canTray" class="cd-warn">系统托盘不可用，关闭窗口将直接退出。</p>
      <el-checkbox v-model="remember">记住我的选择，以后不再询问（可在设置里改回）</el-checkbox>
    </div>

    <template #footer>
      <div class="cd-actions">
        <button
          type="button"
          class="cd-btn"
          :disabled="!canTray"
          @click="respond('tray')"
        >
          最小化到托盘
        </button>
        <button type="button" class="cd-btn cd-danger" @click="respond('quit')">
          退出程序
        </button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.cd-title { margin: 0 0 10px; font-size: 15px; font-weight: 600; color: var(--text); }
.cd-message { margin: 0 0 6px; font-size: 14px; font-weight: 600; color: var(--text); }
.cd-detail { margin: 0 0 14px; font-size: 12.5px; line-height: 1.7; color: var(--text-dim); }
.cd-warn { margin: -6px 0 10px; font-size: 12.5px; color: var(--accent); }
.cd-actions { display: flex; gap: 10px; justify-content: flex-end; }
.cd-btn {
  height: 34px;
  padding: 0 18px;
  border-radius: 9px;
  font-size: 13px;
  color: var(--text);
  border: 1px solid var(--line);
  background: var(--bg-elev-2);
}
.cd-btn:hover { background: var(--bg-hover); }
.cd-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.cd-danger {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  background: transparent;
}
.cd-danger:hover { background: var(--accent-soft); }
</style>
