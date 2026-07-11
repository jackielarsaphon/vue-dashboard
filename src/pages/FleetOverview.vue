<script setup>
import { computed, ref, watchEffect } from "vue";
import { useAreaTargets } from "../composables/useAreaTargets.js";
import { useTweaks } from "../composables/useTweaks.js";
import { useShiftSelection } from "../composables/useShiftSelection.js";
import { useEntryStore, isWaste, rowTotal, rowTonnes, BCM_PER_TRIP } from "../composables/useEntryStore.js";
import { usePlanProduction } from "../composables/usePlanProduction.js";
import { useLiveRefresh } from "../composables/useLiveRefresh.js";
import { useDownloadImage } from "../composables/useDownloadImage.js";
import TopBar from "../components/common/TopBar.vue";
import DownloadImageButton from "../components/common/DownloadImageButton.vue";
import StatusDot from "../components/common/StatusDot.vue";
import TweaksPanel from "../components/common/TweaksPanel.vue";
import TweakSection from "../components/common/TweakSection.vue";
import TweakRadio from "../components/common/TweakRadio.vue";
import TweakColor from "../components/common/TweakColor.vue";

// Whole numbers only — drop the decimals by truncating (never round up).
const fmt = (n) => Math.trunc(Number(n) || 0).toLocaleString("en-US");

// When an excavator has no production note, fall back to a status-derived label
// so the Remark column stays meaningful instead of always reading "Normal".
const STATUS_REMARK = { ok: "Normal", warn: "Watch", alert: "Down" };

// Waste series colour, shared by every chart's Waste legend + bars AND the Total
// Waste KPI card. Sourced from the --waste CSS var so there's a single place to
// retune (src/styles/base.css). Was brown #8a5a2b.
const WASTE_COLOR = "var(--waste)";

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

// Date/Time card that leads the KPI strip. Mirrors the top-bar selection —
// read-only, a stacked ticket: date on top ("30 Jun"), hour range below.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const clockDate = computed(() => {
  const [y, m, d] = String(selection.date).split("-");
  const month = MONTHS[Number(m) - 1];
  return d && month && y ? `${Number(d)} ${month}` : "";
});
// Per-hour range for the selected hour — matches the top-bar HOUR dropdown label.
const clockHour = computed(() => {
  const a = String(selection.hour).padStart(2, "0");
  const b = String((selection.hour + 1) % 24).padStart(2, "0");
  return `${a}:00-${b}:00`;
});
const { areaExcavators, entries, totals, sumBucket, getBucket, placementNoteFor, placementTrucksFor, isPlacementRemovedNow, reload: reloadEntries } = useEntryStore();
const { planMaterialTotalsForDate, getDatePlans, reloadPlans } = usePlanProduction();
const { areaTarget, reload: reloadAreaTargets } = useAreaTargets();

// Pick up production entered on another device (e.g. a phone) without a manual
// reload: re-fetch on tab focus / visibility and every 30s.
useLiveRefresh([reloadEntries, reloadPlans, reloadAreaTargets]);

// Download the whole Fleet overview as one PNG (shared logic in useDownloadImage).
const { dashRef, downloading, downloadImage } = useDownloadImage(() => `fleet-overview-${selection.date}.png`);

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

// Only Total Production leads the KPI strip now — Waste / ORE cards were removed
// (their tonnage still feeds the charts below via totals/kpiTargets).
const kpiCards = computed(() => [
  { label: "Total Production", material: "Production", k: { ...totals.value.production, target: kpiTargets.value.production }, kind: "prod" },
]);

// Live per-pit placements grouped by excavator. The Excavator detail table reads
// Area / Trucks / Note from here — the legacy excavators.mining_area_id / truck_count
// are no longer maintained (Data entry now writes to area_excavators), so reading
// them showed a blank Area and a stale truck count.
const placementsByExcavator = computed(() => {
  const map = {};
  areaExcavators.value.forEach((placement) => {
    // Skip pits this unit was removed from this hour, so the Area cell (and the
    // trucks/note/status derived from it) matches the Data entry table.
    if (isPlacementRemovedNow(placement.placementId)) return;
    (map[placement.uid] = map[placement.uid] || []).push(placement);
  });
  return map;
});

// Pits the daily Plan Production recognises (production_plans pattern codes). The
// Area cell only lists these, so an off-plan pit a unit also hauled in is dropped
// from its (possibly multi-pit) Area label — keeping Area aligned with the plan.
const planPits = computed(() => new Set(Object.keys(getDatePlans(selection.date))));

// The Excavator detail Area cell lists EVERY pit this unit touched this hour —
// each pit it logged trips in, plus any pit where it only wrote a note — joined
// by comma ("NLU03A, PVT03B, TKS02A"). Off-plan pits are dropped while a plan
// exists (mirrors planPits); a no-plan day shows all so Area isn't blanked out.
const joinAreas = (areaTrips, noteAreas) => {
  const recognised = (code) => planPits.value.size === 0 || planPits.value.has(code);
  return [...new Set([...areaTrips.keys(), ...noteAreas])]
    .filter(recognised)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
};

