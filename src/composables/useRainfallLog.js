import { computed, ref, watch } from "vue";
import { supabase } from "../lib/supabaseClient.js";
import { createDateLoader } from "../lib/dateLoader.js";
import { dropDate, dropDates, keepDates } from "../lib/dropDate.js";
import { PRELOAD_DAYS } from "../lib/recentDates.js";
import { shiftIndexForDates } from "./useShiftIds.js";
import { useShiftSelection } from "./useShiftSelection.js";
import { useEntryStore } from "./useEntryStore.js";
import { useAppAreas } from "./useAppAreas.js";

// Persistence + reads for the "Rainfall" step (step 3) on the Data entry page.
// One row = one rain spell in one area, mirroring the Rainfall sheet:
//   Area · Intensity · Start/End · Period · Rain duration · Red alert ·
//   Start/End · Red alert duration · Affect Opt · Remark
// Period and both durations are DERIVED here (and in vw_rainfall_logs), never
// stored — a stored copy would drift the moment someone edits a time.
//
// Unlike Plan Production (one plan per DATE), the rain log belongs to a SHIFT:
// each crew logs the weather it worked through, so rows are keyed by shift_id and
// the page shows the selected date + shift. Both shifts of the date are fetched in
// one query so switching shift is instant.
//
// Module-level singleton state, mirroring usePlanProduction's convention.

const { selection } = useShiftSelection();
const { ensureShift } = useEntryStore();

export const RAIN_INTENSITIES = ["Clear", "Light", "Moderate", "Heavy"];

// Rain is logged per PIT, not per pattern/block: the weather covers the whole pit,
// so the Area cell offers the App Area master (Settings → App Area) rather than the
// NLU03A-style pattern codes that Steps 1 and 2 work in.
const { areas: appAreas } = useAppAreas();

const logKey = (date, shiftType) => `${date}_${shiftType}`;

// { [date_shiftType]: [row, ...] } — rows in insertion order (created_at).
const logsByKey = ref({});
const loading = ref(false);
const saveState = ref("idle"); // idle | saving | saved | error
const saveMessage = ref("");

// rainfall_logs is a later migration (supabase/rainfall_logs.sql). Until it's run,
// stop querying / writing so we don't spam errors: the step still works as an
// in-memory scratchpad for the session and says so in the footer.
let tableMissing = false;
const isMissingTableError = (error) =>
  !!error &&
  (error.code === "42P01" ||
    error.code === "PGRST205" ||
    /could not find the table|does not exist/i.test(error.message || ""));

const MIGRATION_HINT = "Not saved — run supabase/rainfall_logs.sql to create the rainfall_logs table.";

// --- time helpers -----------------------------------------------------------
// Times are 'HH:MM' strings, exactly what <input type="time"> gives us. Anything
// unparseable becomes "" so the derived cells stay blank instead of showing NaN.
export const toHhmm = (value) => {
  const match = /^(\d{1,2}):([0-5]\d)/.exec(String(value ?? "").trim());
  if (!match) return "";
  const hours = Number(match[1]);
  if (hours > 23) return "";
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
};

const minutesOf = (value) => {
  const hhmm = toHhmm(value);
  if (!hhmm) return null;
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
};

// Minutes between two 'HH:MM' times. A spell that ends "earlier" than it started
// crossed midnight (night shift, e.g. 23:00 → 01:00), so wrap by 24h rather than
// reporting a negative duration.
export const durationMinutes = (from, to) => {
  const a = minutesOf(from);
  const b = minutesOf(to);
  if (a == null || b == null) return 0;
  return (b - a + 1440) % 1440;
};

export const periodLabel = (row) => (toHhmm(row?.startTime) && toHhmm(row?.endTime) ? `${toHhmm(row.startTime)}-${toHhmm(row.endTime)}` : "");
// A "Clear" row records a period with NO rain in it — the sheet writes 0 there even
// though the period still spans an hour. Every other intensity counts the whole
// window.
export const rainMinutes = (row) => (row?.intensity === "Clear" ? 0 : durationMinutes(row?.startTime, row?.endTime));
// The alert window is recorded only when Red Alert is YES. The physical database
// columns retain their legacy affect_start / affect_end names so existing projects
// can adopt this workflow without a destructive migration.
export const redAlertMinutes = (row) => (row?.redAlert ? durationMinutes(row?.redAlertStart, row?.redAlertEnd) : 0);

// --- row <-> database mapping ----------------------------------------------
const toRow = (record) => ({
  id: record.id,
  areaCode: record.area_code || "",
  intensity: RAIN_INTENSITIES.includes(record.intensity) ? record.intensity : "Clear",
  startTime: toHhmm(record.start_time),
  endTime: toHhmm(record.end_time),
  affectOpt: !!record.affect_opt,
  redAlertStart: toHhmm(record.affect_start),
  redAlertEnd: toHhmm(record.affect_end),
  redAlert: !!record.red_alert,
  remark: record.remark || "",
  createdAt: record.created_at || "",
});

