// Equipo revocado con la app abierta (docs/multinegocio/MODELO.md §8): en cuanto el servidor responde
// DISPOSITIVO —en una recarga, con un reintento pendiente o en el latido de cocina— la pantalla queda vacía,
// se vuelve a la entrada, se borran las claves de la app y no se vuelve a pedir nada con la sesión anterior.
import { test, expect } from "@playwright/test";
import { servidorSimulado, entradaDe, estadoInicial, NO_AUTORIZADO, PIN, SUCURSAL, clavesDeLaApp, conIdentidad } from "./servidor-simulado.js";

const ADMIN = { id: "u-admin", nombre: "Ana", rol: "admin" };
const COCINERO = { id: "u-cocina", nombre: "Toño", rol: "cocinero" };

async function entrar(page, usuario) {
  await conIdentidad(page);   // equipo ya vinculado
  await page.goto("/");
  await page.getByRole("button", { name: usuario.nombre }).click();
  await page.getByLabel("PIN", { exact: true }).fill(PIN);
  await page.getByRole("button", { name: "Entrar" }).click();
}
const recargar = (page) => page.evaluate(() => window.dispatchEvent(new Event("online")));

test("revocado durante una recarga: la pantalla se vacía, vuelve a la entrada y no queda nada guardado", async ({ page }) => {
  const srv = await servidorSimulado(page, { ...entradaDe(ADMIN), estado: () => estadoInicial(ADMIN) });
  await entrar(page, ADMIN);
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
  expect(await clavesDeLaApp(page)).toEqual(expect.arrayContaining(["tequeria:sucursal", `tequeria:${SUCURSAL}:sesion`]));

  // el dueño revoca el equipo: todo responde DISPOSITIVO
  for (const fn of ["estado", "usuarios_login", "latido_cocina"]) srv.responder(fn, () => NO_AUTORIZADO);
  await recargar(page);
  await expect(page.getByText("Este equipo no está autorizado", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mesas" })).toHaveCount(0);
  await expect(page.getByText("Se muestra la última información válida")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Mesa 1,/ })).toHaveCount(0);
  expect(await clavesDeLaApp(page)).toEqual(["tequeria-identidad-equipo"]);   // la identidad se conserva hasta saber que fue revocada
});

test("revocado con un reintento pendiente: el reintento se cancela y no vuelve a pedir datos", async ({ page }) => {
  const srv = await servidorSimulado(page, { ...entradaDe(ADMIN), estado: () => estadoInicial(ADMIN) });
  await entrar(page, ADMIN);
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();

  // una recarga falla por el servidor (queda un reintento programado y se ve la última información válida)
  srv.responder("estado", () => ({ status: 500, body: { code: "XX000", message: "falla interna", hint: null, details: null } }));
  await recargar(page);
  await expect(page.getByText("Se muestra la última información válida", { exact: false })).toBeVisible({ timeout: 10000 });
  // y antes de que llegue el reintento, el equipo queda revocado
  for (const fn of ["estado", "usuarios_login"]) srv.responder(fn, () => NO_AUTORIZADO);
  await recargar(page);
  await expect(page.getByRole("heading", { name: "Mesas" })).toHaveCount(0);
  await expect(page.getByText("Se muestra la última información válida", { exact: false })).toHaveCount(0);
  const despues = srv.cuantas("estado");
  await page.waitForTimeout(7000);   // más que la espera del reintento (5 s)
  expect(srv.cuantas("estado")).toBe(despues);
  expect(await clavesDeLaApp(page)).toEqual(["tequeria-identidad-equipo"]);   // la identidad se conserva hasta saber que fue revocada
});

test("revocado en el latido de cocina: el cocinero sale y se borra lo guardado", async ({ page }) => {
  test.setTimeout(60000);   // el latido es cada 15 s
  const srv = await servidorSimulado(page, { ...entradaDe(COCINERO), estado: () => estadoInicial(COCINERO), latido_cocina: () => true });
  await entrar(page, COCINERO);
  await expect(page.getByRole("button", { name: "Cerrar sesión de Toño" })).toBeVisible();
  // los datos siguen llegando, pero el latido ya dice que el equipo no está autorizado
  srv.responder("latido_cocina", () => NO_AUTORIZADO);
  srv.responder("usuarios_login", () => NO_AUTORIZADO);
  await expect(page.getByRole("button", { name: "Cerrar sesión de Toño" })).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByRole("heading", { name: "Mesas" })).toHaveCount(0);
  await expect(page.getByText("Este equipo no está autorizado", { exact: false }).first()).toBeVisible();
  expect(await clavesDeLaApp(page)).toEqual(["tequeria-identidad-equipo"]);   // la identidad se conserva hasta saber que fue revocada
  expect(srv.cuantas("latido_cocina")).toBeGreaterThanOrEqual(2);
});
