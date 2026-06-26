import { ref, watch } from "vue";
import { supabase } from "../lib/supabaseClient.js";
import { KPI_TARGETS } from "../data/targets.js";
import { useShiftSelection } from "./useShiftSelection.js";

// Top KPI-card targets (Total Production / Waste / ORE tonnes), read from
// public.shift_kpi_targets for the selected calendar date (summed across both
// shifts). Falls back to the KPI_TARGETS constant per category when the
// database has no row, so the cards keep showing a target before any are
// entered. Module-level singleton, shared via useEntryStore.totals.

const { selection } = useShiftSelection();

// { production, waste, ore } tonnes for the currently loaded date.
const targetsByCategory = ref({ ...KPI_TARGETS });
const loading = ref(false);

const fetchTargets = async (date) => {
  loading.value = true;

  const { data: shifts, error: shiftError } = await supabase.from("shifts").select("id").eq("shift_date", date);
  const shiftIds = shiftError ? [] : (shifts || []).map((row) => row.id);

  const sums = { production: 0, waste: 0, ore: 0 };
  let any = { production: false, waste: false, ore: false };

  if (shiftIds.length) {
    const { data, error } = await supabase
      .from("shift_kpi_targets")
      .select("category, target_tonnes")
      .in("shift_id", shiftIds);

    if (!error && data) {
      data.forEach((row) => {
        if (!(row.category in sums)) return;
        sums[row.category] += Number(row.target_tonnes) || 0;
        any[row.category] = true;
      });
    }
  }

  // Use the DB sum where at least one row exists for that category, else the
  // legacy constant fallback.
  targetsByCategory.value = {
    production: any.production ? sums.production : KPI_TARGETS.production,
    waste: any.waste ? sums.waste : KPI_TARGETS.waste,
    ore: any.ore ? sums.ore : KPI_TARGETS.ore,
  };
  loading.value = false;
};

watch(() => selection.date, (date) => fetchTargets(date), { immediate: true });

export const useKpiTargets = () => ({
  targetsByCategory,
  loading,
  reload: () => fetchTargets(selection.date),
});
