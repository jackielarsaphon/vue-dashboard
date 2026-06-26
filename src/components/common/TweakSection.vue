<script setup>
defineProps({
  label: { type: String, required: true },
});
</script>

<template>
  <div class="twk-sect">{{ label }}</div>
  <slot />
</template>
