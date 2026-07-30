<script setup>
import { computed, onMounted, ref, watchEffect } from "vue";
import { useTweaks } from "../composables/useTweaks.js";
import { useMonthlyBackup } from "../composables/useMonthlyBackup.js";
import TopBar from "../components/common/TopBar.vue";
import TweaksPanel from "../components/common/TweaksPanel.vue";
import TweakSection from "../components/common/TweakSection.vue";
import TweakRadio from "../components/common/TweakRadio.vue";
import TweakColor from "../components/common/TweakColor.vue";

defineProps({ embedded: { type: Boolean, default: false } });

const { scanning, downloading, error, snapshot, inventory, scannedMonth, lastDownload, scan, download } =
  useMonthlyBackup();

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

const localMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};
const month = ref(localMonth());
const maxMonth = localMonth();
const fmt = (value) => Math.round(Number(value) || 0).toLocaleString("en-US");
const stale = computed(() => scannedMonth.value !== month.value);
const summary = computed(() => snapshot.value?.summary || {});
const unavailable = computed(() => inventory.value.filter((table) => !table.available).length);
const load = () => scan(month.value);
const onMonthChange = () => load();

onMounted(load);
</script>

<template>
  <div :class="embedded ? 'page-embed' : 'entry-dash mining-page'">
    <TopBar v-if="!embedded" subtitle="Monthly backup" />

    <section class="mining-hero monthly-hero">
      <div>
        <span class="sum-k">Monthly data backup</span>
        <h1>Monthly backup</h1>
        <p>
          สำรองข้อมูลของเดือนที่เลือกเป็นไฟล์ JSON ครบทั้ง Production, Rainfall, Plan/Target
          และข้อมูลตั้งค่าหลักที่จำเป็นต่อความสัมพันธ์ของข้อมูล
        </p>
      </div>
      <div class="mining-total mono" :title="`${fmt(summary.total_rows)} rows`">
        {{ fmt(summary.total_rows) }}
      </div>
    </section>

    <main class="mining-layout mining-layout-single">
      <section class="mining-list panel">
        <div class="monthly-controls">
          <label class="monthly-field">
            <span>Backup month</span>
            <input
              v-model="month"
              class="mining-input monthly-picker mono"
              type="month"
              :max="maxMonth"
              @change="onMonthChange"
            />
          </label>

          <div class="monthly-actions">
            <button class="btn" type="button" :disabled="scanning || downloading" @click="load">
              {{ scanning ? "Reading…" : "Refresh" }}
            </button>
            <button
              class="btn monthly-download"
              type="button"
              :disabled="scanning || downloading"
              @click="download(month)"
            >
              <span aria-hidden="true">↓</span>
              {{ downloading ? "Preparing…" : "Download JSON backup" }}
            </button>
          </div>
        </div>

        <p v-if="error" class="mining-message monthly-error">{{ error }}</p>
        <p v-else-if="stale && !scanning" class="mining-message">
          Month changed — press Refresh to prepare its backup.
        </p>
        <p v-else-if="lastDownload" class="mining-message monthly-success">
          Downloaded {{ lastDownload }}
        </p>
        <p v-else-if="!scanning && snapshot" class="mining-message">
          {{ month }} is ready — {{ fmt(summary.total_rows) }} rows from
          {{ fmt(summary.included_tables) }} tables.
          <template v-if="unavailable"> {{ unavailable }} optional table(s) are not installed.</template>
        </p>

        <div class="monthly-stats">
          <div class="monthly-stat">
            <span>Total rows</span>
            <b class="mono">{{ fmt(summary.total_rows) }}</b>
          </div>
          <div class="monthly-stat">
            <span>Shifts</span>
            <b class="mono">{{ fmt(summary.shifts) }}</b>
          </div>
          <div class="monthly-stat">
            <span>Production entries</span>
            <b class="mono">{{ fmt(summary.production_entries) }}</b>
          </div>
          <div class="monthly-stat">
            <span>Rainfall logs</span>
            <b class="mono">{{ fmt(summary.rainfall_logs) }}</b>
          </div>
        </div>

        <div class="panel-head">
          <h2>Backup contents</h2>
          <span class="area-count-pill mono">{{ inventory.length }} tables</span>
        </div>

        <div class="monthly-table-wrap">
          <table class="monthly-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Backup scope</th>
                <th>Status</th>
                <th class="num">Rows</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="table in inventory" :key="table.name">
                <td class="mono monthly-table-name">{{ table.name }}</td>
                <td>{{ table.scope }}</td>
                <td>
                  <span class="monthly-status" :class="{ missing: !table.available }">
                    {{ table.available ? "Included" : "Not installed" }}
                  </span>
                </td>
                <td class="num mono">{{ fmt(table.rows) }}</td>
              </tr>
              <tr v-if="scanning">
                <td colspan="4" class="monthly-empty">Reading all records for {{ month }}…</td>
              </tr>
              <tr v-else-if="inventory.length === 0">
                <td colspan="4" class="monthly-empty">No backup preview loaded.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="monthly-note">
          <b>Safe, read-only backup.</b>
          การดาวน์โหลดไม่แก้ไขหรือลบข้อมูลในฐานข้อมูล ไฟล์จะรวมข้อมูลรายเดือนและ snapshot
          ของข้อมูลตั้งค่าหลัก แต่จะไม่รวมตาราง <span class="mono">users</span>
          เพื่อป้องกันบัญชีผู้ใช้และรหัสผ่าน
        </div>
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
.monthly-hero .mining-total {
  font-size: 19px;
}
.monthly-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
}
.monthly-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.monthly-field > span {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.monthly-picker {
  width: 180px;
  text-transform: none;
  letter-spacing: 0.04em;
}
.monthly-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.monthly-download {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border-color: var(--accent);
  background: var(--accent);
  color: #1a1206;
  font-weight: 700;
}
.monthly-download:hover:not(:disabled) {
  filter: brightness(1.06);
}
.monthly-error {
  color: #e06c6c;
}
.monthly-success {
  color: #39a96b;
}
.monthly-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.monthly-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  background: var(--panel-2);
  border: 1px solid var(--line-soft);
  border-radius: 7px;
}
.monthly-stat span {
  color: var(--ink-3);
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.monthly-stat b {
  color: var(--ink);
  font-size: 20px;
}
.monthly-table-wrap {
  overflow: auto;
}
.monthly-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.monthly-table thead th {
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
.monthly-table tbody td {
  padding: 9px 12px;
  border-bottom: 1px solid var(--line-soft);
  white-space: nowrap;
}
.monthly-table tbody tr:hover {
  background: var(--panel-2);
}
.monthly-table th.num,
.monthly-table td.num {
  text-align: right;
}
.monthly-table-name {
  color: var(--ink);
  font-weight: 600;
}
.monthly-status {
  display: inline-flex;
  padding: 3px 7px;
  border: 1px solid rgba(57, 169, 107, 0.35);
  border-radius: 999px;
  color: #39a96b;
  font-size: 10px;
}
.monthly-status.missing {
  border-color: rgba(224, 108, 108, 0.35);
  color: #e06c6c;
}
.monthly-empty {
  padding: 26px 12px !important;
  text-align: center;
  color: var(--ink-3);
  font-size: 12px;
}
.monthly-note {
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: 7px;
  background: var(--panel-2);
  color: var(--ink-2);
  font-size: 11px;
  line-height: 1.65;
}
.monthly-note b {
  color: var(--ink);
}

@media (max-width: 720px) {
  .monthly-actions {
    width: 100%;
    margin-left: 0;
  }
  .monthly-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
