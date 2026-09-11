<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { state } from '../state.js'
import { submitMetaEditor, closeMetaEditor } from '../menu.js'
import { restoreMeta } from '../library.js'

/**
 * 本地曲目标签编辑（F10）。
 *
 * 只写本地覆盖，不改动原文件的 ID3/FLAC/Vorbis 标签——
 * 好处是随时能一键恢复，坏标签也不怕。
 * 空值表示「这一项恢复成原标签」。
 */

const editing = computed(() => state.metaEditor)

const form = reactive({
  title: '',
  artist: '',
  album: '',
  albumArtist: '',
  year: '',
  track: '',
  genre: '',
})

const saving = ref(false)
const original = ref({})

watch(editing, (v) => {
  if (!v) return
  const s = v.song || {}
  form.title = s.title || ''
  form.artist = s.author || ''
  form.album = s.album || ''
  form.albumArtist = s.albumArtist || ''
  form.year = s.year || ''
  form.track = s.track || ''
  form.genre = s.genre || ''
  original.value = { ...s }
}, { immediate: true })

const path = computed(() => editing.value?.song?.path || '')
const format = computed(() => editing.value?.song?.format || '')
const size = computed(() => editing.value?.song?.sizeText || '')
const bitrate = computed(() => editing.value?.song?.bitrate ? `${editing.value.song.bitrate} kbps` : '')
const duration = computed(() => editing.value?.song?.duration || '')

/** 组装要提交的 patch：和原值一样的字段不带，减少无意义写入 */
function buildPatch() {
  const o = original.value || {}
  const patch = {}
  const map = {
    title: form.title,
    artist: form.artist,
    album: form.album,
    albumArtist: form.albumArtist,
    year: form.year,
    track: form.track,
    genre: form.genre,
  }
  for (const [k, v] of Object.entries(map)) {
    if (String(v || '') !== String(o[k] || '')) patch[k] = v
  }
  return patch
}

async function onSave() {
  if (saving.value) return
  const patch = buildPatch()
  if (!Object.keys(patch).length) {
    ElMessage.info('没有改动')
    closeMetaEditor()
    return
  }
  saving.value = true
  try {
    await submitMetaEditor(editing.value.song, patch)
  } finally {
    saving.value = false
  }
}

/** 恢复全部原标签：直接清掉本地覆盖 */
async function onRestore() {
  if (saving.value) return
  const song = editing.value?.song
  if (!song) return
  saving.value = true
  try {
    await restoreMeta(song)
    closeMetaEditor()
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="Boolean(editing)"
    width="460px"
    :close-on-click-modal="false"
    class="meta-dialog"
    @close="closeMetaEditor"
  >
    <template #header>
      <div class="meta-head">
        <img v-if="editing?.song?.cover" :src="editing.song.cover" class="meta-cover" alt="">
        <span v-else class="meta-cover meta-cover-empty">♪</span>
        <div class="meta-head-text">
          <h3>编辑标签</h3>
          <p>保存为本地覆盖，不会改动音频文件</p>
        </div>
      </div>
    </template>

    <div v-if="editing" class="meta-body">
      <div class="meta-field">
        <label>标题</label>
        <el-input v-model="form.title" placeholder="歌曲标题" maxlength="200" clearable />
      </div>
      <div class="meta-row">
        <div class="meta-field">
          <label>歌手</label>
          <el-input v-model="form.artist" placeholder="演唱者" maxlength="200" clearable />
        </div>
        <div class="meta-field">
          <label>专辑</label>
          <el-input v-model="form.album" placeholder="专辑名" maxlength="200" clearable />
        </div>
      </div>
      <div class="meta-row">
        <div class="meta-field">
          <label>专辑歌手</label>
          <el-input v-model="form.albumArtist" placeholder="可选" maxlength="200" clearable />
        </div>
        <div class="meta-field">
          <label>流派</label>
          <el-input v-model="form.genre" placeholder="可选" maxlength="200" clearable />
        </div>
      </div>
      <div class="meta-row">
        <div class="meta-field">
          <label>年份</label>
          <el-input v-model="form.year" placeholder="2003" maxlength="16" clearable />
        </div>
        <div class="meta-field">
          <label>曲序</label>
          <el-input v-model="form.track" placeholder="3/12" maxlength="16" clearable />
        </div>
      </div>

      <dl class="meta-info">
        <div><dt>格式</dt><dd>{{ format.toUpperCase() }}</dd></div>
        <div><dt>时长</dt><dd>{{ duration }}</dd></div>
        <div><dt>大小</dt><dd>{{ size }}</dd></div>
        <div><dt>比特率</dt><dd>{{ bitrate }}</dd></div>
        <div class="meta-path"><dt>文件</dt><dd :title="path">{{ path }}</dd></div>
      </dl>
    </div>

    <template #footer>
      <button type="button" class="meta-restore" @click="onRestore">恢复原标签</button>
      <span class="meta-foot-right">
        <button type="button" class="meta-cancel" @click="closeMetaEditor">取消</button>
        <button type="button" class="meta-save" :disabled="saving" @click="onSave">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </span>
    </template>
  </el-dialog>
</template>
