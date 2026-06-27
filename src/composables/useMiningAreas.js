import { ref } from "vue";
import { supabase } from "../lib/supabaseClient.js";

const normalizeArea = (value) => value.trim().toUpperCase();

const areas = ref([]);
const idByCode = new Map();

const sortAreas = () => {
  areas.value = [...areas.value].sort((a, b) => a.localeCompare(b));
};

const load = async () => {
  const { data, error } = await supabase.from("mining_areas").select("id, code").eq("active", true);
  if (error) return;
  idByCode.clear();
  data.forEach((row) => idByCode.set(row.code, row.id));
  areas.value = data.map((row) => row.code);
  sortAreas();
};

load();

export const useMiningAreas = () => {
  const addArea = (value) => {
    const area = normalizeArea(value);
    if (!area || areas.value.includes(area)) return area;
    areas.value = [...areas.value, area];
    sortAreas();
    supabase
      .from("mining_areas")
      .insert({ code: area })
      .select("id")
      .single()
      .then(({ data, error }) => {
        if (!error && data) idByCode.set(area, data.id);
      });
    return area;
  };

  const updateArea = (oldValue, nextValue) => {
    const oldArea = normalizeArea(oldValue);
    const nextArea = normalizeArea(nextValue);
    if (!oldArea || !nextArea) return { ok: false, reason: "empty", area: nextArea };
    if (oldArea === nextArea) return { ok: true, reason: "same", area: nextArea };
    if (areas.value.includes(nextArea)) return { ok: false, reason: "duplicate", area: nextArea };

    areas.value = areas.value.map((area) => (area === oldArea ? nextArea : area));
    sortAreas();
    const id = idByCode.get(oldArea);
    idByCode.delete(oldArea);
    if (id) {
      idByCode.set(nextArea, id);
      supabase.from("mining_areas").update({ code: nextArea }).eq("id", id).then(() => {});
    }
    return { ok: true, reason: "updated", area: nextArea, oldArea };
  };

  const removeArea = (value) => {
    const area = normalizeArea(value);
    areas.value = areas.value.filter((item) => item !== area);
    const id = idByCode.get(area);
    idByCode.delete(area);
    // Soft delete: production_entries.mining_area_id is ON DELETE RESTRICT, so a
    // hard delete fails (silently) once any trip references this pit, leaving the UI
    // and database out of sync. Mark inactive instead — load() only reads active
    // rows — so the removal reliably persists to the database.
    if (id) supabase.from("mining_areas").update({ active: false }).eq("id", id).then(() => {});
  };

  return { areas, addArea, updateArea, removeArea };
};