// Roster driving the Excavator detail table — built PURELY from what was entered on
// Data entry (area_excavators placements), never from the Excavator master list. The
// master is only the source for the Data entry dropdown; Fleet overview / Area
// production must reflect entered production alone. So an excavator that was never
// placed doesn't show here, and one deleted from the master still shows as long as it
// has placements (they resolve their code via excavatorById, which includes inactive
// units). Keyed by uid (a unit placed in several pits collapses to one detail row).
const rosterExcavators = computed(() => {
  const byUid = new Map();
  areaExcavators.value.forEach((placement) => {
    if (byUid.has(placement.uid)) return;
    byUid.set(placement.uid, {
      uid: placement.uid,
      name: placement.name,
      area: placement.area,
      status: placement.status,
      trucks: placement.trucks,
      rl: placement.rl,
      notes: placement.notes,
    });
  });
  return [...byUid.values()];
});

// Per-excavator stats for the currently selected HOUR — used by "Trips this hr"
// and the "BCM by hour" chart, which are intentionally hour-scoped.
const excRows = computed(() =>
  rosterExcavators.value.map((excavator) => {
    let waste = 0;
    let ore = 0;
    // Build from REAL Data entry input for this hour. Trips come from the logged
    // entries (every pit this unit hauled in). On top of that, pits where the unit
    // only wrote a Production note (no trips — e.g. "broken down / being serviced")
    // are surfaced too, so they don't silently disappear from the dashboard.
    const areaTrips = new Map(); // pit -> trips this hour (where the unit really worked)
    const noteAreas = new Set(); // pits where it only wrote a note (no trips)
    const activePlacementIds = new Set();
    Object.entries(entries.value).forEach(([placementId, entry]) => {
      if (entry.excavatorId !== excavator.uid) return;
      let entryTrips = 0;
      entry.rows.forEach((row) => {
        const total = rowTotal(row);
        if (isWaste(row.material)) waste += total;
        else ore += total;
        entryTrips += total;
      });
      if (entryTrips > 0) {
        if (entry.area) areaTrips.set(entry.area, (areaTrips.get(entry.area) || 0) + entryTrips);
        activePlacementIds.add(placementId);
      }
    });
    (placementsByExcavator.value[excavator.uid] || []).forEach((placement) => {
      if (!String(placementNoteFor(placement.placementId) || "").trim()) return;
      if (placement.area) noteAreas.add(placement.area);
      activePlacementIds.add(placement.placementId);
    });
    const placements = (placementsByExcavator.value[excavator.uid] || []).filter((p) => activePlacementIds.has(p.placementId));
    const trip = waste + ore;
    const note = placements.map((p) => (placementNoteFor(p.placementId) || "").trim()).filter(Boolean)[0] || "";
    const hasNote = !!note;
    // Red alert when a note was written but no trips logged (matches Data entry).
    const status = hasNote && trip === 0 ? "alert" : placements[0]?.status || excavator.status;
    return {
      exc: excavator.name,
      // Trucks = the Trucks in fleet value entered on Data entry for this hour
      // (per-hour, summed across this unit's active placements).
      trucks: placements.reduce((sum, p) => sum + (Number(placementTrucksFor(p.placementId)) || 0), 0),
      area: joinAreas(areaTrips, noteAreas),
      status,
      remark: note || STATUS_REMARK[status] || "Normal",
      trip,
      oreTrip: ore,
      wasteTrip: waste,
      waste: waste * BCM_PER_TRIP,
      ore: ore * BCM_PER_TRIP,
      hasNote,
    };
  }),
);

// The Excavator detail table is scoped to the SELECTED hour (the HOUR box): it
// shows what each excavator did in that hour — units that logged trips OR wrote a
// Production note for the hour appear.
const excHourRows = computed(() => excRows.value.filter((row) => row.trip > 0 || row.hasNote));

const sortKey = ref("exc");
const asc = ref(true);
const area = ref("ALL");
const areas = computed(() => ["ALL", ...Array.from(new Set(excHourRows.value.map((row) => row.area).filter(Boolean)))]);

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

const fleetStats = computed(() => {
  // Mirror the Excavator detail table exactly, hour-scoped: Excavators = the units
  // active this hour (its rows), Dump trucks = the sum of that table's Trucks column
  // (the Trucks in fleet values). Both follow the selected hour like the table does.
  const active = excHourRows.value;
  const excavatorCount = active.length;
  const trucks = active.reduce((sum, row) => sum + row.trucks, 0);
  const tripInHour = active.reduce((sum, row) => sum + row.trip, 0);
  return { excavators: excavatorCount, trucks, tripInHour };
});


