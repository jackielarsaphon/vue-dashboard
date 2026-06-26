import { computed, ref, watch } from "vue";
import { supabase } from "../lib/supabaseClient.js";
import { AREA_TARGETS, DEFAULT_AREA_TARGET } from "../data/targets.js";
import { useShiftSelection } from "./useShiftSelection.js";
import { useMiningAreasStore } from "./../stores/miningAreasStore";

// Per-area production targets (tonnes), read from public.area_targets for the
// selected calendar date (summed across both shifts). Replaces the static
// AREA_TARGETS map for AreaProduction/FleetOverview. When the database has no
// row for an area, falls back to the AREA_TARGETS constant (then
// DEFAULT_AREA_TARGET) so the dashboards keep working before targets are
// entered. Module-level singleton, mirroring usePlanProduction's convention.

const { selection } = useShiftSelection();
const miningAreasStore = useMiningAreasStore();

const codeById = computed(() => Object.fromEntries(miningAreasStore.items.value.map((row) => [row.id, row.code])));

// { [areaCode]: tonnes } for the currently loaded date.
const targetsByCode = ref({});
const loading = ref(false);

const fetchTargets = async (date) => {
  loading.value = true;

  await miningAreasStore.load();

  const { data: shifts, error: shiftError } = await supabase.from("shifts").select("id").eq("shift_date", date);
  const shiftIds = shiftError ? [] : (shifts || []).map((row) => row.id);

  const next = {};
  if (shiftIds.length) {
    const { data, error } = await supabase
      .from("area_targets")
      .select("mining_area_id, target_tonnes")
      .in("shift_id", shiftIds);

    if (!error && data) {
      data.forEach((row) => {
        const code = codeById.value[row.mining_area_id];
        if (!code) return;
        next[code] = (next[code] || 0) + (Number(row.target_tonnes) || 0);
      });
    }
  }

  targetsByCode.value = next;
  loading.value = false;
};

watch(() => selection.date, (date) => fetchTargets(date), { immediate: true });

// DB value first, then the legacy constant, then the global default.
const areaTarget = (code) => {
  const fromDb = targetsByCode.value[code];
  if (fromDb != null && fromDb > 0) return fromDb;
  return AREA_TARGETS[code] ?? DEFAULT_AREA_TARGET;
};

export const useAreaTargets = () => ({
  targetsByCode,
  loading,
  areaTarget,
  reload: () => fetchTargets(selection.date),
});
