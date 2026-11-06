// Vinculación del equipo (docs/multinegocio/MODELO.md §4; multinegocio paso 6): la app inicia una sesión
// anónima de Supabase, la vincula con el código que generó un dueño, la conserva entre recargas y, si el
// equipo fue revocado, empieza una identidad nueva con otro código. El servidor simulado lleva qué
// identidades son equipos vigentes o revocados, como dispositivos en supabase-schema.sql.
import { test, expect } from "@playwright/test";
import { servidorSimulado, entradaDe, estadoInicial, errorDe, NO_AUTORIZADO, PIN, SUCURSAL, clavesDeLaApp } from "./servidor-simulado.js";

const ADMIN = { id: "u-admin", nombre: "Ana", rol: "admin" };

// Sucursal simulada: identidades → «vigente» o «revocado», y el código vigente (de un solo uso)
function sucursal() {
  const equipos = new Map();
  const s = { equipos, codigo: "ABCD2345", restantes: 5 };
  const entrada = entradaDe(ADMIN);
  s.respuestas = {
    ...entrada,
    usuarios_login: (a, quien) => (equipos.get(quien) === "vigente" ? entrada.usuarios_login() : NO_AUTORIZADO),
    login: (a, quien) => (equipos.get(quien) === "vigente" ? entrada.login(a) : NO_AUTORIZADO),
    estado: (a, quien) => (equipos.get(quien) === "vigente" ? estadoInicial(ADMIN) : NO_AUTORIZADO),
    vincular_dispositivo: (a, quien) => {
      if (!quien) return errorDe("IDENTIDAD", "El código se escribe en el equipo que se va a vincular.");
      if (equipos.get(quien) === "revocado") return errorDe("REVOCADO", "Este equipo fue dado de baja.");
      if (equipos.get(quien) === "vigente") return errorDe("VINCULADO", "Este equipo ya está vinculado a una sucursal.");
      if (String(a.p_codigo).toUpperCase().replace(/[\s-]/g, "") !== s.codigo) return { ok: false, error: "codigo", restantes: --s.restantes };
      equipos.set(quien, "vigente");
      s.codigo = null;   // un solo uso
      return { ok: true, dispositivo: { id: "d-" + quien, nombre: a.p_nombre, monitorCocina: false }, sucursal: { id: SUCURSAL, nombre: "Centro" } };
    },
  };
  return s;
}

async function vincular(page, codigo, nombre = "Caja") {
  await page.getByLabel("Código de vinculación").fill(codigo);
  await page.getByLabel("Nombre de este equipo").fill(nombre);
  await page.getByRole("button", { name: "Vincular" }).click();
}
async function entrar(page) {
  await page.getByRole("button", { name: "Ana" }).click();
  await page.getByLabel("PIN", { exact: true }).fill(PIN);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
}

test("primera vez: el equipo se vincula con el código, entra su personal y lo conserva al recargar", async ({ page }) => {
  const s = sucursal();
  const srv = await servidorSimulado(page, s.respuestas);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vincular este equipo" })).toBeVisible();
  // sin identidad todavía: Supabase responde 42501 (anon no ejecuta nada) y la app lo trata como equipo sin vincular
  await expect(page.getByText("Este equipo no está vinculado a una sucursal", { exact: false })).toBeVisible();
  expect(srv.identidades).toEqual([]);   // no crea una identidad solo por abrir la app
  // un código equivocado dice cuántos intentos quedan; el bueno, con minúsculas y guion, vincula
  await vincular(page, "abcd-2344");
  await expect(page.getByText("Código no válido, vencido o ya usado. Te quedan 4 intento(s).")).toBeVisible();
  await vincular(page, "abcd-2345");
  await expect(page.getByText("Equipo vinculado a Centro")).toBeVisible();
  await expect(page.getByRole("heading", { name: "¿Quién eres?" })).toBeVisible();
  expect(srv.identidades).toEqual(["anonima-1"]);   // una sola identidad para los dos intentos
  // la identidad se inició con el token del CAPTCHA (widget pintado con la llave de sitio)
  expect(srv.captchas).toEqual(["captcha-1"]);
  await expect(page.locator("[data-turnstile]")).toHaveCount(0);   // ya no está la pantalla de vincular
  expect(srv.llamadas.filter((x) => x.fn === "vincular_dispositivo").map((x) => [x.quien, x.args.p_nombre]))
    .toEqual([["anonima-1", "Caja"], ["anonima-1", "Caja"]]);
  await entrar(page);
  expect(await clavesDeLaApp(page)).toEqual(expect.arrayContaining(["tequeria-identidad-equipo", "tequeria:sucursal", `tequeria:${SUCURSAL}:sesion`]));
  // al recargar, la identidad del equipo y la sesión del operador siguen: no pide vincular ni PIN
  await page.reload();
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
  expect(srv.identidades).toEqual(["anonima-1"]);
});

