<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from "vue";
import { useTweaks } from "../composables/useTweaks.js";
import { useMiningAreas } from "../composables/useMiningAreas.js";
import { useMaterialRoutes } from "../composables/useMaterialRoutes.js";
import { useShiftSelection } from "../composables/useShiftSelection.js";
import { useEntryStore, isWaste, rowTotal, rowTonnes, tonnesPerTripFor, excTotal } from "../composables/useEntryStore.js";
import { usePlanProduction } from "../composables/usePlanProduction.js";
import TopBar from "../components/common/TopBar.vue";
import StatusDot from "../components/common/StatusDot.vue";
import SearchSelect from "../components/common/SearchSelect.vue";
import TweaksPanel from "../components/common/TweaksPanel.vue";
import TweakSection from "../components/common/TweakSection.vue";
import TweakRadio from "../components/common/TweakRadio.vue";
import TweakColor from "../components/common/TweakColor.vue";

const fmt = (n) => Math.round(Number(n)).toLocaleString("en-US");

const { areas: miningAreas } = useMiningAreas();
const { routes: materialRoutes } = useMaterialRoutes();
const { selection } = useShiftSelection();
const {
  areas: liveAreas,
  dumpingAreaCodes,
  excavators,
  areaExcavators,
  entries,
  sumBucket,
  getBucket,
  truckModels,
  addAreaExcavator,
  updateAreaExcavator,
  reassignPlacementExcavator,
  removeAreaExcavatorPlacement,
  placementNoteFor,
  setPlacementNote,
  addEntryRow,
  removeEntryRow,
  updateEntryRow,
  setRowTrips,
  setTruckFactor,
} = useEntryStore();

// A Data entry row is one placement; its trips live under the slot key = its
// placement id in `entries`.
const slotKeyOf = (placement) => placement.placementId;

const { getDatePlans, savePlan, removePlan } = usePlanProduction();

const TRUCKS = computed(() => truckModels.value.map((row) => row.code));

// Step 3 works one area at a time. The area list is driven by the pits/patterns
// planned in Step 2, plus any area that already has excavators (live) or that the
// user jumped to via "+ Add area" without adding an excavator yet.
const visitedAreas = ref(new Set());
const areaTabs = computed(() =>
  Array.from(new Set([...pits.value.map((pit) => pit.name), ...liveAreas.value, ...visitedAreas.value])).sort((a, b) => a.localeCompare(b)),
);

// Excavators that actually logged trips for the selected date (both shifts). The
// Excavator master page is only a dropdown source, so the step card counts what's
// been entered here — like the Plan Production card counts entered patterns — not
// the size of the master roster. Only currently-active excavators count: removing
// one (soft delete) leaves its trips in the DB, but it should drop off this tally.
const enteredExcavatorCount = computed(() => {
  const activeUids = new Set(excavators.value.map((excavator) => excavator.uid));
  const used = new Set();
  ["Day", "Night"].forEach((shiftType) => {
    for (let hour = 0; hour < 24; hour += 1) {
      Object.entries(getBucket(selection.date, shiftType, hour)).forEach(([slot, entry]) => {
        if (activeUids.has(entry.excavatorId) && excTotal(entry) > 0) used.add(slot);
      });
    }
  });
  return used.size;
});

const [t, setTweak] = useTweaks({
  accent: "#d99a00",
  density: "compact",
  theme: "light",
});

watchEffect(() => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = t.theme;
  document.documentElement.dataset.density = t.density;
  document.documentElement.style.setProperty("--accent", t.accent);
});

const dateLabel = computed(() => {
  const [y, m, d] = selection.date.split("-");
  return d && m && y ? `${Number(d)}/${Number(m)}/${y}` : selection.date;
});
const hourLabel = computed(() => {
  const a = String(selection.hour).padStart(2, "0");
  const b = String((selection.hour + 1) % 24).padStart(2, "0");
  return `${a}:00 - ${b}:00`;
});
const currentEntryStep = ref(1);
const goToEntryStep = (step) => {
  currentEntryStep.value = Math.min(2, Math.max(1, step));
};
const newPitName = ref("");
const pitDropdownOpen = ref(false);
const pits = ref([]);
const selectedPitName = ref("");
const pitAmounts = ref({});
const selectedPit = computed(() => pits.value.find((pit) => pit.name === selectedPitName.value) ?? null);
const filteredPitOptions = computed(() => {
  const query = newPitName.value.trim().toUpperCase();
  const options = miningDataOptions.value.filter((option) => !pits.value.some((pit) => pit.name === option));
  if (!query) return options;
  return options.filter((option) => option.includes(query));
});

const pitInput = ref(null);
let pitCloseTimer = 0;

