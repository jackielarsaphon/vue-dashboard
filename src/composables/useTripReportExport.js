import { ref } from "vue";
import { useEntryStore, rowTotal } from "./useEntryStore.js";
import { useShiftSelection } from "./useShiftSelection.js";
import { useExcavatorsStore } from "../stores/excavatorsStore";
import { downloadXlsx, cellRef, STYLE } from "../lib/xlsx.js";

// Exports the selected date's Data-entry trips as a two-tab .xlsx, matching the
// two report shapes the site wants:
//
//   วิธีที่ 1 — trips summed by Pit × Dump Area, split across truck-model columns,
//               with a Grand Total column per row and a Grand Total footer.
//   วิธีที่ 2 — one row per Time (hour) × Pit × Dump Area × From (excavator),
//               trips split across the same model columns + Grand Total.
//
// Reads the shared entry cache (useEntryStore) that the pages already populate,
// so it exports exactly the trips on screen — no extra fetch.

// Operational-day hour order: Day 06→17 then Night 18→05. Used so วิธีที่ 2 rows
// list chronologically across the shift boundary instead of plain 00→23.
const DAY_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const NIGHT_HOURS = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5];

const pad = (n) => String(n).padStart(2, "0");
// "06.00-07.00" — the dotted range used in the sample sheet.
const hourRange = (hour) => `${pad(hour)}.00-${pad((hour + 1) % 24)}.00`;
const orderIndex = (shiftType, hour) =>
  shiftType === "Day" ? DAY_HOURS.indexOf(hour) : DAY_HOURS.length + NIGHT_HOURS.indexOf(hour);

// A zero data cell is left blank (but keeps its border) to match the printed look.
const numCell = (v, style) => (v > 0 ? { v, t: "n", s: style } : { v: "", s: style });

