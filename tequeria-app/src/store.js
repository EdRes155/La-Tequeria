/* ============================================================
   Acceso a datos. Con Supabase configurado todo pasa por las
   funciones de supabase-schema.sql con el token de la sesión;
   sin Supabase se usa el adaptador local (localStore.js), que
   expone exactamente la misma interfaz.
   Cada acción devuelve una promesa: si el servidor rechaza o no
   responde, la promesa falla con un ErrorApi y nada se da por hecho.
   ============================================================ */
import { supabase } from "./supabaseClient.js";
import { crearLocal } from "./localStore.js";
import { mensajeConfig } from "./dominio.js";
import { clave, cambiarSucursal, borrarTodo, sucursalActual } from "./claves.js";

export class ErrorApi extends Error {
  constructor(codigo, mensaje, extra = {}) {
    super(mensaje);
    this.codigo = codigo;
    Object.assign(this, extra);
  }
}

// Qué partes del estado hay que recargar cuando cambia cada tabla
export const TODAS = ["config", "carnes", "bebidas", "usuarios", "mesas", "cocina", "historial", "cortes", "gastos", "porCobrar"];
export const TABLA_PARTES = {
  config: ["config"], carnes: ["carnes"], bebidas: ["bebidas"], usuarios: ["usuarios"], mesas: ["mesas"],
  tickets: ["cocina", "historial", "porCobrar"], cortes: ["cortes", "historial"], gastos: ["gastos", "historial"],
  cobros: ["porCobrar", "historial", "cortes", "cocina"], cocina_hechos: ["cocina"],
};

// La sesión del operador vive en sessionStorage, con la sucursal en la clave (claves.js)
const DISP_KEY = "tequeria_dispositivo";

export function dispositivo() {
  let s = null;
  try { s = localStorage.getItem(DISP_KEY); } catch {}
  if (!s) {
    s = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem(DISP_KEY, s); } catch {}
  }
  return s.slice(0, 64);
}

export const leerSesion = () => { try { return JSON.parse(sessionStorage.getItem(clave("sesion")) || "null"); } catch { return null; } };
export const guardarSesion = (s) => {
  try { if (s) sessionStorage.setItem(clave("sesion"), JSON.stringify(s)); else sessionStorage.removeItem(clave("sesion")); } catch {}
};

// Errores pasajeros (red, tiempo agotado, servidor ocupado): se pueden reintentar sin riesgo
// en las operaciones que no duplican nada. Se marcan con codigo "RED".
const TRANSITORIOS = new Set(["40001", "40P01", "57014", "53300", "55P03"]);
function traducir(error, status, vencido = false) {
  if (!error) return null;
  if (vencido || /AbortError/i.test(error.message || "")) {
    return new ErrorApi("RED", "El servidor tardó demasiado en responder. Revisa la conexión e inténtalo de nuevo.", { incierto: true });
  }
  if (status === 0 || /fetch|network|Load failed/i.test(error.message || "")) {
    return new ErrorApi("RED", "Sin conexión con el servidor. Revisa el internet e inténtalo de nuevo.", { incierto: true });
  }
  if (status === 429) return new ErrorApi("RED", "Demasiadas solicitudes seguidas. Espera unos segundos e inténtalo de nuevo.", { incierto: true });
  if (status >= 502 && status <= 504) {
    return new ErrorApi("RED", "El servidor no está disponible en este momento. Inténtalo de nuevo en unos segundos.", { incierto: true });
  }
  if (TRANSITORIOS.has(error.code)) return new ErrorApi("RED", "El servidor estaba ocupado. Inténtalo de nuevo.", { incierto: true });
  // Sin identidad de equipo (sin sesión de Supabase, o vencida sin poder renovarse) la llamada va con la llave
  // pública, y anon no ejecuta ninguna función: para la app es un equipo sin vincular (comprobado en staging)
  if (error.code === "42501") {
    return new ErrorApi("DISPOSITIVO", "Este equipo no está vinculado a una sucursal. Pide a un dueño o encargado un código para vincularlo.");
  }
  if (error.code === "PGRST202" || error.code === "42883") {
    return new ErrorApi("ESQUEMA", "La base de datos no está actualizada. Ejecuta supabase-schema.sql (v3) en Supabase.");
  }
  if (error.code === "P0001" && error.hint) return new ErrorApi(error.message, error.hint);
  console.error("Supabase:", error);
  const ref = error.code || (status ? `HTTP ${status}` : "");
  return new ErrorApi("SERVIDOR", `El servidor rechazó la operación${ref ? ` (${ref})` : ""}. Inténtalo de nuevo; si se repite, avisa al administrador.`);
}

