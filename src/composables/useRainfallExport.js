import { ref } from "vue";
import { useShiftSelection } from "./useShiftSelection.js";
import { useAppAreas } from "./useAppAreas.js";
import { useRainfallLog, periodLabel, rainMinutes, lostMinutes } from "./useRainfallLog.js";
import { downloadXlsx } from "../lib/xlsx.js";
import { buildRainfallSheets } from "../lib/rainfallSheet.js";

// Exports the selected date's rainfall log as an .xlsx — one tab per pit, laid out
// like the source Rainfall sheet. The layout itself lives in lib/rainfallSheet.js;
// this only gathers the records.
//
// Scope is the whole DATE (both shifts), same as the Rainfall dashboard, so the file
// matches the report no matter which shift is selected when it's clicked. Reads the
// shared rainfall cache the pages already populate — no extra fetch.

export function useRainfallExport() {
  const { selection } = useShiftSelection();
  const { areas: appAreas } = useAppAreas();
  const { rowsForDate } = useRainfallLog();
  const exporting = ref(false);

  const exportExcel = () => {
    if (exporting.value) return;
    exporting.value = true;
    try {
      const date = selection.date;
      const rows = rowsForDate(date);
      // Every pit that logged rain, in App Area order first so the tabs read the same
      // way as the dashboard; a pit since dropped from the master still gets its tab.
      const logged = Array.from(new Set(rows.map((row) => row.areaCode).filter(Boolean)));
      const names = [
        ...appAreas.value.filter((name) => logged.includes(name)),
        ...logged.filter((name) => !appAreas.value.includes(name)),
      ];

      const pits = names.map((name) => ({
        name,
        records: rows
          .filter((row) => row.areaCode === name)
          .map((row) => ({
            shift: row.shiftType || "",
            period: periodLabel(row),
            intensity: row.intensity,
            rainMin: rainMinutes(row),
            affect: row.affectOpt,
            lostMin: lostMinutes(row),
            redAlert: row.redAlert,
            remark: row.remark,
          })),
      }));

      downloadXlsx(`rainfall-${date}.xlsx`, buildRainfallSheets({ pits, dateIso: date, emptyPitName: appAreas.value[0] || "Rainfall" }));
    } catch (err) {
      console.error("Rainfall export failed", err);
    } finally {
      exporting.value = false;
    }
  };

  return { exporting, exportExcel };
}
