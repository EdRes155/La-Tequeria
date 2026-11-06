// Servidor simulado para los recorridos «remoto-simulado» (playwright.config.js): intercepta las llamadas
// de supabase-js a la dirección configurada y responde como lo harían las funciones de supabase-schema.sql.
// No hay base de datos: cada prueba decide qué responde cada función y puede cambiarlo a mitad del recorrido.
import { CARNES_DEFAULT, BEBIDAS_DEFAULT, preciosDefault, resumenPeriodo, NUM_MESAS } from "../../../src/dominio.js";
import { SUPABASE_SIMULADO } from "../../../playwright.config.js";

export const SUCURSAL = "5a1c0000-0000-4000-8000-000000000001";
export const PIN = "583920";

// Estado inicial de una sucursal recién creada, como lo devuelve estado(): mesas libres y el catálogo inicial
export function estadoInicial(yo) {
  return {
    yo: { ...yo, cambiarPin: false }, servidor: new Date().toISOString(), bloqueo: null,
    nombreNegocio: "Taquería Simulada", zonaHoraria: "America/Mexico_City",
    precios: preciosDefault(CARNES_DEFAULT), extras: [], ocultos: [], ajustes: {},
    carnes: CARNES_DEFAULT, bebidas: BEBIDAS_DEFAULT, usuarios: [yo],
    mesas: Array.from({ length: NUM_MESAS }, (_, i) => ({ id: i + 1, estado: "libre", pedido: null, mesero: null, hora: null, extras: [], version: 0, desde: null })),
    cocina: [], historial: [], periodo: resumenPeriodo([], [], []), cortes: [], gastos: [], porCobrar: [],
  };
}

// Error de una función (raise con hint), como lo entrega PostgREST
export const errorDe = (codigo, mensaje) => ({ status: 400, body: { code: "P0001", message: codigo, hint: mensaje, details: null } });
export const NO_AUTORIZADO = errorDe("DISPOSITIVO", "Este equipo no está autorizado. Pide a un dueño que lo vincule a la sucursal.");

