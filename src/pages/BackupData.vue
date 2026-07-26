<script setup>
import { computed, onMounted, ref, watchEffect } from "vue";
import { useTweaks } from "../composables/useTweaks.js";
import { useBackupExport } from "../composables/useBackupExport.js";
import TopBar from "../components/common/TopBar.vue";
import ExcelExportButton from "../components/common/ExcelExportButton.vue";
import TweaksPanel from "../components/common/TweaksPanel.vue";
import TweakSection from "../components/common/TweakSection.vue";
import TweakRadio from "../components/common/TweakRadio.vue";
import TweakColor from "../components/common/TweakColor.vue";

// When rendered as a tab inside the Settings page, hide the page's own TopBar
// and full-page shell so it nests cleanly under the Settings TopBar.
defineProps({ embedded: { type: Boolean, default: false } });

// Backup data: pick a date range, then export every Data-entry trip in it as one
// .xlsx with ONE SHEET PER DAY (same sheet layout as Data entry's Export Excel).
// This page never writes — it only reads the range back out.
const { scanning, exporting, error, days, scannedKey, rangeKey, scan, exportExcel } = useBackupExport();

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

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayIso = () => iso(new Date());
const shiftDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const monthStartIso = (monthOffset = 0) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + monthOffset);
  return iso(d);
};
const monthEndIso = (monthOffset = 0) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + monthOffset + 1);
  d.setDate(0);
  return iso(d);
};

// Default range: the 1st of this month up to today.
const from = ref(monthStartIso());
const to = ref(todayIso());
const maxDate = todayIso();

// Quick ranges. "This month" stops at today (there is no data in the future).
const presets = [
  { key: "today", label: "Today", range: () => [todayIso(), todayIso()] },
  { key: "week", label: "Last 7 days", range: () => [shiftDays(-6), todayIso()] },
  { key: "month", label: "This month", range: () => [monthStartIso(), todayIso()] },
  { key: "prev", label: "Last month", range: () => [monthStartIso(-1), monthEndIso(-1)] },
];
const activePreset = computed(() => presets.find((p) => {
  const [a, b] = p.range();
  return a === from.value && b === to.value;
})?.key ?? "");

// The preview is only valid for the range it was read for; changing the dates marks
// it stale so the numbers on screen never claim to describe a different range.
const stale = computed(() => scannedKey.value !== rangeKey(from.value, to.value));
const totals = computed(() =>
  days.value.reduce(
    (acc, day) => ({
      entries: acc.entries + day.entries,
      waste: acc.waste + day.waste,
      ore: acc.ore + day.ore,
      trips: acc.trips + day.total,
    }),
    { entries: 0, waste: 0, ore: 0, trips: 0 },
  ),
);
// Sheets in the workbook: the Summary tab plus one per day with data.
const sheetCount = computed(() => (days.value.length ? days.value.length + 1 : 0));

const load = () => scan(from.value, to.value);

const applyPreset = (preset) => {
  const [a, b] = preset.range();
  from.value = a;
  to.value = b;
  load();
};

const onFromChange = (value) => {
  from.value = value;
  if (to.value < from.value) to.value = from.value;
  load();
};

const onToChange = (value) => {
  to.value = value;
  if (from.value > to.value) from.value = to.value;
  load();
};

onMounted(load);
</script>

