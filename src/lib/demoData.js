// In-memory demo dataset for DEMO mode (no Supabase needed). buildDemoStore()
// returns a fresh { tableName: rows[] } map with all foreign keys linked by real
// generated ids, mirroring supabase/demo_seed.sql. Consumed by mockSupabase.js.

const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`);
const nowIso = () => new Date().toISOString();

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// dateIso for `offset` days ago (0 = today).
const daysAgoIso = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return isoOf(d);
};
// Monday (ISO week start) of the week containing dateIso — must match
// useTruckFactors.weekStartOf so seeded weekly factors line up at runtime.
const weekStartOf = (dateIso) => {
  const d = new Date(`${dateIso}T00:00:00`);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday … 6 = Sunday
  d.setDate(d.getDate() - dow);
  return isoOf(d);
};
const TONNES_PER_TRIP = 43.7;
// How many days of history to seed (so the date picker can browse back).
const DEMO_DAYS = 14;

// Deterministic 0..1 pseudo-random from a string seed, so a given day's numbers
// are stable within a session (varies day-to-day to make charts look real).
const seededUnit = (seed) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
};

export function buildDemoStore() {
  // ---- master data ----
  const areaCodes = ["DSW04B", "NLU03A", "NLU03B", "NLU03C", "TKS1A", "TKS1B", "TKS2A"];
  const mining_areas = areaCodes.map((code) => ({ id: uuid(), code, name: null, active: true, created_at: nowIso() }));
  const areaId = Object.fromEntries(mining_areas.map((a) => [a.code, a.id]));

  const materialsSeed = [
    ["WNAF", true], ["WPAF", true], ["AOLL", false], ["APMW", false],
  ];
  const materials = materialsSeed.map(([code, is_waste]) => ({ id: uuid(), code, is_waste, description: null, active: true, created_at: nowIso() }));
  const materialId = Object.fromEntries(materials.map((m) => [m.code, m.id]));

  // [code, capacity_tonnes]. capacity_tonnes IS the TD&MVDC factor — tonnes per
  // trip, the value trips are multiplied by (tonnes = trips * capacity_tonnes).
  // SKT90S/SKT105S have measured factors; the rest are null until set on the Dump
  // model page / Data entry grid (they fall back to TONNES_PER_TRIP at runtime).
  const truckSeed = [["SKT90S", 41.67], ["SKT105S", 48.98], ["CAT345", null], ["VSCSDT", null]];
  const truck_models = truckSeed.map(([code, cap]) => ({ id: uuid(), code, company: null, capacity_tonnes: cap, active: true, created_at: nowIso() }));
  const truckId = Object.fromEntries(truck_models.map((t) => [t.code, t.id]));
  const truckCapacity = Object.fromEntries(truck_models.map((t) => [t.code, t.capacity_tonnes ?? TONNES_PER_TRIP]));

  // ---- weekly factor history (truck_model_factors) ----
  // TD&MVDC factor changes each week, so seed three weeks of history for the
  // models that have measured values (the SKT90S/SKT105S columns from the source
  // sheet). The newest week matches capacity_tonnes; older weeks differ so the
  // history view and historical tonnes are visibly distinct.
  const factorWeeks = [
    [weekStartOf(daysAgoIso(14)), { SKT90S: 41.77, SKT105S: 49.1 }],
    [weekStartOf(daysAgoIso(7)), { SKT90S: 43.86, SKT105S: 51.56 }],
    [weekStartOf(daysAgoIso(0)), { SKT90S: 41.67, SKT105S: 48.98 }],
  ];
  const truck_model_factors = [];
  factorWeeks.forEach(([week_start, byCode]) => {
    Object.entries(byCode).forEach(([code, factor]) => {
      truck_model_factors.push({ id: uuid(), truck_model_id: truckId[code], week_start, factor, created_at: nowIso(), updated_at: nowIso() });
    });
  });

  // Effective seed factor for a truck on a date: latest weekly record on/before
  // that date's week, else the model's capacity_tonnes fallback. Mirrors
  // useTruckFactors.factorFor so seeded tonnes match what the dashboard computes.
  const factorForSeed = (code, dateIso) => {
    const ws = weekStartOf(dateIso);
    const recs = truck_model_factors
      .filter((row) => row.truck_model_id === truckId[code] && row.week_start <= ws)
      .sort((a, b) => a.week_start.localeCompare(b.week_start));
    return recs.length ? recs[recs.length - 1].factor : truckCapacity[code];
  };

  const dumpSeed = ["OREPAD", "ROCKPILE", "STOCKORE"];
  const dumping_areas = dumpSeed.map((code) => ({ id: uuid(), code, mining_area_id: null, active: true, created_at: nowIso() }));
  const dumpId = Object.fromEntries(dumping_areas.map((d) => [d.code, d.id]));

  // ---- users (login: admin/admin, manager/manager) ----
  const users = [
    { id: uuid(), name: "Administrator", username: "admin", password: "admin", role: "admin", active: true, created_at: nowIso(), updated_at: nowIso() },
    { id: uuid(), name: "Shift Manager", username: "manager", password: "manager", role: "manager", active: true, created_at: nowIso(), updated_at: nowIso() },
  ];

  // ---- excavators (one per area, varied status) ----
  const excSeed = [
    ["E-501", "CRP", "DSW04B", 4, 152.0, "ok"],
    ["E-502", "CRP", "NLU03A", 3, 138.0, "ok"],
    ["E-503", "SCG", "NLU03B", 3, 131.0, "ok"],
    ["E-504", "SCG", "NLU03C", 2, 124.0, "warn"],
    ["E-505", "CRP", "TKS1A", 4, 96.0, "ok"],
    ["E-506", "ITD", "TKS1B", 3, 90.0, "alert"],
    ["E-507", "ITD", "TKS2A", 5, 168.0, "ok"],
  ];
  const excavators = excSeed.map(([code, company, area, trucks, rl, status]) => ({
    id: uuid(), code, company, mining_area_id: areaId[area], truck_count: trucks,
    rl_meters: rl, status, notes: null, active: true, created_at: nowIso(), updated_at: nowIso(),
  }));
  const excId = Object.fromEntries(excavators.map((e) => [e.code, e.id]));

  // ---- entry templates ----
  // Per-excavator hourly profile, so EVERY excavator logs trips in EVERY hour of
  // its shift — selecting any date/shift/hour shows that exact slot's data.
  //   exc -> [areaCode, truckCode, baseTrips]
  // Each excavator hauls BOTH ore and waste (split ~50/50 per hour in pushShift)
  // so every "Production by excavator" bar shows both colours.
  const excProfile = {
    "E-501": ["DSW04B", "SKT90S", 6],
    "E-502": ["NLU03A", "SKT105S", 9],
    "E-503": ["NLU03B", "SKT90S", 5],
    "E-504": ["NLU03C", "CAT345", 5],
    "E-505": ["TKS1A", "SKT105S", 7],
    "E-506": ["TKS1B", "SKT90S", 4],
    "E-507": ["TKS2A", "SKT105S", 9],
  };
  // Day shift = 06:00–18:00 (hours 6–17), Night shift = 18:00–06:00 (hours 18–5;
  // hours 0–5 belong to the night shift that started the previous evening).
  const DAY_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  const NIGHT_HOURS = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5];

  const areaTargetSeed = { DSW04B: 7000, NLU03A: 9000, NLU03B: 6000, NLU03C: 5000, TKS1A: 8000, TKS1B: 4000, TKS2A: 9000 };
  // Plan rows are keyed by pattern code = the area code shown in the PLAN SOURCE
  // table. [areaCode, soil(ดิน), ore(แร่)].
  const planSeed = [
    ["DSW04B", 4200, 3100],
    ["NLU03A", 3000, 5200],
    ["NLU03B", 2600, 4100],
    ["NLU03C", 2200, 3300],
    ["TKS1A", 3500, 4800],
    ["TKS1B", 1800, 2600],
    ["TKS2A", 4000, 5500],
  ];

  const shifts = [];
  const production_entries = [];
  const production_plans = [];
  const area_targets = [];

  const now = Date.now();
  // Real wall-clock start of a slot — night hours 0–5 fall on the morning after
  // the shift date. Used to avoid seeding data for slots still in the future.
  const slotStart = (dateIso, shiftType, hour) => {
    const base = new Date(`${dateIso}T00:00:00`);
    if (shiftType === "Night" && hour <= 5) base.setDate(base.getDate() + 1);
    base.setHours(hour, 0, 0, 0);
    return base.getTime();
  };

  // Trips for one excavator at one hour: base scaled by a stable per-slot factor
  // (0.55x–1.35x) so every hour differs and the day/night curves look real.
  const tripsFor = (base, dateIso, shiftType, exc, hour) => {
    const factor = 0.55 + 0.8 * seededUnit(`${dateIso}|${shiftType}|${exc}|${hour}`);
    return Math.max(1, Math.round(base * factor));
  };

  for (let offset = 0; offset < DEMO_DAYS; offset += 1) {
    const dateIso = daysAgoIso(offset);
    const dayShift = { id: uuid(), shift_date: dateIso, shift_type: "Day", created_at: nowIso() };
    const nightShift = { id: uuid(), shift_date: dateIso, shift_type: "Night", created_at: nowIso() };
    shifts.push(nightShift, dayShift);

    const pushShift = (shift, hoursList) => {
      hoursList.forEach((hour) => {
        if (slotStart(dateIso, shift.shift_type, hour) > now) return; // skip future slots
        Object.entries(excProfile).forEach(([exc, [area, truck, base]]) => {
          const trips = tripsFor(base, dateIso, shift.shift_type, exc, hour);
          // Split each excavator's hourly trips roughly half ore / half waste.
          const oreTrips = Math.round(trips / 2);
          const wasteTrips = trips - oreTrips;
          const mix = [
            ["AOLL", "OREPAD", oreTrips],     // ore
            ["WNAF", "ROCKPILE", wasteTrips], // waste
          ];
          mix.forEach(([mat, dump, t]) => {
            if (t <= 0) return;
            production_entries.push({
              id: uuid(), shift_id: shift.id, log_hour: hour, excavator_id: excId[exc],
              mining_area_id: areaId[area], material_id: materialId[mat], dumping_area_id: dumpId[dump],
              truck_model_id: truckId[truck], trips: t, tonnes: t * factorForSeed(truck, dateIso),
              remark: null, created_by: null, created_at: nowIso(), updated_at: nowIso(),
            });
          });
        });
      });
    };
    pushShift(dayShift, DAY_HOURS);
    pushShift(nightShift, NIGHT_HOURS);

    // Plans (soil/ore per pattern) on BOTH shifts, so the PLAN SOURCE table is
    // populated whether the user is on Day or Night, for any date.
    [dayShift, nightShift].forEach((shift) => {
      planSeed.forEach(([code, soil, ore]) => {
        production_plans.push({ id: uuid(), shift_id: shift.id, pattern_code: code, soil_tonnes: soil, ore_tonnes: ore, created_at: nowIso(), updated_at: nowIso() });
      });
    });
    // Per-area targets on each day's Day shift, so Target figures show per date.
    Object.entries(areaTargetSeed).forEach(([area, t]) => {
      area_targets.push({ id: uuid(), shift_id: dayShift.id, mining_area_id: areaId[area], target_tonnes: t });
    });
  }

  return {
    users,
    mining_areas,
    materials,
    dumping_areas,
    truck_models,
    truck_model_factors,
    excavators,
    shifts,
    shift_kpi_targets: [],
    area_targets,
    production_plans,
    production_entries,
  };
}
