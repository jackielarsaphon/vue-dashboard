import { ref } from "vue";
import { useEntryStore, isWaste, rowTotal, rowTonnes } from "./useEntryStore.js";
import { useShiftSelection } from "./useShiftSelection.js";
import { useMiningAreasStore } from "../stores/miningAreasStore";
import { downloadXlsx, cellRef, STYLE } from "../lib/xlsx.js";

// Export the selected date's production as an .xlsx pivot in the tally-sheet
// shape the site uses: rows = each mining area split Waste / Ore, columns = each
// truck model split Day / Night, cell = TRIP count. Areas and models come from
// the master lists (all active ones show, even with no trips — a blank recurring
// form); anything logged against a model/area not in those lists falls into an
// "อื่นๆ (Other)" bucket, which only appears when it actually carries trips.
//
// Reads the shared entry cache (useEntryStore) that the Area production / Fleet
// pages already populate, so no extra fetch — it exports exactly what's on screen.

const OTHER_MODEL = "__other_model__";
const OTHER_AREA = "__other_area__";
const OTHER_LABEL = "อื่นๆ (Other)";

// Right-most Total column and header/label rows are styled; a zero data cell is
// left blank (but keeps its border) to match the printed sheet's empty look.
const numCell = (v, style) => (v > 0 ? { v, t: "n", s: style } : { v: "", s: style });

