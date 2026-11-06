// Panel de dueños (paso 6b; MODELO.md §3.3): entrada con correo (con CAPTCHA), alta de la cuenta, códigos de
// vinculación, equipos y su baja, invitaciones, reintento de 40001 y sesión separada de la del equipo.
import { test, expect } from "@playwright/test";
import { servidorSimulado, conIdentidad } from "./servidor-simulado.js";
import { panelSimulado } from "./panel-simulado.js";

const DUENA = "duena@ejemplo.invalid", LUIS = "luis@ejemplo.invalid";
const CLAVE = "contraseña-larga-1";
const personas = () => ({ [DUENA]: { clave: CLAVE, confirmado: true }, [LUIS]: { clave: CLAVE, confirmado: true },
  "nueva@ejemplo.invalid": { clave: CLAVE, confirmado: false } });

async function entrarPanel(page, correo, clave = CLAVE) {
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña", { exact: true }).fill(clave);
  await page.getByRole("button", { name: "Entrar" }).click();
}
async function crearCuenta(page, pin = "582039") {
  await expect(page.getByRole("heading", { name: "Registra tu taquería" })).toBeVisible();
  await page.getByLabel("Nombre del negocio").fill("Tacos Doña Rosa");
  await page.getByLabel(/^Nombre de la primera sucursal/).fill("Matriz");
  await page.getByLabel("Nombre del administrador").fill("Rosa");
  await page.getByLabel("PIN del administrador (6 a 8 dígitos)").fill(pin);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
}