<template>
  <div :class="embedded ? 'page-embed' : 'entry-dash mining-page'">
    <TopBar v-if="!embedded" subtitle="Backup data" />

    <section class="mining-hero">
      <div>
        <span class="sum-k">Data backup</span>
        <h1>Backup data</h1>
        <p>
          Export the Data entry trips of a date range to one Excel file — <b>one sheet per day</b>, each sheet in the same
          layout as the Data entry export (Time × Pit × Dump Area × From × Material type × Ore type × truck model).
        </p>
      </div>
      <div class="mining-total mono">{{ days.length }}</div>
    </section>

    <main class="mining-layout mining-layout-single">
      <section class="mining-list panel">
        <div class="bk-controls">
          <label class="bk-field">
            <span>From</span>
            <input class="mining-input bk-date mono" type="date" :max="maxDate" :value="from" @change="onFromChange($event.target.value)" />
          </label>
          <label class="bk-field">
            <span>To</span>
            <input class="mining-input bk-date mono" type="date" :max="maxDate" :value="to" @change="onToChange($event.target.value)" />
          </label>

          <div class="bk-presets">
            <button
              v-for="preset in presets"
              :key="preset.key"
              class="mini-action"
              :class="{ on: activePreset === preset.key }"
              type="button"
              @click="applyPreset(preset)"
            >
              {{ preset.label }}
            </button>
          </div>

          <div class="bk-actions">
            <button class="btn" type="button" :disabled="scanning" @click="load">
              {{ scanning ? "Reading…" : "Refresh" }}
            </button>
            <ExcelExportButton :busy="exporting || scanning" @click="exportExcel(from, to)" />
          </div>
        </div>

        <p v-if="error" class="mining-message bk-error">{{ error }}</p>
        <p v-else-if="stale && !scanning" class="mining-message">Range changed — press Refresh to read it (Export Excel reads it too).</p>
        <p v-else-if="!scanning && days.length" class="mining-message">
          {{ fmt(days.length) }} day(s) with data → {{ fmt(sheetCount) }} sheets (Summary + one per day), {{ fmt(totals.trips) }} trips.
        </p>

        <div class="panel-head">
          <h2>Days in range</h2>
          <span class="area-count-pill mono">{{ days.length }} sheets</span>
        </div>

        <div class="bk-table-wrap">
          <table class="bk-table">
            <thead>
              <tr>
                <th>Date (sheet name)</th>
                <th>Shifts</th>
                <th class="num">Entry rows</th>
                <th class="num">Waste</th>
                <th class="num">Ore</th>
                <th class="num">Trips</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="day in days" :key="day.date">
                <td class="bk-date-cell mono">{{ day.date }}</td>
                <td>
                  <span v-for="shift in day.shifts" :key="shift" class="chip bk-shift">{{ shift }}</span>
                </td>
                <td class="num mono">{{ fmt(day.entries) }}</td>
                <td class="num mono">{{ fmt(day.waste) }}</td>
                <td class="num mono">{{ fmt(day.ore) }}</td>
                <td class="num mono bk-strong">{{ fmt(day.total) }}</td>
              </tr>
              <tr v-if="scanning">
                <td colspan="6" class="bk-empty">Reading {{ from }} → {{ to }}…</td>
              </tr>
              <tr v-else-if="days.length === 0">
                <td colspan="6" class="bk-empty">No trips logged between {{ from }} and {{ to }}.</td>
              </tr>
            </tbody>
            <tfoot v-if="days.length">
              <tr>
                <td class="bk-strong">Total</td>
                <td />
                <td class="num mono">{{ fmt(totals.entries) }}</td>
                <td class="num mono">{{ fmt(totals.waste) }}</td>
                <td class="num mono">{{ fmt(totals.ore) }}</td>
                <td class="num mono bk-strong">{{ fmt(totals.trips) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p class="bk-note">
          Only days that actually carry trips become sheets. Trip counts come straight from the saved entries, so the file is
          a faithful copy of what was keyed on Data entry — exporting changes nothing in the database.
        </p>
      </section>
    </main>

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
.bk-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
}
.bk-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.bk-field > span {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.bk-date {
  width: 160px;
  text-transform: none;
  letter-spacing: 0.04em;
}
.bk-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.bk-presets .mini-action.on {
  border-color: var(--accent);
  color: var(--accent);
}
.bk-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.bk-error {
  color: #e06c6c;
}
.bk-table-wrap {
  overflow: auto;
}
.bk-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.bk-table thead th {
  text-align: left;
  padding: 10px 12px;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-3);
  font-weight: 500;
  background: var(--panel-2);
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
.bk-table tbody td,
.bk-table tfoot td {
  padding: 9px 12px;
  border-bottom: 1px solid var(--line-soft);
  white-space: nowrap;
}
.bk-table tbody tr:hover {
  background: var(--panel-2);
}
.bk-table th.num,
.bk-table td.num {
  text-align: right;
}
.bk-date-cell {
  font-weight: 600;
}
.bk-shift {
  margin-right: 4px;
}
.bk-strong {
  font-weight: 600;
  color: var(--ink);
}
.bk-table tfoot td {
  background: var(--panel-2);
  border-bottom: 0;
}
.bk-empty {
  text-align: center;
  color: var(--ink-3);
  padding: 26px 12px;
  font-size: 12px;
}
.bk-note {
  margin: 0;
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.6;
  letter-spacing: 0.02em;
}

@media (max-width: 720px) {
  .bk-actions {
    margin-left: 0;
    width: 100%;
  }
}
</style>
