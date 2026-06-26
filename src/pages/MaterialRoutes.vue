<script setup>
import { computed, reactive, ref, watchEffect } from "vue";
import { useTweaks } from "../composables/useTweaks.js";
import { useMaterialRoutes } from "../composables/useMaterialRoutes.js";
import TopBar from "../components/common/TopBar.vue";
import TweaksPanel from "../components/common/TweaksPanel.vue";
import TweakSection from "../components/common/TweakSection.vue";
import TweakRadio from "../components/common/TweakRadio.vue";
import TweakColor from "../components/common/TweakColor.vue";

const { routes, addRoute, updateRoute, removeRoute } = useMaterialRoutes();

const [t, setTweak] = useTweaks({
  accent: "#d99a00",
  density: "compact",
  theme: "light",
});

watchEffect(() => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = t.theme;
  document.documentElement.dataset.density = t.density;
  document.documentElement.style.setProperty("--accent", t.accent);
});

const oreCount = computed(() => routes.value.filter((route) => route.material === "Ore").length);
const wasteCount = computed(() => routes.value.filter((route) => route.material === "Waste").length);
const total = computed(() => routes.value.length);

const message = ref("");

// Single modal handles both add and edit (mode: "add" | "edit").
const modalOpen = ref(false);
const modalMode = ref("add");
const editingId = ref("");
const draft = reactive({ material: "Ore", oreType: "" });

const openAdd = () => {
  modalMode.value = "add";
  editingId.value = "";
  draft.material = "Ore";
  draft.oreType = "";
  message.value = "";
  modalOpen.value = true;
};

const openEdit = (route) => {
  modalMode.value = "edit";
  editingId.value = route.id;
  draft.material = route.material;
  draft.oreType = route.oreType;
  message.value = "";
  modalOpen.value = true;
};

const closeModal = () => {
  modalOpen.value = false;
};

const commit = () => {
  if (modalMode.value === "add") {
    const result = addRoute({ ...draft });
    if (!result.ok) {
      message.value = "Ore type is required";
      return;
    }
    message.value = `${result.route.oreType} added`;
  } else {
    const result = updateRoute(editingId.value, { ...draft });
    if (!result.ok) {
      message.value = "Ore type is required";
      return;
    }
    message.value = "Route updated";
  }
  closeModal();
};

const deleteRoute = (route) => {
  removeRoute(route.id);
  message.value = `${route.oreType} removed`;
};
</script>

<template>
  <div class="entry-dash routes-page">
    <TopBar subtitle="Material routes" />

    <section class="routes-hero panel">
      <div class="routes-hero-text">
        <span class="routes-eyebrow">Master data</span>
        <h1>Material Routes</h1>
        <p>Material type and ore type for each trip route. Destinations are managed on the Locations page.</p>
      </div>
      <div class="routes-badge">{{ total }}</div>
    </section>

    <main class="routes-main">
      <section class="panel routes-panel">
        <div class="routes-panel-head">
          <span class="routes-panel-title">Route table</span>
          <div class="routes-head-right">
            <div class="routes-chips mono">
              <span class="routes-chip ore">Ore {{ oreCount }}</span>
              <span class="routes-chip waste">Waste {{ wasteCount }}</span>
              <span class="routes-chip total">{{ total }} rows</span>
            </div>
            <button class="add-exc" type="button" @click="openAdd">+ Add route</button>
          </div>
        </div>

        <p v-if="message" class="mining-message routes-message">{{ message }}</p>

        <div class="routes-table-wrap">
          <table class="routes-table">
            <thead>
              <tr>
                <th>Material type</th>
                <th>Ore type</th>
                <th class="rt-action-col">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="route in routes" :key="route.id">
                <td class="rt-material" :class="route.material === 'Waste' ? 'is-waste' : 'is-ore'">{{ route.material }}</td>
                <td class="rt-ore mono">{{ route.oreType }}</td>
                <td>
                  <div class="rt-actions">
                    <button class="mini-action" type="button" @click="openEdit(route)">Edit</button>
                    <button class="gt-del" type="button" aria-label="Remove route" @click="deleteRoute(route)">x</button>
                  </div>
                </td>
              </tr>
              <tr v-if="routes.length === 0">
                <td colspan="3" class="rt-empty">No routes yet. Click “+ Add route” to create one.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>

    <div v-if="modalOpen" class="modal-overlay" @mousedown.self="closeModal">
      <div class="modal mining-add-modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div class="modal-title">
            <span class="exc mono">{{ modalMode === "add" ? "Add route" : "Edit route" }}</span>
          </div>
          <button class="modal-x" type="button" aria-label="Close" @click="closeModal">x</button>
        </div>
        <div class="modal-body">
          <label class="mining-label">Material type</label>
          <div class="seg routes-seg">
            <button type="button" :class="{ on: draft.material === 'Ore' }" @click="draft.material = 'Ore'">Ore</button>
            <button type="button" :class="{ on: draft.material === 'Waste' }" @click="draft.material = 'Waste'">Waste</button>
          </div>

          <label class="mining-label" for="route-ore">Ore type</label>
          <input
            id="route-ore"
            v-model="draft.oreType"
            class="mining-input mono"
            placeholder="APHH"
            autocomplete="off"
            @keydown.enter="commit"
            @keydown.esc="closeModal"
          />

          <p v-if="message" class="mining-message">{{ message }}</p>
        </div>
        <div class="modal-foot">
          <span class="foot-note">Codes are saved in uppercase.</span>
          <div class="foot-actions">
            <button class="btn" type="button" @click="closeModal">Cancel</button>
            <button class="btn btn-primary" type="button" @click="commit">{{ modalMode === "add" ? "Add" : "Save" }}</button>
          </div>
        </div>
      </div>
    </div>

    <TweaksPanel>
      <TweakSection label="Theme" />
      <TweakRadio label="Mode" :value="t.theme" :options="['dark', 'light']" @change="setTweak('theme', $event)" />
      <TweakColor label="Accent" :value="t.accent" :options="['#d99a00', '#22d3ee', '#a3e635', '#f472b6', '#fb7185']" @change="setTweak('accent', $event)" />
      <TweakSection label="Layout" />
      <TweakRadio label="Density" :value="t.density" :options="['compact', 'regular']" @change="setTweak('density', $event)" />
    </TweaksPanel>
  </div>
</template>

<style scoped>
.routes-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* Hero card */
.routes-hero {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 24px 32px;
}
.routes-eyebrow {
  display: block;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin-bottom: 8px;
}
.routes-hero h1 {
  margin: 0 0 10px;
  font-size: 40px;
  line-height: 1.05;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--ink);
}
.routes-hero p {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-3);
}
.routes-badge {
  flex: none;
  display: grid;
  place-items: center;
  width: 96px;
  height: 96px;
  border-radius: 16px;
  background: var(--accent);
  color: #fff;
  font-family: var(--font-sans);
  font-variant-numeric: tabular-nums;
  font-size: 36px;
  font-weight: 700;
}

/* Route table panel */
.routes-panel {
  padding: 22px 24px 26px;
}
.routes-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.routes-panel-title {
  font-family: var(--font-mono);
  font-size: 13px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--accent-2, var(--accent));
}
.routes-head-right {
  display: flex;
  align-items: center;
  gap: 14px;
}
.routes-chips {
  display: flex;
  gap: 8px;
  font-size: 11px;
}
.routes-chip {
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--ink-2);
  letter-spacing: 0.06em;
}
.routes-chip.ore {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
  color: var(--accent-2, var(--ink-2));
}
.routes-chip.waste {
  background: var(--panel-2);
}
.routes-message {
  margin: 0 0 12px;
}

.routes-table-wrap {
  overflow: auto;
}
.routes-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.routes-table thead th {
  text-align: left;
  padding: 14px 16px;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-3);
  font-weight: 500;
  background: var(--panel-2);
  border-bottom: 1px solid var(--line);
}
.routes-table thead th:first-child {
  border-top-left-radius: 8px;
  border-bottom-left-radius: 8px;
}
.routes-table thead th:last-child {
  border-top-right-radius: 8px;
  border-bottom-right-radius: 8px;
}
.routes-table tbody td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--line-soft);
  white-space: nowrap;
}
.routes-table tbody tr:hover {
  background: var(--panel-2);
}
.rt-material.is-ore,
.rt-material.is-waste {
  color: var(--ink-2);
}
.rt-ore {
  font-weight: 600;
  color: var(--ink);
}
.rt-loc {
  color: var(--ink-2);
}
.rt-action-col {
  width: 1%;
}
.rt-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.rt-empty {
  text-align: center;
  color: var(--ink-3);
  padding: 28px 16px;
  font-family: var(--font-mono);
  font-size: 12px;
}

/* Column widths: keep first two snug, let location take the rest. */
.routes-table th:first-child,
.routes-table td:first-child {
  width: 16%;
}
.routes-table th:nth-child(2),
.routes-table td:nth-child(2) {
  width: 20%;
}

/* Material-type toggle inside the modal */
.routes-seg {
  margin-bottom: 14px;
}
</style>
