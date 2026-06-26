import { createTableStore } from "./createTableStore.js";

// Matches public.excavators. The live excavator roster used by DataEntry.vue/
// FleetOverview.vue/AreaProduction.vue (src/composables/useEntryStore.js) is a
// single shared roster across all dates, not partitioned per date — "deleting"
// an excavator there is a soft delete (active = false) since production_entries
// references excavator_id without cascade.
export interface ExcavatorRow {
  id: string;
  code: string;
  company: string | null;
  mining_area_id: string | null;
  truck_count: number;
  rl_meters: number | null;
  status: "ok" | "warn" | "alert";
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

const store = createTableStore<ExcavatorRow>({ table: "excavators", orderBy: "code" });

export const useExcavatorsStore = () => store;