// Add a pit and immediately get ready for the next one: clear the field, keep
// the dropdown open showing the remaining options, and refocus the input so the
// user can keep adding pits continuously without clicking back into the field.
const commitPit = (rawName) => {
  const name = String(rawName ?? "").trim().toUpperCase();
  if (!name || pits.value.some((pit) => pit.name === name)) return;
  pits.value.push({ name });
  pitAmounts.value[name] = { soil: "", ore: "" };
  selectedPitName.value = name;
  newPitName.value = "";
  // Persist the new pattern immediately (with zero amounts) so it survives a
  // reload; soil/ore are saved as they're filled in (see persistSelectedPit).
  savePlan(name, { soil: 0, ore: 0 });
  window.clearTimeout(pitCloseTimer);
  pitDropdownOpen.value = true;
  nextTick(() => pitInput.value?.focus());
};

const addPit = () => commitPit(newPitName.value);

const pickPitOption = (option) => commitPit(option);

const closePitDropdown = () => {
  pitCloseTimer = window.setTimeout(() => {
    pitDropdownOpen.value = false;
  }, 120);
};

const deleteSelectedPit = () => {
  if (!selectedPitName.value) return;
  const nextPits = pits.value.filter((pit) => pit.name !== selectedPitName.value);
  const removed = selectedPitName.value;
  pits.value = nextPits;
  delete pitAmounts.value[removed];
  selectedPitName.value = nextPits[0]?.name ?? "";
  removePlan(removed);
};

const formatCommaNumber = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? Number(digits).toLocaleString("en-US") : "";
};

const updatePitAmount = (type, value) => {
  if (!selectedPitName.value) return;
  pitAmounts.value[selectedPitName.value][type] = formatCommaNumber(value);
};
const parseCommaNumber = (value) => Number(String(value ?? "").replace(/,/g, "")) || 0;
const selectedPitPlan = computed(() => {
  const values = pitAmounts.value[selectedPitName.value] ?? { soil: "", ore: "" };
  return {
    name: selectedPitName.value,
    soil: values.soil || "0",
    ore: values.ore || "0",
    total: parseCommaNumber(values.soil) + parseCommaNumber(values.ore),
  };
});
const continueToDrillLog = () => {
  if (!selectedPitName.value) return;
  area.value = selectedPitName.value;
  goToEntryStep(2);
};

// Hydrate the local pit editing buffer from the persisted plan whenever the
// selected date changes (the plan store reloads on date change). Plan Production
// is one daily plan covering both shifts, so this is the whole date's merged plan
// regardless of the selected shift. Editing stays local until the field blurs
// (persistSelectedPit).
const persistedPlans = computed(() => getDatePlans(selection.date));
watch(
  persistedPlans,
  (plans) => {
    const names = Object.keys(plans);
    pits.value = names.map((name) => ({ name }));
    pitAmounts.value = Object.fromEntries(
      names.map((name) => [
        name,
        {
          soil: plans[name].soil ? plans[name].soil.toLocaleString("en-US") : "",
          ore: plans[name].ore ? plans[name].ore.toLocaleString("en-US") : "",
        },
      ]),
    );
    if (!names.includes(selectedPitName.value)) selectedPitName.value = names[0] ?? "";
  },
  { immediate: true },
);

// Save the currently selected pit's soil/ore to Supabase (called on input blur).
const persistSelectedPit = () => {
  const name = selectedPitName.value;
  if (!name) return;
  const values = pitAmounts.value[name] ?? { soil: "", ore: "" };
  savePlan(name, { soil: parseCommaNumber(values.soil), ore: parseCommaNumber(values.ore) });
};
const patternFilter = ref("");
const selectedPatternId = ref("");
const drillLog = ref({
  hour: selection.hour,
  shift: "Day",
  rig: "HE-001",
  operator: "Mr. Hounkham Chansyna",
  bitSize: "89",
  totalDrilling: "0",
  redrill: "0",
  smuStart: "0",
  smuEnd: "0",
  drifterStart: "0",
  drifterEnd: "0",
});
const drillPitName = computed(() => selectedPitName.value || pits.value[0]?.name || "No pattern selected");
const drillPatterns = computed(() =>
  pits.value.map((pit) => {
    const values = pitAmounts.value[pit.name] ?? { soil: "", ore: "" };
    const plan = parseCommaNumber(values.soil) + parseCommaNumber(values.ore);
    return {
      id: pit.name,
      pit: pit.name,
      progress: 0,
      holes: 0,
      remain: plan,
      plan,
      bit: 89,
      soil: values.soil || "0",
      ore: values.ore || "0",
    };
  }),
);
const filteredDrillPatterns = computed(() => {
  const query = patternFilter.value.trim().toUpperCase();
  if (!query) return drillPatterns.value;
  return drillPatterns.value.filter((pattern) => pattern.id.includes(query) || pattern.pit.includes(query));
});
const selectedPattern = computed(() => drillPatterns.value.find((pattern) => pattern.id === selectedPatternId.value) ?? drillPatterns.value[0]);
watch(drillPatterns, (patterns) => {
  if (patterns.length === 0) {
    selectedPatternId.value = "";
    return;
  }
  if (!patterns.some((pattern) => pattern.id === selectedPatternId.value)) {
    selectedPatternId.value = patterns[0].id;
    drillLog.value.bitSize = String(patterns[0].bit);
  }
}, { immediate: true });
const selectPattern = (pattern) => {
  selectedPatternId.value = pattern.id;
  drillLog.value.bitSize = String(pattern.bit);
};
const drillHourOptions = computed(() => {
  const values = drillLog.value.shift === "Day" ? [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] : [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5];
  return values.map((hour) => {
    const a = String(hour).padStart(2, "0");
    const b = String((hour + 1) % 24).padStart(2, "0");
    return { value: hour, label: `${a}:00 - ${b}:00` };
  });
});const smuHours = computed(() => Math.max(0, Number(drillLog.value.smuEnd) - Number(drillLog.value.smuStart)));
const drifterHours = computed(() => Math.max(0, Number(drillLog.value.drifterEnd) - Number(drillLog.value.drifterStart)));

