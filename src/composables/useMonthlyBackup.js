import { ref } from "vue";
import { supabase } from "../lib/supabaseClient.js";
import { downloadXlsx } from "../lib/xlsx.js";
import { buildMonthlyBackupSheets } from "../lib/monthlyBackupWorkbook.js";

const PAGE_SIZE = 1000;
const SHIFT_CHUNK_SIZE = 60;
const MAX_TABLE_ROWS = 500_000;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const EMPTY_SHIFT_ID = "00000000-0000-0000-0000-000000000000";

// Full snapshots of reference data are bundled with every monthly backup so
// foreign-key ids in the month's operational rows still have useful context.
const MASTER_TABLES = [
  { name: "app_areas", optional: true },
  { name: "mining_areas" },
  { name: "materials" },
  { name: "dumping_areas" },
  { name: "truck_models" },
  { name: "truck_model_factors" },
  { name: "excavators" },
  { name: "material_routes", optional: true },
  { name: "area_excavators", optional: true },
  { name: "placement_shift_excavator", optional: true },
];

// These rows belong to the selected month through their shift_id.
const MONTHLY_TABLES = [
  { name: "area_targets" },
  { name: "shift_kpi_targets" },
  { name: "production_plans" },
  { name: "plan_priorities", optional: true },
  { name: "production_entries" },
  { name: "rainfall_logs", optional: true },
  { name: "placement_trucks", optional: true },
  { name: "placement_editors", optional: true },
  { name: "placement_rl", optional: true },
  { name: "placement_notes", optional: true },
  { name: "placement_removed", optional: true },
  { name: "entry_dig_blocks", optional: true },
];

const scanning = ref(false);
const downloading = ref(false);
const error = ref("");
const snapshot = ref(null);
const inventory = ref([]);
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

// Page until an empty response rather than stopping on a short page. Supabase
// projects can set a response cap below PAGE_SIZE, and stopping early would make
// a backup look successful while silently omitting rows.
const fetchPaged = async (makeQuery, { optional = false } = {}) => {
  const rows = [];
  for (;;) {
    const { data, error: queryError } = await makeQuery(rows.length, PAGE_SIZE);
    if (queryError && optional && isMissingTableError(queryError)) {
      return { rows: [], available: false };
    }
    if (queryError) throw new Error(queryError.message);
    const page = data || [];
    if (page.length === 0) return { rows, available: true };
    rows.push(...page);
    if (rows.length > MAX_TABLE_ROWS) {
      throw new Error(`${MAX_TABLE_ROWS.toLocaleString("en-US")} row limit exceeded in one table`);
    }
  }
};

const fetchMasterTable = ({ name, optional = false }) =>
  fetchPaged(
    (offset, limit) =>
      supabase
        .from(name)
        .select("*")
        .order("id", { ascending: true })
        .range(offset, offset + limit - 1),
    { optional },
  );

const fetchMonthlyTable = async ({ name, optional = false }, shiftIds) => {
  const rows = [];
  // No shifts means there cannot be monthly rows, but still make an empty query
  // so the manifest can accurately report whether an optional table is installed.
  if (shiftIds.length === 0) {
    return fetchPaged(
      (offset, limit) =>
        supabase
          .from(name)
          .select("*")
          .eq("shift_id", EMPTY_SHIFT_ID)
          .order("id", { ascending: true })
          .range(offset, offset + limit - 1),
      { optional },
    );
  }

  for (let index = 0; index < shiftIds.length; index += SHIFT_CHUNK_SIZE) {
    const chunk = shiftIds.slice(index, index + SHIFT_CHUNK_SIZE);
    const result = await fetchPaged(
      (offset, limit) =>
        supabase
          .from(name)
          .select("*")
          .in("shift_id", chunk)
          .order("id", { ascending: true })
          .range(offset, offset + limit - 1),
      { optional },
    );
    if (!result.available) return result;
    rows.push(...result.rows);
    if (rows.length > MAX_TABLE_ROWS) {
      throw new Error(`${MAX_TABLE_ROWS.toLocaleString("en-US")} row limit exceeded in ${name}`);
    }
  }
  return { rows, available: true };
};

