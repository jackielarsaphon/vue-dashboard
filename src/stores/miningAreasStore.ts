import { createTableStore } from "./createTableStore.js";

// Matches public.mining_areas — MiningArea.vue (full CRUD), DataEntry.vue/
// FleetOverview.vue/AreaProduction.vue (read-only, dropdown options).
export interface MiningAreaRow {
  id: string;
  code: string;
  name: string | null;
  active: boolean;
  created_at: string;
}

const store = createTableStore<MiningAreaRow>({ table: "mining_areas", orderBy: "code" });

export const useMiningAreasStore = () => store;
