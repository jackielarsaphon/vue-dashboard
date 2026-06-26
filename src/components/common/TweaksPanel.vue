<script setup>
import { onMounted, onUnmounted, ref } from "vue";

defineProps({
  title: { type: String, default: "Tweaks" },
});

const open = ref(false);
const panel = ref(null);
const offset = ref({ x: 16, y: 16 });

const onMessage = (event) => {
  const type = event?.data?.type;
  if (type === "__activate_edit_mode") open.value = true;
  if (type === "__deactivate_edit_mode") open.value = false;
};

const dismiss = () => {
  open.value = false;
  window.parent?.postMessage({ type: "__edit_mode_dismissed" }, "*");
};

const clamp = () => {
  if (!panel.value) return;
  const maxRight = Math.max(16, window.innerWidth - panel.value.offsetWidth - 16);
  const maxBottom = Math.max(16, window.innerHeight - panel.value.offsetHeight - 16);
  offset.value = {
    x: Math.min(maxRight, Math.max(16, offset.value.x)),
    y: Math.min(maxBottom, Math.max(16, offset.value.y)),
  };
};

const dragStart = (event) => {
  if (!panel.value) return;
  const rect = panel.value.getBoundingClientRect();
  const start = {
    x: event.clientX,
    y: event.clientY,
    right: window.innerWidth - rect.right,
    bottom: window.innerHeight - rect.bottom,
  };

  const move = (moveEvent) => {
    offset.value = {
      x: start.right - (moveEvent.clientX - start.x),
      y: start.bottom - (moveEvent.clientY - start.y),
    };
    clamp();
  };
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
  };

  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
};

onMounted(() => {
  window.addEventListener("message", onMessage);
  window.parent?.postMessage({ type: "__edit_mode_available" }, "*");
  window.addEventListener("resize", clamp);
});

onUnmounted(() => {
  window.removeEventListener("message", onMessage);
  window.removeEventListener("resize", clamp);
});
</script>

<template>
  <div
    v-if="open"
    ref="panel"
    class="twk-panel"
    data-noncommentable=""
    :style="{ right: `${offset.x}px`, bottom: `${offset.y}px` }"
  >
    <div class="twk-hd" @mousedown="dragStart">
      <b>{{ title }}</b>
      <button class="twk-x" type="button" aria-label="Close tweaks" @mousedown.stop @click="dismiss">x</button>
    </div>
    <div class="twk-body">
      <slot />
    </div>
  </div>
</template>
