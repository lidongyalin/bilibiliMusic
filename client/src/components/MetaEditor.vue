<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { state } from '../state.js'
import { submitMetaEditor, closeMetaEditor } from '../menu.js'
import { restoreMeta, saveMetaBatch } from '../library.js'

/**
 * 本地曲目标签编辑（F10）+ 批量标签编辑（F28）。
 *
 * 只写本地覆盖，不改动原文件的 ID3/FLAC/Vorbis 标签——
 * 好处是随时能一键恢复，坏标签也不怕。
 * 空值表示「这一项恢复成原标签」。
 *
 * 批量模式由 state.metaBatch 驱动：只露 艺术家/专辑/专辑歌手/流派/年份 五个字段，
 * 留空的字段不动——批量场景下没人会把选区里所有歌改成同一个标题。
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

// ---------- 批量编辑（F28） ----------

const batch = computed(() => state.metaBatch)
const batchForm = reactive({ artist: '', album: '', albumArtist: '', genre: '', year: '' })
const batchSaving = ref(false)

watch(batch, (v) => {
  if (!v) return
  batchForm.artist = ''
  batchForm.album = ''
  batchForm.albumArtist = ''
  batchForm.genre = ''
  batchForm.year = ''
})

function closeBatch() {
  state.metaBatch = null
}

/** 只把填了的字段交上去；全空等于什么都没改 */
async function onBatchSave() {
  if (batchSaving.value) return
  const ids = Array.isArray(batch.value?.ids) ? batch.value.ids : []
  const patch = {}
  for (const [k, v] of Object.entries(batchForm)) {
    if (String(v || '').trim()) patch[k] = String(v).trim()
  }
  if (!Object.keys(patch).length) {
    ElMessage.info('没有填写任何要修改的字段')
    return
  }
  batchSaving.value = true
  try {
    const ok = await saveMetaBatchByIds(ids, patch)
    if (ok) closeBatch()
  } finally {
    batchSaving.value = false
  }
}

/** ids 是纯本地 id 列表，包一层让 saveMetaBatch 复用它的提示与刷新逻辑 */
function saveMetaBatchByIds(ids, patch) {
  return saveMetaBatch(ids.map((id) => ({ bvid: `local-${id}` })), patch)
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

  <!-- 批量标签编辑（F28）：留空的字段不动 -->
  <el-dialog
    :model-value="Boolean(batch)"
    width="460px"
    :close-on-click-modal="false"
    class="meta-dialog"
    @close="closeBatch"
  >
    <template #header>
      <div class="meta-head">
        <span class="meta-cover meta-cover-empty">♪</span>
        <div class="meta-head-text">
          <h3>批量编辑标签</h3>
          <p>对选中的 {{ batch?.count ?? 0 }} 首生效，只写本地覆盖</p>
        </div>
      </div>
    </template>

    <div class="meta-body">
      <p class="meta-batch-hint">只填你想改的那几项，留空的字段保持每首歌自己的值。</p>
      <div class="meta-row">
        <div class="meta-field">
          <label>歌手</label>
          <el-input v-model="batchForm.artist" placeholder="不改" maxlength="200" clearable />
        </div>
        <div class="meta-field">
          <label>专辑</label>
          <el-input v-model="batchForm.album" placeholder="不改" maxlength="200" clearable />
        </div>
      </div>
      <div class="meta-row">
        <div class="meta-field">
          <label>专辑歌手</label>
          <el-input v-model="batchForm.albumArtist" placeholder="不改" maxlength="200" clearable />
        </div>
        <div class="meta-field">
          <label>流派</label>
          <el-input v-model="batchForm.genre" placeholder="不改" maxlength="200" clearable />
        </div>
      </div>
      <div class="meta-field">
        <label>年份</label>
        <el-input v-model="batchForm.year" placeholder="不改" maxlength="16" clearable />
      </div>
      <p class="meta-batch-warn">标题不能批量改——把选区里所有歌改成同一个标题没有意义。</p>
    </div>

    <template #footer>
      <span class="meta-foot-right">
        <button type="button" class="meta-cancel" @click="closeBatch">取消</button>
        <button type="button" class="meta-save" :disabled="batchSaving" @click="onBatchSave">
          {{ batchSaving ? '保存中…' : `更新 ${batch?.count ?? 0} 首` }}
        </button>
      </span>
    </template>
  </el-dialog>
</template>
