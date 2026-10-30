/* ============================================================
   Reglas del negocio sin React ni red: catálogo, precios, totales,
   permisos y formato. Las usan la interfaz y el modo local, y se
   prueban por separado (tests/dominio.test.js).
   ============================================================ */

export const NUM_MESAS = 8;

export const CARNES_DEFAULT = [
  { id: "pastor",  nombre: "Pastor",  activo: true },
  { id: "bistec",  nombre: "Bistec",  activo: true },
  { id: "tripa",   nombre: "Tripa",   activo: true },
  { id: "chorizo", nombre: "Chorizo", activo: true },
];
export const BEBIDAS_DEFAULT = [
  { id: "coca",     nombre: "Coca-Cola",        cantidad: 24, activo: true, precio: 25 },
  { id: "sprite",   nombre: "Sprite",           cantidad: 12, activo: true, precio: 25 },
  { id: "fanta",    nombre: "Fanta",            cantidad: 12, activo: true, precio: 25 },
  { id: "jamaica",  nombre: "Agua de Jamaica",  cantidad: 20, activo: true, precio: 20 },
  { id: "horchata", nombre: "Agua de Horchata", cantidad: 20, activo: true, precio: 20 },
  { id: "mineral",  nombre: "Agua Mineral",     cantidad: 10, activo: true, precio: 25 },
  { id: "botella",  nombre: "Agua Embotellada", cantidad: 30, activo: true, precio: 15 },
];

/* precios base de los productos que genera cada carne */
export const PRECIOS_POR_CARNE = { taco: 20, "taco-queso": 30, gringa: 45, llenadora: 55, volcan: 40, costra: 50, "media-costra": 28 };

export function preciosCarne(id) {
  return Object.fromEntries(Object.entries(PRECIOS_POR_CARNE).map(([pref, p]) => [`${pref}-${id}`, p]));
}

export function preciosDefault(carnes) {
  const p = {
    "quesa-maiz-queso": 25, "quesa-queso": 35, "volcan-queso": 35,
    "costra-queso": 45, "media-costra-queso": 25,
    "bolsa-verdura": 15, "tortilla-harina": 10, "tortilla-maiz": 10,
  };
  carnes.forEach((c) => Object.assign(p, preciosCarne(c.id)));
  return p;
}

export const ROLES = { admin: "Administrador", mesero: "Mesero", cocinero: "Cocinero" };
// Permisos por rol para la interfaz. El servidor aplica las mismas reglas por su cuenta.
// - admin: todo.  - mesero: mesas y comanda; cocina solo lectura.
// - cocinero: cocina (completo, incluido el corte) y mesas solo lectura.
export const PERMISOS = {
  admin:    { ver: ["mesas", "comanda", "cocina", "inventario", "gastos", "admin"], edita: ["mesas", "comanda", "cocina", "inventario", "gastos", "admin"] },
  mesero:   { ver: ["mesas", "comanda", "cocina"],                                  edita: ["mesas", "comanda"] },
  cocinero: { ver: ["mesas", "cocina"],                                             edita: ["cocina"] },
};
export const puede = (u, v) => !!(PERMISOS[u?.rol]?.ver || []).includes(v);
export const puedeEditar = (u, v) => !!(PERMISOS[u?.rol]?.edita || []).includes(v);

/* Importes: siempre a centavos; se muestran los centavos solo si existen ($25 / $25.50) */
const fmtEntero = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtCentavos = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const money = (n) => {
  const v = redondear(n);
  return "$" + (Number.isInteger(v) ? fmtEntero : fmtCentavos).format(v);
};
// Convierte texto de un campo de precio/monto a número (acepta coma decimal); null si no es válido
export const leerImporte = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) && n >= 0 ? redondear(n) : null;
};

