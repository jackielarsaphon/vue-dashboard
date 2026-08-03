import { ref, type Ref } from "vue";
import { supabase } from "../lib/supabaseClient.js";

export interface StoreResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface TableStoreOptions {
  table: string;
  orderBy?: string;
  ascending?: boolean;
}

export interface LoadOptions {
  /** Re-read the table even if it was just loaded (after inserting a row, or for an export that must be exact). */
  force?: boolean;
}

export interface TableStore<T> {
  items: Ref<T[]>;
  loading: Ref<boolean>;
  error: Ref<string>;
  load: (options?: LoadOptions) => Promise<StoreResult<T[]>>;
  create: (payload: Partial<T>) => Promise<StoreResult<T>>;
  update: (id: string, payload: Partial<T>) => Promise<StoreResult<T>>;
  remove: (id: string) => Promise<StoreResult<null>>;
}

// Generic CRUD store factory over a single Supabase table, matching the
// existing JS composable convention in this project (module-level singleton
// state, plain async functions) but typed. Each table's store file calls
// this once at module scope so all components share the same reactive state.
export function createTableStore<T extends { id: string }>(options: TableStoreOptions): TableStore<T> {
  const { table, orderBy, ascending = true } = options;

  const items = ref<T[]>([]) as Ref<T[]>;
  const loading = ref(false);
  const error = ref("");

  // These are MASTER tables (excavators, pits, materials, locations, truck models):
  // they change only when someone edits them on a Settings page, and create/update/
  // remove already patch `items` locally. But every date-scoped store used to await
  // load() at the top of its fetch, so a single date change re-read all five of them
  // — and several stores loading at once fired the same query three or four times
  // over. So: concurrent calls share one request, and a table read within
  // FRESH_MS is served from memory. Cross-device edits still appear (the next load
  // after that window re-reads), and `force` guarantees a fresh read where the caller
  // needs one.
  const FRESH_MS = 60000;
  let loadedAt = 0;
  let inflight: Promise<StoreResult<T[]>> | null = null;

  // PostgREST answers a plain select with AT MOST its max-rows (1000 on this project)
  // and says nothing about the rest. area_excavators crossed that line, and because
  // this store orders by created_at ascending, the rows silently dropped were the
  // NEWEST placements — so every excavator added to a pit recently vanished from Data
  // entry after a reload (it was still there in the session that created it, since
  // create() appends to `items` locally). Page through instead of trusting one
  // response to be the whole table.
  const PAGE = 1000;
  const MAX_PAGES = 50; // 50k rows — a backstop, not an expected limit

  const read = async (): Promise<StoreResult<T[]>> => {
    loading.value = true;
    error.value = "";

    const all: T[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const from = page * PAGE;
      let query = supabase.from(table).select("*");
      if (orderBy) query = query.order(orderBy, { ascending });
      const { data, error: loadError } = await query.range(from, from + PAGE - 1);

      if (loadError) {
        loading.value = false;
        error.value = loadError.message;
        return { ok: false, error: error.value };
      }

      const rows = (data ?? []) as T[];
      all.push(...rows);
      // A short page is the last one; a full page means there may be more.
      if (rows.length < PAGE) break;
    }

    loading.value = false;
    items.value = all;
    loadedAt = Date.now();
    return { ok: true, data: items.value };
  };

  const load = (options?: LoadOptions): Promise<StoreResult<T[]>> => {
    if (!options?.force) {
      if (inflight) return inflight;
      if (loadedAt && Date.now() - loadedAt < FRESH_MS) return Promise.resolve({ ok: true, data: items.value });
    }
    const request = read().finally(() => {
      if (inflight === request) inflight = null;
    });
    inflight = request;
    return request;
  };

  const create = async (payload: Partial<T>): Promise<StoreResult<T>> => {
    // The untyped client (no generated Database schema) can't narrow insert/
    // update payloads to a specific table's row type, hence the `as any` here.
    const { data, error: insertError } = await supabase.from(table).insert(payload as any).select().single();
    if (insertError) return { ok: false, error: insertError.message };

    items.value = [...items.value, data as T];
    return { ok: true, data: data as T };
  };

  const update = async (id: string, payload: Partial<T>): Promise<StoreResult<T>> => {
    const { data, error: updateError } = await supabase.from(table).update(payload as any).eq("id", id).select().single();
    if (updateError) return { ok: false, error: updateError.message };

    items.value = items.value.map((item) => (item.id === id ? (data as T) : item));
    return { ok: true, data: data as T };
  };

  const remove = async (id: string): Promise<StoreResult<null>> => {
    const { error: deleteError } = await supabase.from(table).delete().eq("id", id);
    if (deleteError) return { ok: false, error: deleteError.message };

    items.value = items.value.filter((item) => item.id !== id);
    return { ok: true };
  };

  load();

  return { items, loading, error, load, create, update, remove };
}
