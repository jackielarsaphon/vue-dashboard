import { computed, ref, watch } from "vue";
import { supabase } from "../lib/supabaseClient.js";
import { useShiftSelection } from "./useShiftSelection.js";
import { useKpiTargets } from "./useKpiTargets.js";
import { useExcavatorsStore } from "../stores/excavatorsStore";
import { useAreaExcavatorsStore } from "../stores/areaExcavatorsStore";
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
const areaExcavatorsStore = useAreaExcavatorsStore();
const miningAreasStore = useMiningAreasStore();
const materialsStore = useMaterialsStore();
const dumpingAreasStore = useDumpingAreasStore();
const truckModelsStore = useTruckModelsStore();

const areaCodeById = computed(() => Object.fromEntries(miningAreasStore.items.value.map((row) => [row.id, row.code])));
const areaIdByCode = computed(() => Object.fromEntries(miningAreasStore.items.value.map((row) => [row.code, row.id])));

// A trip "slot" is one Data entry row = one area_excavators placement, so trips are
// grouped by placement_id. The same excavator can therefore appear several times in
// one pit with separate trips. Legacy production_entries with no placement fall back
// to an excavator+pit key (they won't map to a row but still count in totals).
const legacySlot = (excavatorId, areaId) => `leg_${excavatorId}__${areaId}`;
const placementRow = (placementId) => areaExcavatorsStore.items.value.find((row) => row.id === placementId);

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

// The registered excavator roster (Excavator master). Used as the source of codes
// for the Data entry picker. `area` here is the legacy single mining_area_id — the
// Data entry rows no longer rely on it (they use areaExcavators below).
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

const excavatorById = computed(() => Object.fromEntries(excavatorsStore.items.value.map((row) => [row.id, row])));

// Per-pit placements (public.area_excavators): one row per (pit, excavator). This
// is the Data entry roster — the same excavator can appear in several pits at once,
// each placement carrying its own trucks/RL/note. `uid` is the excavator id (trips
// key); `placementId` is the row id used to add/remove/edit the placement.
const areaExcavators = computed(() =>
  areaExcavatorsStore.items.value
    .filter((row) => row.active)
    .map((row) => {
      const exc = excavatorById.value[row.excavator_id];
      return {
        placementId: row.id,
        uid: row.excavator_id,
        areaId: row.mining_area_id,
        name: exc?.code ?? "",
        area: areaCodeById.value[row.mining_area_id] ?? "",
        status: row.status,
        trucks: row.truck_count,
        rl: row.rl_meters,
        notes: row.notes || "",
      };
    })
    .filter((row) => row.name && row.area),
);

// Pits that have at least one placed excavator (drives the area tabs).
const areas = computed(() => Array.from(new Set(areaExcavators.value.map((row) => row.area).filter(Boolean))).sort((a, b) => a.localeCompare(b)));

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
// Per-hour Production notes (public.placement_notes), keyed
// "date_shiftType_hour" -> { [placementId]: note }.
const notesByKey = ref({});
// Per-hour RL / bench level (public.placement_rl), same keying ->
// { [placementId]: rl_meters }. Like notes, RL is hour-scoped so editing this
// hour never rewrites earlier hours; a new hour carries forward the latest value.
const rlByKey = ref({});
// Per-hour removals (public.placement_removed), same keying ->
// { [placementId]: true }. Removal is hour-scoped: removing a placement affects
// ONLY that one hour — every other hour (before and after) keeps its data.
const removedByKey = ref({});

const currentKey = computed(() => keyFor(selection.date, selection.shiftType, selection.hour));

