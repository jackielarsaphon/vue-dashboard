import { reactive, ref } from "vue";

// Per-page selection slots. Each page (fleet / area / entry / …) keeps its OWN
// date/shift/hour, so changing the selector on one page does NOT move the others.
const LS_KEY = "prod-shift-selection-v2";

// selection.date is yyyy-mm-dd (matches <input type="date">).
const todayIso = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const defaults = () => ({ date: todayIso(), shiftType: "Night", hour: new Date().getHours() });

// Saved per-page values: { [pageKey]: { date, shiftType, hour } }.
const loadSlots = () => {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
};

const slots = loadSlots();

// The ACTIVE selection — one STABLE reactive object that every composable reads
// and watches (useEntryStore, usePlanProduction, …). Its contents are swapped to
// the current page's slot on activation, so those `watch(() => selection.date)`
// reload data when you switch pages. The reference never changes.
const selection = reactive(defaults());
const userAdjusted = ref(false);

// Whether the user hand-picked on a given page (stops that page auto-following the
// clock). Per page, and — like before — NOT persisted: a fresh load follows the
// clock again. Only the chosen date/shift/hour are remembered across reloads.
const adjustedByPage = {};

let activeKey = null;

const persist = () => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(slots));
  } catch (error) {
    // Saving is best effort for embedded contexts.
  }
};

// Make pageKey's slot the active selection. Creates a default slot the first time
// a page is seen. Called by TopBar whenever the route changes.
const setActivePage = (pageKey) => {
  if (!pageKey || pageKey === activeKey) return;
  activeKey = pageKey;
  const slot = slots[pageKey] || (slots[pageKey] = defaults());
  selection.date = slot.date;
  selection.shiftType = slot.shiftType === "Day" ? "Day" : "Night";
  selection.hour = Number.isInteger(slot.hour) ? slot.hour : new Date().getHours();
  userAdjusted.value = !!adjustedByPage[pageKey];
};

// Mirror the active selection back into its page slot so it survives navigation
// and reloads.
const writeSlot = () => {
  if (!activeKey) return;
  slots[activeKey] = { date: selection.date, shiftType: selection.shiftType, hour: selection.hour };
  persist();
};

export const useShiftSelection = () => {
  const setDate = (iso) => {
    selection.date = iso;
    writeSlot();
  };

  const setShiftType = (value) => {
    selection.shiftType = value === "Day" ? "Day" : "Night";
    writeSlot();
  };

  const setHour = (value) => {
    selection.hour = Math.min(23, Math.max(0, Number(value) || 0));
    writeSlot();
  };

  const markUserAdjusted = () => {
    userAdjusted.value = true;
    if (activeKey) adjustedByPage[activeKey] = true;
  };

  return { selection, setDate, setShiftType, setHour, userAdjusted, markUserAdjusted, setActivePage };
};