const LIMITE_MS = 15000;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function crearRemoto() {
  let sesion = leerSesion();
  const token = () => sesion?.token || null;
  // Generación: sube cuando el equipo cambia de sucursal o deja de estar autorizado. Las respuestas que
  // lleguen después de la llamada de otra generación se descartan (MODELO.md §8).
  let generacion = 0;
  const canales = new Set();
  function desvincular() {
    generacion++;
    sesion = null;
    borrarTodo();
    for (const ch of canales) { try { supabase.removeChannel(ch); } catch {} }
    canales.clear();
  }

  // Cada llamada tiene tiempo límite. Las que no duplican nada al repetirse (reintentos > 0)
  // se reintentan solas ante fallos pasajeros: 0.6 s, 1.2 s…
  async function rpc(fn, args = {}, { reintentos = 0, limite = LIMITE_MS } = {}) {
    const g = generacion;
    for (let intento = 0; ; intento++) {
      const ctrl = typeof AbortController === "function" ? new AbortController() : null;
      let vencido = false, res;
      const reloj = ctrl ? setTimeout(() => { vencido = true; ctrl.abort(); }, limite) : null;
      try {
        let q = supabase.rpc(fn, args);
        if (ctrl && typeof q.abortSignal === "function") q = q.abortSignal(ctrl.signal);
        res = await q;
      } catch (e) { res = { error: e, status: 0 }; }
      finally { clearTimeout(reloj); }
      if (g !== generacion) {
        throw new ErrorApi("DESCARTADA", "La respuesta llegó cuando el equipo ya había cambiado de sucursal o de autorización.");
      }
      if (!res.error) return res.data;
      const err = traducir(res.error, res.status, vencido);
      // el equipo dejó de estar autorizado (revocado, suspendido o de una sucursal o cuenta inactiva)
      if (err.codigo === "DISPOSITIVO") desvincular();
      if (err.codigo === "RED" && intento < reintentos) { await esperar(600 * 2 ** intento); continue; }
      throw err;
    }
  }
  const conToken = (fn, args = {}, opciones) => rpc(fn, { p_token: token(), ...args }, opciones);
  const seguro = { reintentos: 2 };   // operaciones idempotentes
  // Las acciones con PIN de administrador devuelven {ok:false,error} en vez de fallar
  const conPin = async (fn, args) => {
    const r = await conToken(fn, args);
    if (r && r.ok === false) throw new ErrorApi(r.error, mensajePin(r), r);
    return r;
  };
  // Configuración del negocio: también responde {ok:false,error}
  const conConfig = async (fn, args) => {
    const r = await conToken(fn, args);
    if (r && r.ok === false) throw new ErrorApi(r.error, mensajeConfig(r), r);
    return r;
  };

  // Identidad del equipo en Supabase (MODELO.md §4): una sesión anónima. nueva: descarta la anterior (por
  // ejemplo, revocada) y empieza otra; la anterior no se recupera. captcha: función que entrega un token sin
  // usar del CAPTCHA (src/captcha.js); solo se pide si hay que iniciar una identidad.
  async function asegurarIdentidad({ nueva = false, captcha } = {}) {
    if (nueva) { try { await supabase.auth.signOut({ scope: "local" }); } catch {} }
    const { data } = await supabase.auth.getSession();
    if (data?.session) return;
    let captchaToken;
    try { captchaToken = captcha ? await captcha() : undefined; }
    catch { throw new ErrorApi("CAPTCHA", "Falta la verificación de seguridad. Complétala e inténtalo de nuevo."); }
    const { error } = await supabase.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
    if (error && /captcha/i.test(`${error.code} ${error.message}`)) {
      throw new ErrorApi("CAPTCHA", "No se pudo comprobar la verificación de seguridad. Vuelve a intentarlo.");
    }
    if (error) throw new ErrorApi("IDENTIDAD", "No se pudo iniciar la identidad de este equipo. Revisa la conexión e inténtalo de nuevo.");
  }

  return {
    modo: "remoto",
    // Vincular este equipo a una sucursal con el código que generó un dueño (vincular_dispositivo). Si la
    // identidad del equipo había sido revocada, se empieza una nueva y se usa el mismo código.
    async vincular(codigo, nombre, { captcha } = {}) {
      await asegurarIdentidad({ captcha });
      const llamar = () => rpc("vincular_dispositivo", { p_codigo: codigo, p_nombre: nombre });
      let r;
      try { r = await llamar(); } catch (e) {
        if (e.codigo !== "REVOCADO") throw e;
        await asegurarIdentidad({ nueva: true, captcha });
        r = await llamar();
      }
      if (r?.ok === false) throw new ErrorApi(r.error, mensajeVinculacion(r), r);
      if (cambiarSucursal(r.sucursal.id)) { generacion++; sesion = null; }
      return r;
    },
    async pantallaLogin() {
      const r = await rpc("usuarios_login", {}, seguro);
      // el servidor dice de qué sucursal es este equipo; si es otra que la anterior, lo de aquella se borra
      if (cambiarSucursal(r?.sucursal?.id)) { generacion++; sesion = null; }
      return r;
    },
    sucursal: sucursalActual,
    async entrar(id, pin) {
      const r = await rpc("login", { p_id: id, p_pin: pin, p_dispositivo: dispositivo() });
      if (r.ok) {
        sesion = { token: r.token, usuario: r.usuario, debeCambiarPin: !!r.debeCambiarPin };
        guardarSesion(sesion);
      }
      return r.ok ? { ok: true, usuario: r.usuario, debeCambiarPin: !!r.debeCambiarPin } : r;
    },
    sesionGuardada: () => (sesion ? { usuario: sesion.usuario, debeCambiarPin: sesion.debeCambiarPin } : null),
    async salir() {
      const t = token();
      sesion = null; guardarSesion(null);
      if (t) { try { await rpc("logout", { p_token: t }); } catch {} }
    },
    // Sesión bloqueada por inactividad (BLOQUEO_INACTIVIDAD): el mismo operador vuelve a escribir su PIN
    desbloquear: (pin) => conToken("desbloquear", { p_pin: pin }),
    async cambiarPin(actual, nuevo) {
      const r = await conToken("cambiar_pin", { p_pin_actual: actual, p_pin_nuevo: nuevo });
      if (r.ok && sesion) { sesion = { ...sesion, debeCambiarPin: false }; guardarSesion(sesion); }
      return r;
    },
    cargar: (partes = null) => conToken("estado", { p_partes: partes }, seguro),
    latido: () => conToken("latido_cocina", {}, { reintentos: 1 }),
    liberarCocina: () => conToken("liberar_cocina").catch(() => {}),

    suscribir(onCambio, onConexion) {
      let pendientes = new Set(), timer = null, suscrito = false, ultimo = Date.now();
      const disparar = (partes) => {
        partes.forEach((p) => pendientes.add(p));
        clearTimeout(timer);
        timer = setTimeout(() => { const ps = [...pendientes]; pendientes = new Set(); ultimo = Date.now(); onCambio(ps); }, 250);
      };
      // Canal privado de la sucursal (MODELO.md §7): solo lo escucha un equipo vinculado y vigente de esa
      // sucursal, con su sesión de Supabase. Sin sucursal conocida, o si el servidor rechaza el canal, la app
      // sigue al día con la consulta periódica de abajo.
      const g = generacion, suc = sucursalActual();
      let ch = null;
      if (suc) {
        ch = supabase.channel("sucursal:" + suc, { config: { private: true } })
          .on("broadcast", { event: "cambio" }, (m) => { if (g === generacion) disparar(TABLA_PARTES[m?.payload?.t] || TODAS); });
        canales.add(ch);
        Promise.resolve(supabase.realtime?.setAuth?.()).catch(() => {}).finally(() => {
          if (g !== generacion || !canales.has(ch)) return;
          ch.subscribe((st) => {
            suscrito = st === "SUBSCRIBED";
            onConexion(suscrito ? "online" : "reconnecting");
            if (suscrito) disparar(TODAS); // al (re)conectar, ponerse al día
          });
        });
      } else onConexion("reconnecting");
      // Respaldo si el tiempo real no llega: más frecuente mientras no hay suscripción
      const iv = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        if (Date.now() - ultimo > (suscrito ? 30000 : 10000)) disparar(TODAS);   // las partes pesadas que no se ven se difieren
      }, 5000);
      const recuperar = () => { if (document.visibilityState === "visible") disparar(TODAS); };
      window.addEventListener("online", recuperar);
      document.addEventListener("visibilitychange", recuperar);
      return () => {
        clearTimeout(timer); clearInterval(iv);
        window.removeEventListener("online", recuperar);
        document.removeEventListener("visibilitychange", recuperar);
        if (ch) { canales.delete(ch); supabase.removeChannel(ch); }
      };
    },

    acciones: {
      guardarBorrador: (mesaId, pedido, version) => conToken("guardar_borrador_mesa", { p_mesa_id: mesaId, p_pedido: pedido, p_version: version ?? null }),
      liberarMesa: (mesaId) => conToken("liberar_mesa", { p_mesa_id: mesaId }),
      enviar: (t) => conToken("enviar_comanda", { p_ticket: t }, { reintentos: 1 }),   // idempotente por id
      reenviar: (id, mesaId) => conToken("reenviar_cocina", { p_id: id, p_mesa_id: mesaId }),
      corte: (adminPin) => conPin("hacer_corte", { p_admin_pin: adminPin }),
      ajustarBebida: (id, delta) => conToken("ajustar_bebida", { p_id: id, p_delta: delta }),
      actualizarBebida: (id, cambios) => conToken("actualizar_bebida", { p_id: id, p_cambios: cambios }),
      agregarBebida: (nombre, precio, cantidad) => conToken("agregar_bebida", { p_nombre: nombre, p_precio: precio, p_cantidad: cantidad }),
      eliminarBebida: (id) => conToken("eliminar_bebida", { p_id: id }),
      actualizarCarne: (id, activo) => conToken("actualizar_carne", { p_id: id, p_activo: activo }),
      agregarCarne: (nombre) => conToken("agregar_carne", { p_nombre: nombre }),
      eliminarCarne: (id) => conToken("eliminar_carne", { p_id: id }),
      fijarPrecio: (clave, precio) => conToken("fijar_precio", { p_clave: clave, p_precio: precio }),
      fijarPrecioExtra: (id, precio) => conToken("fijar_precio_extra", { p_id: id, p_precio: precio }),
      agregarExtra: (cat, nombre, precio) => conToken("agregar_extra", { p_cat: cat, p_nombre: nombre, p_precio: precio }),
      eliminarExtra: (id) => conToken("eliminar_extra", { p_id: id }),
      alternarOculto: (clave) => conToken("alternar_oculto", { p_clave: clave }),
      agregarGasto: (id, concepto, monto) => conToken("agregar_gasto", { p_id: id, p_concepto: concepto, p_monto: monto }),
      eliminarGasto: (id) => conToken("eliminar_gasto", { p_id: id }),
      crearUsuario: (adminPin, nombre, pin, rol) => conPin("crear_usuario", { p_admin_pin: adminPin, p_nombre: nombre, p_pin: pin, p_rol: rol }),
      eliminarUsuario: (adminPin, id) => conPin("eliminar_usuario", { p_admin_pin: adminPin, p_id: id }),
      restablecerPin: (adminPin, id, pin) => conPin("restablecer_pin", { p_admin_pin: adminPin, p_id: id, p_pin_nuevo: pin }),
      // quita el bloqueo por intentos fallidos de una persona del personal (MODELO.md §6)
      restablecerAcceso: (adminPin, id) => conPin("restablecer_acceso", { p_admin_pin: adminPin, p_id: id }),
      cobrar: (id, tickets, metodo, recibido, propina, liberarMesa) => conToken("cobrar", {
        p_id: id, p_tickets: tickets, p_metodo: metodo, p_recibido: recibido ?? null, p_propina: propina || 0, p_liberar_mesa: !!liberarMesa,
      }, { reintentos: 1 }),   // idempotente por id
      anularCobro: (id, motivo) => conToken("anular_cobro", { p_id: id, p_motivo: motivo }),
      marcarRecibido: (ids) => conToken("marcar_recibido", { p_ids: ids }, seguro),
      moverTickets: (tickets, hacia) => conToken("mover_tickets", { p_tickets: tickets, p_hacia: hacia }, seguro),
      archivarTickets: (ids) => conToken("archivar_tickets", { p_ids: ids }, seguro),
      marcarHecho: (ticketId, linea, hecho) => conToken("marcar_hecho", { p_ticket: ticketId, p_linea: linea, p_hecho: !!hecho }, seguro),
      fijarAjuste: (clave, valor) => conToken("fijar_ajuste", { p_clave: clave, p_valor: valor }),
      fijarNegocio: (nombre, zona) => conConfig("fijar_negocio", { p_nombre: nombre, p_zona_horaria: zona }),
      fijarMesas: (cantidad) => conConfig("fijar_mesas", { p_cantidad: cantidad }),
      noCobrar: (adminPin, tickets, motivo, liberarMesa) => conPin("no_cobrar", {
        p_admin_pin: adminPin, p_tickets: tickets, p_motivo: motivo, p_liberar_mesa: !!liberarMesa,
      }),
    },
  };
}

