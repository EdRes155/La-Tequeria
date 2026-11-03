// Migración multinegocio, paso 1 (expansión) y contracción del estado de cobro, ensayadas sobre una
// copia del esquema de producción con datos sintéticos (nunca contra producción).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { URL_ADMIN, STUB, ESQUEMA, leer, crearBase, conectar, cerrarTodo, falla, huellaDe } from "./util.js";
import { compararHuellas } from "../../scripts/huella.mjs";
import { huellaEsquema } from "../../scripts/huella-esquema.mjs";

const V3 = leer("tests/sql/esquema-v3.sql");
const EXTRA = leer("tests/sql/produccion-extra.sql");
const DATOS = leer("tests/sql/datos-v3.sql");
const CONTRAER = leer("supabase/multinegocio-contraer-estado-cobro.sql");
const CATALOGO = leer("scripts/catalogo-esquema.sql");
// Huella de scripts/catalogo-esquema.sql sobre producción el 3 de noviembre de 2026 (solo catálogo, sin datos),
// calculada con scripts/huella-esquema.mjs
const PRODUCCION = {
  columnas: { n: 122, h: "b3356a7d0e1d9b092882a6e4cf0da699" },
  disparadores: { n: 10, h: "1f57367f25560bb46b3fbe386ff21211" },
  esquema: { n: 1, h: "4d75381beda46f7bd3a2b383fe00e06a" },
  funciones: { n: 64, h: "c692eebfee488dc7f18424d308c985c4" },
  indices: { n: 26, h: "5b68c6e4330b51daf4b2cdfd702a69c1" },
  politicas: { n: 3, h: "fcb46d34a81cb80f63a49c35844d2d5a" },
  restricciones: { n: 27, h: "bbf8a8f0d7067d50a55a818abbe854cd" },
  secuencias: { n: 2, h: "6441c4c1faaaa1b9656b7d665b870fe0" },
  tablas: { n: 15, h: "06e508abbb3724e584400c23e728ddd6" },
};
const d = URL_ADMIN ? describe : describe.skip;

d("instantánea de producción", () => {
  let sql;
  const huella = async () => huellaEsquema((await sql.query(CATALOGO)).rows);
  // Aplica un cambio, toma la huella y lo deshace
  const conCambio = async (cambio) => {
    await sql.query("begin");
    try { await cambio(); return await huella(); } finally { await sql.query("rollback"); }
  };
  const redefinir = async (firma, de, a) => {
    const def = (await sql.query("select pg_get_functiondef($1::regprocedure) d", [firma])).rows[0].d;
    if (!def.includes(de)) throw new Error("no se encontró el texto a cambiar en " + firma);
    await sql.query(def.replace(de, a));
  };
  beforeAll(async () => { sql = await crearBase("tq_instantanea", [STUB, V3, EXTRA]); });
  afterAll(cerrarTodo);

  it("esquema-v3.sql + produccion-extra.sql tienen exactamente la huella de esquema de producción", async () => {
    expect(await huella()).toEqual(PRODUCCION);
  });

  it("la huella cambia con políticas, permisos, valores por omisión y espacios dentro de un texto", async () => {
    const base = await huella();
    const cambia = async (que, cambio, categoria) => {
      const h = await conCambio(cambio);
      expect([que, h[categoria].h]).not.toEqual([que, base[categoria].h]);
    };
    await cambia("política", () => sql.query("alter policy app_state_select on public.app_state using (false)"), "politicas");
    await cambia("rol de una política", () => sql.query("alter policy app_state_select on public.app_state to anon"), "politicas");
    await cambia("permiso de escritura en una tabla", () => sql.query("grant insert on public.config to anon"), "tablas");
    await cambia("permiso en una secuencia", () => sql.query("grant usage on sequence public.tickets_folio_seq to anon"), "secuencias");
    await cambia("ejecutar una función interna", () => sql.query("grant execute on function public._hash_pin(text) to authenticated"), "funciones");
    await cambia("valor por omisión de un argumento", () => redefinir("public.login(text, text, text)",
      "p_dispositivo text DEFAULT NULL::text", "p_dispositivo text DEFAULT 'caja'::text"), "funciones");
    await cambia("espacio dentro de un texto", () => redefinir("public.agregar_carne(text, text)",
      "'Escribe el nombre de la carne.'", "'Escribe el  nombre de la carne.'"), "funciones");
    await cambia("atributo de una función", () => sql.query("alter function public._ip() security definer"), "funciones");
  });

  it("no cambia si solo cambian comentarios o espacios fuera de los textos", async () => {
    const base = await huella();
    const h = await conCambio(() => redefinir("public.agregar_carne(text, text)", "begin\n", "begin\n  -- comentario nuevo\n\n   /* otro */ "));
    expect(h).toEqual(base);
  });
});

