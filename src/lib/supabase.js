import { createClient } from "@supabase/supabase-js";

// Reads config from Vite env vars (see .env.example). Anything prefixed VITE_ is
// exposed to the client bundle — that's fine for the URL + anon key, which are
// public by design and gated server-side by Row-Level Security.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Surfaces a clear error early (in dev) instead of a cryptic failure deep in a call.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
if (!isSupabaseConfigured) {
  console.warn(
    "Supabase is not configured — copy .env.example to .env and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  );
}

// Exported even when unconfigured so imports don't throw; calls will simply fail
// until the env vars are set. `persistSession` keeps the user signed in across reloads.
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