test("un equipo revocado vuelve a la pantalla de vincular y se recupera con otro código y una identidad nueva", async ({ page }) => {
  const s = sucursal();
  const srv = await servidorSimulado(page, s.respuestas);
  await page.goto("/");
  await vincular(page, "ABCD2345");
  await entrar(page);
  // el dueño revoca el equipo y genera otro código
  s.equipos.set("anonima-1", "revocado");
  s.codigo = "WXYZ6789";
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("heading", { name: "Vincular este equipo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mesas" })).toHaveCount(0);
  await vincular(page, "WXYZ-6789", "Caja nueva");
  await expect(page.getByRole("heading", { name: "¿Quién eres?" })).toBeVisible();
  // la identidad revocada se descartó (sin recuperarla) y la nueva quedó vinculada, con un token nuevo
  expect(srv.identidades).toEqual(["anonima-1", "anonima-2"]);
  expect(srv.captchas).toEqual(["captcha-1", "captcha-2"]);
  expect(srv.cuantas("auth:logout")).toBe(1);
  expect(srv.llamadas.filter((x) => x.fn === "vincular_dispositivo").map((x) => x.quien)).toEqual(["anonima-1", "anonima-1", "anonima-2"]);
  expect(s.equipos.get("anonima-2")).toBe("vigente");
});

test("tras varios códigos equivocados pide esperar, y un equipo vinculado de una cuenta inactiva lo explica", async ({ page }) => {
  const s = sucursal();
  const srv = await servidorSimulado(page, s.respuestas);
  await page.goto("/");
  srv.responder("vincular_dispositivo", () => ({ ok: false, error: "bloqueado", espera: 900 }));
  await vincular(page, "ABCD2345");
  await expect(page.getByText("Demasiados intentos con códigos equivocados. Espera 15 min e inténtalo de nuevo.")).toBeVisible();
  // vinculado, pero su sucursal o su cuenta no está activa: el servidor responde DISPOSITIVO y VINCULADO
  srv.responder("vincular_dispositivo", () => errorDe("VINCULADO", "Este equipo ya está vinculado a una sucursal."));
  await vincular(page, "ABCD2345");
  await expect(page.getByText("su sucursal o su cuenta no está activa por ahora", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vincular este equipo" })).toBeVisible();
});

test("CAPTCHA: sin un token válido no se crea la identidad; al reintentar se usa uno nuevo y vincula", async ({ page }) => {
  const s = sucursal();
  let aceptar = false;
  const srv = await servidorSimulado(page, s.respuestas, { captcha: () => aceptar });
  await page.goto("/");
  await expect(page.locator("[data-turnstile]")).toHaveAttribute("data-turnstile", "1x00000000000000000000AA");
  await vincular(page, "ABCD-2345");
  await expect(page.getByText("No se pudo comprobar la verificación de seguridad", { exact: false })).toBeVisible();
  expect(srv.identidades).toEqual([]);
  expect(srv.cuantas("vincular_dispositivo")).toBe(0);
  // Cloudflare la acepta en el segundo intento: el token usado no se repite
  aceptar = true;
  await page.getByRole("button", { name: "Vincular" }).click();
  await expect(page.getByRole("heading", { name: "¿Quién eres?" })).toBeVisible();
  expect(srv.captchas).toEqual(["captcha-1", "captcha-2"]);
  expect(srv.identidades).toEqual(["anonima-1"]);
});