// Empty times are stored as NULL (the column's format check rejects ""), and the
// area/remark keep their text as typed.
const DB_COLUMN = {
  areaCode: "area_code",
  intensity: "intensity",
  startTime: "start_time",
  endTime: "end_time",
  affectOpt: "affect_opt",
  redAlertStart: "affect_start",
  redAlertEnd: "affect_end",
  redAlert: "red_alert",
  remark: "remark",
};
const TIME_FIELDS = new Set(["startTime", "endTime", "redAlertStart", "redAlertEnd"]);

const toDbPatch = (patch) => {
  const out = {};
  Object.entries(patch).forEach(([field, value]) => {
    const column = DB_COLUMN[field];
    if (!column) return;
    if (TIME_FIELDS.has(field)) out[column] = toHhmm(value) || null;
    else if (field === "affectOpt" || field === "redAlert") out[column] = !!value;
    else out[column] = String(value ?? "");
  });
  return out;
};

const blankRow = (init = {}) => ({
  id: "",
  areaCode: init.areaCode || appAreas.value[0] || "",
  intensity: init.intensity && RAIN_INTENSITIES.includes(init.intensity) ? init.intensity : "Clear",
  startTime: toHhmm(init.startTime),
  endTime: toHhmm(init.endTime),
  affectOpt: false,
  redAlertStart: "",
  redAlertEnd: "",
  redAlert: false,
  remark: "",
  createdAt: new Date().toISOString(),
});

const localId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `rain-${Math.random().toString(36).slice(2)}-${Date.now()}`);

// --- load -------------------------------------------------------------------
// One query for the whole span asked for (the shifts lookup is shared with the other
// date-scoped stores), and none at all for a date already loaded — see the loader
// below. `skipLoaded` keeps the opening batch from writing over a date on screen.
const fetchDatesLogs = async (dateList, { skipLoaded = false } = {}) => {
  const dates = [...new Set(dateList)].filter(Boolean).sort();
  if (!dates.length) return;
  loading.value = true;

  const { ids: shiftIds, typeById: shiftTypeById, dateById: shiftDateById } = await shiftIndexForDates(dates);

  const next = {};
  dates.forEach((date) => {
    next[logKey(date, "Day")] = [];
    next[logKey(date, "Night")] = [];
  });

  if (shiftIds.length && !tableMissing) {
    const { data, error } = await supabase
      .from("rainfall_logs")
      .select("id, shift_id, area_code, intensity, start_time, end_time, affect_opt, affect_start, affect_end, red_alert, remark, created_at")
      .in("shift_id", shiftIds)
      .order("created_at", { ascending: true });

    if (isMissingTableError(error)) {
      tableMissing = true;
    } else if (!error && data) {
      data.forEach((record) => {
        const shiftType = shiftTypeById[record.shift_id];
        const recordDate = shiftDateById[record.shift_id];
        if (!shiftType || !recordDate) return;
        next[logKey(recordDate, shiftType)].push(toRow(record));
      });
    }
  }

  const commit = dates.filter((d) => !(skipLoaded && logsLoader.isLoaded(d)));
  if ((!skipLoaded && !logsLoader.isCurrent(dates[0])) || !commit.length) {
    loading.value = false;
    return;
  }

  logsByKey.value = { ...dropDates(logsByKey.value, commit), ...keepDates(next, commit) };
  if (skipLoaded) commit.forEach((d) => logsLoader.markLoaded(d));
  loading.value = false;
};

const fetchLogs = (date) => fetchDatesLogs([date]);

const logsLoader = createDateLoader({
  load: fetchLogs,
  keep: PRELOAD_DAYS + 3,
  onEvict: (date) => {
    logsByKey.value = dropDate(logsByKey.value, date);
  },
});

watch(() => selection.date, (date) => logsLoader.request(date), { immediate: true });

const currentKey = computed(() => logKey(selection.date, selection.shiftType));
// Rows for the selected date + shift — what step 3 renders.
const rows = computed(() => logsByKey.value[currentKey.value] || []);

const setRows = (key, list) => {
  logsByKey.value = { ...logsByKey.value, [key]: list };
};

// How many rain rows exist for the whole date (both shifts) — the step-3 card
// subtitle, matching how steps 1 and 2 count the date rather than the shift.
const logCountForDate = (date) => (logsByKey.value[logKey(date, "Day")]?.length || 0) + (logsByKey.value[logKey(date, "Night")]?.length || 0);

// Operational order within a mining day: the Day shift (from 06:00) first, then the
// Night shift (from 18:00, wrapping past midnight) — so 01:00 sorts after 23:00
// instead of jumping to the top. Rows with no start time go last.
const SHIFT_START_HOUR = { Day: 6, Night: 18 };
const dayRank = (row) => {
  const hhmm = toHhmm(row.startTime);
  if (!hhmm) return Number.MAX_SAFE_INTEGER;
  const minutes = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const shiftOffset = row.shiftType === "Night" ? 1440 : 0;
  return shiftOffset + ((minutes - SHIFT_START_HOUR[row.shiftType] * 60 + 1440) % 1440);
};

