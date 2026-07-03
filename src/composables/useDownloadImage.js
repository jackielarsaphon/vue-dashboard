import { ref } from "vue";
import html2canvas from "html2canvas";

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

// Capture a whole dashboard page as one PNG. html2canvas rasterises the live DOM
// (so theme CSS variables, fonts and layout match the screen), skipping anything
// marked .no-capture (the toolbar button) or the floating .twk-panel.
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
      // Make sure web fonts are ready so text doesn't fall back in the capture.
      if (document.fonts?.ready) await document.fonts.ready;
      const rootStyles = getComputedStyle(document.documentElement);
      const bg = rootStyles.getPropertyValue("--bg").trim() || getComputedStyle(document.body).backgroundColor || "#ffffff";
      // Render at ~4K width for a crisp export: scale so the output is at least 3840px
      // wide whatever the screen size, capped at 4× to keep memory sane and never below
      // the 2× we used before.
      const scale = Math.min(4, Math.max(2, 3840 / (node.scrollWidth || 3840)));
      const canvas = await html2canvas(node, {
        backgroundColor: bg,
        scale,
        useCORS: true,
        logging: false,
        windowWidth: node.scrollWidth,
        ignoreElements: (el) => el.classList?.contains("no-capture") || el.classList?.contains("twk-panel"),
        onclone: (clonedDoc) => stripUnsupportedColorFns(clonedDoc),
      });
      const link = document.createElement("a");
      link.download = typeof fileName === "function" ? fileName() : fileName;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (err) {
      console.error("Download image failed", err);
    } finally {
      downloading.value = false;
    }
  };

  return { dashRef, downloading, downloadImage };
}
