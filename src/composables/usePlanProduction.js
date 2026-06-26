import { ref, watch } from "vue";
import { supabase } from "../lib/supabaseClient.js";
import { useShiftSelection } from "./useShiftSelection.js";
import { useEntryStore } from "./useEntryStore.js";

// Persistence + reads for the "Plan Production" step on the Data entry page.
// Each plan row is one pattern/pit (a free-form code typed in the search box)
// for a (date, shift) with a soil (waste) and ore tonnage target, stored in
// public.production_plans. Module-level singleton state so DataEntry (editing)
// and FleetOverview (the PLAN figure) share one reactive cache, mirroring
// useEntryStore's convention.

const { selection } = useShiftSelection();
const { ensureShift } = useEntryStore();

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

// Total planned tonnage (soil + ore across every pattern) for a shift, and for
// a whole date (both shifts) — what FleetOverview shows as PLAN.
const planTonnesForShift = (date, shiftType) =>
  Object.values(getPlans(date, shiftType)).reduce((sum, row) => sum + row.soil + row.ore, 0);
const planTonnesForDate = (date) => planTonnesForShift(date, "Day") + planTonnesForShift(date, "Night");
const patternCount = (date, shiftType) => Object.keys(getPlans(date, shiftType)).length;

// Upsert one pattern's soil/ore for the current selection's date + shift.
const savePlan = async (patternCode, { soil = 0, ore = 0 } = {}) => {
  const code = String(patternCode || "").trim();
  if (!code) return false;

  const shiftId = await ensureShift(selection.date, selection.shiftType);
  if (!shiftId) return false;

  const { error } = await supabase
    .from("production_plans")
    .upsert(
      { shift_id: shiftId, pattern_code: code, soil_tonnes: Number(soil) || 0, ore_tonnes: Number(ore) || 0, updated_at: new Date().toISOString() },
      { onConflict: "shift_id,pattern_code" },
    );
  if (error) return false;

  const key = planKey(selection.date, selection.shiftType);
  plansByKey.value = {
    ...plansByKey.value,
    [key]: { ...(plansByKey.value[key] || {}), [code]: { soil: Number(soil) || 0, ore: Number(ore) || 0 } },
  };
  return true;
};

// Remove one pattern from the current selection's date + shift.
const removePlan = async (patternCode) => {
  const code = String(patternCode || "").trim();
  const key = planKey(selection.date, selection.shiftType);

  const { data: shift } = await supabase
    .from("shifts")
    .select("id")
    .eq("shift_date", selection.date)
    .eq("shift_type", selection.shiftType)
    .maybeSingle();
  if (shift) {
    await supabase.from("production_plans").delete().eq("shift_id", shift.id).eq("pattern_code", code);
  }

  const bucket = { ...(plansByKey.value[key] || {}) };
  delete bucket[code];
  plansByKey.value = { ...plansByKey.value, [key]: bucket };
};

export const usePlanProduction = () => ({
  loading,
  getPlans,
  planTonnesForShift,
  planTonnesForDate,
  patternCount,
  savePlan,
  removePlan,
  reloadPlans: () => fetchPlans(selection.date),
});
