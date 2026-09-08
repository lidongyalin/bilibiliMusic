<script setup>
defineProps({
  /** <svg> 内部的路径片段 */
  d: { type: String, required: true },
  size: { type: [Number, String], default: 18 },
  filled: { type: Boolean, default: false },
})
</script>

<template>
  <svg
    class="stroke-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    aria-hidden="true"
    :class="{ 'is-filled': filled }"
    v-html="d"
  ></svg>
</template>
