import { STYLE } from "./xlsx.js";
import { buildRainfallSheet } from "./rainfallSheet.js";

const styledRow = (values, style) => values.map((value) => ({ v: value, s: style }));
const numCell = (value, style = STYLE.NUM) => ({ v: Number(value) || 0, t: "n", s: style });

const buildSummarySheet = (backup) => {
  const rows = [
    [{ v: "ThaiDrill Monthly Rainfall Backup", s: STYLE.TITLE }],
    styledRow(
      [
        "Backup month",
        backup.month,
        "Date range",
        `${backup.date_range.from} to ${backup.date_range.to}`,
        "Generated at",
        backup.generated_at,
      ],
      STYLE.LEFT,
    ),
    [
      { v: "Rainfall records", s: STYLE.LEFT },
      numCell(backup.summary.records),
      { v: "Rain duration (Min)", s: STYLE.LEFT },
      numCell(backup.summary.rain_duration),
      { v: "Red alerts", s: STYLE.LEFT },
      numCell(backup.summary.red_alerts),
    ],
    [
      { v: "Rainfall days", s: STYLE.LEFT },
      numCell(backup.summary.days),
      { v: "Red alert duration (Min)", s: STYLE.LEFT },
      numCell(backup.summary.red_alert_duration),
      { v: "Areas", s: STYLE.LEFT },
      numCell(backup.summary.areas),
    ],
    [],
    styledRow(
      ["Date", "Areas", "Rainfall records", "Rain duration (Min)", "Red alerts", "Red alert duration (Min)"],
      STYLE.HEADER_GOLD,
    ),
    ...backup.days.map((day) => [
      { v: day.date, s: STYLE.LABEL },
      { v: day.areas.join(", "), s: STYLE.LEFT },
      numCell(day.record_count),
      numCell(day.rain_duration),
      numCell(day.red_alerts),
      numCell(day.red_alert_duration),
    ]),
  ];

  if (backup.days.length) {
    rows.push([
      { v: "Total", s: STYLE.TOTAL_LABEL },
      { v: "", s: STYLE.TOTAL_LABEL },
      numCell(backup.summary.records, STYLE.TOTAL_NUM),
      numCell(backup.summary.rain_duration, STYLE.TOTAL_NUM),
      numCell(backup.summary.red_alerts, STYLE.TOTAL_NUM),
      numCell(backup.summary.red_alert_duration, STYLE.TOTAL_NUM),
    ]);
  }

  return {
    name: "Summary",
    cols: [{ width: 14 }, { width: 38 }, { width: 18 }, { width: 20 }, { width: 14 }, { width: 24 }],
    rows,
    merges: ["A1:F1"],
    freeze: { xSplit: 0, ySplit: 6 },
  };
};

export const buildMonthlyRainfallSheets = (backup) => [
  buildSummarySheet(backup),
  ...backup.days.map((day) => buildRainfallSheet({ records: day.records, dateIso: day.date })),
];
