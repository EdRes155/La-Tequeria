// Utilidades compartidas por las pruebas de SQL: bases desechables, cliente que llama como «anon»
// (igual que PostgREST) y un reloj controlado para vencimientos y bloqueos.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

export const URL_ADMIN = process.env.TEST_DATABASE_URL;
const raiz = path.resolve(import.meta.dirname, "../..");
export const leer = (f) => fs.readFileSync(path.join(raiz, f), "utf8");
export const ESQUEMA = leer("supabase-schema.sql");
export const STUB = leer("tests/sql/supabase-stub.sql");

const bases = [], clientes = [];
const urlDe = (nombre) => { const u = new URL(URL_ADMIN); u.pathname = "/" + nombre; return u.toString(); };

export async function crearBase(nombre, scripts) {
  const admin = new pg.Client({ connectionString: URL_ADMIN });
  await admin.connect();
  await admin.query(`drop database if exists ${nombre} with (force)`);
  await admin.query(`create database ${nombre}`);
  await admin.end();
  bases.push(nombre);
  const c = await conectar(nombre, false);
  for (const s of scripts) await c.query(s);
  return c;
}

export async function conectar(nombre, comoAnon = true, ip = "203.0.113.10") {
  const c = new pg.Client({ connectionString: urlDe(nombre) });
  await c.connect();
  clientes.push(c);
  if (comoAnon) {
    await c.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ "x-forwarded-for": ip })]);
    await c.query("set role anon");
  }
  c.rpc = async (fn, args = {}) => {
    const ks = Object.keys(args);
    const { rows } = await c.query(`select public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, ks.map((k) => args[k]));
    return rows[0].r;
  };
  return c;
}

export async function cerrarTodo() {
  for (const c of clientes.splice(0)) await c.end().catch(() => {});
  if (!URL_ADMIN) return;
  const admin = new pg.Client({ connectionString: URL_ADMIN });
  await admin.connect();
  for (const b of bases.splice(0)) await admin.query(`drop database if exists ${b} with (force)`).catch(() => {});
  await admin.end();
}

export async function falla(promesa) {
  try { await promesa; } catch (e) { return e; }
  throw new Error("se esperaba un error");
}

// Reemplaza public._ahora() en la base de prueba por una hora que se fija y se adelanta a mano.
// Así se comprueban bloqueos de minutos y sesiones de horas sin esperarlas.
export async function relojControlado(sql, inicio = new Date()) {
  await sql.query("create table if not exists public._reloj_prueba (ahora timestamptz not null)");
  await sql.query("truncate public._reloj_prueba");
  await sql.query("insert into public._reloj_prueba values ($1)", [new Date(inicio).toISOString()]);
  await sql.query(`create or replace function public._ahora() returns timestamptz language sql stable
    set search_path = public as $$ select ahora from public._reloj_prueba $$`);
  let actual = new Date(inicio);
  return {
    get ahora() { return actual; },
    async avanzar({ horas = 0, minutos = 0, segundos = 0 }) {
      actual = new Date(actual.getTime() + ((horas * 60 + minutos) * 60 + segundos) * 1000);
      await sql.query("update public._reloj_prueba set ahora = $1", [actual.toISOString()]);
    },
  };
}