export function useTripReportExport() {
  const { getBucket, truckModels } = useEntryStore();
  const { selection } = useShiftSelection();
  const excavatorsStore = useExcavatorsStore();
  const exporting = ref(false);

  // Flatten every trip logged on the date into { shiftType, hour, pit, dump,
  // from, model, trips } records — the common source for both tabs.
  const gather = () => {
    const date = selection.date;
    const excCode = {};
    excavatorsStore.items.value.forEach((e) => {
      excCode[e.id] = e.code;
    });
    const records = [];
    ["Day", "Night"].forEach((shiftType) => {
      for (let hour = 0; hour < 24; hour += 1) {
        Object.values(getBucket(date, shiftType, hour)).forEach((entry) => {
          const pit = entry.area || "";
          const from = excCode[entry.excavatorId] || "";
          entry.rows.forEach((row) => {
            const trips = rowTotal(row);
            if (!trips) return;
            records.push({ shiftType, hour, pit, dump: row.dump || "", from, model: row.model || "", trips });
          });
        });
      }
    });
    return records;
  };

  // Model columns = the truck models that actually carry trips, ordered by the
  // master (display) order, with any unknown ones appended. Falls back to the
  // full master list when nothing was logged, so the header never collapses.
  const modelColumns = (records) => {
    const used = new Set(records.map((r) => r.model).filter(Boolean));
    const master = truckModels.value.map((m) => m.code);
    const ordered = master.filter((c) => used.has(c));
    const extras = [...used].filter((c) => !master.includes(c)).sort((a, b) => a.localeCompare(b));
    const cols = [...ordered, ...extras];
    return cols.length ? cols : master;
  };

  // Shared header: a full-width title row, then a two-row band where `stubs`
  // (the left label columns) merge vertically and a single "Trip" cell spans the
  // model columns + Grand Total, with model names + "Grand Total" beneath it.
  const buildHeader = (rows, merges, width, title, stubs) => {
    const blank = () => Array.from({ length: width }, () => null);
    const t = blank();
    t[0] = { v: title, s: STYLE.TITLE };
    rows.push(t);
    merges.push(`${cellRef(0, 0)}:${cellRef(0, width - 1)}`);

    const h1 = blank();
    const h2 = blank();
    stubs.forEach((label, c) => {
      h1[c] = { v: label, s: STYLE.HEADER };
      merges.push(`${cellRef(1, c)}:${cellRef(2, c)}`);
    });
    h1[stubs.length] = { v: "Trip", s: STYLE.HEADER };
    merges.push(`${cellRef(1, stubs.length)}:${cellRef(1, width - 1)}`);
    return { h1, h2, blank };
  };

  // วิธีที่ 1 — Pit × Dump Area, trips per model + Grand Total.
  const buildBySummary = (records, models) => {
    const stubs = ["Pit", "Dump Area"];
    const M = models.length;
    const width = stubs.length + M + 1;
    const colGrand = stubs.length + M;
    const rows = [];
    const merges = [];
    const { h1, h2, blank } = buildHeader(rows, merges, width, `วิธีที่ 1 — Sum เที่ยวแยกตาม Pit และ Dump Area (แยกตาม Type รถ) — ${selection.date}`, stubs);
    models.forEach((m, i) => {
      h2[stubs.length + i] = { v: m, s: STYLE.HEADER };
    });
    h2[colGrand] = { v: "Grand Total", s: STYLE.HEADER };
    rows.push(h1, h2);

    const agg = new Map();
    records.forEach((r) => {
      const key = `${r.pit}|||${r.dump}`;
      let a = agg.get(key);
      if (!a) {
        a = { pit: r.pit, dump: r.dump, per: {}, total: 0 };
        agg.set(key, a);
      }
      a.per[r.model] = (a.per[r.model] || 0) + r.trips;
      a.total += r.trips;
    });
    const list = [...agg.values()].sort((a, b) => a.pit.localeCompare(b.pit) || a.dump.localeCompare(b.dump));

    const modelTotals = {};
    let grand = 0;
    list.forEach((a) => {
      const row = blank();
      row[0] = { v: a.pit, s: STYLE.LABEL };
      row[1] = { v: a.dump, s: STYLE.LABEL };
      models.forEach((m, i) => {
        const v = a.per[m] || 0;
        row[stubs.length + i] = numCell(v, STYLE.NUM);
        modelTotals[m] = (modelTotals[m] || 0) + v;
      });
      row[colGrand] = numCell(a.total, STYLE.TOTAL_NUM);
      grand += a.total;
      rows.push(row);
    });

    const gr = blank();
    gr[0] = { v: "Grand Total", s: STYLE.TOTAL_LABEL };
    merges.push(`${cellRef(rows.length, 0)}:${cellRef(rows.length, 1)}`);
    gr[1] = { v: "", s: STYLE.TOTAL_LABEL };
    models.forEach((m, i) => {
      gr[stubs.length + i] = numCell(modelTotals[m] || 0, STYLE.TOTAL_NUM);
    });
    gr[colGrand] = numCell(grand, STYLE.TOTAL_NUM);
    rows.push(gr);

    const cols = Array.from({ length: width }, (_, i) => {
      if (i === 0) return { width: 11 };
      if (i === 1) return { width: 24 };
      if (i === colGrand) return { width: 12 };
      return { width: 11 };
    });
    return { name: "วิธีที่ 1", cols, rows, merges, freeze: { xSplit: 2, ySplit: 3 } };
  };

  // วิธีที่ 2 — one row per Time × Pit × Dump Area × From, trips per model + total.
  const buildDetail = (records, models) => {
    const stubs = ["Time", "Pit", "Dump Area", "From"];
    const M = models.length;
    const width = stubs.length + M + 1;
    const colGrand = stubs.length + M;
    const rows = [];
    const merges = [];
    const { h1, h2, blank } = buildHeader(rows, merges, width, `วิธีที่ 2 — เที่ยวรายชั่วโมง แยกตาม Pit / Dump Area / From (Excavator) — ${selection.date}`, stubs);
    models.forEach((m, i) => {
      h2[stubs.length + i] = { v: m, s: STYLE.HEADER };
    });
    h2[colGrand] = { v: "Grand Total", s: STYLE.HEADER };
    rows.push(h1, h2);

    const agg = new Map();
    records.forEach((r) => {
      const key = `${r.shiftType}|${r.hour}|${r.pit}|${r.dump}|${r.from}`;
      let a = agg.get(key);
      if (!a) {
        a = { shiftType: r.shiftType, hour: r.hour, pit: r.pit, dump: r.dump, from: r.from, per: {}, total: 0 };
        agg.set(key, a);
      }
      a.per[r.model] = (a.per[r.model] || 0) + r.trips;
      a.total += r.trips;
    });
    const list = [...agg.values()].sort(
      (a, b) =>
        orderIndex(a.shiftType, a.hour) - orderIndex(b.shiftType, b.hour) ||
        a.pit.localeCompare(b.pit) ||
        a.dump.localeCompare(b.dump) ||
        a.from.localeCompare(b.from),
    );

    const modelTotals = {};
    let grand = 0;
    list.forEach((a) => {
      const row = blank();
      row[0] = { v: hourRange(a.hour), s: STYLE.LABEL };
      row[1] = { v: a.pit, s: STYLE.LABEL };
      row[2] = { v: a.dump, s: STYLE.LABEL };
      row[3] = { v: a.from, s: STYLE.LABEL };
      models.forEach((m, i) => {
        const v = a.per[m] || 0;
        row[stubs.length + i] = numCell(v, STYLE.NUM);
        modelTotals[m] = (modelTotals[m] || 0) + v;
      });
      row[colGrand] = numCell(a.total, STYLE.TOTAL_NUM);
      grand += a.total;
      rows.push(row);
    });

    const gr = blank();
    gr[0] = { v: "Grand Total", s: STYLE.TOTAL_LABEL };
    merges.push(`${cellRef(rows.length, 0)}:${cellRef(rows.length, 3)}`);
    [1, 2, 3].forEach((c) => {
      gr[c] = { v: "", s: STYLE.TOTAL_LABEL };
    });
    models.forEach((m, i) => {
      gr[stubs.length + i] = numCell(modelTotals[m] || 0, STYLE.TOTAL_NUM);
    });
    gr[colGrand] = numCell(grand, STYLE.TOTAL_NUM);
    rows.push(gr);

    const cols = Array.from({ length: width }, (_, i) => {
      if (i === 0) return { width: 14 };
      if (i === 1) return { width: 10 };
      if (i === 2) return { width: 24 };
      if (i === 3) return { width: 10 };
      if (i === colGrand) return { width: 12 };
      return { width: 11 };
    });
    return { name: "วิธีที่ 2", cols, rows, merges, freeze: { xSplit: 4, ySplit: 3 } };
  };

  const exportExcel = () => {
    if (exporting.value) return;
    exporting.value = true;
    try {
      const records = gather();
      const models = modelColumns(records);
      downloadXlsx(`trip-report-${selection.date}.xlsx`, [buildBySummary(records, models), buildDetail(records, models)]);
    } catch (err) {
      console.error("Trip report export failed", err);
    } finally {
      exporting.value = false;
    }
  };

  return { exporting, exportExcel };
}
