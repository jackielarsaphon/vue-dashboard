<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import { useShiftSelection } from "../../composables/useShiftSelection.js";
import { useEntryStore, rowTonnes } from "../../composables/useEntryStore.js";
import { usePlanProduction } from "../../composables/usePlanProduction.js";

// Whole numbers only — truncate, never round up (matches the dashboard formatting).
const fmt = (n) => Math.trunc(Number(n) || 0).toLocaleString("en-US");
const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

const { selection } = useShiftSelection();
const { areaExcavators, getBucket } = useEntryStore();
const { getDatePlans, planTonnesForDate } = usePlanProduction();

// Day vs Night TONNES per area for the selected date, one column per pit that has a
// placed excavator. Tonnes so the bars line up with the per-pit Plan Production
// column (the cream shadow) and the Total Production figure.
const areasByShift = computed(() => {
  const plans = getDatePlans(selection.date);
  const planTotal = (area) => {
    const p = plans[area];
    return p ? p.soil + p.ore : 0;
  };
  const byArea = new Map();
  areaExcavators.value.forEach((placement) => {
    if (!placement.area) return;
    if (!byArea.has(placement.area)) byArea.set(placement.area, { area: placement.area, day: 0, night: 0, plan: planTotal(placement.area) });
  });
  ["Day", "Night"].forEach((shiftType) => {
    for (let hour = 0; hour < 24; hour += 1) {
      const bucket = getBucket(selection.date, shiftType, hour);
      // Each entry carries its own pit (entry.area), so trips land in the pit they
      // were logged for — the same excavator's trips split correctly across pits.
      Object.values(bucket).forEach((entry) => {
        const stat = byArea.get(entry.area);
        if (!stat) return;
        const tonnes = entry.rows.reduce((sum, row) => sum + rowTonnes(row), 0);
        stat[shiftType === "Day" ? "day" : "night"] += tonnes;
      });
    }
  });
  return Array.from(byArea.values()).sort((a, b) => b.day + b.night - (a.day + a.night));
});

// padL leaves room for the y-axis labels, which grow to 6–7 digits once the bars
// use real tonnes.
const shiftAreaChart = { H: 320, padL: 54, padR: 10, padT: 20, padB: 34 };
// The chart FILLS the panel width: each pit column widens to share whatever space
// is available. Only once there are enough pits that a MIN column width no longer
// fits does it stop shrinking and scroll horizontally instead.
const MIN_COL_W = 92;
const scrollEl = ref(null);
const containerW = ref(0);
let resizeObs = null;
const naturalW = computed(() => shiftAreaChart.padL + shiftAreaChart.padR + Math.max(1, areasByShift.value.length) * MIN_COL_W);
const shiftAreaW = computed(() => Math.max(naturalW.value, containerW.value || naturalW.value));
const shiftAreaYMax = computed(() => {
  const max = Math.max(1, ...areasByShift.value.map((item) => Math.max(item.day + item.night, item.plan)));
  const step = max > 20000 ? 10000 : max > 4000 ? 5000 : max > 2000 ? 1000 : 500;
  return Math.ceil(max / step) * step;
});
const shiftAreaTicks = computed(() => [0, 0.25, 0.5, 0.75, 1].map((factor) => Math.round(shiftAreaYMax.value * factor)));
const shiftAreaY = (value) => {
  const { H, padT, padB } = shiftAreaChart;
  return padT + (H - padT - padB) * (1 - value / shiftAreaYMax.value);
};
const shiftAreaBars = computed(() => {
  const { padL, padR } = shiftAreaChart;
  const W = shiftAreaW.value;
  const cw = (W - padL - padR) / Math.max(1, areasByShift.value.length);
  const bw = cw * 0.64;
  const baseY = shiftAreaY(0);
  return areasByShift.value.map((item, i) => {
    const cx = padL + i * cw + cw / 2;
    return {
      ...item,
      cx,
      bw,
      x: cx - bw / 2,
      baseY,
      dayH: baseY - shiftAreaY(item.day),
      nightH: baseY - shiftAreaY(item.night),
      planY: shiftAreaY(item.plan),
      stackTopY: shiftAreaY(item.day + item.night),
      sum: item.day + item.night,
    };
  });
});

