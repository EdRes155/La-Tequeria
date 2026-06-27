import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Plus, Minus, Trash2, X, Printer, Send, LogOut, ArrowLeft,
  Bike, Package, Wallet, Utensils, ShoppingBag, ChefHat, Check, Pencil, Settings
} from "lucide-react";
import { loadAll, subscribeTables, saveBlob, login as dbLogin, supabaseReady, setStatusHandler, io, claimCocina, latidoCocina, liberarCocina } from "./store.js";

/* ============================================================
   LA TEQUERÍA — Sistema de comandas
   Una sola página web. iPad / tablet / celular (Safari · Chrome).
   En pantallas grandes: columnas + lista al lado.
   En celular: una sola columna deslizable con pestañas.
   ============================================================ */

const STORAGE_KEY = "tequeria_v6";
const NUM_MESAS = 8;

const CARNES_DEFAULT = [
  { id: "pastor",  nombre: "Pastor",  activo: true },
  { id: "bistec",  nombre: "Bistec",  activo: true },
  { id: "tripa",   nombre: "Tripa",   activo: true },
  { id: "chorizo", nombre: "Chorizo", activo: true },
];
const BEBIDAS_DEFAULT = [
  { id: "coca",     nombre: "Coca-Cola",        cantidad: 24, activo: true, precio: 25 },
  { id: "sprite",   nombre: "Sprite",           cantidad: 12, activo: true, precio: 25 },
  { id: "fanta",    nombre: "Fanta",            cantidad: 12, activo: true, precio: 25 },
  { id: "jamaica",  nombre: "Agua de Jamaica",  cantidad: 20, activo: true, precio: 20 },
  { id: "horchata", nombre: "Agua de Horchata", cantidad: 20, activo: true, precio: 20 },
  { id: "mineral",  nombre: "Agua Mineral",     cantidad: 10, activo: true, precio: 25 },
  { id: "botella",  nombre: "Agua Embotellada", cantidad: 30, activo: true, precio: 15 },
];
const USUARIOS_DEFAULT = [
  { id: "u1", nombre: "Edwin",    pin: "1234", rol: "admin" },
  { id: "u2", nombre: "Mesero 1", pin: "1111", rol: "mesero" },
];

/* precios base de comida según las carnes iniciales */
function preciosDefault(carnes) {
  const p = {
    "quesa-maiz-queso": 25, "quesa-queso": 35, "volcan-queso": 35,
    "costra-queso": 45, "media-costra-queso": 25,
    "bolsa-verdura": 15, "tortilla-harina": 10, "tortilla-maiz": 10,
  };
  carnes.forEach((c) => {
    p[`taco-${c.id}`] = 20;
    p[`taco-queso-${c.id}`] = 30;
    p[`gringa-${c.id}`] = 45;
    p[`llenadora-${c.id}`] = 55;
    p[`volcan-${c.id}`] = 40;
    p[`costra-${c.id}`] = 50;
    p[`media-costra-${c.id}`] = 28;
  });
  return p;
}

function defaultData() {
  return {
    nombreNegocio: "La Tequería",
    usuarios: USUARIOS_DEFAULT,
    carnes: CARNES_DEFAULT,
    bebidas: BEBIDAS_DEFAULT,
    extras: [],                       // productos personalizados que agrega el admin
    ocultos: [],                      // claves de productos estándar ocultos del menú
    precios: preciosDefault(CARNES_DEFAULT),
    mesas: Array.from({ length: NUM_MESAS }, (_, i) => ({
      id: i + 1, estado: "libre", pedido: null, mesero: null, hora: null,
    })),
    domicilios: [],
    cocina: [],
    gastos: [],
    historial: [],                    // todos los tickets enviados (para reimprimir y corte)
    cortes: [],                       // cortes de caja guardados
  };
}

const esAdmin = (u) => u?.rol === "admin";

// Asegura que cualquier estado (incluido uno viejo de la BD) tenga todos los campos
function normalize(d) {
  if (!d || typeof d !== "object") return d;
  d.nombreNegocio = d.nombreNegocio || "La Tequería";
  d.usuarios = d.usuarios || [];
  d.carnes = d.carnes || [];
  d.bebidas = d.bebidas || [];
  d.extras = d.extras || [];
  d.ocultos = d.ocultos || [];
  d.precios = d.precios || {};
  d.mesas = (d.mesas || []).map((m) => ({ ...m, extras: m.extras || [] }));
  d.domicilios = d.domicilios || [];
  d.cocina = d.cocina || [];
  d.gastos = d.gastos || [];
  d.historial = d.historial || [];
  d.cortes = d.cortes || [];
  return d;
}

const ROLES = { admin: "Administrador", mesero: "Mesero", cocinero: "Cocinero" };
// Permisos por rol: "ver" = pantallas visibles; "edita" = dónde puede modificar.
// - admin: todo.  - mesero: mesas y comanda (su trabajo); cocina solo lectura.
// - cocinero: cocina (completo) y mesas solo lectura (no toma ni edita órdenes).
const PERMISOS = {
  admin:    { ver: ["mesas", "comanda", "cocina", "inventario", "gastos", "admin"], edita: ["mesas", "comanda", "cocina", "inventario", "gastos", "admin"] },
  mesero:   { ver: ["mesas", "comanda", "cocina"],                                  edita: ["mesas", "comanda"] },
  cocinero: { ver: ["mesas", "cocina"],                                             edita: ["cocina"] },
};
const puede = (u, v) => !!(PERMISOS[u?.rol]?.ver || []).includes(v);
const puedeEditar = (u, v) => !!(PERMISOS[u?.rol]?.edita || []).includes(v);
const money = (n) => "$" + (Number(n) || 0).toFixed(0);
const ticketTotal = (t) =>
  (t.ordenes || []).reduce((s, o) => s + o.items.reduce((a, i) => a + i.cantidad * (i.precio || 0), 0), 0)
  + (t.extras || []).reduce((a, e) => a + e.cantidad * (e.precio || 0), 0);
const contarTacos = (t) =>
  (t.ordenes || []).reduce((s, o) => s + o.items.reduce((a, i) => a + (i.cat === "taco" ? i.cantidad : 0), 0), 0);

/* ---------- persistencia ---------- */
async function loadData() {
  try {
    if (typeof window === "undefined" || !window.storage) return null;
    const r = await window.storage.get(STORAGE_KEY);
    return r ? JSON.parse(r.value) : null;
  } catch { return null; }
}
async function saveData(d) {
  try {
    if (typeof window === "undefined" || !window.storage) return;
    await window.storage.set(STORAGE_KEY, JSON.stringify(d));
  } catch {}
}

/* ---------- helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const hora = () => new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
const fecha = () => new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });
const clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

function useIsPhone() {
  const [phone, setPhone] = useState(typeof window !== "undefined" ? window.innerWidth < 760 : false);
  useEffect(() => {
    const f = () => { const p = window.innerWidth < 760; setPhone((prev) => (prev === p ? prev : p)); };
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return phone;
}

/* tipos de comanda */
const TIPOS = {
  aqui:      { label: "Para comer aquí", corto: "Aquí",      color: "var(--agave)", icon: Utensils },
  llevar:    { label: "Para llevar",     corto: "Llevar",    color: "var(--maiz)",  icon: ShoppingBag },
  domicilio: { label: "Domicilio",       corto: "Domicilio", color: "var(--barro)", icon: Bike },
};

/* categorías de comida y su color */
const CATS = {
  taco:    { color: "var(--lima)" },
  quesa:   { color: "var(--maiz)" },
  volcan:  { color: "var(--barro)" },
  costra:  { color: "var(--especial)" },
  bebida:  { color: "var(--agua)" },
  empaque: { color: "var(--empaque)" },
};

/* preparación por orden (todos los casos) */
const PREPS = [
  { k: "con-todo", label: "Con todo" },
  { k: "natural",  label: "Natural" },
  { k: "cilantro", label: "Con cilantro" },
  { k: "cebolla",  label: "Con cebolla" },
];
const PREP_LABEL = Object.fromEntries(PREPS.map((p) => [p.k, p.label]));

/* extras de empaque (solo para llevar y domicilio) */
function empaqueItems(precios = {}) {
  return [
    { key: "verdura-aparte", nombre: "Verdura aparte (sin costo)", corto: "Verdura aparte", cat: "empaque", precio: 0 },
    { key: "bolsa-verdura", nombre: "Bolsa de verdura (zanahoria, pepino, limón)", corto: "Bolsa de verdura", cat: "empaque", precio: precios["bolsa-verdura"] ?? 0 },
    { key: "tortilla-harina", nombre: "Tortillas extra (harina)", corto: "Tortillas harina", cat: "empaque", precio: precios["tortilla-harina"] ?? 0 },
    { key: "tortilla-maiz", nombre: "Tortillas extra (maíz)", corto: "Tortillas maíz", cat: "empaque", precio: precios["tortilla-maiz"] ?? 0 },
  ];
}

/* catálogo estándar (productos generados por las carnes) por categoría */
function catalogoBase(carnes) {
  return {
    taco: [
      ...carnes.map((c) => ({ key: `taco-${c.id}`, nombre: `Taco ${c.nombre}` })),
      { key: "quesa-maiz-queso", nombre: "Quesadilla de maíz (queso)" },
      ...carnes.map((c) => ({ key: `taco-queso-${c.id}`, nombre: `Taco de queso ${c.nombre}` })),
    ],
    quesa: [
      ...carnes.map((c) => ({ key: `gringa-${c.id}`, nombre: `Gringa ${c.nombre}` })),
      ...carnes.map((c) => ({ key: `llenadora-${c.id}`, nombre: `Llenadora ${c.nombre}` })),
      { key: "quesa-queso", nombre: "Quesadilla de queso" },
    ],
    volcan: [
      ...carnes.map((c) => ({ key: `volcan-${c.id}`, nombre: `Volcán ${c.nombre}` })),
      { key: "volcan-queso", nombre: "Volcán de queso" },
    ],
    costra: [
      ...carnes.map((c) => ({ key: `costra-${c.id}`, nombre: `Costra ${c.nombre}` })),
      { key: "costra-queso", nombre: "Costra de queso" },
      ...carnes.map((c) => ({ key: `media-costra-${c.id}`, nombre: `Media costra ${c.nombre}` })),
      { key: "media-costra-queso", nombre: "Media costra de queso" },
    ],
  };
}

function buildMenu(carnes, bebidas, extras = [], precios = {}, ocultos = []) {
  const cAct = carnes.filter((c) => c.activo);
  const P = (k) => precios[k] ?? 0;
  const ex = (cat) => extras.filter((e) => e.activo && e.cat === cat)
    .map((e) => ({ key: `extra-${e.id}`, nombre: e.nombre, cat, precio: Number(e.precio) || 0, extraId: e.id }));

  const tacos = [
    ...cAct.map((c) => ({ key: `taco-${c.id}`, nombre: `Taco ${c.nombre}`, cat: "taco", precio: P(`taco-${c.id}`) })),
    { key: "quesa-maiz-queso", nombre: "Quesadilla de maíz (queso)", cat: "taco", precio: P("quesa-maiz-queso") },
    ...cAct.map((c) => ({ key: `taco-queso-${c.id}`, nombre: `Taco de queso ${c.nombre}`, cat: "taco", precio: P(`taco-queso-${c.id}`) })),
    ...ex("taco"),
  ];
  const quesa = [
    ...cAct.map((c) => ({ key: `gringa-${c.id}`, nombre: `Gringa ${c.nombre}`, cat: "quesa", precio: P(`gringa-${c.id}`) })),
    ...cAct.map((c) => ({ key: `llenadora-${c.id}`, nombre: `Llenadora ${c.nombre}`, cat: "quesa", precio: P(`llenadora-${c.id}`) })),
    { key: "quesa-queso", nombre: "Quesadilla de queso", cat: "quesa", precio: P("quesa-queso") },
    ...ex("quesa"),
  ];
  const volcan = [
    ...cAct.map((c) => ({ key: `volcan-${c.id}`, nombre: `Volcán ${c.nombre}`, cat: "volcan", precio: P(`volcan-${c.id}`) })),
    { key: "volcan-queso", nombre: "Volcán de queso", cat: "volcan", precio: P("volcan-queso") },
    ...ex("volcan"),
  ];
  const costra = [
    ...cAct.map((c) => ({ key: `costra-${c.id}`, nombre: `Costra ${c.nombre}`, cat: "costra", precio: P(`costra-${c.id}`) })),
    { key: "costra-queso", nombre: "Costra de queso", cat: "costra", precio: P("costra-queso") },
    ...cAct.map((c) => ({ key: `media-costra-${c.id}`, nombre: `Media costra ${c.nombre}`, cat: "costra", precio: P(`media-costra-${c.id}`) })),
    { key: "media-costra-queso", nombre: "Media costra de queso", cat: "costra", precio: P("media-costra-queso") },
    ...ex("costra"),
  ];
  const ocul = new Set(ocultos);
  const f = (arr) => arr.filter((it) => !ocul.has(it.key));
  const bebs = bebidas.filter((b) => b.activo && b.cantidad > 0)
    .map((b) => ({ key: `beb-${b.id}`, nombre: b.nombre, cat: "bebida", invId: b.id, precio: Number(b.precio) || 0 }));
  return { tacos: f(tacos), quesa: f(quesa), volcan: f(volcan), costra: f(costra), bebs };
}

const nuevaOrden = (n) => ({ id: uid(), nombre: `Orden ${n}`, items: [], prep: "con-todo" });
const nuevoPedido = () => ({ ordenes: [nuevaOrden(1)], extras: [] });
const domVacio = () => ({ nombre: "", direccion: "", referencia: "", telefono: "", pago: "efectivo", tiempo: "" });

/* ============================== AVISOS (toasts) y CONFIRMACIÓN ============================== */
let _toastSeq = 0;
const _toastListeners = new Set();
function toast(mensaje, tipo = "info") {
  const t = { id: ++_toastSeq, mensaje, tipo };
  _toastListeners.forEach((fn) => fn(t));
}
function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const add = (t) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 2800);
    };
    _toastListeners.add(add);
    return () => _toastListeners.delete(add);
  }, []);
  const quitar = (id) => setItems((xs) => xs.filter((x) => x.id !== id));
  return (
    <div className="toaster">
      {items.map((t) => (
        <div key={t.id} className={"toast " + t.tipo} onClick={() => quitar(t.id)}>
          {t.tipo === "ok" ? "✓ " : t.tipo === "error" ? "⚠ " : ""}{t.mensaje}
        </div>
      ))}
    </div>
  );
}

let _confirmListener = null;
function confirmDialog(opts) {
  const o = typeof opts === "string" ? { mensaje: opts } : (opts || {});
  return new Promise((resolve) => {
    if (_confirmListener) _confirmListener({ ...o, resolve });
    else resolve(window.confirm(o.mensaje || "¿Confirmar?"));
  });
}
function ConfirmHost() {
  const [state, setState] = useState(null);
  useEffect(() => { _confirmListener = setState; return () => { _confirmListener = null; }; }, []);
  if (!state) return null;
  const cerrar = (val) => { state.resolve(val); setState(null); };
  return (
    <div className="modal-bg" onClick={() => cerrar(false)}>
      <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
        {state.titulo && <h3 className="confirm-title">{state.titulo}</h3>}
        <p className="confirm-msg">{state.mensaje}</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => cerrar(false)}>{state.cancelar || "Cancelar"}</button>
          <button className={"btn " + (state.peligro ? "btn-danger" : "btn-primary")} onClick={() => cerrar(true)}>{state.confirmar || "Confirmar"}</button>
        </div>
      </div>
    </div>
  );
}

