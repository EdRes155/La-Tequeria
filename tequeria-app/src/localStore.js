/* ============================================================
   Modo local (sin Supabase): un "servidor" dentro del navegador
   con la misma interfaz y las mismas reglas que supabase-schema.sql.
   Sirve para probar la app y para las pruebas automáticas.
   · Los datos viven en localStorage de este navegador.
   · Los PIN se guardan como hash, nunca en texto.
   · Al hacer corte se borran los tickets cerrados (y sus domicilios).
   ============================================================ */
import {
  CARNES_DEFAULT, BEBIDAS_DEFAULT, NUM_MESAS, preciosDefault, preciosCarne, resolverItem, resumenPeriodo,
  clone, uid, hora, fecha, redondear, slug, PIN_RE, pinDebil, ticketTotal, METODO_LABEL,
} from "./dominio.js";

const KEY = "tequeria_local_v3";
const SESION_KEY = "tequeria_sesion_local";
const PARTES = ["config", "carnes", "bebidas", "usuarios", "mesas", "cocina", "historial", "cortes", "gastos", "porCobrar"];

function inicial() {
  return {
    config: { nombreNegocio: "La Tequería", precios: preciosDefault(CARNES_DEFAULT), extras: [], ocultos: [] },
    carnes: clone(CARNES_DEFAULT), bebidas: clone(BEBIDAS_DEFAULT),
    usuarios: [],
    mesas: Array.from({ length: NUM_MESAS }, (_, i) => ({ id: i + 1, estado: "libre", pedido: null, mesero: null, hora: null, extras: [], version: 0 })),
    tickets: [], cortes: [], gastos: [], cobros: [], folio: 0, intentos: {},
  };
}

async function hashPin(pin, id) {
  const texto = `${pin}|${id}|tequeria-local`;
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // contexto sin crypto.subtle (p. ej. http en red local): hash simple, solo para pruebas
    let h = 2166136261;
    for (const ch of texto) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return "fnv-" + (h >>> 0).toString(16);
  }
}

