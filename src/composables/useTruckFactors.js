import { computed, ref } from "vue";
import { supabase } from "../lib/supabaseClient.js";
import { useTruckModelsStore } from "../stores/truckModelsStore";

// Weekly tonnes/trip factors (the TD&MVDC value multiplied with trips). The
// factor changes every week, so it's stored as effective-dated history in the
// public.truck_model_factors table (one row per truck model per week_start =
// the Monday of the week). For any date we use the latest factor whose week
// is on/before that date's week (carry-forward), so past weeks keep their own
// factor even after the current one is changed. Falls back to the truck model's
// capacity_tonnes, then DEFAULT_TONNES_PER_TRIP, when no weekly record exists.
//
// Module-level singleton (same convention as useKpiTargets / useAreaTargets).

export const DEFAULT_TONNES_PER_TRIP = 43.7;

const truckModelsStore = useTruckModelsStore();

// All truck_model_factors rows: { id, truck_model_id, week_start, factor }.
const rows = ref([]);
const loading = ref(false);

// Monday (ISO week start) of the week containing `dateIso` (yyyy-mm-dd), as
// yyyy-mm-dd. Weeks run Mon–Sun.
export const weekStartOf = (dateIso) => {
  const d = new Date(`${dateIso}T00:00:00`);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday … 6 = Sunday
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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
// weekly record with week_start <= that date's week, else capacity_tonnes, else
// the default.
export const factorFor = (code, dateIso) => {
  const ws = weekStartOf(dateIso);
  const list = historyByCode.value[code] || [];
  let chosen = null;
  for (const rec of list) {
    if (rec.week_start <= ws) chosen = rec;
    else break;
  }
  if (chosen) return chosen.factor;
  const cap = capacityByCode.value[code];
  return cap > 0 ? cap : DEFAULT_TONNES_PER_TRIP;
};

// Full weekly history for a model, newest week first (for the history view).
export const historyFor = (code) => [...(historyByCode.value[code] || [])].reverse();

// Set (or clear) a truck model's factor for a given week. Blank / non-positive
// removes that week's override (so it carries forward the previous week again).
export const setWeekFactor = async (code, weekStart, rawValue) => {
  const modelId = modelIdByCode.value[code];
  if (!modelId) return false;
  const num = rawValue === "" || rawValue == null ? null : Number(rawValue);
  const factor = num != null && Number.isFinite(num) && num > 0 ? num : null;

  if (factor == null) {
    await supabase.from("truck_model_factors").delete().eq("truck_model_id", modelId).eq("week_start", weekStart);
  } else {
    await supabase
      .from("truck_model_factors")
      .upsert({ truck_model_id: modelId, week_start: weekStart, factor }, { onConflict: "truck_model_id,week_start" });
  }
  await load();
  return true;
};

export const useTruckFactors = () => ({
  rows,
  loading,
  weekStartOf,
  factorFor,
  historyFor,
  setWeekFactor,
  reload: load,
});