const readMonth = async (month) => {
  const { from, to, until } = monthRange(month);
  const shiftResult = await fetchPaged((offset, limit) =>
    supabase
      .from("shifts")
      .select("*")
      .gte("shift_date", from)
      .lt("shift_date", until)
      .order("shift_date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1),
  );
  const shiftIds = shiftResult.rows.map((row) => row.id);

  const [masterResults, monthlyResults] = await Promise.all([
    Promise.all(MASTER_TABLES.map((spec) => fetchMasterTable(spec))),
    Promise.all(MONTHLY_TABLES.map((spec) => fetchMonthlyTable(spec, shiftIds))),
  ]);

  const tables = { shifts: shiftResult.rows };
  const tableInventory = [
    { name: "shifts", scope: "Selected month", rows: shiftResult.rows.length, available: true },
  ];
  const unavailableTables = [];

  MASTER_TABLES.forEach((spec, index) => {
    const result = masterResults[index];
    tables[spec.name] = result.rows;
    tableInventory.push({
      name: spec.name,
      scope: "Master snapshot",
      rows: result.rows.length,
      available: result.available,
    });
    if (!result.available) unavailableTables.push(spec.name);
  });
  MONTHLY_TABLES.forEach((spec, index) => {
    const result = monthlyResults[index];
    tables[spec.name] = result.rows;
    tableInventory.push({
      name: spec.name,
      scope: "Selected month",
      rows: result.rows.length,
      available: result.available,
    });
    if (!result.available) unavailableTables.push(spec.name);
  });

  const totalRows = tableInventory.reduce((sum, table) => sum + table.rows, 0);
  const generatedAt = new Date().toISOString();
  return {
    backup: {
      format: "thaidrill-monthly-backup-xlsx",
      version: 2,
      generated_at: generatedAt,
      month,
      date_range: { from, to },
      source: "Production Daily Dashboard",
      scope: {
        monthly_tables: ["shifts", ...MONTHLY_TABLES.map((table) => table.name)],
        full_master_snapshots: MASTER_TABLES.map((table) => table.name),
        unavailable_tables: unavailableTables,
        excluded_tables: ["users"],
        security_note: "User accounts and passwords are intentionally excluded.",
      },
      summary: {
        total_rows: totalRows,
        included_tables: tableInventory.length - unavailableTables.length,
        unavailable_tables: unavailableTables.length,
        shifts: shiftResult.rows.length,
        production_entries: tables.production_entries.length,
        rainfall_logs: tables.rainfall_logs.length,
      },
      tables,
    },
    inventory: tableInventory,
  };
};

const triggerExcelDownload = (month, backup, tableInventory) => {
  const filename = `thaidrill-monthly-backup-${month}.xlsx`;
  downloadXlsx(filename, buildMonthlyBackupSheets(backup, tableInventory));
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
      inventory.value = [];
      scannedMonth.value = "";
      return false;
    }

    scanning.value = true;
    error.value = "";
    lastDownload.value = "";
    snapshot.value = null;
    inventory.value = [];
    scannedMonth.value = "";
    try {
      const result = await readMonth(month);
      if (token !== scanToken) return false;
      snapshot.value = result.backup;
      inventory.value = result.inventory;
      scannedMonth.value = month;
      return true;
    } catch (scanError) {
      if (token !== scanToken) return false;
      console.error("Monthly backup scan failed", scanError);
      error.value = scanError?.message
        ? `Could not prepare the monthly backup: ${scanError.message}`
        : "Could not prepare the monthly backup.";
      snapshot.value = null;
      inventory.value = [];
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
      lastDownload.value = triggerExcelDownload(month, snapshot.value, inventory.value);
    } catch (downloadError) {
      console.error("Monthly backup download failed", downloadError);
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
    inventory,
    scannedMonth,
    lastDownload,
    scan,
    download,
  };
}