const sumaItems = (items) => (items || []).reduce((a, i) => a + i.cantidad * (i.precio || 0), 0);
export const ticketTotal = (t) =>
  redondear((t.ordenes || []).reduce((s, o) => s + sumaItems(o.items), 0) + sumaItems(t.extras));
export const contarTacos = (t) =>
  (t.ordenes || []).reduce((s, o) => s + o.items.reduce((a, i) => a + (i.cat === "taco" ? i.cantidad : 0), 0), 0);
export const contarProductos = (pedido) =>
  (pedido?.ordenes || []).reduce((s, o) => s + (o.items || []).reduce((a, i) => a + i.cantidad, 0), 0);

/* categorías de comida y su color */
export const CATS = {
  taco:    { color: "var(--lima)",     label: "Tacos" },
  quesa:   { color: "var(--maiz)",     label: "Quesadillas / Gringas" },
  volcan:  { color: "var(--barro)",    label: "Volcanes" },
  costra:  { color: "var(--especial)", label: "Especialidad — Costra" },
  bebida:  { color: "var(--agua)",     label: "Refrescos y aguas" },
  empaque: { color: "var(--empaque)",  label: "Para llevar / empaque" },
};

/* preparación por orden */
export const PREPS = [
  { k: "con-todo", label: "Con todo" },
  { k: "natural",  label: "Natural" },
  { k: "cilantro", label: "Con cilantro" },
  { k: "cebolla",  label: "Con cebolla" },
];
export const PREP_LABEL = Object.fromEntries(PREPS.map((p) => [p.k, p.label]));

/* extras de empaque (para llevar y domicilio) */
const EMPAQUE = [
  { key: "verdura-aparte", nombre: "Verdura aparte (sin costo)", corto: "Verdura aparte" },
  { key: "bolsa-verdura", nombre: "Bolsa de verdura (zanahoria, pepino, limón)", corto: "Bolsa de verdura" },
  { key: "tortilla-harina", nombre: "Tortillas extra (harina)", corto: "Tortillas harina" },
  { key: "tortilla-maiz", nombre: "Tortillas extra (maíz)", corto: "Tortillas maíz" },
];
export function empaqueItems(precios = {}) {
  return EMPAQUE.map((e) => ({ ...e, cat: "empaque", precio: e.key === "verdura-aparte" ? 0 : (precios[e.key] ?? 0) }));
}

/* productos estándar que genera cada carne, por categoría (orden del menú) */
const POR_CARNE = [
  { pref: "taco-",         label: "Taco",          cat: "taco" },
  { pref: "taco-queso-",   label: "Taco de queso", cat: "taco" },
  { pref: "gringa-",       label: "Gringa",        cat: "quesa" },
  { pref: "llenadora-",    label: "Llenadora",     cat: "quesa" },
  { pref: "volcan-",       label: "Volcán",        cat: "volcan" },
  { pref: "costra-",       label: "Costra",        cat: "costra" },
  { pref: "media-costra-", label: "Media costra",  cat: "costra" },
];
const FIJOS = {
  "quesa-maiz-queso":   { nombre: "Quesadilla de maíz (queso)", cat: "taco" },
  "quesa-queso":        { nombre: "Quesadilla de queso",        cat: "quesa" },
  "volcan-queso":       { nombre: "Volcán de queso",            cat: "volcan" },
  "costra-queso":       { nombre: "Costra de queso",            cat: "costra" },
  "media-costra-queso": { nombre: "Media costra de queso",      cat: "costra" },
};
const deCarne = (pref, carnes) => {
  const d = POR_CARNE.find((x) => x.pref === pref);
  return carnes.map((c) => ({ key: `${pref}${c.id}`, nombre: `${d.label} ${c.nombre}`, cat: d.cat }));
};
const fijo = (key) => ({ key, ...FIJOS[key] });

