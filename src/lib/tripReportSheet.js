import { cellRef, STYLE } from "./xlsx.js";

// Shared builders for the trip-report sheets. Kept free of Vue / Supabase so every
// caller produces the SAME sheet shape:
//   • Data entry ▸ Export Excel — ONE sheet for the selected date (useTripReportExport)
//   • Settings ▸ Backup data    — one sheet PER DAY over a date range (useBackupExport)
//
// A `record` is one trip bucket, exactly as Data entry keys it:
//   { shiftType, hour, placementId, pit, dump, from, digBlock, rl, materialType,
//     oreType, model, trips, factor, remark }
// placementId groups the row (one Data entry row = one placement), rl / remark are
// that placement's values for the hour, and factor is the model's tonnes/trip for
// the record's own date.

// Operational-day hour order: Day 06→17 then Night 18→05. Used so the rows list
// chronologically across the shift boundary instead of plain 00→23.
export const DAY_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
export const NIGHT_HOURS = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5];

const pad = (n) => String(n).padStart(2, "0");
// "06.00-07.00" — the dotted range used in the sample sheet.
export const hourRange = (hour) => `${pad(hour)}.00-${pad((hour + 1) % 24)}.00`;
const orderIndex = (shiftType, hour) =>
  shiftType === "Day" ? DAY_HOURS.indexOf(hour) : DAY_HOURS.length + NIGHT_HOURS.indexOf(hour);

// A zero data cell is left blank (but keeps its border) to match the printed look.
const numCell = (v, style) => (v > 0 ? { v, t: "n", s: style } : { v: "", s: style });
// For measured values (RL, factor) where 0 is a real reading — only "no value at
// all" blanks out, so a genuine 0 still prints.
const valCell = (v, style) =>
  v === "" || v == null || Number.isNaN(Number(v)) ? { v: "", s: style } : { v: Number(v), t: "n", s: style };

// An entry row stores the ORE TYPE code (the Data entry form's "Ore type"); its
// "Material type" (Ore / Waste) comes from the material_routes pairing, falling back
// to the waste flag on the materials master — the same rule the Data entry grid uses.
// A blank ore type stays blank rather than being guessed as "Ore".
export const materialTypeFor = (oreType, routes, isWasteCode) => {
  if (!oreType) return "";
  const route = routes.find((item) => item.oreType === oreType);
  if (route) return route.material;
  return isWasteCode(oreType) ? "Waste" : "Ore";
};

// Model columns = the truck models that actually carry trips, ordered by the master
// (display) order, with any unknown ones appended. Falls back to the full master list
// when nothing was logged, so the header never collapses.
export const modelColumns = (records, masterCodes = []) => {
  const used = new Set(records.map((r) => r.model).filter(Boolean));
  const ordered = masterCodes.filter((code) => used.has(code));
  const extras = [...used].filter((code) => !masterCodes.includes(code)).sort((a, b) => a.localeCompare(b));
  const cols = [...ordered, ...extras];
  return cols.length ? cols : [...masterCodes];
};

// Shared header: a full-width title row, then a two-row band where `stubs` (the left
// label columns) and `tail` (the columns after the trip counts) merge vertically, and
// a single "Trip" cell spans the model columns + Grand Total with the model names +
// "Grand Total" beneath it.
const buildHeader = (rows, merges, width, title, stubs, tail = []) => {
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
  const bandStart = stubs.length;
  const bandEnd = width - 1 - tail.length;
  h1[bandStart] = { v: "Trip", s: STYLE.HEADER };
  // Skip the merge when the band is a single column (no model columns at all) —
  // Excel treats a one-cell merge as a repairable defect.
  if (bandEnd > bandStart) merges.push(`${cellRef(1, bandStart)}:${cellRef(1, bandEnd)}`);
  tail.forEach((label, i) => {
    const c = bandEnd + 1 + i;
    h1[c] = { v: label, s: STYLE.HEADER };
    merges.push(`${cellRef(1, c)}:${cellRef(2, c)}`);
  });
  return { h1, h2, blank };
};

const TRIP_STUBS = ["Time", "Pit", "Dump Area", "From", "Dig Block", "RL", "Material type", "Ore type"];
const TRIP_TAIL = ["Truck Factor", "Remark"];

