#!/usr/bin/env node
// Inventario del estado actual para el plan multinegocio (PLAN-MULTINEGOCIO.md).
// Carga supabase-schema.sql en una base desechable, lee el catálogo de PostgreSQL y el código
// del navegador, y genera docs/multinegocio/INVENTARIO.md.
//   TEST_DATABASE_URL=postgres://… npm run inventario            → regenera el documento
//   TEST_DATABASE_URL=postgres://… npm run inventario -- --check → falla si no está al día
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { exigirServidorDesechable, nombreDesechable } from "./base-desechable.mjs";
import { directo, conDependencias, unicos, lista } from "./inventario-analisis.mjs";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const raiz = path.resolve(app, "..");
const SALIDA = path.join(raiz, "docs/multinegocio/INVENTARIO.md");
const URL_ADMIN = process.env.TEST_DATABASE_URL;
const BASE = "tq_inventario";
try { exigirServidorDesechable(URL_ADMIN); } catch (e) { console.error(e.message); process.exit(2); }

const leer = (f) => fs.readFileSync(path.join(app, f), "utf8");

async function catalogo() {
  const admin = new pg.Client({ connectionString: URL_ADMIN });
  await admin.connect();
  await admin.query(`drop database if exists ${nombreDesechable(BASE)} with (force)`);
  await admin.query(`create database ${BASE}`);
  const u = new URL(URL_ADMIN); u.pathname = "/" + BASE;
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  try {
    await c.query(leer("tests/sql/supabase-stub.sql"));
    await c.query(leer("supabase-schema.sql"));
    const q = async (s) => (await c.query(s)).rows;
    return {
      tablas: await q(`
        select c.relname tabla, c.relrowsecurity rls,
          (select json_agg(json_build_object('col', a.attname, 'tipo', format_type(a.atttypid, a.atttypmod),
                    'nulo', not a.attnotnull, 'identidad', a.attidentity <> '') order by a.attnum)
             from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) columnas,
          (select json_agg(json_build_object('tipo', k.contype, 'def', pg_get_constraintdef(k.oid)) order by k.conname)
             from pg_constraint k where k.conrelid = c.oid and k.contype in ('p', 'u', 'f')) llaves,
          has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
            or has_table_privilege('anon', c.oid, 'update') acceso_anon
        from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1`),
      funciones: await q(`
        select p.proname nombre, pg_get_function_identity_arguments(p.oid) args, pg_get_function_result(p.oid) resultado,
          p.prosecdef definidor, has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') api, pg_get_functiondef(p.oid) def
        from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1, 2`),
      disparadores: await q(`
        select c.relname tabla, t.tgname nombre, pg_get_triggerdef(t.oid) def
        from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal and c.relnamespace = 'public'::regnamespace order by 1, 2`),
    };
  } finally {
    await c.end();
    await admin.query(`drop database if exists ${nombreDesechable(BASE)} with (force)`);
    await admin.end();
  }
}

