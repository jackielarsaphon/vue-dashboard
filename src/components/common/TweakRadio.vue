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
    <div class="twk-seg" role="radiogroup">
      <button
        v-for="option in options"
        :key="option"
        type="button"
        role="radio"
        :aria-checked="option === value"
        :class="{ on: option === value }"
        @click="$emit('change', option)"
      >
        {{ option }}
      </button>
    </div>
  </div>
</template>