let _choiceListener = null;
function choiceDialog(opts) {
  return new Promise((resolve) => {
    if (_choiceListener) _choiceListener({ ...opts, resolve });
    else resolve(null);
  });
}
function ChoiceHost() {
  const [state, setState] = useState(null);
  useEffect(() => { _choiceListener = setState; return () => { _choiceListener = null; }; }, []);
  if (!state) return null;
  const pick = (v) => { state.resolve(v); setState(null); };
  return (
    <div className="modal-bg" onClick={() => pick(null)}>
      <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
        {state.titulo && <h3 className="confirm-title">{state.titulo}</h3>}
        {state.mensaje && <p className="confirm-msg">{state.mensaje}</p>}
        <div className="modal-actions choice-actions">
          {state.opciones.map((o) => (
            <button key={o.val} className={"btn " + (o.tipo || "btn-primary")} onClick={() => pick(o.val)}>{o.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

let _pinListener = null;
function pedirPin(opts) {
  const o = typeof opts === "string" ? { mensaje: opts } : (opts || {});
  return new Promise((resolve) => {
    if (_pinListener) _pinListener({ ...o, resolve });
    else { const v = window.prompt(o.mensaje || "PIN de administrador:"); resolve(v ? v : null); }
  });
}
function PinHost() {
  const [state, setState] = useState(null);
  const [pin, setPin] = useState("");
  useEffect(() => { _pinListener = (s) => { setPin(""); setState(s); }; return () => { _pinListener = null; }; }, []);
  if (!state) return null;
  const cerrar = (val) => { state.resolve(val); setState(null); };
  return (
    <div className="modal-bg" onClick={() => cerrar(null)}>
      <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
        {state.titulo && <h3 className="confirm-title">{state.titulo}</h3>}
        {state.mensaje && <p className="confirm-msg">{state.mensaje}</p>}
        <input className="pin-input" type="password" inputMode="numeric" autoFocus value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && pin) cerrar(pin); }} placeholder="PIN" />
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => cerrar(null)}>Cancelar</button>
          <button className="btn btn-primary" disabled={!pin} onClick={() => cerrar(pin)}>Autorizar</button>
        </div>
      </div>
    </div>
  );
}

/* ============================== AVISOS DE COCINA ============================== */
function CocinaAlertas({ data, onAbrir }) {
  const seen = useRef(null);
  const [nuevos, setNuevos] = useState([]);
  const [permiso, setPermiso] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");

  useEffect(() => {
    const pend = (data.cocina || []).filter((t) => t.estado !== "listo");
    const ids = new Set(pend.map((t) => t.id));
    if (seen.current === null) { seen.current = ids; return; }   // primer render: no avisar
    const recien = pend.filter((t) => !seen.current.has(t.id));
    seen.current = ids;
    if (recien.length > 0) {
      const t0 = recien[0];
      notificar("Nuevo pedido", (t0.esExtra ? "Orden extra · " : "") + t0.origen + (recien.length > 1 ? ` (+${recien.length - 1})` : ""));
      setNuevos((xs) => [...recien, ...xs].slice(0, 8));
      if (getAutoprint()) recien.forEach((t) => onAbrir(t, true));
    }
  }, [data.cocina]);

  const pedirPermiso = async () => { try { setPermiso(await Notification.requestPermission()); } catch {} };
  const quitar = (id) => setNuevos((xs) => xs.filter((x) => x.id !== id));

  if (nuevos.length === 0 && permiso !== "default") return null;
  return (
    <div className="cocina-alertas">
      {permiso === "default" && (
        <button className="alerta-permiso" onClick={pedirPermiso}>🔔 Activar avisos de nuevos pedidos</button>
      )}
      {nuevos.map((t) => (
        <div key={t.id} className={"alerta-pedido" + (t.esExtra ? " extra" : "")}>
          <span className="alerta-txt">🔔 {t.esExtra ? "Orden extra" : "Nuevo pedido"}: <b>{t.origen}</b></span>
          <button className="btn btn-primary btn-sm" onClick={() => { onAbrir(t); quitar(t.id); }}><Printer size={14} /> Imprimir</button>
          <button className="btn btn-ghost btn-sm" onClick={() => quitar(t.id)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

/* ============================================================ */
export default function App() {
  const [data, setData] = useState(null);
  const [user, setUser] = useState(null);
  const [view, setView] = useState("mesas");
  const [ctx, setCtx] = useState(null);
  const [conn, setConn] = useState(supabaseReady ? "reconnecting" : "local");
  const [printTicket, setPrintTicket] = useState(null);   // ticket que el cocinero va a imprimir
  const [printAuto, setPrintAuto] = useState(false);
  const dataRef = useRef(null);
  dataRef.current = data;

  // Objeto semilla para el primer arranque (sirve para sembrar la BD o el respaldo local)
  const seed = useMemo(() => ({
    config: { nombreNegocio: "La Tequería", precios: preciosDefault(CARNES_DEFAULT), extras: [], ocultos: [] },
    carnes: CARNES_DEFAULT, bebidas: BEBIDAS_DEFAULT,
    mesas: Array.from({ length: NUM_MESAS }, (_, i) => ({ id: i + 1 })),
    usuarios: USUARIOS_DEFAULT,
    blob: normalize(defaultData()),
  }), []);

  // Cargar estado + suscribirse a cambios por tabla
  useEffect(() => {
    let unsub = () => {};
    setStatusHandler(setConn);
    (async () => {
      const d = await loadAll(seed);
      setData(d);
      unsub = subscribeTables((fresh) => setData(fresh));
    })();
    return () => { setStatusHandler(null); unsub(); };
  }, []);

  // Sin Supabase: persistimos el respaldo local en cada cambio
  useEffect(() => {
    if (!data || supabaseReady) return;
    const t = setTimeout(() => saveBlob(data), 250);
    return () => clearTimeout(t);
  }, [data]);

  // Sesión única de cocina: latido mientras el cocinero esté dentro; libera al salir
  useEffect(() => {
    if (!user || user.rol !== "cocinero") return;
    const sid = getSid();
    let vivo = true;
    const beat = async () => { const ok = await latidoCocina(sid); if (!ok && vivo) { toast("Otra cocina tomó la sesión en otro dispositivo.", "error"); setUser(null); } };
    const iv = setInterval(beat, 15000);
    const bye = () => liberarCocina(sid);
    window.addEventListener("beforeunload", bye);
    return () => { vivo = false; clearInterval(iv); window.removeEventListener("beforeunload", bye); liberarCocina(sid); };
  }, [user?.id, user?.rol]);

  // Acciones: actualizan la pantalla al instante y escriben en la base (o respaldo local)
  const db = useMemo(() => makeDb(setData, dataRef), []);

  if (!data) return <div className="loading">Cargando…</div>;
  if (!user) return <Login data={data} onLogin={setUser} conn={conn} />;

  // Si el usuario fue eliminado/cambiado desde otro dispositivo, cerrar sesión
  const yo = data.usuarios.find((u) => u.id === user.id);
  if (!yo) return <Login data={data} onLogin={setUser} conn={conn} aviso="Tu usuario ya no existe. Inicia sesión de nuevo." />;
  const userActual = yo;

  const go = useCallback((v, c = null) => { setView(v); setCtx(c); }, []);
  const props = { data, db, user: userActual, go, ctx };
  const abrirImpresion = (t, auto = false) => { setPrintAuto(!!auto); setPrintTicket(t); };

  return (
    <div className="app">
      <style>{CSS}</style>
      <TopBar data={data} user={userActual} view={view} go={go} conn={conn} onLogout={() => setUser(null)} />
      {userActual.rol === "cocinero" && <CocinaAlertas data={data} onAbrir={abrirImpresion} />}
      <main className="main">
        {view === "mesas"      && (puede(userActual, "mesas") ? <Mesas {...props} /> : <SinAcceso />)}
        {view === "comanda"    && (puede(userActual, "comanda") ? <Comanda {...props} /> : <SinAcceso />)}
        {view === "cocina"     && (puede(userActual, "cocina") ? <Cocina {...props} /> : <SinAcceso />)}
        {view === "inventario" && (puede(userActual, "inventario") ? <Inventario {...props} /> : <SinAcceso />)}
        {view === "gastos"     && (puede(userActual, "gastos") ? <Gastos {...props} /> : <SinAcceso />)}
        {view === "admin"      && (puede(userActual, "admin") ? <Admin {...props} /> : <SinAcceso />)}
      </main>
      {printTicket && <TicketModal t={printTicket} negocio={data.nombreNegocio} autoPrint={printAuto}
        onClose={() => { setPrintTicket(null); setPrintAuto(false); }} />}
      <Toaster />
      <ConfirmHost />
      <ChoiceHost />
      <PinHost />
    </div>
  );
}

/* ============================== ACCIONES (db) ============================== */
function makeDb(setData, dataRef) {
  const local = (fn) => setData((d) => { const nd = clone(d); fn(nd); return nd; });
  const capHist = (nd) => { if (nd.historial.length > 400) nd.historial = nd.historial.slice(0, 400); };

  return {
    // ---- mesas ----
    guardarMesa(mesaId, pedido, userNombre) {
      const ocupa = pedido.ordenes.some((o) => o.items.length > 0);
      const patch = { pedido: ocupa ? pedido : null, estado: ocupa ? "ocupada" : "libre", mesero: ocupa ? userNombre : null, hora: ocupa ? hora() : null };
      local((nd) => { const m = nd.mesas.find((x) => x.id === mesaId); if (m) Object.assign(m, patch); });
      io.updateMesa(mesaId, patch);
    },
    liberarMesa(mesaId) {
      const patch = { pedido: null, estado: "libre", mesero: null, hora: null, extras: [] };
      local((nd) => { const m = nd.mesas.find((x) => x.id === mesaId); if (m) Object.assign(m, patch); });
      io.updateMesa(mesaId, patch);
    },
    // ---- tickets ----
    enviarTicket(t, { esExtra, mesaId, pedido, userNombre }) {
      // bebidas consumidas
      const consumo = {};
      (t.ordenes || []).forEach((o) => o.items.forEach((i) => { if (i.cat === "bebida" && i.invId) consumo[i.invId] = (consumo[i.invId] || 0) + i.cantidad; }));
      local((nd) => {
        nd.cocina.unshift(clone(t)); nd.historial.unshift(clone(t)); capHist(nd);
        Object.entries(consumo).forEach(([bid, q]) => { const b = nd.bebidas.find((x) => x.id === bid); if (b) b.cantidad = Math.max(0, b.cantidad - q); });
        if (esExtra) { const m = nd.mesas.find((x) => x.id === mesaId); if (m) { m.extras = m.extras || []; m.extras.push({ id: t.id, ordenes: clone(pedido.ordenes), extras: clone(pedido.extras || []), hora: t.hora, total: t.total }); } }
        else if (t.tipo === "aqui" && mesaId) { const m = nd.mesas.find((x) => x.id === mesaId); if (m) { m.pedido = clone(pedido); m.estado = "ocupada"; m.mesero = userNombre; m.hora = t.hora; } }
      });
      io.addTicket(t);
      const cur = dataRef.current;
      Object.entries(consumo).forEach(([bid, q]) => { const b = cur.bebidas.find((x) => x.id === bid); if (b) io.updateBebida(bid, { cantidad: Math.max(0, b.cantidad - q) }); });
      if (esExtra) { const m = cur.mesas.find((x) => x.id === mesaId); const ex = [...((m && m.extras) || []), { id: t.id, ordenes: pedido.ordenes, extras: pedido.extras || [], hora: t.hora, total: t.total }]; io.updateMesa(mesaId, { extras: ex }); }
      else if (t.tipo === "aqui" && mesaId) io.updateMesa(mesaId, { pedido, estado: "ocupada", mesero: userNombre, hora: t.hora });
    },
    setTicketEstado(id, estado) {
      local((nd) => { [nd.cocina, nd.historial].forEach((arr) => { const x = arr.find((t) => t.id === id); if (x) x.estado = estado; }); });
      io.updateTicket(id, { estado });
    },
    archivarTicket(id) {
      local((nd) => { nd.cocina = nd.cocina.filter((t) => t.id !== id); });
      io.updateTicket(id, { archivado_cocina: true });
    },
    // Reenvía la orden de una mesa a la cocina para reimprimir (NO cuenta como venta)
    reenviarCocina(t) {
      const copia = { ...clone(t), id: uid(), estado: "pendiente", reenvio: true, total: 0, hora: hora(), fecha: fecha() };
      local((nd) => { nd.cocina.unshift(clone(copia)); });
      io.addTicket(copia);
    },
    async hacerCorte(adminPin, detalle) {
      const cur = dataRef.current; const h = cur.historial || [];
      const total = h.reduce((s, t) => s + (t.total != null ? t.total : 0), 0);
      const id = uid(), f = fecha(), hr = hora();
      if (supabaseReady) { const ok = await io.hacerCorte(adminPin, id, f, hr, detalle); if (!ok) return false; }
      local((nd) => { nd.cortes.unshift({ id, fecha: f, hora: hr, tickets: h.length, total, detalle }); nd.historial = []; nd.cocina = []; });
      return true;
    },
    // ---- bebidas ----
    updateBebida(id, patch) { local((nd) => { const b = nd.bebidas.find((x) => x.id === id); if (b) Object.assign(b, patch); }); io.updateBebida(id, patch); },
    addBebida(b) { local((nd) => nd.bebidas.push({ ...b })); io.addBebida(b); },
    removeBebida(id) { local((nd) => { nd.bebidas = nd.bebidas.filter((x) => x.id !== id); }); io.removeBebida(id); },
    // ---- carnes ----
    addCarne(nombre) {
      const id = slug(nombre);
      const precios = { [`taco-${id}`]: 20, [`taco-queso-${id}`]: 30, [`gringa-${id}`]: 45, [`llenadora-${id}`]: 55, [`volcan-${id}`]: 40, [`costra-${id}`]: 50, [`media-costra-${id}`]: 28 };
      local((nd) => { nd.carnes.push({ id, nombre, activo: true }); nd.precios = { ...nd.precios, ...precios }; });
      io.addCarne({ id, nombre }, (dataRef.current.carnes.length));
      io.saveConfig({ precios: { ...dataRef.current.precios } });
    },
    updateCarne(id, patch) { local((nd) => { const c = nd.carnes.find((x) => x.id === id); if (c) Object.assign(c, patch); }); io.updateCarne(id, patch); },
    removeCarne(id) { local((nd) => { nd.carnes = nd.carnes.filter((x) => x.id !== id); }); io.removeCarne(id); },
    // ---- config (precios / extras / ocultos) ----
    setPrecio(key, val) { const precios = { ...dataRef.current.precios, [key]: val }; local((nd) => { nd.precios = precios; }); io.saveConfig({ precios }); },
    setExtraPrecio(id, val) { const extras = dataRef.current.extras.map((e) => e.id === id ? { ...e, precio: val } : e); local((nd) => { nd.extras = extras; }); io.saveConfig({ extras }); },
    addExtra(cat, nombre, precio) { const extras = [...dataRef.current.extras, { id: uid(), nombre, cat, precio, activo: true }]; local((nd) => { nd.extras = extras; }); io.saveConfig({ extras }); },
    removeExtra(id) { const extras = dataRef.current.extras.filter((e) => e.id !== id); local((nd) => { nd.extras = extras; }); io.saveConfig({ extras }); },
    toggleOculto(key) { const set = new Set(dataRef.current.ocultos || []); set.has(key) ? set.delete(key) : set.add(key); const ocultos = [...set]; local((nd) => { nd.ocultos = ocultos; }); io.saveConfig({ ocultos }); },
    // ---- gastos ----
    addGasto(g) { local((nd) => nd.gastos.unshift({ ...g })); io.addGasto(g); },
    removeGasto(id) { local((nd) => { nd.gastos = nd.gastos.filter((x) => x.id !== id); }); io.removeGasto(id); },
    // ---- usuarios ----
    async crearUsuario(u, adminPin) {
      if (supabaseReady) { const ok = await io.crearUsuario(u, adminPin); if (!ok) return false; }
      local((nd) => nd.usuarios.push({ id: u.id, nombre: u.nombre, rol: u.rol, pin: u.pin }));
      return true;
    },
    async eliminarUsuario(id, adminPin) {
      if (supabaseReady) { const ok = await io.eliminarUsuario(id, adminPin); if (!ok) return false; }
      local((nd) => { nd.usuarios = nd.usuarios.filter((x) => x.id !== id); });
      return true;
    },
  };
}

function SinAcceso() {
  return (
    <div className="screen">
      <div className="empty">No tienes acceso a esta sección.</div>
    </div>
  );
}

/* ============================== LOGIN ============================== */
function Login({ data, onLogin, conn, aviso }) {
  const [sel, setSel] = useState(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const entrar = async () => {
    if (busy || !sel) return;
    setBusy(true); setErr("");
    try {
      let u = null;
      if (supabaseReady) {
        u = await dbLogin(sel, pin);
      } else {
        const local = data.usuarios.find((x) => x.id === sel);
        if (local && local.pin === pin) u = local;
      }
      if (!u) { setErr("PIN incorrecto"); setPin(""); return; }
      // Solo un dispositivo cocinero a la vez
      if (u.rol === "cocinero") {
        const ok = await claimCocina(getSid());
        if (!ok) { setErr("Ya hay una cocina abierta en otro dispositivo."); setPin(""); return; }
      }
      onLogin(u);
    } finally { setBusy(false); }
  };
  const online = conn === "online";
  const connTxt = conn === "online" ? "● En línea — sincronizado entre dispositivos"
    : conn === "reconnecting" ? "● Conectando…"
    : "● Modo local (configura Supabase para sincronizar)";
  const connCol = conn === "online" ? "var(--ok)" : conn === "reconnecting" ? "var(--maiz)" : "var(--alerta)";
  return (
    <div className="login">
      <style>{CSS}</style>
      <div className="login-card">
        <div className="brand-mark">🌵</div>
        <h1 className="brand-title">{data.nombreNegocio}</h1>
        <p className="brand-sub">Sistema de comandas</p>
        {aviso && <div className="login-err">{aviso}</div>}
        <div className="login-users">
          {data.usuarios.map((u) => (
            <button key={u.id} className={"user-chip" + (sel === u.id ? " on" : "")}
              onClick={() => { setSel(u.id); setErr(""); setPin(""); }}>{u.nombre}</button>
          ))}
        </div>
        {sel && (
          <>
            <input className="pin-input" type="password" inputMode="numeric" placeholder="PIN"
              value={pin} onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && entrar()} />
            {err && <div className="login-err">{err}</div>}
            <button className="btn btn-primary btn-block" disabled={busy} onClick={entrar}>{busy ? "Entrando…" : "Entrar"}</button>
          </>
        )}
        <p className="login-hint" style={{ marginTop: 10, color: connCol }}>{connTxt}</p>
      </div>
    </div>
  );
}

/* ============================== TOPBAR ============================== */
function TopBar({ data, user, view, go, conn, onLogout }) {
  const items = [
    { id: "mesas", label: "Mesas", icon: Utensils },
    { id: "cocina", label: "Cocina", icon: ChefHat },
    { id: "inventario", label: "Inventario", icon: Package },
    { id: "gastos", label: "Gastos", icon: Wallet },
    { id: "admin", label: "Administración", icon: Settings },
  ].filter((it) => puede(user, it.id));
  const pendientes = data.cocina.filter((t) => t.estado !== "listo").length;
  const connCol = conn === "online" ? "var(--ok)" : conn === "reconnecting" ? "var(--maiz)" : "var(--alerta)";
  const connTitle = conn === "online" ? "En línea" : conn === "reconnecting" ? "Conectando…" : "Modo local";
  return (
    <header className="topbar">
      <div className="topbar-brand"><span className="topbar-cactus">🌵</span>
        <span className="topbar-name">{data.nombreNegocio}</span>
        <span className="conn-dot" title={connTitle} style={{ background: connCol }} /></div>
      <nav className="topbar-nav">
        {items.map((it) => {
          const I = it.icon;
          const active = view === it.id || (view === "comanda" && it.id === "mesas");
          return (
            <button key={it.id} className={"nav-btn" + (active ? " on" : "")} onClick={() => go(it.id)}>
              <I size={18} /><span>{it.label}</span>
              {it.id === "cocina" && pendientes > 0 && <em className="badge">{pendientes}</em>}
            </button>
          );
        })}
      </nav>
      <div className="topbar-user">
        <span className="user-name">{user.nombre}</span>
        <span className={"rol-tag " + user.rol}>{ROLES[user.rol] || user.rol}</span>
        <button className="nav-btn ghost" onClick={onLogout}><LogOut size={18} /></button></div>
    </header>
  );
}

/* ============================== MESAS ============================== */
function Mesas({ data, go, user }) {
  const puedeComanda = puede(user, "comanda");
  const domsActivos = data.cocina.filter((t) => t.tipo === "domicilio" && t.estado !== "listo").length;
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h2>Mesas</h2>
          <p className="muted">{puedeComanda
            ? "Toca una mesa para tomar su orden. Para llevar y Domicilio están abajo como un cuadro más."
            : "Vista de mesas (solo lectura)."}</p>
        </div>
      </div>
      <div className="mesas-grid">
        {data.mesas.map((m) => {
          const ocupada = m.estado === "ocupada";
          const ordenes = m.pedido?.ordenes?.length || 0;
          const items = m.pedido?.ordenes?.reduce((s, p) => s + p.items.reduce((a, i) => a + i.cantidad, 0), 0) || 0;
          return (
            <button key={m.id} className={"mesa-card" + (ocupada ? " ocupada" : "") + (puedeComanda ? "" : " solo-ver")}
              onClick={() => puedeComanda && go("comanda", { tipo: "aqui", mesaId: m.id })}>
              <div className="mesa-num">{m.id}</div>
              <div className="mesa-estado">{ocupada ? "Ocupada" : "Libre"}</div>
              {ocupada && (
                <div className="mesa-info">
                  {m.mesero && <span className="mesa-mesero">{m.mesero}</span>}
                  <span>{items} prod. · {ordenes} órd.{m.hora ? ` · ${m.hora}` : ""}</span>
                </div>
              )}
            </button>
          );
        })}

        {puedeComanda && (
          <button className="mesa-card especial-card llevar" onClick={() => go("comanda", { tipo: "llevar" })}>
            <ShoppingBag size={34} />
            <div className="especial-card-label">Para llevar</div>
          </button>
        )}

        {puedeComanda && (
          <button className="mesa-card especial-card domicilio" onClick={() => go("comanda", { tipo: "domicilio" })}>
            <Bike size={34} />
            <div className="especial-card-label">Domicilio</div>
            {domsActivos > 0 && <span className="especial-badge">{domsActivos} en curso</span>}
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================== COMANDA ============================== */
function Comanda({ data, db, user, go, ctx }) {
  const isPhone = useIsPhone();
  const menu = useMemo(() => buildMenu(data.carnes, data.bebidas, data.extras, data.precios, data.ocultos),
    [data.carnes, data.bebidas, data.extras, data.precios, data.ocultos]);

  const [tipo, setTipo] = useState(ctx?.tipo || "aqui");
  const [entrada] = useState(ctx?.tipo || "aqui"); // cómo se abrió: mesa, llevar o domicilio
  const [mesaId, setMesaId] = useState(ctx?.mesaId || null);
  const [pedido, setPedido] = useState(() => {
    if (ctx?.tipo === "aqui" && ctx?.mesaId) {
      const m = data.mesas.find((x) => x.id === ctx.mesaId);
      // Mesa ocupada -> empezamos vacío (su orden se ve en el resumen / orden extra)
      if (m && m.estado === "ocupada") return nuevoPedido();
      if (m?.pedido) { const ped = clone(m.pedido); if (!ped.extras) ped.extras = []; return ped; }
    }
    return nuevoPedido();
  });
  const [activa, setActiva] = useState(0);
  const [dom, setDom] = useState(domVacio());
  const [domOk, setDomOk] = useState(false);
  const [modalDom, setModalDom] = useState(ctx?.tipo === "domicilio");
  const [refLlevar, setRefLlevar] = useState(""); // nombre de referencia (pestaña Para llevar)
  const [esExtra, setEsExtra] = useState(false);  // orden extra sobre una mesa ya ocupada
  const [ticket, setTicket] = useState(null);
  const [pane, setPane] = useState("menu"); // celular: menu | orden
  const sending = useRef(false);

  const extras = pedido.extras || [];
  const totalProd = pedido.ordenes.reduce((s, p) => s + p.items.reduce((a, i) => a + i.cantidad, 0), 0);
  const totalExtras = extras.reduce((a, e) => a + e.cantidad * (e.precio || 0), 0);
  const totalOrdenes = pedido.ordenes.reduce((s, p) => s + p.items.reduce((a, i) => a + i.cantidad * (i.precio || 0), 0), 0);
  const totalDinero = totalOrdenes + totalExtras;
  const vacio = totalProd === 0 && extras.length === 0;

  const mostrarExtras = tipo === "llevar" || tipo === "domicilio";
  const empaqueCat = useMemo(() => empaqueItems(data.precios), [data.precios]);

  const addExtraPedido = (item) => setPedido((p) => {
    const np = clone(p); if (!np.extras) np.extras = [];
    const ex = np.extras.find((e) => e.key === item.key);
    if (ex) ex.cantidad += 1; else np.extras.push({ ...item, cantidad: 1 });
    return np;
  });
  const setCantExtra = (key, delta) => setPedido((p) => {
    const np = clone(p); const e = np.extras.find((x) => x.key === key); if (!e) return np;
    e.cantidad += delta; if (e.cantidad <= 0) np.extras = np.extras.filter((x) => x.key !== key);
    return np;
  });

  const addItemTo = (idx, item) => setPedido((p) => {
    const np = clone(p); const o = np.ordenes[idx];
    const ex = o.items.find((i) => i.key === item.key);
    if (ex) ex.cantidad += 1; else o.items.push({ ...item, cantidad: 1 });
    return np;
  });
  const addItem = (item) => addItemTo(activa, item);
  const setPrep = (idx, k) => setPedido((p) => { const np = clone(p); np.ordenes[idx].prep = k; return np; });
  const setCant = (idx, key, delta) => setPedido((p) => {
    const np = clone(p); const o = np.ordenes[idx];
    const it = o.items.find((i) => i.key === key); if (!it) return np;
    it.cantidad += delta; if (it.cantidad <= 0) o.items = o.items.filter((i) => i.key !== key);
    return np;
  });
  const addOrden = () => {
    setPedido((p) => { const np = clone(p); np.ordenes.push(nuevaOrden(np.ordenes.length + 1)); return np; });
    setActiva(pedido.ordenes.length);
    if (isPhone) setPane("orden");
  };
  const borrarOrden = (idx) => {
    setPedido((p) => { if (p.ordenes.length === 1) return p; const np = clone(p); np.ordenes.splice(idx, 1); return np; });
    setActiva(0);
  };
  const renombrar = (idx, nombre) => setPedido((p) => { const np = clone(p); np.ordenes[idx].nombre = nombre; return np; });

  const guardarMesa = () => {
    db.guardarMesa(mesaId, clone(pedido), user.nombre);
    toast(totalProd > 0 ? `Mesa ${mesaId} guardada` : `Mesa ${mesaId} liberada`, "ok");
    go("mesas");
  };

  const finalizar = async () => {
    if (sending.current) return;            // evita doble toque / doble ticket
    if (vacio) { toast("Agrega al menos un producto.", "error"); return; }
    if (!esExtra && entrada === "domicilio" && (!dom.direccion.trim() || !dom.telefono.trim())) {
      setModalDom(true); toast("Captura dirección y teléfono del domicilio.", "error"); return;
    }
    // ¿Cuenta junta o separada? Solo tiene sentido preguntar con más de una orden.
    let cuenta = "junta";
    if (!esExtra && pedido.ordenes.length > 1) {
      const sel = await choiceDialog({
        titulo: "¿Cómo va la cuenta?",
        mensaje: "Así saldrá impreso el ticket.",
        opciones: [
          { label: "Junta (un solo total)", val: "junta", tipo: "btn-primary" },
          { label: "Separada (total por orden)", val: "separada", tipo: "btn-line" },
        ],
      });
      if (!sel) return;     // cerró sin elegir: no se envía
      cuenta = sel;
    }
    if (sending.current) return;
    sending.current = true;
    setTimeout(() => { sending.current = false; }, 1200);
    let ticketTipo = "aqui", origen, paraLlevar = false, referencia = null;
    if (esExtra) {
      origen = `Mesa ${mesaId}`;
    } else if (entrada === "aqui") {
      origen = `Mesa ${mesaId}`;
      paraLlevar = tipo === "llevar";
    } else if (entrada === "llevar") {
      ticketTipo = "llevar";
      referencia = refLlevar.trim();
      origen = referencia ? `Para llevar · ${referencia}` : "Para llevar";
    } else {
      ticketTipo = "domicilio";
      origen = dom.nombre.trim() || "Domicilio";
    }
    const t = {
      id: uid(), tipo: ticketTipo, esExtra, origen, paraLlevar, referencia, cuenta,
      mesaId: (esExtra || entrada === "aqui") ? mesaId : null,
      ordenes: clone(pedido.ordenes), extras: clone(pedido.extras || []),
      mesero: user.nombre, hora: hora(), fecha: fecha(), estado: "pendiente",
      domicilio: (!esExtra && entrada === "domicilio") ? { ...dom } : null,
      total: totalDinero,
    };
    db.enviarTicket(t, { esExtra, mesaId, pedido: clone(pedido), userNombre: user.nombre });
    toast(esExtra ? "Orden extra enviada a cocina" : "Comanda enviada a cocina", "ok");
    go("mesas");
  };

  const liberarMesa = () => {
    db.liberarMesa(mesaId);
    toast(`Mesa ${mesaId} liberada`, "ok");
    go("mesas");
  };

  const Tb = TIPOS[tipo];
  const mesaInfo = mesaId ? data.mesas.find((m) => m.id === mesaId) : null;
  const mesaOcupada = entrada === "aqui" && mesaInfo?.estado === "ocupada";

  const confirmLiberar = async () => {
    if (await confirmDialog({ titulo: "Liberar mesa", mensaje: `¿Marcar la Mesa ${mesaId} como libre? Se borrará su orden guardada.`, confirmar: "Liberar", peligro: true })) liberarMesa();
  };

  const dispLabel = tipo === "aqui" ? "Para esta mesa" : tipo === "llevar" ? "Para llevar" : "Domicilio";

  /* ---- bloques reutilizables ---- */
  const typeBar = (
    <div className="type-bar">
      <button className="btn btn-ghost btn-sm" onClick={() => go("mesas")}><ArrowLeft size={16} /> Mesas</button>
      {entrada === "aqui" ? (
        esExtra ? (
          <div className="type-btns">
            <span className="type-fixed" style={{ "--tc": "var(--especial)" }}>Orden extra</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEsExtra(false); setPedido(nuevoPedido()); setActiva(0); }}>Cancelar</button>
          </div>
        ) : (
          <div className="type-btns">
            <button className={"type-btn" + (tipo === "aqui" ? " on" : "")} style={{ "--tc": TIPOS.aqui.color }} onClick={() => setTipo("aqui")}>
              <Utensils size={16} /> Para esta mesa
            </button>
            <button className={"type-btn" + (tipo === "llevar" ? " on" : "")} style={{ "--tc": TIPOS.llevar.color }} onClick={() => setTipo("llevar")}>
              <ShoppingBag size={16} /> Para llevar
            </button>
          </div>
        )
      ) : entrada === "domicilio" ? (
        <div className="type-btns">
          <span className="type-fixed" style={{ "--tc": TIPOS.domicilio.color }}><Bike size={16} /> Domicilio {domOk && <Check size={15} />}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setModalDom(true)}><Pencil size={14} /> Editar datos</button>
        </div>
      ) : (
        <div className="type-btns">
          <span className="type-fixed" style={{ "--tc": TIPOS.llevar.color }}><ShoppingBag size={16} /> Para llevar</span>
          <input className="ref-input" placeholder="Nombre de referencia" value={refLlevar}
            onChange={(e) => setRefLlevar(e.target.value)} />
        </div>
      )}
      {entrada === "aqui" && <span className="mesa-chip">Mesa {mesaId}</span>}
    </div>
  );

  const banner = (
    <div className="type-banner" style={{
      background: esExtra ? "var(--especial)"
        : entrada === "aqui"
          ? (tipo === "llevar" ? TIPOS.llevar.color : TIPOS.aqui.color)
          : TIPOS[tipo].color,
    }}>
      {esExtra
        ? `Mesa ${mesaId} · ORDEN EXTRA`
        : entrada === "aqui"
          ? `Mesa ${mesaId}${tipo === "llevar" ? " · EXCLUSIVO PARA LLEVAR" : ""}`
          : entrada === "llevar"
            ? `Para llevar${refLlevar.trim() ? ` · ${refLlevar.trim()}` : ""}`
            : `Domicilio${domOk && dom.nombre ? ` · ${dom.nombre}` : ""}`}
    </div>
  );

  const ocupadaBar = mesaOcupada ? (
    <div className="ocupada-bar">
      <span>Ocupada por <b>{mesaInfo.mesero || "—"}</b>{mesaInfo.hora ? ` · ${mesaInfo.hora}` : ""}</span>
      <button className="btn btn-danger-ghost btn-sm" onClick={confirmLiberar}>Marcar libre</button>
    </div>
  ) : null;

  const menuPane = (
    <div className="menu-inner">
      <div className="cols-3">
        <MenuCol title="Tacos" cat="taco" items={menu.tacos} onAdd={addItem} />
        <MenuCol title="Quesadillas / Gringas" cat="quesa" items={menu.quesa} onAdd={addItem} />
        <MenuCol title="Volcanes" cat="volcan" items={menu.volcan} onAdd={addItem} />
      </div>
      <div className="especial">
        <div className="especial-head">Especialidad — Costra</div>
        <div className="especial-items">
          {menu.costra.map((it) => <ItemBtn key={it.key} item={it} onAdd={addItem} />)}
        </div>
      </div>
      <div className="bebidas-box">
        <div className="bebidas-head">Refrescos y aguas {menu.bebs.length === 0 && <span className="muted">— sin existencias</span>}</div>
        <div className="bebidas-items">
          {menu.bebs.map((it) => <ItemBtn key={it.key} item={it} onAdd={addItem} />)}
        </div>
      </div>
    </div>
  );

  const ordenPane = (
    <div className="ticket-inner">
      <div className="ticket-head">
        <div><div className="ticket-origen">Órdenes</div>
          <div className="ticket-mesero">{user.nombre} · {totalProd} producto(s)</div></div>
        <button className="btn btn-add btn-sm" onClick={addOrden}><Plus size={16} /> Orden</button>
      </div>
      {tipo === "domicilio" && domOk && (
        <button className="dom-resumen" onClick={() => setModalDom(true)}>
          <Bike size={15} />
          <span>{dom.nombre || "Domicilio"} · {dom.direccion}</span>
          <Pencil size={13} />
        </button>
      )}
      <div className="ticket-scroll">
        {pedido.ordenes.map((o, idx) => (
          <OrdenBlock key={o.id} o={o} idx={idx} activa={activa === idx}
            onSelect={() => setActiva(idx)} onRename={(v) => renombrar(idx, v)}
            onCant={(key, d) => setCant(idx, key, d)} onDelete={() => borrarOrden(idx)}
            canDelete={pedido.ordenes.length > 1}
            onPrep={(k) => setPrep(idx, k)} />
        ))}

        {mostrarExtras && (
          <div className="pedido-extras">
            <div className="pedido-extras-head">Para todo el pedido (llevar)</div>
            <div className="pedido-extras-add">
              {empaqueCat.map((it) => (
                <button key={it.key} className="extra-chip" style={{ "--cat": CATS.empaque.color }}
                  onClick={() => addExtraPedido(it)}>
                  <Plus size={12} /> {it.corto}{it.precio > 0 ? ` ${money(it.precio)}` : ""}
                </button>
              ))}
            </div>
            {extras.length > 0 && (
              <ul className="orden-items">
                {extras.map((it) => (
                  <li key={it.key} className="oitem" style={{ "--cat": CATS.empaque.color }}>
                    <span className="oitem-dot" /><span className="oitem-name">{it.corto || it.nombre}</span>
                    <span className="oitem-precio">{it.precio > 0 ? money(it.precio * it.cantidad) : "sin costo"}</span>
                    <div className="stepper">
                      <button onClick={() => setCantExtra(it.key, -1)}><Minus size={14} /></button>
                      <span>{it.cantidad}</span>
                      <button onClick={() => setCantExtra(it.key, 1)}><Plus size={14} /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="ticket-total"><span>Total</span><b>{money(totalDinero)}</b></div>
    </div>
  );

  const previewTicket = esExtra
    ? { id: "preview", tipo: "aqui", esExtra: true, origen: `Mesa ${mesaId}`, paraLlevar: false,
        ordenes: pedido.ordenes, extras: pedido.extras || [], mesero: user.nombre, hora: hora(), fecha: fecha(), domicilio: null }
    : buildTicketPreview(entrada, tipo, mesaId, dom, refLlevar, pedido, user);

  const accionesIzq = (
    <div className="footer-izq">
      <button className="btn btn-add btn-block" onClick={addOrden}><Plus size={16} /> Agregar orden (otra persona)</button>
    </div>
  );
  const accionesDer = (
    <div className="footer-der">
      <button className="btn btn-line" disabled={vacio} onClick={() => setTicket(previewTicket)}>
        <Printer size={16} /> Ver ticket</button>
      <button className={"btn " + (esExtra ? "btn-barro" : "btn-primary")} disabled={vacio} onClick={finalizar}>
        <Send size={16} /> {esExtra ? "Enviar orden extra" : "Enviar a cocina"}</button>
    </div>
  );

  // Mesa ocupada: mostramos resumen + opción de Orden Extra (no se edita la orden original)
  if (mesaOcupada && !esExtra) {
    const ped = mesaInfo.pedido || { ordenes: [], extras: [] };
    const extrasMesa = mesaInfo.extras || [];
    const tot = ticketTotal(ped) + extrasMesa.reduce((s, e) => s + (e.total != null ? e.total : ticketTotal(e)), 0);
    const todasOrdenes = [...(ped.ordenes || []), ...extrasMesa.flatMap((e) => e.ordenes || [])];
    const todosExtras = [...(ped.extras || []), ...extrasMesa.flatMap((e) => e.extras || [])];
    const reenviar = async () => {
      if (todasOrdenes.length === 0) { toast("La mesa no tiene nada que reenviar.", "info"); return; }
      if (!(await confirmDialog({ titulo: "Reenviar a cocina", mensaje: "Se enviará de nuevo a la cocina para que la impriman. No vuelve a contar como venta.", confirmar: "Reenviar" }))) return;
      db.reenviarCocina({
        id: "x", tipo: "aqui", origen: `Mesa ${mesaId}`, paraLlevar: false,
        ordenes: clone(todasOrdenes), extras: clone(todosExtras),
        mesero: mesaInfo.mesero, hora: hora(), fecha: fecha(), domicilio: null,
      });
      toast("Reenviado a cocina", "ok");
    };
    return (
      <div className="comanda-wrap">
        <div className="type-bar">
          <button className="btn btn-ghost btn-sm" onClick={() => go("mesas")}><ArrowLeft size={16} /> Mesas</button>
          <span className="mesa-chip">Mesa {mesaId}</span>
        </div>
        {banner}
        {ocupadaBar}
        <div className="resumen-scroll">
          <h3 className="resumen-h">Lo que ya se pidió</h3>
          {(ped.ordenes || []).map((o) => (
            <div key={o.id} className="resumen-orden">
              <div className="resumen-oname">{o.nombre}{o.prep ? ` · ${PREP_LABEL[o.prep] || o.prep}` : ""}</div>
              {o.items.map((it) => (
                <div key={it.key} className="resumen-item"><span>{it.cantidad}×</span> {it.nombre}</div>
              ))}
            </div>
          ))}
          {(ped.extras || []).length > 0 && (
            <div className="resumen-orden">
              <div className="resumen-oname">Para todo el pedido</div>
              {ped.extras.map((it) => <div key={it.key} className="resumen-item"><span>{it.cantidad}×</span> {it.corto || it.nombre}</div>)}
            </div>
          )}

          {extrasMesa.map((ex, n) => (
            <div key={ex.id} className="resumen-extra">
              <div className="resumen-extra-h">Orden extra {n + 1}{ex.hora ? ` · ${ex.hora}` : ""}</div>
              {(ex.ordenes || []).map((o) => (
                <div key={o.id} className="resumen-orden">
                  <div className="resumen-oname">{o.nombre}{o.prep ? ` · ${PREP_LABEL[o.prep] || o.prep}` : ""}</div>
                  {o.items.map((it) => (
                    <div key={it.key} className="resumen-item"><span>{it.cantidad}×</span> {it.nombre}</div>
                  ))}
                </div>
              ))}
              {(ex.extras || []).length > 0 && (
                <div className="resumen-orden">
                  <div className="resumen-oname">Para todo el pedido</div>
                  {ex.extras.map((it) => <div key={it.key} className="resumen-item"><span>{it.cantidad}×</span> {it.corto || it.nombre}</div>)}
                </div>
              )}
            </div>
          ))}

          <div className="ticket-total"><span>Total</span><b>{money(tot)}</b></div>
        </div>
        <div className="resumen-actions">
          <button className="btn btn-barro btn-block" onClick={() => { setEsExtra(true); setPedido(nuevoPedido()); setActiva(0); setPane("menu"); }}>
            <Plus size={16} /> Agregar orden extra
          </button>
          <button className="btn btn-line btn-block" onClick={reenviar}><Send size={16} /> Reenviar a cocina</button>
          <button className="btn btn-danger-ghost btn-block" onClick={confirmLiberar}>Marcar mesa como libre</button>
        </div>
        {ticket && <TicketModal t={ticket} negocio={data.nombreNegocio} onClose={() => setTicket(null)} />}
      </div>
    );
  }

  return (
    <div className="comanda-wrap">
      {typeBar}
      {banner}
      {ocupadaBar}

      {isPhone ? (
        <>
          <div className="pane-toggle">
            <button className={pane === "menu" ? "on" : ""} onClick={() => setPane("menu")}>Menú</button>
            <button className={pane === "orden" ? "on" : ""} onClick={() => setPane("orden")}>Órdenes · {totalProd}</button>
          </div>
          <div className="pane-scroll">{pane === "menu" ? menuPane : ordenPane}</div>
          <div className="phone-footer">
            {pane === "menu" ? accionesIzq : accionesDer}
          </div>
        </>
      ) : (
        <div className="comanda">
          <section className="menu-pane">
            <div className="menu-pane-scroll">{menuPane}</div>
            {accionesIzq}
          </section>
          <aside className="ticket-pane">
            {ordenPane}
            {accionesDer}
            {entrada === "aqui" && !esExtra && !mesaOcupada && (
              <div className="ticket-extra">
                <button className="btn btn-ghost btn-sm btn-block" onClick={guardarMesa}>Guardar sin enviar</button>
              </div>
            )}
          </aside>
        </div>
      )}

      {modalDom && (
        <DomicilioModal dom={dom} setDom={setDom}
          onAgregar={() => {
            if (!dom.direccion.trim() || !dom.telefono.trim()) { toast("Dirección y teléfono son obligatorios.", "error"); return; }
            setDomOk(true); setTipo("domicilio"); setModalDom(false);
          }}
          onClose={() => { setModalDom(false); if (!domOk && tipo === "domicilio") setTipo("llevar"); }} />
      )}
      {ticket && <TicketModal t={ticket} negocio={data.nombreNegocio}
        onClose={() => { setTicket(null); if (ticket.estado) go("mesas"); }} />}
    </div>
  );
}

function buildTicketPreview(entrada, tipo, mesaId, dom, refLlevar, pedido, user) {
  let tt, origen, paraLlevar = false;
  if (entrada === "aqui") { tt = "aqui"; origen = `Mesa ${mesaId}`; paraLlevar = tipo === "llevar"; }
  else if (entrada === "llevar") { tt = "llevar"; origen = refLlevar.trim() ? `Para llevar · ${refLlevar.trim()}` : "Para llevar"; }
  else { tt = "domicilio"; origen = dom.nombre || "Domicilio"; }
  return { id: "preview", tipo: tt, origen, paraLlevar, ordenes: pedido.ordenes, extras: pedido.extras || [],
    mesero: user.nombre, hora: hora(), fecha: fecha(), domicilio: entrada === "domicilio" ? dom : null };
}

/* columna de menú */
function MenuCol({ title, cat, items, onAdd }) {
  return (
    <div className="menu-col" style={{ "--cat": CATS[cat].color }}>
      <div className="col-head">{title}</div>
      <div className="col-items">{items.map((it) => <ItemBtn key={it.key} item={it} onAdd={onAdd} />)}</div>
    </div>
  );
}
function ItemBtn({ item, onAdd }) {
  return (
    <button className="item-btn" style={{ "--cat": CATS[item.cat].color }} onClick={() => onAdd(item)}>
      <span className="item-nombre">{item.nombre}</span>
      <span className="item-precio">{money(item.precio)}</span>
    </button>
  );
}

/* bloque de orden */
function OrdenBlock({ o, idx, activa, onSelect, onRename, onCant, onDelete, canDelete, onPrep }) {
  const [edit, setEdit] = useState(false);
  const total = o.items.reduce((a, i) => a + i.cantidad, 0);
  return (
    <div className={"orden" + (activa ? " activa" : "")} onClick={onSelect}>
      <div className="orden-head">
        {edit ? (
          <input className="orden-input" autoFocus value={o.nombre}
            onChange={(e) => onRename(e.target.value)} onBlur={() => setEdit(false)}
            onKeyDown={(e) => e.key === "Enter" && setEdit(false)} onClick={(e) => e.stopPropagation()} />
        ) : (
          <button className="orden-name" onClick={(e) => { e.stopPropagation(); setEdit(true); }}>
            {o.nombre} <Pencil size={12} /></button>
        )}
        <div className="orden-right"><span className="orden-count">{total}</span>
          {canDelete && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onDelete(); }}><Trash2 size={15} /></button>}</div>
      </div>
      {o.items.length === 0 ? (
        <div className="orden-empty">Toca un producto del menú para agregarlo aquí.</div>
      ) : (
        <ul className="orden-items">
          {o.items.map((it) => (
            <li key={it.key} className="oitem" style={{ "--cat": CATS[it.cat].color }}>
              <span className="oitem-dot" /><span className="oitem-name">{it.nombre}</span>
              <span className="oitem-precio">{money((it.precio || 0) * it.cantidad)}</span>
              <div className="stepper" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => onCant(it.key, -1)}><Minus size={14} /></button>
                <span>{it.cantidad}</span>
                <button onClick={() => onCant(it.key, 1)}><Plus size={14} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="orden-prep">
        <span className="orden-prep-label">Preparación:</span>
        {PREPS.map((pr) => (
          <button key={pr.k} className={"prep-chip" + (o.prep === pr.k ? " on" : "")}
            onClick={(e) => { e.stopPropagation(); onPrep(pr.k); }}>{pr.label}</button>
        ))}
      </div>
    </div>
  );
}

/* modal domicilio */
function DomicilioModal({ dom, setDom, onAgregar, onClose }) {
  const f = (k) => (e) => setDom({ ...dom, [k]: e.target.value });
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-dom" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><Bike size={20} /> <h3>Domicilio</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <label>Nombre</label>
          <input className="inp" value={dom.nombre} onChange={f("nombre")} placeholder="Nombre de quien pide" />
          <label>Dirección</label>
          <input className="inp" value={dom.direccion} onChange={f("direccion")} placeholder="Calle, número, colonia" />
          <label>Referencia</label>
          <input className="inp" value={dom.referencia} onChange={f("referencia")} placeholder="Entre calles, color de casa…" />
          <label>Número telefónico</label>
          <input className="inp" inputMode="tel" value={dom.telefono} onChange={f("telefono")} placeholder="10 dígitos" />
          <div className="dom-row">
            <div style={{ flex: 1 }}><label>Pago</label>
              <select className="inp" value={dom.pago} onChange={f("pago")}>
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="transferencia">Transferencia</option>
              </select></div>
            <div style={{ flex: 1 }}><label>Tiempo (min)</label>
              <input className="inp" inputMode="numeric" value={dom.tiempo} onChange={f("tiempo")} placeholder="30" /></div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={onAgregar}><Check size={16} /> Agregar</button>
        </div>
      </div>
    </div>
  );
}

/* etiqueta + color para tickets y cocina */
function ticketView(t) {
  if (t.esExtra) return { label: "Orden extra", color: "var(--especial)" };
  if (t.tipo === "aqui" && t.paraLlevar) return { label: "Exclusivo para llevar", color: TIPOS.llevar.color };
  const Tb = TIPOS[t.tipo] || TIPOS.aqui;
  return { label: Tb.label, color: Tb.color };
}

/* impresión térmica 58mm — un solo ticket (estilo cuenta) sirve para cocina y cliente */
const esBebida = (it) => it.cat === "bebida" || (it.key || "").startsWith("beb-");
const itemPrecio = (it) => (it.precio || 0) * it.cantidad;

// Nombre completo, pero recortado con reglas para que SIEMPRE quepa en un renglón de 58mm.
function nombreTicket(item) {
  let n = (item.corto || item.nombre || "").trim();
  n = n
    .replace(/^Quesadilla de\s+/i, "Quesa. ")
    .replace(/^Quesadilla\b/i, "Quesa.")
    .replace(/^Media costra\b/i, "½ Costra")
    .replace(/\bde queso\b/i, "queso")
    .replace(/\bextra\b/i, "")
    .replace(/\s*\(([^)]*)\)/g, " $1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return n;
}

const AUTOPRINT_KEY = "tequeria_autoprint";
const getAutoprint = () => { try { return localStorage.getItem(AUTOPRINT_KEY) === "1"; } catch { return false; } };
const setAutoprintLS = (v) => { try { localStorage.setItem(AUTOPRINT_KEY, v ? "1" : "0"); } catch {} };

// Identificador estable de este dispositivo (para la sesión única de cocina)
const SID_KEY = "tequeria_cocina_sid";
function getSid() {
  let s = null;
  try { s = localStorage.getItem(SID_KEY); } catch {}
  if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); try { localStorage.setItem(SID_KEY, s); } catch {} }
  return s;
}

// Sonido corto (beep) sin archivos
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
    const ac = new Ctx(); const o = ac.createOscillator(); const g = ac.createGain();
    o.type = "sine"; o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
    g.gain.setValueAtTime(0.001, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.35);
    o.start(); o.stop(ac.currentTime + 0.36);
    setTimeout(() => { try { ac.close(); } catch {} }, 600);
  } catch {}
}
function notificar(titulo, cuerpo) {
  try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch {}
  beep();
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(titulo, { body: cuerpo, tag: "tequeria-pedido" });
    }
  } catch {}
}

function TicketModal({ t, negocio, onClose, recienEnviado, autoPrint }) {
  const ex = t.extras || [];
  const ordenes = t.ordenes || [];
  const [modo, setModo] = useState(t.cuenta || "junta");   // "junta" | "separada"
  const [auto, setAuto] = useState(getAutoprint());
  const doPrint = () => { setTimeout(() => window.print(), 80); };

  // Auto-imprimir al abrir (cuando el cocinero activa auto-imprimir)
  useEffect(() => {
    if (autoPrint || (recienEnviado && getAutoprint())) {
      const id = setTimeout(() => window.print(), 350);
      return () => clearTimeout(id);
    }
  }, []);

  const total = ordenes.reduce((s, o) => s + o.items.reduce((a, i) => a + itemPrecio(i), 0), 0)
    + ex.reduce((a, e) => a + itemPrecio(e), 0);

  // En modo JUNTA agrupamos las bebidas de todas las órdenes hasta abajo
  const bebidasJuntas = [];
  if (modo === "junta") {
    const map = {};
    ordenes.forEach((o) => o.items.forEach((it) => {
      if (esBebida(it)) { if (!map[it.key]) { map[it.key] = { ...it }; bebidasJuntas.push(map[it.key]); } else map[it.key].cantidad += it.cantidad; }
    }));
  }

  const Item = ({ it }) => (
    <div className="tp-item">
      <span className="tp-q">{it.cantidad}</span>
      <span className="tp-n">{nombreTicket(it)}</span>
      <span className="tp-p">{itemPrecio(it) > 0 ? money(itemPrecio(it)) : ""}</span>
    </div>
  );

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-ticket" onClick={(e) => e.stopPropagation()}>
        <div id="print-area" className="ticket-print t58">
          <div className="tp-name">{negocio}</div>
          <div className="tp-sub">{t.origen}{t.paraLlevar ? " · para llevar" : ""}</div>
          <div className="tp-meta"><span>Mesero: {t.mesero}</span><span>{t.hora}</span></div>
          <div className="tp-meta"><span>{t.fecha}</span><span className="tp-modo-tag">{modo === "separada" ? "CUENTA SEPARADA" : "CUENTA"}</span></div>
          {t.domicilio && (
            <div className="tp-dom">
              {t.domicilio.nombre && <div>Cliente: {t.domicilio.nombre}</div>}
              <div>Dir: {t.domicilio.direccion}</div>
              {t.domicilio.referencia && <div>Ref: {t.domicilio.referencia}</div>}
              <div>Tel: {t.domicilio.telefono}</div>
              <div>Pago: {t.domicilio.pago}{t.domicilio.tiempo ? ` · ${t.domicilio.tiempo} min` : ""}</div>
            </div>
          )}
          <div className="tp-line" />

          {modo === "separada" ? (
            ordenes.map((o) => {
              const sub = o.items.reduce((a, i) => a + itemPrecio(i), 0);
              return (
                <div key={o.id} className="tp-orden">
                  <div className="tp-oname">{o.nombre}{o.prep ? " · " + (PREP_LABEL[o.prep] || o.prep) : ""}</div>
                  <div className="tp-items">{o.items.map((it) => <Item key={it.key} it={it} />)}</div>
                  <div className="tp-suborden"><span>Subtotal {o.nombre}</span><span>{money(sub)}</span></div>
                </div>
              );
            })
          ) : (
            <>
              {ordenes.map((o) => {
                const comida = o.items.filter((it) => !esBebida(it));
                if (comida.length === 0) return null;
                return (
                  <div key={o.id} className="tp-orden">
                    <div className="tp-oname">{o.nombre}{o.prep ? " · " + (PREP_LABEL[o.prep] || o.prep) : ""}</div>
                    <div className="tp-items">{comida.map((it) => <Item key={it.key} it={it} />)}</div>
                  </div>
                );
              })}
              {bebidasJuntas.length > 0 && (
                <div className="tp-orden tp-bebidas">
                  <div className="tp-oname">BEBIDAS</div>
                  <div className="tp-items">{bebidasJuntas.map((it) => <Item key={it.key} it={it} />)}</div>
                </div>
              )}
            </>
          )}

          {ex.length > 0 && (
            <>
              <div className="tp-line" />
              <div className="tp-extras-h">* PARA TODO EL PEDIDO</div>
              <div className="tp-items">{ex.map((it) => <Item key={it.key} it={it} />)}</div>
            </>
          )}

          <div className="tp-line" />
          <div className="tp-total"><span>TOTAL</span><span>{money(total)}</span></div>
          <div className="tp-foot">¡Gracias por su compra!</div>
        </div>

        {ordenes.length > 1 && (
          <div className="ticket-modos no-print">
            <button className={"seg-b" + (modo === "junta" ? " on" : "")} onClick={() => setModo("junta")}>Junta</button>
            <button className={"seg-b" + (modo === "separada" ? " on" : "")} onClick={() => setModo("separada")}>Separada</button>
          </div>
        )}
        <label className="auto-print no-print">
          <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); setAutoprintLS(e.target.checked); }} />
          Auto-imprimir nuevos pedidos (cocina)
        </label>
        <div className="modal-actions no-print">
          <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          <button className="btn btn-primary" onClick={doPrint}><Printer size={16} /> Imprimir</button>
        </div>
      </div>
    </div>
  );
}

/* ============================== COCINA ============================== */
function resumenDia(hist) {
  const porTipo = {}, porMesero = {}, prod = {};
  let total = 0;
  hist.forEach((t) => {
    const tt = t.total != null ? t.total : ticketTotal(t);
    total += tt;
    const tipo = (TIPOS[t.tipo] && TIPOS[t.tipo].label) || "Otro";
    porTipo[tipo] = (porTipo[tipo] || 0) + tt;
    porMesero[t.mesero || "—"] = (porMesero[t.mesero || "—"] || 0) + tt;
    (t.ordenes || []).forEach((o) => o.items.forEach((it) => {
      const n = it.corto || it.nombre; prod[n] = (prod[n] || 0) + it.cantidad;
    }));
  });
  const top = Object.entries(prod).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nombre, cant]) => ({ nombre, cant }));
  return { total, count: hist.length, porTipo, porMesero, top };
}

function textoCorteWhatsApp(neg, r, gastosDia, fechaStr) {
  const L = [];
  L.push(`*${neg || "La Tequería"}* — Corte del ${fechaStr}`);
  L.push(`Ventas: ${r.count}`);
  L.push(`Total: ${money(r.total)}`);
  L.push("");
  L.push("Por tipo:");
  Object.entries(r.porTipo).forEach(([k, v]) => L.push(`• ${k}: ${money(v)}`));
  L.push("");
  L.push("Por mesero:");
  Object.entries(r.porMesero).forEach(([k, v]) => L.push(`• ${k}: ${money(v)}`));
  if (r.top.length) { L.push(""); L.push("Más vendidos:"); r.top.forEach((p, i) => L.push(`${i + 1}. ${p.nombre} ×${p.cant}`)); }
  if (gastosDia > 0) { L.push(""); L.push(`Gastos del día: ${money(gastosDia)}`); L.push(`*Neto: ${money(r.total - gastosDia)}*`); }
  return L.join("\n");
}

function Cocina({ data, db, user }) {
  const edita = puedeEditar(user, "cocina");
  const [tab, setTab] = useState("pendientes");
  const [ticket, setTicket] = useState(null);

  const setEstado = (id, estado) => db.setTicketEstado(id, estado);
  const quitar = (id) => db.archivarTicket(id);
  const pend = data.cocina.filter((t) => t.estado !== "listo");
  const listos = data.cocina.filter((t) => t.estado === "listo");
  const historial = data.historial || [];
  const res = resumenDia(historial);
  const gastosHoy = (data.gastos || []).filter((g) => g.fecha === fecha()).reduce((s, g) => s + (Number(g.monto) || 0), 0);

  const compartirWhatsApp = () => {
    const txt = textoCorteWhatsApp(data.nombreNegocio, res, gastosHoy, fecha());
    try { window.open("https://wa.me/?text=" + encodeURIComponent(txt), "_blank"); }
    catch { try { navigator.clipboard.writeText(txt); toast("Resumen copiado", "ok"); } catch {} }
  };

  const hacerCorte = async () => {
    if (historial.length === 0) { toast("No hay ventas registradas hoy.", "info"); return; }
    if (!(await confirmDialog({ titulo: "Corte del día", mensaje: `Ventas: ${res.count} · Total: ${money(res.total)}. Se guardará el corte y se limpiará el historial.`, confirmar: "Hacer corte" }))) return;
    let adminPin = "";
    if (supabaseReady) {
      const pin = await pedirPin({ titulo: "Corte del día", mensaje: "Escribe el PIN de un administrador para autorizar el corte." });
      if (pin === null) return;
      adminPin = pin;
    }
    const detalle = { porTipo: res.porTipo, porMesero: res.porMesero, top: res.top, gastos: gastosHoy };
    const okMsg = await db.hacerCorte(adminPin, detalle);
    if (okMsg === false) { toast("PIN de administrador no válido.", "error"); return; }
    toast("Corte del día guardado", "ok");
  };

  return (
    <div className="screen">
      <div className="screen-head"><div><h2>Cocina</h2>
        <p className="muted">{edita ? "Comandas en preparación e historial de ventas del día." : "Vista de comandas pendientes (solo lectura)."}</p></div></div>

      {edita && (
        <div className="admin-tabs">
          <button className={tab === "pendientes" ? "on" : ""} onClick={() => setTab("pendientes")}>Pendientes · {pend.length}</button>
          <button className={tab === "historial" ? "on" : ""} onClick={() => setTab("historial")}>Historial / Corte</button>
        </div>
      )}

      {(tab === "pendientes" || !edita) && (
        <>
          {pend.length === 0 && <div className="empty">No hay comandas pendientes.</div>}
          <div className="cocina-grid">
            {pend.map((t) => {
              const tv = ticketView(t);
              const tacos = contarTacos(t);
              return (
                <div key={t.id} className={"kticket " + t.estado}>
                  <div className="kt-tipo" style={{ background: tv.color }}>{tv.label}</div>
                  <div className="kt-head"><span className="kt-origen">{t.origen}</span><span className="kt-hora">{t.hora}</span></div>
                  <div className="kt-mesero">{t.mesero}</div>
                  {t.domicilio && (
                    <div className="kt-dom">📍 {t.domicilio.direccion}{t.domicilio.referencia ? ` · ${t.domicilio.referencia}` : ""}<br />📞 {t.domicilio.telefono} · {t.domicilio.pago}</div>
                  )}
                  <div className="kt-body">
                    {t.ordenes.map((o) => (
                      <div key={o.id} className="kt-orden"><div className="kt-oname">{o.nombre}</div>
                        {o.prep && <div className="kt-prep">» {PREP_LABEL[o.prep] || o.prep}</div>}
                        {o.items.map((it) => <div key={it.key} className="kt-item"><b>{it.cantidad}×</b> {it.nombre}</div>)}</div>
                    ))}
                    {t.extras && t.extras.length > 0 && (
                      <div className="kt-extras">
                        <div className="kt-extras-h">Para todo el pedido</div>
                        {t.extras.map((it) => <div key={it.key} className="kt-item"><b>{it.cantidad}×</b> {it.corto || it.nombre}</div>)}
                      </div>
                    )}
                  </div>
                  <div className="kt-tacos">🌮 Tacos en total: <b>{tacos}</b></div>
                  {edita && (
                    <div className="kt-actions">
                      <button className="btn btn-line btn-sm" onClick={() => setTicket(t)}><Printer size={14} /> Imprimir</button>
                      {t.estado === "pendiente" && <button className="btn btn-line btn-sm" onClick={() => setEstado(t.id, "preparando")}>Preparando</button>}
                      <button className="btn btn-primary btn-sm" onClick={() => setEstado(t.id, "listo")}><Check size={14} /> Listo</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {edita && listos.length > 0 && (
            <><h3 className="sub-h">Listos</h3>
              <div className="listos-row">
                {listos.map((t) => (
                  <div key={t.id} className="listo-chip"><span>{t.origen} · {t.hora}</span>
                    <button className="icon-btn" onClick={() => quitar(t.id)}><X size={14} /></button></div>
                ))}
              </div></>
          )}
        </>
      )}

      {edita && tab === "historial" && (
        <>
          <div className="corte-bar">
            <div><div className="corte-total">{money(res.total)}</div>
              <div className="muted small">{res.count} venta(s) hoy{gastosHoy > 0 ? ` · gastos ${money(gastosHoy)} · neto ${money(res.total - gastosHoy)}` : ""}</div></div>
            <div className="corte-btns">
              <button className="btn btn-line" onClick={compartirWhatsApp} disabled={res.count === 0}>Compartir</button>
              <button className="btn btn-primary" onClick={hacerCorte}>Hacer corte</button>
            </div>
          </div>

          {res.count > 0 && (
            <div className="corte-desglose">
              <div className="cd-col">
                <h4>Por tipo</h4>
                {Object.entries(res.porTipo).map(([k, v]) => <div key={k} className="cd-row"><span>{k}</span><b>{money(v)}</b></div>)}
              </div>
              <div className="cd-col">
                <h4>Por mesero</h4>
                {Object.entries(res.porMesero).map(([k, v]) => <div key={k} className="cd-row"><span>{k}</span><b>{money(v)}</b></div>)}
              </div>
              <div className="cd-col">
                <h4>Más vendidos</h4>
                {res.top.map((p) => <div key={p.nombre} className="cd-row"><span>{p.nombre}</span><b>×{p.cant}</b></div>)}
              </div>
            </div>
          )}

          {historial.length === 0 && <div className="empty">Aún no hay ventas registradas hoy.</div>}
          <div className="hist-list">
            {historial.map((t) => {
              const tv = ticketView(t);
              return (
                <div key={t.id} className="hist-row">
                  <span className="hist-dot" style={{ background: tv.color }} />
                  <div className="hist-info">
                    <div className="hist-origen">{t.origen}{t.esExtra ? " · orden extra" : ""}</div>
                    <div className="muted small">{t.hora} · {t.mesero} · {(t.ordenes || []).reduce((a, o) => a + o.items.reduce((x, i) => x + i.cantidad, 0), 0)} prod.</div>
                  </div>
                  <div className="hist-total">{money(t.total != null ? t.total : ticketTotal(t))}</div>
                  <button className="btn btn-line btn-sm" onClick={() => setTicket(t)}><Printer size={14} /> Ver</button>
                </div>
              );
            })}
          </div>
          {(data.cortes || []).length > 0 && (
            <><h3 className="sub-h">Cortes anteriores</h3>
              <div className="hist-list">
                {data.cortes.map((c) => (
                  <div key={c.id} className="hist-row">
                    <div className="hist-info"><div className="hist-origen">Corte {c.fecha}</div>
                      <div className="muted small">{c.hora} · {c.tickets} ventas{c.detalle && c.detalle.top && c.detalle.top[0] ? ` · top: ${c.detalle.top[0].nombre}` : ""}</div></div>
                    <div className="hist-total">{money(c.total)}</div>
                  </div>
                ))}
              </div></>
          )}
        </>
      )}

      {ticket && <TicketModal t={ticket} negocio={data.nombreNegocio} onClose={() => setTicket(null)} />}
    </div>
  );
}

/* ============================== INVENTARIO ============================== */
function Inventario({ data, db }) {
  const setBebida = (id, patch) => db.updateBebida(id, patch);
  const setCarne = (id, patch) => db.updateCarne(id, patch);
  return (
    <div className="screen">
      <div className="screen-head"><div><h2>Inventario</h2>
        <p className="muted">Marca lo disponible hoy. Cuando una bebida llega a 0 desaparece del menú. Las carnes siguen apareciendo salvo que las desactives.</p></div></div>
      <h3 className="sub-h">Bebidas y aguas</h3>
      <div className="inv-list">
        {data.bebidas.map((b) => (
          <div key={b.id} className={"inv-row" + (b.cantidad === 0 ? " agotado" : "")}>
            <label className="switch"><input type="checkbox" checked={b.activo} onChange={(e) => setBebida(b.id, { activo: e.target.checked })} /><span /></label>
            <span className="inv-name">{b.nombre}</span>
            {b.cantidad === 0 && <span className="tag-agotado">Agotado</span>}
            <div className="stepper">
              <button onClick={() => setBebida(b.id, { cantidad: Math.max(0, b.cantidad - 1) })}><Minus size={14} /></button>
              <input className="qty-inp" inputMode="numeric" value={b.cantidad}
                onChange={(e) => setBebida(b.id, { cantidad: Math.max(0, parseInt(e.target.value || "0", 10)) })} />
              <button onClick={() => setBebida(b.id, { cantidad: b.cantidad + 1 })}><Plus size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      <h3 className="sub-h">Carnes</h3>
      <div className="inv-list">
        {data.carnes.map((c) => (
          <div key={c.id} className="inv-row">
            <label className="switch"><input type="checkbox" checked={c.activo} onChange={(e) => setCarne(c.id, { activo: e.target.checked })} /><span /></label>
            <span className="inv-name">{c.nombre}</span>
            <span className="muted">{c.activo ? "Disponible en el menú" : "Oculta del menú"}</span>
          </div>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 18 }}>Para agregar o quitar bebidas, carnes o productos, y cambiar precios, ve a Administración (solo el administrador).</p>
    </div>
  );
}

/* ============================== GASTOS ============================== */
function Gastos({ data, db, user }) {
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const add = () => {
    const m = parseFloat(monto); if (!concepto.trim() || isNaN(m)) return;
    db.addGasto({ id: uid(), concepto: concepto.trim(), monto: m, fecha: fecha(), hora: hora(), user: user.nombre });
    setConcepto(""); setMonto("");
  };
  const borrar = (id) => db.removeGasto(id);
  const total = data.gastos.reduce((s, g) => s + g.monto, 0);
  return (
    <div className="screen">
      <div className="screen-head"><div><h2>Gastos</h2><p className="muted">Registro de salidas de dinero del día.</p></div></div>
      <div className="gasto-add">
        <input className="inp" placeholder="Concepto" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
        <input className="inp inp-monto" placeholder="$0.00" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} />
        <button className="btn btn-add" onClick={add}><Plus size={16} /> Registrar</button>
      </div>
      <div className="gasto-total">Total registrado: <b>${total.toFixed(2)}</b></div>
      <div className="gasto-list">
        {data.gastos.length === 0 && <div className="empty">Aún no hay gastos.</div>}
        {data.gastos.map((g) => (
          <div key={g.id} className="gasto-row">
            <div><div className="gasto-concepto">{g.concepto}</div>
              <div className="muted small">{g.fecha} · {g.hora} · {g.user}</div></div>
            <div className="gasto-monto">${g.monto.toFixed(2)}</div>
            <button className="icon-btn" onClick={() => borrar(g.id)}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== ADMINISTRACIÓN (solo admin) ============================== */
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || uid();
const num = (v) => Math.max(0, parseFloat(v || "0") || 0);

const CAT_LABELS = {
  taco: "Tacos", quesa: "Quesadillas / Gringas", volcan: "Volcanes", costra: "Especialidad — Costra",
};

function Admin({ data, db, user }) {
  const [tab, setTab] = useState("precios");
  return (
    <div className="screen">
      <div className="screen-head"><div><h2>Administración</h2>
        <p className="muted">Solo el administrador. Aquí defines precios, productos y usuarios.</p></div></div>
      <div className="admin-tabs">
        {[["precios", "Precios"], ["productos", "Productos"], ["meseros", "Usuarios"]].map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "precios" && <AdminPrecios data={data} db={db} />}
      {tab === "productos" && <AdminProductos data={data} db={db} />}
      {tab === "meseros" && <AdminMeseros data={data} db={db} user={user} />}
    </div>
  );
}

function AdminPrecios({ data, db }) {
  const setPrecio = (key, v) => db.setPrecio(key, num(v));
  const setExtra = (id, v) => db.setExtraPrecio(id, num(v));
  const setBeb = (id, v) => db.updateBebida(id, { precio: num(v) });

  const grupos = {
    taco: [
      ...data.carnes.map((c) => ({ key: `taco-${c.id}`, nombre: `Taco ${c.nombre}` })),
      { key: "quesa-maiz-queso", nombre: "Quesadilla de maíz (queso)" },
      ...data.carnes.map((c) => ({ key: `taco-queso-${c.id}`, nombre: `Taco de queso ${c.nombre}` })),
    ],
    quesa: [
      ...data.carnes.map((c) => ({ key: `gringa-${c.id}`, nombre: `Gringa ${c.nombre}` })),
      ...data.carnes.map((c) => ({ key: `llenadora-${c.id}`, nombre: `Llenadora ${c.nombre}` })),
      { key: "quesa-queso", nombre: "Quesadilla de queso" },
    ],
    volcan: [
      ...data.carnes.map((c) => ({ key: `volcan-${c.id}`, nombre: `Volcán ${c.nombre}` })),
      { key: "volcan-queso", nombre: "Volcán de queso" },
    ],
    costra: [
      ...data.carnes.map((c) => ({ key: `costra-${c.id}`, nombre: `Costra ${c.nombre}` })),
      { key: "costra-queso", nombre: "Costra de queso" },
      ...data.carnes.map((c) => ({ key: `media-costra-${c.id}`, nombre: `Media costra ${c.nombre}` })),
      { key: "media-costra-queso", nombre: "Media costra de queso" },
    ],
  };
  const empaqueRows = [
    { key: "bolsa-verdura", nombre: "Bolsa de verdura (zanahoria, pepino, limón)" },
    { key: "tortilla-harina", nombre: "Tortillas extra (harina)" },
    { key: "tortilla-maiz", nombre: "Tortillas extra (maíz)" },
  ];

  return (
    <div>
      {Object.entries(grupos).map(([cat, rows]) => (
        <div key={cat}>
          <h3 className="sub-h" style={{ color: CATS[cat].color }}>{CAT_LABELS[cat]}</h3>
          <div className="precio-list">
            {rows.map((r) => (
              <PrecioRow key={r.key} nombre={r.nombre} value={data.precios[r.key] ?? 0} onChange={(v) => setPrecio(r.key, v)} />
            ))}
            {data.extras.filter((e) => e.cat === cat).map((e) => (
              <PrecioRow key={e.id} nombre={e.nombre + " (extra)"} value={e.precio} onChange={(v) => setExtra(e.id, v)} />
            ))}
          </div>
        </div>
      ))}
      <h3 className="sub-h" style={{ color: CATS.bebida.color }}>Refrescos y aguas</h3>
      <div className="precio-list">
        {data.bebidas.map((b) => (
          <PrecioRow key={b.id} nombre={b.nombre} value={b.precio ?? 0} onChange={(v) => setBeb(b.id, v)} />
        ))}
      </div>
      <h3 className="sub-h" style={{ color: CATS.empaque.color }}>Para llevar / empaque</h3>
      <p className="muted small">La "verdura aparte" siempre es sin costo.</p>
      <div className="precio-list">
        {empaqueRows.map((r) => (
          <PrecioRow key={r.key} nombre={r.nombre} value={data.precios[r.key] ?? 0} onChange={(v) => setPrecio(r.key, v)} />
        ))}
      </div>
    </div>
  );
}

function PrecioRow({ nombre, value, onChange }) {
  return (
    <div className="precio-row">
      <span className="precio-nombre">{nombre}</span>
      <div className="precio-input">
        <span>$</span>
        <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

function CatCategoria({ titulo, cat, base, extras, ocultos, onToggle, onAdd, onDelExtra }) {
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState("");
  const agregar = () => { if (!nombre.trim()) return; onAdd(cat, nombre.trim(), precio); setNombre(""); setPrecio(""); };
  return (
    <div>
      <h3 className="sub-h" style={{ color: CATS[cat].color }}>{titulo}</h3>
      <div className="inv-list">
        {base.map((it) => {
          const oculto = ocultos.includes(it.key);
          return (
            <div key={it.key} className={"inv-row" + (oculto ? " agotado" : "")}>
              <label className="switch"><input type="checkbox" checked={!oculto} onChange={() => onToggle(it.key)} /><span /></label>
              <span className="inv-name">{it.nombre}</span>
              {oculto && <span className="muted">oculto del menú</span>}
            </div>
          );
        })}
        {extras.map((e) => (
          <div key={e.id} className="inv-row">
            <span className="inv-name">{e.nombre} <span className="muted">(agregado)</span></span>
            <button className="btn btn-danger-ghost btn-sm" onClick={() => onDelExtra(e.id)}><Trash2 size={14} /> Quitar</button>
          </div>
        ))}
      </div>
      <div className="prod-add">
        <input className="inp" placeholder={`Agregar en ${titulo}`} value={nombre}
          onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} />
        <input className="inp inp-sm" inputMode="decimal" placeholder="Precio" value={precio} onChange={(e) => setPrecio(e.target.value)} />
        <button className="btn btn-add" onClick={agregar}><Plus size={16} /></button>
      </div>
    </div>
  );
}

function AdminProductos({ data, db }) {
  const [carne, setCarne] = useState("");
  const [beb, setBeb] = useState({ nombre: "", precio: "", cantidad: "" });
  const base = catalogoBase(data.carnes);
  const ocultos = data.ocultos || [];

  const addCarne = () => {
    const n = carne.trim(); if (!n) return;
    const id = slug(n);
    if (data.carnes.some((c) => c.id === id)) { toast("Esa carne ya existe.", "error"); return; }
    db.addCarne(n);
    toast(`Carne "${n}" agregada`, "ok");
    setCarne("");
  };
  const quitarCarne = async (id) => {
    if (!(await confirmDialog({ titulo: "Quitar carne", mensaje: "¿Quitar esta carne y todos sus productos del menú?", confirmar: "Quitar", peligro: true }))) return;
    db.removeCarne(id);
  };

  const toggleOculto = (key) => db.toggleOculto(key);
  const addExtraEn = (cat, nombre, precio) => db.addExtra(cat, nombre, num(precio));
  const quitarExtra = (id) => db.removeExtra(id);

  const addBeb = () => {
    const n = beb.nombre.trim(); if (!n) return;
    db.addBebida({ id: uid(), nombre: n, cantidad: num(beb.cantidad), activo: true, precio: num(beb.precio) });
    setBeb({ nombre: "", precio: "", cantidad: "" });
  };
  const quitarBeb = (id) => db.removeBebida(id);
  const toggleBeb = (id) => { const b = data.bebidas.find((x) => x.id === id); if (b) db.updateBebida(id, { activo: !b.activo }); };

  const cats = [["taco", "Tacos"], ["quesa", "Quesadillas / Gringas"], ["volcan", "Volcanes"], ["costra", "Especialidad — Costra"]];

  return (
    <div>
      <h3 className="sub-h">Carnes</h3>
      <p className="muted small">Cada carne genera taco, gringa, llenadora, volcán, costra y media costra. Quitarla elimina todos sus productos.</p>
      <div className="inv-list">
        {data.carnes.map((c) => (
          <div key={c.id} className="inv-row">
            <span className="inv-name">{c.nombre}</span>
            <button className="btn btn-danger-ghost btn-sm" onClick={() => quitarCarne(c.id)}><Trash2 size={14} /> Quitar</button>
          </div>
        ))}
      </div>
      <div className="inv-add">
        <input className="inp" placeholder="Nueva carne (ej. Suadero)" value={carne}
          onChange={(e) => setCarne(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCarne()} />
        <button className="btn btn-add" onClick={addCarne}><Plus size={16} /> Agregar carne</button>
      </div>

      <p className="muted small" style={{ marginTop: 18 }}>Usa el interruptor para mostrar u ocultar un producto del menú, o "Quitar" para borrar uno agregado. Abajo de cada categoría puedes agregar uno nuevo.</p>
      {cats.map(([cat, titulo]) => (
        <CatCategoria key={cat} titulo={titulo} cat={cat} base={base[cat]}
          extras={data.extras.filter((e) => e.cat === cat)} ocultos={ocultos}
          onToggle={toggleOculto} onAdd={addExtraEn} onDelExtra={quitarExtra} />
      ))}

      <h3 className="sub-h" style={{ color: CATS.bebida.color }}>Refrescos y bebidas</h3>
      <div className="inv-list">
        {data.bebidas.map((b) => (
          <div key={b.id} className="inv-row">
            <label className="switch"><input type="checkbox" checked={b.activo} onChange={() => toggleBeb(b.id)} /><span /></label>
            <span className="inv-name">{b.nombre}</span>
            <span className="muted">{money(b.precio)}</span>
            <button className="btn btn-danger-ghost btn-sm" onClick={() => quitarBeb(b.id)}><Trash2 size={14} /> Quitar</button>
          </div>
        ))}
      </div>
      <div className="prod-add">
        <input className="inp" placeholder="Nuevo refresco / agua" value={beb.nombre} onChange={(e) => setBeb({ ...beb, nombre: e.target.value })} />
        <input className="inp inp-sm" inputMode="decimal" placeholder="Precio" value={beb.precio} onChange={(e) => setBeb({ ...beb, precio: e.target.value })} />
        <input className="inp inp-sm" inputMode="numeric" placeholder="Existencia" value={beb.cantidad} onChange={(e) => setBeb({ ...beb, cantidad: e.target.value })} />
        <button className="btn btn-add" onClick={addBeb}><Plus size={16} /></button>
      </div>
    </div>
  );
}

function AdminMeseros({ data, db, user }) {
  const [nuevo, setNuevo] = useState({ nombre: "", pin: "", rol: "mesero" });
  const admins = data.usuarios.filter((u) => u.rol === "admin").length;

  const add = async () => {
    const n = nuevo.nombre.trim(); const p = nuevo.pin.trim();
    if (!n || p.length < 4) { toast("Nombre y PIN de al menos 4 dígitos.", "error"); return; }
    let adminPin = "";
    if (supabaseReady) {
      const pin = await pedirPin({ titulo: "Crear usuario", mensaje: "Escribe tu PIN de administrador para autorizar." });
      if (pin === null) return; adminPin = pin;
    }
    const ok = await db.crearUsuario({ id: uid(), nombre: n, pin: p, rol: nuevo.rol }, adminPin);
    if (ok === false) { toast("PIN de administrador no válido.", "error"); return; }
    toast(`Usuario "${n}" creado`, "ok");
    setNuevo({ nombre: "", pin: "", rol: "mesero" });
  };
  const quitar = async (u) => {
    if (u.id === user.id) { toast("No puedes eliminar tu propio usuario.", "error"); return; }
    if (u.rol === "admin" && admins <= 1) { toast("Debe quedar al menos un administrador.", "error"); return; }
    if (!(await confirmDialog({ titulo: "Eliminar usuario", mensaje: `¿Eliminar a ${u.nombre}?`, confirmar: "Eliminar", peligro: true }))) return;
    let adminPin = "";
    if (supabaseReady) {
      const pin = await pedirPin({ titulo: "Eliminar usuario", mensaje: "Escribe tu PIN de administrador para autorizar." });
      if (pin === null) return; adminPin = pin;
    }
    const ok = await db.eliminarUsuario(u.id, adminPin);
    if (ok === false) { toast("PIN de administrador no válido.", "error"); return; }
    toast("Usuario eliminado", "ok");
  };

  return (
    <div>
      <div className="inv-list">
        {data.usuarios.map((u) => (
          <div key={u.id} className="inv-row">
            <span className="inv-name">{u.nombre}</span>
            <span className={"rol-tag " + u.rol}>{ROLES[u.rol] || u.rol}</span>
            <button className="btn btn-danger-ghost btn-sm" onClick={() => quitar(u)}><Trash2 size={14} /> Quitar</button>
          </div>
        ))}
      </div>
      <h3 className="sub-h">Agregar usuario</h3>
      <div className="prod-add">
        <input className="inp" placeholder="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
        <input className="inp inp-sm" inputMode="numeric" placeholder="PIN" value={nuevo.pin} onChange={(e) => setNuevo({ ...nuevo, pin: e.target.value })} />
        <select className="inp inp-sm" value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>
          <option value="mesero">Mesero</option>
          <option value="cocinero">Cocinero</option>
          <option value="admin">Administrador</option>
        </select>
        <button className="btn btn-add" onClick={add}><Plus size={16} /></button>
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        El <b>Mesero</b> toma órdenes y ve cocina/inventario. El <b>Cocinero</b> solo ve mesas y cocina. El <b>Administrador</b> controla precios, productos y usuarios.
      </p>
    </div>
  );
}

/* ============================== ESTILOS ============================== */
const CSS = `
:root{
  --agave:#173A2F; --agave2:#21513F;
  --lima:#7FA63B; --maiz:#D99A22; --barro:#B9522B;
  --especial:#7A2E2E; --agua:#2D7E9E; --empaque:#5E8C4A;
  --crema:#FAF4E8; --papel:#FFFFFF; --tinta:#222820; --tinta2:#6A7163;
  --linea:#E6DEC9; --ok:#2E7D5B; --alerta:#C0392B;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
html,body,#root{height:100%;margin:0;}
.app{height:100vh;display:flex;flex-direction:column;background:var(--crema);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--tinta);}
.loading{display:flex;height:100vh;align-items:center;justify-content:center;color:var(--tinta2);}
button{font-family:inherit;cursor:pointer;}
.muted{color:var(--tinta2);} .small{font-size:12px;}

/* LOGIN */
.login{height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 30% 20%,#21513F,#143028);}
.login-card{background:var(--papel);border-radius:22px;padding:34px 30px;width:min(420px,92vw);box-shadow:0 24px 60px rgba(0,0,0,.35);text-align:center;}
.brand-mark{font-size:44px;} .brand-title{margin:6px 0 0;font-size:30px;letter-spacing:-.5px;}
.brand-sub{margin:2px 0 22px;color:var(--tinta2);}
.login-users{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:18px;}
.user-chip{border:2px solid var(--linea);background:var(--crema);padding:12px 18px;border-radius:12px;font-size:16px;font-weight:600;color:var(--tinta);}
.user-chip.on{border-color:var(--agave);background:var(--agave);color:#fff;}
.pin-input{width:100%;padding:14px;border:2px solid var(--linea);border-radius:12px;font-size:20px;text-align:center;letter-spacing:6px;margin-bottom:12px;}
.login-err{color:var(--alerta);margin-bottom:10px;font-weight:600;}
.login-hint{margin-top:16px;font-size:12px;color:var(--tinta2);}

/* TOPBAR */
.topbar{display:flex;align-items:center;gap:14px;background:var(--agave);color:#fff;padding:10px 16px;flex-wrap:wrap;}
.topbar-brand{display:flex;align-items:center;gap:8px;font-weight:800;font-size:18px;}
.conn-dot{width:9px;height:9px;border-radius:50%;flex:none;box-shadow:0 0 0 2px rgba(255,255,255,.2);}
/* ---- Avisos de cocina ---- */
.cocina-alertas{position:sticky;top:0;z-index:30;display:flex;flex-direction:column;gap:6px;padding:8px 12px;background:var(--crema);border-bottom:1px solid var(--linea);}
.alerta-permiso{background:var(--maiz);color:#fff;border:0;border-radius:10px;padding:10px;font-weight:700;cursor:pointer;}
.alerta-pedido{display:flex;align-items:center;gap:8px;background:#fff;border:1.5px solid var(--ok);border-radius:12px;padding:8px 10px;animation:toastIn .2s ease;}
.alerta-pedido.extra{border-color:var(--especial);}
.alerta-txt{flex:1;font-size:14px;}
.topbar-cactus{font-size:22px;}
.topbar-nav{display:flex;gap:6px;flex:1;flex-wrap:wrap;}
.nav-btn{display:flex;align-items:center;gap:7px;background:transparent;border:none;color:#cfe3d8;padding:9px 13px;border-radius:11px;font-size:14px;font-weight:600;position:relative;}
.nav-btn.on{background:rgba(255,255,255,.16);color:#fff;}
.nav-btn.ghost{padding:9px;}
.badge{position:absolute;top:-2px;right:-2px;background:var(--barro);color:#fff;border-radius:10px;font-size:11px;font-style:normal;padding:1px 6px;}
.topbar-user{display:flex;align-items:center;gap:8px;}
.user-name{font-weight:600;font-size:14px;}

.main{flex:1;overflow:auto;min-height:0;}

/* SCREENS */
.screen{padding:22px;max-width:1100px;margin:0 auto;}
.screen-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;}
.screen-head h2{margin:0;font-size:26px;} .screen-head .muted{margin:4px 0 18px;}
.screen-actions{display:flex;gap:8px;flex-wrap:wrap;}
.sub-h{margin:26px 0 12px;font-size:18px;}
.empty{padding:30px;text-align:center;color:var(--tinta2);background:var(--papel);border:1px dashed var(--linea);border-radius:14px;}

/* MESAS */
.mesas-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;}
.mesa-card{background:var(--papel);border:2px solid var(--linea);border-radius:16px;padding:18px;min-height:130px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:transform .08s;}
.mesa-card:active{transform:scale(.97);}
.mesa-card.ocupada{border-color:var(--barro);background:#FBEDE6;}
.mesa-num{font-size:40px;font-weight:800;line-height:1;}
.mesa-estado{font-size:13px;font-weight:700;color:var(--tinta2);text-transform:uppercase;letter-spacing:1px;}
.mesa-card.ocupada .mesa-estado{color:var(--barro);}
.mesa-info{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:11px;color:var(--tinta2);margin-top:6px;text-align:center;}
.mesa-mesero{background:var(--barro);color:#fff;padding:3px 10px;border-radius:8px;font-weight:700;font-size:12px;}

.especial-card{background:var(--papel);}
.especial-card.llevar{border-color:var(--maiz);color:var(--maiz);}
.especial-card.llevar:active{background:#FBF1DD;}
.especial-card.domicilio{border-color:var(--barro);color:var(--barro);}
.especial-card.domicilio:active{background:#FBEDE6;}
.especial-card-label{font-size:17px;font-weight:800;margin-top:8px;}
.especial-badge{margin-top:4px;background:var(--barro);color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:8px;}

.type-fixed{display:flex;align-items:center;gap:6px;background:var(--tc);color:#fff;padding:9px 16px;border-radius:12px;font-weight:800;font-size:15px;}
.mesa-chip{background:var(--agave);color:#fff;padding:8px 14px;border-radius:12px;font-weight:800;font-size:15px;}
.ocupada-bar{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#FBEDE6;border-bottom:1px solid var(--linea);padding:8px 16px;font-size:14px;color:var(--barro);}
.ocupada-bar b{color:var(--tinta);}

/* COMANDA */
.comanda-wrap{height:100%;display:flex;flex-direction:column;min-height:0;}
.type-bar{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--papel);border-bottom:1px solid var(--linea);flex-wrap:wrap;}
.type-btns{display:flex;gap:8px;flex:1;flex-wrap:wrap;}
.type-btn{display:flex;align-items:center;gap:6px;border:2px solid var(--linea);background:#fff;color:var(--tinta);padding:9px 14px;border-radius:12px;font-weight:700;font-size:14px;position:relative;}
.type-btn.on{border-color:var(--tc);background:var(--tc);color:#fff;}
.type-check{background:#fff;color:var(--ok);border-radius:50%;}
.mesa-select{border:2px solid var(--linea);border-radius:12px;padding:9px 12px;font-size:14px;font-weight:700;background:#fff;}
.type-banner{color:#fff;text-align:center;font-weight:800;font-size:20px;letter-spacing:.5px;padding:8px;text-transform:uppercase;}

.comanda{flex:1;display:grid;grid-template-columns:1fr 380px;min-height:0;}
.menu-pane{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--linea);}
.menu-pane-scroll{flex:1;overflow:auto;padding:14px;contain:content;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}
.menu-inner{display:flex;flex-direction:column;gap:14px;}
.cols-3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.menu-col{background:var(--papel);border-radius:14px;border:1px solid var(--linea);overflow:hidden;}
.col-head{background:var(--cat);color:#fff;padding:9px 12px;font-weight:700;font-size:14px;}
.col-items{padding:8px;display:flex;flex-direction:column;gap:7px;}
.item-btn{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;border:1.5px solid var(--linea);background:#fff;border-radius:10px;padding:10px 12px;font-size:14px;font-weight:600;color:var(--tinta);min-height:46px;border-left:5px solid var(--cat);transition:transform .06s,background .1s;}
.item-btn:active{transform:scale(.97);background:var(--crema);}
.item-nombre{flex:1;}
.item-precio{font-weight:800;color:var(--cat);font-size:13px;white-space:nowrap;}
.especial{background:var(--papel);border:1px solid var(--linea);border-radius:14px;overflow:hidden;}
.especial-head{background:var(--especial);color:#fff;padding:9px 14px;font-weight:700;}
.especial-items{padding:10px;display:flex;flex-wrap:wrap;gap:8px;}
.especial-items .item-btn{flex:1;min-width:140px;--cat:var(--especial);}
.bebidas-box{background:var(--papel);border:1px solid var(--linea);border-radius:14px;overflow:hidden;}
.bebidas-head{background:var(--agua);color:#fff;padding:9px 14px;font-weight:700;}
.bebidas-items{padding:10px;display:flex;flex-wrap:wrap;gap:8px;}
.bebidas-items .item-btn{flex:1;min-width:130px;--cat:var(--agua);}

.ticket-pane{display:flex;flex-direction:column;background:var(--papel);min-height:0;overflow:hidden;}
.ticket-inner{flex:1;display:flex;flex-direction:column;min-height:0;}
.ticket-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--linea);background:var(--crema);}
.ticket-origen{font-size:18px;font-weight:800;} .ticket-mesero{font-size:12px;color:var(--tinta2);}
.dom-resumen{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:#FBEDE6;border:none;border-bottom:1px solid var(--linea);padding:10px 16px;font-size:13px;color:var(--barro);font-weight:600;}
.dom-resumen span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ticket-scroll{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;contain:content;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}

.orden{border:1.5px solid var(--linea);border-radius:12px;padding:10px;background:#fff;}
.orden.activa{border-color:var(--agave);box-shadow:0 0 0 2px rgba(23,58,47,.12);}
.orden-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}
.orden-name{background:none;border:none;font-weight:800;font-size:15px;display:flex;align-items:center;gap:5px;color:var(--tinta);}
.orden-input{font-weight:800;font-size:15px;border:1px solid var(--agave);border-radius:6px;padding:3px 6px;}
.orden-right{display:flex;align-items:center;gap:8px;}
.orden-count{background:var(--agave);color:#fff;border-radius:20px;min-width:24px;text-align:center;font-size:12px;font-weight:700;padding:2px 6px;}
.orden-empty{font-size:12px;color:var(--tinta2);font-style:italic;padding:4px 2px;}
.orden-prep{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:9px;padding-top:9px;border-top:1px dashed var(--linea);}
.orden-prep-label{font-size:11px;font-weight:700;color:var(--tinta2);margin-right:2px;}
.prep-chip{border:1.5px solid var(--linea);background:#fff;border-radius:20px;padding:5px 11px;font-size:12px;font-weight:700;color:var(--tinta2);}
.prep-chip.on{background:var(--agave);border-color:var(--agave);color:#fff;}
.orden-extras{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:8px;}
.extra-chip{display:flex;align-items:center;gap:3px;border:1.5px solid var(--cat);background:#fff;color:var(--cat);border-radius:20px;padding:6px 11px;font-size:12px;font-weight:700;}
.extra-chip:active{background:#EEF3E8;}
.ref-input{flex:1;min-width:120px;border:2px solid var(--linea);border-radius:12px;padding:9px 12px;font-size:14px;font-weight:600;background:#fff;}
.ref-input:focus{outline:none;border-color:var(--maiz);}
.pedido-extras{border:1.5px dashed var(--empaque);border-radius:12px;padding:10px;margin-top:4px;background:#F4F8EF;}
.pedido-extras-head{font-weight:800;font-size:13px;color:var(--empaque);margin-bottom:8px;}
.pedido-extras-add{display:flex;flex-wrap:wrap;gap:6px;}
.kt-extras{border-top:1px dashed var(--linea);margin-top:4px;padding-top:6px;}
.kt-extras-h{font-weight:800;font-size:12px;color:var(--empaque);margin-bottom:3px;}
.tp-extras-h{font-weight:800;font-size:12px;margin-bottom:3px;}
.orden-items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px;}
.oitem{display:flex;align-items:center;gap:8px;font-size:13px;}
.oitem-dot{width:9px;height:9px;border-radius:50%;background:var(--cat);flex:none;}
.oitem-name{flex:1;}
.oitem-precio{font-weight:700;font-size:12px;color:var(--tinta2);white-space:nowrap;}
.stepper{display:flex;align-items:center;gap:2px;border:1px solid var(--linea);border-radius:8px;overflow:hidden;}
.stepper button{border:none;background:var(--crema);width:30px;height:30px;display:flex;align-items:center;justify-content:center;color:var(--tinta);}
.stepper button:active{background:var(--linea);}
.stepper span{min-width:24px;text-align:center;font-weight:700;font-size:13px;}
.icon-btn{border:none;background:none;color:var(--tinta2);padding:4px;display:flex;}
.icon-btn:active{color:var(--alerta);}

.footer-izq,.footer-der{display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--linea);background:var(--papel);}
.footer-izq .btn,.footer-der .btn{flex:1;}
.ticket-extra{display:flex;gap:8px;padding:0 14px 12px;}
.ticket-extra .btn{flex:1;}

/* BOTONES */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:none;border-radius:11px;padding:12px 16px;font-size:14px;font-weight:700;transition:transform .06s,opacity .1s;}
.btn:active{transform:scale(.97);} .btn:disabled{opacity:.4;}
.btn-sm{padding:8px 12px;font-size:13px;} .btn-block{width:100%;margin-top:8px;}
.btn-primary{background:var(--agave);color:#fff;}
.btn-add{background:var(--lima);color:#fff;}
.btn-maiz{background:var(--maiz);color:#fff;}
.btn-barro{background:var(--barro);color:#fff;}
.btn-line{background:#fff;border:1.5px solid var(--agave);color:var(--agave);}
.btn-ghost{background:var(--crema);color:var(--tinta);border:1px solid var(--linea);}
.btn-danger-ghost{background:#fff;border:1.5px solid var(--alerta);color:var(--alerta);}
.btn-danger{background:var(--alerta);color:#fff;}

/* INPUTS */
.inp{border:1.5px solid var(--linea);border-radius:10px;padding:11px 12px;font-size:15px;width:100%;background:#fff;}
.inp:focus{outline:none;border-color:var(--agave);}

/* PESTAÑAS CELULAR */
.pane-toggle{display:flex;gap:6px;padding:8px 12px;background:var(--papel);border-bottom:1px solid var(--linea);}
.pane-toggle button{flex:1;border:none;background:var(--crema);border-radius:10px;padding:11px;font-weight:700;font-size:14px;color:var(--tinta2);}
.pane-toggle button.on{background:var(--agave);color:#fff;}
.pane-scroll{flex:1;overflow:auto;min-height:0;padding:14px;contain:content;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}
.phone-footer{border-top:1px solid var(--linea);background:var(--papel);}
.phone-footer .footer-izq,.phone-footer .footer-der{border-top:none;}

/* COCINA */
.cocina-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;contain:content;}
.kticket{background:var(--papel);border:1px solid var(--linea);border-radius:14px;overflow:hidden;}
.kt-tipo{color:#fff;font-weight:800;font-size:13px;text-transform:uppercase;letter-spacing:.5px;padding:6px 12px;}
.kt-head{display:flex;justify-content:space-between;align-items:center;padding:8px 12px 0;}
.kt-origen{font-weight:800;font-size:16px;} .kt-hora{font-size:12px;color:var(--tinta2);}
.kt-mesero{font-size:12px;color:var(--tinta2);padding:0 12px 6px;}
.kt-dom{font-size:12px;color:var(--barro);padding:0 12px 6px;line-height:1.5;}
.kt-body{display:flex;flex-direction:column;gap:8px;padding:0 12px 10px;}
.kt-orden{background:var(--crema);border-radius:8px;padding:7px 9px;}
.kt-oname{font-weight:700;font-size:13px;margin-bottom:3px;}
.kt-item{font-size:13px;}
.kt-actions{display:flex;gap:6px;padding:0 12px 12px;} .kt-actions .btn{flex:1;}
.kt-tacos{margin:0 12px 10px;background:var(--crema);border:1px dashed var(--barro);border-radius:9px;padding:6px 10px;font-size:13px;font-weight:700;color:var(--barro);text-align:center;}
.kt-tacos b{font-size:16px;}
.corte-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--papel);border:1px solid var(--linea);border-radius:14px;padding:14px 16px;margin-bottom:14px;}
.corte-total{font-size:26px;font-weight:800;color:var(--agave);line-height:1;}
.corte-btns{display:flex;gap:8px;flex:none;}
.corte-desglose{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px;}
.cd-col{background:var(--papel);border:1px solid var(--linea);border-radius:12px;padding:12px 14px;}
.cd-col h4{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--tinta2);}
.cd-row{display:flex;justify-content:space-between;gap:8px;padding:3px 0;font-size:14px;}
.pin-input{width:100%;box-sizing:border-box;margin:6px 0 4px;padding:12px 14px;font-size:20px;letter-spacing:.3em;text-align:center;border:1.5px solid var(--linea);border-radius:12px;background:var(--crema);}
.hist-list{display:flex;flex-direction:column;gap:8px;}
.hist-row{display:flex;align-items:center;gap:10px;background:var(--papel);border:1px solid var(--linea);border-radius:12px;padding:10px 12px;}
.hist-dot{width:10px;height:10px;border-radius:50%;flex:none;}
.hist-info{flex:1;min-width:0;}
.hist-origen{font-weight:700;font-size:14px;}
.hist-total{font-weight:800;color:var(--barro);}
.resumen-scroll{flex:1;overflow:auto;padding:14px;min-height:0;contain:content;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}
.resumen-h{margin:0 0 10px;font-size:16px;}
.resumen-orden{background:var(--papel);border:1px solid var(--linea);border-radius:12px;padding:10px 12px;margin-bottom:8px;}
.resumen-oname{font-weight:800;font-size:14px;margin-bottom:4px;}
.resumen-item{font-size:13px;}
.resumen-item span{font-weight:700;display:inline-block;min-width:26px;}
.resumen-actions{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-top:1px solid var(--linea);background:var(--papel);}
.resumen-extra{border:1px solid var(--especial);border-radius:12px;padding:8px 10px 4px;margin-bottom:8px;background:rgba(180,40,40,.05);}
.resumen-extra-h{font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--especial);margin-bottom:6px;}
.listos-row{display:flex;flex-wrap:wrap;gap:8px;}
.listo-chip{display:flex;align-items:center;gap:8px;background:#EAF3EE;border:1px solid #CFE3D8;border-radius:20px;padding:6px 8px 6px 14px;font-size:13px;color:var(--ok);font-weight:600;}

/* INVENTARIO */
.inv-list{display:flex;flex-direction:column;gap:8px;}
.inv-row{display:flex;align-items:center;gap:12px;background:var(--papel);border:1px solid var(--linea);border-radius:12px;padding:10px 14px;}
.inv-row.agotado{background:#FBEDE6;border-color:#E9C3B2;}
.inv-name{font-weight:700;flex:1;}
.tag-agotado{background:var(--alerta);color:#fff;font-size:11px;padding:2px 8px;border-radius:8px;font-weight:700;}
.qty-inp{width:46px;text-align:center;border:none;font-weight:700;font-size:14px;background:transparent;}
.inv-add{display:flex;gap:8px;margin-top:12px;} .inv-add .inp{flex:1;}
.switch{position:relative;display:inline-block;width:44px;height:26px;flex:none;}
.switch input{opacity:0;width:0;height:0;}
.switch span{position:absolute;inset:0;background:#cdd3c6;border-radius:20px;transition:.2s;}
.switch span:before{content:"";position:absolute;width:20px;height:20px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s;}
.switch input:checked + span{background:var(--ok);}
.switch input:checked + span:before{transform:translateX(18px);}

/* GASTOS */
.gasto-add{display:flex;gap:8px;flex-wrap:wrap;} .gasto-add .inp{flex:1;min-width:140px;} .inp-monto{max-width:120px;flex:none;}
.gasto-total{margin:14px 0;font-size:16px;}
.gasto-list{display:flex;flex-direction:column;gap:8px;}
.gasto-row{display:flex;align-items:center;gap:12px;background:var(--papel);border:1px solid var(--linea);border-radius:12px;padding:10px 14px;}
.gasto-concepto{font-weight:700;} .gasto-monto{margin-left:auto;font-weight:800;color:var(--barro);}

/* MODALES */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:50;padding:20px;}
.modal{background:#fff;border-radius:16px;width:min(380px,94vw);max-height:90vh;overflow:auto;}
.modal-dom{width:min(440px,94vw);}
.modal-head{display:flex;align-items:center;gap:10px;padding:16px;border-bottom:1px solid var(--linea);}
.modal-head h3{margin:0;flex:1;font-size:18px;}
.modal-body{padding:16px;display:flex;flex-direction:column;gap:4px;}
.modal-body label{font-size:12px;font-weight:700;color:var(--tinta2);margin-top:8px;}
.dom-row{display:flex;gap:10px;}
.modal-actions{display:flex;gap:8px;padding:14px;border-top:1px solid var(--linea);} .modal-actions .btn{flex:1;}

/* ---- Modal de confirmación ---- */
.modal-confirm{width:min(360px,92vw);}
.confirm-title{margin:0;padding:18px 18px 0;font-size:18px;}
.confirm-msg{margin:0;padding:10px 18px 4px;color:var(--tinta);line-height:1.5;}

/* ---- Cuentas separadas ---- */
.cuentas-list{padding:16px;display:flex;flex-direction:column;gap:8px;}
.cuenta-row{display:flex;align-items:center;gap:10px;width:100%;background:var(--crema);border:1px solid var(--linea);border-radius:12px;padding:12px 14px;cursor:pointer;text-align:left;}
.cuenta-row:hover{border-color:var(--agave);}
.cuenta-name{flex:1;font-weight:700;color:var(--tinta);}
.cuenta-sub{font-weight:800;color:var(--agave);}

/* ---- Toasts ---- */
.toaster{position:fixed;left:0;right:0;bottom:18px;display:flex;flex-direction:column;align-items:center;gap:8px;z-index:90;pointer-events:none;padding:0 16px;}
.toast{pointer-events:auto;max-width:440px;width:fit-content;background:var(--tinta);color:#fff;padding:12px 18px;border-radius:12px;font-size:14px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.25);animation:toastIn .22s ease;cursor:pointer;}
.toast.ok{background:var(--ok);}
.toast.error{background:var(--alerta);}
.toast.info{background:var(--agave2);}
@keyframes toastIn{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
.ticket-total{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-top:2px solid var(--agave);background:var(--crema);font-size:16px;font-weight:700;}
.ticket-total b{font-size:22px;color:var(--agave);}

/* ADMIN */
.admin-tabs{display:flex;gap:6px;margin-bottom:18px;flex-wrap:wrap;}
.admin-tabs button{border:none;background:var(--papel);border:1.5px solid var(--linea);border-radius:11px;padding:10px 18px;font-weight:700;font-size:14px;color:var(--tinta2);}
.admin-tabs button.on{background:var(--agave);border-color:var(--agave);color:#fff;}
.precio-list{display:flex;flex-direction:column;gap:6px;}
.precio-row{display:flex;align-items:center;gap:12px;background:var(--papel);border:1px solid var(--linea);border-radius:10px;padding:8px 14px;}
.precio-nombre{flex:1;font-weight:600;font-size:14px;}
.precio-input{display:flex;align-items:center;gap:2px;border:1.5px solid var(--linea);border-radius:9px;padding:4px 10px;background:#fff;font-weight:700;}
.precio-input span{color:var(--tinta2);}
.precio-input input{width:64px;border:none;font-size:15px;font-weight:700;text-align:right;background:transparent;}
.precio-input input:focus{outline:none;}
.prod-add{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}
.prod-add .inp{flex:1;min-width:140px;}
.inp-sm{flex:none;max-width:120px;}
.rol-tag{font-size:11px;font-weight:700;padding:3px 10px;border-radius:8px;}
.rol-tag.admin{background:var(--agave);color:#fff;}
.rol-tag.mesero{background:var(--linea);color:var(--tinta);}
.rol-tag.cocinero{background:var(--barro);color:#fff;}
.mesa-card.solo-ver{cursor:default;}

/* ---- TICKET TÉRMICO 58mm ---- */
.modal-ticket{max-width:300px;}
.ticket-print{font-family:"Courier New",monospace;color:#000;background:#fff;}
.t58{width:230px;margin:0 auto;padding:8px 10px;border:1px solid var(--linea);border-radius:4px;}
.tp-tipo{text-align:center;font-weight:800;font-size:15px;letter-spacing:1px;margin-bottom:2px;}
.tp-name{text-align:center;font-size:18px;font-weight:800;line-height:1.1;}
.tp-sub{text-align:center;font-size:12px;margin:2px 0 6px;}
.tp-meta{display:flex;justify-content:space-between;font-size:11px;}
.tp-modo-tag{font-weight:800;}
.tp-dom{font-size:12px;margin-top:6px;line-height:1.5;}
.tp-line{border-top:1px dashed #000;margin:7px 0;}
.tp-orden{margin-bottom:7px;}
.tp-oname{font-weight:800;font-size:13px;}
.tp-prep{font-size:12px;font-style:italic;margin:1px 0 2px;}
.kt-prep{font-size:12px;font-weight:700;color:var(--barro);margin-bottom:2px;}
.tp-extras-h{font-weight:800;font-size:12px;margin-bottom:2px;}
.tp-item{display:flex;gap:6px;font-size:13px;align-items:baseline;line-height:1.35;}
.tp-q{min-width:26px;font-weight:700;} .tp-n{flex:1;} .tp-p{font-weight:700;white-space:nowrap;}
.tp-tacos{font-weight:800;font-size:15px;text-align:center;margin:2px 0;}
.tp-total{display:flex;justify-content:space-between;font-weight:800;font-size:16px;margin:2px 0 6px;}
.tp-foot{text-align:center;font-size:12px;margin-top:4px;}
.auto-print{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--tinta2);padding:10px 4px 0;cursor:pointer;}
.auto-print input{width:18px;height:18px;}

/* cada producto en un solo renglón (recorta si es larguísimo) */
.tp-item{display:flex;gap:6px;font-size:14px;align-items:baseline;line-height:1.4;}
.tp-q{min-width:20px;font-weight:800;text-align:right;}
.tp-n{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tp-p{font-weight:700;white-space:nowrap;}
.tp-suborden{display:flex;justify-content:space-between;font-weight:700;font-size:13px;border-top:1px dotted #000;margin-top:3px;padding-top:2px;}
.tp-bebidas{margin-top:5px;padding-top:4px;border-top:1px dashed #000;}
.tp-bebidas .tp-oname{letter-spacing:1px;}

/* selector junta/separada dentro del modal */
.ticket-modos{display:flex;gap:0;margin:10px 4px 0;border:1px solid var(--linea);border-radius:10px;overflow:hidden;}
.seg-b{flex:1;padding:10px;background:#fff;border:0;font-weight:700;color:var(--tinta2);cursor:pointer;}
.seg-b.on{background:var(--agave);color:#fff;}

@media print{
  @page{ size:58mm auto; margin:0; }
  html,body{ width:58mm; margin:0!important; padding:0!important; background:#fff; }
  body *{ visibility:hidden; }
  #print-area,#print-area *{ visibility:visible; color:#000!important; }
  #print-area{ position:absolute; left:0; top:0; width:58mm; border:0!important; border-radius:0!important; padding:0 2mm!important; }
  .no-print{ display:none!important; }
}

@media (max-width:760px){
  .cols-3{grid-template-columns:1fr;}
  .type-banner{font-size:16px;}
  .topbar{flex-wrap:nowrap;gap:8px;padding:8px 10px;}
  .topbar-name{display:none;}
  .user-name{display:none;}
  .topbar-user .rol-tag{display:none;}
  .topbar-nav{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;flex:1;}
  .topbar-nav::-webkit-scrollbar{display:none;}
  .nav-btn{flex:none;white-space:nowrap;padding:9px 12px;}
  .type-bar{gap:8px;}
  .type-btns{order:2;width:100%;}
}
`;
