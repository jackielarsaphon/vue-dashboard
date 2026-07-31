<script setup>
import { computed, ref, watchEffect } from "vue";
import { useTweaks } from "../composables/useTweaks.js";
import { useShiftSelection } from "../composables/useShiftSelection.js";
import { useAppAreas } from "../composables/useAppAreas.js";
import { useRainfallLog, periodLabel, rainMinutes, redAlertMinutes } from "../composables/useRainfallLog.js";
import { useLiveRefresh } from "../composables/useLiveRefresh.js";
import { useDownloadImage } from "../composables/useDownloadImage.js";
import TopBar from "../components/common/TopBar.vue";
import DownloadImageButton from "../components/common/DownloadImageButton.vue";
import TweaksPanel from "../components/common/TweaksPanel.vue";
import TweakSection from "../components/common/TweakSection.vue";
import TweakRadio from "../components/common/TweakRadio.vue";
import TweakColor from "../components/common/TweakColor.vue";

// Rainfall dashboard — the read-only report of what Data entry step 3 logged, one
// block per pit for the selected DATE (both shifts): the sheet's table on the left,
// its Rain duration / Red alert duration bar chart on the right.
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

const { selection } = useShiftSelection();
const { areas: appAreas } = useAppAreas();
const { rowsForDate, reload: reloadRainfall } = useRainfallLog();

// Pick up rain logged on another device (e.g. a phone in the pit) without a reload.
useLiveRefresh([reloadRainfall]);

const { dashRef, downloading, downloadImage } = useDownloadImage(() => `rainfall-${selection.date}.png`);
// The .xlsx of the same data is offered where it's keyed — Data entry step 3 —
// rather than a second time here.

const dateLabel = computed(() => {
  const [y, m, d] = String(selection.date).split("-");
  return d && m && y ? `${Number(d)}/${Number(m)}/${y}` : selection.date;
});
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const clockDate = computed(() => {
  const [y, m, d] = String(selection.date).split("-");
  const month = MONTHS[Number(m) - 1];
  return d && month && y ? `${Number(d)} ${month}` : "";
});
// Follows the top bar's HOUR box, same as the Fleet / Area clock cards — the fixed
// shift window it used to show never moved when the selection did.
const clockRange = computed(() => {
  const a = String(selection.hour).padStart(2, "0");
  const b = String((selection.hour + 1) % 24).padStart(2, "0");
  return `${a}:00-${b}:00`;
});

// Each pit gets its own header colour, cycling this palette — the sheet colours the
// first pit's header dark red and the second gold. Theme variables, so both themes work.
const PIT_COLORS = ["var(--alert)", "var(--accent)", "var(--cool)", "var(--ok)", "var(--waste)"];

const dateRows = computed(() => rowsForDate(selection.date));

// One block per pit: every App Area (so a dry pit still reports "no rainfall"), plus
// any area name found in the data that is no longer in the master — nothing logged
// is ever hidden from the report.
const pits = computed(() => {
  const fromData = Array.from(new Set(dateRows.value.map((row) => row.areaCode).filter(Boolean)));
  const names = [...appAreas.value, ...fromData.filter((name) => !appAreas.value.includes(name))];
  return names.map((name, index) => {
    const rows = dateRows.value.filter((row) => row.areaCode === name);
    const totals = rows.reduce(
      (acc, row) => ({
        rain: acc.rain + rainMinutes(row),
        alertDuration: acc.alertDuration + redAlertMinutes(row),
      }),
      { rain: 0, alertDuration: 0 },
    );
    return { name, color: PIT_COLORS[index % PIT_COLORS.length], rows, totals, chart: buildChart(rows) };
  });
});

// --- chart ------------------------------------------------------------------
// Grouped bars per period: Rain duration (blue) beside Red alert duration (red). The viewBox
// grows with the number of periods, so a long rainy day stays readable instead of
// squashing into the same box; a short one stretches to MIN_PLOT instead so the
// drawing fills the panel rather than floating as a small block in the middle.
const CHART = { H: 240, padT: 26, padR: 12, padB: 42, padL: 40, group: 92, gap: 10, minPlot: 560 };

