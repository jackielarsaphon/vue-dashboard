import { computed, ref, watch } from "vue";
import { supabase } from "../lib/supabaseClient.js";
import { useShiftSelection } from "./useShiftSelection.js";
import { useKpiTargets } from "./useKpiTargets.js";
import { useExcavatorsStore } from "../stores/excavatorsStore";
import { useMiningAreasStore } from "../stores/miningAreasStore";
import { useMaterialsStore } from "../stores/materialsStore";
import { useDumpingAreasStore } from "../stores/dumpingAreasStore";
import { useTruckModelsStore } from "../stores/truckModelsStore";
import { factorFor, setWeekFactor, weekStartOf, DEFAULT_TONNES_PER_TRIP } from "./useTruckFactors.js";

// Per-model tonnes/trip factors are now weekly (effective-dated) — see
// useTruckFactors.js. DEFAULT_TONNES_PER_TRIP is the final fallback.
export { DEFAULT_TONNES_PER_TRIP };
export const BCM_PER_TRIP = 25;

// A row is now one material + dumping-area + dump-model combination with a
// single trip count (previously: one row per material+dump with a trips array
// spanning every truck model).
export const rowTotal = (row) => Number(row.trips) || 0;
export const excTotal = (entry) => (entry ? entry.rows.reduce((sum, row) => sum + rowTotal(row), 0) : 0);

const RL_SEED = {
  DSW04B: 152,
  NLU03A: 138,
  NLU03B: 131,
  NLU03C: 124,
  TKS1A: 96,
  TKS1B: 90,
  TKS2A: 168,
};

// Legacy column order for the trip-entry grid (not alphabetical, matches the
// previous hardcoded TRUCKS array so the grid doesn't visually reorder).
const TRUCK_ORDER = ["SKT90S", "SKT105S", "CAT345", "VSCSDT"];

const draftUid = () => `draft-${Math.random().toString(36).slice(2, 9)}`;
const keyFor = (date, shiftType, hour) => `${date}_${shiftType}_${hour}`;
const shiftCacheKey = (date, shiftType) => `${date}_${shiftType}`;

// Real wall-clock start of a (date, shift, hour) slot. Night-shift hours 0-5
// happen the morning after the shift date, so they map to date + 1. Used to
// hard-block writing data for a slot that hasn't happened yet, regardless of
// what the UI selection is (past stays editable, future is rejected on save).
const slotStart = (date, shiftType, hour) => {
  const base = new Date(`${date}T00:00:00`);
  if (shiftType === "Night" && hour <= 5) base.setDate(base.getDate() + 1);
  base.setHours(hour, 0, 0, 0);
  return base;
};
const isFutureSlot = (date, shiftType, hour) => slotStart(date, shiftType, hour).getTime() > Date.now();
const codeOf = (list, id) => list.find((item) => item.id === id)?.code;

const excavatorsStore = useExcavatorsStore();
const miningAreasStore = useMiningAreasStore();
const materialsStore = useMaterialsStore();
const dumpingAreasStore = useDumpingAreasStore();
const truckModelsStore = useTruckModelsStore();

const areaCodeById = computed(() => Object.fromEntries(miningAreasStore.items.value.map((row) => [row.id, row.code])));
const areaIdByCode = computed(() => Object.fromEntries(miningAreasStore.items.value.map((row) => [row.code, row.id])));