// Total trips by hour: PER-HOUR series for the selected date, covering BOTH shifts
// — Day (06→17) and Night (18→05) — mapped onto the operational-day axis. Each bar
// is that hour's own trips (NOT a running total), so a bar of 10 means 10 trips in
// that hour. Hours after the selected (Current) hour stay empty (they haven't
// happened yet), so the chart fills exactly up to the "Current HH:00" marker.
const hourlyChart = { W: 1100, H: 240, padL: 36, padR: 12, padT: 18, padB: 38 };
const DAY_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const NIGHT_HOURS = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5];
// X-axis order: operational day, starting at the Day-shift start (06) and running
// chronologically through the Night shift — 06,07,…,17,18,…,23,00,…,05 — instead
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

// The operational day as an ordered list of (shift, hour) slots: Day 06→17 then
// Night 18→05. Used to sum trips only up to the SELECTED time (below).
const OPERATIONAL_SLOTS = [
  ...DAY_HOURS.map((hour) => ({ shiftType: "Day", hour })),
  ...NIGHT_HOURS.map((hour) => ({ shiftType: "Night", hour })),
];

// "Trips" KPI: a RUNNING total from the start of the operational day (Day 06) up
// to AND INCLUDING the selected hour — not the whole date. So reviewing an earlier
// hour shows the trips logged as at that time, and a Day-shift hour excludes the
// Night shift that follows it. Falls back to the whole day if the selected hour
// isn't part of the selected shift (an inconsistent selection), so it never blanks.
const tripsToSelected = computed(() => {
  const selectedIdx = OPERATIONAL_SLOTS.findIndex(
    (slot) => slot.shiftType === selection.shiftType && slot.hour === selection.hour,
  );
  const lastIdx = selectedIdx === -1 ? OPERATIONAL_SLOTS.length - 1 : selectedIdx;
  let trips = 0;
  for (let i = 0; i <= lastIdx; i += 1) {
    const { shiftType, hour } = OPERATIONAL_SLOTS[i];
    const { soft, ore } = sumBucket(selection.date, shiftType, hour);
    trips += soft + ore;
  }
  return trips;
});
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
  <div ref="dashRef" class="dash">
    <TopBar subtitle="Live" />

    <DownloadImageButton :downloading="downloading" @click="downloadImage" />

    <!-- One unified KPI card: Date & Time, Trip this hr, then Trips / Production /
         Target, each a cell divided by a hairline. -->
    <section class="kpi-strip fleet-kpi">
      <div class="kpi kpi-unified">
        <div class="kpi-cell kpi-cell-clock">
          <span class="kpi-cell-date">{{ clockDate }}</span>
          <span class="kpi-cell-hour mono">{{ clockHour }}</span>
        </div>
        <div class="kpi-cell">
          <span class="kpi-cell-k">Trip this hr</span>
          <span class="kpi-cell-v mono">{{ fleetStats.tripInHour }}</span>
        </div>
        <template v-for="card in kpiCards" :key="card.label">
          <div class="kpi-cell">
            <span class="kpi-cell-k">Trips</span>
            <span class="kpi-cell-v mono">{{ fmt(tripsToSelected) }}</span>
          </div>
          <div class="kpi-cell">
            <span class="kpi-cell-k">{{ card.material }}</span>
            <span class="kpi-cell-v mono">{{ fmt(card.k.tonnes) }}<span class="kpi-cell-u">t</span></span>
          </div>
          <div class="kpi-cell">
            <span class="kpi-cell-k">Target</span>
            <span class="kpi-cell-v mono">{{ fmt(card.k.target) }}<span class="kpi-cell-u">t</span></span>
          </div>
        </template>
      </div>
    </section>

    <main class="grid">
      <section class="col-main">
        <div class="panel">
          <div class="panel-head">
            <div class="panel-title">
              <h2>Excavator detail</h2>
              <div class="exdt">
                <span class="exdt-k">EX</span>
                <span class="exdt-n mono">{{ fleetStats.excavators }}</span>
                <span class="exdt-k">DT</span>
                <span class="exdt-n mono">{{ fleetStats.trucks }}</span>
              </div>
            </div>
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
            <table class="data tight exc-table">
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
                  <td class="tag-cell"><span class="area mono">{{ row.area }}</span></td>
                  <td class="tag-cell"><span class="mono" :class="row.trip < 8 ? 'danger' : row.trip <= 9 ? 'warn' : 'good'">{{ row.trip }}</span></td>
                  <td class="mono">{{ row.waste ? fmt(row.waste) : "–" }}</td>
                  <td class="mono">{{ row.ore ? fmt(row.ore) : "–" }}</td>
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
              <span><span class="lg-dot" :style="{ background: WASTE_COLOR }" />Waste</span>
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
              <rect :x="bar.x" :y="bar.baseY - bar.softH" :width="bar.bw" :height="bar.softH" :style="{ fill: WASTE_COLOR }" :opacity="bar.isCurrent ? 1 : 0.88" />
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
