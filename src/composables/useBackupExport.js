import { ref } from "vue";
import { supabase } from "../lib/supabaseClient.js";
import { useEntryStore, isWaste } from "./useEntryStore.js";
import { useMaterialRoutes } from "./useMaterialRoutes.js";
import { useExcavatorsStore } from "../stores/excavatorsStore";
import { useMiningAreasStore } from "../stores/miningAreasStore";
import { useMaterialsStore } from "../stores/materialsStore";
import { useDumpingAreasStore } from "../stores/dumpingAreasStore";
import { useTruckModelsStore } from "../stores/truckModelsStore";
import { downloadXlsx } from "../lib/xlsx.js";
import { buildDailySummarySheet, buildTripSheet, materialTypeFor, modelColumns } from "../lib/tripReportSheet.js";

// Backup data (Settings ▸ Backup data): exports a DATE RANGE of Data-entry trips as
// one .xlsx with ONE SHEET PER DAY — each day's sheet is exactly the sheet Data entry's
// own "Export Excel" produces for that date (lib/tripReportSheet.js), plus a leading
// "Summary" tab indexing the days.
//
// Unlike the page exports, this cannot read useEntryStore's cache: that cache only ever
// holds the ONE selected date. So it queries Supabase for the whole range itself —
// paged, because PostgREST caps a response at 1000 rows by default and a month of trips
// is well past that. Nothing is written; this is a read-only export.

const PAGE = 1000; // rows requested per page (Supabase's default response cap)
const SHIFT_CHUNK = 60; // shift ids per ?in=(…) filter (≈ 30 days × 2 shifts) — keeps the URL short
const MAX_ROWS = 500_000; // runaway guard — fail loudly instead of looping forever

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Module-level singleton state (matches the other composables here), so a scan
// survives switching Settings tabs and the export can reuse it without refetching.
const scanning = ref(false);
const exporting = ref(false);
const error = ref("");
// One entry per day that actually has trips, ascending by date:
// { date, shifts: [], entries, day, night, waste, ore, per: { [model]: trips }, total, records }
const days = ref([]);
const scannedKey = ref("");
// Ticket for the newest scan. Picking a second range while the first read is still
// in flight must not let the slower answer land — it would show one range's numbers
// under another range's dates.
let scanToken = 0;

const rangeKey = (from, to) => `${from}|${to}`;
const codeById = (items) => Object.fromEntries(items.map((row) => [row.id, row.code]));

// Page through a query so a long range is never silently truncated by the API's
// row cap. `makeQuery(offset, limit)` must return a PostgREST query with a stable
// order. Advances by the rows actually returned and only stops on an EMPTY page:
// a project whose max-rows is set BELOW PAGE would otherwise look "done" on its
// first (short) page and quietly drop the rest of the range.
const fetchPaged = async (makeQuery) => {
  const out = [];
  for (;;) {
    // Next page starts where the rows collected so far end.
    const { data, error: queryError } = await makeQuery(out.length, PAGE);
    if (queryError) throw new Error(queryError.message);
    const rows = data || [];
    if (rows.length === 0) return out;
    out.push(...rows);
    if (out.length > MAX_ROWS) throw new Error(`too many rows (> ${MAX_ROWS.toLocaleString("en-US")}) — narrow the date range`);
  }
};

