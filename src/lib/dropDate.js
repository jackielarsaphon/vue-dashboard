// The date-scoped stores key their caches by "<date>_…" ("2026-08-02_Day_14",
// "2026-08-02_Night"). Since a date is now kept in memory after it is loaded (see
// dateLoader.js), replacing a whole cache would throw away the other dates — so a
// re-read drops just the keys of the date it re-read, then merges the fresh ones:
//
//   entriesByKey.value = { ...dropDate(entriesByKey.value, date), ...fresh }
//
// That keeps the old "the server is the truth for this date" behaviour (a row deleted
// elsewhere disappears) while leaving the neighbouring dates cached.
//
// Dates are fixed-width yyyy-mm-dd, so the "<date>_" prefix is unambiguous.
export const dropDate = (map, date) => {
  if (!map || !date) return map || {};
  const prefix = `${date}_`;
  const out = {};
  Object.keys(map).forEach((key) => {
    if (!key.startsWith(prefix)) out[key] = map[key];
  });
  return out;
};

export const dropDates = (map, dates) => (dates || []).reduce((acc, date) => dropDate(acc, date), map || {});

// The opposite: only the keys belonging to `dates`. A batched (multi-date) fetch
// builds one set of keys for the whole span, then commits the slice per date.
export const keepDates = (map, dates) => {
  const prefixes = (dates || []).map((date) => `${date}_`);
  const out = {};
  Object.keys(map || {}).forEach((key) => {
    if (prefixes.some((prefix) => key.startsWith(prefix))) out[key] = map[key];
  });
  return out;
};
