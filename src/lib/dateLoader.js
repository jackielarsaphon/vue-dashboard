// Per-date load bookkeeping, shared by every store that fetches on the selected
// DATE (entries / plans / rainfall / targets).
//
// Why: five singleton stores each watch selection.date, and each used to re-run its
// whole query set on every change — including flipping BACK to a date it had already
// loaded a second earlier. Since those stores keep their data keyed by date, a date
// already in memory needs no query at all. This tracks that, and:
//
//   • dedupes concurrent requests for the same date (one query set, not two),
//   • serves a loaded date from memory — the page paints with no round trip,
//   • revalidates in the background once the cached copy is older than staleMs, so
//     a date left open still picks up what another device keyed,
//   • evicts the least-recently-used dates (keep) and hands them to onEvict, so
//     browsing a month of history doesn't grow the caches without bound,
//   • exposes isCurrent(date) so a slow response for an abandoned date can be
//     dropped instead of overwriting the date now on screen.
//
// Pure bookkeeping — no Vue, no Supabase — so it can be exercised on its own.

export const createDateLoader = ({ load, onEvict, keep = 6, staleMs = 30000, now = () => Date.now() }) => {
  // date -> timestamp of the last successful load. Re-inserted on every request so
  // the key order is least-recently-used first.
  const loadedAt = new Map();
  const inflight = new Map();
  let latest = null;

  const touch = (date) => {
    loadedAt.delete(date);
    loadedAt.set(date, now());
    while (loadedAt.size > keep) {
      const oldest = loadedAt.keys().next().value;
      if (oldest === latest) break; // never drop the date on screen
      loadedAt.delete(oldest);
      onEvict?.(oldest);
    }
  };

  const run = (date) => {
    const promise = Promise.resolve()
      .then(() => load(date))
      .then(() => {
        touch(date);
      })
      .finally(() => {
        if (inflight.get(date) === promise) inflight.delete(date);
      });
    inflight.set(date, promise);
    return promise;
  };

  return {
    // Ensure `date` is loaded. Resolves immediately when it already is.
    request(date, { force = false } = {}) {
      if (!date) return Promise.resolve();
      latest = date;
      if (force) return run(date);

      const pending = inflight.get(date);
      if (pending) return pending;

      const at = loadedAt.get(date);
      if (at == null) return run(date);

      touch(date);
      // Cached: the caller does not wait. Refresh behind the screen if it has gone stale.
      if (now() - at >= staleMs) run(date).catch(() => {});
      return Promise.resolve();
    },

    // False once the user has moved on to another date — the caller should drop
    // its result rather than overwrite what is now on screen.
    isCurrent: (date) => date === latest,

    // Already in memory? The range preload uses this to skip a date the store has
    // loaded, so a batch that arrives while the user is keying data can never
    // overwrite what is on screen.
    isLoaded: (date) => loadedAt.has(date),

    // Record a date the store filled from a RANGE query rather than through load().
    markLoaded(date) {
      if (date) touch(date);
    },

    // Forget a date without touching the store's data (next request re-queries).
    invalidate(date) {
      loadedAt.delete(date);
      inflight.delete(date);
    },

    loadedDates: () => [...loadedAt.keys()],
  };
};
