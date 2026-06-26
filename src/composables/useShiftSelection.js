import { reactive, ref } from "vue";

const LS_KEY = "prod-shift-selection-v1";

// selection.date is yyyy-mm-dd (matches <input type="date">).
const todayIso = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const load = () => {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
};

const saved = load();
const selection = reactive({
  date: saved?.date || todayIso(),
  shiftType: saved?.shiftType === "Day" ? "Day" : "Night",
  hour: Number.isInteger(saved?.hour) ? saved.hour : new Date().getHours(),
});

// True once the user manually picks a date/shift/hour. Module-level (a shared
// singleton, not a component-local ref) so it survives TopBar being re-mounted
// on every page change — that's what keeps a hand-picked date from snapping
// back to "now" when you navigate. Deliberately NOT persisted: a fresh page
// load starts following the clock again ("the UI changes it itself").
const userAdjusted = ref(false);

const persist = () => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(selection));
  } catch (error) {
    // Saving is best effort for embedded contexts.
  }
};

export const useShiftSelection = () => {
  const setDate = (iso) => {
    selection.date = iso;
    persist();
  };

  const setShiftType = (value) => {
    selection.shiftType = value === "Day" ? "Day" : "Night";
    persist();
  };

  const setHour = (value) => {
    selection.hour = Math.min(23, Math.max(0, Number(value) || 0));
    persist();
  };

  const markUserAdjusted = () => {
    userAdjusted.value = true;
  };

  return { selection, setDate, setShiftType, setHour, userAdjusted, markUserAdjusted };
};
