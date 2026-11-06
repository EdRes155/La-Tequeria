// Al perder la sesión o la autorización del equipo no queda nada de la sesión anterior para quien entre después
// (docs/multinegocio/MODELO.md §8): ni el cobro abierto, ni la impresión de una comanda, ni un diálogo de
// confirmación, ni la lista de personal de la sucursal anterior. Cada prueba vuelve a entrar con otra persona
// —en la misma sucursal o, tras vincular el equipo de nuevo, en otra— cuyo estado ya no trae esa cuenta.
import { test, expect } from "@playwright/test";
import { servidorSimulado, estadoInicial, errorDe, NO_AUTORIZADO, PIN, SUCURSAL, clavesDeLaApp, conIdentidad, personalSimulado } from "./servidor-simulado.js";

const ANA = { id: "u-ana", nombre: "Ana", rol: "admin" };
const BETO = { id: "u-beto", nombre: "Beto", rol: "mesero" };
const TONO = { id: "u-tono", nombre: "Toño", rol: "cocinero" };
const CARLA = { id: "u-carla", nombre: "Carla", rol: "admin" };
const NORTE = "5a1c0000-0000-4000-8000-000000000002";

// Una cuenta para llevar de $20 por cobrar, de la sucursal anterior
const CUENTA = {
  id: "t-lupita", folio: 7, tipo: "llevar", origen: "Para llevar · Lupita", mesaId: null, paraLlevar: true,
  ordenes: [{ id: "o-1", nombre: "Orden 1", prep: "con-todo", items: [{ key: "taco-pastor", nombre: "Taco de pastor", cat: "taco", precio: 20, cantidad: 1 }] }],
  extras: [], total: 20, hora: "13:05", mesero: "Ana", estado: "pendiente", cobro: null, hechos: [],
};

// Sucursal simulada con varias personas (servidor-simulado.js)
const sucursal = (o) => personalSimulado(o).respuestas;
async function entrar(page, quien) {
  const cambiar = page.getByRole("button", { name: "Cambiar de usuario" });
  if (await cambiar.isVisible()) await cambiar.click();
  await page.getByRole("button", { name: quien.nombre, exact: true }).click();
  await page.getByLabel("PIN", { exact: true }).fill(PIN);
  await page.getByRole("button", { name: "Entrar" }).click();
}
const recargar = (page) => page.evaluate(() => window.dispatchEvent(new Event("online")));
const nadaDeLaCuenta = async (page) => {
  await page.waitForTimeout(800);   // por si algo reaparece después de cargar
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Lupita")).toHaveCount(0);
  await expect(page.getByText("$20")).toHaveCount(0);
};

