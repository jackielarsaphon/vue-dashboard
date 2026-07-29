<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

// A 24-hour time field: shows HH:MM and opens a clock-dial pop-up to pick it,
// instead of the browser's native <input type="time"> picker (which follows the OS
// locale and shows AM/PM). Values are always 'HH:MM' 24-hour strings — the same
// shape the rainfall log stores — so nothing downstream has to parse a locale.
//
// Dial layout follows the familiar 24-hour clock: hours 0-11 on the outer ring
// (0 at the top), 12-23 on the inner ring; minutes every 5 on the outer ring.
// Clicking a number picks it; clicking the empty dial snaps to the nearest value,
// so an off-label minute like 10:37 is still reachable.
const props = defineProps({
  modelValue: { type: String, default: "" },
  disabled: { type: Boolean, default: false },
  placeholder: { type: String, default: "--:--" },
  title: { type: String, default: "" },
  // Heading shown at the top of the dialog (e.g. "Rain start").
  label: { type: String, default: "Select time" },
});
const emit = defineEmits(["change", "update:modelValue"]);

const DIAL = { size: 248, outer: 102, inner: 66, num: 34 };
const center = DIAL.size / 2;

const parse = (value) => {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  if (hour > 23) return null;
  return { hour, minute: Number(match[2]) };
};
const format = (hour, minute) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

const open = ref(false);
const mode = ref("hour"); // hour | minute
const hour = ref(0);
const minute = ref(0);
const dialEl = ref(null);
const triggerEl = ref(null);

// Lets a parent dialog put focus on this field (the trigger button) the way it
// would with a plain input.
defineExpose({ focus: () => triggerEl.value?.focus() });

const display = computed(() => {
  const parsed = parse(props.modelValue);
  return parsed ? format(parsed.hour, parsed.minute) : "";
});

const openPicker = () => {
  if (props.disabled) return;
  const parsed = parse(props.modelValue) ?? { hour: 0, minute: 0 };
  hour.value = parsed.hour;
  minute.value = parsed.minute;
  mode.value = "hour";
  open.value = true;
};
const cancel = () => {
  open.value = false;
};
const confirm = () => {
  open.value = false;
  const value = format(hour.value, minute.value);
  emit("update:modelValue", value);
  emit("change", value);
};

// Escape must close only the picker, not the dialog underneath it (the rainfall
// pop-up also listens on window), so swallow the event in the capture phase.
const onWindowKeydown = (event) => {
  if (!open.value || event.key !== "Escape") return;
  event.stopPropagation();
  cancel();
};
watch(open, (isOpen) => {
  if (typeof window === "undefined") return;
  if (isOpen) {
    window.addEventListener("keydown", onWindowKeydown, true);
    nextTick(() => dialEl.value?.focus?.());
  } else {
    window.removeEventListener("keydown", onWindowKeydown, true);
  }
});
onBeforeUnmount(() => {
  if (typeof window !== "undefined") window.removeEventListener("keydown", onWindowKeydown, true);
});

// --- dial geometry ----------------------------------------------------------
// 12 o'clock is straight up; every step is 30° clockwise.
const pointStyle = (index, radius) => {
  const angle = (index * 30 * Math.PI) / 180;
  return {
    left: `${center + radius * Math.sin(angle) - DIAL.num / 2}px`,
    top: `${center - radius * Math.cos(angle) - DIAL.num / 2}px`,
  };
};

const hourPoints = computed(() =>
  Array.from({ length: 24 }, (_, value) => ({
    value,
    label: String(value).padStart(2, "0"),
    inner: value >= 12,
    style: pointStyle(value % 12, value >= 12 ? DIAL.inner : DIAL.outer),
  })),
);
const minutePoints = computed(() =>
  Array.from({ length: 12 }, (_, step) => ({
    value: step * 5,
    label: String(step * 5).padStart(2, "0"),
    inner: false,
    style: pointStyle(step, DIAL.outer),
  })),
);
const points = computed(() => (mode.value === "hour" ? hourPoints.value : minutePoints.value));

// The hand points at the current value; on the hour ring it shortens for 12-23.
const handAngle = computed(() => (mode.value === "hour" ? (hour.value % 12) * 30 : minute.value * 6));
const handLength = computed(() => (mode.value === "hour" && hour.value >= 12 ? DIAL.inner : DIAL.outer));
const handStyle = computed(() => ({
  height: `${handLength.value}px`,
  transform: `translateX(-50%) rotate(${handAngle.value}deg)`,
}));
const isSelected = (point) => (mode.value === "hour" ? point.value === hour.value : point.value === minute.value);

const pickHour = (value) => {
  hour.value = value;
  mode.value = "minute";
};
const pickMinute = (value) => {
  minute.value = value;
};
const pick = (value) => (mode.value === "hour" ? pickHour(value) : pickMinute(value));