// Tap/hover a column to reveal a tooltip with both shifts' numbers.
const activeShiftArea = ref(null);
const toggleShiftArea = (area) => {
  activeShiftArea.value = activeShiftArea.value === area ? null : area;
};
const shiftAreaTip = computed(() => {
  const bar = shiftAreaBars.value.find((item) => item.area === activeShiftArea.value);
  if (!bar) return null;
  const { padR, padL } = shiftAreaChart;
  const W = shiftAreaW.value;
  const tw = 116;
  const th = 78;
  const x = Math.min(Math.max(bar.cx - tw / 2, padL), W - padR - tw);
  const y = Math.max(shiftAreaChart.padT, bar.stackTopY - th - 8);
  return { ...bar, x, y, tw, th };
});

// Footer: total actual tonnes for the date (every area, both shifts) vs the day's
// Plan Production total.
const totalActual = computed(() => {
  let sum = 0;
  ["Day", "Night"].forEach((shiftType) => {
    for (let hour = 0; hour < 24; hour += 1) {
      const bucket = getBucket(selection.date, shiftType, hour);
      Object.values(bucket).forEach((entry) => {
        sum += entry.rows.reduce((s, row) => s + rowTonnes(row), 0);
      });
    }
  });
  return sum;
});
const totalPlan = computed(() => planTonnesForDate(selection.date));
const planPct = computed(() => pct(totalActual.value, totalPlan.value));

// Track the scroll container's inner width so the chart can fill it.
onMounted(() => {
  if (!scrollEl.value || typeof ResizeObserver === "undefined") return;
  const measure = () => {
    containerW.value = Math.round(scrollEl.value?.clientWidth || 0);
  };
  resizeObs = new ResizeObserver(measure);
  resizeObs.observe(scrollEl.value);
  measure();
});
onBeforeUnmount(() => {
  if (resizeObs) {
    resizeObs.disconnect();
    resizeObs = null;
  }
});
</script>

