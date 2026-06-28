<script setup>
import { computed, ref, watchEffect } from "vue";
import { useAreaTargets } from "../composables/useAreaTargets.js";
import { useTweaks } from "../composables/useTweaks.js";
import { useShiftSelection } from "../composables/useShiftSelection.js";
import { useEntryStore, isWaste, rowTotal, rowTonnes, BCM_PER_TRIP } from "../composables/useEntryStore.js";
import { usePlanProduction } from "../composables/usePlanProduction.js";
import TopBar from "../components/common/TopBar.vue";
import StatusDot from "../components/common/StatusDot.vue";
import TweaksPanel from "../components/common/TweaksPanel.vue";
import TweakSection from "../components/common/TweakSection.vue";
import TweakRadio from "../components/common/TweakRadio.vue";
import TweakColor from "../components/common/TweakColor.vue";

const fmt = (n) => Number(n).toLocaleString("en-US");
const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

// When an excavator has no production note, fall back to a status-derived label
// so the Remark column stays meaningful instead of always reading "Normal".
const STATUS_REMARK = { ok: "Normal", warn: "Watch", alert: "Down" };

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
const { excavators, areaExcavators, entries, totals, sumBucket, getBucket, placementNoteFor } = useEntryStore();
const { planTonnesForDate, planMaterialTotalsForDate } = usePlanProduction();
const { areaTarget } = useAreaTargets();

// KPI-card targets are derived from Plan Production, not a fixed number. The plan
// figures (soil = Waste, ore = ORE) are entered as TONNES per pit (production_plans
// .soil_tonnes / .ore_tonnes), so the tonnage target is simply their sum — the same
// tonnes the cards compare against. Plan Production is one daily plan covering both
// shifts, so this is the whole date's plan.
const planTonnesTotals = computed(() => planMaterialTotalsForDate(selection.date));
const kpiTargets = computed(() => ({
  production: planTonnesTotals.value.waste + planTonnesTotals.value.ore,
  waste: planTonnesTotals.value.waste,
  ore: planTonnesTotals.value.ore,
}));

const kpiCards = computed(() => [
  { label: "Total Production", k: { ...totals.value.production, target: kpiTargets.value.production }, accent: "var(--accent)", kind: "prod" },
  { label: "Total Waste", k: { ...totals.value.waste, target: kpiTargets.value.waste }, accent: "#8a5a2b", kind: "waste" },
  { label: "Total ORE", k: { ...totals.value.ore, target: kpiTargets.value.ore }, accent: "var(--ore)", kind: "ore" },
]);

// Live per-pit placements grouped by excavator. The Excavator detail table reads
// Area / Trucks / Note from here — the legacy excavators.mining_area_id / truck_count
// are no longer maintained (Data entry now writes to area_excavators), so reading
// them showed a blank Area and a stale truck count.
const placementsByExcavator = computed(() => {
  const map = {};
  areaExcavators.value.forEach((placement) => {
    (map[placement.uid] = map[placement.uid] || []).push(placement);
  });
  return map;
});
const placementInfoFor = (uid) => {
  const placements = placementsByExcavator.value[uid] || [];
  return {
    area: Array.from(new Set(placements.map((p) => p.area).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b))
      .join(", "),
    trucks: placements.reduce((sum, p) => sum + (Number(p.trucks) || 0), 0),
    note: placements.map((p) => (placementNoteFor(p.placementId) || "").trim()).filter(Boolean)[0] || "",
    status: placements[0]?.status,
  };
};

