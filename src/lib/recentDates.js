// How many days the app pulls in ONE batch when it opens (see usePreloadDates.js).
//
// Measured on a full production day — the date-scoped tables come to roughly 120 KB
// of JSON per date (gzipped on the wire, so ~20 KB), so a week is a small download
// that buys a zero-query date picker for the range people actually browse. Older
// dates still load on demand, one date at a time.
export const PRELOAD_DAYS = 7;

const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// The PRELOAD_DAYS operational dates ending at `endDate` (default: today), oldest
// first. Anchored on the production shift_date, so before 06:00 the current
// operational day is still yesterday — the same rule the top bar uses.
export const recentDates = (endDate, days = PRELOAD_DAYS) => {
  const end = endDate ? new Date(`${endDate}T00:00:00`) : operationalToday();
  const out = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const d = new Date(end);
    d.setDate(d.getDate() - back);
    out.push(toIso(d));
  }
  return out;
};

export const operationalToday = (now = new Date()) => {
  const d = new Date(now);
  if (d.getHours() <= 5) d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
};
