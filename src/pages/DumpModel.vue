<script setup>
import { computed, ref, watchEffect } from "vue";
import { useTweaks } from "../composables/useTweaks.js";
import { useTruckModelsStore } from "../stores/truckModelsStore";
import { useTruckFactors, DEFAULT_TONNES_PER_TRIP } from "../composables/useTruckFactors.js";
import TopBar from "../components/common/TopBar.vue";
import ConfirmDialog from "../components/common/ConfirmDialog.vue";
import TweaksPanel from "../components/common/TweaksPanel.vue";
import TweakSection from "../components/common/TweakSection.vue";
import TweakRadio from "../components/common/TweakRadio.vue";
import TweakColor from "../components/common/TweakColor.vue";

// When rendered as a tab inside the Settings page, hide the page's own TopBar
// and full-page shell so it nests cleanly under the Settings TopBar.
defineProps({ embedded: { type: Boolean, default: false } });

const store = useTruckModelsStore();
const { rows: factorRows, factorFor, historyFor, weekStartOf, setWeekFactor } = useTruckFactors();

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

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayIso = isoOf(new Date());
const thisWeekStart = weekStartOf(todayIso);

const fmtWeek = (iso) => {
  const [y, m, d] = String(iso).split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

// Effective factor for this week (the value dashboards use for current data).
const currentFactor = (code) => factorFor(code, todayIso);
// Whether the model has any explicit factor source (a weekly record or capacity),
// so we can mute the fallback default.
const hasExplicit = (code, row) => (factorRows.value.length > 0 && historyFor(code).length > 0) || row.capacity_tonnes != null;

// ---- code / company modal ----
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
    message.value = `${code} added to Dump model master`;
  }
  closeModal();
};

// Removing a model soft-deletes it, so confirm via a themed dialog first.
// The x button opens it; confirmDelete does the actual removal.
const pendingDelete = ref(null);
const requestDelete = (row) => {
  pendingDelete.value = row;
};
const confirmDelete = async () => {
  const row = pendingDelete.value;
  pendingDelete.value = null;
  if (!row) return;
  await store.update(row.id, { active: false });
  message.value = `${row.code} removed from Dump model master`;
};

// ---- weekly factor history modal ----
const factorModalOpen = ref(false);
const factorCode = ref("");
const newWeekDate = ref(todayIso);
const newFactor = ref("");
const factorMessage = ref("");

const factorHistory = computed(() => (factorCode.value ? historyFor(factorCode.value) : []));

const openFactors = (row) => {
  factorCode.value = row.code;
  newWeekDate.value = todayIso;
  newFactor.value = "";
  factorMessage.value = "";
  factorModalOpen.value = true;
};

const closeFactors = () => {
  factorModalOpen.value = false;
};

// Save (upsert) a week's factor; blank removes it (carries forward the prior week).
const saveWeek = async (weekStart, value) => {
  await setWeekFactor(factorCode.value, weekStart, value);
};

const addWeek = async () => {
  const value = Number(newFactor.value);
  if (!Number.isFinite(value) || value <= 0) {
    factorMessage.value = "Enter a positive factor (tonnes per trip)";
    return;
  }
  const week = weekStartOf(newWeekDate.value || todayIso);
  await setWeekFactor(factorCode.value, week, value);
  factorMessage.value = `Saved ${value.toFixed(2)} t/trip for week of ${fmtWeek(week)}`;
  newFactor.value = "";
};

// Removing a week's factor is destructive (that week falls back to the prior
// week's value), so confirm via a themed dialog first. This dialog stacks above
// the weekly-factor modal (ConfirmDialog z-index 80 > modal-overlay 60).
const pendingWeekDelete = ref(null);
const requestDeleteWeek = (weekStart) => {
  pendingWeekDelete.value = weekStart;
};
const confirmDeleteWeek = async () => {
  const weekStart = pendingWeekDelete.value;
  pendingWeekDelete.value = null;
  if (!weekStart) return;
  await setWeekFactor(factorCode.value, weekStart, "");
  factorMessage.value = `Removed week of ${fmtWeek(weekStart)}`;
};
</script>