function buildChart(rows) {
  const groups = rows.map((row) => ({
    period: periodLabel(row) || "—",
    rain: rainMinutes(row),
    alert: redAlertMinutes(row),
  }));
  const peak = groups.reduce((max, g) => Math.max(max, g.rain, g.alert), 0);
  // Round the axis up to the next 20 with headroom for the value labels, and never
  // flatten to zero when nothing was logged.
  const yMax = Math.max(20, Math.ceil((peak * 1.2) / 20) * 20);
  const plotW = Math.max(CHART.group * groups.length, CHART.minPlot);
  const W = CHART.padL + plotW + CHART.padR;
  const plotH = CHART.H - CHART.padT - CHART.padB;
  const baseY = CHART.padT + plotH;
  // Each period gets an equal slice of the plot; the pair of bars sits in the middle
  // of its slice, widening with it (up to a limit) so a two-period day doesn't read
  // as two hairlines lost in the panel.
  const groupW = plotW / Math.max(1, groups.length);
  const barW = Math.max(14, Math.min(44, (groupW - CHART.gap * 3) / 2));
  const y = (value) => baseY - (value / yMax) * plotH;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({ value: Math.round(yMax * fraction), y: baseY - plotH * fraction }));

  const bars = groups.map((group, index) => {
    const left = CHART.padL + groupW * index;
    const center = left + groupW / 2;
    return {
      key: `${group.period}-${index}`,
      period: group.period,
      center,
      rain: { x: center - barW - CHART.gap / 2, y: y(group.rain), h: baseY - y(group.rain), value: group.rain },
      alert: { x: center + CHART.gap / 2, y: y(group.alert), h: baseY - y(group.alert), value: group.alert },
    };
  });

  return { W, H: CHART.H, padL: CHART.padL, padR: CHART.padR, baseY, barW, ticks, bars, empty: groups.length === 0 };
}
</script>