// Texto para las respuestas {ok:false, error} de vincular_dispositivo
export function mensajeVinculacion(r) {
  const min = Math.max(1, Math.ceil((r?.espera || 0) / 60));
  switch (r?.error) {
    case "codigo": return r.restantes > 0
      ? `Código no válido, vencido o ya usado. Te quedan ${r.restantes} intento(s).`
      : "Código no válido, vencido o ya usado. Por seguridad, el siguiente intento tendrá que esperar unos minutos.";
    case "bloqueado": return `Demasiados intentos con códigos equivocados. Espera ${min} min e inténtalo de nuevo.`;
    case "nombre": return "Escribe un nombre para este equipo (por ejemplo «Caja» o «Cocina»).";
    default: return "No se pudo vincular el equipo.";
  }
}

// Texto para las respuestas {ok:false, error} de login, PIN y administración
export function mensajePin(r) {
  const min = Math.max(1, Math.ceil((r?.espera || 0) / 60));
  switch (r?.error) {
    case "pin": return r.restantes > 0 && r.restantes <= 3
      ? `PIN incorrecto. Te quedan ${r.restantes} intento(s) antes de un bloqueo temporal.` : "PIN incorrecto.";
    case "bloqueado": return `Demasiados intentos. Espera ${min} min e inténtalo de nuevo.`;
    case "cocina_ocupada": return "Ya hay una cocina abierta en otro dispositivo. Para usar varias pantallas, actívalo en Administración → Cocina.";
    case "formato": return "El PIN nuevo debe tener de 6 a 8 dígitos.";
    case "debil": return "Ese PIN es muy fácil de adivinar (por ejemplo 1234 o 1111). Elige otro.";
    case "rol": return "Rol no válido.";
    case "nombre": return "Escribe un nombre.";
    case "propio": return "No puedes eliminar tu propio usuario.";
    case "ultimo_admin": return "Debe quedar al menos un administrador.";
    case "no_existe": return "Ese usuario ya no existe.";
    case "vacio": return "No hay ventas en este periodo.";
    default: return "No se pudo completar la operación.";
  }
}

// En el modo local no hay servidor: una sola sucursal, «local»
if (!supabase) cambiarSucursal("local");
export const api = supabase ? crearRemoto() : crearLocal({ ErrorApi, mensajePin });
export const remoto = api.modo === "remoto";
