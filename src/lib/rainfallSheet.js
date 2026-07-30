import { STYLE } from "./xlsx.js";

// Sheet layout for the rainfall export — one worksheet per pit, laid out like the
// source Rainfall sheet (Period · Rain Duration · Affect operation · Lost Time
// Operation · Red Alert · Remark) plus the Shift and Rainfall intensity the app
// also records, and a totals row.
//
// Pure formatting: callers hand over plain records (see useRainfallExport), so this
// module has no Vue / Supabase dependency and can be exercised on its own — the same
// split tripReportSheet.js uses.

const COLUMNS = [
  { title: "Shift", width: 9 },
  { title: "Period", width: 14 },
  { title: "Rainfall Intensity", width: 17 },
  { title: "Rain Duration (Min)", width: 18 },
  { title: "Affect operation", width: 16 },
  { title: "Lost Time Operation (Min)", width: 22 },
  { title: "Red Alert", width: 11 },
  { title: "Remark", width: 46 },
];
const LAST_COL = String.fromCharCode(64 + COLUMNS.length); // "H"
const HEADER_ROW = 4; // title, date, blank, header

export const dateLabelOf = (iso) => {
  const [y, m, d] = String(iso).split("-");
  return d && m && y ? `${Number(d)}/${Number(m)}/${y}` : String(iso);
};

// Excel forbids : \ / ? * [ ] in a tab name and caps it at 31 characters.
export const sheetName = (name, index) => {
  const safe = String(name || "").replace(/[:\\/?*[\]]/g, " ").trim();
  return (safe || `Pit ${index + 1}`).slice(0, 31);
};

// records: [{ shift, period, intensity, rainMin, affect, lostMin, redAlert, remark }]
export const buildRainfallSheet = ({ pit, records = [], dateIso, index = 0 }) => {
  const totals = records.reduce(
    (acc, r) => ({
      rain: acc.rain + (Number(r.rainMin) || 0),
      lost: acc.lost + (Number(r.lostMin) || 0),
      alerts: acc.alerts + (r.redAlert ? 1 : 0),
    }),
    { rain: 0, lost: 0, alerts: 0 },
  );

  const rows = [
    [{ v: `Rainfall Record — ${pit}`, s: STYLE.TITLE }],
    [{ v: `Date : ${dateLabelOf(dateIso)}`, s: STYLE.DEFAULT }],
    [],
    COLUMNS.map((col) => ({ v: col.title, s: STYLE.HEADER })),
  ];

  records.forEach((r) => {
    rows.push([
      { v: r.shift || "", s: STYLE.LABEL },
      { v: r.period || "", s: STYLE.LABEL },
      { v: r.intensity || "", s: STYLE.LABEL },
      { v: Number(r.rainMin) || 0, t: "n", s: STYLE.NUM },
      { v: r.affect ? "YES" : "NO", s: STYLE.LABEL },
      { v: Number(r.lostMin) || 0, t: "n", s: STYLE.NUM },
      { v: r.redAlert ? "YES" : "", s: STYLE.LABEL },
      { v: r.remark || "", s: STYLE.LABEL },
    ]);
  });

  if (records.length) {
    rows.push([
      { v: "Total", s: STYLE.TOTAL_LABEL },
      { v: "", s: STYLE.TOTAL_LABEL },
      { v: "", s: STYLE.TOTAL_LABEL },
      { v: totals.rain, t: "n", s: STYLE.TOTAL_NUM },
      { v: "", s: STYLE.TOTAL_LABEL },
      { v: totals.lost, t: "n", s: STYLE.TOTAL_NUM },
      { v: totals.alerts, t: "n", s: STYLE.TOTAL_NUM },
      { v: "", s: STYLE.TOTAL_LABEL },
    ]);
  }

  return {
    name: sheetName(pit, index),
    cols: COLUMNS.map((col) => ({ width: col.width })),
    rows,
    merges: [`A1:${LAST_COL}1`],
    // Keep the column band visible while scrolling a long rainy day.
    freeze: { ySplit: HEADER_ROW },
  };
};

// pits: [{ name, records }] → one worksheet each. An empty day still yields one
// header-only sheet, so the export never produces a file Excel refuses to open.
export const buildRainfallSheets = ({ pits = [], dateIso, emptyPitName = "Rainfall" }) => {
  if (pits.length === 0) return [buildRainfallSheet({ pit: emptyPitName, records: [], dateIso, index: 0 })];
  return pits.map((pit, index) => buildRainfallSheet({ pit: pit.name, records: pit.records, dateIso, index }));
};
