import { computed, ref, watch } from "vue";
import { supabase } from "../lib/supabaseClient.js";
import { createDateLoader } from "../lib/dateLoader.js";
import { PRELOAD_DAYS } from "../lib/recentDates.js";
import { AREA_TARGETS, DEFAULT_AREA_TARGET } from "../data/targets.js";
import { shiftIndexForDates } from "./useShiftIds.js";
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

// { [date]: { [areaCode]: tonnes } } — kept per date so switching back to a date
// already loaded needs no query (see dateLoader.js).
const targetsByDate = ref({});
const loading = ref(false);

// The selected date's map — what areaTarget() reads.
const targetsByCode = computed(() => targetsByDate.value[selection.date] || {});

// One query for every date asked for; the opening batch (usePreloadDates) hands over
// the whole recent window so switching dates later needs none.
const fetchDatesTargets = async (dateList, { skipLoaded = false } = {}) => {
  const dates = [...new Set(dateList)].filter(Boolean).sort();
  if (!dates.length) return;
  loading.value = true;

  const [, { ids: shiftIds, dateById }] = await Promise.all([miningAreasStore.load(), shiftIndexForDates(dates)]);

  const perDate = {};
  dates.forEach((date) => {
    perDate[date] = {};
  });

  if (shiftIds.length) {
    const { data, error } = await supabase
      .from("area_targets")
      .select("shift_id, mining_area_id, target_tonnes")
      .in("shift_id", shiftIds);

    if (!error && data) {
      data.forEach((row) => {
        const bucket = perDate[dateById[row.shift_id]];
        const code = codeById.value[row.mining_area_id];
        if (!bucket || !code) return;
        bucket[code] = (bucket[code] || 0) + (Number(row.target_tonnes) || 0);
      });
    }
  }

  const commit = dates.filter((d) => !(skipLoaded && loader.isLoaded(d)));
  const next = { ...targetsByDate.value };
  commit.forEach((date) => {
    next[date] = perDate[date];
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
  reload: () => loader.request(selection.date, { force: true }),
  preloadDates: (dates) => fetchDatesTargets(dates, { skipLoaded: true }),
});
