import { createTableStore } from "./createTableStore.js";

// Matches public.dumping_areas — DumpingArea.vue (full CRUD).
export interface DumpingAreaRow {
  id: string;
  code: string;
  mining_area_id: string | null;
  active: boolean;
  created_at: string;
}

const store = createTableStore<DumpingAreaRow>({ table: "dumping_areas", orderBy: "code" });

export const useDumpingAreasStore = () => store;
