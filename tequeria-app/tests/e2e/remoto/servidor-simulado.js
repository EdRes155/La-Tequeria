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
const tokenDe = (uid) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: uid, role: "authenticated", is_anonymous: true,
  exp: Math.floor(Date.now() / 1000) + 3600 })}.firma`;

// Instala el servidor en la página. respuestas: { función: (args, quien) => datos | { status, body } }, donde
// quien es el id de la identidad anónima que llama (null sin sesión). Simula también Supabase Auth: cada
// inicio de sesión anónimo crea una identidad nueva. Devuelve el registro de llamadas, las identidades
// creadas y una forma de cambiar respuestas.
export async function servidorSimulado(page, respuestas) {
  const llamadas = [];
  const identidades = [];
  const tabla = { ...respuestas };
  await page.route(`${SUPABASE_SIMULADO}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/v1/signup") {
      const uid = `anonima-${identidades.length + 1}`;
      identidades.push(uid);
      llamadas.push({ fn: "auth:signup", args: {}, quien: null, t: Date.now() });
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
    const quien = (() => { try { return JSON.parse(Buffer.from(auth.split(".")[1], "base64url").toString()).sub || null; } catch { return null; } })();
    llamadas.push({ fn, args, quien, t: Date.now() });
    // Como Supabase real: sin sesión, la llamada va con la llave pública y anon no ejecuta ninguna función
    if (!quien) {
      return route.fulfill({ status: 401, contentType: "application/json",
        body: JSON.stringify({ code: "42501", message: `permission denied for function ${fn}`, hint: null, details: null }) });
    }
    const r = tabla[fn] ? await tabla[fn](args, quien) : { status: 404, body: { code: "PGRST202", message: "no existe" } };
    const esRespuesta = r && typeof r === "object" && "status" in r && "body" in r;
    await route.fulfill({
      status: esRespuesta ? r.status : 200, contentType: "application/json",
      body: JSON.stringify(esRespuesta ? r.body : r),
    });
  });
  return {
    llamadas, identidades,
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
