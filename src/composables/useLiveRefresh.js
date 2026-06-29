import { onMounted, onUnmounted } from "vue";

// Keep an open dashboard in sync with data entered elsewhere (e.g. on a phone)
// without a manual page reload. There is no realtime channel, and the stores
// only fetch on mount / date change, so an already-open PC would otherwise keep
// showing the snapshot it loaded. We re-fetch:
//   • when the tab becomes visible or regains focus (you switch back to the PC), and
//   • on a periodic timer (for a passive wall display nobody touches).
//
// `reloaders` is one async reload fn or a list of them — pass only the stores a
// page actually needs so we don't over-fetch. Returns { refresh } for manual use.
export function useLiveRefresh(reloaders, { intervalMs = 30000 } = {}) {
  const list = (Array.isArray(reloaders) ? reloaders : [reloaders]).filter(Boolean);

  const refresh = () => {
    list.forEach((fn) => {
      try {
        fn();
      } catch {
        // A transient fetch error shouldn't kill the timer / listeners.
      }
    });
  };

  const onVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") refresh();
  };

  let timer = 0;
  onMounted(() => {
    if (typeof window === "undefined") return;
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    if (intervalMs > 0) timer = window.setInterval(refresh, intervalMs);
  });
  onUnmounted(() => {
    if (typeof window === "undefined") return;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", refresh);
    if (timer) window.clearInterval(timer);
  });

  return { refresh };
}