// Per-excavator stats for the currently selected HOUR — used by "Trips this hr"
// and the "BCM by hour" chart, which are intentionally hour-scoped.
const excRows = computed(() =>
  excavators.value.map((excavator) => {
    let waste = 0;
    let ore = 0;
    // An excavator can be placed in several pits — sum every slot for this unit.
    Object.values(entries.value).forEach((entry) => {
      if (entry.excavatorId !== excavator.uid) return;
      entry.rows.forEach((row) => {
        const total = rowTotal(row);
        if (isWaste(row.material)) waste += total;
        else ore += total;
      });
    });
    const info = placementInfoFor(excavator.uid);
    return {
      exc: excavator.name,
      trucks: info.trucks,
      area: info.area,
      status: info.status || excavator.status,
      remark: info.note || STATUS_REMARK[info.status || excavator.status] || "Normal",
      trip: waste + ore,
      oreTrip: ore,
      wasteTrip: waste,
      waste: waste * BCM_PER_TRIP,
      ore: ore * BCM_PER_TRIP,
    };
  }),
);

// Both the Excavator detail table and the Production by excavator chart are scoped
// to the SELECTED hour (the HOUR box): they show what each excavator did in that
// hour, built from excRows (only units that logged trips that hour appear).
const excHourRows = computed(() => excRows.value.filter((row) => row.trip > 0));

const sortKey = ref("exc");
const asc = ref(true);
const area = ref("ALL");
const areas = computed(() => ["ALL", ...Array.from(new Set(excHourRows.value.map((row) => row.area).filter(Boolean)))]);
const maxTrip = computed(() => Math.max(1, ...excHourRows.value.map((row) => row.trip)));

const rows = computed(() => {
  const filtered = area.value === "ALL" ? [...excHourRows.value] : excHourRows.value.filter((row) => row.area === area.value);
  filtered.sort((a, b) => {
    const av = a[sortKey.value];
    const bv = b[sortKey.value];
    if (typeof av === "number") return asc.value ? av - bv : bv - av;
    return asc.value ? String(av).localeCompare(bv) : String(bv).localeCompare(av);
  });
  return filtered;
});

const tableTotals = computed(() => ({
  trucks: rows.value.reduce((sum, row) => sum + row.trucks, 0),
  trip: rows.value.reduce((sum, row) => sum + row.trip, 0),
  waste: rows.value.reduce((sum, row) => sum + row.waste, 0),
  ore: rows.value.reduce((sum, row) => sum + row.ore, 0),
}));

const setSort = (key) => {
  if (sortKey.value === key) asc.value = !asc.value;
  else {
    sortKey.value = key;
    asc.value = true;
  }
};

// Production by excavator — scoped to the SELECTED hour too (matches Excavator detail).
const productionRows = computed(() => [...excHourRows.value].sort((a, b) => b.trip - a.trip));

const fleetStats = computed(() => {
  // Count distinct placed excavators and sum the per-pit truck fleets (placements).
  const placements = areaExcavators.value;
  const excavatorCount = new Set(placements.map((placement) => placement.uid)).size;
  const trucks = placements.reduce((sum, placement) => sum + (Number(placement.trucks) || 0), 0);
  const ratio = excavatorCount > 0 ? (trucks / excavatorCount).toFixed(1) : "0.0";
  const tripInHour = excRows.value.reduce((sum, row) => sum + row.trip, 0);
  return { excavators: excavatorCount, trucks, ratio, tripInHour };
});

// Shift summary: Day vs Night production TONNES for the selected date (sum across
// all 24 hours). Tonnes — not BCM — so this panel matches the Total Production KPI
// and the tonnes-based Plan it's compared against.
const shiftTotals = (shiftType) => {
  let soft = 0;
  let ore = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    Object.values(getBucket(selection.date, shiftType, hour)).forEach((entry) => {
      entry.rows.forEach((row) => {
        const tonnes = rowTonnes(row);
        if (isWaste(row.material)) soft += tonnes;
        else ore += tonnes;
      });
    });
  }
  return { soft, ore };
};
const shifts = computed(() => [
  { key: "day", name: "Day", ...shiftTotals("Day"), color: "var(--day)" },
  { key: "night", name: "Night", ...shiftTotals("Night"), color: "var(--night)" },
]);
const totalAll = computed(() => shifts.value.reduce((sum, item) => sum + item.soft + item.ore, 0));
// PLAN is the single daily Plan Production total (both shifts combined): the sum
// of every pattern's soil + ore for the selected date.
const totalPlan = computed(() => planTonnesForDate(selection.date));
const planPct = computed(() => pct(totalAll.value, totalPlan.value));