d("multinegocio, paso 1: expansión desde el esquema de producción", () => {
  let sql, api, origen;
  const sal = randomBytes(16).toString("hex");
  const uno = async (q, p) => (await sql.query(q, p)).rows[0];
  beforeAll(async () => {
    sql = await crearBase("tq_migracion", [STUB, V3, EXTRA, DATOS]);
    origen = await huellaDe(sql, "origen", sal);
    await sql.query(ESQUEMA);
    api = await conectar("tq_migracion");
  });
  afterAll(cerrarTodo);

  it("conserva cada fila: la huella de destino es igual a la de origen, fila por fila", async () => {
    const r = compararHuellas(origen, await huellaDe(sql, "destino", sal));
    expect(r).toEqual({ iguales: true, resumen: [], entidades: {}, sinSucursal: [] });
  });

  it("crea la cuenta inicial pendiente de activación, sin propietario, y su sucursal", async () => {
    const c = await uno("select count(*)::int n, min(estado) estado, min(nombre) nombre from public.cuentas");
    expect(c).toEqual({ n: 1, estado: "pendiente_activacion", nombre: "La Tequería" });
    expect(await uno("select count(*)::int n, min(zona_horaria) zona from public.sucursales")).toEqual({ n: 1, zona: "America/Mexico_City" });
    expect((await uno("select count(*)::int n from public.membresias")).n).toBe(0);
  });

  it("separa el estado de cobro y pone los folios al día", async () => {
    const { rows } = await sql.query("select id, estado_cobro from public.tickets order by id");
    expect(Object.fromEntries(rows.map((r) => [r.id, r.estado_cobro]))).toEqual({
      "t-cobrado-1": "cobrado", "t-cobrado-2": "cobrado", "t-cobrado-3": "cobrado", "t-no-cobrado": "no_cobrado",
      "t-pendiente": "pendiente", "t-previo-1": "previo", "t-previo-2": "previo", "t-previo-3": "previo",
    });
    expect(await uno("select periodo, ultimo::int from public.folios")).toEqual({ periodo: "continuo", ultimo: 8 });
  });

  it("se puede volver a ejecutar sin duplicar ni cambiar nada", async () => {
    await sql.query(ESQUEMA);
    expect((await uno("select count(*)::int n from public.sucursales")).n).toBe(1);
    expect(compararHuellas(origen, await huellaDe(sql, "destino", sal)).iguales).toBe(true);
  });

  it("la app actual sigue funcionando y sus filas nuevas quedan en la sucursal", async () => {
    const login = await api.rpc("login", { p_id: "b2c3d4e5f6a1", p_pin: "571936" });
    expect(login.ok).toBe(true);
    const t = { id: "t-nuevo-0001", tipo: "llevar", esExtra: false, cuenta: "junta", extras: [],
      ordenes: [{ id: "o1", nombre: "Orden 1", prep: "con-todo", items: [{ key: "taco-pastor", cantidad: 2, nombre: "x", precio: 1 }] }] };
    await api.rpc("enviar_comanda", { p_token: login.token, p_ticket: t });
    await api.rpc("cobrar", { p_token: login.token, p_id: "cobro-nuevo-0001", p_tickets: ["t-nuevo-0001"], p_metodo: "efectivo",
      p_recibido: 100, p_propina: 0, p_liberar_mesa: false });
    const s = (await uno("select id from public.sucursales")).id;
    expect(await uno("select sucursal_id, estado_cobro, folio_periodo, folio::int from public.tickets where id = 't-nuevo-0001'"))
      .toEqual({ sucursal_id: s, estado_cobro: "cobrado", folio_periodo: "continuo", folio: 9 });
    expect((await uno("select sucursal_id from public.cobros where id = 'cobro-nuevo-0001'")).sucursal_id).toBe(s);
    expect((await uno("select count(*)::int n from public.bitacora where sucursal_id is null")).n).toBe(0);
    // la nueva fila no es una diferencia inesperada: es la única que sobra
    const r = compararHuellas(origen, await huellaDe(sql, "destino", sal));
    expect(r.entidades.tickets).toEqual({ faltan: [], sobran: ["t-nuevo-0001"], distintas: [] });
    await sql.query("delete from public.cobros where id = 'cobro-nuevo-0001'; delete from public.tickets where id = 't-nuevo-0001'");
  });

  it("las tablas y funciones nuevas no son accesibles desde la app", async () => {
    for (const t of ["cuentas", "sucursales", "membresias", "invitaciones", "dispositivos", "codigos_vinculacion",
                     "folios", "intentos_operador", "intentos_dispositivo"]) {
      expect((await falla(api.query(`select * from public.${t}`))).message).toMatch(/permission denied/);
    }
    expect((await falla(api.query("select public._sucursal_unica()"))).message).toMatch(/permission denied/);
  });

  it("con dos sucursales, toda la API antigua se niega a leer o escribir, también con una sesión previa", async () => {
    const admin = await api.rpc("login", { p_id: "a1b2c3d4e5f6", p_pin: "804219" });
    const antes = await huellaDe(sql, "destino", sal);
    // la sucursal B tiene datos propios: una bebida que nadie de A debe ver
    await sql.query(`with c as (insert into public.cuentas (nombre) values ('Otra (prueba)') returning id),
      s as (insert into public.sucursales (cuenta_id, nombre) select id, 'Otra (prueba)' from c returning id)
      insert into public.bebidas (id, nombre, cantidad, precio, sucursal_id) select 'solo-b', 'Solo B', 5, 10, id from s`);
    try {
      // todas las firmas que puede ejecutar la app, con el token previo y el resto de argumentos nulos
      const { rows } = await sql.query(`select p.proname, coalesce(p.proargnames, '{}') nombres, p.pronargs, p.pronargdefaults
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
       order by 1`);
      expect(rows.length).toBeGreaterThan(30);
      const resultados = {};
      for (const f of rows) {
        const nombres = f.nombres.slice(0, f.pronargs - f.pronargdefaults);
        const args = nombres.map((n, i) => n + " => $" + (i + 1)).join(", ");
        const valores = nombres.map((n) => (n === "p_token" ? admin.token : null));
        resultados[f.proname] = (await falla(api.query("select public." + f.proname + "(" + args + ")", valores))).message;
      }
      for (const [fn, mensaje] of Object.entries(resultados)) expect([fn, mensaje]).toEqual([fn, expect.stringMatching(/Hay 2 sucursales/)]);
    } finally {
      await sql.query(`delete from public.bebidas where id = 'solo-b'; delete from public.sucursales where nombre = 'Otra (prueba)';
        delete from public.cuentas where nombre = 'Otra (prueba)'`);
    }
    // nada cambió en la sucursal A (fila por fila)
    expect(compararHuellas(antes, await huellaDe(sql, "destino", sal)).iguales).toBe(true);
  });

  it("una cuenta activa siempre tiene propietario, también con dos bajas simultáneas en cualquier aislamiento", async () => {
    const c = (await uno("select id from public.cuentas")).id;
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    await sql.query("insert into auth.users (id, email) values ($1, 'a@ejemplo.invalid'), ($2, 'b@ejemplo.invalid')", [a, b]);
    // activar sin propietario no se confirma
    expect((await falla(sql.query("update public.cuentas set estado = 'activa', activada_en = now() where id = $1", [c]))).message)
      .toMatch(/al menos un propietario/);
    // con el primer propietario en la misma transacción, sí
    await sql.query("begin");
    await sql.query("insert into public.membresias (cuenta_id, auth_user_id, rol) values ($1, $2, 'propietario')", [c, a]);
    await sql.query("update public.cuentas set estado = 'activa', activada_en = now() where id = $1", [c]);
    await sql.query("commit");
    const [x, y] = [await conectar("tq_migracion", false), await conectar("tq_migracion", false)];
    const propietarios = async () => (await uno("select count(*)::int n from public.membresias where rol = 'propietario'")).n;
    for (const nivel of ["read committed", "repeatable read", "serializable"]) {
      // vuelve a tener dos propietarios
      await sql.query(`insert into public.membresias (cuenta_id, auth_user_id, rol) select $1, u, 'propietario' from unnest($2::uuid[]) u
        on conflict do nothing`, [c, [a, b]]);
      expect(await propietarios()).toBe(2);
      // dos bajas a la vez: una se confirma y la otra no
      await x.query(`begin isolation level ${nivel}`); await x.query("delete from public.membresias where auth_user_id = $1", [a]);
      await y.query(`begin isolation level ${nivel}`); await y.query("delete from public.membresias where auth_user_id = $1", [b]);
      const fin = await Promise.allSettled([x.query("commit"), y.query("commit")]);
      expect([nivel, fin.map((f) => f.status).sort()]).toEqual([nivel, ["fulfilled", "rejected"]]);
      expect([nivel, await propietarios()]).toEqual([nivel, 1]);
      // también si una confirma antes de que la otra empiece a confirmar
      await sql.query(`insert into public.membresias (cuenta_id, auth_user_id, rol) select $1, u, 'propietario' from unnest($2::uuid[]) u
        on conflict do nothing`, [c, [a, b]]);
      await x.query(`begin isolation level ${nivel}`); await x.query("delete from public.membresias where auth_user_id = $1", [a]);
      await y.query(`begin isolation level ${nivel}`); await y.query("delete from public.membresias where auth_user_id = $1", [b]);
      await x.query("commit");
      expect([nivel, (await falla(y.query("commit"))).message]).toEqual([nivel, expect.stringMatching(/propietario|concurrent update|serialize/)]);
      expect([nivel, await propietarios()]).toEqual([nivel, 1]);
    }
    // y la última no se puede quitar
    expect((await falla(sql.query("delete from public.membresias where cuenta_id = $1", [c]))).message).toMatch(/al menos un propietario/);
  });
});

