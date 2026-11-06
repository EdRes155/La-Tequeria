// Sesión bloqueada por inactividad, borradores por autor y pestaña oculta (MODELO.md §5.2 y §8; paso 6c).
// El servidor simulado bloquea la sesión de una persona como _contexto tras 15 minutos sin interacción.
import { test, expect } from "@playwright/test";
import { servidorSimulado, estadoInicial, NO_AUTORIZADO, PIN, conIdentidad, personalSimulado, errorDe } from "./servidor-simulado.js";

const ANA = { id: "u-ana", nombre: "Ana", rol: "admin" };
const BETO = { id: "u-beto", nombre: "Beto", rol: "mesero" };
const TONO = { id: "u-tono", nombre: "Toño", rol: "cocinero" };

async function entrar(page, quien) {
  // la entrada propone a la última persona de este equipo («Cambiar de usuario») o muestra a todo el personal
  // (la propuesta llega un instante después de mostrar al personal)
  await expect(page.getByLabel("PIN", { exact: true }).or(page.getByRole("heading", { name: "¿Quién eres?" })).first()).toBeVisible();
  await page.getByRole("button", { name: "Cambiar de usuario" }).click({ timeout: 1500 }).catch(() => {});
  await page.getByRole("button", { name: quien.nombre, exact: true }).click();
  await page.getByLabel("PIN", { exact: true }).fill(PIN);
  await page.getByRole("button", { name: "Entrar" }).click();
}
const recargar = (page) => page.evaluate(() => window.dispatchEvent(new Event("online")));
const producto = (page, nombre) => page.getByRole("button", { name: new RegExp(`^Agregar ${nombre},`) });
const mesa2 = (page) => page.getByRole("button", { name: /^Mesa 2,/ });
// Ana empieza una comanda en la Mesa 2 y la deja sin enviar
async function borradorEnMesa2(page) {
  await mesa2(page).click();
  await producto(page, "Taco Pastor").click();
  await page.getByRole("button", { name: "Mesas", exact: true }).first().click();
  await expect(mesa2(page)).toHaveAccessibleName(/con cambios sin guardar en este dispositivo/);
}

