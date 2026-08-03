import { supabase } from "../lib/supabaseClient.js";

// The public.shifts rows for one calendar date — [{ id, shift_type }] — fetched ONCE
// per date and shared by every date-scoped store.
//
// Before this, useEntryStore, usePlanProduction, useRainfallLog, useAreaTargets and
// useKpiTargets each opened with the SAME "shifts for this date" query, so a date
// change spent five identical round trips before any of them could ask for its own
// table. Now the first caller queries and the others await that one promise.
//
// Every shift_id in the app comes from here, so a row created by
// getOrCreateShiftId is folded straight back in (rememberShift) rather than
// invalidating the date and re-querying.

const byDate = new Map(); // date -> [{ id, shift_type }]
const inflight = new Map(); // date -> Promise<[{ id, shift_type }]>

export const shiftsForDate = (date, { force = false } = {}) => {
  if (!date) return Promise.resolve([]);
  if (!force) {
    const cached = byDate.get(date);
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(date);
    if (pending) return pending;
  }

  const promise = Promise.resolve(supabase.from("shifts").select("id, shift_type").eq("shift_date", date))
    .then(({ data, error }) => {
      // A failed lookup is not cached — the next caller retries instead of being
      // stuck with an empty date for the session.
      if (error) return [];
      const rows = data || [];
      byDate.set(date, rows);
      return rows;
    })
    .catch(() => [])
    .finally(() => {
      if (inflight.get(date) === promise) inflight.delete(date);
    });

  inflight.set(date, promise);
  return promise;
};

// Every shifts row between two dates (inclusive) in ONE query, cached per date so the
// per-date lookups above then cost nothing. Backs the opening batch load: see
// usePreloadDates.js. The five stores all preload the SAME window, so identical spans
// requested at the same time share one query.
const inflightRanges = new Map(); // "from..to" -> Promise<Map<date, rows>>

export const shiftsForRange = (fromDate, toDate, dates = []) => {
  const rangeKey = `${fromDate}..${toDate}`;
  const pending = inflightRanges.get(rangeKey);
  if (pending) return pending;

  const promise = Promise.resolve(
    supabase.from("shifts").select("id, shift_type, shift_date").gte("shift_date", fromDate).lte("shift_date", toDate),
  )
    .then(({ data, error }) => {
      if (error) return new Map();

      const grouped = new Map();
      // Seed every requested date, so a date with no shifts yet is known-empty rather
      // than re-queried one at a time later.
      dates.forEach((date) => grouped.set(date, []));
      (data || []).forEach((row) => {
        const list = grouped.get(row.shift_date) || [];
        list.push({ id: row.id, shift_type: row.shift_type });
        grouped.set(row.shift_date, list);
      });
      grouped.forEach((rows, date) => byDate.set(date, rows));
      return grouped;
    })
    .catch(() => new Map())
    .finally(() => {
      if (inflightRanges.get(rangeKey) === promise) inflightRanges.delete(rangeKey);
    });

  inflightRanges.set(rangeKey, promise);
  return promise;
};

// Fold a just-created (or just-read) shift row into the date's cache.
export const rememberShift = (date, shiftType, id) => {
  if (!date || !id) return;
  const rows = byDate.get(date);
  if (!rows) return; // nothing cached yet — the next fetch will pick the row up
  if (rows.some((row) => row.id === id)) return;
  byDate.set(date, [...rows, { id, shift_type: shiftType }]);
};

export const forgetShiftsForDate = (date) => {
  byDate.delete(date);
  inflight.delete(date);
};

// Convenience for the stores: { [id]: shift_type } plus the id list.
export const shiftIndexForDate = async (date, options) => {
  const rows = await shiftsForDate(date, options);
  return {
    rows,
    ids: rows.map((row) => row.id),
    typeById: Object.fromEntries(rows.map((row) => [row.id, row.shift_type])),
  };
};

// The same index over SEVERAL dates: one shifts query for the whole span, plus the
// per-shift date so a batched result can be split back out per date.
export const shiftIndexForDates = async (dates) => {
  const list = [...dates].sort();
  // Only ask for what isn't cached: the first store to preload a window fills the
  // cache for all of it, so the other four spend no query here.
  const missing = list.filter((date) => !byDate.has(date));
  if (missing.length > 1) await shiftsForRange(missing[0], missing[missing.length - 1], missing);

  const ids = [];
  const typeById = {};
  const dateById = {};
  for (const date of list) {
    const rows = byDate.get(date) || (await shiftsForDate(date));
    rows.forEach((row) => {
      ids.push(row.id);
      typeById[row.id] = row.shift_type;
      dateById[row.id] = date;
    });
  }
  return { dates: list, ids, typeById, dateById };
};