function cliente() {
  const src = path.join(app, "src");
  const archivos = fs.readdirSync(src).filter((f) => /\.(js|jsx)$/.test(f));
  const claves = [], rpcs = new Set(), canales = new Set();
  for (const a of archivos) {
    const s = fs.readFileSync(path.join(src, a), "utf8");
    for (const m of s.matchAll(/const\s+(\w*KEY\w*)\s*=\s*"(tequeria_[^"]+)"/g)) claves.push({ archivo: a, nombre: m[1], clave: m[2] });
    for (const m of s.matchAll(/getItem\(\s*"(tequeria_[^"]+)"/g)) claves.push({ archivo: a, nombre: "(literal, versión anterior)", clave: m[1] });
    for (const m of s.matchAll(/(?:rpc|conToken|conPin)\(\s*"(\w+)"/g)) rpcs.add(m[1]);
    for (const m of s.matchAll(/\.channel\(\s*"([^"]+)"/g)) canales.add(m[1]);
  }
  // PIN de 4 o 5 dígitos en las pruebas: deberán cambiar con la política de 6 a 8 dígitos. Las copias
  // fijas de esquemas ya publicados no se adaptan (reproducen producción tal como está).
  const INSTANTANEAS = new Set(["tests/sql/esquema-v2.sql", "tests/sql/esquema-v3.sql", "tests/sql/produccion-extra.sql"]);
  const pruebas = [];
  const recorrer = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p);
    else if (/\.(js|sql)$/.test(e.name) && !INSTANTANEAS.has(path.relative(app, p))) {
      const n = (fs.readFileSync(p, "utf8").match(/["'](\d{4,5})["']/g) || []).length;
      if (n) pruebas.push({ archivo: path.relative(app, p), n });
    }
  });
  recorrer(path.join(app, "tests"));
  pruebas.sort((x, y) => (x.archivo < y.archivo ? -1 : 1));
  return { claves: claves.sort((x, y) => x.clave.localeCompare(y.clave)), rpcs: [...rpcs].sort(), canales: [...canales].sort(), pruebas };
}

function documento({ tablas, funciones, disparadores }, cli) {
  const nombres = new Set(tablas.map((t) => t.tabla));
  const nombresFn = new Set(funciones.map((f) => f.nombre));
  const fs_ = conDependencias(funciones.map((f) => ({ ...f, ...directo(f, nombres, nombresFn) })));
  const col = (directas, indirectas) => !indirectas.length ? lista(directas)
    : directas.length ? `${lista(directas)} · por otras: ${lista(indirectas)}` : `por otras: ${lista(indirectas)}`;
  const puntos = (f) => [...f.marcas, ...f.indirectas].join("; ") || "—";
  const api = fs_.filter((f) => f.api), internas = fs_.filter((f) => !f.api);
  const conFila1 = fs_.filter((f) => f.marcas.some((m) => m.startsWith("fila única"))).map((f) => f.nombre);
  const conFila1Indirecta = fs_.filter((f) => !conFila1.includes(f.nombre) && f.indirectas.some((m) => m.startsWith("fila única"))).map((f) => f.nombre);
  const idempotentes = fs_.filter((f) => f.marcas.some((m) => m.startsWith("devuelve lo ya guardado"))).map((f) => f.nombre);
  const pinAdmin = fs_.filter((f) => f.marcas.includes("PIN de administrador")).map((f) => f.nombre);
  const candados = unicos(fs_.flatMap((f) => f.marcas.filter((m) => m.startsWith("candado")).map((m) => m.match(/`([^`]+)`/)[1])));
  const sinUso = api.map((f) => f.nombre).filter((n) => !cli.rpcs.includes(n));
  const L = [];
  L.push("# Inventario del estado actual");
  L.push("");
  L.push("Generado por `tequeria-app/scripts/inventario.mjs` a partir de `supabase-schema.sql` y del código del navegador.");
  L.push("No se edita a mano: `npm run inventario` lo regenera y la CI comprueba que esté al día.");
  L.push("Sirve de lista de control para el [plan multinegocio](../../PLAN-MULTINEGOCIO.md): cada tabla, función, candado,");
  L.push("canal y clave del navegador de esta lista debe quedar ligada a una sucursal o justificarse como global.");
  L.push("");
  L.push("## Resumen");
  L.push("");
  L.push(`- **${tablas.length} tablas** en \`public\`, ninguna con acceso directo para \`anon\`: ${tablas.filter((t) => t.acceso_anon).length ? "⚠️ revisar" : "correcto"}.`);
  L.push(`- **${funciones.length} funciones**: ${api.length} de la API (ejecutables por \`anon\` o \`authenticated\`) y ${internas.length} internas.`);
  L.push(`- **Fila única \`id = 1\`** (configuración y cocina activa) en ${conFila1.length} funciones: ${lista(conFila1)}; y a través de otras en ${conFila1Indirecta.length} más: ${lista(conFila1Indirecta)}.`);
  L.push(`- **Candados** (\`pg_advisory_xact_lock\`) globales hoy: ${lista(candados)}. Deben incluir la sucursal.`);
  L.push(`- **Devuelven lo ya guardado** si se repite el id: ${lista(idempotentes)}. Deben comprobar que sea de la misma sucursal.`);
  L.push(`- **PIN de administrador:** ${lista(pinAdmin)}. No debe servir el de otra sucursal.`);
  L.push(`- **Tiempo real:** el servidor avisa en el canal ${lista(unicos(cli.canales))} (público y único para todos); el navegador escucha ${lista(cli.canales)}.`);
  L.push(`- **Funciones de la API que el navegador no usa:** ${lista(sinUso)} (compatibilidad; decidir si se retiran).`);
  L.push("");
  L.push("## Tablas");
  L.push("");
  L.push("| Tabla | Columnas | Llaves y referencias | RLS |");
  L.push("|---|---|---|---|");
  for (const t of tablas) {
    const cols = (t.columnas || []).map((c) => `${c.col}${c.identidad ? " (identidad)" : ""}`).join(", ");
    const llaves = (t.llaves || []).map((k) => ({ p: "PK ", u: "único ", f: "FK " }[k.tipo] + k.def.replace(/^(PRIMARY KEY|UNIQUE|FOREIGN KEY) /, ""))).join("; ") || "—";
    L.push(`| \`${t.tabla}\` | ${cols} | ${llaves} | ${t.rls ? "sí" : "no"} |`);
  }
  L.push("");
  L.push("## Funciones de la API");
  L.push("");
  L.push("Contexto: de dónde deberá salir la sucursal en el modelo multinegocio ([MODELO.md](MODELO.md)).");
  L.push("");
  L.push("Lee y escribe: primero lo directo; «por otras» es lo que hace a través de las funciones que llama.");
  L.push("");
  L.push("| Función | Acceso hoy | Lee | Escribe | Llama a | Puntos a cuidar | Contexto que deberá recibir |");
  L.push("|---|---|---|---|---|---|---|");
  for (const f of api) L.push(`| \`${f.nombre}(${f.args})\` | ${f.acceso} | ${col(f.lee, f.leeIndirecto)} | ${col(f.escribe, f.escribeIndirecto)} | ${lista(f.llama)} | ${puntos(f)} | ${f.contexto} |`);
  L.push("");
  L.push("## Funciones internas");
  L.push("");
  L.push("| Función | Lee | Escribe | Llama a | Puntos a cuidar | Contexto que deberá recibir |");
  L.push("|---|---|---|---|---|---|");
  for (const f of internas) L.push(`| \`${f.nombre}(${f.args})\` | ${col(f.lee, f.leeIndirecto)} | ${col(f.escribe, f.escribeIndirecto)} | ${lista(f.llama)} | ${puntos(f)} | ${f.contexto} |`);
  L.push("");
  L.push("## Disparadores");
  L.push("");
  L.push("| Tabla | Disparador | Definición |");
  L.push("|---|---|---|");
  for (const d of disparadores) L.push(`| \`${d.tabla}\` | \`${d.nombre}\` | \`${d.def.replace(/^CREATE TRIGGER \w+ /, "")}\` |`);
  L.push("");
  L.push("## Navegador");
  L.push("");
  L.push("Claves guardadas en `localStorage` o `sessionStorage`. Deberán incluir la sucursal o borrarse al cambiar de sucursal.");
  L.push("");
  L.push("| Clave | Constante | Archivo |");
  L.push("|---|---|---|");
  for (const k of cli.claves) L.push(`| \`${k.clave}\` | \`${k.nombre}\` | \`src/${k.archivo}\` |`);
  L.push("");
  L.push(`Funciones que llama el navegador (${cli.rpcs.length}): ${lista(cli.rpcs)}.`);
  L.push("");
  L.push("## Pruebas con PIN de 4 o 5 dígitos");
  L.push("");
  L.push("La política nueva exige PIN de 6 a 8 dígitos. Estas pruebas usan textos de 4 o 5 dígitos (casi siempre PIN) y");
  L.push("deberán adaptarse cuando se implemente, además de agregar casos de rechazo y transición.");
  L.push("");
  L.push("| Archivo | Apariciones |");
  L.push("|---|---|");
  for (const x of cli.pruebas) L.push(`| \`${x.archivo}\` | ${x.n} |`);
  L.push("");
  return L.join("\n");
}

const texto = documento(await catalogo(), cliente());
if (process.argv.includes("--check")) {
  const actual = fs.existsSync(SALIDA) ? fs.readFileSync(SALIDA, "utf8") : "";
  if (actual !== texto) { console.error("docs/multinegocio/INVENTARIO.md no está al día: ejecuta `npm run inventario`."); process.exit(1); }
  console.log("Inventario al día.");
} else {
  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, texto);
  console.log("Inventario escrito en docs/multinegocio/INVENTARIO.md");
}