const area = ref(areaTabs.value[0]);
const openPlacementId = ref(null);
const addingArea = ref(false);
const selectedAddArea = ref("");
const addAreaQuery = ref("");
const addAreaOpen = ref(false);

const selectedArea = computed(() => (areaTabs.value.includes(area.value) ? area.value : areaTabs.value[0]));
const selectedIndex = computed(() => Math.max(0, areaTabs.value.indexOf(selectedArea.value)));
// Data entry rows = the excavator placements in the selected pit (one row per
// placement). The same excavator can also be placed in other pits.
const detailRows = computed(() => areaExcavators.value.filter((placement) => placement.area === selectedArea.value));
const detailTrips = computed(() => detailRows.value.reduce((sum, placement) => sum + excTotal(entries.value[slotKeyOf(placement)]), 0));

// EXCAVATOR cell options: every registered unit. Duplicates are allowed now — the
// same excavator can be placed in a pit more than once (each row keeps its own
// trips via placement_id) and in multiple pits.
const availableExcavatorCodes = computed(() =>
  excavators.value
    .map((excavator) => excavator.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b)),
);
const rowExcavatorOptions = (placement) =>
  Array.from(new Set([placement.name, ...availableExcavatorCodes.value].filter(Boolean))).sort((a, b) => a.localeCompare(b));
// Step 2 plan (soil/ore/total) for the area currently selected in Step 3.
const selectedAreaPlan = computed(() => {
  const values = pitAmounts.value[selectedArea.value] ?? { soil: "", ore: "" };
  return {
    soil: values.soil || "0",
    ore: values.ore || "0",
    total: parseCommaNumber(values.soil) + parseCommaNumber(values.ore),
  };
});
const openExc = computed(() => (openPlacementId.value ? areaExcavators.value.find((placement) => placement.placementId === openPlacementId.value) : null));
const openEntry = computed(() => (openExc.value ? entries.value[slotKeyOf(openExc.value)] : null));

const miningDataOptions = computed(() => [...miningAreas.value].sort((a, b) => a.localeCompare(b)));

const filteredAddAreaOptions = computed(() => {
  const query = addAreaQuery.value.trim().toUpperCase();
  if (!query) return miningDataOptions.value;
  return miningDataOptions.value.filter((option) => option.includes(query));
});

watch(
  miningDataOptions,
  (options) => {
    if (!options.includes(selectedAddArea.value)) {
      selectedAddArea.value = options[0] ?? "";
      addAreaQuery.value = selectedAddArea.value;
    }
  },
  { immediate: true },
);

const areaCards = computed(() =>
  areaTabs.value.map((name) => {
    const placements = areaExcavators.value.filter((placement) => placement.area === name);
    const trips = placements.reduce((sum, placement) => sum + excTotal(entries.value[slotKeyOf(placement)]), 0);
    const worst = placements.some((placement) => placement.status === "alert")
      ? "alert"
      : placements.some((placement) => placement.status === "warn")
        ? "warn"
        : "ok";
    return { name, excavators: placements, trips, worst };
  }),
);

const summary = computed(() => {
  let waste = 0;
  let ore = 0;
  Object.values(entries.value).forEach((entry) => {
    entry.rows.forEach((row) => {
      const total = rowTotal(row);
      if (isWaste(row.material)) waste += total;
      else ore += total;
    });
  });
  const activeAreas = areaTabs.value.filter((name) =>
    Object.values(entries.value).some((entry) => entry.area === name && excTotal(entry) > 0),
  ).length;

  let priorTrips = 0;
  for (let hour = 0; hour < selection.hour; hour += 1) {
    const { soft, ore: oreAtHour } = sumBucket(selection.date, selection.shiftType, hour);
    priorTrips += soft + oreAtHour;
  }

  return {
    waste,
    ore,
    activeAreas,
    tripsShift: priorTrips + waste + ore,
  };
});

const modalGrandTotal = computed(() => (openEntry.value ? openEntry.value.rows.reduce((sum, row) => sum + rowTotal(row), 0) : 0));
const modalGrandTonnes = computed(() => (openEntry.value ? openEntry.value.rows.reduce((sum, row) => sum + rowTonnes(row), 0) : 0));

