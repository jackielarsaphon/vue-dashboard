import { STYLE } from "./xlsx.js";

// Sheet layout for the rainfall export — ONE sheet holding every pit's rows for the
// date, in the same shape as the source Rainfall sheet:
//
//   Area | Rainfall Intensity | Start Time | End Time | Period | Rain Duration (Min)
//        | Affect Opt | Start | End | Lost time Duration (Min) | Red Alert | Remark
//
// with the gold header band and its colour coding (Heavy / YES red, Moderate peach,
// Clear / NO grey). A Shift column trails the twelve so rows from the two shifts of
// one date stay distinguishable — the source sheet is one shift per page.
//
// Pure formatting: callers hand over plain records (see useRainfallExport), so this
// module has no Vue / Supabase dependency and can be exercised on its own — the same
// split tripReportSheet.js uses.

const COLUMNS = [
  { title: "Area", width: 16 },
  { title: "Rainfall Intensity", width: 17 },
  { title: "Start Time", width: 11 },
  { title: "End Time", width: 11 },
  { title: "Period", width: 14 },
  { title: "Rain Duration (Min)", width: 18 },
  { title: "Affect Opt", width: 11 },
  { title: "Start", width: 10 },
  { title: "End", width: 10 },
  { title: "Lost time Duration (Min)", width: 21 },
  { title: "Red Alert", width: 11 },
  { title: "Remark", width: 48 },
  { title: "Shift", width: 8 },
];

export const dateLabelOf = (iso) => {
  const [y, m, d] = String(iso).split("-");
  return d && m && y ? `${Number(d)}/${Number(m)}/${y}` : String(iso);
};

// Excel forbids : \ / ? * [ ] in a tab name and caps it at 31 characters, so the
// date goes in with dashes.
export const sheetName = (dateIso) => `Rainfall ${dateLabelOf(dateIso).replace(/\//g, "-")}`.slice(0, 31);

const INTENSITY_STYLE = {
  Heavy: STYLE.PILL_RED,
  Moderate: STYLE.PILL_PEACH,
  Light: STYLE.PILL_PEACH,
  Clear: STYLE.PILL_MUTED,
};

// records: [{ area, intensity, start, end, period, rainMin, affect, lostStart,
//             lostEnd, lostMin, redAlert, remark, shift }]
// Cells the source sheet leaves empty (the lost-time window of an unaffected spell)
// stay empty here too, rather than reading as a real 0.
export const buildRainfallSheet = ({ records = [], dateIso }) => {
  const totals = records.reduce(
    (acc, r) => ({
      rain: acc.rain + (Number(r.rainMin) || 0),
      lost: acc.lost + (Number(r.lostMin) || 0),
      alerts: acc.alerts + (r.redAlert ? 1 : 0),
    }),
    { rain: 0, lost: 0, alerts: 0 },
  );

  const rows = [COLUMNS.map((col) => ({ v: col.title, s: STYLE.HEADER_GOLD }))];

  records.forEach((r) => {
    rows.push([
      { v: r.area || "", s: STYLE.LABEL },
      { v: r.intensity || "", s: INTENSITY_STYLE[r.intensity] ?? STYLE.LABEL },
      { v: r.start || "", s: STYLE.RIGHT },
      { v: r.end || "", s: STYLE.RIGHT },
      { v: r.period || "", s: STYLE.LABEL },
      { v: Number(r.rainMin) || 0, t: "n", s: STYLE.RIGHT },
      { v: r.affect ? "YES" : "NO", s: r.affect ? STYLE.PILL_RED : STYLE.PILL_MUTED },
      { v: r.affect ? r.lostStart || "" : "", s: STYLE.RIGHT },
      { v: r.affect ? r.lostEnd || "" : "", s: STYLE.RIGHT },
      r.affect ? { v: Number(r.lostMin) || 0, t: "n", s: STYLE.RIGHT } : { v: "", s: STYLE.RIGHT },
      { v: r.redAlert ? "YES" : "NO", s: r.redAlert ? STYLE.PILL_RED : STYLE.PILL_MUTED },
      { v: r.remark || "", s: STYLE.LEFT },
      { v: r.shift || "", s: STYLE.LABEL },
    ]);
  });

  if (records.length) {
    const total = COLUMNS.map(() => ({ v: "", s: STYLE.TOTAL_LABEL }));
    total[0] = { v: "Total", s: STYLE.TOTAL_LABEL };
    total[5] = { v: totals.rain, t: "n", s: STYLE.TOTAL_NUM };
    total[9] = { v: totals.lost, t: "n", s: STYLE.TOTAL_NUM };
    total[10] = { v: totals.alerts, t: "n", s: STYLE.TOTAL_NUM };
    rows.push(total);
  }

  return {
    name: sheetName(dateIso),
    cols: COLUMNS.map((col) => ({ width: col.width })),
    rows,
    // Keep the column band visible while scrolling a long rainy day.
    freeze: { ySplit: 1 },
  };
};
