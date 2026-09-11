<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { state } from '../state.js'
import { closeMenu, MENU_ICONS } from '../menu.js'
import Svg from './Svg.vue'

/**
 * 右键上下文菜单（F16 曲目 / F17 歌单与分组）。
 *
 * 由 state.contextMenu = { x, y, items } 驱动：谁右键谁负责把 items 填上，
 * 菜单本体只管渲染、定位、自己关掉。动作都在 item.onClick 里。
 *
 * 支持一层子菜单（hover 展开）：item.children 是数组就展开，用来放「加入歌单…」。
 *
 * 按「操作清单」的思路，同一份 items 将来在移动端可以渲染成 Action Sheet。
 */

const menu = computed(() => state.contextMenu)
const items = computed(() => menu.value?.items || [])
const subItems = computed(() => {
  const open = state.subMenu
  // open.index 是数字下标，不是数组——之前写成 Array.isArray 判断会让子菜单永远展不开
  if (!open || !Number.isInteger(open.index)) return []
  const parent = items.value[open.index]
  return Array.isArray(parent?.children) ? parent.children : []
})

const el = ref(null)
const subEl = ref(null)
const pos = ref({ x: 0, y: 0 })

/** 菜单要落在视口内：放不下就往左/往上挪 */
async function position() {
  const m = menu.value
  if (!m) return
  pos.value = { x: m.x, y: m.y }
  await nextTick()
  const box = el.value?.getBoundingClientRect()
  if (!box) return
  const gap = 8
  if (m.x + box.width > window.innerWidth - gap) {
    pos.value.x = Math.max(gap, window.innerWidth - box.width - gap)
  }
  if (m.y + box.height > window.innerHeight - gap) {
    pos.value.y = Math.max(gap, window.innerHeight - box.height - gap)
  }
}

function onItem(idx) {
  const it = items.value[idx]
  if (!it || it.divider || it.disabled) return
  if (Array.isArray(it.children)) {
    state.subMenu = { index: idx }
    return
  }
  state.subMenu = null
  closeMenu()
  it.onClick && it.onClick()
}

function onSubItem(child) {
  if (!child || child.divider || child.disabled) return
  state.subMenu = null
  closeMenu()
  child.onClick && child.onClick()
}

/** 子菜单定位：父项右侧展开，越界就翻到左边 */
async function positionSub() {
  await nextTick()
  const idx = state.subMenu?.index
  const rows = el.value?.querySelectorAll('[data-menu-index]')
  const row = Array.isArray(rows) ? rows[idx] : null
  const r = row?.getBoundingClientRect()
  const box = subEl.value?.getBoundingClientRect()
  if (!r || !box) return
  let x = r.right + 4
  if (x + box.width > window.innerWidth - 8) x = Math.max(8, r.left - box.width - 4)
  let y = r.top
  if (y + box.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - box.height - 8)
  state.subMenuPos = { x, y }
}

// 点空白处 / Esc 关闭
function onDocDown(e) {
  if (el.value && !el.value.contains(e.target)) closeMenu()
}
function onKey(e) {
  if (e.code === 'Escape') closeMenu()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocDown, true)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown, true)
  document.removeEventListener('keydown', onKey)
})

// 菜单重新打开时要重新定位；关掉时清掉子菜单
watch(() => state.contextMenu, (v) => {
  state.subMenu = null
  if (!v) return
  void position()
})

watch(subItems, (v) => {
  if (v.length) void positionSub()
})
</script>

<template>
  <div v-if="menu" class="ctx-root">
    <ul
      ref="el"
      class="ctx-menu"
      :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      @contextmenu.prevent
    >
      <li
        v-for="(it, i) in items"
        :key="i"
        :data-menu-index="i"
        class="ctx-item"
        :class="{
          divider: it.divider,
          'has-child': Array.isArray(it.children),
          danger: it.danger,
          disabled: it.disabled,
        }"
        @mouseenter="Array.isArray(it.children) && !it.disabled ? (state.subMenu = { index: i }) : (state.subMenu = null)"
        @click="onItem(i)"
      >
        <template v-if="it.divider"><i class="ctx-divider"></i></template>
        <template v-else>
          <span class="ctx-icon">
            <Svg v-if="it.icon" :d="MENU_ICONS[it.icon] || ''" :size="16" />
          </span>
          <span class="ctx-label">{{ it.label }}</span>
          <span v-if="Array.isArray(it.children)" class="ctx-arrow">›</span>
        </template>
      </li>
    </ul>

    <ul
      v-if="subItems.length"
      ref="subEl"
      class="ctx-menu ctx-sub"
      :style="{ left: (state.subMenuPos?.x ?? 0) + 'px', top: (state.subMenuPos?.y ?? 0) + 'px' }"
      @contextmenu.prevent
    >
      <li
        v-for="(c, i) in subItems"
        :key="i"
        class="ctx-item"
        :class="{ divider: c.divider, danger: c.danger, disabled: c.disabled }"
        @click="onSubItem(c)"
      >
        <template v-if="c.divider"><i class="ctx-divider"></i></template>
        <template v-else>
          <span class="ctx-icon">
            <Svg v-if="c.icon" :d="MENU_ICONS[c.icon] || ''" :size="16" />
          </span>
          <span class="ctx-label">{{ c.label }}</span>
          <span v-if="c.count != null" class="ctx-count">{{ c.count }}</span>
        </template>
      </li>
    </ul>
  </div>
</template>
