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

// Instala el servidor en la página. respuestas: { función: (args) => datos | { status, body } }.
// Devuelve el registro de llamadas y una forma de cambiar respuestas.
export async function servidorSimulado(page, respuestas) {
  const llamadas = [];
  const tabla = { ...respuestas };
  await page.route(`${SUPABASE_SIMULADO}/**`, async (route) => {
    const url = new URL(route.request().url());
    const fn = (/\/rest\/v1\/rpc\/(\w+)/.exec(url.pathname) || [])[1];
    if (!fn) return route.fulfill({ status: 404, body: "{}" });
    const args = route.request().postDataJSON() || {};
    llamadas.push({ fn, args, t: Date.now() });
    const r = tabla[fn] ? await tabla[fn](args) : { status: 404, body: { code: "PGRST202", message: "no existe" } };
    const esRespuesta = r && typeof r === "object" && "status" in r && "body" in r;
    await route.fulfill({
      status: esRespuesta ? r.status : 200, contentType: "application/json",
      body: JSON.stringify(esRespuesta ? r.body : r),
    });
  });
  return {
    llamadas,
    responder(fn, f) { tabla[fn] = f; },
    cuantas: (fn) => llamadas.filter((x) => x.fn === fn).length,
  };
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
