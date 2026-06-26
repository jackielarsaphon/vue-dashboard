import { createClient } from "@supabase/supabase-js";
import { createMockClient } from "./mockSupabase.js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// DEMO mode: serve in-memory demo data (see demoData.js) instead of a real
// Supabase project. Enabled when VITE_DEMO=true, or as a fallback when no
// Supabase URL/key is configured. Lets the whole dashboard run standalone.
export const isDemo = import.meta.env.VITE_DEMO === "true" || !url || !key;

export const supabase = isDemo ? createMockClient() : createClient(url, key);

if (isDemo) console.info("[dashboard] running in DEMO mode — in-memory data, no Supabase");
