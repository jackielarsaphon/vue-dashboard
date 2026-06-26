import { ref, watch } from "vue";
import { supabase } from "../lib/supabaseClient.js";
import { useShiftSelection } from "./useShiftSelection.js";
import { useEntryStore } from "./useEntryStore.js";

// Persistence + reads for the "Plan Production" step on the Data entry page.
// Each plan row is one pattern/pit (a free-form code typed in the search box)
// with a soil (waste) and ore tonnage target, stored in public.production_plans.
//
// Plan Production is ONE daily plan shared by both shifts: editing and the PLAN
// figure cover the whole date, not a single shift. Rows still hang off a shift_id
// (the schema requires it), so new plans are written to a canonical shift for the
// date and reads merge both shifts — that keeps the daily total from being either
// hidden on the unselected shift or double-counted across the two.
//
// Module-level singleton state so DataEntry (editing) and FleetOverview (the PLAN
// figure) share one reactive cache, mirroring useEntryStore's convention.

const { selection } = useShiftSelection();
const { ensureShift } = useEntryStore();

// New daily plans are stored against this shift; the other shift is kept empty.
const CANONICAL_SHIFT = "Day";
const OTHER_SHIFT = "Night";

const planKey = (date, shiftType) => `${date}_${shiftType}`;

// { [date_shiftType]: { [patternCode]: { soil, ore } } }
const plansByKey = ref({});
const loading = ref(false);

// Loads both shifts for a calendar date in one query, re-grouped by
// date_shiftType -> { patternCode: { soil, ore } } so reads stay synchronous.
const fetchPlans = async (date) => {
  loading.value = true;

  const { data: shifts, error: shiftError } = await supabase.from("shifts").select("id, shift_type").eq("shift_date", date);
  const shiftTypeById = shiftError ? {} : Object.fromEntries((shifts || []).map((row) => [row.id, row.shift_type]));
  const shiftIds = Object.keys(shiftTypeById);

  const next = { [planKey(date, "Day")]: {}, [planKey(date, "Night")]: {} };

  if (shiftIds.length) {
    const { data, error } = await supabase
      .from("production_plans")
      .select("shift_id, pattern_code, soil_tonnes, ore_tonnes")
      .in("shift_id", shiftIds);

    if (!error && data) {
      data.forEach((row) => {
        const shiftType = shiftTypeById[row.shift_id];
        if (!shiftType) return;
        const bucket = next[planKey(date, shiftType)] || (next[planKey(date, shiftType)] = {});
        bucket[row.pattern_code] = { soil: Number(row.soil_tonnes) || 0, ore: Number(row.ore_tonnes) || 0 };
      });
    }
  }

  plansByKey.value = { ...plansByKey.value, ...next };
  loading.value = false;
};

watch(() => selection.date, (date) => fetchPlans(date), { immediate: true });

const getPlans = (date, shiftType) => plansByKey.value[planKey(date, shiftType)] || {};

// The daily plan: both shifts merged into one map (pattern -> { soil, ore }). New
// plans live on the canonical shift only, but reads merge both so any older
// per-shift data still shows and sums correctly (duplicates are added together).
const getDatePlans = (date) => {
  const merged = {};
  ["Day", "Night"].forEach((shiftType) => {
    Object.entries(getPlans(date, shiftType)).forEach(([code, { soil, ore }]) => {
      const cur = merged[code] || { soil: 0, ore: 0 };
      merged[code] = { soil: cur.soil + soil, ore: cur.ore + ore };
    });
  });
  return merged;
};

// Total planned tonnage (soil + ore across every pattern) for the whole date —
// both shifts combined — which is what FleetOverview shows as PLAN.
const planTonnesForDate = (date) =>
  Object.values(getDatePlans(date)).reduce((sum, row) => sum + row.soil + row.ore, 0);
// Waste (soil) / ORE split of the daily plan, for the KPI-card targets.
const planMaterialTotalsForDate = (date) =>
  Object.values(getDatePlans(date)).reduce(
    (acc, row) => ({ waste: acc.waste + row.soil, ore: acc.ore + row.ore }),
    { waste: 0, ore: 0 },
  );
const patternCountForDate = (date) => Object.keys(getDatePlans(date)).length;

// Delete one pattern's plan row from a specific (date, shift) in the database.
const deletePatternFromShift = async (date, shiftType, code) => {
  const { data: shift } = await supabase
    .from("shifts")
    .select("id")
    .eq("shift_date", date)
    .eq("shift_type", shiftType)
    .maybeSingle();
  if (shift) {
    await supabase.from("production_plans").delete().eq("shift_id", shift.id).eq("pattern_code", code);
  }
};

// Upsert one pattern's soil/ore into the daily plan for the selected date. The
// plan covers both shifts, so it's always written to the canonical shift (not the
// currently selected one); any stale copy of the pattern on the other shift is
// dropped so the merged daily total isn't doubled.
const savePlan = async (patternCode, { soil = 0, ore = 0 } = {}) => {
  const code = String(patternCode || "").trim();
  if (!code) return false;

  const shiftId = await ensureShift(selection.date, CANONICAL_SHIFT);
  if (!shiftId) return false;

  const { error } = await supabase
    .from("production_plans")
    .upsert(
      { shift_id: shiftId, pattern_code: code, soil_tonnes: Number(soil) || 0, ore_tonnes: Number(ore) || 0, updated_at: new Date().toISOString() },
      { onConflict: "shift_id,pattern_code" },
    );
  if (error) return false;

  const canonicalKey = planKey(selection.date, CANONICAL_SHIFT);
  const otherKey = planKey(selection.date, OTHER_SHIFT);
  const otherBucket = { ...(plansByKey.value[otherKey] || {}) };
  // Consolidate onto the canonical shift if an older copy lives on the other one.
  if (code in otherBucket) {
    delete otherBucket[code];
    await deletePatternFromShift(selection.date, OTHER_SHIFT, code);
  }

  plansByKey.value = {
    ...plansByKey.value,
    [canonicalKey]: { ...(plansByKey.value[canonicalKey] || {}), [code]: { soil: Number(soil) || 0, ore: Number(ore) || 0 } },
    [otherKey]: otherBucket,
  };
  return true;
};

// Remove one pattern from the daily plan (both shifts) for the selected date.
const removePlan = async (patternCode) => {
  const code = String(patternCode || "").trim();
  if (!code) return;

  await Promise.all(["Day", "Night"].map((shiftType) => deletePatternFromShift(selection.date, shiftType, code)));

  const next = { ...plansByKey.value };
  ["Day", "Night"].forEach((shiftType) => {
    const key = planKey(selection.date, shiftType);
    if (next[key] && code in next[key]) {
      const bucket = { ...next[key] };
      delete bucket[code];
      next[key] = bucket;
    }
  });
  plansByKey.value = next;
};

export const usePlanProduction = () => ({
  loading,
  getDatePlans,
  planTonnesForDate,
  planMaterialTotalsForDate,
  patternCountForDate,
  savePlan,
  removePlan,
  reloadPlans: () => fetchPlans(selection.date),
});
