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

// { [date_shiftType]: { [patternCode]: { soil, ore, priority } } }
const plansByKey = ref({});
// Carry-forward defaults for hand-set Priority, per date: { [date]: { [code]: priority } }.
// The most recent PRIOR day's priority per pattern — shown as the default until a day
// sets its own. Display only: getDatePlans falls back to it, but nothing is persisted
// until the user edits the Priority field (see DataEntry persistSelectedPit).
const carriedPriorityByDate = ref({});
const loading = ref(false);

// Priority lives in its own table (plan_priorities). If the migration hasn't run
// yet, stop querying / writing it so we don't spam errors; the plan still works,
// priority just stays blank until the table exists.
let planPrioritiesMissing = false;
const isMissingTableError = (error) =>
  !!error &&
  (error.code === "42P01" ||
    error.code === "PGRST205" ||
    /could not find the table|does not exist/i.test(error.message || ""));

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
        // priority tri-state: undefined = no plan_priorities record (eligible for
        // carry-forward) · null = explicitly cleared this day (stays blank) · number = own.
        bucket[row.pattern_code] = { soil: Number(row.soil_tonnes) || 0, ore: Number(row.ore_tonnes) || 0, priority: undefined };
      });
    }

    // Hand-set priorities for the same (shift, pattern), from the separate table.
    if (!planPrioritiesMissing) {
      const { data: prio, error: prioError } = await supabase
        .from("plan_priorities")
        .select("shift_id, pattern_code, priority")
        .in("shift_id", shiftIds);
      if (isMissingTableError(prioError)) {
        planPrioritiesMissing = true;
      } else if (!prioError && prio) {
        prio.forEach((row) => {
          const shiftType = shiftTypeById[row.shift_id];
          if (!shiftType) return;
          const bucket = next[planKey(date, shiftType)] || (next[planKey(date, shiftType)] = {});
          const entry = bucket[row.pattern_code] || (bucket[row.pattern_code] = { soil: 0, ore: 0, priority: undefined });
          // A row that EXISTS records the state: null = explicit clear, number = own.
          entry.priority = row.priority == null ? null : Number(row.priority);
        });
      }
    }
  }

  // Carry-forward: the most recent PRIOR day's priority STATE per pattern. Two steps
  // (no FK embedding needed): prior shifts, then their priorities; for each pattern
  // keep the record from the latest prior shift_date — a number carries the value, a
  // null (explicit clear on a later day) carries "blank" and thus overrides an older
  // value. Forward-only across dates; a day never inherits from a later one.
  const carried = {}; // code -> number (carry value) | null (carry blank)
  if (!planPrioritiesMissing) {
    const { data: priorShifts, error: priorShiftErr } = await supabase
      .from("shifts")
      .select("id, shift_date")
      .lt("shift_date", date);
    if (!priorShiftErr && priorShifts && priorShifts.length) {
      const dateById = Object.fromEntries(priorShifts.map((s) => [s.id, s.shift_date]));
      const { data: priorPrio, error: priorPrioErr } = await supabase
        .from("plan_priorities")
        .select("shift_id, pattern_code, priority")
        .in(
          "shift_id",
          priorShifts.map((s) => s.id),
        );
      if (isMissingTableError(priorPrioErr)) {
        planPrioritiesMissing = true;
      } else if (priorPrio) {
        const latestByCode = {}; // pattern_code -> shift_date the chosen record came from
        priorPrio.forEach((row) => {
          const d = dateById[row.shift_id];
          if (!d) return;
          if (!latestByCode[row.pattern_code] || d > latestByCode[row.pattern_code]) {
            latestByCode[row.pattern_code] = d;
            carried[row.pattern_code] = row.priority == null ? null : Number(row.priority);
          }
        });
      }
    }
  }

  plansByKey.value = { ...plansByKey.value, ...next };
  carriedPriorityByDate.value = { ...carriedPriorityByDate.value, [date]: carried };
  loading.value = false;
};

