import { ref } from "vue";
import { useShiftSelection } from "./useShiftSelection.js";
import { useRainfallLog, periodLabel, rainMinutes, redAlertMinutes } from "./useRainfallLog.js";
import { downloadXlsx } from "../lib/xlsx.js";
import { buildRainfallSheet } from "../lib/rainfallSheet.js";

// Exports the selected date's rainfall log as an .xlsx laid out like the source
// Rainfall sheet — every pit on one sheet, in time order. The layout itself lives in
// lib/rainfallSheet.js; this only gathers the records.
//
// Scope is the whole DATE (both shifts), same as the Rainfall dashboard, so the file
// matches the report no matter which shift is selected when it's clicked. Reads the
// shared rainfall cache the pages already populate — no extra fetch.

export function useRainfallExport() {
  const { selection } = useShiftSelection();
  const { rowsForDate } = useRainfallLog();
  const exporting = ref(false);

  const exportExcel = () => {
    if (exporting.value) return;
    exporting.value = true;
    try {
      const date = selection.date;
      // rowsForDate is already in operational order (Day then Night, by start time).
      // Number each distinct shift+start as it first appears, then sort on that and
      // the pit name, so the pits that rained in the same period sit together — the
      // way the source sheet interleaves them.
      const rows = rowsForDate(date);
      const slotOf = new Map();
      rows.forEach((row) => {
        const key = `${row.shiftType}|${row.startTime}`;
        if (!slotOf.has(key)) slotOf.set(key, slotOf.size);
      });
      const records = [...rows]
        .sort(
          (a, b) =>
            slotOf.get(`${a.shiftType}|${a.startTime}`) - slotOf.get(`${b.shiftType}|${b.startTime}`) ||
            String(a.areaCode).localeCompare(String(b.areaCode)),
        )
        .map((row) => ({
          area: row.areaCode,
          intensity: row.intensity,
          start: row.startTime,
          end: row.endTime,
          period: periodLabel(row),
          rainMin: rainMinutes(row),
          redAlert: row.redAlert,
          redAlertStart: row.redAlertStart,
          redAlertEnd: row.redAlertEnd,
          redAlertMin: redAlertMinutes(row),
          affect: row.affectOpt,
          remark: row.remark,
          shift: row.shiftType || "",
        }));

      downloadXlsx(`rainfall-${date}.xlsx`, buildRainfallSheet({ records, dateIso: date }));
    } catch (err) {
      console.error("Rainfall export failed", err);
    } finally {
      exporting.value = false;
    }
  };

  return { exporting, exportExcel };
}
