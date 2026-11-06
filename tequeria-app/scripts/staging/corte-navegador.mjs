#!/usr/bin/env node
// La app real en Chromium contra STAGING (docs/multinegocio/STAGING.md), nunca producción: cuánto tarda un
// equipo revocado CON LA APP ABIERTA en quedarse sin datos en pantalla y en dejar de recibir avisos.
//   node scripts/staging/corte-navegador.mjs     → unos 5 min; 5 inicios anónimos
// Cada equipo es un contexto de Chromium con la app vinculada y el administrador dentro, en Mesas:
//   control       vigente todo el tiempo: sigue en Mesas y recibe todos los avisos (si no, la medición no vale)
//   justo-antes, a-medias, recien
//                 se revocan a la vez, con sus JWT en distintos momentos de la renovación y SIN cambios en la
//                 sucursal: no les llega ningún aviso y deben quedarse sin datos por la consulta periódica de la
//                 app (cada 30 s con el tiempo real conectado)
//   con-cambios   se revoca mientras la sucursal cambia cada 5 s: debe quedarse sin datos con el siguiente aviso
// Desde que su pantalla queda sin datos, la conexión de cada equipo revocado ya no recibe avisos de la sucursal.
import { chromium } from "playwright";
import { abrirStaging, administracion, sql, espera, cuentaDePrueba, PIN_PRUEBA, servirApp } from "./comun.mjs";

const PUERTO = 5177;
const COTA_SIN_CAMBIOS = 45;   // s: consulta periódica (30 s sin avisos, revisada cada 5 s) más la respuesta
const COTA_CON_CAMBIOS = 10;   // s: el siguiente aviso (cada 5 s) más la respuesta
const s = (ms) => Math.round(ms / 1000);

const { ANON, SERVICIO } = await abrirStaging({ servicio: true });
const LIMITE = (await administracion("/config/auth")).jwt_exp;
console.log(`Staging ${new Date().toISOString()} · JWT de ${LIMITE} s\n`);
const N = await cuentaDePrueba({ ANON, SERVICIO }, "N");
const TOPIC = "sucursal:" + N.sucursal;
const cambiar = () => sql(`update public.bebidas set cantidad = cantidad + 1 where sucursal_id = '${N.sucursal}' and id = 'coca'`);

const app = await servirApp(ANON, PUERTO);   // compilada como se publica, con la CSP de vercel.json
let navegador, fallos = 0;
const mal = (m) => { fallos++; console.log("✗ " + m); };
const bien = (m) => console.log("✓ " + m);

async function equipo(nombre) {
  const ctx = await navegador.newContext({ ignoreHTTPSErrors: true });   // el proxy del entorno inspecciona TLS
  const page = await ctx.newPage();
  const e = { nombre, page, avisos: [] };
  // avisos del canal de la sucursal que llegan por la conexión de tiempo real de esta pestaña
  page.on("websocket", (ws) => ws.on("framereceived", ({ payload }) => {
    const txt = typeof payload === "string" ? payload : Buffer.from(payload).toString("latin1");
    if (txt.includes(TOPIC) && txt.includes("cambio")) e.avisos.push(Date.now());
  }));
  await page.goto(app.url);
  await page.getByRole("heading", { name: "Vincular este equipo" }).waitFor({ timeout: 30000 });
  await page.getByLabel("Código de vinculación").fill(await N.codigo());
  await page.getByLabel("Nombre de este equipo").fill("Navegador " + nombre);
  await page.getByRole("button", { name: "Vincular" }).click();
  await page.getByRole("button", { name: N.adminNombre, exact: true }).click({ timeout: 20000 });
  await page.getByLabel("PIN", { exact: true }).fill(PIN_PRUEBA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByRole("heading", { name: "Mesas" }).waitFor({ timeout: 20000 });
  await page.getByRole("img", { name: "En línea, sincronizado" }).first().waitFor({ timeout: 30000 });
  const [d] = await sql(`select id from public.dispositivos where sucursal_id = '${N.sucursal}' and nombre = 'Navegador ${nombre}' and revocado_en is null`);
  e.dispositivo = d.id;
  e.vence = await venceDe(e);
  console.log(`  ${nombre}: dentro, en línea (su JWT vence en ${s(e.vence - Date.now())} s)`);
  return e;
}
const venceDe = (e) => e.page.evaluate(() => JSON.parse(localStorage.getItem("tequeria-identidad-equipo") || "{}").expires_at * 1000);
const sinDatos = async (e) => (await e.page.getByRole("heading", { name: "Mesas" }).count()) === 0
  && (await e.page.getByRole("heading", { name: "Vincular este equipo" }).count()) > 0;
async function revocar(e) {
  e.venceAlRevocar = await venceDe(e);
  await N.revocar(e.dispositivo);
  e.revocado = Date.now();
}
async function esperarSinDatos(lista, cota, mientras = async () => {}) {
  const fin = Date.now() + (cota + 15) * 1000;
  while (Date.now() < fin && lista.some((e) => !e.sinDatos)) {
    await mientras();
    for (const e of lista) if (!e.sinDatos && await sinDatos(e)) e.sinDatos = Date.now();
    await espera(500);
  }
}
async function revisarRevocado(e, cota) {
  const claves = await e.page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => k.startsWith("tequeria:")));
  const despues = e.avisos.filter((t) => e.sinDatos && t > e.sinDatos + 1000).length;
  const edad = LIMITE - (e.venceAlRevocar - e.revocado) / 1000;
  const linea = `${e.nombre}: JWT con ${Math.round(edad)} s de edad al revocar; ` +
    (e.sinDatos ? `sin datos en pantalla a los ${((e.sinDatos - e.revocado) / 1000).toFixed(1)} s` : "seguía con datos");
  if (!e.sinDatos) mal(linea);
  else if ((e.sinDatos - e.revocado) / 1000 > cota) mal(`${linea}, más que la cota de ${cota} s`);
  else if (despues) mal(`${linea}, pero su conexión recibió ${despues} aviso(s) después`);
  else if (claves.length) mal(`${linea}, pero quedan claves: ${claves.join(", ")}`);
  else bien(`${linea}; ningún aviso después y sin claves guardadas`);
}