const selectAreaByIndex = (value) => {
  area.value = areaTabs.value[Number(value)] ?? areaTabs.value[0];
};

const startAddArea = () => {
  selectedAddArea.value = miningDataOptions.value[0] ?? "";
  addAreaQuery.value = selectedAddArea.value;
  addingArea.value = true;
};

const onAddAreaInput = (event) => {
  addAreaQuery.value = event.target.value;
  addAreaOpen.value = true;
  const match = miningDataOptions.value.find((option) => option === addAreaQuery.value.trim().toUpperCase());
  selectedAddArea.value = match ?? "";
};

const pickAddArea = (option) => {
  selectedAddArea.value = option;
  addAreaQuery.value = option;
  addAreaOpen.value = false;
};

const closeAddAreaDropdown = () => {
  window.setTimeout(() => {
    addAreaOpen.value = false;
  }, 120);
};

const commitArea = () => {
  const name = selectedAddArea.value;
  if (!name) return;
  visitedAreas.value.add(name);
  area.value = name;
  selectedAddArea.value = miningDataOptions.value[0] ?? "";
  addAreaQuery.value = selectedAddArea.value;
  addAreaOpen.value = false;
  addingArea.value = false;
};

// Edit a placement's per-pit fields (trucks / RL / note) — stored on area_excavators
// so they're independent per pit.
const setExc = (placement, patch) => updateAreaExcavator(placement.placementId, patch);

// True when this placement's slot has trips logged for the selected date.
const placementHasDateTrips = (placement) => {
  const slot = slotKeyOf(placement);
  for (const shiftType of ["Day", "Night"]) {
    for (let hour = 0; hour < 24; hour += 1) {
      const entry = getBucket(selection.date, shiftType, hour)[slot];
      if (entry && excTotal(entry) > 0) return true;
    }
  }
  return false;
};

// Change which excavator occupies this pit slot — ALWAYS editable, even after trips
// are entered. Only THIS row changes; its trips stay with the row and follow to the
// chosen unit (reassignPlacementExcavator re-stamps production_entries.excavator_id).
// Other pits/rows are untouched, and the chosen unit may already be working elsewhere.
const pickExcavator = async (placement, code) => {
  if (!code || code === placement.name) return;
  const target = excavators.value.find((excavator) => excavator.name === code);
  if (!target || target.uid === placement.uid) return;
  await reassignPlacementExcavator(placement.placementId, target.uid);
};

// "+ Add excavator" places the first available unit (one not already in this pit)
// into the selected pit as a fresh, blank row. The same unit can also sit in other
// pits, so adding here never pulls it out of another pit.
const assignableExcavators = computed(() => [...availableExcavatorCodes.value].sort((a, b) => a.localeCompare(b)));
const addExcavator = async () => {
  const code = assignableExcavators.value[0];
  if (!code) return;
  const target = excavators.value.find((excavator) => excavator.name === code);
  if (target) await addAreaExcavator(selectedArea.value, target.uid);
};

// Remove this placement from the pit: deletes ALL its trips and the placement row
// from the database (removeAreaExcavatorPlacement). Other pits / other rows of the
// same excavator are untouched.
const deleteExc = async (placement) => {
  await removeAreaExcavatorPlacement(placement.placementId);
  if (openPlacementId.value === placement.placementId) openPlacementId.value = null;
};

// A placement is "blank" — never used — when its slot has no trips for the date and
// no operational data (trucks / RL / note). Used to stop "+ Add excavator" from
// piling up empty rows, and to clear them out in one go.
const isBlankExcavator = (placement) =>
  !placementHasDateTrips(placement) && !Number(placement.trucks) && !Number(placement.rl) && !String(placementNoteFor(placement.placementId) || "").trim();
const emptyDetailRows = computed(() => detailRows.value.filter(isBlankExcavator));
const hasUnusedRow = computed(() => emptyDetailRows.value.length > 0);

// Remove every blank placement from this pit at once (they hold no data).
const clearEmptyExcavators = async () => {
  for (const placement of [...emptyDetailRows.value]) {
    await removeAreaExcavatorPlacement(placement.placementId);
    if (openPlacementId.value === placement.placementId) openPlacementId.value = null;
  }
};

const setEntryRow = (row, patch) => {
  if (!openExc.value) return;
  updateEntryRow(openExc.value.placementId, row.id, patch);
};

// The trip-entry dropdowns are driven by the Material Routes master data:
// material type (Ore/Waste) -> ore type -> destination location. A row stores
// the ore type as `material` and the location as `dump`, matching the existing
// production_entries shape.
const MATERIAL_TYPES = ["Ore", "Waste"];

const materialTypeOf = (oreType) => {
  const route = materialRoutes.value.find((item) => item.oreType === oreType);
  if (route) return route.material;
  return isWaste(oreType) ? "Waste" : "Ore";
};