// Hours in entry order per shift (Day 06→18, Night 19→05).
const SHIFT_HOURS = {
  Day: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
  Night: [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5],
};
// Operational-day hour order (Day 06→18 then Night 19→05), used to find the most
// recent earlier hour when carrying an RL value forward into a fresh hour.
const RL_SLOT_ORDER = [
  ...SHIFT_HOURS.Day.map((h) => ["Day", h]),
  ...SHIFT_HOURS.Night.map((h) => ["Night", h]),
];

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
    areaExcavatorsStore.load(),
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
      .select("log_hour, trips, excavator_id, mining_area_id, placement_id, material_id, dumping_area_id, truck_model_id, shift_id")
      .in("shift_id", shiftIds);

    if (!error && data) {
      data.forEach((row) => {
        const shiftType = shiftTypeById[row.shift_id];
        if (!shiftType) return;
        const key = keyFor(date, shiftType, row.log_hour);
        const bucket = newEntries[key] || (newEntries[key] = {});
        const slot = row.placement_id || legacySlot(row.excavator_id, row.mining_area_id);
        const excEntry =
          bucket[slot] ||
          (bucket[slot] = {
            placementId: row.placement_id || null,
            excavatorId: row.excavator_id,
            areaId: row.mining_area_id,
            area: areaCodeById.value[row.mining_area_id] ?? "",
            rows: [],
          });

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

  // Per-hour Production notes for the date.
  const newNotes = {};
  if (shiftIds.length) {
    const { data: notes, error: notesError } = await supabase
      .from("placement_notes")
      .select("placement_id, shift_id, log_hour, note")
      .in("shift_id", shiftIds);
    if (!notesError && notes) {
      notes.forEach((row) => {
        const shiftType = shiftTypeById[row.shift_id];
        if (!shiftType) return;
        const key = keyFor(date, shiftType, row.log_hour);
        (newNotes[key] = newNotes[key] || {})[row.placement_id] = row.note || "";
      });
    }
  }

  // Per-hour RL / bench level for the date.
  const newRl = {};
  if (shiftIds.length) {
    const { data: rlRows, error: rlError } = await supabase
      .from("placement_rl")
      .select("placement_id, shift_id, log_hour, rl_meters")
      .in("shift_id", shiftIds);
    if (!rlError && rlRows) {
      rlRows.forEach((row) => {
        const shiftType = shiftTypeById[row.shift_id];
        if (!shiftType) return;
        const key = keyFor(date, shiftType, row.log_hour);
        (newRl[key] = newRl[key] || {})[row.placement_id] = row.rl_meters;
      });
    }
  }

  // Per-hour removals: which placements were removed in which (shift, hour).
  const newRemoved = {};
  if (shiftIds.length) {
    const { data: removed, error: removedError } = await supabase
      .from("placement_removed")
      .select("placement_id, shift_id, log_hour")
      .in("shift_id", shiftIds);
    if (!removedError && removed) {
      removed.forEach((row) => {
        const shiftType = shiftTypeById[row.shift_id];
        if (!shiftType) return;
        const key = keyFor(date, shiftType, row.log_hour);
        (newRemoved[key] = newRemoved[key] || {})[row.placement_id] = true;
      });
    }
  }

  entriesByKey.value = newEntries;
  draftRowsByKey.value = {};
  notesByKey.value = newNotes;
  rlByKey.value = newRl;
  removedByKey.value = newRemoved;
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

// Current (date, shift, hour) entries, keyed by trip slot (placement_id). Each value
// carries its placementId/excavatorId/areaId/area so consumers don't need the key.
const entries = computed(() => {
  const key = currentKey.value;
  const persisted = entriesByKey.value[key] || {};
  const drafts = draftRowsByKey.value[key] || {};
  const merged = {};
  new Set([...Object.keys(persisted), ...Object.keys(drafts)]).forEach((slot) => {
    const meta = persisted[slot];
    let placementId;
    let excavatorId;
    let areaId;
    let area;
    if (meta) {
      ({ placementId, excavatorId, areaId, area } = meta);
    } else {
      const placement = placementRow(slot);
      placementId = placement ? placement.id : null;
      excavatorId = placement?.excavator_id;
      areaId = placement?.mining_area_id;
      area = areaCodeById.value[areaId] ?? "";
    }
    merged[slot] = { placementId, excavatorId, areaId, area, rows: [...(persisted[slot]?.rows || []), ...(drafts[slot] || [])] };
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

const updateExcavator = async (uid, patch) => {
  const dbPatch = {};
  if (patch.name !== undefined) dbPatch.code = patch.name;
  if (patch.area !== undefined) dbPatch.mining_area_id = areaIdByCode.value[patch.area] ?? null;
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

// --- Per-pit placement CRUD (public.area_excavators) -----------------------
// Place an excavator into a pit. The same excavator can be placed in several pits
// (one row each); the unique(mining_area_id, excavator_id) constraint just blocks
// the same one twice in one pit.
const addAreaExcavator = async (areaCode, excavatorId) => {
  const miningAreaId = areaIdByCode.value[areaCode];
  if (!miningAreaId || !excavatorId) return;
  await areaExcavatorsStore.create({
    mining_area_id: miningAreaId,
    excavator_id: excavatorId,
    truck_count: 0,
    rl_meters: null,
    status: "ok",
    notes: "",
    active: true,
  });
};

// Edit a placement's per-pit fields (which excavator it is, trucks / RL / note).
const updateAreaExcavator = async (placementId, patch) => {
  const dbPatch = {};
  if (patch.excavatorId !== undefined) dbPatch.excavator_id = patch.excavatorId;
  if (patch.trucks !== undefined) dbPatch.truck_count = patch.trucks === "" ? 0 : Number(patch.trucks);
  if (patch.rl !== undefined) dbPatch.rl_meters = patch.rl === "" ? null : Number(patch.rl);
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  await areaExcavatorsStore.update(placementId, dbPatch);
};

// Change which excavator a row (placement) is, KEEPING its trips: the slot is the
// placement, so the trips stay put, and we also re-stamp every production_entries
// row's excavator_id so dashboards (which group by excavator) stay correct. Always
// allowed — no lock — so a row can be re-labelled even after trips are entered.
const reassignPlacementExcavator = async (placementId, newExcavatorId) => {
  await areaExcavatorsStore.update(placementId, { excavator_id: newExcavatorId });
  await supabase.from("production_entries").update({ excavator_id: newExcavatorId }).eq("placement_id", placementId);
  // Keep the local cache in sync: each cached entry under this slot carries the
  // excavatorId used by the dashboards.
  const next = { ...entriesByKey.value };
  Object.keys(next).forEach((key) => {
    const bucket = next[key];
    if (bucket && bucket[placementId]) {
      next[key] = { ...bucket, [placementId]: { ...bucket[placementId], excavatorId: newExcavatorId } };
    }
  });
  entriesByKey.value = next;
};

// Delete ALL of a placement's logged trips (every date/shift/hour) from the
// database, then remove the placement row itself — so removing a row from a pit
// leaves nothing orphaned behind in production_entries.
const removeAreaExcavatorPlacement = async (placementId) => {
  await supabase.from("production_entries").delete().eq("placement_id", placementId);
  const dropFromStore = (store) => {
    const next = {};
    Object.entries(store.value).forEach(([key, bucket]) => {
      if (bucket && bucket[placementId]) {
        const copy = { ...bucket };
        delete copy[placementId];
        next[key] = copy;
      } else {
        next[key] = bucket;
      }
    });
    store.value = next;
  };
  dropFromStore(entriesByKey);
  dropFromStore(draftRowsByKey);
  await areaExcavatorsStore.remove(placementId);
};

// Clear one placement's (one Data entry row's) logged trips for an entire date
// (both shifts, every hour). Scoped by placement_id, so another row of the same
// excavator — in this pit or another — is never touched.
const removePlacementTripsForDate = async (placementId, date) => {
  const shiftIds = (await findShiftIds(date)).map((row) => row.id);
  if (shiftIds.length) {
    await supabase.from("production_entries").delete().in("shift_id", shiftIds).eq("placement_id", placementId);
  }

  const prefix = `${date}_`;
  const dropFromStore = (store) => {
    const next = { ...store.value };
    Object.keys(next).forEach((key) => {
      if (key.startsWith(prefix) && next[key]?.[placementId]) {
        const bucket = { ...next[key] };
        delete bucket[placementId];
        next[key] = bucket;
      }
    });
    store.value = next;
  };
  dropFromStore(entriesByKey);
  dropFromStore(draftRowsByKey);
};

// Add a draft trip row. An optional `template` (material/dump/model) seeds the
// material+location+dump model — used to carry the previous hour's rows forward —
// while trips always start at 0.
const addEntryRow = (placementId, template) => {
  const key = currentKey.value;
  const slot = placementId;
  const drafts = { ...draftRowsByKey.value };
  const list = [...(drafts[key]?.[slot] || [])];
  list.push({
    id: draftUid(),
    material: template?.material ?? materialsStore.items.value[0]?.code ?? "",
    dump: template?.dump ?? dumpingAreaCodes.value[0] ?? "",
    model: template?.model ?? truckModels.value[0]?.code ?? "",
    trips: 0,
  });
  drafts[key] = { ...(drafts[key] || {}), [slot]: list };
  draftRowsByKey.value = drafts;
};

const removeEntryRow = async (placementId, rowId) => {
  const key = currentKey.value;
  const slot = placementId;
  if (rowId.startsWith("draft-")) {
    const drafts = { ...draftRowsByKey.value };
    const list = (drafts[key]?.[slot] || []).filter((row) => row.id !== rowId);
    drafts[key] = { ...(drafts[key] || {}), [slot]: list };
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
      .eq("placement_id", placementId)
      .eq("material_id", materialRow.id)
      .eq("dumping_area_id", dumpRow.id)
      .eq("truck_model_id", truckRow.id);
  }

  const bucket = entriesByKey.value[key];
  const entry = bucket && bucket[slot];
  if (entry) entry.rows = entry.rows.filter((row) => row.id !== rowId);
};

const updateEntryRow = async (placementId, rowId, patch) => {
  const key = currentKey.value;
  const slot = placementId;
  const placement = placementRow(placementId);
  const excavatorId = placement?.excavator_id;
  const areaId = placement?.mining_area_id;

  if (rowId.startsWith("draft-")) {
    const row = draftRowsByKey.value[key]?.[slot]?.find((item) => item.id === rowId);
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
  const entry = bucket && bucket[slot];
  if (!entry) return;
  const row = entry.rows.find((item) => item.id === rowId);
  if (!row) return;
  const trips = Number(row.trips) || 0;

  const shiftId = shiftIdCache.value[shiftCacheKey(selection.date, selection.shiftType)];
  const oldMaterialRow = materialsStore.items.value.find((item) => item.code === oldMaterial);
  const oldDumpRow = dumpingAreasStore.items.value.find((item) => item.code === oldDump);
  const oldTruckRow = truckModelsStore.items.value.find((item) => item.code === oldModel);
  const nextTruckRow = truckModelsStore.items.value.find((item) => item.code === nextModel);

  // The DB row's identity (material/dump/truck model) is changing, so move it:
  // delete the old production_entries row and re-write it under the new keys (for
  // THIS pit), carrying the same trip count. Material/dumping-area for the new keys
  // are auto-created if missing (same as setRowTrips), so the move can't silently
  // fail just because that master row wasn't seeded.
  if (shiftId && placementId && excavatorId && areaId && oldMaterialRow && oldDumpRow && oldTruckRow && nextTruckRow) {
    await supabase
      .from("production_entries")
      .delete()
      .eq("shift_id", shiftId)
      .eq("log_hour", selection.hour)
      .eq("placement_id", placementId)
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
            placement_id: placementId,
            excavator_id: excavatorId,
            material_id: nextMaterialId,
            dumping_area_id: nextDumpId,
            truck_model_id: nextTruckRow.id,
            mining_area_id: areaId,
            trips,
            tonnes: trips * tonnesPerTripFor(nextModel),
          },
          { onConflict: "shift_id,log_hour,placement_id,material_id,dumping_area_id,truck_model_id" },
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

const updateLocalTrip = (placementId, rowId, value) => {
  const key = currentKey.value;
  const slot = placementId;
  const placement = placementRow(placementId);
  const bucket = entriesByKey.value[key] || (entriesByKey.value[key] = {});
  const entry =
    bucket[slot] ||
    (bucket[slot] = {
      placementId,
      excavatorId: placement?.excavator_id,
      areaId: placement?.mining_area_id,
      area: areaCodeById.value[placement?.mining_area_id] ?? "",
      rows: [],
    });
  let row = entry.rows.find((item) => item.id === rowId);
  if (!row) {
    const [material, dump, model] = rowId.split("|");
    row = { id: rowId, material, dump, model, trips: 0 };
    entry.rows.push(row);
  }
  row.trips = value;
  // Keep the row even when trips hit 0: clearing the field (e.g. to retype a
  // number) deletes the DB entry in setRowTrips but the row stays visible and
  // editable instead of vanishing. Remove a row deliberately via its x button.
};

// Returns true when the trip count was persisted (or cleared) in the database,
// false when it could not be saved — e.g. the row has no valid material / dump
// model / dumping area because that master data has not been entered yet.
const setRowTrips = async (placementId, rowId, rawValue) => {
  // Never persist data for a slot that is still in the future.
  if (isFutureSlot(selection.date, selection.shiftType, selection.hour)) return false;

  const value = rawValue === "" ? 0 : Math.max(0, Number(rawValue) || 0);
  const placement = placementRow(placementId);
  if (!placement) return false;
  const excavatorId = placement.excavator_id;
  const areaId = placement.mining_area_id;
  const slot = placementId;

  const isDraft = rowId.startsWith("draft-");
  let materialCode;
  let dumpCode;
  let modelCode;
  if (isDraft) {
    const draftRow = draftRowsByKey.value[currentKey.value]?.[slot]?.find((item) => item.id === rowId);
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

  // Trips are unique per (shift, hour, PLACEMENT, material, dump area, truck model),
  // so the same excavator can have separate rows in the same pit (one per placement).
  const matchKey = {
    shift_id: shiftId,
    log_hour: selection.hour,
    placement_id: placementId,
    material_id: materialId,
    dumping_area_id: dumpingAreaId,
    truck_model_id: truck.id,
  };

  if (value === 0) {
    await supabase.from("production_entries").delete().match(matchKey);
    // Drop persisted rows that hit zero; leave fresh draft rows in place so the
    // user can keep editing them.
    if (!isDraft) updateLocalTrip(placementId, `${materialCode}|${dumpCode}|${modelCode}`, 0);
    return true;
  }

  await supabase
    .from("production_entries")
    .upsert(
      { ...matchKey, excavator_id: excavatorId, mining_area_id: areaId, trips: value, tonnes: value * tonnesPerTripFor(modelCode) },
      { onConflict: "shift_id,log_hour,placement_id,material_id,dumping_area_id,truck_model_id" },
    );

  const compositeId = `${materialCode}|${dumpCode}|${modelCode}`;
  if (isDraft) {
    const key = currentKey.value;
    const drafts = { ...draftRowsByKey.value };
    const list = (drafts[key]?.[slot] || []).filter((item) => item.id !== rowId);
    drafts[key] = { ...(drafts[key] || {}), [slot]: list };
    draftRowsByKey.value = drafts;
  }
  updateLocalTrip(placementId, compositeId, value);
  return true;
};

// Set a truck model's tonnes/trip factor for the selected date's WEEK (writes
// the weekly factor history in truck_model_factors — no schema change to existing
// tables). Editable from Data entry as well as the Dump model page. Other weeks
// keep their own factor, so past dashboards stay unchanged.
const setTruckFactor = (code, rawValue) => setWeekFactor(code, weekStartOf(selection.date), rawValue);

// Per-hour Production note for a placement at the current (date, shift, hour). The
// note is hour-scoped, so a new hour starts blank.
const placementNoteFor = (placementId) => notesByKey.value[currentKey.value]?.[placementId] ?? "";
const setPlacementNote = async (placementId, value) => {
  const note = value ?? "";
  const key = currentKey.value;
  const next = { ...notesByKey.value };
  next[key] = { ...(next[key] || {}), [placementId]: note };
  notesByKey.value = next;
  const shiftId = await getOrCreateShiftId(selection.date, selection.shiftType);
  if (!shiftId) return;
  if (!note.trim()) {
    await supabase
      .from("placement_notes")
      .delete()
      .eq("placement_id", placementId)
      .eq("shift_id", shiftId)
      .eq("log_hour", selection.hour);
    return;
  }
  await supabase.from("placement_notes").upsert(
    { placement_id: placementId, shift_id: shiftId, log_hour: selection.hour, note },
    { onConflict: "placement_id,shift_id,log_hour" },
  );
};

// Per-hour RL for a placement at the current (date, shift, hour). If this hour has
// no value of its own, carry forward the most recent EARLIER hour's RL (so a new
// hour shows the latest reading), falling back to the placement's seed rl_meters.
const placementRlFor = (placementId) => {
  const exact = rlByKey.value[currentKey.value]?.[placementId];
  if (exact !== undefined && exact !== null) return exact;
  const idx = RL_SLOT_ORDER.findIndex(([st, h]) => st === selection.shiftType && h === selection.hour);
  for (let i = idx - 1; i >= 0; i -= 1) {
    const [st, h] = RL_SLOT_ORDER[i];
    const v = rlByKey.value[keyFor(selection.date, st, h)]?.[placementId];
    if (v !== undefined && v !== null) return v;
  }
  const placement = areaExcavators.value.find((p) => p.placementId === placementId);
  return placement?.rl ?? "";
};

// Set this hour's RL only (never touches earlier hours or the shared seed value).
// Blank / non-numeric removes this hour's override, so it carries forward again.
const setPlacementRl = async (placementId, value) => {
  const raw = value === "" || value == null ? null : Number(value);
  const rl = raw != null && Number.isFinite(raw) ? raw : null;
  const key = currentKey.value;
  const next = { ...rlByKey.value };
  if (rl == null) {
    if (next[key]) {
      const inner = { ...next[key] };
      delete inner[placementId];
      next[key] = inner;
    }
  } else {
    next[key] = { ...(next[key] || {}), [placementId]: rl };
  }
  rlByKey.value = next;
  const shiftId = await getOrCreateShiftId(selection.date, selection.shiftType);
  if (!shiftId) return;
  if (rl == null) {
    await supabase
      .from("placement_rl")
      .delete()
      .eq("placement_id", placementId)
      .eq("shift_id", shiftId)
      .eq("log_hour", selection.hour);
    return;
  }
  await supabase.from("placement_rl").upsert(
    { placement_id: placementId, shift_id: shiftId, log_hour: selection.hour, rl_meters: rl },
    { onConflict: "placement_id,shift_id,log_hour" },
  );
};

// True when a placement was removed in exactly the selected (date, shift, hour) —
// so it is hidden for that one hour only. Every other hour is unaffected.
const isPlacementRemovedNow = (placementId) => !!removedByKey.value[currentKey.value]?.[placementId];

// Remove a placement from THIS hour only: clears its trips / RL / note for the
// current hour and records an hour-scoped removal so the row disappears for this
// hour. No other hour (earlier OR later) — nor other shifts / dates — is touched.
const removePlacementFromHour = async (placementId) => {
  const shiftId = await getOrCreateShiftId(selection.date, selection.shiftType);
  if (!shiftId) return;
  const hour = selection.hour;

  await supabase.from("production_entries").delete().eq("placement_id", placementId).eq("shift_id", shiftId).eq("log_hour", hour);
  await supabase.from("placement_rl").delete().eq("placement_id", placementId).eq("shift_id", shiftId).eq("log_hour", hour);
  await supabase.from("placement_notes").delete().eq("placement_id", placementId).eq("shift_id", shiftId).eq("log_hour", hour);
  await supabase.from("placement_removed").upsert(
    { placement_id: placementId, shift_id: shiftId, log_hour: hour },
    { onConflict: "placement_id,shift_id,log_hour" },
  );

  // Local state: drop this placement from the current hour only and mark it removed.
  const key = currentKey.value;
  const dropFromKey = (store) => {
    const bucket = store.value[key];
    if (bucket && bucket[placementId]) {
      const copy = { ...bucket };
      delete copy[placementId];
      store.value = { ...store.value, [key]: copy };
    }
  };
  dropFromKey(entriesByKey);
  dropFromKey(draftRowsByKey);
  dropFromKey(rlByKey);
  dropFromKey(notesByKey);
  removedByKey.value = { ...removedByKey.value, [key]: { ...(removedByKey.value[key] || {}), [placementId]: true } };
};

export const useEntryStore = () => ({
  areas,
  dumpingAreaCodes,
  excavators,
  areaExcavators,
  entries,
  totals,
  sumBucket,
  getBucket,
  truckModels,
  setTruckFactor,
  updateExcavator,
  removeExcavator,
  addAreaExcavator,
  updateAreaExcavator,
  reassignPlacementExcavator,
  removeAreaExcavatorPlacement,
  placementNoteFor,
  setPlacementNote,
  placementRlFor,
  setPlacementRl,
  isPlacementRemovedNow,
  removePlacementFromHour,
  removePlacementTripsForDate,
  addEntryRow,
  removeEntryRow,
  updateEntryRow,
  setRowTrips,
  // Persist a production date as a shifts row (used by the Date header step so
  // picking/changing the date is saved to the database immediately).
  ensureShift: (date, shiftType) => getOrCreateShiftId(date, shiftType),
});