const truckModels = computed(() => {
  const items = truckModelsStore.items.value.filter((row) => row.active);
  return [...items].sort((a, b) => {
    const ai = TRUCK_ORDER.indexOf(a.code);
    const bi = TRUCK_ORDER.indexOf(b.code);
    if (ai === -1 && bi === -1) return a.code.localeCompare(b.code);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
});
// tonnes/trip for a truck-model code, using the factor that was in effect for
// the currently selected date's week (date-aware, so past weeks keep their own
// factor). Sourced from the weekly factor history (useTruckFactors).
export const tonnesPerTripFor = (code) => factorFor(code, selection.date);
// tonnes for one entry row, using its truck model's factor for the selected week.
export const rowTonnes = (row) => rowTotal(row) * factorFor(row.model, selection.date);

export const isWaste = (materialCode) => {
  const material = materialsStore.items.value.find((row) => row.code === materialCode);
  return material ? material.is_waste : String(materialCode)[0] === "W";
};

const excavators = computed(() =>
  excavatorsStore.items.value
    .filter((row) => row.active)
    .map((row) => ({
      uid: row.id,
      name: row.code,
      area: areaCodeById.value[row.mining_area_id] ?? "",
      status: row.status,
      trucks: row.truck_count,
      rl: row.rl_meters,
      notes: row.notes || "",
    })),
);

const areas = computed(() => Array.from(new Set(excavators.value.map((row) => row.area).filter(Boolean))).sort((a, b) => a.localeCompare(b)));

// The dumping-area codes managed on the Dumping area master page: global rows
// (mining_area_id null) only, so the Data entry dropdown mirrors that master
// list instead of synthesising per-area codes.
const dumpingAreaCodes = computed(() =>
  dumpingAreasStore.items.value
    .filter((row) => row.active && row.mining_area_id === null)
    .map((row) => row.code)
    .sort((a, b) => a.localeCompare(b)),
);

const { selection } = useShiftSelection();
const { targetsByCategory } = useKpiTargets();

// shift_id cache, keyed by "date_shiftType".
const shiftIdCache = ref({});
// Persisted entries, keyed by "date_shiftType_hour" -> { [excavatorUid]: { rows } }.
const entriesByKey = ref({});
// Locally-added rows with no trips yet (no DB identity), same keying.
const draftRowsByKey = ref({});

const currentKey = computed(() => keyFor(selection.date, selection.shiftType, selection.hour));

const findShiftIds = async (date) => {
  const { data, error } = await supabase.from("shifts").select("id, shift_type").eq("shift_date", date);
  return error ? [] : data || [];
};

const getOrCreateShiftId = async (date, shiftType) => {
  const cacheKey = shiftCacheKey(date, shiftType);
  if (shiftIdCache.value[cacheKey]) return shiftIdCache.value[cacheKey];

  const { data } = await supabase.from("shifts").select("id").eq("shift_date", date).eq("shift_type", shiftType).maybeSingle();
  if (data) {
    shiftIdCache.value = { ...shiftIdCache.value, [cacheKey]: data.id };
    return data.id;
  }

  const { data: created, error } = await supabase.from("shifts").insert({ shift_date: date, shift_type: shiftType }).select("id").single();
  if (error || !created) {
    const { data: existing } = await supabase.from("shifts").select("id").eq("shift_date", date).eq("shift_type", shiftType).maybeSingle();
    if (!existing) return null;
    shiftIdCache.value = { ...shiftIdCache.value, [cacheKey]: existing.id };
    return existing.id;
  }

  shiftIdCache.value = { ...shiftIdCache.value, [cacheKey]: created.id };
  return created.id;
};

// "To location" is a global master now (managed on the Locations page). The
// production_entries FK needs a real dumping_areas row, so the first time a code
// is saved we create it on demand as a GLOBAL row (mining_area_id null) so it
// shows up in the Locations master and the trip-form dropdown.
const getOrCreateDumpingAreaId = async (code) => {
  const cached = dumpingAreasStore.items.value.find((row) => row.code === code);
  if (cached) return cached.id;

  const { data } = await supabase.from("dumping_areas").select("id").eq("code", code).maybeSingle();
  if (data) {
    await dumpingAreasStore.load();
    return data.id;
  }

  const { data: created, error } = await supabase
    .from("dumping_areas")
    .insert({ code, mining_area_id: null, active: true })
    .select("id")
    .single();
  if (!error && created) {
    await dumpingAreasStore.load();
    return created.id;
  }

  const { data: again } = await supabase.from("dumping_areas").select("id").eq("code", code).maybeSingle();
  if (again) {
    await dumpingAreasStore.load();
    return again.id;
  }
  return null;
};

// The materials master is never seeded by the setup SQL, and the trip form's
// "material" is the ore-type code taken from material_routes — so a freshly set
// up project has an empty materials table and no row to satisfy the
// production_entries.material_id FK. Create it on demand (same pattern as
// dumping areas) with is_waste inferred from the code (waste codes start with W,
// matching the existing isWaste fallback) so trips can always be saved.
const getOrCreateMaterialId = async (code) => {
  const cached = materialsStore.items.value.find((row) => row.code === code);
  if (cached) return cached.id;

  const { data } = await supabase.from("materials").select("id").eq("code", code).maybeSingle();
  if (data) {
    await materialsStore.load();
    return data.id;
  }

  const { data: created, error } = await supabase
    .from("materials")
    .insert({ code, is_waste: String(code)[0] === "W", active: true })
    .select("id")
    .single();
  if (!error && created) {
    await materialsStore.load();
    return created.id;
  }

  const { data: again } = await supabase.from("materials").select("id").eq("code", code).maybeSingle();
  if (again) {
    await materialsStore.load();
    return again.id;
  }
  return null;
};

// Fetches every production_entries row for the given calendar date (both
// shifts, all 24 hours) in one query and re-groups it into the legacy
// { [key]: { [excavatorUid]: { rows } } } shape so sumBucket/getBucket/entries
// can stay synchronous lookups against this cache instead of one Supabase
// call per (date, shift, hour) combination.
const fetchDateEntries = async (date) => {
  await Promise.all([
    excavatorsStore.load(),
    miningAreasStore.load(),
    materialsStore.load(),
    dumpingAreasStore.load(),
    truckModelsStore.load(),
  ]);

  const shifts = await findShiftIds(date);
  shifts.forEach((row) => {
    shiftIdCache.value = { ...shiftIdCache.value, [shiftCacheKey(date, row.shift_type)]: row.id };
  });
  const shiftTypeById = Object.fromEntries(shifts.map((row) => [row.id, row.shift_type]));
  const shiftIds = shifts.map((row) => row.id);

  const newEntries = {};
  ["Day", "Night"].forEach((shiftType) => {
    for (let hour = 0; hour < 24; hour += 1) newEntries[keyFor(date, shiftType, hour)] = {};
  });

  if (shiftIds.length) {
    const { data, error } = await supabase
      .from("production_entries")
      .select("log_hour, trips, excavator_id, material_id, dumping_area_id, truck_model_id, shift_id")
      .in("shift_id", shiftIds);

    if (!error && data) {
      data.forEach((row) => {
        const shiftType = shiftTypeById[row.shift_id];
        if (!shiftType) return;
        const key = keyFor(date, shiftType, row.log_hour);
        const bucket = newEntries[key] || (newEntries[key] = {});
        const excEntry = bucket[row.excavator_id] || (bucket[row.excavator_id] = { rows: [] });

        const materialCode = codeOf(materialsStore.items.value, row.material_id);
        const dumpCode = codeOf(dumpingAreasStore.items.value, row.dumping_area_id);
        const truckCode = codeOf(truckModelsStore.items.value, row.truck_model_id);
        const rowKey = `${materialCode}|${dumpCode}|${truckCode}`;
        let uiRow = excEntry.rows.find((item) => item.id === rowKey);
        if (!uiRow) {
          uiRow = { id: rowKey, material: materialCode, dump: dumpCode, model: truckCode, trips: 0 };
          excEntry.rows.push(uiRow);
        }
        uiRow.trips = row.trips;
      });
    }
  }

  entriesByKey.value = newEntries;
  draftRowsByKey.value = {};
};

watch(() => selection.date, (date) => fetchDateEntries(date), { immediate: true });

// Auto-save the selected production date/shift: whenever DATE or SHIFT changes
// (or on first load), ensure a shifts row exists in the database for it, so the
// header is persisted without a separate "save date" step. getOrCreateShiftId
// is cached + idempotent, so browsing back to an existing date won't duplicate.
watch(
  () => [selection.date, selection.shiftType],
  ([date, shiftType]) => {
    // Don't create a shift row for a shift that hasn't started yet (its first
    // hour is still in the future).
    const firstHour = shiftType === "Day" ? 6 : 19;
    if (slotStart(date, shiftType, firstHour).getTime() > Date.now()) return;
    getOrCreateShiftId(date, shiftType);
  },
  { immediate: true },
);

const entries = computed(() => {
  const key = currentKey.value;
  const persisted = entriesByKey.value[key] || {};
  const drafts = draftRowsByKey.value[key] || {};
  const merged = {};
  new Set([...Object.keys(persisted), ...Object.keys(drafts)]).forEach((uid) => {
    merged[uid] = { rows: [...(persisted[uid]?.rows || []), ...(drafts[uid] || [])] };
  });
  return merged;
});

const sumBucket = (date, shiftType, hour) => {
  const bucket = entriesByKey.value[keyFor(date, shiftType, hour)];
  let soft = 0;
  let ore = 0;
  if (bucket) {
    Object.values(bucket).forEach((entry) => {
      entry.rows.forEach((row) => {
        const total = rowTotal(row);
        if (isWaste(row.material)) soft += total;
        else ore += total;
      });
    });
  }
  return { soft, ore };
};

const getBucket = (date, shiftType, hour) => entriesByKey.value[keyFor(date, shiftType, hour)] || {};

const totals = computed(() => {
  let wasteTrip = 0;
  let oreTrip = 0;
  let wasteTonnes = 0;
  let oreTonnes = 0;
  const prefix = `${selection.date}_`;
  Object.entries(entriesByKey.value).forEach(([key, bucket]) => {
    if (!key.startsWith(prefix)) return;
    Object.values(bucket).forEach((entry) => {
      entry.rows.forEach((row) => {
        const total = rowTotal(row);
        const tonnes = rowTonnes(row);
        if (isWaste(row.material)) {
          wasteTrip += total;
          wasteTonnes += tonnes;
        } else {
          oreTrip += total;
          oreTonnes += tonnes;
        }
      });
    });
  });

  const kpiTargets = targetsByCategory.value;
  return {
    production: { trip: wasteTrip + oreTrip, tonnes: wasteTonnes + oreTonnes, target: kpiTargets.production },
    waste: { trip: wasteTrip, tonnes: wasteTonnes, target: kpiTargets.waste },
    ore: { trip: oreTrip, tonnes: oreTonnes, target: kpiTargets.ore },
  };
});

// ---------------------------------------------------------------------------
// Write actions
// ---------------------------------------------------------------------------

const addExcavator = async (area) => {
  const areaId = areaIdByCode.value[area];
  if (!areaId) return;
  const nums = excavatorsStore.items.value.map((row) => parseInt((row.code.match(/\d+/) || [0])[0], 10) || 0);
  const name = `E-${Math.max(500, ...nums, 0) + 1}`;
  const peers = excavatorsStore.items.value.filter((row) => row.active && row.mining_area_id === areaId);
  const rl = peers.length ? peers[0].rl_meters : (RL_SEED[area] ?? 120);
  const result = await excavatorsStore.create({ code: name, mining_area_id: areaId, truck_count: 0, rl_meters: rl, notes: "", status: "ok", active: true });
  if (result.ok && result.data) addEntryRow(result.data.id);
};

const updateExcavator = async (uid, patch) => {
  const dbPatch = {};
  if (patch.name !== undefined) dbPatch.code = patch.name;
  if (patch.trucks !== undefined) dbPatch.truck_count = patch.trucks === "" ? 0 : Number(patch.trucks);
  if (patch.rl !== undefined) dbPatch.rl_meters = patch.rl === "" ? null : Number(patch.rl);
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;
  await excavatorsStore.update(uid, dbPatch);
};

// Soft delete: production_entries.excavator_id has a non-cascading FK, so a
// hard delete would fail once trips have been logged for this excavator.
const removeExcavator = async (uid) => {
  await excavatorsStore.update(uid, { active: false });
};

// Clear one excavator's logged trips for an entire date (both shifts, every hour)
// without touching the master roster — the Excavator master is just a dropdown
// source, so "removing" it from Data entry deletes the entered data, not the unit.
const removeExcavatorTripsForDate = async (uid, date) => {
  const shiftIds = (await findShiftIds(date)).map((row) => row.id);
  if (shiftIds.length) {
    await supabase.from("production_entries").delete().in("shift_id", shiftIds).eq("excavator_id", uid);
  }

  const prefix = `${date}_`;
  const dropFromStore = (store) => {
    const next = { ...store.value };
    Object.keys(next).forEach((key) => {
      if (key.startsWith(prefix) && next[key]?.[uid]) {
        const bucket = { ...next[key] };
        delete bucket[uid];
        next[key] = bucket;
      }
    });
    store.value = next;
  };
  dropFromStore(entriesByKey);
  dropFromStore(draftRowsByKey);
};

const addEntryRow = (excavatorUid) => {
  const key = currentKey.value;
  const drafts = { ...draftRowsByKey.value };
  const list = [...(drafts[key]?.[excavatorUid] || [])];
  list.push({
    id: draftUid(),
    material: materialsStore.items.value[0]?.code ?? "",
    dump: dumpingAreaCodes.value[0] ?? "",
    model: truckModels.value[0]?.code ?? "",
    trips: 0,
  });
  drafts[key] = { ...(drafts[key] || {}), [excavatorUid]: list };
  draftRowsByKey.value = drafts;
};

const removeEntryRow = async (excavatorUid, rowId) => {
  const key = currentKey.value;
  if (rowId.startsWith("draft-")) {
    const drafts = { ...draftRowsByKey.value };
    const list = (drafts[key]?.[excavatorUid] || []).filter((row) => row.id !== rowId);
    drafts[key] = { ...(drafts[key] || {}), [excavatorUid]: list };
    draftRowsByKey.value = drafts;
    return;
  }

  const shiftId = shiftIdCache.value[shiftCacheKey(selection.date, selection.shiftType)];
  const [materialCode, dumpCode, modelCode] = rowId.split("|");
  const materialRow = materialsStore.items.value.find((row) => row.code === materialCode);
  const dumpRow = dumpingAreasStore.items.value.find((row) => row.code === dumpCode);
  const truckRow = truckModelsStore.items.value.find((row) => row.code === modelCode);
  if (shiftId && materialRow && dumpRow && truckRow) {
    await supabase
      .from("production_entries")
      .delete()
      .eq("shift_id", shiftId)
      .eq("log_hour", selection.hour)
      .eq("excavator_id", excavatorUid)
      .eq("material_id", materialRow.id)
      .eq("dumping_area_id", dumpRow.id)
      .eq("truck_model_id", truckRow.id);
  }

  const bucket = entriesByKey.value[key];
  const entry = bucket && bucket[excavatorUid];
  if (entry) entry.rows = entry.rows.filter((row) => row.id !== rowId);
};

const updateEntryRow = async (excavatorUid, rowId, patch) => {
  const key = currentKey.value;

  if (rowId.startsWith("draft-")) {
    const row = draftRowsByKey.value[key]?.[excavatorUid]?.find((item) => item.id === rowId);
    if (row) Object.assign(row, patch);
    return;
  }

  const [oldMaterial, oldDump, oldModel] = rowId.split("|");
  const nextMaterial = patch.material ?? oldMaterial;
  const nextDump = patch.dump ?? oldDump;
  const nextModel = patch.model ?? oldModel;
  const nextId = `${nextMaterial}|${nextDump}|${nextModel}`;
  if (nextId === rowId) return;

  const bucket = entriesByKey.value[key];
  const entry = bucket && bucket[excavatorUid];
  if (!entry) return;
  const row = entry.rows.find((item) => item.id === rowId);
  if (!row) return;
  const trips = Number(row.trips) || 0;

  const excavator = excavatorsStore.items.value.find((item) => item.id === excavatorUid);
  const shiftId = shiftIdCache.value[shiftCacheKey(selection.date, selection.shiftType)];
  const oldMaterialRow = materialsStore.items.value.find((item) => item.code === oldMaterial);
  const oldDumpRow = dumpingAreasStore.items.value.find((item) => item.code === oldDump);
  const oldTruckRow = truckModelsStore.items.value.find((item) => item.code === oldModel);
  const nextTruckRow = truckModelsStore.items.value.find((item) => item.code === nextModel);

  // The DB row's identity (material/dump/truck model) is changing, so move it:
  // delete the old production_entries row and re-write it under the new keys,
  // carrying the same trip count. Material/dumping-area for the new keys are
  // auto-created if missing (same as setRowTrips), so the move can't silently
  // fail just because that master row wasn't seeded.
  if (shiftId && excavator && oldMaterialRow && oldDumpRow && oldTruckRow && nextTruckRow) {
    await supabase
      .from("production_entries")
      .delete()
      .eq("shift_id", shiftId)
      .eq("log_hour", selection.hour)
      .eq("excavator_id", excavatorUid)
      .eq("material_id", oldMaterialRow.id)
      .eq("dumping_area_id", oldDumpRow.id)
      .eq("truck_model_id", oldTruckRow.id);

    if (trips > 0) {
      const nextMaterialId = await getOrCreateMaterialId(nextMaterial);
      const nextDumpId = await getOrCreateDumpingAreaId(nextDump);
      if (nextMaterialId && nextDumpId) {
        await supabase.from("production_entries").upsert(
          {
            shift_id: shiftId,
            log_hour: selection.hour,
            excavator_id: excavatorUid,
            material_id: nextMaterialId,
            dumping_area_id: nextDumpId,
            truck_model_id: nextTruckRow.id,
            mining_area_id: excavator.mining_area_id,
            trips,
            tonnes: trips * tonnesPerTripFor(nextModel),
          },
          { onConflict: "shift_id,log_hour,excavator_id,material_id,dumping_area_id,truck_model_id" },
        );
      }
    }
  }

  const existingTarget = entry.rows.find((item) => item.id === nextId);
  if (existingTarget && existingTarget !== row) {
    existingTarget.trips = (Number(existingTarget.trips) || 0) + trips;
    entry.rows = entry.rows.filter((item) => item.id !== rowId);
  } else {
    row.id = nextId;
    row.material = nextMaterial;
    row.dump = nextDump;
    row.model = nextModel;
  }
};

const updateLocalTrip = (excavatorUid, rowId, value) => {
  const key = currentKey.value;
  const bucket = entriesByKey.value[key] || (entriesByKey.value[key] = {});
  const entry = bucket[excavatorUid] || (bucket[excavatorUid] = { rows: [] });
  let row = entry.rows.find((item) => item.id === rowId);
  if (!row) {
    const [material, dump, model] = rowId.split("|");
    row = { id: rowId, material, dump, model, trips: 0 };
    entry.rows.push(row);
  }
  row.trips = value;
  if (!value) entry.rows = entry.rows.filter((item) => item.id !== rowId);
};

// Returns true when the trip count was persisted (or cleared) in the database,
// false when it could not be saved — e.g. the row has no valid material / dump
// model / dumping area because that master data has not been entered yet.
const setRowTrips = async (excavatorUid, rowId, rawValue) => {
  // Never persist data for a slot that is still in the future.
  if (isFutureSlot(selection.date, selection.shiftType, selection.hour)) return false;

  const value = rawValue === "" ? 0 : Math.max(0, Number(rawValue) || 0);
  const excavator = excavatorsStore.items.value.find((row) => row.id === excavatorUid);
  if (!excavator) return false;

  const isDraft = rowId.startsWith("draft-");
  let materialCode;
  let dumpCode;
  let modelCode;
  if (isDraft) {
    const draftRow = draftRowsByKey.value[currentKey.value]?.[excavatorUid]?.find((item) => item.id === rowId);
    if (!draftRow) return false;
    // Keep the input value live while the row is still a draft.
    draftRow.trips = value;
    materialCode = draftRow.material;
    dumpCode = draftRow.dump;
    modelCode = draftRow.model;
  } else {
    [materialCode, dumpCode, modelCode] = rowId.split("|");
  }

  const truck = truckModelsStore.items.value.find((row) => row.code === modelCode);
  if (!truck) return false;

  const shiftId = await getOrCreateShiftId(selection.date, selection.shiftType);
  if (!shiftId) return false;

  // Auto-create the material + dumping-area master rows on demand if missing, so
  // a project whose materials/dumping_areas tables were never seeded can still
  // save trips (the material codes come from material_routes; see helpers above).
  const materialId = await getOrCreateMaterialId(materialCode);
  if (!materialId) return false;

  const dumpingAreaId = await getOrCreateDumpingAreaId(dumpCode);
  if (!dumpingAreaId) return false;

  const matchKey = {
    shift_id: shiftId,
    log_hour: selection.hour,
    excavator_id: excavatorUid,
    material_id: materialId,
    dumping_area_id: dumpingAreaId,
    truck_model_id: truck.id,
  };

  if (value === 0) {
    await supabase.from("production_entries").delete().match(matchKey);
    // Drop persisted rows that hit zero; leave fresh draft rows in place so the
    // user can keep editing them.
    if (!isDraft) updateLocalTrip(excavatorUid, `${materialCode}|${dumpCode}|${modelCode}`, 0);
    return true;
  }

  await supabase
    .from("production_entries")
    .upsert(
      { ...matchKey, mining_area_id: excavator.mining_area_id, trips: value, tonnes: value * tonnesPerTripFor(modelCode) },
      { onConflict: "shift_id,log_hour,excavator_id,material_id,dumping_area_id,truck_model_id" },
    );

  const compositeId = `${materialCode}|${dumpCode}|${modelCode}`;
  if (isDraft) {
    const key = currentKey.value;
    const drafts = { ...draftRowsByKey.value };
    const list = (drafts[key]?.[excavatorUid] || []).filter((item) => item.id !== rowId);
    drafts[key] = { ...(drafts[key] || {}), [excavatorUid]: list };
    draftRowsByKey.value = drafts;
  }
  updateLocalTrip(excavatorUid, compositeId, value);
  return true;
};

// Set a truck model's tonnes/trip factor for the selected date's WEEK (writes
// the weekly factor history in truck_model_factors — no schema change to existing
// tables). Editable from Data entry as well as the Dump model page. Other weeks
// keep their own factor, so past dashboards stay unchanged.
const setTruckFactor = (code, rawValue) => setWeekFactor(code, weekStartOf(selection.date), rawValue);

export const useEntryStore = () => ({
  areas,
  dumpingAreaCodes,
  excavators,
  entries,
  totals,
  sumBucket,
  getBucket,
  truckModels,
  setTruckFactor,
  addExcavator,
  updateExcavator,
  removeExcavator,
  removeExcavatorTripsForDate,
  addEntryRow,
  removeEntryRow,
  updateEntryRow,
  setRowTrips,
  // Persist a production date as a shifts row (used by the Date header step so
  // picking/changing the date is saved to the database immediately).
  ensureShift: (date, shiftType) => getOrCreateShiftId(date, shiftType),
});