// Every rain row of one DATE (both shifts), each tagged with its shiftType and
// sorted in operational order — what the Rainfall dashboard reports on.
const rowsForDate = (date) => {
  const out = [];
  ["Day", "Night"].forEach((shiftType) => {
    (logsByKey.value[logKey(date, shiftType)] || []).forEach((row) => out.push({ ...row, shiftType }));
  });
  return out.sort((a, b) => dayRank(a) - dayRank(b));
};

// Date totals used by the panel header. Scoped to the selected shift, like the rows.
const totals = computed(() =>
  rows.value.reduce(
    (acc, row) => ({
      rain: acc.rain + rainMinutes(row),
      alertDuration: acc.alertDuration + redAlertMinutes(row),
      alerts: acc.alerts + (row.redAlert ? 1 : 0),
    }),
    { rain: 0, alertDuration: 0, alerts: 0 },
  ),
);

// --- writes -----------------------------------------------------------------
const markSaved = () => {
  saveState.value = "saved";
  saveMessage.value = "Saved to database.";
};
const markMissing = () => {
  tableMissing = true;
  saveState.value = "error";
  saveMessage.value = MIGRATION_HINT;
};
const markError = () => {
  saveState.value = "error";
  saveMessage.value = "Cannot save — check the connection and that the selected date/shift is valid.";
};

// Append a row to the selected date + shift. Inserts first so the row carries its
// real database id; when the table hasn't been migrated yet it falls back to a
// local-only row so the step is still usable (lost on reload).
const addRow = async (init = {}) => {
  const key = currentKey.value;
  const row = blankRow(init);

  if (tableMissing) {
    row.id = localId();
    setRows(key, [...(logsByKey.value[key] || []), row]);
    saveState.value = "error";
    saveMessage.value = MIGRATION_HINT;
    return row;
  }

  saveState.value = "saving";
  saveMessage.value = "Saving to database…";
  const shiftId = await ensureShift(selection.date, selection.shiftType);
  if (!shiftId) {
    markError();
    return null;
  }

  const { data, error } = await supabase
    .from("rainfall_logs")
    .insert({ shift_id: shiftId, ...toDbPatch(row) })
    .select("id, area_code, intensity, start_time, end_time, affect_opt, affect_start, affect_end, red_alert, remark, created_at")
    .single();

  if (isMissingTableError(error)) {
    row.id = localId();
    setRows(key, [...(logsByKey.value[key] || []), row]);
    markMissing();
    return row;
  }
  if (error || !data) {
    markError();
    return null;
  }

  const saved = toRow(data);
  setRows(key, [...(logsByKey.value[key] || []), saved]);
  markSaved();
  return saved;
};

// Patch one row (optimistic: the cell shows the new value immediately, then the
// write settles). `patch` uses the camelCase row fields.
const updateRow = async (id, patch) => {
  const key = currentKey.value;
  const list = logsByKey.value[key] || [];
  const index = list.findIndex((row) => row.id === id);
  if (index === -1) return false;

  const nextRow = { ...list[index], ...patch };
  TIME_FIELDS.forEach((field) => {
    if (field in patch) nextRow[field] = toHhmm(patch[field]);
  });
  setRows(key, list.map((row, i) => (i === index ? nextRow : row)));

  if (tableMissing) {
    saveState.value = "error";
    saveMessage.value = MIGRATION_HINT;
    return true;
  }

  saveState.value = "saving";
  saveMessage.value = "Saving to database…";
  const { error } = await supabase
    .from("rainfall_logs")
    .update({ ...toDbPatch(patch), updated_at: new Date().toISOString() })
    .eq("id", id);

  if (isMissingTableError(error)) {
    markMissing();
    return true;
  }
  if (error) {
    markError();
    return false;
  }
  markSaved();
  return true;
};

const removeRow = async (id) => {
  const key = currentKey.value;
  const list = logsByKey.value[key] || [];
  setRows(key, list.filter((row) => row.id !== id));

  if (tableMissing) return true;
  const { error } = await supabase.from("rainfall_logs").delete().eq("id", id);
  if (isMissingTableError(error)) {
    markMissing();
    return true;
  }
  if (error) {
    markError();
    return false;
  }
  saveState.value = "saved";
  saveMessage.value = "Row deleted.";
  return true;
};

export const useRainfallLog = () => ({
  rows,
  totals,
  loading,
  saveState,
  saveMessage,
  logCountForDate,
  rowsForDate,
  addRow,
  updateRow,
  removeRow,
  reload: () => logsLoader.request(selection.date, { force: true }),
  preloadDates: (dates) => fetchDatesLogs(dates, { skipLoaded: true }),
});
