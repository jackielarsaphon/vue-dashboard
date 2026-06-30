import { createTableStore } from "./createTableStore.js";

// Matches public.placement_shift_excavator — a per-shift OVERRIDE of which
// excavator a placement (area_excavators row) represents. With it, the same
// (pit, excavator) placement can show as a different excavator on Day vs Night, so
// relabelling a unit on one shift never touches the other. No row → use the base
// area_excavators.excavator_id. See supabase/placement_shift_excavator.sql.
export interface PlacementShiftExcavatorRow {
  id: string;
  placement_id: string;
  shift_type: "Day" | "Night";
  excavator_id: string;
  created_at: string;
  updated_at: string;
}

const store = createTableStore<PlacementShiftExcavatorRow>({ table: "placement_shift_excavator", orderBy: "created_at" });

export const usePlacementShiftExcavatorStore = () => store;