// The report sheet — one row per Time × Pit × Dump Area × From × Dig Block ×
// Material type × Ore type (per Data entry row), trips per truck model with a Grand
// Total column and footer, then the row's Truck Factor and Remark.
export const buildTripSheet = ({ records, models, title, name = "Hourly Trip Report" }) => {
  const stubs = TRIP_STUBS;
  const tail = TRIP_TAIL;
  const M = models.length;
  const colGrand = stubs.length + M;
  const colFactor = colGrand + 1;
  const colRemark = colFactor + 1;
  const width = colRemark + 1;
  const rows = [];
  const merges = [];
  const { h1, h2, blank } = buildHeader(rows, merges, width, title, stubs, tail);
  models.forEach((m, i) => {
    h2[stubs.length + i] = { v: m, s: STYLE.HEADER };
  });
  h2[colGrand] = { v: "Grand Total", s: STYLE.HEADER };
  rows.push(h1, h2);

  const agg = new Map();
  records.forEach((r) => {
    // placementId is part of the key but not a column: one Data entry row = one
    // placement, and RL / Remark belong to it — so two placements of the same
    // excavator in the same pit stay separate rows instead of merging with one of
    // their RL / Remark values silently winning.
    const key = [r.shiftType, r.hour, r.placementId ?? "", r.pit, r.dump, r.from, r.digBlock ?? "", r.materialType, r.oreType].join("|");
    let a = agg.get(key);
    if (!a) {
      a = {
        shiftType: r.shiftType,
        hour: r.hour,
        pit: r.pit,
        dump: r.dump,
        from: r.from,
        digBlock: r.digBlock ?? "",
        rl: r.rl ?? "",
        materialType: r.materialType,
        oreType: r.oreType,
        remark: r.remark ?? "",
        per: {},
        total: 0,
        tonnes: 0,
      };
      agg.set(key, a);
    }
    a.per[r.model] = (a.per[r.model] || 0) + r.trips;
    a.total += r.trips;
    a.tonnes += r.trips * (Number(r.factor) || 0);
  });
  const list = [...agg.values()].sort(
    (a, b) =>
      orderIndex(a.shiftType, a.hour) - orderIndex(b.shiftType, b.hour) ||
      a.pit.localeCompare(b.pit) ||
      a.dump.localeCompare(b.dump) ||
      a.from.localeCompare(b.from) ||
      a.digBlock.localeCompare(b.digBlock) ||
      a.materialType.localeCompare(b.materialType) ||
      a.oreType.localeCompare(b.oreType),
  );

  // Tonnes/trip for the row. A row normally carries one truck model, so this is that
  // model's factor; when trips are split across models it's the effective (trip-
  // weighted) factor, which keeps factor × trips = the row's tonnes either way.
  const effectiveFactor = (a) => (a.total > 0 ? Math.round((a.tonnes / a.total) * 100) / 100 : "");

  const modelTotals = {};
  let grand = 0;
  let grandTonnes = 0;
  list.forEach((a) => {
    const row = blank();
    row[0] = { v: hourRange(a.hour), s: STYLE.LABEL };
    row[1] = { v: a.pit, s: STYLE.LABEL };
    row[2] = { v: a.dump, s: STYLE.LABEL };
    row[3] = { v: a.from, s: STYLE.LABEL };
    row[4] = { v: a.digBlock, s: STYLE.LABEL };
    row[5] = valCell(a.rl, STYLE.NUM);
    row[6] = { v: a.materialType, s: STYLE.LABEL };
    row[7] = { v: a.oreType, s: STYLE.LABEL };
    models.forEach((m, i) => {
      const v = a.per[m] || 0;
      row[stubs.length + i] = numCell(v, STYLE.NUM);
      modelTotals[m] = (modelTotals[m] || 0) + v;
    });
    row[colGrand] = numCell(a.total, STYLE.TOTAL_NUM);
    row[colFactor] = valCell(effectiveFactor(a), STYLE.NUM);
    row[colRemark] = { v: a.remark, s: STYLE.LABEL };
    grand += a.total;
    grandTonnes += a.tonnes;
    rows.push(row);
  });

  const gr = blank();
  gr[0] = { v: "Grand Total", s: STYLE.TOTAL_LABEL };
  merges.push(`${cellRef(rows.length, 0)}:${cellRef(rows.length, stubs.length - 1)}`);
  for (let c = 1; c < stubs.length; c += 1) gr[c] = { v: "", s: STYLE.TOTAL_LABEL };
  models.forEach((m, i) => {
    gr[stubs.length + i] = numCell(modelTotals[m] || 0, STYLE.TOTAL_NUM);
  });
  gr[colGrand] = numCell(grand, STYLE.TOTAL_NUM);
  // Footer factor = tonnes / trips across every row, so it stays consistent with the
  // per-row column instead of summing factors.
  gr[colFactor] = valCell(grand > 0 ? Math.round((grandTonnes / grand) * 100) / 100 : "", STYLE.TOTAL_NUM);
  gr[colRemark] = { v: "", s: STYLE.TOTAL_LABEL };
  rows.push(gr);

  const cols = Array.from({ length: width }, (_, i) => {
    if (i === 0) return { width: 14 }; // Time
    if (i === 1) return { width: 10 }; // Pit
    if (i === 2) return { width: 24 }; // Dump Area
    if (i === 3) return { width: 10 }; // From
    if (i === 4) return { width: 12 }; // Dig Block
    if (i === 5) return { width: 8 }; // RL
    if (i === 6) return { width: 14 }; // Material type
    if (i === 7) return { width: 12 }; // Ore type
    if (i === colGrand) return { width: 12 };
    if (i === colFactor) return { width: 12 };
    if (i === colRemark) return { width: 34 };
    return { width: 11 }; // truck models
  });
  return { name, cols, rows, merges, freeze: { xSplit: stubs.length, ySplit: 3 } };
};

