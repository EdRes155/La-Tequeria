import { createClient } from "@supabase/supabase-js";

// Solo se leen estas dos variables públicas; Vite no incluye en el bundle nada más.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// La sesión de Supabase es la IDENTIDAD DEL EQUIPO (anónima; docs/multinegocio/MODELO.md §4): se guarda y
// se renueva sola, en su propia clave. La del operador es otra cosa: el token de la función login().
export const CLAVE_IDENTIDAD = "tequeria-identidad-equipo";
export const supabase = url && key
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: CLAVE_IDENTIDAD },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null;