<template>
  <div :class="embedded ? 'page-embed' : 'entry-dash mining-page'">
    <TopBar v-if="!embedded" subtitle="Dump model master" />

    <section class="mining-hero">
      <div>
        <span class="sum-k">Master data</span>
        <h1>Dump model</h1>
        <p>Register dump (truck) models and their weekly TD&amp;MVDC factor (tonnes per trip) used to convert trips to tonnes.</p>
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
          <h2>Saved dump models</h2>
          <span class="area-count-pill mono">{{ rows.length }} models</span>
        </div>

        <div class="mining-table dump-model-table">
          <div class="mining-row mining-row-head">
            <span>Dump model</span>
            <span>Company</span>
            <span>Factor — week of {{ fmtWeek(thisWeekStart) }}</span>
            <span>Action</span>
          </div>
          <div v-for="row in rows" :key="row.id" class="mining-row">
            <span class="mining-code mono">{{ row.code }}</span>
            <span v-if="row.company" class="mining-company">{{ row.company }}</span>
            <span v-else class="mining-company muted">No company</span>

            <span class="mining-factor mono" :class="{ muted: !hasExplicit(row.code, row) }">
              {{ currentFactor(row.code).toFixed(2) }}
            </span>

            <div class="mining-actions">
              <button class="mini-action" type="button" @click="openFactors(row)">Weekly factors ▸</button>
              <button class="mini-action" type="button" @click="openEdit(row)">Edit</button>
              <button class="gt-del" type="button" aria-label="Remove dump model" @click="requestDelete(row)">x</button>
            </div>
          </div>
          <div v-if="rows.length === 0" class="mining-row">
            <span class="mining-company muted">No dump models yet. Use "+ Add" to register one.</span>
          </div>
        </div>
      </section>
    </main>

    <div v-if="modalOpen" class="modal-overlay" @mousedown.self="closeModal">
      <div class="modal mining-add-modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div class="modal-title">
            <span class="exc mono">{{ editingId ? "Edit dump model" : "Add dump model" }}</span>
          </div>
          <button class="modal-x" type="button" aria-label="Close" @click="closeModal">x</button>
        </div>
        <div class="modal-body">
          <label class="mining-label" for="dump-model-code">Dump model</label>
          <input
            id="dump-model-code"
            v-model="draftCode"
            class="mining-input mono"
            placeholder="SKT90S"
            autocomplete="off"
            autofocus
            @keydown.enter="commit"
            @keydown.esc="closeModal"
          />
          <label class="mining-label" for="dump-model-company">Company</label>
          <input
            id="dump-model-company"
            v-model="draftCompany"
            class="mining-input"
            placeholder="Owner / supplier company"
            autocomplete="off"
            @keydown.enter="commit"
            @keydown.esc="closeModal"
          />
          <p class="foot-note">Set the tonnes/trip factor under "Weekly factors" — it changes per week.</p>
          <p v-if="message" class="mining-message">{{ message }}</p>
        </div>
        <div class="modal-foot">
          <span class="foot-note">This model will appear in the Dump model dropdown on the trip form.</span>
          <div class="foot-actions">
            <button class="btn" type="button" @click="closeModal">Cancel</button>
            <button class="btn btn-primary" type="button" @click="commit">{{ editingId ? "Save" : "Add" }}</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="factorModalOpen" class="modal-overlay" @mousedown.self="closeFactors">
      <div class="modal mining-add-modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div class="modal-title">
            <span class="exc mono">Weekly factor — {{ factorCode }}</span>
          </div>
          <button class="modal-x" type="button" aria-label="Close" @click="closeFactors">x</button>
        </div>
        <div class="modal-body">
          <p class="modal-hint">
            Factor (tonnes/trip) per week. Each week uses its own value; a week with no entry carries forward the most recent
            earlier week (or the default {{ DEFAULT_TONNES_PER_TRIP }}).
          </p>

          <div class="factor-history">
            <div class="factor-row factor-row-head">
              <span>Week starting</span>
              <span>Factor (t/trip)</span>
              <span />
            </div>
            <div v-for="rec in factorHistory" :key="rec.week_start" class="factor-row">
              <span class="mono">{{ fmtWeek(rec.week_start) }}</span>
              <input
                class="mining-input mono"
                type="number"
                step="0.01"
                min="0"
                :value="rec.factor"
                @change="saveWeek(rec.week_start, $event.target.value)"
              />
              <button class="gt-del" type="button" aria-label="Remove week" @click="requestDeleteWeek(rec.week_start)">x</button>
            </div>
            <div v-if="factorHistory.length === 0" class="factor-row">
              <span class="mining-company muted">No weekly factors yet — add one below.</span>
            </div>
          </div>

          <div class="factor-add">
            <div>
              <label class="mining-label" for="factor-week">Week (any day in it)</label>
              <input id="factor-week" v-model="newWeekDate" class="mining-input mono" type="date" />
            </div>
            <div>
              <label class="mining-label" for="factor-value">Factor (t/trip)</label>
              <input
                id="factor-value"
                v-model="newFactor"
                class="mining-input mono"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 41.67"
                @keydown.enter="addWeek"
              />
            </div>
            <button class="btn btn-primary" type="button" @click="addWeek">Add / update</button>
          </div>

          <p v-if="factorMessage" class="mining-message">{{ factorMessage }}</p>
        </div>
        <div class="modal-foot">
          <span class="foot-note">Week start is the Saturday of the chosen week.</span>
          <div class="foot-actions">
            <button class="btn btn-primary" type="button" @click="closeFactors">Done</button>
          </div>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :open="pendingDelete !== null"
      title="Remove dump model?"
      :message="pendingDelete ? `Remove &quot;${pendingDelete.code}&quot; from the Dump model master? It will no longer appear in the trip form dropdown.` : ''"
      confirm-label="Remove"
      cancel-label="Cancel"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />

    <ConfirmDialog
      :open="pendingWeekDelete !== null"
      title="Remove weekly factor?"
      :message="pendingWeekDelete ? `Remove the factor for the week of ${fmtWeek(pendingWeekDelete)}? That week will fall back to the most recent earlier week.` : ''"
      confirm-label="Remove"
      cancel-label="Cancel"
      danger
      @confirm="confirmDeleteWeek"
      @cancel="pendingWeekDelete = null"
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

<style scoped>
/* Adds the Factor column to this page's table only; the shared .mining-row grid
   (used by the Mining area / Excavator masters) stays at three columns. */
.dump-model-table .mining-row {
  grid-template-columns: minmax(110px, 1fr) auto minmax(150px, auto) minmax(220px, auto);
}
.mining-factor {
  text-align: right;
  align-self: center;
}
.factor-history {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 14px;
}
.factor-row {
  display: grid;
  grid-template-columns: 1fr 120px 28px;
  gap: 10px;
  align-items: center;
}
.factor-row-head {
  color: var(--ink-3);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.factor-add {
  display: grid;
  grid-template-columns: 1fr 120px auto;
  gap: 10px;
  align-items: end;
  padding-top: 10px;
  border-top: 1px solid var(--line-soft);
}
</style>
