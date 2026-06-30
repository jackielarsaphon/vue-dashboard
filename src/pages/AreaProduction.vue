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

const fmt = (n) => Math.round(Number(n)).toLocaleString("en-US");
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

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

    <TweaksPanel>
      <TweakSection label="Theme" />
      <TweakRadio label="Mode" :value="t.theme" :options="['dark', 'light']" @change="setTweak('theme', $event)" />
      <TweakColor label="Accent" :value="t.accent" :options="['#d99a00', '#22d3ee', '#a3e635', '#f472b6', '#fb7185']" @change="setTweak('accent', $event)" />
      <TweakSection label="Layout" />
      <TweakRadio label="Density" :value="t.density" :options="['compact', 'regular']" @change="setTweak('density', $event)" />
    </TweaksPanel>
  </div>
</template>