test("sesión vencida con un cobro abierto: entra otra persona y el cobro no reaparece", async ({ page }) => {
  let vencida = false;
  const centro = sucursal({ personas: [ANA, BETO], estadoDe: (u) => ({ ...estadoInicial(u), porCobrar: u.id === ANA.id ? [CUENTA] : [] }) });
  const srv = await servidorSimulado(page, { ...centro, estado: (a) => (vencida && a.p_token === "tok-u-ana" ? errorDe("SESION", "Tu sesión terminó. Vuelve a entrar.") : centro.estado(a)) });
  await conIdentidad(page);
  await page.goto("/");
  await entrar(page, ANA);
  await page.getByRole("button", { name: "Cobrar Para llevar · Lupita, $20" }).click();
  await expect(page.getByRole("dialog", { name: "Cobrar · Para llevar · Lupita" })).toBeVisible();

  // la sesión de Ana vence con el cobro abierto
  vencida = true;
  await recargar(page);
  await expect(page.getByText("Tu sesión terminó")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // la entrada propone a Ana (la última que entró en este equipo); entra Beto: su estado ya no trae esa cuenta
  await entrar(page, BETO);
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
  await nadaDeLaCuenta(page);
  expect(srv.cuantas("estado")).toBeGreaterThan(1);
});

test("revocado con un cobro abierto: se vincula a otra sucursal, entra otra persona y no queda nada de la anterior", async ({ page }) => {
  const centro = sucursal({ personas: [ANA], estadoDe: (u) => ({ ...estadoInicial(u), porCobrar: [CUENTA] }) });
  const norte = sucursal({ id: NORTE, nombre: "Norte", negocio: "Taquería Norte", personas: [CARLA],
    estadoDe: (u) => ({ ...estadoInicial(u), nombreNegocio: "Taquería Norte", porCobrar: [] }) });
  const enNorte = (fn) => (a, quien) => (quien === "equipo-vinculado" ? NO_AUTORIZADO : norte[fn](a));
  const srv = await servidorSimulado(page, centro);
  await conIdentidad(page);
  await page.goto("/");
  await entrar(page, ANA);
  await page.getByRole("button", { name: "Cobrar Para llevar · Lupita, $20" }).click();
  await expect(page.getByRole("dialog", { name: "Cobrar · Para llevar · Lupita" })).toBeVisible();

  // el dueño revoca el equipo: la identidad anterior ya no sirve; con una nueva se vincula a Norte
  for (const fn of ["usuarios_login", "login", "estado", "logout"]) srv.responder(fn, enNorte(fn));
  srv.responder("vincular_dispositivo", (a, quien) => (quien === "equipo-vinculado"
    ? errorDe("REVOCADO", "Este equipo fue dado de baja.")
    : { ok: true, dispositivo: { id: "d-norte", nombre: a.p_nombre, monitorCocina: false }, sucursal: { id: NORTE, nombre: "Norte" } }));
  // desde aquí se anota todo el personal que llegue a verse en la entrada, aunque sea un instante
  await page.evaluate(() => {
    window.__personal = new Set();
    const ver = () => document.querySelectorAll(".user-tile-nombre, .quien-nombre").forEach((n) => window.__personal.add(n.textContent.trim()));
    new MutationObserver(ver).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await recargar(page);
  await expect(page.getByRole("heading", { name: "Vincular este equipo" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ana", exact: true })).toHaveCount(0);   // ni el personal de Centro

  await page.getByLabel("Código de vinculación").fill("WXYZ-6789");
  await page.getByLabel("Nombre de este equipo").fill("Caja");
  await page.getByRole("button", { name: "Vincular" }).click();
  await expect(page.getByRole("heading", { name: "¿Quién eres?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ana", exact: true })).toHaveCount(0);
  await entrar(page, CARLA);
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
  await nadaDeLaCuenta(page);
  expect(await page.evaluate(() => [...window.__personal])).toEqual(["Carla"]);   // Ana no apareció ni un instante
  // y en el navegador solo quedan claves de Norte
  expect((await clavesDeLaApp(page)).filter((k) => k.includes(SUCURSAL))).toEqual([]);
});

test("cocinero con la impresión de una comanda abierta: pierde la autorización, entra otra persona y no reaparece", async ({ page }) => {
  const cocina = (u) => ({ ...estadoInicial(u), ajustes: { modoCocina: "monitor" }, cocina: u.id === TONO.id ? [CUENTA] : [] });
  const centro = sucursal({ personas: [TONO, BETO], estadoDe: cocina });
  let revocado = false;
  const srv = await servidorSimulado(page, { ...centro, estado: (a) => (revocado && a.p_token === "tok-u-tono" ? NO_AUTORIZADO : centro.estado(a)) });
  await conIdentidad(page);
  await page.goto("/");
  await entrar(page, TONO);
  await page.getByRole("button", { name: "Imprimir Para llevar · Lupita" }).click();
  await expect(page.getByRole("dialog", { name: "Ticket · Para llevar · Lupita" })).toBeVisible();

  // el servidor dice que el equipo no está autorizado (por ejemplo, la sucursal se suspendió y volvió)
  revocado = true;
  srv.responder("usuarios_login", () => NO_AUTORIZADO);
  await recargar(page);
  await expect(page.getByRole("heading", { name: "Vincular este equipo" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // vuelve a estar autorizado y entra Beto
  srv.responder("usuarios_login", centro.usuarios_login);
  await page.getByRole("button", { name: "Volver a intentar entrar" }).click();
  await entrar(page, BETO);
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
  await nadaDeLaCuenta(page);
});

test("una confirmación abierta se cancela al perder la sesión y no vuelve a aparecer", async ({ page }) => {
  let vencida = false;
  const centro = sucursal({ personas: [ANA, BETO], estadoDe: (u) => ({ ...estadoInicial(u),
    mesas: estadoInicial(u).mesas.map((m) => (m.id === 3 ? { ...m, estado: "ocupada", mesero: "Ana", hora: "13:00", pedido: { ordenes: CUENTA.ordenes, extras: [] } } : m)) }) });
  const srv = await servidorSimulado(page, { ...centro, estado: (a) => (vencida && a.p_token === "tok-u-ana" ? errorDe("SESION", "Tu sesión terminó. Vuelve a entrar.") : centro.estado(a)) });
  await conIdentidad(page);
  await page.goto("/");
  await entrar(page, ANA);
  await page.getByRole("button", { name: /^Mesa 3,/ }).click();
  await page.getByRole("button", { name: /^Marcar (mesa como )?libre$/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Liberar mesa" })).toBeVisible();
  vencida = true;
  await recargar(page);
  await expect(page.getByText("Tu sesión terminó")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await entrar(page, BETO);
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
  await nadaDeLaCuenta(page);
  expect(srv.cuantas("liberar_mesa")).toBe(0);   // la confirmación pendiente se canceló: no liberó nada
});
