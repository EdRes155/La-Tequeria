#!/usr/bin/env node
// Compara dos huellas de datos (scripts/huella-datos.sql), por ejemplo la de origen antes de migrar y la
// de destino después. Uso:
//   node scripts/huella.mjs comparar antes.json despues.json [--permitir abierto.sesiones_vigentes …]
// Sale con 1 si hay diferencias no permitidas. Solo muestra rutas del resumen y llaves de filas, nunca
// datos personales (las firmas ya vienen con sal).
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Diferencias del resumen que la migración produce a propósito, con su motivo (MIGRACION.md §4.4).
// Se pasan explícitamente en cada comparación: ninguna se acepta por omisión.
export const DIFERENCIAS_DEL_CAMBIO = {
  "abierto.sesiones_vigentes": "Al cambiar a dispositivos vinculados se revocan todas las sesiones (MIGRACION.md §4.3)",
};

const aplanar = (o, pre = "", out = {}) => {
  for (const [k, v] of Object.entries(o || {})) {
    const ruta = pre ? `${pre}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) aplanar(v, ruta, out);
    else out[ruta] = v;
  }
  return out;
};

export function compararHuellas(antes, despues, { permitir = [] } = {}) {
  if (!antes?.entidades || !despues?.entidades) throw new Error("Falta la comparación por entidad: usa scripts/huella-datos.sql actual.");
  if (antes.sal !== despues.sal) throw new Error("Las huellas se tomaron con sales distintas: repite ambas con la misma huella.sal.");
  const a = aplanar(antes.resumen), b = aplanar(despues.resumen);
  const resumen = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    .filter((r) => JSON.stringify(a[r]) !== JSON.stringify(b[r]) && !permitir.includes(r))
    .map((ruta) => ({ ruta, antes: a[ruta] ?? null, despues: b[ruta] ?? null }));
  const entidades = {};
  for (const e of [...new Set([...Object.keys(antes.entidades), ...Object.keys(despues.entidades)])].sort()) {
    const x = antes.entidades[e] || {}, y = despues.entidades[e] || {};
    const faltan = Object.keys(x).filter((k) => !(k in y)).sort();
    const sobran = Object.keys(y).filter((k) => !(k in x)).sort();
    const distintas = Object.keys(x).filter((k) => k in y && x[k] !== y[k]).sort();
    if (faltan.length || sobran.length || distintas.length) entidades[e] = { faltan, sobran, distintas };
  }
  const sinSucursal = Object.entries(despues.sin_sucursal || {}).filter(([, n]) => n !== 0).map(([t]) => t).sort();
  return { iguales: !resumen.length && !Object.keys(entidades).length && !sinSucursal.length, resumen, entidades, sinSucursal };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [orden, fa, fb, ...resto] = process.argv.slice(2);
  if (orden !== "comparar" || !fa || !fb) {
    console.error("Uso: node scripts/huella.mjs comparar antes.json despues.json [--permitir ruta …]");
    process.exit(2);
  }
  const leer = (f) => { const j = JSON.parse(fs.readFileSync(f, "utf8")); return j.huella || j[0]?.huella || j; };
  const i = resto.indexOf("--permitir");
  const permitir = i >= 0 ? resto.slice(i + 1) : [];
  for (const r of permitir) if (!DIFERENCIAS_DEL_CAMBIO[r]) console.warn(`Aviso: «${r}» no está entre las diferencias esperadas del cambio.`);
  const r = compararHuellas(leer(fa), leer(fb), { permitir });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.iguales ? 0 : 1);
}
