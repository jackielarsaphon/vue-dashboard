import { ref } from "vue";
import html2canvas from "html2canvas";
import logoUrl from "../assets/thaidrill-logo.png";

// html2canvas' colour parser doesn't understand the CSS color() function, which
// modern browsers emit when serialising color-mix(in srgb, …) — see area.css /
// base.css. color-mix(in srgb, …) always computes to `color(srgb r g b[ / a])`
// with r/g/b in 0..1, so convert that back into an rgba() the parser accepts.
// Returns null for anything that isn't an srgb color() value.
const colorFnToRgba = (value) => {
  const m = /^color\(\s*srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)(?:\s*\/\s*([\d.eE+%-]+))?\s*\)$/i.exec(
    String(value).trim(),
  );
  if (!m) return null;
  const chan = (x) => Math.max(0, Math.min(255, Math.round(parseFloat(x) * 255)));
  let a = 1;
  if (m[4] != null) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  a = Math.max(0, Math.min(1, Number.isFinite(a) ? a : 1));
  return `rgba(${chan(m[1])}, ${chan(m[2])}, ${chan(m[3])}, ${a})`;
};

// Rewrite any color()-based computed colour on the cloned DOM into rgba(), so
// html2canvas never sees the function it can't parse. Runs on the clone only, so
// the on-screen UI (and its theming) is untouched.
const COLOR_PROPS = [
  "color",
  "backgroundColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "outlineColor",
  "textDecorationColor",
  "columnRuleColor",
  "caretColor",
  "fill",
  "stroke",
];

const stripUnsupportedColorFns = (clonedDoc) => {
  const view = clonedDoc.defaultView || window;
  clonedDoc.querySelectorAll("*").forEach((el) => {
    let cs;
    try {
      cs = view.getComputedStyle(el);
    } catch (err) {
      return;
    }
    if (!cs) return;
    for (const prop of COLOR_PROPS) {
      const value = cs[prop];
      if (value && value.indexOf("color(") !== -1) {
        const rgba = colorFnToRgba(value);
        if (rgba) el.style[prop] = rgba;
      }
    }
  });
};

// The ThaiDrill logo, loaded once per export. Resolves to null if the asset is
// missing so a failed load never blocks the download.
const loadLogo = () =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = logoUrl;
  });

// A page can host its own export-only logo (an .export-logo element, hidden on
// screen and revealed on the clone) when its top row has empty space to fill.
// That keeps the mark inside the layout instead of adding a band above it.
const findInlineLogos = (root) => root.querySelectorAll(".export-logo");

const revealInlineLogos = (clonedDoc) => {
  findInlineLogos(clonedDoc).forEach((el) => {
    el.style.display = "block";
  });
};

const CAPTURE_ROOT_ATTR = "data-image-capture-root";

// The Rainfall report may contain a no-wrap Remark plus a horizontally growing
// chart. Measure both columns before cloning so the export canvas can be widened
// enough to contain them side by side instead of clipping either scroll region.
const fullReportWidth = (node) => {
  let width = Math.max(node.clientWidth, node.scrollWidth);
  node.querySelectorAll(".rr-pit-body").forEach((body) => {
    const table = body.querySelector("table.rr-table");
    const chart = body.querySelector(".rr-chart");
    const tableWidth = table ? table.scrollWidth : 0;
    const chartWidth = chart ? chart.scrollWidth : 0;
    // Allow for the pit padding, the table/chart gap and their panel borders.
    width = Math.max(width, tableWidth + chartWidth + 96);
  });
  return Math.ceil(width);
};

// A horizontally scrollable report table can be left partway across by the user.
// html2canvas copies that scroll position into its cloned document, which would cut
// the Period column off the exported image. Keep the cloned table at its full
// content width so every column and the one-line Remark remain in the capture.
const showFullReportContent = (clonedDoc, captureWidth) => {
  const root = clonedDoc.querySelector(`[${CAPTURE_ROOT_ATTR}]`);
  if (root) {
    root.style.width = `${captureWidth}px`;
    root.style.maxWidth = "none";
    root.style.overflow = "visible";
  }
  clonedDoc.querySelectorAll(".rr-pit-body").forEach((el) => {
    el.style.gridTemplateColumns = "max-content minmax(560px, 1fr)";
  });
  clonedDoc.querySelectorAll(".rr-table-wrap").forEach((el) => {
    el.scrollLeft = 0;
    el.style.overflowX = "visible";
    el.style.width = "max-content";
    el.style.maxWidth = "none";
  });
  clonedDoc.querySelectorAll("table.rr-table").forEach((el) => {
    el.style.width = "max-content";
    el.style.minWidth = "100%";
    el.style.maxWidth = "none";
  });
  clonedDoc.querySelectorAll(".rr-chart-scroll").forEach((el) => {
    el.scrollLeft = 0;
    el.style.overflowX = "visible";
    el.style.maxWidth = "none";
  });
};

