import { ref } from "vue";
import { supabase } from "../lib/supabaseClient.js";

// "App Area" master — the mine's top-level pit names (Copper Pit, Gold Pit, …),
// edited on Settings → App Area and used as the Area dropdown of the Rainfall step
// on Data entry (rain covers a whole pit, not a single NLU03A-style pattern code,
// which is what mining_areas holds).
//
// Names keep the case they were typed in (unlike mining codes, which are uppercased)
// because they read as words, not codes. Module-level singleton so every page shares
// one reactive list, mirroring useMiningAreas' convention.

// Shown until the first load resolves, and kept as the list when the app_areas
// migration (supabase/app_areas.sql) hasn't been run yet — so the Rainfall dropdown
// is never empty. An empty list AFTER a successful load is a real, respected state.
const FALLBACK_AREAS = ["Copper Pit", "Gold Pit"];

const areas = ref([...FALLBACK_AREAS]);
const idByName = new Map();
// True while the table is missing: the Settings tab then says so instead of
// pretending the edits were saved.
const tableMissing = ref(false);

const isMissingTableError = (error) =>
  !!error &&
  (error.code === "42P01" ||
    error.code === "PGRST205" ||
    /could not find the table|does not exist/i.test(error.message || ""));

const sortAreas = () => {
  areas.value = [...areas.value].sort((a, b) => a.localeCompare(b));
};

const load = async () => {
  const { data, error } = await supabase.from("app_areas").select("id, name").eq("active", true);
  if (isMissingTableError(error)) {
    tableMissing.value = true;
    return;
  }
  if (error) return;
  tableMissing.value = false;
  idByName.clear();
  data.forEach((row) => idByName.set(row.name, row.id));
  areas.value = data.map((row) => row.name);
  sortAreas();
};

load();

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const useAppAreas = () => {
  // Add a pit name. Re-adding one that was removed earlier revives the same row
  // (upsert on the unique name) instead of failing on the unique constraint.
  const addArea = async (value) => {
    const name = String(value ?? "").trim();
    if (!name) return { ok: false, reason: "empty", area: name };
    if (areas.value.some((area) => sameName(area, name))) return { ok: false, reason: "duplicate", area: name };

    areas.value = [...areas.value, name];
    sortAreas();

    if (tableMissing.value) return { ok: true, reason: "added", area: name };
    const { data, error } = await supabase
      .from("app_areas")
      .upsert({ name, active: true, updated_at: new Date().toISOString() }, { onConflict: "name" })
      .select("id")
      .single();
    if (isMissingTableError(error)) tableMissing.value = true;
    else if (!error && data) idByName.set(name, data.id);
    return { ok: true, reason: "added", area: name };
  };

  const updateArea = async (oldValue, nextValue) => {
    const oldName = String(oldValue ?? "").trim();
    const nextName = String(nextValue ?? "").trim();
    if (!oldName || !nextName) return { ok: false, reason: "empty", area: nextName };
    if (oldName === nextName) return { ok: true, reason: "same", area: nextName };
    if (areas.value.some((area) => area !== oldName && sameName(area, nextName))) return { ok: false, reason: "duplicate", area: nextName };

    areas.value = areas.value.map((area) => (area === oldName ? nextName : area));
    sortAreas();

    const id = idByName.get(oldName);
    idByName.delete(oldName);
    if (id && !tableMissing.value) {
      idByName.set(nextName, id);
      const { error } = await supabase.from("app_areas").update({ name: nextName, updated_at: new Date().toISOString() }).eq("id", id);
      if (isMissingTableError(error)) tableMissing.value = true;
    }
    // Renaming only changes the dropdown from here on: rainfall rows store the area
    // as text, so already-logged rows keep the name they were saved with.
    return { ok: true, reason: "updated", area: nextName, oldArea: oldName };
  };

  // Soft delete, like the other masters: the name drops out of the dropdown but the
  // row survives, so re-adding it later revives the same record.
  const removeArea = async (value) => {
    const name = String(value ?? "").trim();
    areas.value = areas.value.filter((area) => area !== name);
    const id = idByName.get(name);
    idByName.delete(name);
    if (id && !tableMissing.value) {
      const { error } = await supabase.from("app_areas").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
      if (isMissingTableError(error)) tableMissing.value = true;
    }
    return { ok: true, reason: "removed", area: name };
  };

  return { areas, tableMissing, addArea, updateArea, removeArea, reload: load };
};
