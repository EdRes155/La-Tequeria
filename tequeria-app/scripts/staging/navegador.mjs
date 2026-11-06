#!/usr/bin/env node
// Recorrido de la app real en el navegador contra STAGING (docs/multinegocio/STAGING.md). Nunca producción.
//   node scripts/staging/navegador.mjs
// Levanta la app (vite) con la URL y la llave pública de staging, y con Chromium: vincula el equipo con un
// código nuevo, entra el administrador de la última sucursal de prueba («Centro A» de humo.mjs, PIN 583920),
// recarga sin perder la identidad ni la sesión, y comprueba que al revocar el equipo la app vuelve a
// «Vincular este equipo» sin datos en pantalla. Usa 1 o 2 inicios anónimos (límite de staging: 30 por hora).
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const REF = process.env.STAGING_REF || "izcaeojzbaoqlxkerria";
const API = `https://api.supabase.com/v1/projects/${REF}`;
const PUERTO = 5176;
const adm = async (ruta, cuerpo) => {
  const r = await fetch(API + ruta, { method: cuerpo ? "POST" : "GET",
    headers: { Authorization: "Bearer proxy-injected", "Content-Type": "application/json" }, body: cuerpo && JSON.stringify(cuerpo) });
  if (!r.ok) throw new Error(`API de administración ${ruta}: HTTP ${r.status}`);
  return r.json();
};
const sql = (query) => adm("/database/query", { query });

const proyecto = await adm("");
if (REF === "ahmkfmoftpvhdcrjnhoe" || !/staging/i.test(proyecto.name)) { console.error("Se niega: no es staging."); process.exit(2); }
const ANON = (await adm("/api-keys?reveal=false")).find((k) => k.name === "anon").api_key;

// sucursal de prueba y un código nuevo para ella (se guarda solo su hash, como generar_codigo)
const [suc] = await sql(`select s.id from public.sucursales s where s.nombre = 'Centro A' order by s.creada desc limit 1`);
if (!suc) { console.error("No hay sucursal de prueba: corre antes scripts/staging/humo.mjs"); process.exit(2); }
const CODIGO = "NAVE" + String(Math.floor(2000 + Math.random() * 7000)).replace(/[01]/g, "7");
await sql(`insert into public.codigos_vinculacion (sucursal_id, codigo_hash, creado_por, vence)
  values ('${suc.id}', public._hash_secreto('codigo', '${CODIGO}'), gen_random_uuid(), now() + interval '10 minutes')`);

const vite = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(PUERTO), "--strictPort"], {
  env: { ...process.env, VITE_SUPABASE_URL: `https://${REF}.supabase.co`, VITE_SUPABASE_ANON_KEY: ANON }, stdio: "ignore" });
const pasos = [];
const paso = async (n, fn) => { try { await fn(); pasos.push(true); console.log("✓ " + n); } catch (e) { pasos.push(false); console.log(`✗ ${n} — ${e.message.split("\n")[0]}`); throw e; } };
let navegador;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PUERTO}`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  navegador = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined });
  const ctx = await navegador.newContext({ ignoreHTTPSErrors: true });   // el proxy del entorno inspecciona TLS
  const page = await ctx.newPage();

  await paso("primera vez: pide vincular el equipo", async () => {
    await page.goto(`http://127.0.0.1:${PUERTO}/`);
    await page.getByRole("heading", { name: "Vincular este equipo" }).waitFor({ timeout: 30000 });
  });
  await paso("vincula con el código (minúsculas y guion) y muestra el personal de su sucursal", async () => {
    await page.getByLabel("Código de vinculación").fill(CODIGO.toLowerCase().replace(/^(.{4})/, "$1-"));
    await page.getByLabel("Nombre de este equipo").fill("Caja del navegador");
    await page.getByRole("button", { name: "Vincular" }).click();
    await page.getByRole("heading", { name: "¿Quién eres?" }).waitFor({ timeout: 20000 });
  });
  await paso("el administrador entra y ve sus 8 mesas", async () => {
    await page.getByRole("button", { name: "Admin A" }).click();
    await page.getByLabel("PIN", { exact: true }).fill("583920");
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.getByRole("heading", { name: "Mesas" }).waitFor({ timeout: 20000 });
    const n = await page.getByRole("button", { name: /^Mesa \d+,/ }).count();
    if (n !== 8) throw new Error(`${n} mesas`);
  });
  await paso("al recargar conserva la identidad del equipo y la sesión", async () => {
    await page.reload();
    await page.getByRole("heading", { name: "Mesas" }).waitFor({ timeout: 20000 });
  });
  await paso("tiempo real: el canal privado de la sucursal queda conectado («En línea, sincronizado»)", async () => {
    await page.getByRole("img", { name: "En línea, sincronizado" }).first().waitFor({ timeout: 30000 });
  });
  await paso("al revocar el equipo vuelve a «Vincular este equipo» sin datos en pantalla", async () => {
    await sql(`update public.dispositivos set revocado_en = now() where nombre = 'Caja del navegador' and revocado_en is null`);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.getByRole("heading", { name: "Vincular este equipo" }).waitFor({ timeout: 20000 });
    if (await page.getByRole("heading", { name: "Mesas" }).count()) throw new Error("siguen las mesas en pantalla");
    const claves = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => k.startsWith("tequeria:")));
    if (claves.length) throw new Error("quedan claves: " + claves.join(", "));
  });
} catch { /* el paso ya lo informó */ } finally {
  await navegador?.close();
  vite.kill();
}
const bien = pasos.filter(Boolean).length;
console.log(`\n${bien} de ${pasos.length} pasos bien.`);
process.exit(bien === pasos.length && bien > 0 ? 0 : 1);