try {
  navegador = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined });

  // Equipos en distintos momentos de la renovación: supabase-js renueva cuando faltan menos de 120 s
  const t0 = Date.now();
  const control = await equipo("control");
  const justoAntes = await equipo("justo-antes");
  const EDAD = Math.max(LIMITE - 130, 60) * 1000;
  while (Date.now() < t0 + EDAD / 2) await espera(1000);
  const aMedias = await equipo("a-medias");
  while (Date.now() < t0 + EDAD - 25000) await espera(1000);
  const recien = await equipo("recien");
  const conCambios = await equipo("con-cambios");

  // Fase 1: sin cambios en la sucursal
  console.log("\nFase 1: se revocan tres equipos sin cambios en la sucursal\n");
  const fase1 = [justoAntes, aMedias, recien];
  for (const e of fase1) await revocar(e);
  await esperarSinDatos(fase1, COTA_SIN_CAMBIOS);
  if (await sinDatos(control) || await sinDatos(conCambios)) mal("un equipo vigente se quedó sin datos");

  // Fase 2: la sucursal cambia cada 5 s; se revoca con-cambios
  console.log("\nFase 2: la sucursal cambia cada 5 s y se revoca con-cambios\n");
  const cambios = [];
  let ultimo = 0;
  const generar = async () => { if (Date.now() - ultimo >= 5000) { ultimo = Date.now(); await cambiar(); cambios.push(ultimo); } };
  for (const fin = Date.now() + 12000; Date.now() < fin;) { await generar(); await espera(500); }
  const antes = conCambios.avisos.length;
  await revocar(conCambios);
  await esperarSinDatos([conCambios], COTA_CON_CAMBIOS, generar);
  for (const fin = Date.now() + 30000; Date.now() < fin;) { await generar(); await espera(500); }
  await espera(4000);

  // Resultados
  console.log("");
  const perdidos = cambios.filter((t) => !control.avisos.some((a) => a >= t && a < t + 4000));
  if (perdidos.length) mal(`control: no recibió ${perdidos.length} de ${cambios.length} cambios: medición inválida`);
  else if (await sinDatos(control)) mal("control: se quedó sin datos");
  else bien(`control: siguió en Mesas y recibió los ${cambios.length} cambios`);
  if (antes === 0) mal("con-cambios: no recibía avisos antes de revocarlo");
  for (const e of fase1) await revisarRevocado(e, COTA_SIN_CAMBIOS);
  await revisarRevocado(conCambios, COTA_CON_CAMBIOS);
} catch (e) {
  mal("el recorrido no terminó: " + e.message.split("\n")[0]);
} finally {
  await navegador?.close();
  await app.cerrar();
}
console.log(fallos ? `\n${fallos} comprobación(es) fallaron.` : "\nTodas las comprobaciones bien.");
process.exit(fallos ? 1 : 0);