export function useBackupExport() {
  const { truckModels } = useEntryStore();
  const { routes: materialRoutes, reload: reloadRoutes } = useMaterialRoutes();
  const excavatorsStore = useExcavatorsStore();
  const miningAreasStore = useMiningAreasStore();
  const materialsStore = useMaterialsStore();
  const dumpingAreasStore = useDumpingAreasStore();
  const truckModelsStore = useTruckModelsStore();

  // Reads every trip logged between `from` and `to` (inclusive) and groups it by
  // shift_date. Throws on a query error so the callers can surface one message.
  const runScan = async (from, to) => {
    await Promise.all([
      excavatorsStore.load(),
      miningAreasStore.load(),
      materialsStore.load(),
      dumpingAreasStore.load(),
      truckModelsStore.load(),
      reloadRoutes(),
    ]);

    // production_entries carries no date of its own — it hangs off shifts — so resolve
    // the range's shift rows first, then read their entries.
    const shiftRows = await fetchPaged((offset, limit) =>
      supabase
        .from("shifts")
        .select("id, shift_date, shift_type")
        .gte("shift_date", from)
        .lte("shift_date", to)
        .order("shift_date", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + limit - 1),
    );
    const shiftById = Object.fromEntries(shiftRows.map((row) => [row.id, row]));
    const shiftIds = shiftRows.map((row) => row.id);

    // Read the entries in chunks of shift ids, so each ?in=(…) URL stays short.
    const entryRows = [];
    for (let i = 0; i < shiftIds.length; i += SHIFT_CHUNK) {
      const chunk = shiftIds.slice(i, i + SHIFT_CHUNK);
      const rows = await fetchPaged((offset, limit) =>
        supabase
          .from("production_entries")
          .select("shift_id, log_hour, trips, excavator_id, mining_area_id, material_id, dumping_area_id, truck_model_id")
          .in("shift_id", chunk)
          .order("id", { ascending: true })
          .range(offset, offset + limit - 1),
      );
      entryRows.push(...rows);
    }

    const excCode = codeById(excavatorsStore.items.value);
    const areaCode = codeById(miningAreasStore.items.value);
    const materialCode = codeById(materialsStore.items.value);
    const dumpCode = codeById(dumpingAreasStore.items.value);
    const modelCode = codeById(truckModelsStore.items.value);

    const byDate = new Map();
    entryRows.forEach((row) => {
      const shift = shiftById[row.shift_id];
      if (!shift) return;
      const trips = Number(row.trips) || 0;
      if (!trips) return;
      const oreType = materialCode[row.material_id] || "";
      const model = modelCode[row.truck_model_id] || "";
      const record = {
        shiftType: shift.shift_type,
        hour: row.log_hour,
        pit: areaCode[row.mining_area_id] || "",
        dump: dumpCode[row.dumping_area_id] || "",
        from: excCode[row.excavator_id] || "",
        materialType: materialTypeFor(oreType, materialRoutes.value, isWaste),
        oreType,
        model,
        trips,
      };

      let day = byDate.get(shift.shift_date);
      if (!day) {
        day = {
          date: shift.shift_date,
          shifts: new Set(),
          entries: 0,
          day: 0,
          night: 0,
          waste: 0,
          ore: 0,
          per: {},
          total: 0,
          records: [],
        };
        byDate.set(shift.shift_date, day);
      }
      day.records.push(record);
      day.shifts.add(shift.shift_type);
      day.entries += 1;
      if (record.shiftType === "Day") day.day += trips;
      else day.night += trips;
      // Waste/Ore split uses the same is_waste rule the dashboards' KPI split uses,
      // so a blank ore type isn't silently counted as Ore.
      if (isWaste(oreType)) day.waste += trips;
      else day.ore += trips;
      day.per[model] = (day.per[model] || 0) + trips;
      day.total += trips;
    });

    return [...byDate.values()]
      .map((day) => ({ ...day, shifts: [...day.shifts].sort((a, b) => a.localeCompare(b)) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  const validate = (from, to) => {
    if (!ISO_DATE.test(from || "") || !ISO_DATE.test(to || "")) return "Pick a valid From and To date.";
    if (from > to) return "The From date must be on or before the To date.";
    return "";
  };

  // Read the range and fill `days` (the on-screen preview). Safe to call repeatedly:
  // the result is cached per range so Export doesn't re-query.
  const scan = async (from, to) => {
    const invalid = validate(from, to);
    if (invalid) {
      error.value = invalid;
      days.value = [];
      scannedKey.value = "";
      return false;
    }
    const token = (scanToken += 1);
    // Drop the previous range's rows up front, so the table never shows numbers
    // that belong to dates other than the ones in the pickers.
    days.value = [];
    scannedKey.value = "";
    scanning.value = true;
    error.value = "";
    try {
      const result = await runScan(from, to);
      if (token !== scanToken) return false; // a newer scan already took over
      days.value = result;
      scannedKey.value = rangeKey(from, to);
      return true;
    } catch (err) {
      if (token !== scanToken) return false;
      console.error("Backup scan failed", err);
      error.value = err?.message ? `Could not read the range: ${err.message}` : "Could not read the range.";
      days.value = [];
      scannedKey.value = "";
      return false;
    } finally {
      if (token === scanToken) scanning.value = false;
    }
  };

  // Download the range as one workbook: a "Summary" tab, then one tab per day.
  const exportExcel = async (from, to) => {
    if (exporting.value || scanning.value) return;
    const invalid = validate(from, to);
    if (invalid) {
      error.value = invalid;
      return;
    }
    exporting.value = true;
    error.value = "";
    try {
      // Reuse the on-screen scan when it already covers this range; otherwise read
      // it now (scan() reports its own failure, so just stop).
      if (scannedKey.value !== rangeKey(from, to) && !(await scan(from, to))) return;
      if (days.value.length === 0) {
        error.value = "No trips were logged in this range — nothing to back up.";
        return;
      }
      // One shared model column set across every tab, so the days line up.
      const allRecords = days.value.flatMap((day) => day.records);
      const models = modelColumns(allRecords, truckModels.value.map((m) => m.code));
      const sheets = [
        buildDailySummarySheet({ perDate: days.value, models, from, to }),
        ...days.value.map((day) =>
          buildTripSheet({
            records: day.records,
            models,
            name: day.date,
            title: `รายงานเที่ยวรายชั่วโมง — แยกตาม Pit / Dump Area / From (Excavator) / Material — ${day.date}`,
          }),
        ),
      ];
      downloadXlsx(`backup-data-${from}_to_${to}.xlsx`, sheets);
    } catch (err) {
      console.error("Backup export failed", err);
      error.value = err?.message ? `Export failed: ${err.message}` : "Export failed.";
    } finally {
      exporting.value = false;
    }
  };

  return { scanning, exporting, error, days, scannedKey, rangeKey, scan, exportExcel };
}
