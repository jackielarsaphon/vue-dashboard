<script setup>
import { computed, ref, watchEffect } from "vue";
import { useAreaTargets } from "../composables/useAreaTargets.js";
import { useTweaks } from "../composables/useTweaks.js";
import { useShiftSelection } from "../composables/useShiftSelection.js";
import { useEntryStore, isWaste, rowTotal, rowTonnes, BCM_PER_TRIP } from "../composables/useEntryStore.js";
import { usePlanProduction } from "../composables/usePlanProduction.js";
import { useLiveRefresh } from "../composables/useLiveRefresh.js";
import html2canvas from "html2canvas";
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
const { excavators, areaExcavators, entries, totals, sumBucket, getBucket, placementNoteFor, isPlacementRemovedNow, areas: storeAreas, reload: reloadEntries } = useEntryStore();
const { planTonnesForDate, planMaterialTotalsForDate, getDatePlans, reloadPlans } = usePlanProduction();
const { areaTarget, reload: reloadAreaTargets } = useAreaTargets();

// Pick up production entered on another device (e.g. a phone) without a manual
// reload: re-fetch on tab focus / visibility and every 30s.
useLiveRefresh([reloadEntries, reloadPlans, reloadAreaTargets]);

// Download the whole Fleet overview as one PNG. html2canvas rasterises the live
// DOM (so theme CSS variables, fonts and layout match the screen), skipping the
// toolbar button and the floating tweaks panel.
const dashRef = ref(null);
const downloading = ref(false);
const downloadImage = async () => {
  const node = dashRef.value;
  if (!node || downloading.value) return;
  downloading.value = true;
  try {
    // Make sure web fonts are ready so text doesn't fall back in the capture.
    if (document.fonts?.ready) await document.fonts.ready;
    const rootStyles = getComputedStyle(document.documentElement);
    const bg = rootStyles.getPropertyValue("--bg").trim() || getComputedStyle(document.body).backgroundColor || "#ffffff";
    const canvas = await html2canvas(node, {
      backgroundColor: bg,
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: node.scrollWidth,
      ignoreElements: (el) => el.classList?.contains("no-capture") || el.classList?.contains("twk-panel"),
    });
    const link = document.createElement("a");
    link.download = `fleet-overview-${selection.date}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch (err) {
    console.error("Download image failed", err);
  } finally {
    downloading.value = false;
  }
};

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
    // Skip pits this unit was removed from this hour, so the Area cell (and the
    // trucks/note/status derived from it) matches the Data entry table.
    if (isPlacementRemovedNow(placement.placementId)) return;
    (map[placement.uid] = map[placement.uid] || []).push(placement);
  });
  return map;
});

// Pits the daily Plan Production recognises (production_plans pattern codes). The
// Area cell only surfaces these, so an excavator that also hauled in an off-plan pit
// doesn't show that pit as a second area chip next to its planned one — keeping Area
// aligned with the plan instead of joining every pit it touched ("NLU03A, TKS01A").
const planPits = computed(() => new Set(Object.keys(getDatePlans(selection.date))));

// An excavator belongs to ONE pit. If the hour's data ties a unit to several pits
// — a stale/duplicate placement, or a relabel that left rows under the old pit —
// the Area cell must NOT list them all ("PVT03B, TKS02A"). Pick the single pit the
// unit actually worked most this hour (most trips); fall back to a note-only pit
// when it logged no trips. Always returns one code. Off-plan pits are dropped only
// while a plan exists (mirrors planPits), so a no-plan day still resolves to a pit.
const pickArea = (areaTrips, noteAreas) => {
  const recognised = (code) => planPits.value.size === 0 || planPits.value.has(code);
  const withTrips = [...areaTrips.entries()].filter(([code]) => recognised(code));
  if (withTrips.length) {
    withTrips.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return withTrips[0][0];
  }
  const noted = [...noteAreas].filter(recognised).sort((a, b) => a.localeCompare(b));
  return noted[0] || "";
};

// Per-excavator stats for the currently selected HOUR — used by "Trips this hr"
// and the "BCM by hour" chart, which are intentionally hour-scoped.
const excRows = computed(() =>
  excavators.value.map((excavator) => {
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
      trucks: placements.reduce((sum, p) => sum + (Number(p.trucks) || 0), 0),
      area: pickArea(areaTrips, noteAreas),
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

// Both the Excavator detail table and the Production by excavator chart are scoped
// to the SELECTED hour (the HOUR box): they show what each excavator did in that
// hour — units that logged trips OR wrote a Production note for the hour appear.
const excHourRows = computed(() => excRows.value.filter((row) => row.trip > 0 || row.hasNote));

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
// Tonnes so the bars line up with the per-pit Plan Production column and the Total
// Production KPI.
const areasByShift = computed(() => {
  // Plan column (the cream shadow) = each pit's Plan Production total for the date
  // (soil + ore), not the static area target. Pits with no plan entry show no shadow.
  const plans = getDatePlans(selection.date);
  const planTotal = (area) => {
    const p = plans[area];
    return p ? p.soil + p.ore : 0;
  };
  const byArea = new Map();
  // Seed a column per pit that has a placed excavator.
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
const areaShiftMax = computed(() => Math.max(1, ...areasByShift.value.map((item) => Math.max(item.day, item.night))));

// Vertical STACKED columns for "Production by shift - area": Day (bottom) + Night
// (top), with a cream Plan column behind reaching the pit's Plan Production total.
// padL leaves room for the y-axis labels, which grow to 6–7 digits (e.g. 30,000)
// once the bars/plan use real tonnes — too small a pad clipped them at the edge.
const shiftAreaChart = { H: 300, padL: 54, padR: 10, padT: 20, padB: 34 };
// Each pit gets a fixed-width column, so the chart grows along X as pits are added
// (and scrolls horizontally once it outgrows the panel) instead of squeezing ever-
// thinner bars into a fixed width. CSS min-width:100% still lets a few pits stretch
// to fill the panel; beyond that the column width is what drives the scroll.
const SHIFT_AREA_COL_W = 92;
const shiftAreaW = computed(() => shiftAreaChart.padL + shiftAreaChart.padR + Math.max(1, areasByShift.value.length) * SHIFT_AREA_COL_W);
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

// --- Area status board -------------------------------------------------------
// Per-pit progress vs the day's plan, shown as the "Pit performance" table between
// the "Production by excavator" and "Production by shift - area" panels. Moved here
// from the Area production page.
const fmtT = (n) => Math.round(Number(n)).toLocaleString("en-US");

// Pill text per status, shown in the Pit performance table.
const PIT_STATUS_LABEL = { ok: "ON PLAN", warn: "AT RISK", alert: "BEHIND" };

// on plan (ok) ≥100% or no plan; at risk (warn) 85–99%; behind (alert) <85%.
const statusFor = (actual, target) => {
  if (target <= 0) return "ok";
  const p = (actual / target) * 100;
  if (p >= 100) return "ok";
  if (p >= 85) return "warn";
  return "alert";
};

// PLAN per pit = the day's Plan Production total (Waste + Ore).
const dailyAreaPlan = computed(() => {
  const plans = getDatePlans(selection.date);
  const byArea = {};
  Object.entries(plans).forEach(([code, { soil, ore }]) => {
    byArea[code] = (byArea[code] || 0) + (Number(soil) || 0) + (Number(ore) || 0);
  });
  return byArea;
});

// Tonnes per pit per calendar hour (0-23), summed across both shifts.
const hourlyAreaTonnes = computed(() => {
  const byArea = new Map();
  storeAreas.value.forEach((area) => byArea.set(area, Array(24).fill(0)));
  ["Day", "Night"].forEach((shiftType) => {
    for (let hour = 0; hour < 24; hour += 1) {
      Object.values(getBucket(selection.date, shiftType, hour)).forEach((entry) => {
        const tonnes = byArea.get(entry.area);
        if (!tonnes) return;
        tonnes[hour] += entry.rows.reduce((sum, row) => sum + rowTonnes(row), 0);
      });
    }
  });
  return byArea;
});

// Cumulative tonnes by 3-hour period: [0, p1, …, p8] per pit.
const areaSeries = computed(() =>
  Array.from(hourlyAreaTonnes.value.entries()).map(([area, hourlyTonnes]) => {
    const actual = [0];
    let running = 0;
    for (let period = 0; period < 8; period += 1) {
      for (let hour = period * 3; hour < period * 3 + 3; hour += 1) running += hourlyTonnes[hour];
      actual.push(running);
    }
    return { area, target: dailyAreaPlan.value[area] ?? 0, actual };
  }),
);

const statusCounts = computed(() => {
  const counts = { ok: 0, warn: 0, alert: 0 };
  areaSeries.value.forEach((series) => {
    counts[statusFor(series.actual.at(-1), series.target)] += 1;
  });
  return counts;
});

// One row per pit, worst-vs-plan first (the board's default "deficit" order).
const areaCards = computed(() =>
  [...areaSeries.value]
    .sort((a, b) => a.actual.at(-1) - a.target - (b.actual.at(-1) - b.target))
    .map((series) => {
      const finalActual = series.actual.at(-1);
      // No plan (target ≤ 0) can't be a %, so show it as 100% on-plan.
      const achievement = series.target > 0 ? Math.round((finalActual / series.target) * 100) : 100;
      return {
        area: series.area,
        target: series.target,
        finalActual,
        achievement,
        delta: finalActual - series.target,
        status: statusFor(finalActual, series.target),
      };
    }),
);

</script>

<template>
  <div ref="dashRef" class="dash">
    <TopBar subtitle="Live" />

    <div class="dash-toolbar no-capture">
      <button class="dl-btn" type="button" :disabled="downloading" @click="downloadImage">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path
            d="M12 3v11m0 0l-4-4m4 4l4-4M5 20h14"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>{{ downloading ? "Saving…" : "Download image" }}</span>
      </button>
    </div>

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

        <div class="area-board panel">
          <div class="status-board-head">
            <h2 class="board-h">Area status board</h2>
            <div class="board-legend">
              <span class="lg-pill lg-ok">{{ statusCounts.ok }} on plan</span>
              <span class="lg-pill lg-warn">{{ statusCounts.warn }} at risk</span>
              <span class="lg-pill lg-alert">{{ statusCounts.alert }} behind</span>
            </div>
          </div>

          <div v-if="areaCards.length" class="pit-perf">
            <div class="pit-row pit-head">
              <span class="pit-c-pit">PIT</span>
              <span class="pit-c-status">STATUS</span>
              <span class="pit-c-num">ACTUAL · t</span>
              <span class="pit-c-num">PLAN · t</span>
              <span class="pit-c-bar">ACHIEVEMENT</span>
              <span class="pit-c-pct">%</span>
              <span class="pit-c-num">VARIANCE · t</span>
            </div>
            <div v-for="series in areaCards" :key="series.area" class="pit-row">
              <span class="pit-c-pit pit-code">{{ series.area }}</span>
              <span class="pit-c-status">
                <span class="pit-pill" :class="`pit-pill-${series.status}`">{{ PIT_STATUS_LABEL[series.status] }}</span>
              </span>
              <span class="pit-c-num mono">{{ fmtT(series.finalActual) }}</span>
              <span class="pit-c-num mono pit-soft">{{ fmtT(series.target) }}</span>
              <span class="pit-c-bar">
                <span class="pit-bar">
                  <span class="pit-bar-fill" :class="`pit-bar-${series.status}`" :style="{ width: `${Math.min(100, series.achievement)}%` }" />
                </span>
              </span>
              <span class="pit-c-pct mono" :class="`pit-pct-${series.status}`">{{ series.achievement }}%</span>
              <span class="pit-c-num mono" :class="series.delta >= 0 ? 'pit-pos' : 'pit-neg'">
                {{ series.delta >= 0 ? "+" : "−" }}{{ fmtT(Math.abs(series.delta)) }}
              </span>
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
            <div class="shift-area-scroll">
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

<style scoped>
/* The area status board sits in the narrow right column (col-side), between the
   excavator and shift-area panels, as a compact "Pit performance" table — one row
   per pit: code, status pill, actual, plan, achievement bar, %, and variance. */
.area-board {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.pit-perf {
  display: flex;
  flex-direction: column;
}
.pit-row {
  display: grid;
  grid-template-columns: minmax(52px, auto) minmax(58px, auto) minmax(48px, 1fr) minmax(48px, 1fr) minmax(70px, 2.2fr) 42px minmax(58px, 1fr);
  align-items: center;
  gap: 8px;
  padding: 7px 2px;
  border-bottom: 1px solid var(--line-soft);
}
.pit-head {
  border-bottom: 1px solid var(--line);
  padding-bottom: 5px;
}
.pit-row:last-child {
  border-bottom: none;
}
.pit-head span {
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-3);
  font-weight: 600;
}
.pit-c-num,
.pit-c-pct {
  text-align: right;
  white-space: nowrap;
  font-size: 12px;
  color: var(--ink);
}
.pit-soft { color: var(--ink-3); font-weight: 500; }
.pit-code {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--ink);
}
.pit-pill {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 2px 7px;
  border-radius: 999px;
  white-space: nowrap;
}
.pit-pill-ok { background: color-mix(in oklab, var(--ok) 16%, transparent); color: var(--ok); }
.pit-pill-warn { background: color-mix(in oklab, var(--warn) 16%, transparent); color: var(--warn); }
.pit-pill-alert { background: color-mix(in oklab, var(--alert) 16%, transparent); color: var(--alert); }
.pit-bar {
  display: block;
  width: 100%;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: color-mix(in oklab, var(--accent) 14%, transparent);
}
.pit-bar-fill { display: block; height: 100%; border-radius: 999px; }
.pit-bar-ok { background: var(--ok); }
.pit-bar-warn { background: var(--warn); }
.pit-bar-alert { background: var(--alert); }
.pit-pct-ok { color: var(--ok); font-weight: 700; }
.pit-pct-warn { color: var(--warn); font-weight: 700; }
.pit-pct-alert { color: var(--alert); font-weight: 700; }
.pit-pos { color: var(--ok); font-weight: 600; }
.pit-neg { color: var(--alert); font-weight: 600; }

/* Stacking the board one card per row makes the right column (col-side) tall.
   Without this the grid stretches the left column's panels to match, leaving a
   big empty white box under the Excavator detail table. Pack them to the top so
   panels keep their natural height and the leftover space is plain background. */
.col-main {
  align-content: start;
}
</style>