watch(() => selection.date, (date) => fetchPlans(date), { immediate: true });

const getPlans = (date, shiftType) => plansByKey.value[planKey(date, shiftType)] || {};

// The daily plan: both shifts merged into one map (pattern -> { soil, ore }). New
// plans live on the canonical shift only, but reads merge both so any older
// per-shift data still shows and sums correctly (duplicates are added together).
const getDatePlans = (date) => {
  const carried = carriedPriorityByDate.value[date] || {};
  const merged = {};
  ["Day", "Night"].forEach((shiftType) => {
    Object.entries(getPlans(date, shiftType)).forEach(([code, { soil, ore, priority }]) => {
      const cur = merged[code] || { soil: 0, ore: 0, priority: undefined };
      // Priority lives on the canonical shift only; keep the first DEFINED state
      // (undefined = no record yet, so let the other shift / carry decide).
      merged[code] = { soil: cur.soil + soil, ore: cur.ore + ore, priority: cur.priority !== undefined ? cur.priority : priority };
    });
  });
  // Resolve the tri-state to the displayed value (number | null):
  //   number    -> own hand-set priority
  //   null      -> explicitly cleared this day → stays blank (does NOT carry)
  //   undefined -> no own record → fall back to the carried-forward state
  //                (carried is number to carry a value, or null to carry blank)
  Object.keys(merged).forEach((code) => {
    if (merged[code].priority === undefined) merged[code].priority = carried[code] ?? null;
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
    if (!planPrioritiesMissing) {
      const { error } = await supabase.from("plan_priorities").delete().eq("shift_id", shift.id).eq("pattern_code", code);
      if (isMissingTableError(error)) planPrioritiesMissing = true;
    }
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
    [canonicalKey]: {
      ...(plansByKey.value[canonicalKey] || {}),
      // Preserve the existing priority tri-state (undefined = no record / null =
      // cleared / number = own) — saving soil/ore must neither wipe it nor turn a
      // "no record" into an explicit clear.
      [code]: { soil: Number(soil) || 0, ore: Number(ore) || 0, priority: plansByKey.value[canonicalKey]?.[code]?.priority },
    },
    [otherKey]: otherBucket,
  };
  return true;
};

// Upsert one pattern's hand-set Priority (1–4) for the selected date, on the same
// canonical shift as savePlan. Blank / out-of-range writes an EXPLICIT clear (a null
// row) so the day stays blank rather than inheriting a carried-forward value. Persists
// to plan_priorities; keeps only the optimistic cache until that table is migrated.
const savePriority = async (patternCode, value) => {
  const code = String(patternCode || "").trim();
  if (!code) return false;
  const n = value === "" || value == null ? null : Number(value);
  const priority = n != null && Number.isFinite(n) && n >= 1 && n <= 4 ? Math.round(n) : null;

  const canonicalKey = planKey(selection.date, CANONICAL_SHIFT);
  const canonicalBucket = { ...(plansByKey.value[canonicalKey] || {}) };
  canonicalBucket[code] = { ...(canonicalBucket[code] || { soil: 0, ore: 0, priority: null }), priority };
  plansByKey.value = { ...plansByKey.value, [canonicalKey]: canonicalBucket };

  if (planPrioritiesMissing) return true;
  const shiftId = await ensureShift(selection.date, CANONICAL_SHIFT);
  if (!shiftId) return false;
  // Clearing writes an explicit null row (not a delete): it records "blank for this
  // day" so getDatePlans keeps it blank instead of falling back to a carried value.
  const { error } = await supabase.from("plan_priorities").upsert(
    { shift_id: shiftId, pattern_code: code, priority, updated_at: new Date().toISOString() },
    { onConflict: "shift_id,pattern_code" },
  );
  if (isMissingTableError(error)) planPrioritiesMissing = true;
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
  savePriority,
  removePlan,
  reloadPlans: () => fetchPlans(selection.date),
});