<template>
  <div ref="dashRef" class="dash rain-dash">
    <TopBar subtitle="Rainfall" />

    <div class="dash-toolbar no-capture">
      <DownloadImageButton :downloading="downloading" @click="downloadImage" />
    </div>

    <section class="rr-summary panel">
      <div class="rr-summary-id">
        <h1>Rainfall record</h1>
        <span class="rr-summary-sub mono">Date : {{ dateLabel }}</span>
      </div>
      <div class="kpi kpi-unified rr-summary-clock">
        <div class="kpi-cell kpi-cell-clock">
          <span class="kpi-cell-date">{{ clockDate }}</span>
          <span class="kpi-cell-hour mono">{{ clockRange }}</span>
        </div>
      </div>
    </section>

    <main class="rr-pits">
      <section v-for="pit in pits" :key="pit.name" class="rr-pit">
        <header class="rr-pit-head">
          <h2>{{ pit.name }}</h2>
          <span class="rr-pit-date mono">Date : {{ dateLabel }}</span>
        </header>

        <div class="rr-pit-body">
          <div class="rr-table-wrap">
            <table class="rr-table">
              <thead>
                <tr :style="{ background: pit.color }">
                  <th>Period</th>
                  <th>Rainfall Intensity</th>
                  <th>Rain Duration (Min)</th>
                  <th>Red Alert</th>
                  <th>Red Alert Duration (Min)</th>
                  <th>Affect operation</th>
                  <th class="rr-th-remark">Remark</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in pit.rows" :key="row.id">
                  <td class="mono">{{ periodLabel(row) || "—" }}</td>
                  <td class="rr-intensity" :class="`is-${String(row.intensity || 'clear').toLowerCase()}`">{{ row.intensity || "Clear" }}</td>
                  <td class="mono num">{{ rainMinutes(row) }}</td>
                  <td :class="{ 'rr-yes': row.redAlert }">{{ row.redAlert ? "YES" : "" }}</td>
                  <td class="mono num">{{ redAlertMinutes(row) }}</td>
                  <td :class="row.affectOpt ? 'rr-yes' : 'rr-no'">{{ row.affectOpt ? "YES" : "NO" }}</td>
                  <td class="rr-remark">{{ row.remark }}</td>
                </tr>
                <tr v-if="pit.rows.length === 0">
                  <td class="rr-empty" colspan="7">No rainfall logged for this date.</td>
                </tr>
              </tbody>
              <tfoot v-if="pit.rows.length > 0">
                <tr>
                  <td class="rr-tf-label">Total</td>
                  <td />
                  <td class="mono num">{{ pit.totals.rain }}</td>
                  <td />
                  <td class="mono num">{{ pit.totals.alertDuration }}</td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div class="panel rr-chart-panel">
            <div class="panel-head rr-chart-head">
              <h2>Rainfall Record {{ pit.name }}</h2>
              <div class="legend mono">
                <span><span class="lg-dot" style="background: var(--cool)" />Rain Duration (Min)</span>
                <span><span class="lg-dot ml" style="background: var(--alert)" />Red Alert Duration (Min)</span>
              </div>
            </div>

            <div v-if="pit.chart.empty" class="rr-chart-empty">No rainfall logged for this date.</div>
            <div v-else class="rr-chart-scroll">
              <svg
                :viewBox="`0 0 ${pit.chart.W} ${pit.chart.H}`"
                class="chart rr-chart"
                preserveAspectRatio="xMinYMid meet"
                :style="{ minWidth: `${pit.chart.W}px` }"
              >
                <g v-for="tick in pit.chart.ticks" :key="tick.value">
                  <line :x1="pit.chart.padL" :x2="pit.chart.W - pit.chart.padR" :y1="tick.y" :y2="tick.y" class="grid" />
                  <text :x="pit.chart.padL - 6" :y="tick.y + 3" class="axis" text-anchor="end">{{ tick.value }}</text>
                </g>
                <text :x="12" :y="pit.chart.H / 2" class="axis rr-axis-y" text-anchor="middle" :transform="`rotate(-90 12 ${pit.chart.H / 2})`">
                  Duration (Min)
                </text>

                <g v-for="bar in pit.chart.bars" :key="bar.key">
                  <rect :x="bar.rain.x" :y="bar.rain.y" :width="pit.chart.barW" :height="bar.rain.h" fill="var(--cool)" />
                  <rect :x="bar.alert.x" :y="bar.alert.y" :width="pit.chart.barW" :height="bar.alert.h" fill="var(--alert)" />
                  <text :x="bar.rain.x + pit.chart.barW / 2" :y="bar.rain.y - 5" class="bar-label mono" text-anchor="middle" fill="var(--cool)">
                    {{ bar.rain.value }}
                  </text>
                  <text :x="bar.alert.x + pit.chart.barW / 2" :y="bar.alert.y - 5" class="bar-label mono" text-anchor="middle" fill="var(--alert)">
                    {{ bar.alert.value }}
                  </text>
                  <text :x="bar.center" :y="pit.chart.baseY + 16" class="axis mono" text-anchor="middle">{{ bar.period }}</text>
                </g>
                <line :x1="pit.chart.padL" :x2="pit.chart.W - pit.chart.padR" :y1="pit.chart.baseY" :y2="pit.chart.baseY" class="grid" />
                <text :x="pit.chart.W / 2" :y="pit.chart.H - 8" class="axis-x" text-anchor="middle">Period</text>
              </svg>
            </div>
          </div>
        </div>
      </section>

      <p v-if="pits.length === 0" class="rr-none">
        No pit defined yet. Add one on Settings → App Area, then log rain in Data entry step 3.
      </p>
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
