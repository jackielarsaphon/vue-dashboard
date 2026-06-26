import { reactive } from "vue";

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

  return { selection, setDate, setShiftType, setHour };
};
