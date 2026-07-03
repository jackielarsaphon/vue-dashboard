import { reactive, ref } from "vue";

// Per-page selection slots for SHIFT and HOUR. Each page (fleet / area / entry)
// keeps its OWN shift/hour, so changing those on one page does NOT move the others.
//
// The DATE is the deliberate exception: it is a single SHARED value across every
// page, so picking a date on any page moves them all. See [[selection-per-page]]
// — shift/hour stay decoupled; only the date is coupled.
const LS_KEY = "prod-shift-selection-v2";
const DATE_KEY = "prod-shared-date-v1";

// selection.date is yyyy-mm-dd (matches <input type="date">).
const todayIso = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const defaults = () => ({ date: todayIso(), shiftType: "Night", hour: new Date().getHours() });

// Saved per-page values: { [pageKey]: { date, shiftType, hour } }. Only shiftType
// and hour are read back per page; date is driven by the shared value below.
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

// The shared date, restored across reloads (falls back to today).
const loadSharedDate = () => {
  if (typeof localStorage === "undefined") return todayIso();
  try {
    const raw = localStorage.getItem(DATE_KEY);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw || "") ? raw : todayIso();
  } catch (error) {
    return todayIso();
  }
};

const slots = loadSlots();

// The single shared date — the source of truth for selection.date on every page.
let sharedDate = loadSharedDate();

// The ACTIVE selection — one STABLE reactive object that every composable reads
// and watches (useEntryStore, usePlanProduction, …). Its shift/hour are swapped to
// the current page's slot on activation; its date always mirrors the shared date.
// The reference never changes.
const selection = reactive(defaults());
selection.date = sharedDate;

// userAdjusted: whether the user hand-picked SHIFT/HOUR on a given page (stops that
// page auto-following the clock). Per page, and NOT persisted: a fresh load follows
// the clock again.
const userAdjusted = ref(false);
// dateAdjusted: whether the user hand-picked the DATE. GLOBAL (the date is shared),
// and — like userAdjusted — NOT persisted, so a fresh load follows the clock again.
const dateAdjusted = ref(false);

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

const persistDate = () => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DATE_KEY, sharedDate);
  } catch (error) {
    // Saving is best effort for embedded contexts.
  }
};

// Make pageKey's slot the active selection. Creates a default slot the first time
// a page is seen. Called by TopBar whenever the route changes. Shift/hour come from
// the page's slot; the date is the shared value, so it carries across pages.
const setActivePage = (pageKey) => {
  if (!pageKey || pageKey === activeKey) return;
  activeKey = pageKey;
  const slot = slots[pageKey] || (slots[pageKey] = defaults());
  selection.date = sharedDate;
  selection.shiftType = slot.shiftType === "Day" ? "Day" : "Night";
  selection.hour = Number.isInteger(slot.hour) ? slot.hour : new Date().getHours();
  userAdjusted.value = !!adjustedByPage[pageKey];
};

// Mirror the active selection back into its page slot so shift/hour survive
// navigation and reloads. (slot.date is kept in sync but the shared date leads.)
const writeSlot = () => {
  if (!activeKey) return;
  slots[activeKey] = { date: sharedDate, shiftType: selection.shiftType, hour: selection.hour };
  persist();
};

export const useShiftSelection = () => {
  const setDate = (iso) => {
    sharedDate = iso;
    selection.date = iso;
    persistDate();
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

  // The date is shared, so its "hand-picked" state is global too.
  const markDateAdjusted = () => {
    dateAdjusted.value = true;
  };

  return {
    selection,
    setDate,
    setShiftType,
    setHour,
    userAdjusted,
    dateAdjusted,
    markUserAdjusted,
    markDateAdjusted,
    setActivePage,
  };
};