// Stamp the company logo above the capture for pages with no room for it inline.
// Sizes are relative to the canvas width, so the band scales with the export
// resolution; the logo sits right on top of the content with only a thin gutter
// above it. Returns a new canvas, or the original untouched if the logo couldn't
// load.
const withLogoBand = async (canvas, bg) => {
  const logo = await loadLogo();
  if (!logo || !logo.width || !logo.height) return canvas;
  const pad = Math.round(canvas.width * 0.008);
  const logoWidth = Math.round(canvas.width * 0.13);
  const logoHeight = Math.round(logoWidth * (logo.height / logo.width));
  // No padding under the logo — the captured page opens with its own gutter.
  const bandHeight = logoHeight + pad;
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height + bandHeight;
  const ctx = out.getContext("2d");
  if (!ctx) return canvas;
  // Paint the page background behind the band so the transparent logo sits on
  // the same colour as the capture below it (light or dark theme).
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, out.width, bandHeight);
  ctx.drawImage(logo, pad, pad, logoWidth, logoHeight);
  ctx.drawImage(canvas, 0, bandHeight);
  return out;
};

// Capture a whole dashboard page as one PNG. html2canvas rasterises the live DOM
// (so theme CSS variables, fonts and layout match the screen), skipping anything
// marked .no-capture (the toolbar button) or the floating .twk-panel. The saved
// PNG always carries the ThaiDrill logo: from the page's own .export-logo slot
// when it has one, otherwise from a slim band stamped above the capture.
//
// Usage: const { dashRef, downloading, downloadImage } = useDownloadImage(() => `foo-${date}.png`);
// Bind ref="dashRef" on the page's root .dash element. `fileName` may be a string
// or a function evaluated at click time (so it can read the current selection).
export function useDownloadImage(fileName) {
  const dashRef = ref(null);
  const downloading = ref(false);

  const downloadImage = async () => {
    const node = dashRef.value;
    if (!node || downloading.value) return;
    downloading.value = true;
    try {
      // Make sure web fonts are ready so text doesn't fall back in the capture,
      // and the logo is in cache before html2canvas asks the clone for it.
      if (document.fonts?.ready) await document.fonts.ready;
      await loadLogo();
      // The inline slot sits beside centred content, so it only has room on a
      // wide layout — on a phone fall back to the band above the capture.
      const inlineLogo = node.scrollWidth >= 560 && findInlineLogos(node).length > 0;
      const rootStyles = getComputedStyle(document.documentElement);
      const bg = rootStyles.getPropertyValue("--bg").trim() || getComputedStyle(document.body).backgroundColor || "#ffffff";
      const captureWidth = fullReportWidth(node);
      node.setAttribute(CAPTURE_ROOT_ATTR, "");
      // Render at ~4K width for a crisp export: scale so the output is at least 3840px
      // wide where practical. Very wide no-wrap remarks use a lower scale so the
      // complete canvas stays within a reasonable memory footprint.
      const scale = Math.min(4, Math.max(1, 3840 / (captureWidth || 3840)));
      const canvas = await html2canvas(node, {
        backgroundColor: bg,
        scale,
        useCORS: true,
        logging: false,
        width: captureWidth,
        windowWidth: captureWidth,
        ignoreElements: (el) => el.classList?.contains("no-capture") || el.classList?.contains("twk-panel"),
        onclone: (clonedDoc) => {
          stripUnsupportedColorFns(clonedDoc);
          showFullReportContent(clonedDoc, captureWidth);
          if (inlineLogo) revealInlineLogos(clonedDoc);
        },
      });
      const branded = inlineLogo ? canvas : await withLogoBand(canvas, bg);
      const link = document.createElement("a");
      link.download = typeof fileName === "function" ? fileName() : fileName;
      link.href = branded.toDataURL("image/png");
      link.click();
    } catch (err) {
      console.error("Download image failed", err);
    } finally {
      node.removeAttribute(CAPTURE_ROOT_ATTR);
      downloading.value = false;
    }
  };

  return { dashRef, downloading, downloadImage };
}
