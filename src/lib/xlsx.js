// Minimal, dependency-free .xlsx (SpreadsheetML) writer. The project ships only
// html2canvas / vue / supabase, so rather than pull in SheetJS (~1 MB) this builds
// a valid workbook by hand: a store-only ZIP (no compression, just CRC32) wrapping
// the handful of XML parts Excel needs. Enough features for a report sheet —
// inline strings (so Thai text survives without a shared-strings table), a fixed
// palette of cell styles, merged cells and frozen panes.
//
// Public API:
//   downloadXlsx(fileName, sheet)  — build + trigger a browser download
//   buildXlsxBlob(sheet)           — just the Blob (for tests / other callers)
//
// A `sheet` is { name, cols?, rows, merges?, freeze? } where
//   cols   : [{ width }]                — column widths (chars), left to right
//   rows   : [[cell, …], …]            — row-major grid; a cell is
//              null | string | number | { v, t?: 's'|'n', s?: styleId }
//   merges : ["A1:B2", …]              — merged ranges in A1 notation
//   freeze : { xSplit, ySplit }        — frozen columns / rows (counts)
//
// Style ids (the `s` on a cell) are the STYLE_* constants exported below.

// Bold/centred header band, plain bordered data cell, etc. — indices into the
// cellXfs list built in stylesXml(). Callers reference these instead of raw ints.
export const STYLE = {
  DEFAULT: 0,
  TITLE: 1, // big bold title, no border
  HEADER: 2, // bold, centred, grey fill, border, wraps
  AREA: 3, // bold row label, centred both axes, border
  LABEL: 4, // plain centred label, border
  NUM: 5, // centred number, border
  TOTAL_LABEL: 6, // bold label on total fill, border
  TOTAL_NUM: 7, // bold number on total fill, border
};

// ── CRC32 (for the ZIP entries) ────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// ── Store-only ZIP ──────────────────────────────────────────────────────────
// Growable little-endian byte buffer.
class ByteBuf {
  constructor() {
    this.a = [];
  }
  u16(v) {
    this.a.push(v & 0xff, (v >>> 8) & 0xff);
  }
  u32(v) {
    this.a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  }
  put(u8) {
    for (let i = 0; i < u8.length; i += 1) this.a.push(u8[i]);
  }
  get length() {
    return this.a.length;
  }
  done() {
    return Uint8Array.from(this.a);
  }
}

const enc = new TextEncoder();

// files: [{ name, data: Uint8Array }] → a Uint8Array of the whole .zip.
const zipStore = (files) => {
  const out = new ByteBuf();
  const central = [];
  files.forEach((f) => {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const offset = out.length;
    // Local file header
    out.u32(0x04034b50);
    out.u16(20); // version needed
    out.u16(0); // flags (filenames are ASCII → no UTF-8 flag needed)
    out.u16(0); // method: store
    out.u16(0); // mod time
    out.u16(0x21); // mod date (1980-01-01)
    out.u32(crc);
    out.u32(f.data.length); // compressed size (== uncompressed for store)
    out.u32(f.data.length);
    out.u16(nameBytes.length);
    out.u16(0); // extra len
    out.put(nameBytes);
    out.put(f.data);
    central.push({ nameBytes, crc, size: f.data.length, offset });
  });

  const cdStart = out.length;
  central.forEach((c) => {
    out.u32(0x02014b50);
    out.u16(20); // version made by
    out.u16(20); // version needed
    out.u16(0); // flags
    out.u16(0); // method
    out.u16(0); // mod time
    out.u16(0x21); // mod date
    out.u32(c.crc);
    out.u32(c.size);
    out.u32(c.size);
    out.u16(c.nameBytes.length);
    out.u16(0); // extra
    out.u16(0); // comment
    out.u16(0); // disk #
    out.u16(0); // internal attrs
    out.u32(0); // external attrs
    out.u32(c.offset);
    out.put(c.nameBytes);
  });
  const cdSize = out.length - cdStart;

  out.u32(0x06054b50);
  out.u16(0); // this disk
  out.u16(0); // disk w/ CD
  out.u16(central.length);
  out.u16(central.length);
  out.u32(cdSize);
  out.u32(cdStart);
  out.u16(0); // comment len
  return out.done();
};

// ── XML helpers ───────────────────────────────────────────────────────────
const xmlEsc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// 0-indexed row/col → "A1" style reference.
export const cellRef = (row, col) => {
  let c = col;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (c % 26)) + letters;
    c = Math.floor(c / 26) - 1;
  } while (c >= 0);
  return `${letters}${row + 1}`;
};

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const workbookXml = (sheetName) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

// rId1 MUST be the worksheet — workbook.xml's <sheet r:id="rId1"> resolves the
// sheet's content through this relationship. (Styles is rId2.) Getting this
// backwards leaves Excel with a named-but-empty sheet: it opens blank.
const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

// The fixed style palette referenced by STYLE.* above.
const stylesXml = () => {
  const align = (h, v, wrap) =>
    `<alignment horizontal="${h}" vertical="${v}"${wrap ? ' wrapText="1"' : ""}/>`;
  const xf = (fontId, fillId, borderId, alignment) =>
    `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
    `${fontId ? ' applyFont="1"' : ""}${fillId ? ' applyFill="1"' : ""}${borderId ? ' applyBorder="1"' : ""}` +
    `${alignment ? ' applyAlignment="1">' + alignment + "</xf>" : "/>"}`;
  const cellXfs = [
    xf(0, 0, 0, ""), // 0 DEFAULT
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>`, // 1 TITLE
    xf(1, 2, 1, align("center", "center", true)), // 2 HEADER
    xf(1, 0, 1, align("center", "center", false)), // 3 AREA
    xf(0, 0, 1, align("center", "center", false)), // 4 LABEL
    xf(0, 0, 1, align("center", "center", false)), // 5 NUM
    xf(1, 3, 1, align("center", "center", false)), // 6 TOTAL_LABEL
    xf(1, 3, 1, align("center", "center", false)), // 7 TOTAL_NUM
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDE7F0"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF9AA5B1"/></left><right style="thin"><color rgb="FF9AA5B1"/></right><top style="thin"><color rgb="FF9AA5B1"/></top><bottom style="thin"><color rgb="FF9AA5B1"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${cellXfs.length}">${cellXfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
};

