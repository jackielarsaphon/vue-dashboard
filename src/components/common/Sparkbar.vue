<script setup>
import { computed } from "vue";

const props = defineProps({
  value: { type: Number, required: true },
  max: { type: Number, required: true },
  height: { type: Number, default: 4 },
  color: { type: String, default: "var(--accent)" },
});

const width = computed(() => {
  if (props.max <= 0) return 0;
  return Math.min(100, Math.round((props.value / props.max) * 100));
});
</script>

<template>
  <div class="sparkbar" :style="{ height: `${height}px` }">
    <div :style="{ width: `${width}%`, background: color }" />
  </div>
</template>
