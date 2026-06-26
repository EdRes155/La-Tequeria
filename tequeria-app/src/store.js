import { supabase } from "./supabaseClient.js";

const LS_KEY = "tequeria_state";
export const supabaseReady = !!supabase;

let onStatus = null;
export function setStatusHandler(fn) { onStatus = fn; }
function status(s) { if (onStatus) onStatus(s); }

/* ===================== mapeos fila <-> objeto de la app ===================== */
const ticketFromRow = (r) => ({
  id: r.id, tipo: r.tipo, esExtra: !!r.es_extra, origen: r.origen, mesaId: r.mesa_id,
  ordenes: r.ordenes || [], extras: r.extras || [], mesero: r.mesero, hora: r.hora, fecha: r.fecha,
  estado: r.estado, total: Number(r.total) || 0, domicilio: r.domicilio || null,
});
const ticketToRow = (t) => ({
  id: t.id, tipo: t.tipo, es_extra: !!t.esExtra, origen: t.origen, mesa_id: t.mesaId ?? null,
  ordenes: t.ordenes || [], extras: t.extras || [], mesero: t.mesero, hora: t.hora, fecha: t.fecha,
  estado: t.estado || "pendiente", total: t.total || 0, domicilio: t.domicilio || null,
  archivado_cocina: false,
});

function assemble(rows) {
  const cfg = rows.config || {};
  const open = (rows.tickets || []);
  return {
    nombreNegocio: cfg.nombre_negocio || "La Tequería",
    precios: cfg.precios || {}, extras: cfg.extras || [], ocultos: cfg.ocultos || [],
    carnes: (rows.carnes || []).map((c) => ({ id: c.id, nombre: c.nombre, activo: c.activo })),
    bebidas: (rows.bebidas || []).map((b) => ({ id: b.id, nombre: b.nombre, cantidad: b.cantidad, activo: b.activo, precio: Number(b.precio) || 0 })),
    usuarios: (rows.usuarios || []).map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol })),
    mesas: (rows.mesas || []).map((m) => ({ id: m.id, estado: m.estado, mesero: m.mesero, hora: m.hora, pedido: m.pedido, extras: m.extras || [] })),
    gastos: (rows.gastos || []).map((g) => ({ id: g.id, concepto: g.concepto, monto: Number(g.monto) || 0, fecha: g.fecha, hora: g.hora, user: g.usuario })),
    cocina: open.filter((t) => !t.archivado_cocina).map(ticketFromRow),
    historial: open.map(ticketFromRow),
    cortes: (rows.cortes || []).map((c) => ({ id: c.id, fecha: c.fecha, hora: c.hora, tickets: c.tickets, total: Number(c.total) || 0 })),
    domicilios: [],
  };
}

async function fetchAll() {
  const q = (t, sel, order) => {
    let r = supabase.from(t).select(sel || "*");
    if (order) r = r.order(order.col, { ascending: order.asc });
    return r;
  };
  const [config, carnes, bebidas, usuarios, mesas, tickets, cortes, gastos] = await Promise.all([
    supabase.from("config").select("*").eq("id", 1).maybeSingle(),
    q("carnes", "*", { col: "orden", asc: true }),
    q("bebidas", "*", { col: "nombre", asc: true }),
    q("usuarios", "id, nombre, rol"),
    q("mesas", "*", { col: "id", asc: true }),
    supabase.from("tickets").select("*").is("corte_id", null).order("created_at", { ascending: false }),
    q("cortes", "*", { col: "created_at", asc: false }),
    q("gastos", "*", { col: "created_at", asc: false }),
  ]);
  return assemble({
    config: config.data, carnes: carnes.data, bebidas: bebidas.data, usuarios: usuarios.data,
    mesas: mesas.data, tickets: tickets.data, cortes: cortes.data, gastos: gastos.data,
  });
}

/* ===================== respaldo local (sin Supabase) ===================== */
function lsLoad() { try { const v = localStorage.getItem(LS_KEY); return v ? JSON.parse(v) : null; } catch { return null; } }
export function saveBlob(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch {} }

/* ===================== carga + sembrado inicial ===================== */
async function seedIfEmpty(seed) {
  const cfg = await supabase.from("config").select("id").eq("id", 1).maybeSingle();
  if (!cfg.data) await supabase.from("config").insert({ id: 1, nombre_negocio: seed.config.nombreNegocio, precios: seed.config.precios, extras: seed.config.extras, ocultos: seed.config.ocultos });

  const car = await supabase.from("carnes").select("id");
  if (!car.data || car.data.length === 0) await supabase.from("carnes").insert(seed.carnes.map((c, i) => ({ id: c.id, nombre: c.nombre, activo: c.activo !== false, orden: i })));

  const beb = await supabase.from("bebidas").select("id");
  if (!beb.data || beb.data.length === 0) await supabase.from("bebidas").insert(seed.bebidas.map((b) => ({ id: b.id, nombre: b.nombre, cantidad: b.cantidad, activo: b.activo !== false, precio: b.precio || 0 })));

  const mes = await supabase.from("mesas").select("id");
  if (!mes.data || mes.data.length === 0) await supabase.from("mesas").insert(seed.mesas.map((m) => ({ id: m.id, estado: "libre" })));

  const usr = await supabase.from("usuarios").select("id");
  if (!usr.data || usr.data.length === 0) {
    for (const u of seed.usuarios) await supabase.rpc("crear_usuario", { p_id: u.id, p_nombre: u.nombre, p_pin: u.pin, p_rol: u.rol });
  }
}

