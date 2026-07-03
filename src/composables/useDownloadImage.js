import { ref } from "vue";
import html2canvas from "html2canvas";

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