// Token con forma de JWT (supabase-js y Realtime lo leen) para una identidad anónima simulada
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tokenDe = (uid, correo = null) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: uid, role: "authenticated",
  is_anonymous: !correo, ...(correo ? { email: correo } : {}), exp: Math.floor(Date.now() / 1000) + 3600 })}.firma`;
const sesionDe = (uid, correo = null) => ({ access_token: tokenDe(uid, correo), token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "renovar-" + uid,
  user: { id: uid, aud: "authenticated", role: "authenticated", is_anonymous: !correo, ...(correo ? { email: correo } : {}) } });
const errorAuth = (status, codigo, msg) => ({ status, contentType: "application/json", body: JSON.stringify({ code: status, error_code: codigo, msg }) });

// Instala el servidor en la página. respuestas: { función: (args, quien) => datos | { status, body } }, donde
// quien es el id de la identidad anónima que llama (null sin sesión). Simula también Supabase Auth: cada
// inicio de sesión anónimo crea una identidad nueva. Devuelve el registro de llamadas, las identidades
// creadas y una forma de cambiar respuestas.
// Turnstile simulado: cada vez que se pinta o se reinicia el widget entrega un token nuevo (captcha-1, -2…).
const TURNSTILE = `(() => {
  let n = 0; const ws = {};
  const dar = (id) => setTimeout(() => ws[id] && ws[id].callback && ws[id].callback("captcha-" + (++n)), 50);
  window.turnstile = {
    render(el, o) { const id = "w" + Object.keys(ws).length; ws[id] = o; el.setAttribute("data-turnstile", o.sitekey); dar(id); return id; },
    reset(id) { dar(id); }, remove(id) { delete ws[id]; },
  };
})();`;

// personas: { correo: { clave, confirmado } } que pueden entrar con correo y contraseña (panel de dueños)
export async function servidorSimulado(page, respuestas, { captcha = () => true, personas = {} } = {}) {
  const llamadas = [];
  const identidades = [];
  const captchas = [];   // token de CAPTCHA de cada inicio anónimo (null si no llegó)
  const tabla = { ...respuestas };
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: TURNSTILE }));
  await page.route(`${SUPABASE_SIMULADO}/**`, async (route) => {
    const url = new URL(route.request().url());
    const cuerpo = (() => { try { return route.request().postDataJSON() || {}; } catch { return {}; } })();
    const tokenCaptcha = cuerpo.gotrue_meta_security?.captcha_token ?? null;
    const sinCaptcha = () => route.fulfill(errorAuth(400, "captcha_failed", "captcha protection: request disallowed"));
    // persona que entra con correo y contraseña (panel de dueños)
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      captchas.push(tokenCaptcha);
      llamadas.push({ fn: "auth:password", args: { correo: cuerpo.email, captcha: tokenCaptcha }, quien: null, t: Date.now() });
      if (!tokenCaptcha || !captcha(tokenCaptcha)) return sinCaptcha();
      const p = personas[cuerpo.email];
      if (!p || p.clave !== cuerpo.password) return route.fulfill(errorAuth(400, "invalid_credentials", "Invalid login credentials"));
      if (!p.confirmado) return route.fulfill(errorAuth(400, "email_not_confirmed", "Email not confirmed"));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sesionDe("p-" + cuerpo.email, cuerpo.email)) });
    }
    if (url.pathname === "/auth/v1/recover") {
      llamadas.push({ fn: "auth:recover", args: { correo: cuerpo.email, captcha: tokenCaptcha }, quien: null, t: Date.now() });
      return tokenCaptcha && captcha(tokenCaptcha) ? route.fulfill({ status: 200, contentType: "application/json", body: "{}" }) : sinCaptcha();
    }
    if (url.pathname === "/auth/v1/signup" && cuerpo.email) {
      // alta de una persona: queda sin confirmar hasta abrir el enlace del correo
      captchas.push(tokenCaptcha);
      llamadas.push({ fn: "auth:signup-correo", args: { correo: cuerpo.email, captcha: tokenCaptcha }, quien: null, t: Date.now() });
      if (!tokenCaptcha || !captcha(tokenCaptcha)) return sinCaptcha();
      personas[cuerpo.email] = { clave: cuerpo.password, confirmado: false };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "p-" + cuerpo.email, email: cuerpo.email,
        aud: "authenticated", role: "authenticated", identities: [{ id: "i1" }], confirmation_sent_at: new Date().toISOString() }) });
    }
    if (url.pathname === "/auth/v1/signup") {
      // como Supabase con CAPTCHA: sin token válido no hay identidad
      const token = tokenCaptcha;
      captchas.push(token);
      llamadas.push({ fn: "auth:signup", args: { captcha: token }, quien: null, t: Date.now() });
      if (!token || !captcha(token)) return sinCaptcha();
      const uid = `anonima-${identidades.length + 1}`;
      identidades.push(uid);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        access_token: tokenDe(uid), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "renovar-" + uid, user: { id: uid, aud: "authenticated", role: "authenticated", is_anonymous: true } }) });
    }
    if (url.pathname === "/auth/v1/logout") {
      llamadas.push({ fn: "auth:logout", args: {}, quien: null, t: Date.now() });
      return route.fulfill({ status: 204, body: "" });
    }
    const fn = (/\/rest\/v1\/rpc\/(\w+)/.exec(url.pathname) || [])[1];
    if (!fn) return route.fulfill({ status: 404, body: "{}" });
    const args = route.request().postDataJSON() || {};
    const auth = route.request().headers()["authorization"] || "";
    const claims = (() => { try { return JSON.parse(Buffer.from(auth.split(".")[1], "base64url").toString()); } catch { return {}; } })();
    const quien = claims.sub || null;
    llamadas.push({ fn, args, quien, t: Date.now() });
    // Como Supabase real: sin sesión, la llamada va con la llave pública y anon no ejecuta ninguna función
    if (!quien) {
      return route.fulfill({ status: 401, contentType: "application/json",
        body: JSON.stringify({ code: "42501", message: `permission denied for function ${fn}`, hint: null, details: null }) });
    }
    const r = tabla[fn] ? await tabla[fn](args, quien, claims) : { status: 404, body: { code: "PGRST202", message: "no existe" } };
    const esRespuesta = r && typeof r === "object" && "status" in r && "body" in r;
    await route.fulfill({
      status: esRespuesta ? r.status : 200, contentType: "application/json",
      body: JSON.stringify(esRespuesta ? r.body : r),
    });
  });
  return {
    llamadas, identidades, captchas,
    responder(fn, f) { tabla[fn] = f; },
    cuantas: (fn) => llamadas.filter((x) => x.fn === fn).length,
  };
}

// El navegador ya tiene la identidad de un equipo (sesión anónima guardada por supabase-js), como un equipo
// vinculado antes de abrir la app
export async function conIdentidad(page, uid = "equipo-vinculado") {
  const sesion = { access_token: tokenDe(uid), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "renovar-" + uid, user: { id: uid, aud: "authenticated", role: "authenticated", is_anonymous: true } };
  await page.addInitScript((s) => { if (!localStorage.getItem("tequeria-identidad-equipo")) localStorage.setItem("tequeria-identidad-equipo", s); },
    JSON.stringify(sesion));
}

// Pantalla de entrada y login de un usuario de la sucursal simulada
export function entradaDe(usuario) {
  return {
    usuarios_login: () => ({ sucursal: { id: SUCURSAL, nombre: "Centro" }, negocio: "Taquería Simulada",
      usuarios: [{ id: usuario.id, nombre: usuario.nombre }], hayAdmin: true }),
    login: (a) => (a.p_pin === PIN
      ? { ok: true, token: "token-simulado", debeCambiarPin: false, usuario }
      : { ok: false, error: "pin", restantes: 4 }),
    logout: () => null,
  };
}

// Llaves de la app en el almacenamiento del navegador
export const clavesDeLaApp = (page) => page.evaluate(() => [
  ...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) => k.startsWith("tequeria")).sort());

// Sucursal con varias personas: el token del login dice quién es y cada quien recibe su estado. bloquear(u)
// deja su sesión bloqueada por inactividad (como _contexto tras 15 min sin interacción): todo responde
// BLOQUEO_INACTIVIDAD hasta que la misma persona desbloquea con su PIN.
export const SESION_VENCIDA = errorDe("SESION", "Tu sesión terminó. Vuelve a entrar.");
export const BLOQUEO = errorDe("BLOQUEO_INACTIVIDAD", "Por inactividad, escribe tu PIN para continuar.");
export function personalSimulado({ id = SUCURSAL, nombre = "Centro", negocio = "Taquería Simulada", personas, estadoDe }) {
  const bloqueadas = new Set();
  const quien = (a) => personas.find((p) => "tok-" + p.id === a.p_token);
  const conSesion = (f) => (a) => { const u = quien(a); return !u ? SESION_VENCIDA : bloqueadas.has(u.id) ? BLOQUEO : f(u, a); };
  const respuestas = {
    usuarios_login: () => ({ sucursal: { id, nombre }, negocio, usuarios: personas.map(({ id: i, nombre: n }) => ({ id: i, nombre: n })), hayAdmin: true }),
    login: (a) => {
      const u = personas.find((p) => p.id === a.p_id);
      return u && a.p_pin === PIN ? { ok: true, token: "tok-" + u.id, debeCambiarPin: !!u.debeCambiarPin, usuario: u } : { ok: false, error: "pin", restantes: 4 };
    },
    estado: conSesion((u) => estadoDe(u)),
    desbloquear: (a) => {
      const u = quien(a);
      if (!u) return SESION_VENCIDA;
      if (a.p_pin !== PIN) return { ok: false, error: "pin", restantes: 3 };
      bloqueadas.delete(u.id);
      return { ok: true };
    },
    logout: () => null,
    latido_cocina: conSesion(() => true),
  };
  return { respuestas, bloquear: (u) => bloqueadas.add(u.id), bloqueadas };
}
