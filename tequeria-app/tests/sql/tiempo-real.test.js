// Tiempo real privado por sucursal (MODELO.md §7; multinegocio paso 5). En Supabase, el servidor de Realtime
// autoriza un canal privado consultando realtime.messages con la identidad del cliente y realtime.topic()
// apuntando al canal: aquí se hace lo mismo con el stub (tests/sql/supabase-stub.sql). Lo que solo se puede
// medir con Supabase real (cuánto tarda una conexión ya abierta en dejar de recibir avisos tras revocar el
// equipo) queda para staging (MODELO.md §9, paso 7).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { URL_ADMIN, ESQUEMA, STUB, crearBase, conectarComo, cerrarTodo, falla, crearAnonimo, crearPersona } from "./util.js";
import { sembrar } from "./sembrar.js";

const d = URL_ADMIN ? describe : describe.skip;
const BASE = "tq_tiempo_real";

d("tiempo real privado por sucursal", () => {
  let sql, A, B;
  const canal = (X) => "sucursal:" + X.id;
  const avisos = async (desde) => (await sql.query(
    "select topic, payload, event, private from realtime.messages where id > $1 order by id", [desde])).rows;
  const ultimo = async () => Number((await sql.query("select coalesce(max(id), 0) n from realtime.messages")).rows[0].n);

  // ¿Esta conexión puede escuchar este canal? Igual que el servidor de Realtime: con realtime.topic() en el
  // canal, lee realtime.messages como el cliente. Todo dentro de una transacción que se deshace.
  async function escucha(con, topic, preparar) {
    await con.query("begin");
    try {
      if (preparar) { await con.query("reset role"); await preparar(con); await con.query("set role authenticated"); }
      await con.query("select set_config('realtime.topic', $1, true)", [topic]);
      return (await con.query("select count(*)::int n from realtime.messages where topic = $1", [topic])).rows[0].n > 0;
    } finally { await con.query("rollback"); }
  }

  beforeAll(async () => {
    sql = await crearBase(BASE, [STUB, ESQUEMA]);
    const sem = await sembrar(sql);
    const prep = async (s) => ({ id: s.id, cuenta: s.cuenta, sem: s,
      caja: await conectarComo(BASE, s.equipos.caja.authUid), cocina: await conectarComo(BASE, s.equipos.cocina.authUid) });
    A = await prep(sem["tequeria-centro"]);
    B = await prep(sem["piloto-b-unica"]);
    // un aviso ya publicado en cada canal (y en el canal público anterior) para poder leerlo
    for (const t of [canal(A), canal(B), "tequeria"]) await sql.query("select realtime.send('{\"t\":\"prueba\"}', 'cambio', $1, true)", [t]);
  });
  afterAll(cerrarTodo);

  it("cada cambio avisa solo al canal privado de su sucursal, una vez por sentencia y sin datos", async () => {
    let desde = await ultimo();
    await sql.query("update public.bebidas set cantidad = cantidad + 1 where sucursal_id = $1", [A.id]);
    expect(await avisos(desde)).toEqual([{ topic: canal(A), payload: { t: "bebidas" }, event: "cambio", private: true }]);
    // una sentencia que toca las dos sucursales avisa a cada una, una vez
    desde = await ultimo();
    await sql.query("update public.carnes set orden = orden where sucursal_id in ($1, $2)", [A.id, B.id]);
    expect((await avisos(desde)).map((x) => x.topic).sort()).toEqual([canal(A), canal(B)].sort());
    // inserción y borrado también; una sentencia sin filas no avisa
    desde = await ultimo();
    await sql.query("insert into public.gastos (id, sucursal_id, concepto, monto) values ('tr-gasto', $1, 'Hielo', 10)", [B.id]);
    await sql.query("delete from public.gastos where id = 'tr-gasto'");
    await sql.query("update public.gastos set monto = monto where false");
    expect(await avisos(desde)).toEqual([
      { topic: canal(B), payload: { t: "gastos" }, event: "cambio", private: true },
      { topic: canal(B), payload: { t: "gastos" }, event: "cambio", private: true }]);
    // todas las tablas que ve la app avisan; ninguna lleva más que el nombre de la tabla
    const { rows } = await sql.query(`select distinct c.relname t from pg_trigger g join pg_class c on c.oid = g.tgrelid
      where g.tgname like 'avisar_%' and not g.tgisinternal order by 1`);
    expect(rows.map((r) => r.t)).toEqual(["bebidas", "carnes", "cobros", "cocina_hechos", "config", "cortes", "gastos", "mesas", "tickets", "usuarios"]);
    expect((await sql.query("select count(*)::int n from realtime.messages where not private or payload - 't' <> '{}'::jsonb and payload->>'t' <> 'prueba'")).rows[0].n).toBe(0);
  });

  it("solo un equipo vigente de la sucursal escucha su canal", async () => {
    expect(await escucha(A.caja, canal(A))).toBe(true);
    expect(await escucha(A.cocina, canal(A))).toBe(true);
    expect(await escucha(B.caja, canal(B))).toBe(true);
    // el canal de otra sucursal, y el canal público anterior, no
    expect(await escucha(A.caja, canal(B))).toBe(false);
    expect(await escucha(B.caja, canal(A))).toBe(false);
    expect(await escucha(A.caja, "tequeria")).toBe(false);
    // ni un equipo que dejó de estar vigente, por cada regla de _dispositivo
    const uid = A.sem.equipos.caja.authUid;
    const casos = {
      revocado: (c) => c.query("update public.dispositivos set revocado_en = now() where auth_user_id = $1", [uid]),
      suspendido: (c) => c.query("update auth.users set banned_until = now() + interval '1 hour' where id = $1", [uid]),
      borrado: (c) => c.query("update auth.users set deleted_at = now() where id = $1", [uid]),
      convertido: (c) => c.query("update auth.users set is_anonymous = false, email = 'x@ejemplo.invalid', email_confirmed_at = now() where id = $1", [uid]),
      "sucursal inactiva": (c) => c.query("update public.sucursales set activa = false where id = $1", [A.id]),
      "cuenta suspendida": (c) => c.query("update public.cuentas set estado = 'suspendida' where id = $1", [A.cuenta]),
    };
    for (const [caso, preparar] of Object.entries(casos)) expect([caso, await escucha(A.caja, canal(A), preparar)]).toEqual([caso, false]);
    // ni una identidad anónima sin equipo, ni una persona (aunque sea propietaria de la cuenta)
    expect(await escucha(await conectarComo(BASE, await crearAnonimo(sql)), canal(A))).toBe(false);
    expect(await escucha(await conectarComo(BASE, A.sem.duenos.propietario.authUid, undefined, { persona: true }), canal(A))).toBe(false);
  });

  it("ningún cliente puede publicar, ni en su propio canal", async () => {
    for (const con of [A.caja, await conectarComo(BASE, await crearPersona(sql, "publica@ejemplo.invalid"), undefined, { persona: true })]) {
      const e = await falla(con.query("insert into realtime.messages (topic, extension, payload, event, private) values ($1, 'broadcast', '{\"t\":\"mesas\"}', 'cambio', true)",
        [canal(A)]));
      expect(e.message).toMatch(/row-level security/);
    }
    const anon = await conectarComo(BASE, null);
    await anon.query("set role anon");
    expect((await falla(anon.query("insert into realtime.messages (topic, payload, private) values ($1, '{}', true)", [canal(A)]))).message)
      .toMatch(/row-level security/);
    expect((await anon.query("select count(*)::int n from realtime.messages")).rows[0].n).toBe(0);
  });

  it("la regla de escucha vive fuera de la API y solo la ejecuta authenticated", async () => {
    const { rows } = await sql.query(`select p.oid::regprocedure::text f, has_function_privilege('authenticated', p.oid, 'execute') a,
      has_function_privilege('anon', p.oid, 'execute') n from pg_proc p where p.pronamespace = 'privado'::regnamespace`);
    expect(rows).toEqual([{ f: "privado.puede_escuchar(text)", a: true, n: false }]);
    expect((await sql.query("select has_schema_privilege('anon', 'privado', 'usage') a")).rows[0].a).toBe(false);
    // y solo hay una política sobre realtime.messages: la de escuchar
    expect((await sql.query("select policyname, cmd, roles::text from pg_policies where schemaname = 'realtime' and tablename = 'messages'")).rows)
      .toEqual([{ policyname: "tequeria_escuchar_sucursal", cmd: "SELECT", roles: "{authenticated}" }]);
  });

  it("si hay otra política sobre realtime.messages, el esquema se detiene sin cambiar nada", async () => {
    const otra = await crearBase("tq_tiempo_real_otra", [STUB]);
    await otra.query("create policy cualquiera_publica on realtime.messages for insert to authenticated with check (true)");
    expect((await falla(otra.query(ESQUEMA))).message).toMatch(/otras políticas sobre realtime\.messages \(cualquiera_publica \(INSERT\)\)/);
    await otra.query("rollback");   // el archivo abre su propia transacción, que quedó abortada
    expect((await otra.query("select to_regclass('public.sucursales') t")).rows[0].t).toBeNull();
  });
});
