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

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const raiz = path.resolve(app, "..");
const SALIDA = path.join(raiz, "docs/multinegocio/INVENTARIO.md");
const URL_ADMIN = process.env.TEST_DATABASE_URL;
const BASE = "tq_inventario";
if (!URL_ADMIN) { console.error("Falta TEST_DATABASE_URL (una base administrativa desechable, nunca producción)."); process.exit(2); }

const leer = (f) => fs.readFileSync(path.join(app, f), "utf8");
const sinComentarios = (s) => s.replace(/--[^\n]*/g, "");
const unicos = (xs) => [...new Set(xs)].sort();
const lista = (xs) => (xs.length ? xs.map((x) => `\`${x}\``).join(", ") : "—");

async function catalogo() {
  const admin = new pg.Client({ connectionString: URL_ADMIN });
  await admin.connect();
  await admin.query(`drop database if exists ${BASE} with (force)`);
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
          p.prosecdef definidor, has_function_privilege('anon', p.oid, 'execute') api, pg_get_functiondef(p.oid) def
        from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1, 2`),
      disparadores: await q(`
        select c.relname tabla, t.tgname nombre, pg_get_triggerdef(t.oid) def
        from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal and c.relnamespace = 'public'::regnamespace order by 1, 2`),
    };
  } finally {
    await c.end();
    await admin.query(`drop database if exists ${BASE} with (force)`);
    await admin.end();
  }
}

function analizar(f, tablas) {
  const cuerpo = sinComentarios(f.def.slice(f.def.indexOf("AS $function$")));
  const toca = (re) => unicos([...cuerpo.matchAll(re)].map((m) => m[1]).filter((t) => tablas.has(t)));
  const escribe = unicos([
    ...toca(/insert\s+into\s+public\.(\w+)/gi), ...toca(/update\s+public\.(\w+)/gi), ...toca(/delete\s+from\s+public\.(\w+)/gi),
  ]);
  const lee = toca(/(?:from|join)\s+public\.(\w+)/gi).filter((t) => !escribe.includes(t) || /select[\s\S]*from\s+public\./i.test(cuerpo));
  const roles = (cuerpo.match(/_exigir\(\s*p_token\s*,\s*array\[([^\]]*)\]/) || [])[1];
  const acceso = !f.api ? (f.nombre === "crear_admin_inicial" ? "Solo SQL Editor" : "Interna")
    : roles ? `Sesión: ${roles.replace(/'/g, "").replace(/\s+/g, " ")}`
    : /_sesion\(\s*p_token/.test(cuerpo) ? "Sesión: cualquier rol"
    : /\bp_token\b/.test(f.args) ? "Token propio (sin revisar rol)"
    : "Sin sesión";
  const marcas = [];
  if (/\bid\s*=\s*1\b/.test(cuerpo)) marcas.push("fila única `id = 1`");
  for (const m of cuerpo.matchAll(/pg_advisory_xact_lock(_shared)?\(hashtextextended\('([^']+)'/g)) marcas.push(`candado \`${m[2]}\`${m[1] ? " (compartido)" : ""}`);
  if (/'duplicado',\s*true/.test(cuerpo)) marcas.push("devuelve lo ya guardado si se repite el id");
  if (/_verificar_admin\(/.test(cuerpo)) marcas.push("PIN de administrador");
  if (/_pin_ok\(|_hash_pin\(/.test(cuerpo)) marcas.push("verifica o guarda PIN");
  if (/realtime\.send/.test(cuerpo)) marcas.push("aviso en tiempo real (canal `tequeria`, público)");
  const prefijos = unicos([...cuerpo.matchAll(/_(?:fallo|espera|limpiar_intentos)\('(\w+):'/g)].map((m) => m[1] + ":"));
  if (prefijos.length) marcas.push(`contadores de intentos ${prefijos.map((x) => `\`${x}\``).join(", ")}`);
  if (/\bnow\(\)/.test(cuerpo)) marcas.push("usa `now()`");
  const ids = (f.args.match(/\bp_(?:id|ids|ticket|tickets|mesa_id)\b/g) || []);
  if (f.api && ids.length) marcas.push(`recibe ids del cliente (${unicos(ids).join(", ")})`);
  const contexto = acceso.startsWith("Sesión") || acceso.startsWith("Token") ? "Sucursal de la sesión operativa"
    : acceso === "Sin sesión" ? "Sucursal del dispositivo vinculado"
    : acceso === "Solo SQL Editor" ? "Se reemplaza por el registro del dueño"
    : f.resultado === "trigger" ? "Sucursal de la fila (canal privado por sucursal)"
    : escribe.length || lee.length ? "Recibe la sucursal de quien la llama" : "Ninguno (no toca datos)";
  return { lee, escribe, acceso, marcas, contexto };
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
  // PIN de 4 o 5 dígitos en las pruebas: deberán cambiar con la política de 6 a 8 dígitos
  const pruebas = [];
  const recorrer = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p);
    else if (/\.(js|sql)$/.test(e.name)) {
      const n = (fs.readFileSync(p, "utf8").match(/["'](\d{4,5})["']/g) || []).length;
      if (n) pruebas.push({ archivo: path.relative(app, p), n });
    }
  });
  recorrer(path.join(app, "tests"));
  return { claves: claves.sort((x, y) => x.clave.localeCompare(y.clave)), rpcs: [...rpcs].sort(), canales: [...canales].sort(), pruebas };
}

function documento({ tablas, funciones, disparadores }, cli) {
  const nombres = new Set(tablas.map((t) => t.tabla));
  const fs_ = funciones.map((f) => ({ ...f, ...analizar(f, nombres) }));
  const api = fs_.filter((f) => f.api), internas = fs_.filter((f) => !f.api);
  const conFila1 = fs_.filter((f) => f.marcas.some((m) => m.startsWith("fila única"))).map((f) => f.nombre);
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
  L.push(`- **${funciones.length} funciones**: ${api.length} de la API (ejecutables por la app) y ${internas.length} internas.`);
  L.push(`- **Fila única \`id = 1\`** (configuración y cocina activa) en ${conFila1.length} funciones: ${lista(conFila1)}.`);
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
  L.push("| Función | Acceso hoy | Lee | Escribe | Puntos a cuidar | Contexto que deberá recibir |");
  L.push("|---|---|---|---|---|---|");
  for (const f of api) L.push(`| \`${f.nombre}(${f.args})\` | ${f.acceso} | ${lista(f.lee)} | ${lista(f.escribe)} | ${f.marcas.join("; ") || "—"} | ${f.contexto} |`);
  L.push("");
  L.push("## Funciones internas");
  L.push("");
  L.push("| Función | Lee | Escribe | Puntos a cuidar | Contexto que deberá recibir |");
  L.push("|---|---|---|---|---|");
  for (const f of internas) L.push(`| \`${f.nombre}(${f.args})\` | ${lista(f.lee)} | ${lista(f.escribe)} | ${f.marcas.join("; ") || "—"} | ${f.contexto} |`);
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
