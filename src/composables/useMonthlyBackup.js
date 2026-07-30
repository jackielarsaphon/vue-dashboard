import { ref } from "vue";
import { supabase } from "../lib/supabaseClient.js";
import { downloadXlsx } from "../lib/xlsx.js";
import { buildMonthlyRainfallSheets } from "../lib/monthlyRainfallWorkbook.js";

const PAGE_SIZE = 1000;
const SHIFT_CHUNK_SIZE = 60;
const MAX_ROWS = 500_000;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const EMPTY_SHIFT_ID = "00000000-0000-0000-0000-000000000000";

const scanning = ref(false);
const downloading = ref(false);
const error = ref("");
const snapshot = ref(null);
const days = ref([]);
const scannedMonth = ref("");
const lastDownload = ref("");
let scanToken = 0;

const isMissingTableError = (queryError) =>
  !!queryError &&
  (queryError.code === "42P01" ||
    queryError.code === "PGRST205" ||
    /could not find the table|does not exist/i.test(queryError.message || ""));

const validateMonth = (month) => (MONTH_PATTERN.test(month || "") ? "" : "Pick a valid backup month.");

export const monthRange = (month) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const from = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const until = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  const finalDay = new Date(Date.UTC(nextYear, nextMonth - 1, 0)).getUTCDate();
  const to = `${year}-${String(monthNumber).padStart(2, "0")}-${String(finalDay).padStart(2, "0")}`;
  return { from, to, until };
};

const fetchPaged = async (makeQuery) => {
  const rows = [];
  for (;;) {
    const { data, error: queryError } = await makeQuery(rows.length, PAGE_SIZE);
    if (queryError) {
      if (isMissingTableError(queryError)) throw new Error("Rainfall table is not installed.");
      throw new Error(queryError.message);
    }
    const page = data || [];
    if (page.length === 0) return rows;
    rows.push(...page);
    if (rows.length > MAX_ROWS) {
      throw new Error(`${MAX_ROWS.toLocaleString("en-US")} rainfall row limit exceeded`);
    }
  }
};

const toHhmm = (value) => {
  const match = /^(\d{1,2}):([0-5]\d)/.exec(String(value ?? "").trim());
  if (!match || Number(match[1]) > 23) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
};

const minutesOf = (value) => {
  const hhmm = toHhmm(value);
  return hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : null;
};

const durationMinutes = (from, to) => {
  const start = minutesOf(from);
  const end = minutesOf(to);
  if (start == null || end == null) return 0;
  return (end - start + 1440) % 1440;
};

const operationalRank = (record) => {
  const start = minutesOf(record.start);
  const shiftStart = record.shift === "Night" ? 18 * 60 : 6 * 60;
  const shiftOffset = record.shift === "Night" ? 1440 : 0;
  return shiftOffset + (start == null ? 1439 : (start - shiftStart + 1440) % 1440);
};

const toExportRecord = (row, shift) => {
  const start = toHhmm(row.start_time);
  const end = toHhmm(row.end_time);
  const redAlertStart = toHhmm(row.affect_start);
  const redAlertEnd = toHhmm(row.affect_end);
  const redAlert = !!row.red_alert;
  return {
    area: row.area_code || "",
    intensity: row.intensity || "Clear",
    start,
    end,
    period: start && end ? `${start}-${end}` : "",
    rainMin: row.intensity === "Clear" ? 0 : durationMinutes(start, end),
    redAlert,
    redAlertStart,
    redAlertEnd,
    redAlertMin: redAlert ? durationMinutes(redAlertStart, redAlertEnd) : 0,
    affect: !!row.affect_opt,
    remark: row.remark || "",
    shift: shift.shift_type || "",
  };
};