// Production by shift - area: Day vs Night TONNES per area, for the selected date.
// Tonnes so the bars line up with the tonnes Plan column (areaTarget) and the
// Total Production KPI.
const areasByShift = computed(() => {
  const byArea = new Map();
  // Seed a column per pit that has a placed excavator.
  areaExcavators.value.forEach((placement) => {
    if (!placement.area) return;
    if (!byArea.has(placement.area)) byArea.set(placement.area, { area: placement.area, day: 0, night: 0, plan: areaTarget(placement.area) });
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
const areaShiftMax = computed(() => Math.max(1, ...areasByShift.value.map((item) => Math.max(item.day, item.night))));

// Vertical STACKED columns for "Production by shift - area": Day (bottom) + Night
// (top), with a cream Plan column behind reaching the area's plan/target.
const shiftAreaChart = { W: 560, H: 300, padL: 34, padR: 10, padT: 20, padB: 34 };
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
  const { W, padL, padR } = shiftAreaChart;
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
  const { W, padR, padL } = shiftAreaChart;
  const tw = 116;
  const th = 78;
  const x = Math.min(Math.max(bar.cx - tw / 2, padL), W - padR - tw);
  const y = Math.max(shiftAreaChart.padT, bar.stackTopY - th - 8);
  return { ...bar, x, y, tw, th };
});

// Total trips by hour: PER-HOUR series for the selected date, covering BOTH shifts
// — Day (06→18) and Night (19→05) — mapped onto the operational-day axis. Each bar
// is that hour's own trips (NOT a running total), so a bar of 10 means 10 trips in
// that hour. Hours after the selected (Current) hour stay empty (they haven't
// happened yet), so the chart fills exactly up to the "Current HH:00" marker.
const hourlyChart = { W: 1100, H: 240, padL: 36, padR: 12, padT: 18, padB: 38 };
const DAY_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const NIGHT_HOURS = [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5];
// X-axis order: operational day, starting at the Day-shift start (06) and running
// chronologically through the Night shift — 06,07,…,18,19,…,23,00,…,05 — instead
// of plain calendar order 00→23.
const HOUR_ORDER = [...DAY_HOURS, ...NIGHT_HOURS];
// Wall-clock start of a (date, shift, hour) slot. Night hours 00–05 happen on the
// morning after the shift date, so they map to date + 1 (mirrors TopBar).
const slotStart = (date, shiftType, hour) => {
  const base = new Date(`${date}T00:00:00`);
  if (shiftType === "Night" && hour <= 5) base.setDate(base.getDate() + 1);
  base.setHours(hour, 0, 0, 0);
  return base;
};
const hourlySeries = computed(() => {
  const byHour = {};
  // Only hours still in the future (vs the real wall clock) stay empty. Gate on
  // the actual clock — NOT the selected hour — so picking an earlier hour to view
  // or edit never hides trips already logged for later, already-elapsed hours, and
  // viewing a past date keeps showing every one of its hours.
  const cutoff = Date.now();
  [
    { type: "Day", order: DAY_HOURS },
    { type: "Night", order: NIGHT_HOURS },
  ].forEach(({ type, order }) => {
    order.forEach((hour) => {
      byHour[hour] = slotStart(selection.date, type, hour).getTime() > cutoff ? null : sumBucket(selection.date, type, hour);
    });
  });
  return HOUR_ORDER.map((hour) => {
    const v = byHour[hour] ?? { soft: 0, ore: 0 };
    const hh = String(hour).padStart(2, "0");
    const next = String((hour + 1) % 24).padStart(2, "0");
    // Axis label is the hour SLOT range (e.g. 06-07) so it reads as the period the
    // trips fall in, not a single instant; `t` stays the bare hour for the key.
    return { t: hh, label: `${hh}-${next}`, soft: v.soft, ore: v.ore, isCurrent: hour === selection.hour, future: byHour[hour] === null };
  });
});
const hourlyMax = computed(() => {
  const max = Math.max(50, ...hourlySeries.value.map((item) => item.soft + item.ore));
  return Math.ceil(max / 50) * 50;
});
const hourlyTicks = computed(() => [0, 0.25, 0.5, 0.75, 1].map((factor) => Math.round(hourlyMax.value * factor)));
const hourlyBars = computed(() => {
  const { W, H, padL, padR, padT, padB } = hourlyChart;
  const cw = (W - padL - padR) / hourlySeries.value.length;
  const bw = cw * 0.6;
  const innerH = H - padT - padB;
  return hourlySeries.value.map((item, i) => {
    const x = padL + i * cw + (cw - bw) / 2;
    const baseY = H - padB;
    const softH = (item.soft / hourlyMax.value) * innerH;
    const oreH = (item.ore / hourlyMax.value) * innerH;
    return { ...item, x, bw, baseY, softH, oreH, total: item.soft + item.ore };
  });
});

const bcmChart = { W: 580, H: 200, padL: 30, padR: 8, padT: 16, padB: 32, yMax: 300, target: 225 };
// Live per-excavator waste BCM for the selected hour (replaces the old static mock rows).
const bcmRows = computed(() => [...excRows.value].sort((a, b) => b.waste - a.waste));
const bcmBars = computed(() => {
  const { W, H, padL, padR, padT, padB, yMax } = bcmChart;
  const cw = (W - padL - padR) / Math.max(1, bcmRows.value.length);
  const bw = cw * 0.55;
  const innerH = H - padT - padB;
  return bcmRows.value.map((row, i) => {
    const x = padL + i * cw + (cw - bw) / 2;
    const h = (row.waste / yMax) * innerH;
    return { ...row, x, bw, h, baseY: H - padB, below: row.waste < bcmChart.target };
  });
});

// Production by area - tonnes by shift type, for the selected date (live, mirrors areasByShift above).
const areaTonnesByShift = computed(() => {
  const byArea = new Map();
  areaExcavators.value.forEach((placement) => {
    if (!placement.area) return;
    if (!byArea.has(placement.area)) byArea.set(placement.area, { area: placement.area, day: 0, night: 0, target: areaTarget(placement.area) });
  });
  ["Day", "Night"].forEach((shiftType) => {
    for (let hour = 0; hour < 24; hour += 1) {
      const bucket = getBucket(selection.date, shiftType, hour);
      Object.values(bucket).forEach((entry) => {
        const stat = byArea.get(entry.area);
        if (!stat) return;
        const tonnes = entry.rows.reduce((sum, row) => sum + rowTonnes(row), 0);
        stat[shiftType === "Day" ? "day" : "night"] += tonnes;
      });
    }
  });
  return Array.from(byArea.values());
});

const areaChart = { W: 580, H: 240, padL: 44, padR: 8, padT: 18, padB: 36 };
const areaYMax = computed(() => Math.ceil(Math.max(5000, ...areaTonnesByShift.value.map((item) => item.target)) / 5000) * 5000);
const areaBars = computed(() => {
  const { W, H, padL, padR, padT, padB } = areaChart;
  const cw = (W - padL - padR) / Math.max(1, areaTonnesByShift.value.length);
  const bw = cw * 0.5;
  const innerH = H - padT - padB;
  return areaTonnesByShift.value.map((item, i) => {
    const x = padL + i * cw + (cw - bw) / 2;
    const baseY = H - padB;
    const dayH = (item.day / areaYMax.value) * innerH;
    const nightH = (item.night / areaYMax.value) * innerH;
    const targetY = baseY - (item.target / areaYMax.value) * innerH;
    return { ...item, x, bw, baseY, dayH, nightH, targetY, sum: item.day + item.night };
  });
});

</script>

<template>
  <div class="dash">
    <TopBar subtitle="Live" />

    <section class="kpi-strip">
      <div v-for="card in kpiCards" :key="card.label" class="kpi" :class="`kpi-${card.kind}`">
        <div class="kpi-head">
          <span class="kpi-label">{{ card.label }}</span>
          <span class="kpi-pct mono">{{ pct(card.k.tonnes, card.k.target) }}%</span>
        </div>
        <div class="kpi-main">
          <div>
            <div class="kpi-big mono">{{ fmt(card.k.tonnes) }}</div>
            <div class="kpi-unit">Tonnes</div>
          </div>
          <div class="kpi-side">
            <div class="kpi-trip mono">{{ fmt(card.k.trip) }}</div>
            <div class="kpi-unit">Trips</div>
          </div>
        </div>
        <div class="kpi-bar">
          <div class="kpi-bar-fill" :style="{ width: `${pct(card.k.tonnes, card.k.target)}%`, background: card.accent }" />
        </div>
        <div class="kpi-foot mono">Target {{ fmt(card.k.target) }}t</div>
      </div>

      <div class="kpi kpi-fleet">
        <div class="kpi-head"><span class="kpi-label">Fleet Status</span></div>
        <div class="fleet-grid">
          <div>
            <div class="fleet-n mono">{{ fleetStats.excavators }}</div>
            <div class="kpi-unit">Excavators</div>
          </div>
          <div>
            <div class="fleet-n mono">{{ fleetStats.trucks }}</div>
            <div class="kpi-unit">Dump trucks</div>
          </div>
          <div>
            <div class="fleet-n mono">1:{{ fleetStats.ratio }}</div>
            <div class="kpi-unit">Ratio</div>
          </div>
          <div>
            <div class="fleet-n mono accent">{{ fleetStats.tripInHour }}</div>
            <div class="kpi-unit">Trips this hr</div>
          </div>
        </div>
      </div>
    </section>

    <main class="grid">
      <section class="col-main">
        <div class="panel">
          <div class="panel-head">
            <h2>Excavator detail</h2>
            <div class="panel-tools">
              <span class="now-pill mono">Hour {{ String(selection.hour).padStart(2, "0") }}:00</span>
              <div class="seg">
                <button v-for="item in areas" :key="item" :class="{ on: area === item }" type="button" @click="area = item">
                  {{ item }}
                </button>
              </div>
            </div>
          </div>
          <div class="table-wrap">
            <table class="data tight">
              <thead>
                <tr>
                  <th />
                  <th class="sortable" @click="setSort('exc')">Excavator <span v-if="sortKey === 'exc'" class="caret">{{ asc ? "▲" : "▼" }}</span></th>
                  <th class="sortable" @click="setSort('trucks')">Trucks <span v-if="sortKey === 'trucks'" class="caret">{{ asc ? "▲" : "▼" }}</span></th>
                  <th class="sortable" @click="setSort('area')">Area <span v-if="sortKey === 'area'" class="caret">{{ asc ? "▲" : "▼" }}</span></th>
                  <th class="sortable" @click="setSort('trip')">Trip <span v-if="sortKey === 'trip'" class="caret">{{ asc ? "▲" : "▼" }}</span></th>
                  <th class="sortable" @click="setSort('waste')">Waste BCM <span v-if="sortKey === 'waste'" class="caret">{{ asc ? "▲" : "▼" }}</span></th>
                  <th class="sortable" @click="setSort('ore')">ORE BCM <span v-if="sortKey === 'ore'" class="caret">{{ asc ? "▲" : "▼" }}</span></th>
                  <th class="rmk">Remark</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.exc">
                  <td><StatusDot :status="row.status" /></td>
                  <td class="exc">{{ row.exc }}</td>
                  <td class="mono">{{ row.trucks }}</td>
                  <td><span class="chip">{{ row.area }}</span></td>
                  <td><span class="cell-pill mono" :class="row.trip <= 6 ? 'danger' : 'good'">{{ row.trip }}</span></td>
                  <td><span class="cell-pill mono" :class="row.waste <= 150 ? 'danger' : 'good'">{{ row.waste ? fmt(row.waste) : "–" }}</span></td>
                  <td><span class="cell-pill mono" :class="row.ore <= 150 ? 'danger' : 'good'">{{ row.ore ? fmt(row.ore) : "–" }}</span></td>
                  <td class="remark rmk">
                    <span class="remark-inner">
                      <StatusDot v-if="row.status !== 'ok'" :status="row.status" />
                      <span>{{ row.remark }}</span>
                    </span>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td>Total - {{ rows.length }}</td>
                  <td class="mono">{{ tableTotals.trucks }}</td>
                  <td />
                  <td class="mono">{{ tableTotals.trip }}</td>
                  <td class="mono">{{ fmt(tableTotals.waste) }}</td>
                  <td class="mono">{{ fmt(tableTotals.ore) }}</td>
                  <td class="rmk" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <h2>Total TRIP by hour</h2>
            <div class="legend mono">
              <span><span class="lg-dot" style="background: #8a5a2b" />Waste</span>
              <span><span class="lg-dot ml" style="background: var(--ore)" />ORE</span>
              <span class="now-pill">Current {{ String(selection.hour).padStart(2, "0") }}:00</span>
            </div>
          </div>
          <svg :viewBox="`0 0 ${hourlyChart.W} ${hourlyChart.H}`" class="chart">
            <g v-for="tick in hourlyTicks" :key="tick">
              <line
                :x1="hourlyChart.padL"
                :y1="hourlyChart.padT + (hourlyChart.H - hourlyChart.padT - hourlyChart.padB) * (1 - tick / hourlyMax)"
                :x2="hourlyChart.W - hourlyChart.padR"
                :y2="hourlyChart.padT + (hourlyChart.H - hourlyChart.padT - hourlyChart.padB) * (1 - tick / hourlyMax)"
                class="grid"
              />
              <text
                :x="hourlyChart.padL - 6"
                :y="hourlyChart.padT + (hourlyChart.H - hourlyChart.padT - hourlyChart.padB) * (1 - tick / hourlyMax) + 3"
                class="axis"
                text-anchor="end"
              >
                {{ tick }}
              </text>
            </g>
            <g v-for="bar in hourlyBars" :key="bar.t" :class="{ current: bar.isCurrent }">
              <rect :x="bar.x" :y="bar.baseY - bar.softH" :width="bar.bw" :height="bar.softH" fill="#8a5a2b" :opacity="bar.isCurrent ? 1 : 0.88" />
              <rect :x="bar.x" :y="bar.baseY - bar.softH - bar.oreH" :width="bar.bw" :height="bar.oreH" fill="var(--ore)" />
              <!-- ดิน (Waste) and แร่ (ORE) shown as SEPARATE numbers — not a combined
                   total: Waste inside its (usually larger) brown segment, and ORE in
                   gold just above the bar so a small ore count is never hidden. -->
              <!-- ดิน (Waste) inside its brown segment -->
              <text
                v-if="bar.soft > 0 && bar.softH > 12"
                :x="bar.x + bar.bw / 2"
                :y="bar.baseY - bar.softH / 2 + 4"
                class="seg-label mono on-day"
                text-anchor="middle"
              >
                {{ bar.soft }}
              </text>
              <!-- แร่ (ORE) inside the gold segment when it's tall enough … -->
              <text
                v-if="bar.ore > 0 && bar.oreH > 12"
                :x="bar.x + bar.bw / 2"
                :y="bar.baseY - bar.softH - bar.oreH / 2 + 4"
                class="seg-label mono on-day"
                text-anchor="middle"
              >
                {{ bar.ore }}
              </text>
              <!-- … otherwise just above the bar in gold so a small ore count still shows -->
              <text
                v-else-if="bar.ore > 0 && !bar.future"
                :x="bar.x + bar.bw / 2"
                :y="bar.baseY - bar.softH - bar.oreH - 4"
                class="seg-label mono"
                :style="{ fill: 'var(--ore)' }"
                text-anchor="middle"
              >
                {{ bar.ore }}
              </text>
              <text :x="bar.x + bar.bw / 2" :y="hourlyChart.H - 18" class="axis mono tiny" text-anchor="middle">{{ bar.label }}</text>
              <rect
                v-if="bar.isCurrent"
                :x="bar.x - 3"
                :y="hourlyChart.padT - 4"
                :width="bar.bw + 6"
                :height="hourlyChart.H - hourlyChart.padT - hourlyChart.padB + 6"
                class="current-rect"
              />
            </g>
            <text :x="hourlyChart.padL" :y="hourlyChart.H - 4" class="axis-x">Hour (shift start)</text>
          </svg>
        </div>
      </section>

      <section class="col-side">
        <div class="panel">
          <div class="panel-head">
            <h2>Production by excavator</h2>
            <div class="legend mono">
              <span><span class="lg-dot" style="background: var(--ore)" />Ore</span>
              <span><span class="lg-dot ml" style="background: #8a5a2b" />Waste</span>
            </div>
          </div>
          <div class="hbars">
            <div v-for="row in productionRows" :key="row.exc" class="hbar">
              <div class="hbar-label">{{ row.exc }}</div>
              <div class="hbar-track">
                <div class="hbar-fill" :style="{ width: `${(row.oreTrip / maxTrip) * 100}%`, background: 'var(--ore)' }" :title="`Ore ${row.oreTrip}`">
                  <span v-if="row.oreTrip > 0" class="hbar-seg-val">{{ row.oreTrip }}</span>
                </div>
                <div class="hbar-fill" :style="{ width: `${(row.wasteTrip / maxTrip) * 100}%`, background: '#8a5a2b' }" :title="`Waste ${row.wasteTrip}`">
                  <span v-if="row.wasteTrip > 0" class="hbar-seg-val">{{ row.wasteTrip }}</span>
                </div>
              </div>
              <div class="hbar-value mono">{{ row.trip }}</div>
            </div>
          </div>
        </div>

        <div class="panel shift-panel">
          <div class="bytype">
            <div class="bytype-head">
              <span class="bytype-title">Production by shift - area</span>
              <span class="legend mono">
                <span class="lg-dot" style="background: var(--day)" />Day
                <span class="lg-dot ml" style="background: var(--night)" />Night
              </span>
            </div>
            <svg :viewBox="`0 0 ${shiftAreaChart.W} ${shiftAreaChart.H}`" class="chart">
              <g v-for="tick in shiftAreaTicks" :key="tick">
                <line :x1="shiftAreaChart.padL" :x2="shiftAreaChart.W - shiftAreaChart.padR" :y1="shiftAreaY(tick)" :y2="shiftAreaY(tick)" class="grid" />
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
                <text v-if="bar.night" :x="bar.cx" :y="bar.stackTopY - 4" class="seg-label mono" text-anchor="middle">{{ fmt(bar.night) }}</text>
                <text :x="bar.cx" :y="bar.baseY + 14" class="axis mono tiny" text-anchor="middle">{{ bar.area }}</text>
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

          <div class="shift-divider" />

          <div class="shift-footer">
            <div class="sf-cell">
              <span class="bk-k">Total - 24h</span>
              <span class="sf-v mono accent">{{ fmt(totalAll) }}</span>
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
      </section>

      <section class="col-bottom">
        <div class="panel">
          <div class="panel-head">
            <h2>BCM by hour</h2>
            <div class="legend mono">
              <span><span class="lg-dot" style="background: var(--cool)" />BCM/Hr</span>
              <span><span class="lg-dot ml" style="background: var(--alert)" />Target {{ bcmChart.target }}</span>
            </div>
          </div>
          <svg :viewBox="`0 0 ${bcmChart.W} ${bcmChart.H}`" class="chart">
            <g v-for="tick in [0, 100, 200, 300]" :key="tick">
              <line
                :x1="bcmChart.padL"
                :y1="bcmChart.padT + (bcmChart.H - bcmChart.padT - bcmChart.padB) * (1 - tick / bcmChart.yMax)"
                :x2="bcmChart.W - bcmChart.padR"
                :y2="bcmChart.padT + (bcmChart.H - bcmChart.padT - bcmChart.padB) * (1 - tick / bcmChart.yMax)"
                class="grid"
              />
              <text :x="bcmChart.padL - 6" :y="bcmChart.padT + (bcmChart.H - bcmChart.padT - bcmChart.padB) * (1 - tick / bcmChart.yMax) + 3" class="axis" text-anchor="end">{{ tick }}</text>
            </g>
            <line
              :x1="bcmChart.padL"
              :x2="bcmChart.W - bcmChart.padR"
              :y1="bcmChart.padT + (bcmChart.H - bcmChart.padT - bcmChart.padB) * (1 - bcmChart.target / bcmChart.yMax)"
              :y2="bcmChart.padT + (bcmChart.H - bcmChart.padT - bcmChart.padB) * (1 - bcmChart.target / bcmChart.yMax)"
              class="target-line"
            />
            <g v-for="bar in bcmBars" :key="bar.exc">
              <rect :x="bar.x" :y="bar.baseY - bar.h" :width="bar.bw" :height="bar.h" :fill="bar.below ? 'var(--alert)' : 'var(--cool)'" :opacity="bar.below ? 0.8 : 1" />
              <text :x="bar.x + bar.bw / 2" :y="bar.baseY - bar.h - 4" class="bar-label mono" text-anchor="middle">{{ bar.waste }}</text>
              <text :x="bar.x + bar.bw / 2" :y="bcmChart.H - 14" class="axis mono tiny" text-anchor="middle">{{ bar.exc.replace('E-', '') }}</text>
            </g>
          </svg>
        </div>

        <div class="panel">
          <div class="panel-head">
            <h2>Tonnes by area</h2>
            <div class="legend mono">
              <span><span class="lg-dot" style="background: var(--day)" />Day</span>
              <span><span class="lg-dot ml" style="background: var(--night)" />Night</span>
              <span><span class="lg-dot ml dash" />Target</span>
            </div>
          </div>
          <svg :viewBox="`0 0 ${areaChart.W} ${areaChart.H}`" class="chart">
            <g v-for="tick in [0, 10000, 20000, 30000]" :key="tick">
              <line
                :x1="areaChart.padL"
                :y1="areaChart.padT + (areaChart.H - areaChart.padT - areaChart.padB) * (1 - tick / areaYMax)"
                :x2="areaChart.W - areaChart.padR"
                :y2="areaChart.padT + (areaChart.H - areaChart.padT - areaChart.padB) * (1 - tick / areaYMax)"
                class="grid"
              />
              <text :x="areaChart.padL - 6" :y="areaChart.padT + (areaChart.H - areaChart.padT - areaChart.padB) * (1 - tick / areaYMax) + 3" class="axis" text-anchor="end">{{ Math.floor(tick / 1000) }}k</text>
            </g>
            <g v-for="bar in areaBars" :key="bar.area">
              <rect :x="bar.x" :y="bar.baseY - bar.dayH" :width="bar.bw" :height="bar.dayH" fill="var(--day)" />
              <rect :x="bar.x" :y="bar.baseY - bar.dayH - bar.nightH" :width="bar.bw" :height="bar.nightH" fill="var(--night)" />
              <line :x1="bar.x - 2" :x2="bar.x + bar.bw + 2" :y1="bar.targetY" :y2="bar.targetY" class="target-tick" />
              <text :x="bar.x + bar.bw / 2" :y="bar.baseY - bar.dayH - bar.nightH - 6" class="bar-label mono" text-anchor="middle">{{ fmt(bar.sum) }}</text>
              <text :x="bar.x + bar.bw / 2" :y="areaChart.H - 18" class="axis mono" text-anchor="middle">{{ bar.area }}</text>
            </g>
          </svg>
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
