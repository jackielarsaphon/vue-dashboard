import { computed, ref } from "vue";
import { supabase } from "../lib/supabaseClient.js";
import { useTruckModelsStore } from "../stores/truckModelsStore";

// Effective-dated tonnes/trip factors (the TD&MVDC value multiplied with trips).
// The legacy database column is named `week_start`, but it stores the exact date
// chosen by the user. For any date we use the latest factor whose effective date
// is on/before it (carry-forward), so historical tonnes stay unchanged. Falls
// back to capacity_tonnes, then DEFAULT_TONNES_PER_TRIP, when no record exists.
//
// Module-level singleton (same convention as useKpiTargets / useAreaTargets).

export const DEFAULT_TONNES_PER_TRIP = 43.7;

const truckModelsStore = useTruckModelsStore();

// All truck_model_factors rows: { id, truck_model_id, week_start, factor }.
const rows = ref([]);
const loading = ref(false);

const load = async () => {
  loading.value = true;
  const { data, error } = await supabase.from("truck_model_factors").select("*").order("week_start", { ascending: true });
  loading.value = false;
  rows.value = error ? [] : data ?? [];
};
load();

const modelIdByCode = computed(() => Object.fromEntries(truckModelsStore.items.value.map((row) => [row.code, row.id])));
const modelCodeById = computed(() => Object.fromEntries(truckModelsStore.items.value.map((row) => [row.id, row.code])));
const capacityByCode = computed(() => Object.fromEntries(truckModelsStore.items.value.map((row) => [row.code, Number(row.capacity_tonnes) || 0])));

// code -> [{ week_start, factor, id }] sorted ascending by week_start.
const historyByCode = computed(() => {
  const map = {};
  rows.value.forEach((row) => {
    const code = modelCodeById.value[row.truck_model_id];
    if (!code) return;
    (map[code] || (map[code] = [])).push({ id: row.id, week_start: row.week_start, factor: Number(row.factor) });
  });
  Object.values(map).forEach((list) => list.sort((a, b) => a.week_start.localeCompare(b.week_start)));
  return map;
});

// Effective tonnes/trip factor for a truck model on a given date: the latest
// dated record on/before that exact date, else capacity_tonnes, else the default.
export const factorFor = (code, dateIso) => {
  const list = historyByCode.value[code] || [];
  let chosen = null;
  for (const rec of list) {
    if (rec.week_start <= dateIso) chosen = rec;
    else break;
  }
  if (chosen) return chosen.factor;
  const cap = capacityByCode.value[code];
  return cap > 0 ? cap : DEFAULT_TONNES_PER_TRIP;
};

// Full effective-date history for a model, newest date first.
export const historyFor = (code) => [...(historyByCode.value[code] || [])].reverse();

// Set (or clear) a factor for an exact effective date. The `week_start` column
// name remains for compatibility with the existing database.
export const setFactorForDate = async (code, effectiveDate, rawValue) => {
  const modelId = modelIdByCode.value[code];
  if (!modelId) return false;
  const num = rawValue === "" || rawValue == null ? null : Number(rawValue);
  const factor = num != null && Number.isFinite(num) && num > 0 ? num : null;

  if (factor == null) {
    await supabase.from("truck_model_factors").delete().eq("truck_model_id", modelId).eq("week_start", effectiveDate);
  } else {
    await supabase
      .from("truck_model_factors")
      .upsert({ truck_model_id: modelId, week_start: effectiveDate, factor }, { onConflict: "truck_model_id,week_start" });
  }
  await load();
  return true;
};

export const useTruckFactors = () => ({
  rows,
  loading,
  factorFor,
  historyFor,
  setFactorForDate,
  reload: load,
});
