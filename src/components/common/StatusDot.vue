<script setup>
defineProps({
  status: { type: String, default: "ok" },
});
</script>

<template>
  <span class="dot" :class="`dot-${status}`" />
</template>
