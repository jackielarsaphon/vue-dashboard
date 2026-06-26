import { createTableStore } from "./createTableStore.js";

// Matches public.truck_models. DataEntry.vue's trip-entry grid columns now
// come from this table (via useEntryStore.js), sorted to the legacy display
// order (SKT90S, SKT105S, CAT345, VSCSDT) rather than this store's default
// alphabetical `code` ordering.
export interface TruckModelRow {
  id: string;
  code: string;
  company: string | null;
  // tonnes hauled per trip for this model (the TD&MVDC factor multiplied with
  // logged trips to get tonnes — `tonnes = trips * capacity_tonnes`). Editable on
  // the Dump model page and in the Data entry trip grid. Null falls back to the
  // DEFAULT_TONNES_PER_TRIP constant.
  capacity_tonnes: number | null;
  active: boolean;
  created_at: string;
}

const store = createTableStore<TruckModelRow>({ table: "truck_models", orderBy: "code" });

export const useTruckModelsStore = () => store;