export async function loadAll(seed) {
  if (!supabase) {
    const l = lsLoad();
    if (l) return l;
    saveBlob(seed.blob);
    return seed.blob;
  }
  try { await seedIfEmpty(seed); } catch (e) { console.error("seed:", e.message || e); }
  return await fetchAll();
}

export function subscribeTables(onData) {
  if (!supabase) { status("local"); return () => {}; }
  let timer = null;
  const refresh = () => { clearTimeout(timer); timer = setTimeout(async () => { try { onData(await fetchAll()); } catch (e) { console.error(e); } }, 250); };
  const tablas = ["config", "carnes", "bebidas", "usuarios", "mesas", "tickets", "cortes", "gastos"];
  let ch = supabase.channel("tequeria_all");
  tablas.forEach((t) => ch.on("postgres_changes", { event: "*", schema: "public", table: t }, refresh));
  ch.subscribe((st) => { status(st === "SUBSCRIBED" ? "online" : "reconnecting"); });

  const recover = () => refresh();
  const onVis = () => { if (typeof document !== "undefined" && document.visibilityState === "visible") recover(); };
  if (typeof window !== "undefined") window.addEventListener("online", recover);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
  return () => {
    if (typeof window !== "undefined") window.removeEventListener("online", recover);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
    supabase.removeChannel(ch);
  };
}

/* ===================== login ===================== */
export async function login(id, pin) {
  if (!supabase) return null; // offline: el login se valida con el respaldo local en App
  const { data, error } = await supabase.rpc("login", { p_id: id, p_pin: pin });
  if (error) { console.error("login:", error.message); return null; }
  return data && data.length ? data[0] : null;
}

/* ===================== acciones de escritura ===================== */
async function w(promise, etiqueta) {
  if (!supabase) return;
  try { const { error } = await promise; if (error) throw error; status("online"); }
  catch (e) { console.error(etiqueta + ":", e.message || e); status("reconnecting"); }
}

export const io = {
  // config
  saveConfig: (patch) => w(supabase.from("config").upsert({ id: 1, ...patch }), "config"),
  // carnes
  addCarne: (c, orden) => w(supabase.from("carnes").insert({ id: c.id, nombre: c.nombre, activo: true, orden: orden || 0 }), "addCarne"),
  updateCarne: (id, patch) => w(supabase.from("carnes").update(patch).eq("id", id), "updateCarne"),
  removeCarne: (id) => w(supabase.from("carnes").delete().eq("id", id), "removeCarne"),
  // bebidas
  addBebida: (b) => w(supabase.from("bebidas").insert({ id: b.id, nombre: b.nombre, cantidad: b.cantidad, activo: true, precio: b.precio }), "addBebida"),
  updateBebida: (id, patch) => w(supabase.from("bebidas").update(patch).eq("id", id), "updateBebida"),
  removeBebida: (id) => w(supabase.from("bebidas").delete().eq("id", id), "removeBebida"),
  // mesas
  updateMesa: (id, patch) => w(supabase.from("mesas").update(patch).eq("id", id), "updateMesa"),
  // tickets
  addTicket: (t) => w(supabase.from("tickets").insert(ticketToRow(t)), "addTicket"),
  updateTicket: (id, patch) => w(supabase.from("tickets").update(patch).eq("id", id), "updateTicket"),
  // gastos
  addGasto: (g) => w(supabase.from("gastos").insert({ id: g.id, concepto: g.concepto, monto: g.monto, fecha: g.fecha, hora: g.hora, usuario: g.user }), "addGasto"),
  removeGasto: (id) => w(supabase.from("gastos").delete().eq("id", id), "removeGasto"),
  // usuarios (vía funciones)
  crearUsuario: (u) => w(supabase.rpc("crear_usuario", { p_id: u.id, p_nombre: u.nombre, p_pin: u.pin, p_rol: u.rol }), "crearUsuario"),
  eliminarUsuario: (id) => w(supabase.rpc("eliminar_usuario", { p_id: id }), "eliminarUsuario"),
  // corte
  hacerCorte: (id, fechaStr, horaStr) => w(supabase.rpc("hacer_corte", { p_id: id, p_fecha: fechaStr, p_hora: horaStr }), "hacerCorte"),
};
