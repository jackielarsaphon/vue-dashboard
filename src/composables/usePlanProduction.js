import { ref, watch } from "vue";
import { supabase } from "../lib/supabaseClient.js";
import { createDateLoader } from "../lib/dateLoader.js";
import { dropDate, dropDates, keepDates } from "../lib/dropDate.js";
import { PRELOAD_DAYS } from "../lib/recentDates.js";
import { shiftIndexForDates } from "./useShiftIds.js";
import { useShiftSelection } from "./useShiftSelection.js";
import { useEntryStore } from "./useEntryStore.js";

// A query that is skipped still has to hand back the { data, error } shape.
const EMPTY_RESULT = Promise.resolve({ data: null, error: null });

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
//
// The date's own plans, its priorities and the carry-forward lookup all go out in
// one parallel wave (the shifts row itself comes from the shared cache), so a date
// costs two round trips instead of five in a row. A date already loaded costs none
// — see the loader below.
const fetchDatesPlans = async (dateList, { skipLoaded = false } = {}) => {
  const dates = [...new Set(dateList)].filter(Boolean).sort();
  if (!dates.length) return;
  loading.value = true;

  const earliest = dates[0];
  const { ids: shiftIds, typeById: shiftTypeById, dateById: shiftDateById } = await shiftIndexForDates(dates);

  const next = {};
  dates.forEach((date) => {
    next[planKey(date, "Day")] = {};
    next[planKey(date, "Night")] = {};
  });

  const [plansRes, prioRes, priorShiftsRes] = await Promise.all([
    shiftIds.length ? Promise.resolve(supabase.from("production_plans").select("shift_id, pattern_code, soil_tonnes, ore_tonnes").in("shift_id", shiftIds)) : EMPTY_RESULT,
    shiftIds.length && !planPrioritiesMissing
      ? Promise.resolve(supabase.from("plan_priorities").select("shift_id, pattern_code, priority").in("shift_id", shiftIds))
      : EMPTY_RESULT,
    // Everything before the EARLIEST date asked for: one scan covers the carry-forward
    // of every date in the batch (each date also inherits from the batch's own days,
    // added below).
    planPrioritiesMissing ? EMPTY_RESULT : Promise.resolve(supabase.from("shifts").select("id, shift_date").lt("shift_date", earliest)),
  ]);

  if (shiftIds.length) {
    const { data, error } = plansRes;

    if (!error && data) {
      data.forEach((row) => {
        const shiftType = shiftTypeById[row.shift_id];
        const rowDate = shiftDateById[row.shift_id];
        if (!shiftType || !rowDate) return;
        const bucket = next[planKey(rowDate, shiftType)] || (next[planKey(rowDate, shiftType)] = {});
        // priority tri-state: undefined = no plan_priorities record (eligible for
        // carry-forward) · null = explicitly cleared this day (stays blank) · number = own.
        bucket[row.pattern_code] = { soil: Number(row.soil_tonnes) || 0, ore: Number(row.ore_tonnes) || 0, priority: undefined };
      });
    }

    // Hand-set priorities for the same (shift, pattern), from the separate table.
    if (!planPrioritiesMissing) {
      const { data: prio, error: prioError } = prioRes;
      if (isMissingTableError(prioError)) {
        planPrioritiesMissing = true;
      } else if (!prioError && prio) {
        prio.forEach((row) => {
          const shiftType = shiftTypeById[row.shift_id];
          const rowDate = shiftDateById[row.shift_id];
          if (!shiftType || !rowDate) return;
          const bucket = next[planKey(rowDate, shiftType)] || (next[planKey(rowDate, shiftType)] = {});
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
  //
  // The prior-shifts half scans the whole history, so it is the widest read on the
  // page: one scan now serves the whole batch of dates, and each date's result is
  // then cached in carriedPriorityByDate.
  const priorRecords = []; // { date, code, priority } from days before `earliest`
  if (!planPrioritiesMissing) {
    const { data: priorShifts, error: priorShiftErr } = priorShiftsRes;
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
        priorPrio.forEach((row) => {
          const d = dateById[row.shift_id];
          if (d) priorRecords.push({ date: d, code: row.pattern_code, priority: row.priority });
        });
      }
    }
  }
  // The batch's own days are prior days to each other, so fold them in too.
  Object.entries(next).forEach(([key, bucket]) => {
    const rowDate = key.slice(0, key.indexOf("_"));
    Object.entries(bucket).forEach(([code, entry]) => {
      if (entry.priority !== undefined) priorRecords.push({ date: rowDate, code, priority: entry.priority });
    });
  });

  // Per date: the latest record STRICTLY BEFORE it wins.
  const carriedFor = (date) => {
    const latestByCode = {};
    const carried = {};
    priorRecords.forEach(({ date: d, code, priority }) => {
      if (d >= date) return;
      if (!latestByCode[code] || d > latestByCode[code]) {
        latestByCode[code] = d;
        carried[code] = priority == null ? null : Number(priority);
      }
    });
    return carried;
  };

  const commit = dates.filter((d) => !(skipLoaded && plansLoader.isLoaded(d)));
  // A late response for a date the user has already left must not land on screen.
  if ((!skipLoaded && !plansLoader.isCurrent(dates[0])) || !commit.length) {
    loading.value = false;
    return;
  }

  plansByKey.value = { ...dropDates(plansByKey.value, commit), ...keepDates(next, commit) };
  const nextCarried = { ...carriedPriorityByDate.value };
  commit.forEach((date) => {
    nextCarried[date] = carriedFor(date);
    if (skipLoaded) plansLoader.markLoaded(date);
  });
  carriedPriorityByDate.value = nextCarried;
  loading.value = false;
};

const fetchPlans = (date) => fetchDatesPlans([date]);

const forgetPlanDate = (date) => {
  plansByKey.value = dropDate(plansByKey.value, date);
  const nextCarried = { ...carriedPriorityByDate.value };
  delete nextCarried[date];
  carriedPriorityByDate.value = nextCarried;
};

const plansLoader = createDateLoader({ load: fetchPlans, onEvict: forgetPlanDate, keep: PRELOAD_DAYS + 3 });

watch(() => selection.date, (date) => plansLoader.request(date), { immediate: true });

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

// Upsert one pattern's hand-set Priority (a rank from 1 to PRIORITY_MAX) for the
// selected date, on the same canonical shift as savePlan. Blank / out-of-range writes
// an EXPLICIT clear (a null row) so the day stays blank rather than inheriting a
// carried-forward value. Persists to plan_priorities; keeps only the optimistic cache
// until that table is migrated.
//
// The ceiling matches the database check in supabase/plan_priorities.sql — a value
// above it would be rejected there, so it is clamped to a clear here instead.
export const PRIORITY_MAX = 99;

// What the Priority field keeps as the user types: digits only, no leading zeros
// ("0" and "007" are not ranks), at most two digits, and anything outside 1–PRIORITY_MAX
// clears it. Lives here so the field and savePriority can never disagree on the range.
export const toPriorityInput = (value) => {
  const digits = String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, 2)
    .replace(/^0+/, "");
  const rank = Number(digits);
  return digits && rank >= 1 && rank <= PRIORITY_MAX ? String(rank) : "";
};

const savePriority = async (patternCode, value) => {
  const code = String(patternCode || "").trim();
  if (!code) return false;
  const n = value === "" || value == null ? null : Number(value);
  const priority = n != null && Number.isFinite(n) && n >= 1 && n <= PRIORITY_MAX ? Math.round(n) : null;

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
  reloadPlans: () => plansLoader.request(selection.date, { force: true }),
  // Batch-load a CONTIGUOUS span of dates in one wave (the opening preload). The span
  // must be contiguous: each date's priority carry-forward inherits from the days
  // before it in the same batch.
  preloadDates: (dates) => fetchDatesPlans(dates, { skipLoaded: true }),
});
