import { onMounted, onUnmounted, ref } from "vue";

// Phone-width breakpoint. Kept in sync with the ≤640px CSS in entry.css that
// switches Data entry to its stacked, trips-only mobile layout.
const QUERY = "(max-width: 640px)";

// Non-reactive check for places without a component lifecycle (e.g. the router
// navigation guard, which re-runs on every navigation anyway).
export const isMobileViewport = () => typeof window !== "undefined" && window.matchMedia(QUERY).matches;

// Reactive flag for components: true on phone-width viewports, updates live on
// resize / orientation change.
export function useIsMobile() {
  const isMobile = ref(isMobileViewport());
  let mql;
  const update = (event) => {
    isMobile.value = event.matches;
  };
  onMounted(() => {
    if (typeof window === "undefined") return;
    mql = window.matchMedia(QUERY);
    isMobile.value = mql.matches;
    mql.addEventListener("change", update);
  });
  onUnmounted(() => {
    if (mql) mql.removeEventListener("change", update);
  });
  return { isMobile };
}