// The Backup-data workbook's first tab: one row per exported DAY (each of which is
// its own sheet), so the file opens on an index instead of the first date.
// `perDate` is [{ date, day, night, waste, ore, per: { [model]: trips }, total }].
export const buildDailySummarySheet = ({ perDate, models, from, to, name = "Summary" }) => {
  const M = models.length;
  const colDay = 1;
  const colWaste = 3;
  const colModel = 5;
  const colGrand = colModel + M;
  const width = colGrand + 1;
  const rows = [];
  const merges = [];
  const blank = () => Array.from({ length: width }, () => null);

  const title = blank();
  title[0] = {
    v: `สำรองข้อมูล Data entry รายวัน / Daily data backup — ${from} → ${to} — ${perDate.length} วัน (days), 1 ชีตต่อวัน (one sheet per day)`,
    s: STYLE.TITLE,
  };
  rows.push(title);
  merges.push(`${cellRef(0, 0)}:${cellRef(0, width - 1)}`);

  // Two header bands: Date and Grand Total merge down; Shift / Material / Truck model
  // each span their own group of columns.
  const h1 = blank();
  const h2 = blank();
  h1[0] = { v: "Date", s: STYLE.HEADER };
  merges.push(`${cellRef(1, 0)}:${cellRef(2, 0)}`);
  h1[colDay] = { v: "Shift", s: STYLE.HEADER };
  merges.push(`${cellRef(1, colDay)}:${cellRef(1, colDay + 1)}`);
  h2[colDay] = { v: "Day", s: STYLE.HEADER };
  h2[colDay + 1] = { v: "Night", s: STYLE.HEADER };
  h1[colWaste] = { v: "Material type", s: STYLE.HEADER };
  merges.push(`${cellRef(1, colWaste)}:${cellRef(1, colWaste + 1)}`);
  h2[colWaste] = { v: "Waste", s: STYLE.HEADER };
  h2[colWaste + 1] = { v: "Ore", s: STYLE.HEADER };
  if (M > 0) {
    h1[colModel] = { v: "Truck model", s: STYLE.HEADER };
    merges.push(`${cellRef(1, colModel)}:${cellRef(1, colModel + M - 1)}`);
    models.forEach((m, i) => {
      h2[colModel + i] = { v: m, s: STYLE.HEADER };
    });
  }
  h1[colGrand] = { v: "Grand Total", s: STYLE.HEADER };
  merges.push(`${cellRef(1, colGrand)}:${cellRef(2, colGrand)}`);
  rows.push(h1, h2);

  const totals = { day: 0, night: 0, waste: 0, ore: 0, per: {}, grand: 0 };
  perDate.forEach((d) => {
    const row = blank();
    row[0] = { v: d.date, s: STYLE.AREA };
    row[colDay] = numCell(d.day, STYLE.NUM);
    row[colDay + 1] = numCell(d.night, STYLE.NUM);
    row[colWaste] = numCell(d.waste, STYLE.NUM);
    row[colWaste + 1] = numCell(d.ore, STYLE.NUM);
    models.forEach((m, i) => {
      const v = d.per[m] || 0;
      row[colModel + i] = numCell(v, STYLE.NUM);
      totals.per[m] = (totals.per[m] || 0) + v;
    });
    row[colGrand] = numCell(d.total, STYLE.TOTAL_NUM);
    totals.day += d.day;
    totals.night += d.night;
    totals.waste += d.waste;
    totals.ore += d.ore;
    totals.grand += d.total;
    rows.push(row);
  });

  const gr = blank();
  gr[0] = { v: "Grand Total", s: STYLE.TOTAL_LABEL };
  gr[colDay] = numCell(totals.day, STYLE.TOTAL_NUM);
  gr[colDay + 1] = numCell(totals.night, STYLE.TOTAL_NUM);
  gr[colWaste] = numCell(totals.waste, STYLE.TOTAL_NUM);
  gr[colWaste + 1] = numCell(totals.ore, STYLE.TOTAL_NUM);
  models.forEach((m, i) => {
    gr[colModel + i] = numCell(totals.per[m] || 0, STYLE.TOTAL_NUM);
  });
  gr[colGrand] = numCell(totals.grand, STYLE.TOTAL_NUM);
  rows.push(gr);

  const cols = Array.from({ length: width }, (_, i) => {
    if (i === 0) return { width: 14 };
    if (i === colGrand) return { width: 13 };
    return { width: 11 };
  });
  return { name, cols, rows, merges, freeze: { xSplit: 1, ySplit: 3 } };
};
