<script setup>
import { onBeforeUnmount, watch } from "vue";

// A small themed confirmation dialog — replaces the browser's native window.confirm
// so destructive actions get an on-brand prompt. Controlled via `open`; emits
// `confirm` / `cancel`. Set `danger` for a red confirm button (deletes etc.).
const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: "Are you sure?" },
  message: { type: String, default: "" },
  confirmLabel: { type: String, default: "Confirm" },
  cancelLabel: { type: String, default: "Cancel" },
  danger: { type: Boolean, default: false },
});
const emit = defineEmits(["confirm", "cancel"]);

// Escape cancels while the dialog is open; clean up the listener when it closes.
const onKey = (event) => {
  if (event.key === "Escape") emit("cancel");
};
watch(
  () => props.open,
  (isOpen) => {
    if (typeof window === "undefined") return;
    if (isOpen) window.addEventListener("keydown", onKey);
    else window.removeEventListener("keydown", onKey);
  },
);
onBeforeUnmount(() => {
  if (typeof window !== "undefined") window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div v-if="open" class="cd-overlay" @mousedown.self="emit('cancel')">
    <div class="cd-card" role="alertdialog" aria-modal="true" :aria-label="title">
      <div class="cd-head">
        <span class="cd-icon" :class="{ danger }" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path
              d="M12 3 L22 20 H2 Z M12 9 V14 M12 17 h.01"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <h2 class="cd-title">{{ title }}</h2>
      </div>

      <p v-if="message" class="cd-msg">{{ message }}</p>

      <div class="cd-actions">
        <button class="cd-btn cd-cancel" type="button" @click="emit('cancel')">{{ cancelLabel }}</button>
        <button
          ref="confirmBtn"
          class="cd-btn"
          :class="danger ? 'cd-danger' : 'cd-primary'"
          type="button"
          autofocus
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cd-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: color-mix(in srgb, var(--bg) 55%, rgba(0, 0, 0, 0.7));
  backdrop-filter: blur(3px);
  display: grid;
  place-items: center;
  padding: 24px;
  animation: cd-fade 0.12s ease-out;
}
.cd-card {
  width: min(420px, 92vw);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 20px 20px 16px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
  animation: cd-pop 0.14s ease-out;
}
.cd-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.cd-icon {
  flex: none;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, var(--panel));
}
.cd-icon.danger {
  color: var(--alert);
  background: color-mix(in srgb, var(--alert) 14%, var(--panel));
}
.cd-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: 0.01em;
}
.cd-msg {
  margin: 12px 0 0;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.5;
}
.cd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.cd-btn {
  border-radius: 7px;
  padding: 9px 16px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  border: 1px solid transparent;
}
.cd-cancel {
  background: var(--panel-2);
  border-color: var(--line);
  color: var(--ink-2);
}
.cd-cancel:hover {
  border-color: var(--ink-3);
  color: var(--ink);
}
.cd-primary {
  background: var(--accent);
  color: #1a1206;
}
.cd-primary:hover {
  background: var(--accent-2);
}
.cd-danger {
  background: var(--alert);
  color: #fff;
}
.cd-danger:hover {
  filter: brightness(0.93);
}
@keyframes cd-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes cd-pop {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