const readMonth = async (month) => {
  const { from, to, until } = monthRange(month);
  const shiftRows = await fetchPaged((offset, limit) =>
    supabase
      .from("shifts")
      .select("id, shift_date, shift_type")
      .gte("shift_date", from)
      .lt("shift_date", until)
      .order("shift_date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1),
  );
  const shiftById = Object.fromEntries(shiftRows.map((row) => [row.id, row]));
  const shiftIds = shiftRows.map((row) => row.id);
  const rainfallRows = [];

  if (shiftIds.length === 0) {
    // Empty query still checks that the rainfall table exists.
    await fetchPaged((offset, limit) =>
      supabase
        .from("rainfall_logs")
        .select("id")
        .eq("shift_id", EMPTY_SHIFT_ID)
        .order("id", { ascending: true })
        .range(offset, offset + limit - 1),
    );
  } else {
    for (let index = 0; index < shiftIds.length; index += SHIFT_CHUNK_SIZE) {
      const chunk = shiftIds.slice(index, index + SHIFT_CHUNK_SIZE);
      const chunkRows = await fetchPaged((offset, limit) =>
        supabase
          .from("rainfall_logs")
          .select("id, shift_id, area_code, intensity, start_time, end_time, affect_opt, affect_start, affect_end, red_alert, remark, created_at")
          .in("shift_id", chunk)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + limit - 1),
      );
      rainfallRows.push(...chunkRows);
      if (rainfallRows.length > MAX_ROWS) {
        throw new Error(`${MAX_ROWS.toLocaleString("en-US")} rainfall row limit exceeded`);
      }
    }
  }

  const byDate = new Map();
  rainfallRows.forEach((row) => {
    const shift = shiftById[row.shift_id];
    if (!shift) return;
    const record = toExportRecord(row, shift);
    let date = byDate.get(shift.shift_date);
    if (!date) {
      date = { date: shift.shift_date, records: [] };
      byDate.set(shift.shift_date, date);
    }
    date.records.push(record);
  });

  const rainfallDays = [...byDate.values()]
    .map((day) => {
      day.records.sort(
        (a, b) => operationalRank(a) - operationalRank(b) || String(a.area).localeCompare(String(b.area)),
      );
      const areas = [...new Set(day.records.map((record) => record.area).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      );
      return {
        ...day,
        areas,
        record_count: day.records.length,
        rain_duration: day.records.reduce((sum, record) => sum + record.rainMin, 0),
        red_alerts: day.records.reduce((sum, record) => sum + (record.redAlert ? 1 : 0), 0),
        red_alert_duration: day.records.reduce((sum, record) => sum + record.redAlertMin, 0),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const allAreas = new Set(rainfallDays.flatMap((day) => day.areas));
  const summary = rainfallDays.reduce(
    (total, day) => ({
      records: total.records + day.record_count,
      days: total.days + 1,
      rain_duration: total.rain_duration + day.rain_duration,
      red_alerts: total.red_alerts + day.red_alerts,
      red_alert_duration: total.red_alert_duration + day.red_alert_duration,
      areas: allAreas.size,
    }),
    { records: 0, days: 0, rain_duration: 0, red_alerts: 0, red_alert_duration: 0, areas: 0 },
  );

  return {
    format: "thaidrill-monthly-rainfall-backup-xlsx",
    version: 1,
    generated_at: new Date().toISOString(),
    month,
    date_range: { from, to },
    summary,
    days: rainfallDays,
  };
};

const triggerExcelDownload = (month, backup) => {
  const filename = `rainfall-monthly-backup-${month}.xlsx`;
  downloadXlsx(filename, buildMonthlyRainfallSheets(backup));
  return filename;
};

export function useMonthlyBackup() {
  const scan = async (month) => {
    const token = (scanToken += 1);
    const invalid = validateMonth(month);
    if (invalid) {
      scanning.value = false;
      error.value = invalid;
      snapshot.value = null;
      days.value = [];
      scannedMonth.value = "";
      return false;
    }

    scanning.value = true;
    error.value = "";
    lastDownload.value = "";
    snapshot.value = null;
    days.value = [];
    scannedMonth.value = "";
    try {
      const result = await readMonth(month);
      if (token !== scanToken) return false;
      snapshot.value = result;
      days.value = result.days;
      scannedMonth.value = month;
      return true;
    } catch (scanError) {
      if (token !== scanToken) return false;
      console.error("Monthly rainfall backup scan failed", scanError);
      error.value = scanError?.message
        ? `Could not prepare the rainfall backup: ${scanError.message}`
        : "Could not prepare the rainfall backup.";
      snapshot.value = null;
      days.value = [];
      scannedMonth.value = "";
      return false;
    } finally {
      if (token === scanToken) scanning.value = false;
    }
  };

  const download = async (month) => {
    if (downloading.value || scanning.value) return;
    const invalid = validateMonth(month);
    if (invalid) {
      error.value = invalid;
      return;
    }

    downloading.value = true;
    error.value = "";
    lastDownload.value = "";
    try {
      if (scannedMonth.value !== month && !(await scan(month))) return;
      if (!snapshot.value) return;
      lastDownload.value = triggerExcelDownload(month, snapshot.value);
    } catch (downloadError) {
      console.error("Monthly rainfall backup download failed", downloadError);
      error.value = downloadError?.message
        ? `Download failed: ${downloadError.message}`
        : "Download failed.";
    } finally {
      downloading.value = false;
    }
  };

  return {
    scanning,
    downloading,
    error,
    snapshot,
    days,
    scannedMonth,
    lastDownload,
    scan,
    download,
  };
}
