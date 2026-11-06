#!/usr/bin/env node
// Panel de dueños contra STAGING (docs/multinegocio/STAGING.md), nunca producción: la app compilada como se
// publica (con la CSP de vercel.json y el widget real de Turnstile con la llave de prueba) y Supabase real.
//   node scripts/staging/duenos.mjs     → unos 2 min; 1 inicio anónimo
// Recorrido: una dueña entra al panel con su correo, registra su taquería, genera un código; en otra ventana
// un equipo se vincula con ese código y entra su administrador; la dueña lo ve y lo da de baja, y el equipo
// vuelve a «Vincular este equipo»; invita a un encargado, que abre el enlace, entra con su correo y ve la
// cuenta sin poder administrar personas.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { abrirStaging, servirApp, datos, marca, URL_PROYECTO } from "./comun.mjs";

const PUERTO = 5178;
const { ANON, SERVICIO } = await abrirStaging({ servicio: true });
const servicio = createClient(URL_PROYECTO, SERVICIO, { auth: { persistSession: false, autoRefreshToken: false } });
const CLAVE = crypto.randomUUID();
const DUENA = `panel-duena.${marca}@ejemplo.invalid`, LUIS = `panel-luis.${marca}@ejemplo.invalid`;
for (const correo of [DUENA, LUIS]) await datos(servicio.auth.admin.createUser({ email: correo, password: CLAVE, email_confirm: true }), "crear persona");
const NEGOCIO = `Panel ${marca}`, PIN = "582039";

const app = await servirApp(ANON, PUERTO);
const pasos = [];
const paso = async (n, fn) => { try { await fn(); pasos.push(true); console.log("✓ " + n); } catch (e) { pasos.push(false); console.log(`✗ ${n} — ${e.message.split("\n")[0]}`); throw e; } };
let navegador;
const bloqueos = [];
async function ventana() {
  const ctx = await navegador.newContext({ ignoreHTTPSErrors: true });   // el proxy del entorno inspecciona TLS
  const page = await ctx.newPage();
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) bloqueos.push(m.text().slice(0, 160)); });
  return page;
}
async function entrarPanel(page, correo) {
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await page.getByRole("button", { name: "Entrar" }).click();
}
try {
  navegador = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined });
  const duena = await ventana();
  const equipo = await ventana();
  let codigo;

  await paso("la dueña entra al panel con su correo (con el CAPTCHA real) y registra su taquería", async () => {
    await duena.goto(app.url + "duenos");
    await entrarPanel(duena, DUENA);
    await duena.getByRole("heading", { name: "Registra tu taquería" }).waitFor({ timeout: 30000 });
    await duena.getByLabel("Nombre del negocio").fill(NEGOCIO);
    await duena.getByLabel(/^Nombre de la primera sucursal/).fill("Matriz");
    await duena.getByLabel("Nombre del administrador").fill("Rosa");
    await duena.getByLabel("PIN del administrador (6 a 8 dígitos)").fill(PIN);
    await duena.getByRole("button", { name: "Crear cuenta" }).click();
    await duena.getByRole("heading", { name: NEGOCIO }).waitFor({ timeout: 20000 });
    await duena.getByRole("heading", { name: "Matriz" }).waitFor();
  });
  await paso("genera un código y un equipo nuevo se vincula con él; entra su administrador", async () => {
    await duena.getByRole("button", { name: "Vincular un equipo" }).click();
    codigo = (await duena.locator("strong.codigo-vinculacion").textContent({ timeout: 15000 })).trim();
    if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(codigo)) throw new Error("código: " + codigo);
    await equipo.goto(app.url);
    await equipo.getByRole("heading", { name: "Vincular este equipo" }).waitFor({ timeout: 30000 });
    await equipo.getByLabel("Código de vinculación").fill(codigo);
    await equipo.getByLabel("Nombre de este equipo").fill("Caja del panel");
    await equipo.getByRole("button", { name: "Vincular" }).click();
    await equipo.getByRole("button", { name: "Rosa", exact: true }).click({ timeout: 30000 });
    await equipo.getByLabel("PIN", { exact: true }).fill(PIN);
    await equipo.getByRole("button", { name: "Entrar" }).click();
    await equipo.getByRole("heading", { name: "Mesas" }).waitFor({ timeout: 20000 });
  });
  await paso("la dueña ve el equipo y lo da de baja; el equipo vuelve a «Vincular este equipo» sin datos", async () => {
    await duena.getByRole("button", { name: "Listo" }).click();
    await duena.getByText("Caja del panel", { exact: true }).waitFor({ timeout: 15000 });
    await duena.getByRole("button", { name: "Dar de baja Caja del panel" }).click();
    await duena.getByRole("button", { name: "Dar de baja", exact: true }).click();
    await duena.getByText("Dados de baja: Caja del panel").waitFor({ timeout: 15000 });
    await equipo.evaluate(() => window.dispatchEvent(new Event("online")));
    await equipo.getByRole("heading", { name: "Vincular este equipo" }).waitFor({ timeout: 20000 });
    if (await equipo.getByRole("heading", { name: "Mesas" }).count()) throw new Error("siguen las mesas en pantalla");
  });
  let enlace;
  await paso("invita a un encargado: el enlace sirve entrando con ese correo y no deja administrar personas", async () => {
    await duena.getByLabel("Correo de la persona").fill(LUIS);
    await duena.getByRole("button", { name: "Invitar" }).click();
    enlace = (await duena.getByLabel("Enlace de invitación").textContent({ timeout: 15000 })).trim();
    const luis = await ventana();
    const u = new URL(enlace);
    await luis.goto(app.url.replace(/\/$/, "") + u.pathname + u.search);
    await luis.getByText("Te invitaron a una cuenta", { exact: false }).waitFor({ timeout: 30000 });
    await entrarPanel(luis, LUIS);
    await luis.getByRole("heading", { name: NEGOCIO }).waitFor({ timeout: 30000 });
    await luis.getByText("Encargado · Activa").waitFor();
    if (await luis.getByRole("heading", { name: "Personas con acceso" }).count()) throw new Error("un encargado ve la gestión de personas");
    // el enlace ya no sirve una segunda vez
    await luis.goto(app.url.replace(/\/$/, "") + u.pathname + u.search);
    await luis.getByText("La invitación no es válida", { exact: false }).waitFor({ timeout: 20000 });
  });
  await paso("la CSP de vercel.json no bloqueó nada", async () => { if (bloqueos.length) throw new Error(bloqueos.join(" | ")); });
} catch { /* el paso ya lo informó */ } finally {
  await navegador?.close();
  await app.cerrar();
}
const bien = pasos.filter(Boolean).length;
console.log(`\n${bien} de ${pasos.length} pasos bien.`);
process.exit(bien === pasos.length && bien > 0 ? 0 : 1);
