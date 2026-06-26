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

export interface TableStore<T> {
  items: Ref<T[]>;
  loading: Ref<boolean>;
  error: Ref<string>;
  load: () => Promise<StoreResult<T[]>>;
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

  const load = async (): Promise<StoreResult<T[]>> => {
    loading.value = true;
    error.value = "";

    let query = supabase.from(table).select("*");
    if (orderBy) query = query.order(orderBy, { ascending });
    const { data, error: loadError } = await query;

    loading.value = false;
    if (loadError) {
      error.value = loadError.message;
      return { ok: false, error: error.value };
    }

    items.value = (data ?? []) as T[];
    return { ok: true, data: items.value };
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