test("una dueña entra con su correo, registra su taquería, genera un código y da de baja un equipo", async ({ page }) => {
  const panel = panelSimulado();
  const srv = await servidorSimulado(page, panel.respuestas, { personas: personas() });
  await page.goto("/duenos");
  await expect(page.getByRole("heading", { name: "Panel de dueños" })).toBeVisible();
  await entrarPanel(page, DUENA);
  // entró con el token del CAPTCHA
  expect(srv.llamadas.filter((x) => x.fn === "auth:password").map((x) => x.args)).toEqual([{ correo: DUENA, captcha: "captcha-1" }]);
  // sin cuentas: registra la suya; un PIN trivial no se acepta
  await crearCuenta(page, "123456");
  await expect(page.getByText("muy fácil de adivinar", { exact: false })).toBeVisible();
  expect(srv.cuantas("crear_cuenta")).toBe(0);
  await page.getByLabel("PIN del administrador (6 a 8 dígitos)").fill("582039");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Tacos Doña Rosa" })).toBeVisible();
  await expect(page.getByText("Propietario · Activa")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Matriz" })).toBeVisible();

  // vincular un equipo: el código se ve legible, con su vencimiento
  await page.getByRole("button", { name: "Vincular un equipo" }).click();
  await expect(page.getByText("ABCD-2345")).toBeVisible();
  await expect(page.getByText(/Vence en \d+:\d\d · sirve una sola vez/)).toBeVisible();
  panel.vincularEquipo("Caja", DUENA);   // el equipo escribe el código
  await page.getByRole("button", { name: "Listo" }).click();
  await expect(page.getByText("Caja", { exact: true })).toBeVisible();
  // darlo de baja pide confirmación
  await page.getByRole("button", { name: "Dar de baja Caja" }).click();
  await page.getByRole("button", { name: "Dar de baja", exact: true }).click();
  await expect(page.getByText("Dados de baja: Caja")).toBeVisible();
  expect(srv.llamadas.filter((x) => x.fn === "revocar_dispositivo").map((x) => x.args.p_dispositivo)).toEqual([panel.modelo.equipos[0].id]);
});

test("invitar a una persona: el enlace sirve entrando con ese correo y queda como encargado", async ({ page }) => {
  const panel = panelSimulado();
  await servidorSimulado(page, panel.respuestas, { personas: personas() });
  await page.goto("/duenos");
  await entrarPanel(page, DUENA);
  await crearCuenta(page);
  await expect(page.getByRole("heading", { name: "Tacos Doña Rosa" })).toBeVisible();
  await page.getByLabel("Correo de la persona").fill(LUIS);
  await page.getByRole("button", { name: "Invitar" }).click();
  const enlace = await page.getByLabel("Enlace de invitación").textContent();
  expect(enlace).toMatch(/\/invitacion\?clave=clave-\d+$/);
  await expect(page.getByRole("button", { name: `Cancelar la invitación de ${LUIS}` })).toBeVisible();
  await page.getByRole("button", { name: "Salir del panel" }).click();

  // Luis abre el enlace y entra con su correo: acepta y ve la cuenta como encargado
  await page.goto(new URL(enlace).pathname + new URL(enlace).search);
  await expect(page.getByText("Te invitaron a una cuenta", { exact: false })).toBeVisible();
  await entrarPanel(page, LUIS);
  await expect(page.getByRole("heading", { name: "Tacos Doña Rosa" })).toBeVisible();
  await expect(page.getByText("Encargado · Activa")).toBeVisible();
  await expect(page).toHaveURL(/\/duenos$/);
  // un encargado vincula equipos, pero no administra personas ni sucursales
  await expect(page.getByRole("button", { name: "Vincular un equipo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Personas con acceso" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nueva sucursal" })).toHaveCount(0);
});

test("40001: el panel repite la llamada en una transacción nueva y la sucursal se crea una sola vez", async ({ page }) => {
  const panel = panelSimulado();
  let primera = true;
  const srv = await servidorSimulado(page, { ...panel.respuestas,
    crear_sucursal: (a, q, c) => {
      if (primera) { primera = false; return { status: 409, body: { code: "40001", message: "could not serialize access due to concurrent update", hint: null, details: null } }; }
      return panel.respuestas.crear_sucursal(a, q, c);
    } }, { personas: personas() });
  await page.goto("/duenos");
  await entrarPanel(page, DUENA);
  await crearCuenta(page);
  await page.getByRole("button", { name: "Nueva sucursal" }).click();
  await page.getByLabel("Nombre de la sucursal").fill("Centro");
  await page.getByLabel("Nombre de su administrador").fill("Beto");
  await page.getByLabel("PIN de su administrador (6 a 8 dígitos)").fill("739104");
  await page.getByRole("button", { name: "Crear sucursal" }).click();
  await expect(page.getByRole("heading", { name: "Centro" })).toBeVisible();
  expect(srv.cuantas("crear_sucursal")).toBe(2);
  expect(panel.modelo.sucursales.filter((s) => s.nombre === "Centro")).toHaveLength(1);
});

test("entrada: contraseña equivocada, correo sin confirmar y alta que pide confirmar el correo", async ({ page }) => {
  const srv = await servidorSimulado(page, panelSimulado().respuestas, { personas: personas() });
  await page.goto("/duenos");
  await entrarPanel(page, DUENA, "otra-contraseña");
  await expect(page.getByText("Correo o contraseña incorrectos.")).toBeVisible();
  await entrarPanel(page, "nueva@ejemplo.invalid");
  await expect(page.getByText("Primero confirma tu correo", { exact: false })).toBeVisible();
  // alta: contraseña de 10 o más y confirmación
  await page.getByRole("button", { name: "Crear acceso" }).click();
  await page.getByLabel("Correo").fill("rosa@ejemplo.invalid");
  await page.getByLabel(/^Contraseña/).fill("corta");
  await page.getByLabel("Repite la contraseña").fill("corta");
  await page.getByRole("button", { name: "Crear acceso" }).click();
  await expect(page.getByText("al menos 10 caracteres", { exact: false })).toBeVisible();
  await page.getByLabel(/^Contraseña/).fill(CLAVE);
  await page.getByLabel("Repite la contraseña").fill(CLAVE);
  await page.getByRole("button", { name: "Crear acceso" }).click();
  await expect(page.getByText("Te enviamos un correo a rosa@ejemplo.invalid", { exact: false })).toBeVisible();
  expect(srv.llamadas.filter((x) => x.fn === "auth:signup-correo").map((x) => x.args.correo)).toEqual(["rosa@ejemplo.invalid"]);
  // cada intento llevó un token de CAPTCHA distinto
  expect(new Set(srv.captchas).size).toBe(srv.captchas.length);
});

test("la sesión del dueño no toca la identidad del equipo vinculado en el mismo navegador", async ({ page }) => {
  await servidorSimulado(page, panelSimulado().respuestas, { personas: personas() });
  await conIdentidad(page, "equipo-de-la-caja");
  await page.goto("/duenos");
  const identidadEquipo = () => page.evaluate(() => localStorage.getItem("tequeria-identidad-equipo"));
  const antes = await identidadEquipo();
  expect(antes).toContain("renovar-equipo-de-la-caja");
  await entrarPanel(page, DUENA);
  await expect(page.getByRole("heading", { name: "Registra tu taquería" })).toBeVisible();
  expect(await page.evaluate(() => !!localStorage.getItem("tequeria-identidad-dueno"))).toBe(true);
  expect(await identidadEquipo()).toBe(antes);
  await page.getByRole("button", { name: "Salir del panel" }).click();
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("tequeria-identidad-dueno"))).toBeNull();
  expect(await identidadEquipo()).toBe(antes);
});
