<script setup>
import { computed, watchEffect } from "vue";
import { useTweaks } from "../composables/useTweaks.js";
import { useShiftSelection } from "../composables/useShiftSelection.js";
import { useEntryStore, rowTonnes } from "../composables/useEntryStore.js";
import { usePlanProduction } from "../composables/usePlanProduction.js";
import { useLiveRefresh } from "../composables/useLiveRefresh.js";
import TopBar from "../components/common/TopBar.vue";
import TweaksPanel from "../components/common/TweaksPanel.vue";
import TweakSection from "../components/common/TweakSection.vue";
import TweakRadio from "../components/common/TweakRadio.vue";
import TweakColor from "../components/common/TweakColor.vue";
import TweakSelect from "../components/common/TweakSelect.vue";

const fmt = (n) => Math.round(Number(n)).toLocaleString("en-US");
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

// Status of an area vs its full-day plan, used for both the per-card colour and
// the "on plan / at risk / behind" board tally:
//   • on plan  (ok)    — actual ≥ 100% of plan, OR there's no plan to miss (≤ 0)
//   • at risk  (warn)  — 85–99% of plan
//   • behind   (alert) — < 85% of plan
const statusFor = (actual, target) => {
  if (target <= 0) return "ok";
  const p = (actual / target) * 100;
  if (p >= 100) return "ok";
  if (p >= 85) return "warn";
  return "alert";
};

const [t, setTweak] = useTweaks({
  accent: "#d99a00",
  density: "compact",
  theme: "light",
  sortBy: "deficit",
});

watchEffect(() => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = t.theme;
  document.documentElement.dataset.density = t.density;
  document.documentElement.style.setProperty("--accent", t.accent);
});

const PERIOD_LABELS = [
  "00:00 - 03:00",
  "03:00 - 06:00",
  "06:00 - 09:00",
  "09:00 - 12:00",
  "12:00 - 15:00",
  "15:00 - 18:00",
  "18:00 - 21:00",
  "21:00 - 00:00",
];

const { selection } = useShiftSelection();
const { areas, getBucket, reload: reloadEntries } = useEntryStore();
const { getDatePlans, reloadPlans } = usePlanProduction();

// Pick up production entered on another device (e.g. a phone) without a manual
// reload: re-fetch on tab focus / visibility and every 30s.
useLiveRefresh([reloadEntries, reloadPlans]);

// PLAN per area = the daily Plan Production total (Waste + Ore) for the selected
// date — the same figure entered on Data entry and shown on Fleet overview. The
// plan is genuinely per-day now; an area with no plan that day reads 0 (instead
// of the old static area_targets / constant fallback that was equal every day).
const dailyAreaPlan = computed(() => {
  const plans = getDatePlans(selection.date);
  const byArea = {};
  Object.entries(plans).forEach(([code, { soil, ore }]) => {
    byArea[code] = (byArea[code] || 0) + (Number(soil) || 0) + (Number(ore) || 0);
  });
  return byArea;
});

// Tonnes per area per calendar hour (0-23), summed across both shifts, for the
// selected date. Each row is converted with its truck model's own factor.
const hourlyAreaTonnes = computed(() => {
  const byArea = new Map();
  areas.value.forEach((area) => {
    byArea.set(area, Array(24).fill(0));
  });
  ["Day", "Night"].forEach((shiftType) => {
    for (let hour = 0; hour < 24; hour += 1) {
      const bucket = getBucket(selection.date, shiftType, hour);
      // Each entry carries its pit (entry.area), so trips land in the right pit.
      Object.values(bucket).forEach((entry) => {
        const tonnes = byArea.get(entry.area);
        if (!tonnes) return;
        tonnes[hour] += entry.rows.reduce((sum, row) => sum + rowTonnes(row), 0);
      });
    }
  });
  return byArea;
});

// Cumulative tonnes by 3-hour period, for the selected date: [0, p1, p2, ..., p8].
const areaSeries = computed(() =>
  Array.from(hourlyAreaTonnes.value.entries()).map(([area, hourlyTonnes]) => {
    const actual = [0];
    let running = 0;
    for (let period = 0; period < 8; period += 1) {
      const startHour = period * 3;
      for (let hour = startHour; hour < startHour + 3; hour += 1) running += hourlyTonnes[hour];
      actual.push(running);
    }
    return { area, target: dailyAreaPlan.value[area] ?? 0, actual };
  }),
);

const EMPTY_AREA = { area: "-", target: 0, actual: [0], delta: 0 };

