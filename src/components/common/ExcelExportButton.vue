<script setup>
// Toolbar button that exports the current date's production as an .xlsx pivot
// (area × Waste/Ore rows, truck model × Day/Night columns, trip counts). The
// parent owns the export logic (useExcelExport) and passes `busy`. Bare button —
// it's placed inside DownloadImageButton's toolbar slot so both share one row.
defineProps({
  busy: { type: Boolean, default: false },
});
defineEmits(["click"]);
</script>

<template>
  <button class="dl-btn dl-btn-secondary" type="button" :disabled="busy" @click="$emit('click')">
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M4 4h16v16H4zM4 9h16M4 14h16M9 4v16M15 4v16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    <span>{{ busy ? "Exporting…" : "Export Excel" }}</span>
  </button>
</template>
