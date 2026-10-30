import { createClient } from "@supabase/supabase-js";

// Solo se leen estas dos variables públicas; Vite no incluye en el bundle nada más.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && key
  ? createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }, // la sesión de operador la da la función login()
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null;
