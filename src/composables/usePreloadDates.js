import { PRELOAD_DAYS, recentDates } from "../lib/recentDates.js";
import { useEntryStore } from "./useEntryStore.js";
import { usePlanProduction } from "./usePlanProduction.js";
import { useRainfallLog } from "./useRainfallLog.js";
import { useAreaTargets } from "./useAreaTargets.js";
import { useKpiTargets } from "./useKpiTargets.js";

// ONE batch load when the app opens: the last PRELOAD_DAYS operational days, fetched
// as a single wave of range queries (one per table for the whole span) instead of a
// fresh set every time the date changes. After it lands, moving the date picker
// anywhere inside that window costs no round trip at all.
//
// Ordering matters:
//   • the selected date loads first, through the normal per-date path, so the page
//     paints as soon as its own data is in — the batch never delays first paint;
//   • the batch then fills the REST of the window and skips any date already in
//     memory (skipLoaded), so it can never write over the date on screen or undo
//     trips being keyed while it is in flight.
//
// Dates outside the window still load one at a time, on demand.

let started = false;

export const preloadRecentDates = async () => {
  if (started) return;
  started = true;

  const dates = recentDates();
  const stores = [useEntryStore(), usePlanProduction(), useRainfallLog(), useAreaTargets(), useKpiTargets()];

  // Each store's own batch is one wave; run the five concurrently. Failures are
  // non-fatal — the per-date path still covers anything the batch missed.
  await Promise.all(
    stores.map((store) =>
      Promise.resolve()
        .then(() => store.preloadDates(dates))
        .catch(() => {}),
    ),
  );
};

// Give the current date's own fetch a head start, then batch the window.
export const schedulePreload = (delayMs = 1200) => {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    preloadRecentDates();
  }, delayMs);
};

export { PRELOAD_DAYS, recentDates };