export function useExcelExport() {
  const { getBucket, truckModels } = useEntryStore();
  const { selection } = useShiftSelection();
  const miningAreasStore = useMiningAreasStore();
  const exporting = ref(false);

  const buildSheet = () => {
    const date = selection.date;

    const modelCodes = truckModels.value.map((m) => m.code); // active, display order
    const modelSet = new Set(modelCodes);
    const areaCodes = miningAreasStore.items.value
      .filter((a) => a.active)
      .map((a) => a.code)
      .sort((a, b) => a.localeCompare(b));
    const areaSet = new Set(areaCodes);

    // acc[areaKey] = { waste: { [modelKey]: {day,night} }, ore: {…} }  — TRIP counts
    // per model/shift for the day/night cells. tonnes[areaKey] = { waste, ore }
    // holds the converted TONNES total (trips × each model's tonnes/trip factor,
    // via rowTonnes — so the "Other" bucket, which mixes models, stays correct).
    const acc = {};
    const tonnes = {};
    let hasOtherModel = false;
    let hasOtherArea = false;
    const ensureArea = (k) => acc[k] || (acc[k] = { waste: {}, ore: {} });
    const ensureSlot = (mat, mk) => mat[mk] || (mat[mk] = { day: 0, night: 0 });
    const ensureTonnes = (k) => tonnes[k] || (tonnes[k] = { waste: 0, ore: 0 });

    [["Day", "day"], ["Night", "night"]].forEach(([shiftType, shiftKey]) => {
      for (let hour = 0; hour < 24; hour += 1) {
        Object.values(getBucket(date, shiftType, hour)).forEach((entry) => {
          entry.rows.forEach((row) => {
            const trips = rowTotal(row);
            if (!trips) return;
            const areaKey = areaSet.has(entry.area) ? entry.area : OTHER_AREA;
            if (areaKey === OTHER_AREA) hasOtherArea = true;
            const modelKey = modelSet.has(row.model) ? row.model : OTHER_MODEL;
            if (modelKey === OTHER_MODEL) hasOtherModel = true;
            const matType = isWaste(row.material) ? "waste" : "ore";
            ensureSlot(ensureArea(areaKey)[matType], modelKey)[shiftKey] += trips;
            ensureTonnes(areaKey)[matType] += rowTonnes(row);
          });
        });
      }
    });

    const modelCols = hasOtherModel ? [...modelCodes, OTHER_MODEL] : [...modelCodes];
    const areaRows = hasOtherArea ? [...areaCodes, OTHER_AREA] : [...areaCodes];
    const modelLabel = (k) => (k === OTHER_MODEL ? OTHER_LABEL : k);
    const areaLabel = (k) => (k === OTHER_AREA ? OTHER_LABEL : k);

    const get = (a, mat, mk, sk) => acc[a]?.[mat]?.[mk]?.[sk] || 0;

    // Column geometry: [Area][Material] then Day/Night per model, then two total
    // columns — trips, then the converted tonnes appended right after it.
    const M = modelCols.length;
    const colTotal = 2 + M * 2; // Total (trips)
    const colTonnes = colTotal + 1; // Total (tonnes)
    const width = colTonnes + 1;
    const modelStart = (g) => 2 + g * 2;
    const tonnesOf = (a, mat) => Math.round(tonnes[a]?.[mat] || 0);

    const rows = [];
    const merges = [];
    const blankRow = () => Array.from({ length: width }, () => null);

    // Row 0 — title banner across every column.
    const title = blankRow();
    title[0] = { v: `ผลผลิตรายพื้นที่ / Production by area & truck model — ${date} — เที่ยว + รวมตัน (trips + total tonnes, all shifts)`, s: STYLE.TITLE };
    rows.push(title);
    merges.push(`${cellRef(0, 0)}:${cellRef(0, width - 1)}`);

    // Rows 1–2 — two header bands (model over Day/Night; stub over Waste/Ore).
    const h1 = blankRow();
    const h2 = blankRow();
    h1[0] = { v: "Area / พื้นที่", s: STYLE.HEADER };
    merges.push(`${cellRef(1, 0)}:${cellRef(2, 0)}`);
    h1[1] = { v: "Model", s: STYLE.HEADER };
    h2[1] = { v: "Shift", s: STYLE.HEADER };
    modelCols.forEach((mk, g) => {
      const c = modelStart(g);
      h1[c] = { v: modelLabel(mk), s: STYLE.HEADER };
      merges.push(`${cellRef(1, c)}:${cellRef(1, c + 1)}`);
      h2[c] = { v: "Day Shift", s: STYLE.HEADER };
      h2[c + 1] = { v: "Night Shift", s: STYLE.HEADER };
    });
    h1[colTotal] = { v: "รวม (เที่ยว) / Total trips", s: STYLE.HEADER };
    merges.push(`${cellRef(1, colTotal)}:${cellRef(2, colTotal)}`);
    h1[colTonnes] = { v: "รวม (ตัน) / Total tonnes", s: STYLE.HEADER };
    merges.push(`${cellRef(1, colTonnes)}:${cellRef(2, colTonnes)}`);
    rows.push(h1, h2);

    // Body — one Area block (Waste row + Ore row) per area.
    areaRows.forEach((a) => {
      const wr = blankRow();
      const or = blankRow();
      const rWaste = rows.length; // 0-indexed row of the Waste row
      wr[0] = { v: areaLabel(a), s: STYLE.AREA };
      merges.push(`${cellRef(rWaste, 0)}:${cellRef(rWaste + 1, 0)}`);
      wr[1] = { v: "Waste", s: STYLE.LABEL };
      or[1] = { v: "Ore", s: STYLE.LABEL };
      let wasteTotal = 0;
      let oreTotal = 0;
      modelCols.forEach((mk, g) => {
        const c = modelStart(g);
        const wd = get(a, "waste", mk, "day");
        const wn = get(a, "waste", mk, "night");
        const od = get(a, "ore", mk, "day");
        const on = get(a, "ore", mk, "night");
        wr[c] = numCell(wd, STYLE.NUM);
        wr[c + 1] = numCell(wn, STYLE.NUM);
        or[c] = numCell(od, STYLE.NUM);
        or[c + 1] = numCell(on, STYLE.NUM);
        wasteTotal += wd + wn;
        oreTotal += od + on;
      });
      wr[colTotal] = numCell(wasteTotal, STYLE.TOTAL_NUM);
      or[colTotal] = numCell(oreTotal, STYLE.TOTAL_NUM);
      wr[colTonnes] = numCell(tonnesOf(a, "waste"), STYLE.TOTAL_NUM);
      or[colTonnes] = numCell(tonnesOf(a, "ore"), STYLE.TOTAL_NUM);
      rows.push(wr, or);
    });

    // Footer — grand-total block summing every area, per column.
    const tw = blankRow();
    const to = blankRow();
    const rTotal = rows.length;
    tw[0] = { v: "Total / รวม", s: STYLE.TOTAL_LABEL };
    merges.push(`${cellRef(rTotal, 0)}:${cellRef(rTotal + 1, 0)}`);
    tw[1] = { v: "Waste", s: STYLE.TOTAL_LABEL };
    to[1] = { v: "Ore", s: STYLE.TOTAL_LABEL };
    let grandWaste = 0;
    let grandOre = 0;
    modelCols.forEach((mk, g) => {
      const c = modelStart(g);
      const sum = (mat, sk) => areaRows.reduce((acc2, a) => acc2 + get(a, mat, mk, sk), 0);
      const wd = sum("waste", "day");
      const wn = sum("waste", "night");
      const od = sum("ore", "day");
      const on = sum("ore", "night");
      tw[c] = numCell(wd, STYLE.TOTAL_NUM);
      tw[c + 1] = numCell(wn, STYLE.TOTAL_NUM);
      to[c] = numCell(od, STYLE.TOTAL_NUM);
      to[c + 1] = numCell(on, STYLE.TOTAL_NUM);
      grandWaste += wd + wn;
      grandOre += od + on;
    });
    tw[colTotal] = numCell(grandWaste, STYLE.TOTAL_NUM);
    to[colTotal] = numCell(grandOre, STYLE.TOTAL_NUM);
    const grandTonnes = (mat) => areaRows.reduce((s, a) => s + tonnesOf(a, mat), 0);
    tw[colTonnes] = numCell(grandTonnes("waste"), STYLE.TOTAL_NUM);
    to[colTonnes] = numCell(grandTonnes("ore"), STYLE.TOTAL_NUM);
    rows.push(tw, to);

    const cols = Array.from({ length: width }, (_, i) => {
      if (i === 0) return { width: 13 };
      if (i === 1) return { width: 9 };
      if (i === colTotal) return { width: 14 };
      if (i === colTonnes) return { width: 14 };
      return { width: 11 };
    });

    return {
      name: "Production",
      cols,
      rows,
      merges,
      freeze: { xSplit: 2, ySplit: 3 },
    };
  };

  const exportExcel = () => {
    if (exporting.value) return;
    exporting.value = true;
    try {
      downloadXlsx(`production-trips-${selection.date}.xlsx`, buildSheet());
    } catch (err) {
      console.error("Excel export failed", err);
    } finally {
      exporting.value = false;
    }
  };

  return { exporting, exportExcel };
}
