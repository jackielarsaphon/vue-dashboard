import { createTableStore } from "./createTableStore.js";

// Matches public.materials — Material.vue (full CRUD), DataEntry.vue/
// FleetOverview.vue/AreaProduction.vue (read-only, dropdown options).
export interface MaterialRow {
  id: string;
  code: string;
  is_waste: boolean;
  description: string | null;
  active: boolean;
  created_at: string;
}

const store = createTableStore<MaterialRow>({ table: "materials", orderBy: "code" });

export const useMaterialsStore = () => store;
