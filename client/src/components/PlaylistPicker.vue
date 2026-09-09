<script setup>
import { Plus } from '@element-plus/icons-vue'
import { state } from '../state.js'

/**
 * 「加入歌单」下拉。选中某个歌单就把它的 id 抛给父组件，由父组件决定是否
 * 提交、提交后要不要清掉多选状态——加歌本身的副作用不应该由下拉菜单扛。
 * 「新建歌单…」单独一个事件，父组件弹创建对话框，建完再把歌塞进去。
 *
 * 曲目要带完整字段（标题/封面/时长），歌单存的是快照，光有 bvid 会存成空壳。
 * 触发按钮的文案由父组件通过 #default slot 给（单首 / 多首不一样）。
 */
defineProps({
  songs: { type: Array, required: true },
})

const emit = defineEmits(['command', 'create-then-add'])

function onCommand(id) {
  if (id === '__new__') {
    emit('create-then-add')
    return
  }
  emit('command', id)
}
</script>

<template>
  <el-dropdown trigger="click" :teleported="true" @command="onCommand">
    <span class="pick-trigger">
      <slot>
        <span>加入歌单</span>
      </slot>
    </span>
    <template #dropdown>
      <el-dropdown-menu>
        <template v-if="songs.length > 1">
          <div class="pick-note">已选 {{ songs.length }} 首</div>
          <el-dropdown-item divided disabled>加入以下歌单</el-dropdown-item>
        </template>
        <el-dropdown-item v-for="p in state.playlists" :key="p.id" :command="p.id">
          {{ p.name }}
          <span class="pick-count">{{ p.songCount }}</span>
        </el-dropdown-item>
        <el-dropdown-item v-if="!state.playlists.length" disabled>
          还没有歌单
        </el-dropdown-item>
        <el-dropdown-item divided command="__new__">
          <el-icon><Plus /></el-icon>
          新建歌单…
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>