// One <c> element for a cell value at (row, col).
const cellXml = (cell, row, col) => {
  if (cell == null || cell === "") return "";
  const ref = cellRef(row, col);
  let v = cell;
  let t;
  let s = 0;
  if (typeof cell === "object") {
    ({ v } = cell);
    t = cell.t;
    s = cell.s || 0;
  }
  if (v == null || v === "") {
    // Styled-but-empty cell (keeps borders/fill on blank grid squares).
    return s ? `<c r="${ref}" s="${s}"/>` : "";
  }
  const isNum = t === "n" || (t == null && typeof v === "number");
  const attrs = `r="${ref}"${s ? ` s="${s}"` : ""}`;
  if (isNum) return `<c ${attrs}><v>${v}</v></c>`;
  return `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
};

const sheetXml = (sheet) => {
  const { rows, cols = [], merges = [], freeze } = sheet;

  let views = '<sheetView workbookViewId="0"';
  if (freeze && (freeze.xSplit || freeze.ySplit)) {
    const topLeft = cellRef(freeze.ySplit || 0, freeze.xSplit || 0);
    views += `><pane xSplit="${freeze.xSplit || 0}" ySplit="${freeze.ySplit || 0}" topLeftCell="${topLeft}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="${topLeft}" sqref="${topLeft}"/></sheetView>`;
  } else {
    views += "/>";
  }

  let colsXml = "";
  if (cols.length) {
    colsXml =
      "<cols>" +
      cols
        .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 10}" customWidth="1"/>`)
        .join("") +
      "</cols>";
  }

  const body = rows
    .map((row, r) => {
      const cellsXml = row.map((cell, c) => cellXml(cell, r, c)).join("");
      return `<row r="${r + 1}">${cellsXml}</row>`;
    })
    .join("");

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews>${views}</sheetViews><sheetFormatPr defaultRowHeight="15"/>${colsXml}<sheetData>${body}</sheetData>${mergeXml}</worksheet>`;
};

// Referential-integrity guard for the assembled parts. A workbook where each XML
// part is *well-formed* can still open BLANK if the wiring is wrong: this exact
// class of bug (workbook.xml's <sheet r:id="…"> pointing at styles.xml instead of
// the worksheet) produces a named-but-empty sheet that plain XML validation can't
// see. So verify every sheet's r:id resolves — through workbook.xml.rels — to a
// worksheet part that actually exists and carries a <sheetData>. Throws loudly on
// a mismatch so a broken export fails visibly instead of shipping a blank file.
const dec = new TextDecoder();
export const validateWorkbookParts = (parts) => {
  const byName = Object.fromEntries(parts.map((p) => [p.name, dec.decode(p.data)]));
  const wb = byName["xl/workbook.xml"];
  const rels = byName["xl/_rels/workbook.xml.rels"];
  if (!wb || !rels) throw new Error("xlsx: missing workbook.xml or its .rels");

  // Parse the relationship table: Id -> { type, target } (attribute order-agnostic).
  const relById = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = m[0];
    const id = /Id="([^"]+)"/.exec(tag)?.[1];
    if (id) relById[id] = { type: /Type="([^"]+)"/.exec(tag)?.[1] || "", target: /Target="([^"]+)"/.exec(tag)?.[1] || "" };
  }

  const sheetRefs = [...wb.matchAll(/<sheet\b[^>]*\br:id="([^"]+)"/g)].map((m) => m[1]);
  if (!sheetRefs.length) throw new Error("xlsx: workbook.xml declares no sheets");
  sheetRefs.forEach((rid) => {
    const rel = relById[rid];
    if (!rel) throw new Error(`xlsx: sheet r:id="${rid}" has no matching relationship`);
    if (!rel.type.endsWith("/worksheet")) throw new Error(`xlsx: sheet r:id="${rid}" resolves to ${rel.type || "(none)"}, not a worksheet`);
    const partName = `xl/${rel.target.replace(/^\/*/, "")}`;
    const xml = byName[partName];
    if (!xml) throw new Error(`xlsx: worksheet part "${partName}" is missing`);
    if (!xml.includes("<sheetData")) throw new Error(`xlsx: worksheet part "${partName}" has no <sheetData>`);
  });
};

// Assemble the workbook parts into a store-only ZIP and return it as a Blob.
export const buildXlsxBlob = (sheet) => {
  const parts = [
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS) },
    { name: "xl/workbook.xml", data: enc.encode(workbookXml(sheet.name || "Sheet1")) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(WORKBOOK_RELS) },
    { name: "xl/styles.xml", data: enc.encode(stylesXml()) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml(sheet)) },
  ];
  validateWorkbookParts(parts); // fail loudly on a broken workbook, never ship a blank one
  return new Blob([zipStore(parts)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
};

export const downloadXlsx = (fileName, sheet) => {
  const blob = buildXlsxBlob(sheet);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = fileName;
  link.href = url;
  link.click();
  // Revoke on the next tick so the click's navigation has taken the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
