import { ref } from "vue";
import { supabase } from "../lib/supabaseClient.js";

const normalizeDump = (value) => value.trim().toUpperCase();

const dumps = ref([]);
const idByCode = new Map();

const sortDumps = () => {
  dumps.value = [...dumps.value].sort((a, b) => a.localeCompare(b));
};

const load = async () => {
  const { data, error } = await supabase.from("dumping_areas").select("id, code").eq("active", true).is("mining_area_id", null);
  if (error) return;
  idByCode.clear();
  data.forEach((row) => idByCode.set(row.code, row.id));
  dumps.value = data.map((row) => row.code);
  sortDumps();
};

load();

export const useDumpingAreas = () => {
  const addDump = (value) => {
    const dump = normalizeDump(value);
    if (!dump || dumps.value.includes(dump)) return dump;
    dumps.value = [...dumps.value, dump];
    sortDumps();
    supabase
      .from("dumping_areas")
      .insert({ code: dump })
      .select("id")
      .single()
      .then(({ data, error }) => {
        if (!error && data) idByCode.set(dump, data.id);
      });
    return dump;
  };

  const updateDump = (oldValue, nextValue) => {
    const oldDump = normalizeDump(oldValue);
    const nextDump = normalizeDump(nextValue);
    if (!oldDump || !nextDump) return { ok: false, reason: "empty", dump: nextDump };
    if (oldDump === nextDump) return { ok: true, reason: "same", dump: nextDump };
    if (dumps.value.includes(nextDump)) return { ok: false, reason: "duplicate", dump: nextDump };

    dumps.value = dumps.value.map((dump) => (dump === oldDump ? nextDump : dump));
    sortDumps();
    const id = idByCode.get(oldDump);
    idByCode.delete(oldDump);
    if (id) {
      idByCode.set(nextDump, id);
      supabase.from("dumping_areas").update({ code: nextDump }).eq("id", id).then(() => {});
    }
    return { ok: true, reason: "updated", dump: nextDump, oldDump };
  };

  const removeDump = (value) => {
    const dump = normalizeDump(value);
    dumps.value = dumps.value.filter((item) => item !== dump);
    const id = idByCode.get(dump);
    idByCode.delete(dump);
    if (id) supabase.from("dumping_areas").delete().eq("id", id).then(() => {});
  };

  return { dumps, addDump, updateDump, removeDump };
};