<template>
  <div class="panel shift-panel">
    <div class="bytype">
      <div class="bytype-head">
        <span class="bytype-title">Production by shift - area</span>
        <span class="legend mono">
          <span class="lg-dot" style="background: var(--day)" />Day
          <span class="lg-dot ml" style="background: var(--night)" />Night
        </span>
      </div>
      <div ref="scrollEl" class="shift-area-scroll">
        <svg :viewBox="`0 0 ${shiftAreaW} ${shiftAreaChart.H}`" :style="{ width: shiftAreaW + 'px' }" class="chart shift-area-chart">
          <g v-for="tick in shiftAreaTicks" :key="tick">
            <line :x1="shiftAreaChart.padL" :x2="shiftAreaW - shiftAreaChart.padR" :y1="shiftAreaY(tick)" :y2="shiftAreaY(tick)" class="grid" />
            <text :x="shiftAreaChart.padL - 7" :y="shiftAreaY(tick) + 3" class="axis mono tiny" text-anchor="end">{{ fmt(tick) }}</text>
          </g>
          <g
            v-for="bar in shiftAreaBars"
            :key="bar.area"
            class="shift-area-col"
            :class="{ active: activeShiftArea === bar.area }"
            @click="toggleShiftArea(bar.area)"
            @mouseenter="activeShiftArea = bar.area"
            @mouseleave="activeShiftArea = null"
          >
            <!-- Plan column (cream) behind -->
            <rect :x="bar.x" :y="bar.planY" :width="bar.bw" :height="bar.baseY - bar.planY" class="plan-col" />
            <!-- Actual: Day (bottom) + Night (top) -->
            <rect :x="bar.x" :y="bar.baseY - bar.dayH" :width="bar.bw" :height="bar.dayH" fill="var(--day)" />
            <rect :x="bar.x" :y="bar.stackTopY" :width="bar.bw" :height="bar.nightH" fill="var(--night)" />
            <text v-if="bar.dayH > 14" :x="bar.cx" :y="bar.baseY - bar.dayH / 2 + 3" class="seg-label mono on-day" text-anchor="middle">{{ fmt(bar.day) }}</text>
            <!-- Night value sits INSIDE its own (blue) segment -->
            <text v-if="bar.night && bar.nightH > 14" :x="bar.cx" :y="bar.stackTopY + bar.nightH / 2 + 3" class="seg-label mono on-night" text-anchor="middle">{{ fmt(bar.night) }}</text>
            <!-- Total (Day + Night) on top of the stack -->
            <text v-if="bar.sum" :x="bar.cx" :y="bar.stackTopY - 4" class="seg-label mono total" text-anchor="middle">{{ fmt(bar.sum) }}</text>
            <text :x="bar.cx" :y="bar.baseY + 16" class="col-label mono" text-anchor="middle">{{ bar.area }}</text>
            <!-- Full-height hit area so the whole column responds to taps -->
            <rect :x="bar.x - 4" :y="shiftAreaChart.padT" :width="bar.bw + 8" :height="bar.baseY - shiftAreaChart.padT" fill="transparent" />
          </g>
          <!-- Tooltip with both shifts' numbers -->
          <g v-if="shiftAreaTip" class="shift-area-tip" pointer-events="none">
            <rect :x="shiftAreaTip.x" :y="shiftAreaTip.y" :width="shiftAreaTip.tw" :height="shiftAreaTip.th" rx="4" class="tip-box" />
            <text :x="shiftAreaTip.x + 8" :y="shiftAreaTip.y + 15" class="tip-title mono">{{ shiftAreaTip.area }}</text>
            <line :x1="shiftAreaTip.x + 8" :x2="shiftAreaTip.x + shiftAreaTip.tw - 8" :y1="shiftAreaTip.y + 21" :y2="shiftAreaTip.y + 21" class="grid" />
            <circle :cx="shiftAreaTip.x + 12" :cy="shiftAreaTip.y + 32" r="3" fill="var(--day)" />
            <text :x="shiftAreaTip.x + 20" :y="shiftAreaTip.y + 35" class="tip-row mono">Day</text>
            <text :x="shiftAreaTip.x + shiftAreaTip.tw - 8" :y="shiftAreaTip.y + 35" class="tip-val mono" text-anchor="end">{{ fmt(shiftAreaTip.day) }}</text>
            <circle :cx="shiftAreaTip.x + 12" :cy="shiftAreaTip.y + 46" r="3" fill="var(--night)" />
            <text :x="shiftAreaTip.x + 20" :y="shiftAreaTip.y + 49" class="tip-row mono">Night</text>
            <text :x="shiftAreaTip.x + shiftAreaTip.tw - 8" :y="shiftAreaTip.y + 49" class="tip-val mono" text-anchor="end">{{ fmt(shiftAreaTip.night) }}</text>
            <text :x="shiftAreaTip.x + 20" :y="shiftAreaTip.y + 64" class="tip-row mono strong">Total</text>
            <text :x="shiftAreaTip.x + shiftAreaTip.tw - 8" :y="shiftAreaTip.y + 64" class="tip-val mono strong" text-anchor="end">{{ fmt(shiftAreaTip.sum) }}</text>
          </g>
        </svg>
      </div>
    </div>

    <div class="shift-divider" />

    <div class="shift-footer">
      <div class="sf-cell">
        <span class="bk-k">Total - 24h</span>
        <span class="sf-v mono accent">{{ fmt(totalActual) }}</span>
      </div>
      <div class="sf-cell">
        <span class="bk-k">vs plan</span>
        <span class="sf-v mono" :class="planPct >= 100 ? 'pos' : 'warn'">{{ planPct }}%</span>
      </div>
      <div class="sf-cell">
        <span class="bk-k">Plan</span>
        <span class="sf-v mono">{{ fmt(totalPlan) }}</span>
      </div>
    </div>
  </div>
</template>
