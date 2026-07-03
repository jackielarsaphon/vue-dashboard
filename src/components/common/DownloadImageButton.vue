<script setup>
// Toolbar button that triggers a full-page PNG export. Pairs with
// useDownloadImage — the parent owns the capture logic and passes `downloading`.
// Marked .no-capture so it doesn't appear in the exported image.
defineProps({
  downloading: { type: Boolean, default: false },
});
defineEmits(["click"]);
</script>

<template>
  <div class="dash-toolbar no-capture">
    <button class="dl-btn" type="button" :disabled="downloading" @click="$emit('click')">
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
        <path
          d="M12 3v11m0 0l-4-4m4 4l4-4M5 20h14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span>{{ downloading ? "Saving…" : "Download image" }}</span>
    </button>
  </div>
</template>