export function catalogoBase(carnes) {
  return {
    taco: [...deCarne("taco-", carnes), fijo("quesa-maiz-queso"), ...deCarne("taco-queso-", carnes)],
    quesa: [...deCarne("gringa-", carnes), ...deCarne("llenadora-", carnes), fijo("quesa-queso")],
    volcan: [...deCarne("volcan-", carnes), fijo("volcan-queso")],
    costra: [...deCarne("costra-", carnes), fijo("costra-queso"), ...deCarne("media-costra-", carnes), fijo("media-costra-queso")],
  };
}

export function buildMenu(carnes, bebidas, extras = [], precios = {}, ocultos = []) {
  const base = catalogoBase(carnes.filter((c) => c.activo));
  const ocul = new Set(ocultos);
  const conPrecio = (cat) => [
    ...base[cat].map((it) => ({ ...it, precio: precios[it.key] ?? 0 })),
    ...extras.filter((e) => e.activo !== false && e.cat === cat)
      .map((e) => ({ key: `extra-${e.id}`, nombre: e.nombre, cat, precio: Number(e.precio) || 0, extraId: e.id })),
  ].filter((it) => !ocul.has(it.key));
  const bebs = bebidas.filter((b) => b.activo && b.cantidad > 0)
    .map((b) => ({ key: `beb-${b.id}`, nombre: b.nombre, cat: "bebida", invId: b.id, precio: Number(b.precio) || 0, quedan: b.cantidad }));
  return { tacos: conPrecio("taco"), quesa: conPrecio("quesa"), volcan: conPrecio("volcan"), costra: conPrecio("costra"), bebs };
}

/* Versión en JS de public._resolver_item (supabase-schema.sql), para el modo local */
export function resolverItem(key, empaque, data) {
  const no = { ok: false };
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(key)) return no;
  const emp = EMPAQUE.find((e) => e.key === key);
  if (emp) return empaque ? { ok: true, ...emp, cat: "empaque", precio: emp.key === "verdura-aparte" ? 0 : (data.precios[key] ?? 0) } : no;
  if (empaque || (data.ocultos || []).includes(key)) return no;
  if (key.startsWith("beb-")) {
    const b = data.bebidas.find((x) => x.id === key.slice(4) && x.activo !== false);
    return b ? { ok: true, nombre: b.nombre, cat: "bebida", precio: Number(b.precio) || 0, invId: b.id } : no;
  }
  if (key.startsWith("extra-")) {
    const e = (data.extras || []).find((x) => x.id === key.slice(6) && x.activo !== false);
    return e && CATS[e.cat] ? { ok: true, nombre: e.nombre, cat: e.cat, precio: Number(e.precio) || 0 } : no;
  }
  if (FIJOS[key]) return { ok: true, ...FIJOS[key], precio: data.precios[key] ?? 0 };
  const orden = ["taco-queso-", "taco-", "gringa-", "llenadora-", "volcan-", "media-costra-", "costra-"];
  const pref = orden.find((p) => key.startsWith(p));
  if (!pref) return no;
  const carne = data.carnes.find((c) => c.id === key.slice(pref.length) && c.activo !== false);
  if (!carne) return no;
  const d = POR_CARNE.find((x) => x.pref === pref);
  return { ok: true, nombre: `${d.label} ${carne.nombre}`, cat: d.cat, precio: data.precios[key] ?? 0 };
}

let _seq = 0;
export const uid = () => {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch {}
  return Date.now().toString(36) + "-" + (++_seq).toString(36) + "-" + Math.random().toString(36).slice(2, 12);
};
export const clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

export const nuevaOrden = (n) => ({ id: uid().slice(0, 12), nombre: `Orden ${n}`, items: [], prep: "con-todo" });
export const nuevoPedido = () => ({ ordenes: [nuevaOrden(1)], extras: [] });
export const domVacio = () => ({ nombre: "", direccion: "", referencia: "", telefono: "", pago: "efectivo", tiempo: "" });
export const telefonoValido = (t) => /^[0-9 +()-]{7,20}$/.test((t || "").trim());

