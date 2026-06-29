<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";

// A searchable single-select (combobox) styled to match the trip-grid `.gt-sel`
// dropdowns. Shows the current value in a text field; focusing opens the full
// list, typing filters it. Emits `change` (and `update:modelValue`) with the
// picked option — drop-in for the native <select :value @change> the grid used.
const props = defineProps({
  modelValue: { type: [String, Number], default: "" },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: "" },
  emptyText: { type: String, default: "No matches" },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(["change", "update:modelValue"]);

const open = ref(false);
const typed = ref(false);
const query = ref(String(props.modelValue ?? ""));
const inputEl = ref(null);
const menuStyle = ref({});
let closeTimer = 0;

// The list is position:fixed and anchored to the input's on-screen box, so it
// floats above the page and is never clipped by a scrolling ancestor (the
// trip modal and the excavator row both live inside overflow:auto containers).
const positionMenu = () => {
  const el = inputEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  menuStyle.value = { top: `${rect.bottom + 4}px`, left: `${rect.left}px`, width: `${rect.width}px` };
};
const reposition = () => {
  if (open.value) positionMenu();
};

// Keep the floating list glued to the input while open (page/container scroll,
// window resize) and drop the listeners when it closes.
watch(open, (isOpen) => {
  if (typeof window === "undefined") return;
  if (isOpen) {
    positionMenu();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
  } else {
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
  }
});
onBeforeUnmount(() => {
  if (typeof window === "undefined") return;
  window.removeEventListener("scroll", reposition, true);
  window.removeEventListener("resize", reposition);
});

// Mirror external changes into the field while the menu is closed, but never
// clobber what the user is mid-typing.
watch(
  () => props.modelValue,
  (value) => {
    if (!open.value) query.value = String(value ?? "");
  },
);

// Before the user types, show every option; once they type, filter by substring.
const filtered = computed(() => {
  const q = query.value.trim().toUpperCase();
  if (!typed.value || !q) return props.options;
  return props.options.filter((option) => String(option).toUpperCase().includes(q));
});

const openMenu = (event) => {
  if (props.disabled) return;
  // Always surface the current value when focusing (and select it so typing
  // replaces it), so the field never looks empty over a real selection.
  query.value = String(props.modelValue ?? "");
  typed.value = false;
  open.value = true;
  positionMenu();
  event?.target?.select?.();
};

const onInput = (event) => {
  query.value = event.target.value;
  typed.value = true;
  open.value = true;
};

const pick = (option) => {
  window.clearTimeout(closeTimer);
  query.value = String(option);
  typed.value = false;
  open.value = false;
  if (option !== props.modelValue) {
    emit("update:modelValue", option);
    emit("change", option);
  }
  inputEl.value?.blur();
};

// Commit the typed text on Enter: prefer an exact match, else the first filtered.
const onEnter = () => {
  const exact = props.options.find((option) => String(option).toUpperCase() === query.value.trim().toUpperCase());
  const choice = exact ?? filtered.value[0];
  if (choice != null) pick(choice);
};

const onBlur = () => {
  closeTimer = window.setTimeout(() => {
    open.value = false;
    typed.value = false;
    // Drop any half-typed text that wasn't committed.
    query.value = String(props.modelValue ?? "");
  }, 120);
};
</script>

<template>
  <div class="ss-wrap">
    <input
      ref="inputEl"
      class="ss-input"
      type="text"
      autocomplete="off"
      :placeholder="placeholder"
      :value="query"
      :disabled="disabled"
      @focus="openMenu"
      @input="onInput"
      @blur="onBlur"
      @keydown.enter.prevent="onEnter"
      @keydown.esc="open = false"
    />
    <span v-if="!disabled" class="ss-caret" aria-hidden="true">▾</span>
    <div v-if="open" class="ss-list" :style="menuStyle">
      <button
        v-for="option in filtered"
        :key="option"
        type="button"
        class="ss-option"
        :class="{ on: String(option) === String(modelValue) }"
        @mousedown.prevent="pick(option)"
      >
        {{ option }}
      </button>
      <span v-if="filtered.length === 0" class="ss-empty">{{ emptyText }}</span>
    </div>
  </div>
</template>

<style scoped>
.ss-wrap {
  position: relative;
  width: 100%;
}
.ss-input {
  width: 100%;
  background: var(--panel-2);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 5px 20px 5px 7px;
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
}
.ss-input:focus {
  outline: none;
  border-color: var(--accent);
  cursor: text;
}
.ss-input:disabled {
  opacity: 0.7;
  cursor: not-allowed;
  -webkit-text-fill-color: var(--ink);
}
.ss-caret {
  position: absolute;
  right: 7px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 9px;
  color: var(--ink-3);
  pointer-events: none;
}
.ss-list {
  position: fixed;
  z-index: 1000;
  max-height: 240px;
  overflow-y: auto;
  /* Solid panel background + explicit ink colour so the options always read with
     full contrast (white-on-dark or dark-on-white) regardless of theme, instead
     of the lower-contrast cream pairing. */
  background: var(--panel);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  padding: 4px;
}
.ss-option {
  background: none;
  border: 0;
  text-align: left;
  padding: 7px 9px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* The list is a flex column; without this, a long option list overflows the
     max-height and flexbox squashes each row (clipping the text to a sliver)
     instead of scrolling. Keep every row at its natural height and let the list
     scroll. */
  flex-shrink: 0;
}
.ss-option:hover,
.ss-option:focus {
  background: var(--chip, rgba(0, 0, 0, 0.06));
}
.ss-option.on {
  color: var(--accent);
}
.ss-empty {
  padding: 7px 9px;
  font-size: 11px;
  color: var(--ink-3);
}

/* On phones use a 16px field (stops iOS zooming in on focus) and a roomier
   tap target. */
@media (max-width: 640px) {
  .ss-input {
    font-size: 16px;
    padding: 9px 24px 9px 9px;
  }
  .ss-option {
    padding: 10px 10px;
    font-size: 15px;
  }
}
</style>
