import { ref } from "vue";
import { supabase } from "../lib/supabaseClient.js";

const normalizeMaterial = (value) => value.trim().toUpperCase();
const inferIsWaste = (code) => code[0] === "W";

const materials = ref([]);
const idByCode = new Map();

const sortMaterials = () => {
  materials.value = [...materials.value].sort((a, b) => a.localeCompare(b));
};

const load = async () => {
  const { data, error } = await supabase.from("materials").select("id, code").eq("active", true);
  if (error) return;
  idByCode.clear();
  data.forEach((row) => idByCode.set(row.code, row.id));
  materials.value = data.map((row) => row.code);
  sortMaterials();
};

load();

export const useMaterials = () => {
  const addMaterial = (value) => {
    const material = normalizeMaterial(value);
    if (!material || materials.value.includes(material)) return material;
    materials.value = [...materials.value, material];
    sortMaterials();
    supabase
      .from("materials")
      .insert({ code: material, is_waste: inferIsWaste(material) })
      .select("id")
      .single()
      .then(({ data, error }) => {
        if (!error && data) idByCode.set(material, data.id);
      });
    return material;
  };

  const updateMaterial = (oldValue, nextValue) => {
    const oldMaterial = normalizeMaterial(oldValue);
    const nextMaterial = normalizeMaterial(nextValue);
    if (!oldMaterial || !nextMaterial) return { ok: false, reason: "empty", material: nextMaterial };
    if (oldMaterial === nextMaterial) return { ok: true, reason: "same", material: nextMaterial };
    if (materials.value.includes(nextMaterial)) return { ok: false, reason: "duplicate", material: nextMaterial };

    materials.value = materials.value.map((material) => (material === oldMaterial ? nextMaterial : material));
    sortMaterials();
    const id = idByCode.get(oldMaterial);
    idByCode.delete(oldMaterial);
    if (id) {
      idByCode.set(nextMaterial, id);
      supabase
        .from("materials")
        .update({ code: nextMaterial, is_waste: inferIsWaste(nextMaterial) })
        .eq("id", id)
        .then(() => {});
    }
    return { ok: true, reason: "updated", material: nextMaterial, oldMaterial };
  };

  const removeMaterial = (value) => {
    const material = normalizeMaterial(value);
    materials.value = materials.value.filter((item) => item !== material);
    const id = idByCode.get(material);
    idByCode.delete(material);
    if (id) supabase.from("materials").delete().eq("id", id).then(() => {});
  };

  return { materials, addMaterial, updateMaterial, removeMaterial };
};
