import { createTableStore } from "./createTableStore.js";

// Matches public.area_excavators — the per-pit placement of excavators. One
// excavator can sit in many pits (one row per pit), each with its own
// trucks/RL/note, so Data entry rows belong to a pit instead of being tied to the
// excavator's single mining_area_id. Trips stay in production_entries (which
// already carry mining_area_id). See supabase/area_excavators.sql.
export interface AreaExcavatorRow {
  id: string;
  mining_area_id: string;
  excavator_id: string;
  truck_count: number;
  rl_meters: number | null;
  status: "ok" | "warn" | "alert";
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

const store = createTableStore<AreaExcavatorRow>({ table: "area_excavators", orderBy: "created_at" });

export const useAreaExcavatorsStore = () => store;