test("bloqueo por inactividad: pide el PIN sin mostrar datos y, con el PIN correcto, sigue donde estaba", async ({ page }) => {
  const centro = personalSimulado({ personas: [ANA, BETO], estadoDe: estadoInicial });
  const srv = await servidorSimulado(page, centro.respuestas);
  await conIdentidad(page);
  await page.goto("/");
  await entrar(page, ANA);
  await borradorEnMesa2(page);

  // pasan 15 minutos sin interacción: la siguiente consulta responde BLOQUEO_INACTIVIDAD
  centro.bloquear(ANA);
  await recargar(page);
  await expect(page.getByRole("heading", { name: "Sesión bloqueada" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mesas" })).toHaveCount(0);
  await expect(mesa2(page)).toHaveCount(0);
  await expect(page.getByText("Ana, escribe tu PIN", { exact: false })).toBeVisible();
  // un PIN equivocado no desbloquea
  await page.getByLabel("PIN de Ana").fill("999999");
  await page.getByRole("button", { name: "Desbloquear" }).click();
  await expect(page.getByText("PIN incorrecto", { exact: false })).toBeVisible();
  await page.getByLabel("PIN de Ana").fill(PIN);
  await page.getByRole("button", { name: "Desbloquear" }).click();
  // de vuelta, con su borrador
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
  await expect(mesa2(page)).toHaveAccessibleName(/con cambios sin guardar/);
  expect(srv.llamadas.filter((x) => x.fn === "desbloquear").map((x) => x.args.p_pin)).toEqual(["999999", PIN]);
});

test("cambiar de usuario desde el bloqueo: la siguiente persona no ve el borrador y el autor lo recupera al volver", async ({ page }) => {
  const centro = personalSimulado({ personas: [ANA, BETO], estadoDe: estadoInicial });
  await servidorSimulado(page, centro.respuestas);
  await conIdentidad(page);
  await page.goto("/");
  await entrar(page, ANA);
  await borradorEnMesa2(page);
  centro.bloquear(ANA);
  await recargar(page);
  await page.getByRole("button", { name: "Cambiar de usuario" }).click();
  await expect(page.getByRole("heading", { name: "Sesión bloqueada" })).toHaveCount(0);

  // entra Beto: no ve el borrador de Ana
  await entrar(page, BETO);
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
  await expect(mesa2(page)).not.toHaveAccessibleName(/sin guardar/);
  // Beto sale y vuelve a entrar Ana: recupera su borrador (su sesión anterior ya no sirve)
  centro.bloqueadas.clear();
  await page.getByRole("button", { name: /^Cerrar sesión de / }).click();
  await entrar(page, ANA);
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
  await expect(mesa2(page)).toHaveAccessibleName(/con cambios sin guardar/);
  await mesa2(page).click();
  await expect(page.getByRole("button", { name: "Agregar un Taco Pastor a Orden 1" })).toBeVisible();
});

test("salir a propósito descartando el borrador lo borra del equipo", async ({ page }) => {
  const centro = personalSimulado({ personas: [ANA, BETO], estadoDe: estadoInicial });
  await servidorSimulado(page, centro.respuestas);
  await conIdentidad(page);
  await page.goto("/");
  await entrar(page, ANA);
  await borradorEnMesa2(page);
  await page.getByRole("button", { name: /^Cerrar sesión de / }).click();
  await page.getByRole("button", { name: "Salir y descartar" }).click();
  await entrar(page, ANA);
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
  await expect(mesa2(page)).not.toHaveAccessibleName(/sin guardar/);
});

test("pestaña oculta más de 30 s: al volver no muestra datos hasta confirmar; revocado, va a vincular sin mostrar nada", async ({ page }) => {
  await page.clock.install();
  const centro = personalSimulado({ personas: [ANA], estadoDe: estadoInicial });
  const srv = await servidorSimulado(page, centro.respuestas);
  await conIdentidad(page);
  await page.goto("/");
  await entrar(page, ANA);
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();

  // se oculta la pestaña; mientras tanto revocan el equipo (sin avisos ni consultas, la app no se entera)
  const visibilidad = (estado) => page.evaluate((e) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => e });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => e === "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, estado);
  await visibilidad("hidden");
  let soltar;
  const espera = new Promise((r) => { soltar = r; });
  for (const fn of ["estado", "usuarios_login"]) srv.responder(fn, async () => { await espera; return NO_AUTORIZADO; });
  await page.clock.fastForward(31000);
  // anota si las mesas llegan a verse, aunque sea un instante, al volver
  await page.evaluate(() => {
    window.__vioMesas = false;
    new MutationObserver(() => { if ([...document.querySelectorAll("h2")].some((h) => h.textContent === "Mesas")) window.__vioMesas = true; })
      .observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await visibilidad("visible");
  await expect(page.getByText("Comprobando la sesión", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mesas" })).toHaveCount(0);
  soltar();
  await expect(page.getByRole("heading", { name: "Vincular este equipo" })).toBeVisible();
  expect(await page.evaluate(() => window.__vioMesas)).toBe(false);
});

test("monitor dedicado con la sesión bloqueada: las comandas se siguen viendo y marcar algo pide el PIN", async ({ page }) => {
  const comanda = { id: "t-1", folio: 3, tipo: "llevar", origen: "Para llevar · Lupita", mesaId: null, paraLlevar: true,
    ordenes: [{ id: "o-1", nombre: "Orden 1", prep: "con-todo", items: [{ key: "taco-pastor", nombre: "Taco de pastor", cat: "taco", precio: 20, cantidad: 1 }] }],
    extras: [], total: 20, hora: "13:05", mesero: "Ana", estado: "pendiente", cobro: null, hechos: [] };
  const centro = personalSimulado({ personas: [TONO], estadoDe: (u) => ({ ...estadoInicial(u), ajustes: { modoCocina: "monitor" }, cocina: [comanda], bloqueo: "inactividad" }) });
  await servidorSimulado(page, { ...centro.respuestas, mover_tickets: () => errorDe("BLOQUEO_INACTIVIDAD", "Por inactividad, escribe tu PIN para continuar.") });
  await conIdentidad(page);
  await page.goto("/");
  await entrar(page, TONO);
  await expect(page.getByText("Sesión bloqueada por inactividad: las comandas se siguen viendo", { exact: false })).toBeVisible();
  await expect(page.getByText("Lupita", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Desbloquear" }).click();
  await expect(page.getByRole("heading", { name: "Sesión bloqueada" })).toBeVisible();
});

test("PIN nuevo: de 6 a 8 dígitos y no trivial, también al cambiar el que puso un administrador", async ({ page }) => {
  const BETO_TEMP = { ...BETO, debeCambiarPin: true };
  const centro = personalSimulado({ personas: [BETO_TEMP], estadoDe: estadoInicial });
  const srv = await servidorSimulado(page, { ...centro.respuestas, cambiar_pin: () => ({ ok: true }) });
  await conIdentidad(page);
  await page.goto("/");
  await entrar(page, BETO_TEMP);
  const nuevo = page.getByLabel("PIN nuevo (6 a 8 dígitos)");
  await expect(nuevo).toBeVisible();
  const intentar = async (pin) => {
    await page.getByLabel("PIN actual").fill(PIN);
    await nuevo.fill(pin);
    await page.getByLabel(/Confirma/).fill(pin);
    await page.getByRole("button", { name: "Cambiar PIN" }).click();
  };
  await intentar("7391");
  await expect(page.getByText("El PIN nuevo debe tener de 6 a 8 dígitos.")).toBeVisible();
  await intentar("901234");   // secuencia circular
  await expect(page.getByText("muy fácil de adivinar", { exact: false }).first()).toBeVisible();
  expect(srv.cuantas("cambiar_pin")).toBe(0);
  await intentar("582039");
  await expect.poll(() => srv.cuantas("cambiar_pin")).toBe(1);
});
