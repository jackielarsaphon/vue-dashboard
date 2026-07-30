<script setup>
import { computed, ref, watchEffect } from "vue";
import { useTweaks } from "../composables/useTweaks.js";
import { useShiftSelection } from "../composables/useShiftSelection.js";
import { useAppAreas } from "../composables/useAppAreas.js";
import { useRainfallLog, periodLabel, rainMinutes, lostMinutes } from "../composables/useRainfallLog.js";
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
// its Rain duration / Lost time bar chart on the right.
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
        lost: acc.lost + lostMinutes(row),
        alerts: acc.alerts + (row.redAlert ? 1 : 0),
      }),
      { rain: 0, lost: 0, alerts: 0 },
    );
    return { name, color: PIT_COLORS[index % PIT_COLORS.length], rows, totals, chart: buildChart(rows) };
  });
});

const dayTotals = computed(() =>
  pits.value.reduce(
    (acc, pit) => ({ rain: acc.rain + pit.totals.rain, lost: acc.lost + pit.totals.lost, alerts: acc.alerts + pit.totals.alerts }),
    { rain: 0, lost: 0, alerts: 0 },
  ),
);

// --- chart ------------------------------------------------------------------
// Grouped bars per period: Rain duration (blue) beside Lost time (red). The
// viewBox grows with the number of periods and the SVG scales to the panel width,
// so a long rainy day stays readable instead of squashing into the same box.
const CHART = { H: 240, padT: 26, padR: 12, padB: 42, padL: 40, group: 92, gap: 10 };

function buildChart(rows) {
  const groups = rows.map((row) => ({
    period: periodLabel(row) || "—",
    rain: rainMinutes(row),
    lost: lostMinutes(row),
  }));
  const peak = groups.reduce((max, g) => Math.max(max, g.rain, g.lost), 0);
  // Round the axis up to the next 20 with headroom for the value labels, and never
  // flatten to zero when nothing was logged.
  const yMax = Math.max(20, Math.ceil((peak * 1.2) / 20) * 20);
  const plotW = Math.max(CHART.group * groups.length, 1);
  const W = CHART.padL + plotW + CHART.padR;
  const plotH = CHART.H - CHART.padT - CHART.padB;
  const baseY = CHART.padT + plotH;
  const barW = Math.min(26, (CHART.group - CHART.gap * 3) / 2);
  const y = (value) => baseY - (value / yMax) * plotH;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({ value: Math.round(yMax * fraction), y: baseY - plotH * fraction }));

  const bars = groups.map((group, index) => {
    const left = CHART.padL + CHART.group * index;
    const center = left + CHART.group / 2;
    return {
      key: `${group.period}-${index}`,
      period: group.period,
      center,
      rain: { x: center - barW - CHART.gap / 2, y: y(group.rain), h: baseY - y(group.rain), value: group.rain },
      lost: { x: center + CHART.gap / 2, y: y(group.lost), h: baseY - y(group.lost), value: group.lost },
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
      <div class="rr-summary-metrics">
        <div class="rr-metric">
          <b class="mono">{{ dateRows.length }}</b>
          <span>Rain records</span>
        </div>
        <div class="rr-metric">
          <b class="mono">{{ dayTotals.rain }}</b>
          <span>Rain duration (min)</span>
        </div>
        <div class="rr-metric">
          <b class="mono">{{ dayTotals.lost }}</b>
          <span>Lost time (min)</span>
        </div>
        <div class="rr-metric" :class="{ alert: dayTotals.alerts > 0 }">
          <b class="mono">{{ dayTotals.alerts }}</b>
          <span>Red alert</span>
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
                  <th>Rain Duration (Min)</th>
                  <th>Affect operation</th>
                  <th>Lost Time Operation (Min)</th>
                  <th>Red Alert</th>
                  <th class="rr-th-remark">Remark</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in pit.rows" :key="row.id">
                  <td class="mono">{{ periodLabel(row) || "—" }}</td>
                  <td class="mono num">{{ rainMinutes(row) }}</td>
                  <td :class="row.affectOpt ? 'rr-yes' : 'rr-no'">{{ row.affectOpt ? "YES" : "NO" }}</td>
                  <td class="mono num">{{ lostMinutes(row) }}</td>
                  <td :class="{ 'rr-yes': row.redAlert }">{{ row.redAlert ? "YES" : "" }}</td>
                  <td class="rr-remark">{{ row.remark }}</td>
                </tr>
                <tr v-if="pit.rows.length === 0">
                  <td class="rr-empty" colspan="6">No rainfall logged for this date.</td>
                </tr>
              </tbody>
              <tfoot v-if="pit.rows.length > 0">
                <tr>
                  <td class="rr-tf-label">Total</td>
                  <td class="mono num">{{ pit.totals.rain }}</td>
                  <td />
                  <td class="mono num">{{ pit.totals.lost }}</td>
                  <td class="mono num">{{ pit.totals.alerts }}</td>
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
                <span><span class="lg-dot ml" style="background: var(--alert)" />Lost Time Operation (Min)</span>
              </div>
            </div>

            <div v-if="pit.chart.empty" class="rr-chart-empty">No rainfall logged for this date.</div>
            <div v-else class="rr-chart-scroll">
              <svg :viewBox="`0 0 ${pit.chart.W} ${pit.chart.H}`" class="chart rr-chart" :style="{ minWidth: `${pit.chart.W}px` }">
                <g v-for="tick in pit.chart.ticks" :key="tick.value">
                  <line :x1="pit.chart.padL" :x2="pit.chart.W - pit.chart.padR" :y1="tick.y" :y2="tick.y" class="grid" />
                  <text :x="pit.chart.padL - 6" :y="tick.y + 3" class="axis" text-anchor="end">{{ tick.value }}</text>
                </g>
                <text :x="12" :y="pit.chart.H / 2" class="axis rr-axis-y" text-anchor="middle" :transform="`rotate(-90 12 ${pit.chart.H / 2})`">
                  Duration (Min)
                </text>

                <g v-for="bar in pit.chart.bars" :key="bar.key">
                  <rect :x="bar.rain.x" :y="bar.rain.y" :width="pit.chart.barW" :height="bar.rain.h" fill="var(--cool)" />
                  <rect :x="bar.lost.x" :y="bar.lost.y" :width="pit.chart.barW" :height="bar.lost.h" fill="var(--alert)" />
                  <text :x="bar.rain.x + pit.chart.barW / 2" :y="bar.rain.y - 5" class="bar-label mono" text-anchor="middle" fill="var(--cool)">
                    {{ bar.rain.value }}
                  </text>
                  <text :x="bar.lost.x + pit.chart.barW / 2" :y="bar.lost.y - 5" class="bar-label mono" text-anchor="middle" fill="var(--alert)">
                    {{ bar.lost.value }}
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
