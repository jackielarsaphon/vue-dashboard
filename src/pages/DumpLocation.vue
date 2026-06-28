<script setup>
import { computed, ref, watchEffect } from "vue";
import { useTweaks } from "../composables/useTweaks.js";
import { useDumpingAreasStore } from "../stores/dumpingAreasStore";
import TopBar from "../components/common/TopBar.vue";
import TweaksPanel from "../components/common/TweaksPanel.vue";
import TweakSection from "../components/common/TweakSection.vue";
import TweakRadio from "../components/common/TweakRadio.vue";
import TweakColor from "../components/common/TweakColor.vue";

// When rendered as a tab inside the Settings page, hide the page's own TopBar
// and full-page shell so it nests cleanly under the Settings TopBar.
defineProps({ embedded: { type: Boolean, default: false } });

// "To location" master (the trip form's To-location dropdown). Backed by the
// SAME store the Data entry trip grid reads (useDumpingAreasStore), so adding or
// editing a location here shows up in the dropdown immediately. Manages the
// global dumping areas only (mining_area_id null); area-scoped rows created on
// demand when saving trips are left untouched.
const store = useDumpingAreasStore();

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

const rows = computed(() =>
  store.items.value
    .filter((row) => row.active && row.mining_area_id === null)
    .sort((a, b) => a.code.localeCompare(b.code)),
);

const modalOpen = ref(false);
const editingId = ref("");
const draftCode = ref("");
const message = ref("");

const openAdd = () => {
  editingId.value = "";
  draftCode.value = "";
  message.value = "";
  modalOpen.value = true;
};

const openEdit = (row) => {
  editingId.value = row.id;
  draftCode.value = row.code;
  message.value = "";
  modalOpen.value = true;
};

const closeModal = () => {
  modalOpen.value = false;
};

const commit = async () => {
  const code = draftCode.value.trim().toUpperCase();
  if (!code) return;

  const duplicate = store.items.value.some((row) => row.active && row.code === code && row.id !== editingId.value);
  if (duplicate) {
    message.value = `${code} already exists`;
    return;
  }

  if (editingId.value) {
    const result = await store.update(editingId.value, { code });
    if (!result.ok) {
      message.value = result.error || "Could not save";
      return;
    }
    message.value = `${code} updated`;
  } else {
    const result = await store.create({ code, mining_area_id: null, active: true });
    if (!result.ok) {
      message.value = result.error || "Could not add";
      return;
    }
    message.value = `${code} added to To location master`;
  }
  closeModal();
};

// Soft delete: production_entries.dumping_area_id has an ON DELETE RESTRICT FK,
// so a hard delete fails once trips reference this location.
const removeRow = async (row) => {
  await store.update(row.id, { active: false });
  message.value = `${row.code} removed from To location master`;
};
</script>

<template>
  <div :class="embedded ? 'page-embed' : 'entry-dash mining-page'">
    <TopBar v-if="!embedded" subtitle="To location master" />

    <section class="mining-hero">
      <div>
        <span class="sum-k">Master data</span>
        <h1>To location</h1>
        <p>Register the haul destinations (e.g. OREPAD, ROCKPILE) shown in the "To location" dropdown on the Data entry trip form.</p>
      </div>
      <div class="mining-total mono">{{ rows.length }}</div>
    </section>

    <main class="mining-layout mining-layout-single">
      <section class="mining-list panel">
        <div class="mining-toolbar">
          <p v-if="message" class="mining-message">{{ message }}</p>
          <span v-else />
          <button class="add-exc" type="button" @click="openAdd">+ Add</button>
        </div>

        <div class="panel-head">
          <h2>Saved locations</h2>
          <span class="area-count-pill mono">{{ rows.length }} locations</span>
        </div>

        <div class="mining-table">
          <div class="mining-row mining-row-head">
            <span>To location</span>
            <span>Dropdown status</span>
            <span>Action</span>
          </div>
          <div v-for="row in rows" :key="row.id" class="mining-row">
            <span class="mining-code mono">{{ row.code }}</span>

            <span class="chip">Available in trip form</span>

            <div class="mining-actions">
              <button class="mini-action" type="button" @click="openEdit(row)">Edit</button>
              <button class="gt-del" type="button" aria-label="Remove location" @click="removeRow(row)">x</button>
            </div>
          </div>
          <div v-if="rows.length === 0" class="mining-row">
            <span class="mining-company muted">No locations yet. Use "+ Add" to register one.</span>
          </div>
        </div>
      </section>
    </main>

    <div v-if="modalOpen" class="modal-overlay" @mousedown.self="closeModal">
      <div class="modal mining-add-modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div class="modal-title">
            <span class="exc mono">{{ editingId ? "Edit location" : "Add location" }}</span>
          </div>
          <button class="modal-x" type="button" aria-label="Close" @click="closeModal">x</button>
        </div>
        <div class="modal-body">
          <label class="mining-label" for="dump-location-code">To location</label>
          <input
            id="dump-location-code"
            v-model="draftCode"
            class="mining-input mono"
            placeholder="OREPAD"
            autocomplete="off"
            autofocus
            @keydown.enter="commit"
            @keydown.esc="closeModal"
          />
          <p v-if="message" class="mining-message">{{ message }}</p>
        </div>
        <div class="modal-foot">
          <span class="foot-note">This location will appear in the "To location" dropdown on the trip form.</span>
          <div class="foot-actions">
            <button class="btn" type="button" @click="closeModal">Cancel</button>
            <button class="btn btn-primary" type="button" @click="commit">{{ editingId ? "Save" : "Add" }}</button>
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