const totalTarget = computed(() => areaSeries.value.reduce((sum, area) => sum + area.target, 0));
const totalActual = computed(() => areaSeries.value.reduce((sum, area) => sum + area.actual.at(-1), 0));
const achievement = computed(() => pct(totalActual.value, totalTarget.value));
const ahead = computed(() => areaSeries.value.filter((area) => area.actual.at(-1) >= area.target).length);
const behind = computed(() => areaSeries.value.length - ahead.value);
const bestArea = computed(
  () =>
    areaSeries.value
      .map((area) => ({ ...area, delta: area.actual.at(-1) - area.target }))
      .sort((a, b) => b.delta - a.delta)[0] ?? EMPTY_AREA,
);
const worstArea = computed(
  () =>
    areaSeries.value
      .map((area) => ({ ...area, delta: area.actual.at(-1) - area.target }))
      .sort((a, b) => a.delta - b.delta)[0] ?? EMPTY_AREA,
);

const statusCounts = computed(() => {
  const counts = { ok: 0, warn: 0, alert: 0 };
  areaSeries.value.forEach((series) => {
    counts[statusFor(series.actual.at(-1), series.target)] += 1;
  });
  return counts;
});

const linePath = (points) => points.map((point, i) => `${i ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");

const areaCards = computed(() => {
  const labels = PERIOD_LABELS;
  const n = labels.length;
  const sorted = [...areaSeries.value];

  if (t.sortBy === "deficit") {
    sorted.sort((a, b) => a.actual.at(-1) - a.target - (b.actual.at(-1) - b.target));
  } else if (t.sortBy === "achievement") {
    sorted.sort((a, b) => b.actual.at(-1) / b.target - a.actual.at(-1) / a.target);
  } else if (t.sortBy === "size") {
    sorted.sort((a, b) => b.target - a.target);
  } else {
    sorted.sort((a, b) => a.area.localeCompare(b.area));
  }

  return sorted.map((series) => {
    const planCum = Array.from({ length: n + 1 }, (_, i) => (series.target / n) * i);
    const actualCum = series.actual;
    const finalActual = actualCum.at(-1);
    // No plan (target ≤ 0) can't be measured as a %, so show it as 100% on-plan.
    const cardAchievement = series.target > 0 ? pct(finalActual, series.target) : 100;
    const delta = finalActual - series.target;
    const status = statusFor(finalActual, series.target);
    const W = 260;
    const H = 56;
    const max = Math.max(...planCum, ...actualCum) * 1.05 || 1;
    const xAt = (i) => (W / n) * i;
    const yAt = (value) => H - (value / max) * (H - 2) - 1;
    const planPoints = planCum.map((value, i) => ({ x: xAt(i), y: yAt(value) }));
    const actualPoints = actualCum.map((value, i) => ({ x: xAt(i), y: yAt(value) }));
    const plan = linePath(planPoints);
    const actual = linePath(actualPoints);
    const reversedPlan = [...planPoints].reverse().map((point) => `L${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    const diffArea = `${actual} ${reversedPlan} Z`;
    const currentPoint = actualPoints.at(-1);
    const periods = labels.map((label, i) => {
      const actualPeriod = actualCum[i + 1];
      const planPeriod = planCum[i + 1];
      let periodStatus = "future";
      if (actualPeriod != null) {
        periodStatus = actualPeriod >= planPeriod ? "ok" : actualPeriod >= planPeriod * 0.85 ? "warn" : "alert";
      }
      return { label, hour: parseInt(label.slice(0, 2), 10), status: periodStatus };
    });

    return {
      ...series,
      W,
      H,
      finalActual,
      achievement: cardAchievement,
      delta,
      status,
      plan,
      actual,
      diffArea,
      fillColor: finalActual >= planCum.at(-1) ? "var(--ok)" : "var(--alert)",
      currentPoint,
      periods,
    };
  });
});
</script>