const oreTypesForType = (materialType) =>
  Array.from(new Set(materialRoutes.value.filter((item) => item.material === materialType).map((item) => item.oreType))).sort((a, b) => a.localeCompare(b));

// "To location" is its own master now (the Locations page → dumping_areas),
// independent of the material route: every row offers the same destination list.
// Until a project's locations have been migrated into the Locations master, fall
// back to any locations still referenced in material_routes so the dropdown is
// never empty; picking one migrates it into the master on save (getOrCreateDumpingAreaId).
const locationOptions = computed(() => {
  const fromMaster = dumpingAreaCodes.value;
  const fromRoutes = materialRoutes.value.map((route) => route.location).filter(Boolean);
  return Array.from(new Set([...fromMaster, ...fromRoutes])).sort((a, b) => a.localeCompare(b));
});

// Options for a row's selects, always including the row's current value so a
// previously-saved combination still shows even if its route/location was later removed.
const rowOreOptions = (row) => {
  const list = oreTypesForType(materialTypeOf(row.material));
  return row.material && !list.includes(row.material) ? [row.material, ...list] : list;
};

const rowLocationOptions = (row) => {
  const list = locationOptions.value;
  return row.dump && !list.includes(row.dump) ? [row.dump, ...list] : list;
};

// Changing the material type picks the first ore type of that type; the
// destination (To location) is independent so the row keeps its current value.
const setRowMaterialType = (row, materialType) => {
  const ore = oreTypesForType(materialType)[0] ?? "";
  setEntryRow(row, { material: ore });
};

const setRowOreType = (row, oreType) => {
  setEntryRow(row, { material: oreType });
};

// A fresh row defaults its material type / ore type to the first material route
// and its To location to the first available destination, so every dropdown shows
// a valid value (and saves) without the user having to touch them.
const defaultRouteFor = (placement) => {
  const first = materialRoutes.value[0];
  if (!first) return;
  const rows = entries.value[slotKeyOf(placement)]?.rows ?? [];
  const newRow = rows[rows.length - 1];
  if (newRow) {
    updateEntryRow(placement.placementId, newRow.id, {
      material: first.oreType,
      dump: newRow.dump || locationOptions.value[0] || first.location || "",
    });
  }
};

const tripSaveState = ref("idle"); // idle | saving | saved | error
const tripSaveMessage = ref("");

const setTrip = async (row, value) => {
  if (!openExc.value) return;
  tripSaveState.value = "saving";
  tripSaveMessage.value = "Saving to database…";
  const ok = await setRowTrips(openExc.value.placementId, row.id, value);
  if (ok) {
    tripSaveState.value = "saved";
    tripSaveMessage.value = "Saved to database.";
  } else {
    tripSaveState.value = "error";
    tripSaveMessage.value = "Cannot save — check the date/hour isn't in the future, and that Material, Dumping area and Dump model master data exist.";
  }
};

// Save the dump model's tonnes/trip factor from the trip grid. The factor is a
// property of the truck model, so this updates the model master (and every row /
// dashboard using it), same as editing it on the Dump model page.
const setFactor = (row, value) => setTruckFactor(row.model, value);

const addModalRow = () => {
  if (!openExc.value) return;
  addEntryRow(openExc.value.placementId);
  defaultRouteFor(openExc.value);
};

const deleteModalRow = (id) => {
  if (!openExc.value || !openEntry.value || openEntry.value.rows.length <= 1) return;
  removeEntryRow(openExc.value.placementId, id);
};

// Carry the most recent EARLIER hour's rows (material / ore / location / dump model)
// into a fresh hour as draft rows — but with Trips reset to 0, so the operator only
// re-keys the trip counts. Returns true when something was carried.
const HOUR_SEQUENCE = {
  Day: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
  Night: [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5],
};
const carryForwardRows = (placement) => {
  const order = HOUR_SEQUENCE[selection.shiftType] || [];
  const idx = order.indexOf(selection.hour);
  if (idx <= 0) return false;
  const slot = slotKeyOf(placement);
  for (let i = idx - 1; i >= 0; i -= 1) {
    const prev = getBucket(selection.date, selection.shiftType, order[i])[slot];
    if (prev && prev.rows.length > 0) {
      prev.rows.forEach((row) => addEntryRow(placement.placementId, { material: row.material, dump: row.dump, model: row.model }));
      return true;
    }
  }
  return false;
};

// Ensure the trip-entry modal always has at least one row to fill in: carry the
// previous hour's rows forward (trips reset), else seed one default row.
watch(openPlacementId, (id) => {
  tripSaveState.value = "idle";
  tripSaveMessage.value = "";
  if (!id) return;
  const placement = areaExcavators.value.find((item) => item.placementId === id);
  if (!placement) return;
  const entry = entries.value[slotKeyOf(placement)];
  if (!entry || entry.rows.length === 0) {
    if (!carryForwardRows(placement)) {
      addEntryRow(placement.placementId);
      defaultRouteFor(placement);
    }
  }
});

