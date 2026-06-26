<script setup>
import { computed, ref, watchEffect } from "vue";
import { useTweaks } from "../composables/useTweaks.js";
import { useExcavatorsStore } from "../stores/excavatorsStore";
import TopBar from "../components/common/TopBar.vue";
import TweaksPanel from "../components/common/TweaksPanel.vue";
import TweakSection from "../components/common/TweakSection.vue";
import TweakRadio from "../components/common/TweakRadio.vue";
import TweakColor from "../components/common/TweakColor.vue";

const store = useExcavatorsStore();

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

const rows = computed(() => store.items.value.filter((row) => row.active).sort((a, b) => a.code.localeCompare(b.code)));

const modalOpen = ref(false);
const editingId = ref("");
const draftCode = ref("");
const draftCompany = ref("");
const message = ref("");

const openAdd = () => {
  editingId.value = "";
  draftCode.value = "";
  draftCompany.value = "";
  message.value = "";
  modalOpen.value = true;
};

const openEdit = (row) => {
  editingId.value = row.id;
  draftCode.value = row.code;
  draftCompany.value = row.company || "";
  message.value = "";
  modalOpen.value = true;
};

const closeModal = () => {
  modalOpen.value = false;
};

const commit = async () => {
  const code = draftCode.value.trim().toUpperCase();
  const company = draftCompany.value.trim();
  if (!code) return;

  const duplicate = store.items.value.some((row) => row.active && row.code === code && row.id !== editingId.value);
  if (duplicate) {
    message.value = `${code} already exists`;
    return;
  }

  if (editingId.value) {
    const result = await store.update(editingId.value, { code, company });
    if (!result.ok) {
      message.value = result.error || "Could not save";
      return;
    }
    message.value = `${code} updated`;
  } else {
    const result = await store.create({ code, company, active: true });
    if (!result.ok) {
      message.value = result.error || "Could not add";
      return;
    }
    message.value = `${code} added to Excavator master`;
  }
  closeModal();
};

const removeRow = async (row) => {
  await store.update(row.id, { active: false });
  message.value = `${row.code} removed from Excavator master`;
};
</script>

<template>
  <div class="entry-dash mining-page">
    <TopBar subtitle="Excavator master" />

    <section class="mining-hero">
      <div>
        <span class="sum-k">Master data</span>
        <h1>Excavator</h1>
        <p>Register excavators (e.g. E-507) and the company each unit belongs to.</p>
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
          <h2>Saved excavators</h2>
          <span class="area-count-pill mono">{{ rows.length }} units</span>
        </div>

        <div class="mining-table">
          <div class="mining-row mining-row-head">
            <span>Excavator</span>
            <span>Company</span>
            <span>Action</span>
          </div>
          <div v-for="row in rows" :key="row.id" class="mining-row">
            <span class="mining-code mono">{{ row.code }}</span>
            <span v-if="row.company" class="mining-company">{{ row.company }}</span>
            <span v-else class="mining-company muted">No company</span>

            <div class="mining-actions">
              <button class="mini-action" type="button" @click="openEdit(row)">Edit</button>
              <button class="gt-del" type="button" aria-label="Remove excavator" @click="removeRow(row)">x</button>
            </div>
          </div>
          <div v-if="rows.length === 0" class="mining-row">
            <span class="mining-company muted">No excavators yet. Use "+ Add" to register one.</span>
          </div>
        </div>
      </section>
    </main>

    <div v-if="modalOpen" class="modal-overlay" @mousedown.self="closeModal">
      <div class="modal mining-add-modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div class="modal-title">
            <span class="exc mono">{{ editingId ? "Edit excavator" : "Add excavator" }}</span>
          </div>
          <button class="modal-x" type="button" aria-label="Close" @click="closeModal">x</button>
        </div>
        <div class="modal-body">
          <label class="mining-label" for="excavator-code">Excavator</label>
          <input
            id="excavator-code"
            v-model="draftCode"
            class="mining-input mono"
            placeholder="E-507"
            autocomplete="off"
            autofocus
            @keydown.enter="commit"
            @keydown.esc="closeModal"
          />
          <label class="mining-label" for="excavator-company">Company</label>
          <input
            id="excavator-company"
            v-model="draftCompany"
            class="mining-input"
            placeholder="Contractor / owner company"
            autocomplete="off"
            @keydown.enter="commit"
            @keydown.esc="closeModal"
          />
          <p v-if="message" class="mining-message">{{ message }}</p>
        </div>
        <div class="modal-foot">
          <span class="foot-note">Registered excavators can be assigned to an area on the Data entry page.</span>
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
