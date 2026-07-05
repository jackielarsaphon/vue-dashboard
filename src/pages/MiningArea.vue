<script setup>
import { computed, nextTick, ref, watchEffect } from "vue";
import { useTweaks } from "../composables/useTweaks.js";
import { useMiningAreas } from "../composables/useMiningAreas.js";
import TopBar from "../components/common/TopBar.vue";
import ConfirmDialog from "../components/common/ConfirmDialog.vue";
import TweaksPanel from "../components/common/TweaksPanel.vue";
import TweakSection from "../components/common/TweakSection.vue";
import TweakRadio from "../components/common/TweakRadio.vue";
import TweakColor from "../components/common/TweakColor.vue";

// When rendered as a tab inside the Settings page, hide the page's own TopBar
// and full-page shell so it nests cleanly under the Settings TopBar.
defineProps({ embedded: { type: Boolean, default: false } });

const { areas, addArea, updateArea, removeArea } = useMiningAreas();
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

const commitArea = () => {
  const area = draftArea.value.trim().toUpperCase();
  if (!area) return;

  const existed = areas.value.includes(area);
  addArea(area);
  message.value = existed ? `${area} already exists` : `${area} added - keep typing to add another`;
  draftArea.value = "";
  nextTick(() => draftInput.value?.focus());
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

const saveEdit = () => {
  const result = updateArea(editingArea.value, editDraft.value);
  if (!result.ok && result.reason === "duplicate") {
    message.value = `${result.area} already exists`;
    return;
  }
  if (!result.ok) return;

  message.value = result.reason === "same" ? `${result.area} unchanged` : `${result.oldArea} updated to ${result.area}`;
  cancelEdit();
};

// Removing a code is destructive (it drops out of the Add area dropdown), so
// confirm via a themed dialog first. The x button opens it; confirmDelete removes.
const pendingDelete = ref(null);
const requestDelete = (area) => {
  pendingDelete.value = area;
};
const confirmDelete = () => {
  const area = pendingDelete.value;
  pendingDelete.value = null;
  if (!area) return;
  removeArea(area);
  if (editingArea.value === area) cancelEdit();
  message.value = `${area} removed from Mining data master`;
};
</script>

<template>
  <div :class="embedded ? 'page-embed' : 'entry-dash mining-page'">
    <TopBar v-if="!embedded" subtitle="Mining data master" />

    <section class="mining-hero">
      <div>
        <span class="sum-k">Master data</span>
        <h1>Mining data</h1>
        <p>Add, edit, or remove mining data codes used in the Add area dropdown on the Data entry page.</p>
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

        <div class="panel-head">
          <h2>Saved mining data</h2>
          <span class="area-count-pill mono">{{ sortedAreas.length }} items</span>
        </div>

        <div class="mining-table">
          <div class="mining-row mining-row-head">
            <span>Mining data</span>
            <span>Dropdown status</span>
            <span>Action</span>
          </div>
          <div v-for="area in sortedAreas" :key="area" class="mining-row">
            <input
              v-if="editingArea === area"
              v-model="editDraft"
              class="mining-edit-input mono"
              autocomplete="off"
              @keydown.enter="saveEdit"
              @keydown.esc="cancelEdit"
            />
            <span v-else class="mining-code mono">{{ area }}</span>

            <span class="chip">Available in Add area</span>

            <div class="mining-actions">
              <template v-if="editingArea === area">
                <button class="mini-action primary" type="button" @click="saveEdit">Save</button>
                <button class="mini-action" type="button" @click="cancelEdit">Cancel</button>
              </template>
              <template v-else>
                <button class="mini-action" type="button" @click="startEdit(area)">Edit</button>
                <button class="gt-del" type="button" aria-label="Remove mining data" @click="requestDelete(area)">x</button>
              </template>
            </div>
          </div>
        </div>
      </section>
    </main>

    <div v-if="addModalOpen" class="modal-overlay" @mousedown.self="closeAddModal">
      <div class="modal mining-add-modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div class="modal-title">
            <span class="exc mono">Add mining data</span>
          </div>
          <button class="modal-x" type="button" aria-label="Close" @click="closeAddModal">x</button>
        </div>
        <div class="modal-body">
          <label class="mining-label" for="mining-area-code">Mining data</label>
          <input
            id="mining-area-code"
            ref="draftInput"
            v-model="draftArea"
            class="mining-input mono"
            placeholder="NLU03C"
            autocomplete="off"
            autofocus
            @keydown.enter="commitArea"
            @keydown.esc="closeAddModal"
          />
          <p v-if="message" class="mining-message">{{ message }}</p>
        </div>
        <div class="modal-foot">
          <span class="foot-note">This code will appear in the Add area dropdown.</span>
          <div class="foot-actions">
            <button class="btn" type="button" @click="closeAddModal">Cancel</button>
            <button class="btn btn-primary" type="button" @click="commitArea">Add</button>
          </div>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :open="pendingDelete !== null"
      title="Remove mining data?"
      :message="pendingDelete ? `Remove &quot;${pendingDelete}&quot; from the Mining data master? It will no longer appear in the Add area dropdown.` : ''"
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