// Clicking the dial itself (not a number) snaps to whatever the angle points at:
// minutes to the exact minute, hours to the ring the click lands on.
const onDialClick = (event) => {
  const rect = dialEl.value?.getBoundingClientRect();
  if (!rect) return;
  const dx = event.clientX - rect.left - center;
  const dy = event.clientY - rect.top - center;
  const radius = Math.hypot(dx, dy);
  if (radius < 18) return; // dead zone around the pivot
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const clockwise = (degrees + 360) % 360;
  if (mode.value === "minute") {
    pickMinute(Math.round(clockwise / 6) % 60);
    return;
  }
  const step = Math.round(clockwise / 30) % 12;
  pickHour(radius < (DIAL.inner + DIAL.outer) / 2 ? step + 12 : step);
};
</script>

<template>
  <div class="tf-wrap">
    <button
      ref="triggerEl"
      class="tf-value mono"
      type="button"
      :disabled="disabled"
      :title="title"
      :class="{ empty: !display }"
      @click="openPicker"
    >
      {{ display || placeholder }}
    </button>

    <div v-if="open" class="tf-overlay" @mousedown.self="cancel">
      <div class="tf-dialog" role="dialog" aria-modal="true" :aria-label="label">
        <span class="tf-label">{{ label }}</span>

        <div class="tf-readout">
          <button class="tf-seg mono" type="button" :class="{ on: mode === 'hour' }" @click="mode = 'hour'">
            {{ String(hour).padStart(2, "0") }}
          </button>
          <span class="tf-colon">:</span>
          <button class="tf-seg mono" type="button" :class="{ on: mode === 'minute' }" @click="mode = 'minute'">
            {{ String(minute).padStart(2, "0") }}
          </button>
        </div>

        <div
          ref="dialEl"
          class="tf-dial"
          :style="{ width: `${DIAL.size}px`, height: `${DIAL.size}px` }"
          tabindex="-1"
          @click="onDialClick"
        >
          <span class="tf-hand" :style="handStyle" />
          <span class="tf-pivot" />
          <button
            v-for="point in points"
            :key="`${mode}-${point.value}`"
            class="tf-num mono"
            type="button"
            :class="{ on: isSelected(point), inner: point.inner }"
            :style="point.style"
            @click.stop="pick(point.value)"
          >
            {{ point.label }}
          </button>
        </div>

        <div class="tf-foot">
          <button class="btn" type="button" @click="cancel">Cancel</button>
          <button class="btn btn-primary" type="button" @click="confirm">OK</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tf-wrap { width: 100%; }
.tf-value {
  width: 100%;
  min-width: 74px;
  background: var(--panel-2);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 5px 6px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.tf-value:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.tf-value:focus-visible { outline: none; border-color: var(--accent); }
.tf-value.empty { color: var(--ink-3); }
.tf-value:disabled { opacity: 0.4; cursor: not-allowed; color: var(--ink-3); }

/* Above .modal-overlay (z-index 60) so it works on top of the rainfall pop-up. */
.tf-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 20px;
  background: color-mix(in srgb, var(--bg) 55%, rgba(0, 0, 0, 0.7));
  backdrop-filter: blur(3px);
}
.tf-dialog {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
  padding: 16px 18px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.tf-label {
  align-self: flex-start;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.tf-readout {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tf-seg {
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink-2);
  font-size: 34px;
  font-weight: 600;
  line-height: 1;
  padding: 8px 12px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.tf-seg.on {
  background: color-mix(in srgb, var(--accent) 18%, var(--panel-2));
  border-color: var(--accent);
  color: var(--accent);
}
.tf-colon {
  font-size: 30px;
  font-weight: 600;
  color: var(--ink-3);
}
.tf-dial {
  position: relative;
  border-radius: 50%;
  background: var(--panel-2);
  border: 1px solid var(--line-soft);
  cursor: pointer;
  outline: none;
}
.tf-num {
  position: absolute;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  display: grid;
  place-items: center;
}
.tf-num.inner { font-size: 11px; color: var(--ink-2); }
.tf-num:hover { background: color-mix(in srgb, var(--accent) 16%, transparent); }
.tf-num.on {
  background: var(--accent);
  color: #1a1206;
}
/* The hand grows upward from the pivot and rotates clockwise around it. */
.tf-hand {
  position: absolute;
  left: 50%;
  bottom: 50%;
  width: 2px;
  background: var(--accent);
  transform-origin: bottom center;
  pointer-events: none;
}
.tf-pivot {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  border-radius: 50%;
  background: var(--accent);
  pointer-events: none;
}
.tf-foot {
  align-self: flex-end;
  display: flex;
  gap: 8px;
}
</style>
