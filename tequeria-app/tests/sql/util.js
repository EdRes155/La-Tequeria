// Utilidades compartidas por las pruebas de SQL: bases desechables, cliente que llama a la API como un
// equipo vinculado o como una persona (rol authenticated con su JWT, igual que PostgREST) y un reloj
// controlado.
import fs from "node:fs";
import path from "node:path";
import { clienteDesechable, exigirServidorDesechable, nombreDesechable } from "../../scripts/base-desechable.mjs";

export const URL_ADMIN = process.env.TEST_DATABASE_URL;
if (URL_ADMIN) exigirServidorDesechable(URL_ADMIN);
const raiz = path.resolve(import.meta.dirname, "../..");
export const leer = (f) => fs.readFileSync(path.join(raiz, f), "utf8");
export const ESQUEMA = leer("supabase-schema.sql");
export const STUB = leer("tests/sql/supabase-stub.sql");

const bases = [], clientes = [];
const equipos = new Map();   // «base|etiqueta» → identidad de Supabase del equipo de prueba

// Activa las cuentas pendientes con un propietario de prueba, para que sus equipos puedan operar
export async function activarCuentas(sql) {
  await sql.query(`do $$ declare c record; u uuid; begin
    for c in select id from public.cuentas where estado = 'pendiente_activacion' loop
      insert into auth.users (email, email_confirmed_at) values ('propietario-' || c.id || '@ejemplo.invalid', now()) returning id into u;
      insert into public.membresias (cuenta_id, auth_user_id, rol) values (c.id, u, 'propietario');
      update public.cuentas set estado = 'activa', activada_en = now() where id = c.id;
    end loop; end $$`);
}

// Equipo vinculado a una sucursal sin pasar por códigos: un atajo para preparar pruebas. La vinculación
// real (generar_codigo y vincular_dispositivo) se prueba en tests/sql/duenos.test.js.
// Sin sucursal, usa la única que haya.
export async function vincularDePrueba(sql, { sucursal = null, nombre = "caja", monitor = false } = {}) {
  const { rows } = await sql.query(`with u as (insert into auth.users (is_anonymous) values (true) returning id)
    insert into public.dispositivos (sucursal_id, auth_user_id, nombre, monitor_cocina)
    select coalesce($1::uuid, (select id from public.sucursales)), u.id, $2, $3 from u
    returning auth_user_id, id`, [sucursal, nombre, monitor]);
  return { authUid: rows[0].auth_user_id, dispositivoId: rows[0].id };
}

// Persona de Supabase Auth (dueño o encargado), con correo verificado salvo que se pida lo contrario
export async function crearPersona(sql, correo, { verificado = true } = {}) {
  const { rows } = await sql.query("insert into auth.users (email, email_confirmed_at) values ($1, $2) returning id",
    [correo, verificado ? new Date().toISOString() : null]);
  return rows[0].id;
}

// Identidad anónima que aún no es un equipo (un navegador antes de vincularse)
export async function crearAnonimo(sql) {
  return (await sql.query("insert into auth.users (is_anonymous) values (true) returning id")).rows[0].id;
}

// La conexión actúa como esa identidad: rol authenticated con su identidad en el JWT. Las funciones
// leen auth.users (no el JWT) para saber si es anónima o tiene correo verificado.
export async function comoEquipo(c, authUid, { anonima = true } = {}) {
  await c.query("select set_config('request.jwt.claims', $1, false)",
    [JSON.stringify({ sub: authUid, role: "authenticated", is_anonymous: anonima })]);
  await c.query("set role authenticated");
}

async function equipoDe(nombre, etiqueta) {
  const k = nombre + "|" + etiqueta;
  if (!equipos.has(k)) {
    const admin = clienteDesechable(URL_ADMIN, nombre);
    await admin.connect();
    try {
      await activarCuentas(admin);
      equipos.set(k, (await vincularDePrueba(admin, { nombre: etiqueta })).authUid);
    } finally { await admin.end(); }
  }
  return equipos.get(k);
}

export async function crearBase(nombre, scripts) {
  for (const k of [...equipos.keys()]) if (k.startsWith(nombre + "|")) equipos.delete(k);
  const admin = clienteDesechable(URL_ADMIN);
  await admin.connect();
  await admin.query(`drop database if exists ${nombreDesechable(nombre)} with (force)`);
  await admin.query(`create database ${nombre}`);
  await admin.end();
  bases.push(nombre);
  const c = await conectar(nombre, false);
  for (const s of scripts) await c.query(s);
  return c;
}

// Cliente de la API: entra como el equipo «equipo» (se vincula la primera vez) de la única sucursal.
// Con comoApi = false es una conexión administrativa (para preparar o revisar datos).
export async function conectar(nombre, comoApi = true, ip = "203.0.113.10", equipo = "caja") {
  return conectarComo(nombre, comoApi ? await equipoDe(nombre, equipo) : null, ip);
}

// Cliente de la API con una identidad de Supabase concreta (authUid); sin ella, conexión administrativa.
// persona: la identidad es la de una persona (claims sin is_anonymous).
export async function conectarComo(nombre, authUid, ip = "203.0.113.10", { persona = false } = {}) {
  const c = clienteDesechable(URL_ADMIN, nombre);
  await c.connect();
  clientes.push(c);
  if (authUid) {
    await c.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ "x-forwarded-for": ip })]);
    await comoEquipo(c, authUid, { anonima: !persona });
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
  const admin = clienteDesechable(URL_ADMIN);
  await admin.connect();
  for (const b of bases.splice(0)) {
    await admin.query(`drop database if exists ${nombreDesechable(b)} with (force)`).catch(() => {});
    for (const k of [...equipos.keys()]) if (k.startsWith(b + "|")) equipos.delete(k);
  }
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

// Huella de datos (scripts/huella-datos.sql) con su versión y sal
export const HUELLA = leer("scripts/huella-datos.sql");
export async function huellaDe(sql, version, sal) {
  await sql.query("select set_config('huella.version', $1, false), set_config('huella.sal', $2, false)", [version, sal]);
  return (await sql.query(HUELLA)).rows[0].huella;
}

// Carreras: pid de una conexión y espera (hasta 5 s) a que quede detenida en un candado
export const pidDe = async (c) => (await c.query("select pg_backend_pid() p")).rows[0].p;
export async function esperaCandado(sql, pid) {
  for (let i = 0; i < 100; i++) {
    const { rows } = await sql.query("select wait_event_type from pg_stat_activity where pid = $1", [pid]);
    if (rows[0]?.wait_event_type === "Lock") return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}
