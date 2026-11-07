// Panel de dueños (docs/multinegocio/MODELO.md §3.3; paso 6b): las personas (propietarios y encargados) entran
// con su correo y administran sus cuentas, sucursales, miembros, códigos de vinculación y equipos.
//
// La sesión de una persona vive en un cliente de Supabase APARTE, con su propia clave en el navegador: si un
// dueño entra desde un equipo vinculado, la identidad anónima del equipo (tequeria-identidad-equipo) no se toca.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const CLAVE_DUENO = "tequeria-identidad-dueno";
export const supaDueno = url && key
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: CLAVE_DUENO },
    })
  : null;

export class ErrorDueno extends Error {
  constructor(codigo, mensaje, extra = {}) { super(mensaje); this.codigo = codigo; Object.assign(this, extra); }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
// Errores pasajeros: con 40001 (dos cambios a la vez en REPEATABLE READ o SERIALIZABLE) la llamada se repite en
// una transacción nueva y el servidor vuelve a comprobar con lo ya confirmado (MODELO.md §3.3)
const REPETIBLES = new Set(["40001", "40P01"]);
const LANZADOS = {
  IDENTIDAD: "Tu sesión no sirve para el panel: entra con un correo verificado.",
  CUENTA: "No tienes acceso a esa cuenta, o ya no existe.",
  PERMISO: "Solo un propietario puede hacer eso.",
  INVITACION: "La invitación no es válida: venció, ya se usó, se canceló o es para otro correo.",
};

function traducir(error, status) {
  if (status === 0 || /fetch|network|Load failed/i.test(error?.message || "")) {
    return new ErrorDueno("RED", "Sin conexión con el servidor. Revisa el internet e inténtalo de nuevo.");
  }
  if (REPETIBLES.has(error?.code)) return new ErrorDueno("OCUPADO", "El servidor estaba ocupado con otro cambio. Inténtalo de nuevo.");
  if (error?.code === "42501") return new ErrorDueno("IDENTIDAD", "Tu sesión terminó. Vuelve a entrar.");
  if (error?.code === "P0001") return new ErrorDueno(error.message, error.hint || LANZADOS[error.message] || error.message);
  return new ErrorDueno("SERVIDOR", `El servidor rechazó la operación${error?.code ? ` (${error.code})` : ""}. Inténtalo de nuevo.`);
}

async function rpc(fn, args = {}) {
  for (let intento = 0; ; intento++) {
    let res;
    try { res = await supaDueno.rpc(fn, args); } catch (e) { res = { error: e, status: 0 }; }
    if (!res.error) return res.data;
    if (REPETIBLES.has(res.error.code) && intento < 3) { await esperar(200 * 2 ** intento); continue; }
    throw traducir(res.error, res.status);
  }
}

// Respuestas {ok: false, error} de las funciones de dueños
export function mensajeDueno(r, que = "") {
  switch (r?.error) {
    case "nombre": return "Escribe un nombre (hasta 60 caracteres).";
    case "zona": return "Elige una zona horaria válida.";
    case "admin_nombre": return "Escribe el nombre del administrador.";
    case "formato": return "El PIN debe tener de 6 a 8 dígitos.";
    case "debil": return "Ese PIN es muy fácil de adivinar (por ejemplo 123456 o 111111). Elige otro.";
    case "limite": return {
      cuenta: "Ya creaste el máximo de 3 cuentas.",
      sucursal: "La cuenta ya tiene el máximo de 20 sucursales.",
      invitacion: "La cuenta ya tiene 30 invitaciones vigentes. Cancela alguna.",
      codigo: "Esa sucursal ya tiene 10 códigos vigentes. Espera a que venzan (10 minutos).",
    }[que] || "Se alcanzó el límite.";
    case "ya_miembro": return "Esa persona ya es miembro de la cuenta. Para cambiar su rol, quítala e invítala de nuevo.";
    case "correo": return "Escribe un correo válido.";
    case "rol": return "Elige propietario o encargado.";
    case "no_existe": return "Ya no existe. Recarga el panel.";
    case "ultimo_propietario": return "La cuenta debe quedarse con al menos un propietario.";
    default: return "No se pudo completar. Inténtalo de nuevo.";
  }
}
const conRespuesta = (que) => (r) => { if (r?.ok === false) throw new ErrorDueno(r.error, mensajeDueno(r, que), r); return r; };

// --- Sesión de la persona ------------------------------------------------------------------------------
const MENSAJES_AUTH = {
  invalid_credentials: "Correo o contraseña incorrectos.",
  email_not_confirmed: "Primero confirma tu correo: te enviamos un enlace.",
  user_already_exists: "Ya hay una cuenta con ese correo. Entra o recupera tu contraseña.",
  weak_password: "La contraseña es muy débil: usa al menos 10 caracteres.",
  over_request_rate_limit: "Demasiados intentos seguidos. Espera unos minutos.",
  over_email_send_rate_limit: "Se enviaron demasiados correos seguidos. Espera unos minutos.",
};
function errorAuth(error) {
  const codigo = error?.code || "";
  if (/captcha/i.test(`${codigo} ${error?.message}`)) return new ErrorDueno("CAPTCHA", "No se pudo comprobar la verificación de seguridad. Vuelve a intentarlo.");
  if (codigo === "weak_password" || /password should be/i.test(error?.message || "")) return new ErrorDueno("weak_password", MENSAJES_AUTH.weak_password);
  return new ErrorDueno(codigo || "AUTH", MENSAJES_AUTH[codigo] || "No se pudo completar. Revisa los datos e inténtalo de nuevo.");
}
const volverA = (ruta) => `${window.location.origin}${ruta}`;
// A dónde vuelven los enlaces de los correos y la entrada con Google: la misma página, con su invitación si
// la hay (/invitacion?clave=…). Así, aunque la persona cierre esta pestaña y confirme el correo después (o en
// otro equipo), el enlace la lleva a aceptar la invitación.
export const vueltaActual = () => {
  const ruta = window.location.pathname.replace(/\/+$/, "");
  const clave = new URLSearchParams(window.location.search).get("clave");
  return ruta === "/invitacion" && clave ? `/invitacion?clave=${encodeURIComponent(clave)}` : "/duenos";
};
export const auth = {
  async sesion() { const { data } = await supaDueno.auth.getSession(); return data?.session || null; },
  alCambiar: (fn) => supaDueno.auth.onAuthStateChange((ev, s) => fn(ev, s)).data.subscription,
  async entrar(correo, clave, captchaToken) {
    const { data, error } = await supaDueno.auth.signInWithPassword({ email: correo.trim(), password: clave, options: { captchaToken } });
    if (error) throw errorAuth(error);
    return data.session;
  },
  async registrarse(correo, clave, captchaToken, vuelta = "/duenos") {
    const { data, error } = await supaDueno.auth.signUp({ email: correo.trim(), password: clave,
      options: { captchaToken, emailRedirectTo: volverA(vuelta) } });
    if (error) throw errorAuth(error);
    return { confirmar: !data.session };
  },
  async recuperar(correo, captchaToken, vuelta = "/duenos") {
    const { error } = await supaDueno.auth.resetPasswordForEmail(correo.trim(), { captchaToken, redirectTo: volverA(vuelta) });
    if (error) throw errorAuth(error);
  },
  async nuevaClave(clave) {
    const { error } = await supaDueno.auth.updateUser({ password: clave });
    if (error) throw errorAuth(error);
  },
  async salir() { try { await supaDueno.auth.signOut({ scope: "local" }); } catch {} },
  // Entrar con Google: sale a Google y vuelve con la sesión a la misma página (con su invitación, si la hay)
  async conGoogle(vuelta = "/duenos") {
    const { error } = await supaDueno.auth.signInWithOAuth({ provider: "google", options: { redirectTo: volverA(vuelta) } });
    if (error) throw errorAuth(error);
  },
  // Proveedores activados en Supabase Auth (el botón de Google solo aparece si está activado)
  async proveedores() {
    try {
      const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
      return r.ok ? (await r.json()).external || {} : {};
    } catch { return {}; }
  },
};

// --- Funciones de dueños (supabase-schema.sql) ---------------------------------------------------------
export const dueno = {
  misCuentas: () => rpc("mis_cuentas"),
  crearCuenta: (nombre, sucursal, zona, adminNombre, adminPin) => rpc("crear_cuenta", { p_nombre: nombre, p_sucursal: sucursal,
    p_zona_horaria: zona, p_admin_nombre: adminNombre, p_admin_pin: adminPin }).then(conRespuesta("cuenta")),
  aceptarInvitacion: (clave) => rpc("aceptar_invitacion", { p_clave: clave }),
  crearSucursal: (cuenta, nombre, zona, adminNombre, adminPin) => rpc("crear_sucursal", { p_cuenta: cuenta, p_nombre: nombre,
    p_zona_horaria: zona, p_admin_nombre: adminNombre, p_admin_pin: adminPin }).then(conRespuesta("sucursal")),
  crearAdministrador: (cuenta, sucursal, nombre, pin) => rpc("crear_administrador", { p_cuenta: cuenta, p_sucursal: sucursal,
    p_nombre: nombre, p_pin: pin }).then(conRespuesta()),
  listarMiembros: (cuenta) => rpc("listar_miembros", { p_cuenta: cuenta }).then(conRespuesta()),
  invitarMiembro: (cuenta, correo, rol) => rpc("invitar_miembro", { p_cuenta: cuenta, p_correo: correo.trim(), p_rol: rol })
    .then(conRespuesta("invitacion")),
  cancelarInvitacion: (cuenta, invitacion) => rpc("cancelar_invitacion", { p_cuenta: cuenta, p_invitacion: invitacion }).then(conRespuesta()),
  quitarMiembro: (cuenta, miembro) => rpc("quitar_miembro", { p_cuenta: cuenta, p_miembro: miembro }).then(conRespuesta()),
  generarCodigo: (cuenta, sucursal, monitor) => rpc("generar_codigo", { p_cuenta: cuenta, p_sucursal: sucursal, p_monitor: !!monitor })
    .then(conRespuesta("codigo")),
  listarDispositivos: (cuenta, sucursal) => rpc("listar_dispositivos", { p_cuenta: cuenta, p_sucursal: sucursal }).then(conRespuesta()),
  revocarDispositivo: (cuenta, dispositivo) => rpc("revocar_dispositivo", { p_cuenta: cuenta, p_dispositivo: dispositivo }).then(conRespuesta()),
};

// Enlace de una invitación: la clave va en la dirección y la persona la acepta al entrar con ese correo
export const enlaceInvitacion = (clave) => volverA(`/invitacion?clave=${encodeURIComponent(clave)}`);
// Enviar la invitación por correo: Supabase Auth manda a esa persona un enlace de acceso (con el servidor de
// correo del proyecto) que confirma su correo y la trae a /invitacion?clave=… con la sesión iniciada, donde
// la acepta. No cambia la sesión de quien la envía.
export async function enviarInvitacion(correo, clave, captchaToken) {
  const { error } = await supaDueno.auth.signInWithOtp({ email: correo.trim(),
    options: { captchaToken, shouldCreateUser: true, emailRedirectTo: enlaceInvitacion(clave) } });
  if (error) throw errorAuth(error);
}
// Código de vinculación legible: ABCD-2345
export const codigoLegible = (c) => (c && c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c || "");
