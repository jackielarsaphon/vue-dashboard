// Minimal in-memory stand-in for the supabase-js client, implementing only the
// PostgREST query-builder surface this app uses:
//   from(table).select(cols).eq/in/match(...).order(...).single()/maybeSingle()
//   from(table).insert(payload).select().single()
//   from(table).update(payload).eq(...).select().single()
//   from(table).delete().eq(...)/.match(...)
//   from(table).upsert(payload, { onConflict })
// Every builder is awaitable (thenable) and resolves to { data, error }, just
// like the real client. Data lives in the buildDemoStore() map (see demoData.js)
// for the lifetime of the page, so edits persist until reload.

import { buildDemoStore } from "./demoData.js";

const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`);
const nowIso = () => new Date().toISOString();

// Tables that carry an updated_at column refreshed on write.
const TOUCH_UPDATED_AT = new Set(["users", "excavators", "production_entries", "production_plans", "truck_model_factors"]);

const withInsertDefaults = (table, row) => {
  const out = { ...row };
  if (out.id === undefined) out.id = uuid();
  if (out.created_at === undefined) out.created_at = nowIso();
  if (TOUCH_UPDATED_AT.has(table) && out.updated_at === undefined) out.updated_at = nowIso();
  return out;
};

const matchesFilters = (row, filters) =>
  filters.every((f) => {
    if (f.type === "eq") return row[f.col] === f.val;
    if (f.type === "in") return f.vals.includes(row[f.col]);
    if (f.type === "match") return Object.entries(f.obj).every(([k, v]) => row[k] === v);
    return true;
  });

class QueryBuilder {
  constructor(store, table) {
    this._store = store;
    this._table = table;
    this._op = "select";
    this._payload = null;
    this._filters = [];
    this._order = null;
    this._single = false;
    this._returning = false;
    this._onConflict = null;
  }

  // --- operations ---
  select(_cols) {
    if (this._op === "select") this._op = "select";
    this._returning = true; // after insert/update, .select() asks for the rows back
    return this;
  }
  insert(payload) {
    this._op = "insert";
    this._payload = payload;
    return this;
  }
  update(payload) {
    this._op = "update";
    this._payload = payload;
    return this;
  }
  delete() {
    this._op = "delete";
    return this;
  }
  upsert(payload, opts = {}) {
    this._op = "upsert";
    this._payload = payload;
    this._onConflict = opts.onConflict || null;
    return this;
  }

  // --- filters ---
  eq(col, val) {
    this._filters.push({ type: "eq", col, val });
    return this;
  }
  in(col, vals) {
    this._filters.push({ type: "in", col, vals });
    return this;
  }
  match(obj) {
    this._filters.push({ type: "match", obj });
    return this;
  }
  order(col, opts = {}) {
    this._order = { col, ascending: opts.ascending !== false };
    return this;
  }

  // --- terminators ---
  single() {
    this._single = true;
    this._returning = true;
    return this;
  }
  maybeSingle() {
    this._single = true;
    this._returning = true;
    return this;
  }

  _rows() {
    return this._store[this._table] || (this._store[this._table] = []);
  }

  _result(rows) {
    if (this._single) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }

  _run() {
    const rows = this._rows();

    if (this._op === "select") {
      let out = rows.filter((r) => matchesFilters(r, this._filters));
      if (this._order) {
        const { col, ascending } = this._order;
        out = [...out].sort((a, b) => {
          const x = a[col];
          const y = b[col];
          if (x < y) return ascending ? -1 : 1;
          if (x > y) return ascending ? 1 : -1;
          return 0;
        });
      }
      return this._result(out);
    }

    if (this._op === "insert") {
      const payloads = Array.isArray(this._payload) ? this._payload : [this._payload];
      const inserted = payloads.map((p) => withInsertDefaults(this._table, p));
      rows.push(...inserted);
      return this._returning ? this._result(inserted) : { data: null, error: null };
    }

    if (this._op === "update") {
      const matched = rows.filter((r) => matchesFilters(r, this._filters));
      matched.forEach((r) => {
        Object.assign(r, this._payload);
        if (TOUCH_UPDATED_AT.has(this._table)) r.updated_at = nowIso();
      });
      return this._returning ? this._result(matched) : { data: null, error: null };
    }

    if (this._op === "delete") {
      const matched = rows.filter((r) => matchesFilters(r, this._filters));
      const ids = new Set(matched.map((r) => r.id));
      this._store[this._table] = rows.filter((r) => !ids.has(r.id));
      return this._returning ? this._result(matched) : { data: null, error: null };
    }

    if (this._op === "upsert") {
      const cols = this._onConflict ? this._onConflict.split(",").map((s) => s.trim()) : ["id"];
      const payloads = Array.isArray(this._payload) ? this._payload : [this._payload];
      const out = payloads.map((p) => {
        const existing = rows.find((r) => cols.every((c) => r[c] === p[c]));
        if (existing) {
          Object.assign(existing, p);
          if (TOUCH_UPDATED_AT.has(this._table)) existing.updated_at = nowIso();
          return existing;
        }
        const created = withInsertDefaults(this._table, p);
        rows.push(created);
        return created;
      });
      return this._returning ? this._result(out) : { data: null, error: null };
    }

    return { data: null, error: null };
  }

  // Thenable: `await query` runs it. Resolve async to mimic network timing.
  then(onFulfilled, onRejected) {
    return Promise.resolve()
      .then(() => this._run())
      .then(onFulfilled, onRejected);
  }
  catch(onRejected) {
    return this.then(undefined, onRejected);
  }
}

export function createMockClient() {
  const store = buildDemoStore();
  return {
    from: (table) => new QueryBuilder(store, table),
    // The app uses custom client-side auth, so supabase.auth is never called,
    // but expose a harmless stub in case something probes it.
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({ error: null }),
    },
    _store: store,
  };
}
