import { ref } from "vue";
import { useEntryStore, rowTotal, isWaste } from "./useEntryStore.js";
import { useShiftSelection } from "./useShiftSelection.js";
import { useMaterialRoutes } from "./useMaterialRoutes.js";
import { useExcavatorsStore } from "../stores/excavatorsStore";
import { downloadXlsx } from "../lib/xlsx.js";
import { buildTripSheet, materialTypeFor, modelColumns } from "../lib/tripReportSheet.js";

// Exports the selected date's Data-entry trips as a single-tab .xlsx ("Hourly Trip
// Report"): one row per Time (hour) × Pit × Dump Area × From (excavator) ×
// Material type × Ore type, trips split across truck-model columns with a Grand
// Total column per row and a Grand Total footer.
//
// Reads the shared entry cache (useEntryStore) that the pages already populate,
// so it exports exactly the trips on screen — no extra fetch. The sheet itself is
// built by lib/tripReportSheet.js, shared with Settings ▸ Backup data (which emits
// the same sheet once per day over a date range).

export function useTripReportExport() {
  const { getBucket, truckModels } = useEntryStore();
  const { selection } = useShiftSelection();
  const { routes: materialRoutes } = useMaterialRoutes();
  const excavatorsStore = useExcavatorsStore();
  const exporting = ref(false);

  // Flatten every trip logged on the date into { shiftType, hour, pit, dump,
  // from, materialType, oreType, model, trips } records.
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
            const oreType = row.material || "";
            records.push({
              shiftType,
              hour,
              pit,
              dump: row.dump || "",
              from,
              materialType: materialTypeFor(oreType, materialRoutes.value, isWaste),
              oreType,
              model: row.model || "",
              trips,
            });
          });
        });
      }
    });
    return records;
  };

  const exportExcel = () => {
    if (exporting.value) return;
    exporting.value = true;
    try {
      const records = gather();
      const models = modelColumns(records, truckModels.value.map((m) => m.code));
      const sheet = buildTripSheet({
        records,
        models,
        title: `รายงานเที่ยวรายชั่วโมง — แยกตาม Pit / Dump Area / From (Excavator) / Material — ${selection.date}`,
      });
      downloadXlsx(`trip-report-${selection.date}.xlsx`, sheet);
    } catch (err) {
      console.error("Trip report export failed", err);
    } finally {
      exporting.value = false;
    }
  };

  return { exporting, exportExcel };
}
