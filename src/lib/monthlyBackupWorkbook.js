import { STYLE } from "./xlsx.js";

const XML_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

const cleanText = (value) => String(value ?? "").replace(XML_CONTROL_CHARS, " ");

const displayValue = (value) => {
  if (value == null) return "";
  if (typeof value === "object") return cleanText(JSON.stringify(value));
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return typeof value === "number" ? value : cleanText(value);
};

const dataCell = (value) => {
  const displayed = displayValue(value);
  if (typeof displayed === "number" && Number.isFinite(displayed)) {
    return { v: displayed, t: "n", s: STYLE.NUM };
  }
  return { v: displayed, t: "s", s: STYLE.LEFT };
};

const styledRow = (values, style) => values.map((value) => ({ v: value, s: style }));

const columnKeys = (rows) => {
  const keys = [];
  const seen = new Set();
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (seen.has(key)) return;
      seen.add(key);
      keys.push(key);
    });
  });
  return keys;
};

const columnWidth = (key, rows) => {
  let longest = cleanText(key).length;
  rows.slice(0, 200).forEach((row) => {
    longest = Math.max(longest, cleanText(displayValue(row?.[key])).length);
  });
  // UUIDs remain readable while long remarks stay within a practical width.
  const cap = /remark|note|description/i.test(key) ? 48 : 38;
  return Math.min(cap, Math.max(12, longest + 2));
};

const columnName = (index) => {
  let current = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (current % 26)) + letters;
    current = Math.floor(current / 26) - 1;
  } while (current >= 0);
  return letters;
};

const buildSummarySheet = (backup, inventory) => {
  const status = (table) => (table.available ? "Included" : "Not installed");
  const rows = [
    [{ v: "ThaiDrill Monthly Data Backup", s: STYLE.TITLE }],
    styledRow(["Backup month", backup.month, "File type", "Excel workbook (.xlsx)"], STYLE.LEFT),
    styledRow(["Date range", `${backup.date_range.from} to ${backup.date_range.to}`, "Generated at", backup.generated_at], STYLE.LEFT),
    [
      { v: "Total rows", s: STYLE.LEFT },
      { v: backup.summary.total_rows, t: "n", s: STYLE.NUM },
      { v: "Included tables", s: STYLE.LEFT },
      { v: backup.summary.included_tables, t: "n", s: STYLE.NUM },
    ],
    styledRow(["Excluded", "users (accounts and passwords)", "Backup mode", "Read only"], STYLE.LEFT),
    [],
    styledRow(["Table", "Backup scope", "Status", "Rows"], STYLE.HEADER_GOLD),
    ...inventory.map((table) => [
      { v: table.name, s: STYLE.LEFT },
      { v: table.scope, s: STYLE.LEFT },
      { v: status(table), s: table.available ? STYLE.LABEL : STYLE.PILL_RED },
      { v: table.rows, t: "n", s: STYLE.NUM },
    ]),
  ];

  return {
    name: "Summary",
    cols: [{ width: 30 }, { width: 24 }, { width: 22 }, { width: 18 }],
    rows,
    merges: ["A1:D1"],
    freeze: { xSplit: 0, ySplit: 7 },
  };
};

const buildTableSheet = (name, tableRows, tableInfo, backup) => {
  const keys = columnKeys(tableRows);
  const width = Math.max(4, keys.length || 1);
  const finalColumn = columnName(width - 1);
  const rows = [
    [{ v: name, s: STYLE.TITLE }],
    styledRow(["Backup month", backup.month], STYLE.LEFT),
    styledRow(["Backup scope", tableInfo?.scope || "Selected month"], STYLE.LEFT),
    [{ v: "Record count", s: STYLE.LEFT }, { v: tableRows.length, t: "n", s: STYLE.NUM }],
    [],
  ];

  if (keys.length) {
    rows.push(styledRow(keys, STYLE.HEADER_GOLD));
    tableRows.forEach((row) => rows.push(keys.map((key) => dataCell(row?.[key]))));
  } else {
    rows.push([{ v: "No records for the selected month.", s: STYLE.LEFT }]);
  }

  const cols = keys.length
    ? keys.map((key) => ({ width: columnWidth(key, tableRows) }))
    : [{ width: 36 }, { width: 16 }, { width: 16 }, { width: 16 }];

  return {
    name,
    cols,
    rows,
    merges: [`A1:${finalColumn}1`, ...(keys.length ? [] : [`A6:${finalColumn}6`])],
    freeze: { xSplit: 0, ySplit: 6 },
  };
};

export const buildMonthlyBackupSheets = (backup, inventory) => {
  const infoByName = Object.fromEntries(inventory.map((table) => [table.name, table]));
  const tableSheets = Object.entries(backup.tables).map(([name, rows]) =>
    buildTableSheet(name, rows || [], infoByName[name], backup),
  );
  return [buildSummarySheet(backup, inventory), ...tableSheets];
};