/* El servidor solo necesita claves y cantidades: nombres y precios los pone él */
export function pedidoParaEnviar(pedido) {
  const limpio = (items) => (items || []).map((i) => ({ key: i.key, cantidad: i.cantidad, nombre: i.nombre }));
  return {
    ordenes: pedido.ordenes.map((o) => ({ id: o.id, nombre: o.nombre, prep: o.prep, items: limpio(o.items) })),
    extras: limpio(pedido.extras),
  };
}

/* Resumen de un periodo (lo calcula el servidor; aquí solo para el modo local) */
export function resumenPeriodo(tickets, gastos = []) {
  const porTipo = {}, porMesero = {}, prod = {};
  let total = 0;
  const etiquetas = { aqui: "Para comer aquí", llevar: "Para llevar", domicilio: "Domicilio" };
  tickets.filter((t) => !t.reenvio).forEach((t) => {
    const tt = t.total != null ? Number(t.total) : ticketTotal(t);
    total += tt;
    const tipo = etiquetas[t.tipo] || "Otro";
    porTipo[tipo] = redondear((porTipo[tipo] || 0) + tt);
    porMesero[t.mesero || "—"] = redondear((porMesero[t.mesero || "—"] || 0) + tt);
    (t.ordenes || []).forEach((o) => o.items.forEach((it) => {
      const n = it.corto || it.nombre; prod[n] = (prod[n] || 0) + it.cantidad;
    }));
  });
  const top = Object.entries(prod).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([nombre, cant]) => ({ nombre, cant }));
  return {
    total: redondear(total), count: tickets.filter((t) => !t.reenvio).length, porTipo, porMesero, top,
    gastos: redondear(gastos.reduce((s, g) => s + (Number(g.monto) || 0), 0)),
  };
}

export function textoCorteWhatsApp(neg, r, fechaStr) {
  const L = [];
  L.push(`*${neg || "La Tequería"}* — Corte del ${fechaStr}`);
  L.push(`Ventas (comandas enviadas): ${r.count}`);
  L.push(`Total: ${money(r.total)}`);
  L.push("");
  L.push("Por tipo:");
  Object.entries(r.porTipo || {}).forEach(([k, v]) => L.push(`• ${k}: ${money(v)}`));
  L.push("");
  L.push("Por mesero:");
  Object.entries(r.porMesero || {}).forEach(([k, v]) => L.push(`• ${k}: ${money(v)}`));
  if (r.top?.length) { L.push(""); L.push("Más vendidos:"); r.top.forEach((p, i) => L.push(`${i + 1}. ${p.nombre} ×${p.cant}`)); }
  if (r.gastos > 0) { L.push(""); L.push(`Gastos del periodo: ${money(r.gastos)}`); L.push(`*Neto: ${money(r.total - r.gastos)}*`); }
  return L.join("\n");
}

/* Nombre para el ticket térmico: abrevia, pero puede ocupar varias líneas */
export function nombreTicket(item) {
  return (item.corto || item.nombre || "").trim()
    .replace(/^Quesadilla de\s+/i, "Quesa. ")
    .replace(/^Quesadilla\b/i, "Quesa.")
    .replace(/^Media costra\b/i, "½ Costra")
    .replace(/\bde queso\b/i, "queso")
    .replace(/\bextra\b/i, "")
    .replace(/\s*\(([^)]*)\)/g, " $1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || uid().slice(0, 8);

export const PIN_RE = /^[0-9]{4,8}$/;
export function pinDebil(p) {
  if (!p) return true;
  if (/^(.)\1+$/.test(p)) return true;
  if (["1234", "4321", "0123", "1212", "2468", "1357", "12345", "123456", "654321", "12341234"].includes(p)) return true;
  return "0123456789012345".includes(p) || "9876543210987654".includes(p);
}

export const hora = () => new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
export const fecha = () => new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });
