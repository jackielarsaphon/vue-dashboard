import { computed, ref, watch } from "vue";
import { supabase } from "../lib/supabaseClient.js";
import { createDateLoader } from "../lib/dateLoader.js";
import { PRELOAD_DAYS } from "../lib/recentDates.js";
import { KPI_TARGETS } from "../data/targets.js";
import { shiftIndexForDates } from "./useShiftIds.js";
import { useShiftSelection } from "./useShiftSelection.js";

// Top KPI-card targets (Total Production / Waste / ORE tonnes), read from
// public.shift_kpi_targets for the selected calendar date (summed across both
// shifts). Falls back to the KPI_TARGETS constant per category when the
// database has no row, so the cards keep showing a target before any are
// entered. Module-level singleton, shared via useEntryStore.totals.

const { selection } = useShiftSelection();

// { [date]: { production, waste, ore } } — kept per date so switching back to a date
// already loaded needs no query (see dateLoader.js).
const targetsByDate = ref({});
const loading = ref(false);

// The selected date's targets, falling back to the constants until it has loaded.
const targetsByCategory = computed(() => targetsByDate.value[selection.date] || { ...KPI_TARGETS });

// One query for every date asked for; the opening batch (usePreloadDates) hands over
// the whole recent window so switching dates later needs none.
const fetchDatesTargets = async (dateList, { skipLoaded = false } = {}) => {
  const dates = [...new Set(dateList)].filter(Boolean).sort();
  if (!dates.length) return;
  loading.value = true;

  const { ids: shiftIds, dateById } = await shiftIndexForDates(dates);

  // date -> { sums, any }
  const perDate = {};
  dates.forEach((date) => {
    perDate[date] = { sums: { production: 0, waste: 0, ore: 0 }, any: { production: false, waste: false, ore: false } };
  });

  if (shiftIds.length) {
    const { data, error } = await supabase
      .from("shift_kpi_targets")
      .select("shift_id, category, target_tonnes")
      .in("shift_id", shiftIds);

    if (!error && data) {
      data.forEach((row) => {
        const bucket = perDate[dateById[row.shift_id]];
        if (!bucket || !(row.category in bucket.sums)) return;
        bucket.sums[row.category] += Number(row.target_tonnes) || 0;
        bucket.any[row.category] = true;
      });
    }
  }

  // Use the DB sum where at least one row exists for that category, else the
  // legacy constant fallback.
  const commit = dates.filter((d) => !(skipLoaded && loader.isLoaded(d)));
  const next = { ...targetsByDate.value };
  commit.forEach((date) => {
    const { sums, any } = perDate[date];
    next[date] = {
      production: any.production ? sums.production : KPI_TARGETS.production,
      waste: any.waste ? sums.waste : KPI_TARGETS.waste,
      ore: any.ore ? sums.ore : KPI_TARGETS.ore,
    };
    if (skipLoaded) loader.markLoaded(date);
  });
  targetsByDate.value = next;
  loading.value = false;
};

const fetchTargets = (date) => fetchDatesTargets([date]);

const loader = createDateLoader({
  load: fetchTargets,
  keep: PRELOAD_DAYS + 3,
  onEvict: (date) => {
    const next = { ...targetsByDate.value };
    delete next[date];
    targetsByDate.value = next;
  },
});

watch(() => selection.date, (date) => loader.request(date), { immediate: true });

export const useKpiTargets = () => ({
  targetsByCategory,
  loading,
  reload: () => loader.request(selection.date, { force: true }),
  preloadDates: (dates) => fetchDatesTargets(dates, { skipLoaded: true }),
});
