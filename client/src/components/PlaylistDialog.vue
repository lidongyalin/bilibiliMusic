<script setup>
import { computed, ref, watch } from 'vue'

/**
 * 新建 / 重命名歌单的弹窗。同一个组件两种模式：
 * mode='create' 时是新建，'rename' 时带初始值并把标题改成「重命名」。
 *
 * 名字为空时不拦提交：后端会回落到默认名「我喜欢的音乐」，
 * 撞名再加数字后缀，比前端弹报错更符合直觉。
 */
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  mode: { type: String, default: 'create' }, // create | rename
  initialName: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const name = ref('')

const title = computed(() => (props.mode === 'rename' ? '重命名歌单' : '新建歌单'))

watch(
  () => props.modelValue,
  (open) => {
    if (open) name.value = props.initialName || ''
  }
)

function close() {
  emit('update:modelValue', false)
}

function submit() {
  emit('confirm', name.value)
}

function onEnter(e) {
  if (e.key === 'Enter') submit()
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="380px"
    align-center
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
    @close="close"
  >
    <el-input
      v-model="name"
      class="playlist-name-input"
      :placeholder="mode === 'rename' ? '输入新名字' : '给歌单起个名字（留空用默认名）'"
      maxlength="40"
      show-word-limit
      clearable
      autofocus
      @keyup.enter="onEnter"
    />

    <p class="playlist-name-hint">最多 40 个字，撞名会自动加数字后缀</p>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" @click="submit">
        {{ mode === 'rename' ? '保存' : '创建' }}
      </el-button>
    </template>
  </el-dialog>
</template>