d("multinegocio: contracción del estado de cobro", () => {
  let sql, origen;
  const sal = randomBytes(16).toString("hex");
  beforeAll(async () => {
    sql = await crearBase("tq_contraer", [STUB, V3, EXTRA, DATOS]);
    origen = await huellaDe(sql, "origen", sal);
    await sql.query(ESQUEMA);
  });
  afterAll(cerrarTodo);

  it("distingue el uso antiguo de cobro_id del moderno", async () => {
    const heredado = ["where cobro_id is null", "and t.cobro_id is not null", "set cobro_id = 'no_cobrado'",
      "cobro_id in ('previo', 'no_cobrado')", "t.cobro_id not in ('previo','no_cobrado')", "where 'previo' = t.cobro_id",
      "x.cobro_id <> 'previo'", "case t.cobro_id when 'previo' then 1 end", "WHERE COBRO_ID IS NULL"];
    const moderno = ["where estado_cobro = 'previo'", "estado_cobro in ('previo', 'no_cobrado')",
      "set estado_cobro = 'no_cobrado', cobro_id = null", "join public.cobros c on c.id = t.cobro_id",
      "set cobro_id = p_id, estado_cobro = 'cobrado'", "jsonb_build_object('estado', 'previo', 'cobro', t.cobro_id)",
      "-- antes: cobro_id is null\n where estado_cobro = 'pendiente'", "/* cobro_id = 'previo' */ select 1",
      "where p_cobro_id is null", "where estado_cobro <> 'pendiente' and cobro_id = any(p_ids)"];
    const usa = async (t) => (await sql.query("select public._usa_cobro_id_heredado($1) r", [t])).rows[0].r;
    for (const t of heredado) expect([t, await usa(t)]).toEqual([t, true]);
    for (const t of moderno) expect([t, await usa(t)]).toEqual([t, false]);
  });

  it("no se aplica mientras alguna función o índice dependa del cobro_id antiguo, y señala solo esos", async () => {
    await sql.query(`create function public.zz_por_cobrar_moderna() returns bigint language sql as $f$
      select count(*) from public.tickets where estado_cobro = 'pendiente' or estado_cobro in ('previo', 'no_cobrado') $f$`);
    const e = await falla(sql.query(CONTRAER));
    await sql.query("rollback").catch(() => {});
    expect(e.message).toMatch(/aún dependen del cobro_id antiguo: .*función cobrar.*índice tickets_por_cobrar_idx/);
    expect(e.message).not.toMatch(/zz_por_cobrar_moderna|_usa_cobro_id_heredado/);
  });

  it("se aplica sin excepción cuando solo quedan funciones e índices modernos", async () => {
    const otra = await crearBase("tq_contraer_moderna", [STUB, V3, EXTRA, DATOS, ESQUEMA]);
    await otra.query(`create function public.zz_por_cobrar_moderna() returns bigint language sql as $f$
      select count(*) from public.tickets where estado_cobro = 'pendiente' $f$`);
    // lo que hará el paso 2: retirar las funciones antiguas y rehacer el índice con estado_cobro
    const { rows } = await otra.query(`select p.oid::regprocedure::text f from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname <> '_usa_cobro_id_heredado' and public._usa_cobro_id_heredado(p.prosrc)`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) await otra.query("drop function " + r.f + " cascade");
    await otra.query(`drop index public.tickets_por_cobrar_idx;
      create index tickets_por_cobrar_idx on public.tickets (created_at desc) where estado_cobro = 'pendiente' and reenvio is not true`);
    await otra.query(CONTRAER);
    expect((await otra.query("select count(*)::int n from public.tickets where estado_cobro = 'previo' and cobro_id is null")).rows[0].n).toBe(3);
    expect((await otra.query("select public.zz_por_cobrar_moderna()::int n")).rows[0].n).toBe(1);
  });

  it("una transformación en el orden equivocado se detecta fila por fila", async () => {
    await sql.query("begin");
    try {
      // vaciar cobro_id antes de fijar estado_cobro convierte «previo» y «no_cobrado» en «pendiente»
      await sql.query("update public.tickets set cobro_id = null where cobro_id in ('previo', 'no_cobrado')");
      const r = compararHuellas(origen, await huellaDe(sql, "destino", sal));
      expect(r.entidades.tickets.distintas).toEqual(["t-no-cobrado", "t-previo-1", "t-previo-2", "t-previo-3"]);
      expect(r.resumen.map((x) => x.ruta)).toContain("ventas.por_estado_cobro.previo");
    } finally {
      await sql.query("rollback");
    }
  });

  it("en el orden correcto conserva el estado de cada comanda y deja cobro_id solo con cobros reales", async () => {
    await sql.query("set multinegocio.ensayo_solo_datos = 'si'");
    await sql.query(CONTRAER);
    const { rows } = await sql.query("select id, estado_cobro, cobro_id from public.tickets where cobro_id is null or estado_cobro <> 'cobrado' order by id");
    expect(rows).toEqual([
      { id: "t-no-cobrado", estado_cobro: "no_cobrado", cobro_id: null },
      { id: "t-pendiente", estado_cobro: "pendiente", cobro_id: null },
      { id: "t-previo-1", estado_cobro: "previo", cobro_id: null },
      { id: "t-previo-2", estado_cobro: "previo", cobro_id: null },
      { id: "t-previo-3", estado_cobro: "previo", cobro_id: null },
    ]);
    expect(compararHuellas(origen, await huellaDe(sql, "destino", sal))).toEqual({ iguales: true, resumen: [], entidades: {}, sinSucursal: [] });
  });

  it("después, las reglas impiden estados incoherentes y cobros inexistentes", async () => {
    expect((await falla(sql.query("update public.tickets set estado_cobro = 'cobrado' where id = 't-pendiente'"))).message).toMatch(/tickets_estado_cobro_ck/);
    expect((await falla(sql.query("update public.tickets set estado_cobro = 'cobrado', cobro_id = 'no-existe' where id = 't-pendiente'"))).message).toMatch(/tickets_cobro_fk/);
    await sql.query(CONTRAER); // repetirla no cambia nada
    expect((await sql.query("select count(*)::int n from public.tickets where estado_cobro = 'previo'")).rows[0].n).toBe(3);
  });
});
