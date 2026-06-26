import { createClient } from "@supabase/supabase-js";

const env = import.meta.env;
// Acepta VITE_* (recomendado) y NEXT_PUBLIC_* (las que crea la integración de Vercel)
const url = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = url && key
  ? createClient(url, key, {
      auth: { persistSession: false },                 // no usamos auth de Supabase
      realtime: { params: { eventsPerSecond: 5 } },    // suaviza ráfagas de tiempo real
    })
  : null;
