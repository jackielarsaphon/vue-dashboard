import { ref } from "vue";
import { supabase } from "../lib/supabaseClient.js";

// Material routes are now persisted in public.material_routes (previously static
// reference data kept in localStorage). The public API stays synchronous so the
// MaterialRoutes page is unchanged: writes update the reactive list optimistically
// and fire the Supabase call in the background, reconciling ids on success.

const normalize = (value) => String(value ?? "").trim().toUpperCase();
const tempId = () => `tmp-${Math.random().toString(36).slice(2, 9)}`;

const toUi = (row) => ({
  id: row.id,
  material: row.material === "Waste" ? "Waste" : "Ore",
  oreType: row.ore_type || "",
  location: row.location || "",
});

// Module-level singleton state, shared across components (mirrors the other
// composables in this project).
const routes = ref([]);
const loading = ref(false);

const load = async () => {
  loading.value = true;
  const { data, error } = await supabase
    .from("material_routes")
    .select("id, material, ore_type, location")
    .eq("active", true)
    .order("created_at", { ascending: true });
  loading.value = false;
  if (!error && data) routes.value = data.map(toUi);
};

load();

export const useMaterialRoutes = () => {
  const addRoute = ({ material, oreType }) => {
    const route = {
      id: tempId(),
      material: material === "Waste" ? "Waste" : "Ore",
      oreType: normalize(oreType),
      location: "",
    };
    if (!route.oreType) return { ok: false, reason: "empty" };

    routes.value = [...routes.value, route];

    supabase
      .from("material_routes")
      // Destination (location) is managed separately now (the Locations master
      // page → dumping_areas); material_routes only pairs material type + ore
      // type. The column is NOT NULL, so write an empty string.
      .insert({ material: route.material, ore_type: route.oreType, location: "" })
      .select("id, material, ore_type, location")
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          // Roll back the optimistic row if the insert failed.
          routes.value = routes.value.filter((item) => item.id !== route.id);
          return;
        }
        routes.value = routes.value.map((item) => (item.id === route.id ? toUi(data) : item));
      });

    return { ok: true, route };
  };

  const updateRoute = (id, { material, oreType }) => {
    const next = {
      material: material === "Waste" ? "Waste" : "Ore",
      oreType: normalize(oreType),
    };
    if (!next.oreType) return { ok: false, reason: "empty" };

    const prev = routes.value.find((route) => route.id === id);
    routes.value = routes.value.map((route) => (route.id === id ? { ...route, ...next } : route));

    if (!String(id).startsWith("tmp-")) {
      supabase
        .from("material_routes")
        // location left untouched (managed on the Locations page).
        .update({ material: next.material, ore_type: next.oreType })
        .eq("id", id)
        .then(({ error }) => {
          // Roll back to the previous values on failure.
          if (error && prev) routes.value = routes.value.map((route) => (route.id === id ? prev : route));
        });
    }
    return { ok: true };
  };

  const removeRoute = (id) => {
    const prev = routes.value;
    routes.value = routes.value.filter((route) => route.id !== id);

    if (!String(id).startsWith("tmp-")) {
      supabase
        .from("material_routes")
        .delete()
        .eq("id", id)
        .then(({ error }) => {
          if (error) routes.value = prev; // restore on failure
        });
    }
  };

  return { routes, loading, addRoute, updateRoute, removeRoute, reload: load };
};
