import { supabase } from "./supabaseClient.js";

const KEY = "tequeria_state";
const ROW_ID = 1;

export const supabaseReady = !!supabase;

/* ---------- respaldo local (si no hay Supabase) ---------- */
function lsLoad() {
  try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}
function lsSave(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
}

/* ---------- API ---------- */
// Devuelve { data, rev }. Crea el estado inicial si no existe.
export async function loadOrInit(defaultFactory) {
  if (!supabase) {
    const local = lsLoad();
    if (local) return { data: local, rev: "local" };
    const d = defaultFactory(); lsSave(d);
    return { data: d, rev: "local" };
  }
  const { data: row, error } = await supabase
    .from("app_state").select("data, rev").eq("id", ROW_ID).maybeSingle();
  if (error) console.error("Supabase load:", error.message);
  if (row && row.data) return { data: row.data, rev: row.rev };

  const d = defaultFactory();
  const rev = Math.random().toString(36).slice(2);
  const { error: e2 } = await supabase.from("app_state").upsert({ id: ROW_ID, data: d, rev });
  if (e2) console.error("Supabase init:", e2.message);
  return { data: d, rev };
}

export async function saveState(data, rev) {
  if (!supabase) { lsSave(data); return; }
  const { error } = await supabase.from("app_state")
    .upsert({ id: ROW_ID, data, rev, updated_at: new Date().toISOString() });
  if (error) console.error("Supabase save:", error.message);
}

// Llama onChange(row) cuando otro dispositivo modifica el estado.
export function subscribeState(onChange) {
  if (!supabase) return () => {};
  const ch = supabase
    .channel("app_state_realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "app_state", filter: `id=eq.${ROW_ID}` },
      (payload) => { if (payload.new) onChange(payload.new); }
    )
    .subscribe();
  return () => supabase.removeChannel(ch);
}