<template>
  <div class="dash">
    <TopBar subtitle="Daily" />

    <section class="kpi-strip area-kpi">
      <div class="kpi kpi-prod">
        <div class="kpi-head">
          <span class="kpi-label">Total - Daily Actual</span>
          <span class="kpi-pct mono">{{ achievement }}%</span>
        </div>
        <div class="kpi-main">
          <div>
            <div class="kpi-big mono">{{ fmt(totalActual) }}</div>
            <div class="kpi-unit">Tonnes - {{ areaSeries.length }} areas</div>
          </div>
        </div>
        <div class="kpi-bar">
          <div class="kpi-bar-fill" :style="{ width: `${Math.min(100, achievement)}%`, background: 'var(--accent)' }" />
        </div>
        <div class="kpi-foot mono">Plan {{ fmt(totalTarget) }}t</div>
      </div>

      <div class="kpi kpi-waste">
        <div class="kpi-head"><span class="kpi-label">On / Above plan</span></div>
        <div class="kpi-main">
          <div>
            <div class="kpi-big mono">{{ ahead }}<span class="kpi-of">/{{ areaSeries.length }}</span></div>
            <div class="kpi-unit">Areas hit target</div>
          </div>
          <div class="kpi-side">
            <div class="kpi-trip mono">{{ behind }}</div>
            <div class="kpi-unit">Behind</div>
          </div>
        </div>
      </div>

      <div class="kpi kpi-ore">
        <div class="kpi-head"><span class="kpi-label">Best area - vs plan</span></div>
        <div class="kpi-main">
          <div>
            <div class="kpi-big mono">{{ bestArea.area }}</div>
            <div class="kpi-unit">Leading</div>
          </div>
          <div class="kpi-side">
            <div class="kpi-trip mono accent">{{ bestArea.delta >= 0 ? "+ " : "- " }}{{ fmt(Math.abs(bestArea.delta)) }}</div>
            <div class="kpi-unit">Tonnes</div>
          </div>
        </div>
      </div>

      <div class="kpi kpi-fleet">
        <div class="kpi-head"><span class="kpi-label">Worst area - vs plan</span></div>
        <div class="kpi-main">
          <div>
            <div class="kpi-big mono">{{ worstArea.area }}</div>
            <div class="kpi-unit">Lagging</div>
          </div>
          <div class="kpi-side">
            <div class="kpi-trip mono" style="color: var(--alert)">{{ fmt(worstArea.delta) }}</div>
            <div class="kpi-unit">Tonnes</div>
          </div>
        </div>
      </div>
    </section>

    <div class="status-board-head">
      <h2 class="board-h">Area status board</h2>
      <div class="board-legend">
        <span class="lg-pill lg-ok">{{ statusCounts.ok }} on plan</span>
        <span class="lg-pill lg-warn">{{ statusCounts.warn }} at risk</span>
        <span class="lg-pill lg-alert">{{ statusCounts.alert }} behind</span>
      </div>
    </div>

    <main v-if="areaCards.length" class="area-grid">
      <div v-for="series in areaCards" :key="series.area" class="area-tile" :class="`area-tile-${series.status}`">
        <div class="area-tile-bar" />
        <div class="area-tile-body">
          <div class="area-tile-head">
            <div class="area-tile-id">
              <span class="area-tile-dot" />
              <h2>{{ series.area }}</h2>
            </div>
            <div class="area-tile-pct mono" :class="`ach-${series.status}`">
              {{ series.achievement }}<span class="pct-sign">%</span>
            </div>
          </div>

          <div class="area-tile-numbers">
            <div class="num-block">
              <span class="num-k">Actual</span>
              <span class="num-v mono">{{ fmt(series.finalActual) }}<span class="num-u">t</span></span>
            </div>
            <div class="num-block">
              <span class="num-k">Plan</span>
              <span class="num-v mono num-v-soft">{{ fmt(series.target) }}<span class="num-u">t</span></span>
            </div>
            <div class="num-block num-block-delta">
              <span class="num-k">vs plan</span>
              <span class="num-v mono" :class="series.delta >= 0 ? 'pos' : 'neg'">
                {{ series.delta >= 0 ? "+ " : "- " }}{{ fmt(Math.abs(series.delta)) }}<span class="num-u">t</span>
              </span>
            </div>
          </div>

          <svg :viewBox="`0 0 ${series.W} ${series.H}`" class="spark" preserveAspectRatio="none">
            <path :d="series.diffArea" :fill="series.fillColor" opacity="0.14" />
            <path :d="series.plan" class="plan-line" />
            <path :d="series.actual" class="actual-line" :style="{ stroke: `var(--${series.status === 'alert' ? 'alert' : series.status === 'warn' ? 'warn' : 'ok'})` }" />
            <circle
              :cx="series.currentPoint.x"
              :cy="series.currentPoint.y"
              r="2.5"
              :fill="`var(--${series.status === 'alert' ? 'alert' : series.status === 'warn' ? 'warn' : 'ok'})`"
            />
          </svg>

          <div class="period-dots">
            <div v-for="period in series.periods" :key="period.label" class="pd-cell" :class="`pd-${period.status}`" :title="period.label">
              <div class="pd-bar" />
              <div class="pd-hour mono">{{ period.hour }}</div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <section v-else class="area-empty panel">
      <h2>No area data for this date</h2>
      <p>Add mining areas and excavators in Data entry before this dashboard creates area cards.</p>
    </section>

    <TweaksPanel>
      <TweakSection label="Theme" />
      <TweakRadio label="Mode" :value="t.theme" :options="['dark', 'light']" @change="setTweak('theme', $event)" />
      <TweakColor label="Accent" :value="t.accent" :options="['#d99a00', '#22d3ee', '#a3e635', '#f472b6', '#fb7185']" @change="setTweak('accent', $event)" />
      <TweakSection label="Layout" />
      <TweakSelect label="Sort by" :value="t.sortBy" :options="['deficit', 'achievement', 'size', 'alpha']" @change="setTweak('sortBy', $event)" />
      <TweakRadio label="Density" :value="t.density" :options="['compact', 'regular']" @change="setTweak('density', $event)" />
    </TweaksPanel>
  </div>
</template>