const onKeyDown = (event) => {
  if (event.key === "Escape") {
    if (addingArea.value) {
      addingArea.value = false;
      selectedAddArea.value = miningDataOptions.value[0] ?? "";
    } else {
      openPlacementId.value = null;
    }
  }
};

onMounted(() => {
  window.addEventListener("keydown", onKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeyDown);
});
</script>

<template>
  <div class="entry-dash">
    <TopBar subtitle="Data entry" />

    <section class="entry-plan-top">
      <div class="entry-stepper entry-stepper-2" aria-label="Data entry steps">
        <button class="entry-step-card" :class="{ active: currentEntryStep === 1 }" type="button" @click="goToEntryStep(1)">
          <span class="entry-step-badge">1</span>
          <div>
            <span class="entry-step-title">Plan Production</span>
            <span class="entry-step-sub">{{ pits.length }} pattern sources</span>
          </div>
        </button>
        <span class="entry-step-line" />
        <button class="entry-step-node" :class="{ active: currentEntryStep === 2 }" type="button" @click="goToEntryStep(2)">
          <span class="entry-step-badge">2</span>
          <div>
            <span class="entry-step-title">Excavators</span>
            <span class="entry-step-sub">{{ enteredExcavatorCount }} units</span>
          </div>
        </button>
      </div>
    </section>

    <section v-if="currentEntryStep === 1" class="pit-entry-panel">
      <div class="pit-entry-toolbar">
        <div class="pit-combo-wrap">
          <input
            ref="pitInput"
            v-model="newPitName"
            class="pit-name-input mono"
            type="text"
            placeholder="Search patterns e.g. NLU03A"
            autocomplete="off"
            @focus="pitDropdownOpen = true"
            @input="pitDropdownOpen = true"
            @blur="closePitDropdown"
            @keydown.enter="addPit"
            @keydown.esc="pitDropdownOpen = false"
          />
          <div v-if="pitDropdownOpen" class="pit-combo-list">
            <button
              v-for="option in filteredPitOptions"
              :key="option"
              type="button"
              class="pit-combo-option"
              @mousedown.prevent="pickPitOption(option)"
            >
              {{ option }}
            </button>
            <span v-if="filteredPitOptions.length === 0" class="pit-combo-empty">
              {{ miningDataOptions.length === 0 ? "No Mining data available" : "No matches" }}
            </span>
          </div>
        </div>
        <div class="pit-toolbar-actions">
          <button class="pit-delete-btn" type="button" :disabled="!selectedPit" @click="deleteSelectedPit">x Delete current pit</button>
        </div>
      </div>

      <div v-if="pits.length > 0" class="pit-tabs" aria-label="Pit list">
        <button
          v-for="pit in pits"
          :key="pit.name"
          class="pit-tab"
          :class="{ on: pit.name === selectedPitName }"
          type="button"
          @click="selectedPitName = pit.name"
        >
          {{ pit.name }}
        </button>
      </div>

      <div v-if="selectedPit" class="pit-material-form">
        <label class="entry-field">
          <span>Waste</span>
          <input
            class="entry-text-input mono"
            type="text"
            inputmode="numeric"
            placeholder="0"
            :value="pitAmounts[selectedPitName]?.soil"
            @input="updatePitAmount('soil', $event.target.value)"
            @blur="persistSelectedPit"
          />
        </label>
        <label class="entry-field">
          <span>Ore</span>
          <input
            class="entry-text-input mono"
            type="text"
            inputmode="numeric"
            placeholder="0"
            :value="pitAmounts[selectedPitName]?.ore"
            @input="updatePitAmount('ore', $event.target.value)"
            @blur="persistSelectedPit"
          />
        </label>
        <div class="pit-next-row">
          <button class="pit-next-btn" type="button" :disabled="!selectedPit" @click="continueToDrillLog">Continue to Excavators -></button>
        </div>
      </div>
    </section>
    <section v-if="currentEntryStep === 2" class="entry-layout">
      <aside class="area-side">
        <div class="area-side-head">
          <h2>Mining area</h2>
          <span class="area-count-pill mono">{{ selectedIndex + 1 }} / {{ areaTabs.length }}</span>
        </div>

        <div class="area-slider-wrap">
          <div class="slider-rail">
            <span class="slider-cap">TOP</span>
            <input
              class="area-slider"
              type="range"
              min="0"
              :max="Math.max(0, areaTabs.length - 1)"
              :value="selectedIndex"
              :disabled="areaTabs.length <= 1"
              @input="selectAreaByIndex($event.target.value)"
            />
            <span class="slider-cap">END</span>
          </div>

          <div class="area-list">
            <button
              v-for="card in areaCards"
              :key="card.name"
              class="area-item"
              :class="{ on: card.name === selectedArea }"
              type="button"
              @click="area = card.name"
            >
              <div class="area-item-top">
                <span class="area-item-code">{{ card.name }}</span>
                <StatusDot :status="card.worst" />
              </div>
              <div class="area-item-meta">
                <span><b>{{ card.excavators.length }}</b> exc</span>
                <span><b>{{ card.trips }}</b> trips</span>
              </div>
            </button>

            <div v-if="addingArea" class="area-add-row">
              <div class="combo-wrap">
                <input
                  v-model="addAreaQuery"
                  class="area-add-input mono"
                  type="text"
                  placeholder="Search mining data"
                  autocomplete="off"
                  @focus="addAreaOpen = true"
                  @input="onAddAreaInput"
                  @blur="closeAddAreaDropdown"
                  @keydown.enter="commitArea"
                  @keydown.esc="addingArea = false"
                />
                <div v-if="addAreaOpen" class="combo-list">
                  <button
                    v-for="option in filteredAddAreaOptions"
                    :key="option"
                    type="button"
                    class="combo-option"
                    :class="{ on: option === selectedAddArea }"
                    @mousedown.prevent="pickAddArea(option)"
                  >
                    {{ option }}
                  </button>
                  <span v-if="filteredAddAreaOptions.length === 0" class="combo-empty">
                    {{ miningDataOptions.length === 0 ? "No mining data available" : "No matches" }}
                  </span>
                </div>
              </div>
              <button class="area-add-ok" type="button" :disabled="!selectedAddArea" @click="commitArea">OK</button>
            </div>
            <button v-else class="add-tile" type="button" @click="startAddArea">+ Add area</button>
          </div>
        </div>
      </aside>

      <div class="area-detail">
        <div class="detail-head">
          <div class="detail-id">
            <span class="mark" />
            <div>
              <div class="detail-code mono">{{ selectedArea || "-" }}</div>
              <div class="detail-sub">{{ selection.shiftType }} shift - {{ dateLabel }} - {{ hourLabel }}</div>
            </div>
          </div>
          <div class="detail-loaded">
            <div class="dl-v mono">{{ detailTrips }}</div>
            <div class="dl-k">Trips loaded</div>
          </div>
        </div>

        <div class="detail-plan">
          <span><b>Plan source</b>{{ selectedArea || "-" }}</span>
          <span><b>Waste</b>{{ selectedAreaPlan.soil }}</span>
          <span><b>Ore</b>{{ selectedAreaPlan.ore }}</span>
          <span><b>Total</b>{{ fmt(selectedAreaPlan.total) }}</span>
        </div>

        <section class="exc-panel">
          <div class="area-side-head">
            <h2>Excavators - {{ detailRows.length }} units</h2>
            <div style="display: flex; gap: 8px; align-items: center">
              <button
                v-if="hasUnusedRow"
                class="btn"
                type="button"
                :title="`Remove ${emptyDetailRows.length} empty excavator(s) from this area`"
                @click="clearEmptyExcavators"
              >
                x Clear empty ({{ emptyDetailRows.length }})
              </button>
              <button
                class="add-exc"
                type="button"
                :disabled="!selectedArea || assignableExcavators.length === 0"
                @click="addExcavator"
              >
                + Add excavator
              </button>
            </div>
          </div>

          <div class="exc-list">
            <div class="exc-row head">
              <span class="exc-cell">Excavator</span>
              <span class="exc-cell num">Trucks in fleet</span>
              <span class="exc-cell num">RL (m)</span>
              <span class="exc-cell">Production note</span>
              <span class="exc-cell num">Trips</span>
              <span class="exc-cell" />
              <span class="exc-cell" />
            </div>

            <div v-for="exc in detailRows" :key="exc.placementId" class="exc-row">
              <div class="exc-cell exc-name">
                <StatusDot :status="exc.status" />
                <SearchSelect
                  :model-value="exc.name"
                  :options="rowExcavatorOptions(exc)"
                  placeholder="Search excavator"
                  empty-text="No excavator available"
                  @change="pickExcavator(exc, $event)"
                />
              </div>
              <div class="exc-cell num">
                <input
                  class="exc-mini-input"
                  type="number"
                  min="0"
                  placeholder="0"
                  :value="exc.trucks === 0 ? '' : exc.trucks"
                  @change="setExc(exc, { trucks: $event.target.value })"
                />
              </div>
              <div class="exc-cell num">
                <input
                  class="exc-mini-input"
                  type="number"
                  min="0"
                  :value="exc.rl"
                  @change="setExc(exc, { rl: $event.target.value })"
                />
              </div>
              <div class="exc-cell">
                <input
                  class="exc-note-input"
                  type="text"
                  placeholder="Delay, ground, status..."
                  :value="placementNoteFor(exc.placementId)"
                  @change="setPlacementNote(exc.placementId, $event.target.value)"
                />
              </div>
              <div class="exc-cell num">
                <span class="exc-trip" :class="{ zero: excTotal(entries[slotKeyOf(exc)]) === 0 }">{{ excTotal(entries[slotKeyOf(exc)]) }}</span>
              </div>
              <div class="exc-cell">
                <button class="exc-enter-btn" type="button" @click="openPlacementId = exc.placementId">Enter trips ▸</button>
              </div>
              <div class="exc-cell">
                <button class="gt-del" type="button" aria-label="Remove this excavator from the pit" title="Remove this excavator from the pit" @click="deleteExc(exc)">x</button>
              </div>
            </div>

            <div v-if="detailRows.length === 0" class="exc-empty">
              No excavators in this area yet. Use "+ Add excavator" to assign a registered unit — create new ones on the Excavator page.
            </div>
          </div>
        </section>
      </div>
    </section>

    <div v-if="openExc && openEntry" class="modal-overlay" @mousedown.self="openPlacementId = null">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div class="modal-title">
            <span class="exc mono">{{ openExc.name }}</span>
            <span class="chip">{{ openExc.area }}</span>
            <span class="sub">{{ openExc.trucks }} trucks - {{ hourLabel }}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 16px">
            <div class="modal-loaded">
              <b class="mono">{{ modalGrandTotal }}</b>
              <span>Trips this hour</span>
            </div>
            <button class="modal-x" type="button" aria-label="Close" @click="openPlacementId = null">x</button>
          </div>
        </div>

        <div class="modal-body">
          <p class="modal-hint">Each row is a material type + destination combination. Enter trip count per truck model; Factor (tonnes/trip, for this week) × Trips = Tonnes. Editing a factor sets it for the selected date's week.</p>
          <table class="grid-table">
            <thead>
              <tr>
                <th class="th-mat">Material type</th>
                <th class="th-dump">Ore type</th>
                <th class="th-dump">To location</th>
                <th class="th-dump">Dump model</th>
                <th class="th-tot">Factor (t/trip)</th>
                <th class="th-tot">Trips</th>
                <th class="th-tot">Tonnes</th>
                <th class="th-x" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in openEntry.rows" :key="row.id">
                <td>
                  <select class="gt-sel" :value="materialTypeOf(row.material)" @change="setRowMaterialType(row, $event.target.value)">
                    <option v-for="type in MATERIAL_TYPES" :key="type" :value="type">{{ type }}</option>
                  </select>
                </td>
                <td>
                  <SearchSelect
                    :model-value="row.material"
                    :options="rowOreOptions(row)"
                    placeholder="Search ore type"
                    empty-text="No ore type available"
                    @change="setRowOreType(row, $event)"
                  />
                </td>
                <td>
                  <SearchSelect
                    :model-value="row.dump"
                    :options="rowLocationOptions(row)"
                    placeholder="Search location"
                    empty-text="No location available"
                    @change="setEntryRow(row, { dump: $event })"
                  />
                </td>
                <td>
                  <SearchSelect
                    :model-value="row.model"
                    :options="TRUCKS"
                    placeholder="Search dump model"
                    empty-text="No dump model available"
                    @change="setEntryRow(row, { model: $event })"
                  />
                </td>
                <td class="gt-trip-cell">
                  <input
                    class="gt-num"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="43.7"
                    :value="tonnesPerTripFor(row.model)"
                    :disabled="!row.model"
                    @change="setFactor(row, $event.target.value)"
                  />
                </td>
                <td class="gt-trip-cell">
                  <input
                    class="gt-num"
                    type="number"
                    min="0"
                    placeholder="0"
                    :value="row.trips === 0 ? '' : row.trips"
                    @input="setTrip(row, $event.target.value)"
                  />
                </td>
                <td class="gt-row-total">{{ fmt(rowTonnes(row)) }}</td>
                <td class="gt-x">
                  <button class="gt-del" type="button" aria-label="Delete row" :disabled="openEntry.rows.length === 1" @click="deleteModalRow(row.id)">x</button>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="tf-label" colspan="5">Trips total</td>
                <td>{{ modalGrandTotal }}</td>
                <td class="tf-grand">{{ fmt(modalGrandTonnes) }}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          <button class="add-row" type="button" @click="addModalRow">+ Add material / location row</button>
        </div>

        <div class="modal-foot">
          <span v-if="tripSaveMessage" class="foot-note entry-date-status" :class="tripSaveState">{{ tripSaveMessage }}</span>
          <span v-else class="foot-note">Entries save automatically.</span>
          <div class="foot-actions">
            <button class="btn btn-primary" type="button" @click="openPlacementId = null">Done</button>
          </div>
        </div>
      </div>
    </div>

    <TweaksPanel>
      <TweakSection label="Theme" />
      <TweakRadio label="Mode" :value="t.theme" :options="['dark', 'light']" @change="setTweak('theme', $event)" />
      <TweakColor label="Accent" :value="t.accent" :options="['#d99a00', '#22d3ee', '#a3e635', '#f472b6', '#fb7185']" @change="setTweak('accent', $event)" />
      <TweakSection label="Layout" />
      <TweakRadio label="Density" :value="t.density" :options="['compact', 'regular']" @change="setTweak('density', $event)" />
    </TweaksPanel>
  </div>
</template>