export function crearLocal({ ErrorApi, mensajePin }) {
  let db = cargarDb();
  let sesion = (() => { try { return JSON.parse(sessionStorage.getItem(SESION_KEY) || "null"); } catch { return null; } })();
  const oyentes = new Set();

  function cargarDb() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "null");
      if (v && v.config) return { cobros: [], folio: v.tickets?.length || 0, ...v };
    } catch {}
    return inicial();
  }
  function guardar(partes = PARTES) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
    oyentes.forEach((fn) => fn(partes));
  }
  const fallar = (codigo, mensaje) => { throw new ErrorApi(codigo, mensaje); };
  const guardarSesion = (s) => { sesion = s; try { s ? sessionStorage.setItem(SESION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESION_KEY); } catch {} };

  function yo() {
    const u = sesion && db.usuarios.find((x) => x.id === sesion.usuarioId);
    if (!u) { guardarSesion(null); fallar("SESION", "Tu sesión terminó. Vuelve a entrar."); }
    return u;
  }
  function exigir(roles) {
    const u = yo();
    if (!roles.includes(u.rol)) fallar("PERMISO", "Tu usuario no tiene permiso para esta acción.");
    if (u.debeCambiarPin) fallar("CAMBIAR_PIN", "Primero cambia tu PIN.");
    return u;
  }
  const espera = (k) => Math.max(0, Math.ceil(((db.intentos[k]?.hasta || 0) - Date.now()) / 1000));
  function fallo(k, umbral) {
    const i = db.intentos[k] || { n: 0 };
    i.n += 1;
    if (i.n >= umbral) i.hasta = Date.now() + Math.min(60, 5 * (i.n - umbral + 1)) * 60000;
    db.intentos[k] = i;
    return Math.max(0, umbral - i.n);
  }
  async function pinDeAdmin(pin, soloId) {
    for (const u of db.usuarios.filter((x) => x.rol === "admin" && (!soloId || x.id === soloId))) {
      if (u.pinHash === await hashPin(pin, u.id)) return u;
    }
    return null;
  }
  async function reautenticar(pin, soloId) {
    const k = "s:" + sesion.usuarioId;
    const e = espera(k);
    if (e > 0) return { ok: false, error: "bloqueado", espera: e };
    const a = await pinDeAdmin(pin, soloId);
    if (!a) { const restantes = fallo(k, 5); guardar([]); return { ok: false, error: "pin", restantes }; }
    delete db.intentos[k];
    return { ok: true, admin: a };
  }
  const conPin = (r) => { if (!r.ok) throw new ErrorApi(r.error, mensajePin(r), r); return r; };
  const mesa = (id) => db.mesas.find((m) => m.id === id) || fallar("MESA", "La mesa no existe.");

  function valorar(items, empaque) {
    return (items || []).map((it) => {
      if (!Number.isInteger(it.cantidad) || it.cantidad < 1 || it.cantidad > 999) fallar("DATOS", `Cantidad no válida en ${it.nombre || it.key}.`);
      const r = resolverItem(it.key, empaque, { ...db.config, carnes: db.carnes, bebidas: db.bebidas });
      if (!r.ok) fallar("PRODUCTO", `${it.nombre || it.key} ya no está disponible. Quítalo de la comanda e inténtalo de nuevo.`);
      const out = { key: it.key, nombre: r.nombre, cat: r.cat, precio: redondear(r.precio), cantidad: it.cantidad };
      if (r.corto) out.corto = r.corto;
      if (r.invId) out.invId = r.invId;
      return out;
    });
  }

  function conCobro(t) {
    if (t.cobroId === "no_cobrado") return { ...t, cobro: { noCobrado: true } };
    const c = t.cobroId && db.cobros.find((x) => x.id === t.cobroId);
    return { ...t, cobro: c ? { id: c.id, metodo: c.metodo, hora: c.hora, total: c.total, propina: c.propina, recibido: c.recibido, enCorte: !!c.corteId } : null };
  }

  function estado(partes) {
    const u = yo();
    const todo = !partes;
    const quiere = (p) => todo || partes.includes(p);
    const caja = u.rol === "cocinero" || u.rol === "admin";
    const r = { yo: { id: u.id, nombre: u.nombre, rol: u.rol, cambiarPin: !!u.debeCambiarPin } };
    if (quiere("config")) Object.assign(r, { nombreNegocio: db.config.nombreNegocio, precios: db.config.precios, extras: db.config.extras, ocultos: db.config.ocultos });
    if (quiere("carnes")) r.carnes = db.carnes;
    if (quiere("bebidas")) r.bebidas = [...db.bebidas].sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (quiere("usuarios")) r.usuarios = db.usuarios.map(({ id, nombre, rol }) => ({ id, nombre, rol }));
    // desde: inicio de la visita actual (comanda original más reciente de la mesa ocupada)
    const desde = (m) => (m.estado !== "ocupada" ? null
      : db.tickets.filter((t) => t.mesaId === m.id && !t.esExtra && !t.reenvio && t.creado).map((t) => t.creado).sort().pop() || null);
    if (quiere("mesas")) r.mesas = db.mesas.map((m) => ({ ...m, desde: desde(m) }));
    const privado = (t) => (u.rol === "mesero" && t.creadoPor !== u.id ? { ...t, domicilio: null } : t);
    if (quiere("cocina")) r.cocina = db.tickets.filter((t) => !t.archivado).map((t) => privado(conCobro(t)));
    if (caja && quiere("historial")) {
      const abiertos = db.tickets.filter((t) => !t.corteId);
      r.historial = abiertos.filter((t) => !t.reenvio).map(conCobro);
      r.periodo = resumenPeriodo(abiertos, db.gastos.filter((g) => !g.corteId), db.cobros.filter((c) => !c.corteId));
    }
    if ((u.rol === "mesero" || u.rol === "admin") && quiere("porCobrar")) {
      r.porCobrar = db.tickets.filter((t) => !t.reenvio && !t.cobroId).map((t) => privado(conCobro(t)));
    }
    if (caja && quiere("cortes")) r.cortes = db.cortes.slice(0, 60);
    if (u.rol === "admin" && quiere("gastos")) r.gastos = db.gastos.filter((g) => !g.corteId);
    return clone(r);
  }

  const acciones = {
    async guardarBorrador(mesaId, pedido, version) {
      const u = exigir(["mesero", "admin"]);
      const m = mesa(mesaId);
      if (m.estado === "ocupada") fallar("MESA_OCUPADA", "La mesa ya tiene una comanda enviada. Usa «Agregar orden extra».");
      if (version != null && (m.version || 0) !== version) fallar("CONFLICTO", "Otro dispositivo cambió esta mesa. Revisa el borrador antes de guardar.");
      const hay = (pedido?.ordenes || []).some((o) => o.items.length > 0);
      Object.assign(m, hay
        ? { estado: "borrador", pedido: clone(pedido), mesero: u.nombre, hora: hora() }
        : { estado: "libre", pedido: null, mesero: null, hora: null, extras: [] });
      m.version = (m.version || 0) + 1;
      guardar(["mesas"]);
      return clone(m);
    },
    async liberarMesa(mesaId) {
      exigir(["mesero", "admin"]);
      const m = mesa(mesaId);
      const n = db.tickets.filter((t) => t.mesaId === m.id && !t.cobroId && !t.reenvio).length;
      if (n > 0) fallar("POR_COBRAR", `La Mesa ${m.id} tiene ${n} cuenta(s) por cobrar. Cóbrala antes de liberarla.`);
      Object.assign(m, { estado: "libre", pedido: null, mesero: null, hora: null, extras: [], version: (m.version || 0) + 1 });
      guardar(["mesas"]);
      return clone(m);
    },
    async enviar(p) {
      const u = exigir(["mesero", "admin"]);
      const previo = db.tickets.find((t) => t.id === p.id);
      if (previo) return { ok: true, duplicado: true, ticket: clone(previo) };
      const tipo = p.esExtra ? "aqui" : p.tipo;
      if (!["aqui", "llevar", "domicilio"].includes(tipo)) fallar("DATOS", "Tipo de comanda no válido.");
      const ordenes = (p.ordenes || []).map((o, i) => ({
        id: o.id || uid().slice(0, 12), nombre: (o.nombre || "").trim().slice(0, 40) || `Orden ${i + 1}`,
        prep: ["con-todo", "natural", "cilantro", "cebolla"].includes(o.prep) ? o.prep : "con-todo",
        items: valorar(o.items, false),
      })).filter((o) => o.items.length > 0);
      const extras = valorar(p.extras, true);
      if (ordenes.length === 0 && extras.length === 0) fallar("VACIO", "Agrega al menos un producto.");
      let domicilio = null, origen;
      if (tipo === "domicilio") {
        const d = p.domicilio || {};
        if (!d.direccion?.trim() || !d.telefono?.trim()) fallar("DOMICILIO", "Captura dirección y teléfono del domicilio.");
        if (!/^[0-9 +()-]{7,20}$/.test(d.telefono.trim())) fallar("DOMICILIO", "El teléfono debe tener entre 7 y 20 dígitos.");
        domicilio = { nombre: (d.nombre || "").trim(), direccion: d.direccion.trim(), referencia: (d.referencia || "").trim(),
          telefono: d.telefono.trim(), pago: d.pago || "efectivo", tiempo: (d.tiempo || "").replace(/\D/g, "").slice(0, 3) };
        origen = domicilio.nombre || "Domicilio";
      } else if (tipo === "llevar") {
        origen = "Para llevar" + (p.referencia?.trim() ? ` · ${p.referencia.trim()}` : "");
      }
      // existencias: se valida todo antes de tocar nada
      const consumo = {};
      ordenes.forEach((o) => o.items.forEach((i) => { if (i.invId) consumo[i.invId] = (consumo[i.invId] || 0) + i.cantidad; }));
      for (const [id, q] of Object.entries(consumo)) {
        const b = db.bebidas.find((x) => x.id === id);
        if (!b || b.cantidad < q) fallar("SIN_EXISTENCIA", `No hay suficiente ${b?.nombre || id} (quedan ${b?.cantidad || 0}).`);
      }
      const h = hora();
      const total = ticketTotal({ ordenes, extras });
      let m = null;
      if (tipo === "aqui") {
        m = mesa(p.mesaId);
        origen = `Mesa ${m.id}`;
        if (p.esExtra && m.estado !== "ocupada") fallar("MESA_NO_OCUPADA", "La mesa ya no tiene una comanda abierta. Envíala como comanda nueva.");
        if (!p.esExtra && m.estado === "ocupada") fallar("MESA_OCUPADA", "Otro dispositivo ya envió una comanda para esta mesa. Usa «Agregar orden extra».");
      }
      Object.entries(consumo).forEach(([id, q]) => { db.bebidas.find((x) => x.id === id).cantidad -= q; });
      if (m && p.esExtra) m.extras = [...(m.extras || []), { id: p.id, ordenes, extras, hora: h, total }];
      else if (m) Object.assign(m, { estado: "ocupada", pedido: { ordenes, extras }, mesero: u.nombre, hora: h, extras: [] });
      if (m) m.version = (m.version || 0) + 1;
      db.folio = (db.folio || 0) + 1;
      const t = {
        id: p.id, folio: db.folio, tipo, esExtra: !!p.esExtra, origen, mesaId: m ? m.id : null, ordenes, extras, mesero: u.nombre,
        hora: h, fecha: fecha(), estado: "pendiente", total, domicilio, reenvio: false,
        cuenta: p.cuenta === "separada" ? "separada" : "junta", paraLlevar: tipo === "aqui" && !p.esExtra && !!p.paraLlevar,
        referencia: tipo === "llevar" ? (p.referencia || "").trim() || null : null, creadoPor: u.id, archivado: false,
        creado: new Date().toISOString(), recibido: null,
      };
      db.tickets.unshift(t);
      guardar(["mesas", "bebidas", "cocina", "historial", "porCobrar"]);
      return { ok: true, ticket: clone(t) };
    },
    async reenviar(id, mesaId) {
      const u = exigir(["mesero", "admin"]);
      const previo = db.tickets.find((t) => t.id === id);
      if (previo) return { ok: true, duplicado: true, ticket: clone(previo) };
      const m = mesa(mesaId);
      if (m.estado !== "ocupada") fallar("MESA_NO_OCUPADA", "Solo se puede reenviar una mesa con comanda enviada.");
      const ordenes = [...(m.pedido?.ordenes || []), ...(m.extras || []).flatMap((e) => e.ordenes || [])];
      const extras = [...(m.pedido?.extras || []), ...(m.extras || []).flatMap((e) => e.extras || [])];
      const t = { id, tipo: "aqui", esExtra: false, origen: `Mesa ${m.id}`, mesaId: m.id, ordenes: clone(ordenes), extras: clone(extras),
        mesero: m.mesero || u.nombre, hora: hora(), fecha: fecha(), estado: "pendiente", total: 0, domicilio: null,
        reenvio: true, cuenta: "junta", paraLlevar: false, referencia: null, creadoPor: u.id, archivado: false,
        creado: new Date().toISOString(), recibido: null };
      db.tickets.unshift(t);
      guardar(["cocina"]);
      return { ok: true, ticket: clone(t) };
    },
    async estadoTicket(id, estado) {
      exigir(["cocinero", "admin"]);
      const t = db.tickets.find((x) => x.id === id && !x.archivado) || fallar("TICKET", "La comanda ya no está en cocina.");
      t.estado = estado;
      t.recibido = t.recibido || new Date().toISOString();
      guardar(["cocina", "historial", "porCobrar"]);
    },
    async marcarRecibido(ids) {
      exigir(["cocinero", "admin"]);
      const ts = db.tickets.filter((t) => (ids || []).includes(t.id) && !t.recibido && !t.archivado);
      if (!ts.length) return 0;
      const ahora = new Date().toISOString();
      ts.forEach((t) => { t.recibido = ahora; });
      guardar(["cocina", "porCobrar"]);
      return ts.length;
    },
    async archivar(id) {
      exigir(["cocinero", "admin"]);
      const t = db.tickets.find((x) => x.id === id && x.estado === "listo") || fallar("TICKET", "Solo se pueden quitar comandas marcadas como listas.");
      t.archivado = true;
      if (t.corteId) db.tickets = db.tickets.filter((x) => x !== t); // ya contabilizado: no se conserva
      guardar(["cocina"]);
    },
    async corte(adminPin) {
      const u = exigir(["cocinero", "admin"]);
      const a = conPin(await reautenticar(adminPin));
      const abiertos = db.tickets.filter((t) => !t.corteId);
      const cobros = db.cobros.filter((c) => !c.corteId);
      if (!abiertos.some((t) => !t.reenvio) && !cobros.some((c) => !c.anulado)) conPin({ ok: false, error: "vacio" });
      const id = uid();
      const gastos = db.gastos.filter((g) => !g.corteId);
      const res = resumenPeriodo(abiertos, gastos, cobros);
      db.cortes.unshift({ id, fecha: fecha(), hora: hora(), tickets: res.count, total: res.total, gastos: res.gastos,
        cobrado: res.cobrado.total, porCobrar: res.porCobrar,
        detalle: { porTipo: res.porTipo, porMesero: res.porMesero, top: res.top, gastos: res.gastos, cobrado: res.cobrado,
          porCobrar: res.porCobrar, noCobrado: res.noCobrado },
        hechoPor: u.id, autorizadoPor: a.admin.id });
      cobros.forEach((c) => { c.corteId = id; });
      // lo ya contabilizado y archivado se borra (con sus domicilios); lo que sigue en cocina se conserva
      abiertos.forEach((t) => { t.corteId = id; });
      gastos.forEach((g) => { g.corteId = id; });
      // se conservan los tickets aún por cobrar o en cocina; lo demás ya quedó en el corte
      db.tickets = db.tickets.filter((t) => !t.corteId || !t.archivado || (!t.cobroId && !t.reenvio));
      db.gastos = db.gastos.filter((g) => !g.corteId);
      db.cobros = db.cobros.filter((c) => !c.corteId || db.tickets.some((t) => t.cobroId === c.id));
      guardar(["cocina", "historial", "cortes", "gastos", "porCobrar"]);
      return { ok: true, corte: { id, tickets: res.count, total: res.total, gastos: res.gastos, autorizo: a.admin.nombre,
        cobrado: res.cobrado, porCobrar: res.porCobrar } };
    },
    async cobrar(id, ids, metodo, recibido, propina = 0, liberarMesa = false) {
      const u = exigir(["mesero", "admin"]);
      const previo = db.cobros.find((c) => c.id === id);
      if (previo) return { ok: true, duplicado: true, cobro: { ...previo, cambio: Math.max(0, previo.recibido - previo.total - previo.propina) } };
      if (!METODO_LABEL[metodo]) fallar("DATOS", "Elige un método de pago.");
      const ts = [...new Set(ids)].map((x) => db.tickets.find((t) => t.id === x && !t.reenvio));
      if (!ts.length || ts.some((t) => !t)) fallar("TICKET", "Alguna cuenta ya no existe o es una reimpresión.");
      const ya = ts.find((t) => t.cobroId);
      if (ya) fallar("YA_COBRADO", `La cuenta de ${ya.origen} ya estaba cobrada. Actualiza la pantalla.`);
      const total = redondear(ts.reduce((s, t) => s + t.total, 0));
      const prop = redondear(propina || 0);
      if (prop < 0) fallar("DATOS", "Propina no válida.");
      let rec = total + prop;
      if (metodo === "efectivo") {
        rec = redondear(recibido ?? total + prop);
        if (rec < total + prop) fallar("PAGO", `El efectivo recibido no alcanza: faltan $${redondear(total + prop - rec)}.`);
      }
      const mesas = [...new Set(ts.map((t) => t.mesaId).filter(Boolean))];
      const origen = ts.length === 1 ? ts[0].origen : mesas.length === 1 ? `Mesa ${mesas[0]}` : "Varias cuentas";
      const c = { id, metodo, total, propina: prop, recibido: rec, tickets: ts.length, origen, cobradoPor: u.id, cobradoNombre: u.nombre,
        fecha: fecha(), hora: hora(), corteId: null, anulado: false };
      db.cobros.unshift(c);
      ts.forEach((t) => { t.cobroId = id; });
      let mesaLiberada = false;
      if (liberarMesa && mesas.length === 1 && !db.tickets.some((t) => t.mesaId === mesas[0] && !t.cobroId && !t.reenvio)) {
        const m = mesa(mesas[0]);
        if (m.estado === "ocupada") {
          Object.assign(m, { estado: "libre", pedido: null, mesero: null, hora: null, extras: [], version: (m.version || 0) + 1 });
          mesaLiberada = true;
        }
      }
      guardar(["porCobrar", "historial", "mesas", "cocina"]);
      return { ok: true, mesaLiberada, cobro: { id, metodo, total, propina: prop, recibido: rec, cambio: redondear(rec - total - prop), origen } };
    },
    async anularCobro(id, motivo) {
      exigir(["admin"]);
      const c = db.cobros.find((x) => x.id === id && !x.anulado) || fallar("COBRO", "El cobro no existe o ya estaba anulado.");
      if (c.corteId) fallar("COBRO", "Ese cobro ya pertenece a un corte y no se puede anular.");
      if (!motivo?.trim()) fallar("DATOS", "Escribe el motivo de la anulación.");
      c.anulado = true; c.anuladoMotivo = motivo.trim();
      db.tickets.forEach((t) => { if (t.cobroId === id) t.cobroId = null; });
      guardar(["porCobrar", "historial"]);
    },
    async noCobrar(adminPin, ids, motivo, liberarMesa = false) {
      const u = exigir(["mesero", "admin"]);
      if (!motivo?.trim()) fallar("DATOS", "Escribe el motivo.");
      const a = conPin(await reautenticar(adminPin));
      const ts = [...new Set(ids)].map((x) => db.tickets.find((t) => t.id === x && !t.reenvio));
      if (!ts.length || ts.some((t) => !t)) fallar("TICKET", "Alguna cuenta ya no existe o es una reimpresión.");
      const ya = ts.find((t) => t.cobroId);
      if (ya) fallar("YA_COBRADO", `La cuenta de ${ya.origen} ya estaba cerrada. Actualiza la pantalla.`);
      ts.forEach((t) => { t.cobroId = "no_cobrado"; });
      const mesas = [...new Set(ts.map((t) => t.mesaId).filter(Boolean))];
      let mesaLiberada = false;
      if (liberarMesa && mesas.length === 1 && !db.tickets.some((t) => t.mesaId === mesas[0] && !t.cobroId && !t.reenvio)) {
        const m = mesa(mesas[0]);
        if (m.estado === "ocupada") {
          Object.assign(m, { estado: "libre", pedido: null, mesero: null, hora: null, extras: [], version: (m.version || 0) + 1 });
          mesaLiberada = true;
        }
      }
      db.bitacora = [...(db.bitacora || []), { accion: "no_cobrado", usuario: u.nombre, autorizo: a.admin.nombre, motivo: motivo.trim(), tickets: ts.map((t) => t.id) }].slice(-200);
      guardar(["porCobrar", "historial", "mesas", "cocina"]);
      return { ok: true, mesaLiberada, total: redondear(ts.reduce((s2, t) => s2 + t.total, 0)) };
    },
    async ajustarBebida(id, delta) {
      exigir(["admin"]);
      const b = db.bebidas.find((x) => x.id === id); if (b) b.cantidad = Math.max(0, b.cantidad + delta);
      guardar(["bebidas"]);
    },
    async actualizarBebida(id, cambios) {
      exigir(["admin"]);
      const b = db.bebidas.find((x) => x.id === id); if (!b) return;
      if ("nombre" in cambios && cambios.nombre.trim()) b.nombre = cambios.nombre.trim().slice(0, 60);
      if ("activo" in cambios) b.activo = !!cambios.activo;
      if ("precio" in cambios) b.precio = redondear(cambios.precio);
      if ("cantidad" in cambios) b.cantidad = Math.max(0, parseInt(cambios.cantidad, 10) || 0);
      guardar(["bebidas"]);
    },
    async agregarBebida(nombre, precio, cantidad) {
      exigir(["admin"]);
      if (!nombre.trim()) fallar("DATOS", "Escribe el nombre de la bebida.");
      const id = uid().replace(/-/g, "").slice(0, 10);
      db.bebidas.push({ id, nombre: nombre.trim().slice(0, 60), cantidad: Math.max(0, cantidad | 0), activo: true, precio: redondear(precio) });
      guardar(["bebidas"]);
      return { id };
    },
    async eliminarBebida(id) { exigir(["admin"]); db.bebidas = db.bebidas.filter((x) => x.id !== id); guardar(["bebidas"]); },
    async actualizarCarne(id, activo) {
      exigir(["admin"]);
      const c = db.carnes.find((x) => x.id === id); if (c) c.activo = !!activo;
      guardar(["carnes"]);
    },
    async agregarCarne(nombre) {
      exigir(["admin"]);
      const n = nombre.trim().slice(0, 40); if (!n) fallar("DATOS", "Escribe el nombre de la carne.");
      const id = slug(n);
      if (db.carnes.some((c) => c.id === id)) fallar("DUPLICADO", "Esa carne ya existe.");
      db.carnes.push({ id, nombre: n, activo: true });
      db.config.precios = { ...preciosCarne(id), ...db.config.precios };
      guardar(["carnes", "config"]);
      return { id };
    },
    async eliminarCarne(id) { exigir(["admin"]); db.carnes = db.carnes.filter((x) => x.id !== id); guardar(["carnes"]); },
    async fijarPrecio(clave, precio) { exigir(["admin"]); db.config.precios = { ...db.config.precios, [clave]: redondear(precio) }; guardar(["config"]); },
    async fijarPrecioExtra(id, precio) {
      exigir(["admin"]);
      db.config.extras = db.config.extras.map((e) => (e.id === id ? { ...e, precio: redondear(precio) } : e));
      guardar(["config"]);
    },
    async agregarExtra(cat, nombre, precio) {
      exigir(["admin"]);
      if (!nombre.trim()) fallar("DATOS", "Escribe el nombre del producto.");
      const id = uid().replace(/-/g, "").slice(0, 10);
      db.config.extras = [...db.config.extras, { id, nombre: nombre.trim().slice(0, 60), cat, precio: redondear(precio), activo: true }];
      guardar(["config"]);
      return { id };
    },
    async eliminarExtra(id) { exigir(["admin"]); db.config.extras = db.config.extras.filter((e) => e.id !== id); guardar(["config"]); },
    async alternarOculto(clave) {
      exigir(["admin"]);
      const s = new Set(db.config.ocultos); s.has(clave) ? s.delete(clave) : s.add(clave);
      db.config.ocultos = [...s];
      guardar(["config"]);
    },
    async agregarGasto(id, concepto, monto) {
      const u = exigir(["admin"]);
      if (!concepto.trim()) fallar("DATOS", "Escribe el concepto del gasto.");
      if (!(monto > 0)) fallar("DATOS", "El monto debe ser mayor a cero.");
      if (!db.gastos.some((g) => g.id === id)) {
        db.gastos.unshift({ id, concepto: concepto.trim().slice(0, 120), monto: redondear(monto), fecha: fecha(), hora: hora(), user: u.nombre });
      }
      guardar(["gastos", "historial"]);
    },
    async eliminarGasto(id) {
      exigir(["admin"]);
      if (!db.gastos.some((g) => g.id === id && !g.corteId)) fallar("GASTO", "El gasto no existe o ya pertenece a un corte.");
      db.gastos = db.gastos.filter((g) => g.id !== id);
      guardar(["gastos", "historial"]);
    },
    async crearUsuario(adminPin, nombre, pin, rol) {
      const u = exigir(["admin"]);
      conPin(await reautenticar(adminPin, u.id));
      if (!nombre.trim()) conPin({ ok: false, error: "nombre" });
      if (!["admin", "mesero", "cocinero"].includes(rol)) conPin({ ok: false, error: "rol" });
      if (!PIN_RE.test(pin)) conPin({ ok: false, error: "formato" });
      if (pinDebil(pin)) conPin({ ok: false, error: "debil" });
      const id = uid().replace(/-/g, "").slice(0, 12);
      db.usuarios.push({ id, nombre: nombre.trim().slice(0, 40), rol, pinHash: await hashPin(pin, id), debeCambiarPin: false });
      guardar(["usuarios"]);
      return { ok: true, usuario: { id, nombre, rol } };
    },
    async eliminarUsuario(adminPin, id) {
      const u = exigir(["admin"]);
      conPin(await reautenticar(adminPin, u.id));
      if (id === u.id) conPin({ ok: false, error: "propio" });
      const v = db.usuarios.find((x) => x.id === id) || conPin({ ok: false, error: "no_existe" });
      if (v.rol === "admin" && db.usuarios.filter((x) => x.rol === "admin").length <= 1) conPin({ ok: false, error: "ultimo_admin" });
      db.usuarios = db.usuarios.filter((x) => x.id !== id);
      guardar(["usuarios"]);
      return { ok: true };
    },
    async restablecerPin(adminPin, id, pin) {
      const u = exigir(["admin"]);
      conPin(await reautenticar(adminPin, u.id));
      if (!PIN_RE.test(pin)) conPin({ ok: false, error: "formato" });
      const v = db.usuarios.find((x) => x.id === id) || conPin({ ok: false, error: "no_existe" });
      v.pinHash = await hashPin(pin, v.id);
      v.debeCambiarPin = v.id !== u.id || pinDebil(pin);
      delete db.intentos["u:" + v.id];
      guardar(["usuarios"]);
      return { ok: true };
    },
  };

  return {
    modo: "local",
    async pantallaLogin() {
      db = cargarDb();
      return { negocio: db.config.nombreNegocio, usuarios: db.usuarios.map(({ id, nombre }) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
        hayAdmin: db.usuarios.some((u) => u.rol === "admin") };
    },
    // Solo modo local: primer administrador desde la pantalla de entrada
    async crearAdminInicial(nombre, pin) {
      if (db.usuarios.some((u) => u.rol === "admin")) fallar("EXISTE", "Ya existe un administrador.");
      if (!nombre.trim()) fallar("DATOS", "Escribe un nombre.");
      if (!PIN_RE.test(pin) || pinDebil(pin)) fallar("DATOS", "Usa un PIN de 4 a 8 dígitos que no sea trivial (no 1234, 1111…).");
      const id = uid().replace(/-/g, "").slice(0, 12);
      db.usuarios.push({ id, nombre: nombre.trim().slice(0, 40), rol: "admin", pinHash: await hashPin(pin, id), debeCambiarPin: false });
      guardar(["usuarios"]);
    },
    async entrar(id, pin) {
      const k = "u:" + id;
      const e = espera(k);
      if (e > 0) return { ok: false, error: "bloqueado", espera: e };
      const u = db.usuarios.find((x) => x.id === id);
      if (!u || u.pinHash !== await hashPin(pin, u.id)) { const restantes = fallo(k, 5); guardar([]); return { ok: false, error: "pin", restantes }; }
      delete db.intentos[k];
      if (pinDebil(pin)) u.debeCambiarPin = true;
      guardar([]);
      guardarSesion({ usuarioId: u.id });
      return { ok: true, usuario: { id: u.id, nombre: u.nombre, rol: u.rol }, debeCambiarPin: !!u.debeCambiarPin };
    },
    sesionGuardada() {
      const u = sesion && db.usuarios.find((x) => x.id === sesion.usuarioId);
      return u ? { usuario: { id: u.id, nombre: u.nombre, rol: u.rol }, debeCambiarPin: !!u.debeCambiarPin } : null;
    },
    async salir() { guardarSesion(null); },
    async cambiarPin(actual, nuevo) {
      const u = yo();
      if (u.pinHash !== await hashPin(actual, u.id)) { const restantes = fallo("s:" + u.id, 5); guardar([]); return { ok: false, error: "pin", restantes }; }
      if (!PIN_RE.test(nuevo)) return { ok: false, error: "formato" };
      if (pinDebil(nuevo) || nuevo === actual) return { ok: false, error: "debil" };
      u.pinHash = await hashPin(nuevo, u.id);
      u.debeCambiarPin = false;
      guardar(["usuarios"]);
      return { ok: true };
    },
    async cargar(partes = null) { return estado(partes); },
    async latido() { return true; },
    async liberarCocina() {},
    suscribir(onCambio, onConexion) {
      onConexion("local");
      const fn = (partes) => { if (partes.length) setTimeout(() => onCambio(partes), 0); };
      oyentes.add(fn);
      // otra pestaña del mismo navegador
      const onStorage = (e) => { if (e.key === KEY) { db = cargarDb(); onCambio(PARTES); } };
      window.addEventListener("storage", onStorage);
      return () => { oyentes.delete(fn); window.removeEventListener("storage", onStorage); };
    },
    acciones,
  };
}
