<script setup>
import { computed, nextTick, ref, watchEffect } from "vue";
import { useTweaks } from "../composables/useTweaks.js";
import { useAppAreas } from "../composables/useAppAreas.js";
import TopBar from "../components/common/TopBar.vue";
import ConfirmDialog from "../components/common/ConfirmDialog.vue";
import TweaksPanel from "../components/common/TweaksPanel.vue";
import TweakSection from "../components/common/TweakSection.vue";
import TweakRadio from "../components/common/TweakRadio.vue";
import TweakColor from "../components/common/TweakColor.vue";

// Settings → App Area. Master list of the mine's pit names (Copper Pit, Gold Pit),
// which drives the Area dropdown of the Rainfall step on Data entry. Mirrors the
// Mining data tab, minus the uppercasing — these are names, not codes.
defineProps({ embedded: { type: Boolean, default: false } });

const { areas, tableMissing, addArea, updateArea, removeArea } = useAppAreas();
const draftArea = ref("");
const draftInput = ref(null);
const editingArea = ref("");
const editDraft = ref("");
const message = ref("");
const addModalOpen = ref(false);

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

const sortedAreas = computed(() => [...areas.value].sort((a, b) => a.localeCompare(b)));

const openAddModal = () => {
  draftArea.value = "";
  message.value = "";
  addModalOpen.value = true;
};

const closeAddModal = () => {
  addModalOpen.value = false;
  draftArea.value = "";
};

// Stay in the modal after adding so several pits can be typed in a row.
const commitArea = async () => {
  const name = draftArea.value.trim();
  if (!name) return;
  const result = await addArea(name);
  message.value = result.ok ? `${result.area} added - keep typing to add another` : `${result.area} already exists`;
  if (result.ok) {
    draftArea.value = "";
    nextTick(() => draftInput.value?.focus());
  }
};

const startEdit = (area) => {
  editingArea.value = area;
  editDraft.value = area;
  message.value = "";
};

const cancelEdit = () => {
  editingArea.value = "";
  editDraft.value = "";
};

const saveEdit = async () => {
  const result = await updateArea(editingArea.value, editDraft.value);
  if (!result.ok && result.reason === "duplicate") {
    message.value = `${result.area} already exists`;
    return;
  }
  if (!result.ok) return;

  message.value = result.reason === "same" ? `${result.area} unchanged` : `${result.oldArea} renamed to ${result.area}`;
  cancelEdit();
};

// Removing drops the name from the Rainfall Area dropdown, so confirm first.
// Rainfall rows already logged keep the name they were saved with.
const pendingDelete = ref(null);
const requestDelete = (area) => {
  pendingDelete.value = area;
};
const confirmDelete = async () => {
  const area = pendingDelete.value;
  pendingDelete.value = null;
  if (!area) return;
  await removeArea(area);
  if (editingArea.value === area) cancelEdit();
  message.value = `${area} removed from App Area master`;
};
</script>

<template>
  <div :class="embedded ? 'page-embed' : 'entry-dash mining-page'">
    <TopBar v-if="!embedded" subtitle="App Area master" />

    <section class="mining-hero">
      <div>
        <span class="sum-k">Master data</span>
        <h1>App Area</h1>
        <p>Pit names used by the Area dropdown of the Rainfall step (step 3) on the Data entry page.</p>
      </div>
      <div class="mining-total mono">{{ sortedAreas.length }}</div>
    </section>

    <main class="mining-layout mining-layout-single">
      <section class="mining-list panel">
        <div class="mining-toolbar">
          <p v-if="message" class="mining-message">{{ message }}</p>
          <span v-else />
          <button class="add-exc" type="button" @click="openAddModal">+ Add</button>
        </div>

        <p v-if="tableMissing" class="mining-message">
          Not saved to the database yet — run supabase/app_areas.sql to create the app_areas table.
        </p>

        <div class="panel-head">
          <h2>Saved app areas</h2>
          <span class="area-count-pill mono">{{ sortedAreas.length }} items</span>
        </div>

        <div class="mining-table">
          <div class="mining-row mining-row-head">
            <span>App Area</span>
            <span>Dropdown status</span>
            <span>Action</span>
          </div>
          <div v-for="area in sortedAreas" :key="area" class="mining-row">
            <input
              v-if="editingArea === area"
              v-model="editDraft"
              class="mining-edit-input"
              autocomplete="off"
              @keydown.enter="saveEdit"
              @keydown.esc="cancelEdit"
            />
            <span v-else class="mining-code">{{ area }}</span>

            <span class="chip">Available in Rainfall</span>

            <div class="mining-actions">
              <template v-if="editingArea === area">
                <button class="mini-action primary" type="button" @click="saveEdit">Save</button>
                <button class="mini-action" type="button" @click="cancelEdit">Cancel</button>
              </template>
              <template v-else>
                <button class="mini-action" type="button" @click="startEdit(area)">Edit</button>
                <button class="gt-del" type="button" aria-label="Remove app area" @click="requestDelete(area)">x</button>
              </template>
            </div>
          </div>

          <div v-if="sortedAreas.length === 0" class="exc-empty">No app areas yet. Use "+ Add" to create one.</div>
        </div>
      </section>
    </main>

    <div v-if="addModalOpen" class="modal-overlay" @mousedown.self="closeAddModal">
      <div class="modal mining-add-modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div class="modal-title">
            <span class="exc mono">Add app area</span>
          </div>
          <button class="modal-x" type="button" aria-label="Close" @click="closeAddModal">x</button>
        </div>
        <div class="modal-body">
          <label class="mining-label" for="app-area-name">App Area</label>
          <input
            id="app-area-name"
            ref="draftInput"
            v-model="draftArea"
            class="mining-input"
            placeholder="Copper Pit"
            autocomplete="off"
            autofocus
            @keydown.enter="commitArea"
            @keydown.esc="closeAddModal"
          />
          <p v-if="message" class="mining-message">{{ message }}</p>
        </div>
        <div class="modal-foot">
          <span class="foot-note">This name will appear in the Rainfall Area dropdown.</span>
          <div class="foot-actions">
            <button class="btn" type="button" @click="closeAddModal">Cancel</button>
            <button class="btn btn-primary" type="button" @click="commitArea">Add</button>
          </div>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :open="pendingDelete !== null"
      title="Remove app area?"
      :message="pendingDelete ? `Remove &quot;${pendingDelete}&quot; from the App Area master? It will no longer appear in the Rainfall Area dropdown — rows already logged keep their area.` : ''"
      confirm-label="Remove"
      cancel-label="Cancel"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />

    <TweaksPanel>
      <TweakSection label="Theme" />
      <TweakRadio label="Mode" :value="t.theme" :options="['dark', 'light']" @change="setTweak('theme', $event)" />
      <TweakColor label="Accent" :value="t.accent" :options="['#d99a00', '#22d3ee', '#a3e635', '#f472b6', '#fb7185']" @change="setTweak('accent', $event)" />
      <TweakSection label="Layout" />
      <TweakRadio label="Density" :value="t.density" :options="['compact', 'regular']" @change="setTweak('density', $event)" />
    </TweaksPanel>
  </div>
</template>
