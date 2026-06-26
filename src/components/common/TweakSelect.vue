<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: String, required: true },
  options: { type: Array, required: true },
});

defineEmits(["change"]);
</script>

<template>
  <div class="twk-row">
    <div class="twk-lbl">
      <span>{{ label }}</span>
    </div>
    <select class="twk-field" :value="value" @change="$emit('change', $event.target.value)">
      <option v-for="option in options" :key="option" :value="option">{{ option }}</option>
    </select>
  </div>
</template>
