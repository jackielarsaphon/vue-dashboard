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
    <div class="twk-chips" role="radiogroup">
      <button
        v-for="option in options"
        :key="option"
        type="button"
        class="twk-chip"
        :class="{ on: option === value }"
        :style="{ background: option }"
        :aria-checked="option === value"
        :title="option"
        role="radio"
        @click="$emit('change', option)"
      />
    </div>
  </div>
</template>
