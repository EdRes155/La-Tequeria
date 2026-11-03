// Migración multinegocio, paso 1 (expansión) y contracción del estado de cobro, ensayadas sobre una
// copia del esquema de producción con datos sintéticos (nunca contra producción).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { URL_ADMIN, STUB, ESQUEMA, leer, crearBase, conectar, cerrarTodo, falla, huellaDe } from "./util.js";
import { compararHuellas } from "../../scripts/huella.mjs";

const V3 = leer("tests/sql/esquema-v3.sql");
const EXTRA = leer("tests/sql/produccion-extra.sql");
const DATOS = leer("tests/sql/datos-v3.sql");
const CONTRAER = leer("supabase/multinegocio-contraer-estado-cobro.sql");
const HUELLA_ESQUEMA = leer("scripts/huella-esquema.sql");
// scripts/huella-esquema.sql sobre producción el 3 de noviembre de 2026 (solo catálogo, sin datos)
const PRODUCCION = {
  tablas: 15, h_tablas: "96e872e67bff61523928d810bfd4749e",
  columnas: 122, h_columnas: "21b125552eac88cb48eb2d9853d91da1",
  funciones: 64, h_funciones: "c6faf1c6cd313371d2125291142ef62e",
  restricciones: 27, h_restricciones: "29883e77354d9dd8a2bde15d01a77a59",
  indices: 26, h_indices: "71a3bb9dbdd53ac645368f43feba8bf3",
  disparadores: 10, h_disparadores: "1ec37679e6b5ba5043d1af336790efda",
};
const d = URL_ADMIN ? describe : describe.skip;

d("instantánea de producción", () => {
  afterAll(cerrarTodo);
  it("esquema-v3.sql + produccion-extra.sql tienen la misma huella de esquema que producción", async () => {
    const sql = await crearBase("tq_instantanea", [STUB, V3, EXTRA]);
    expect((await sql.query(HUELLA_ESQUEMA)).rows[0].huella).toEqual(PRODUCCION);
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

  it("con dos sucursales, una función que aún no recibe la sucursal falla en vez de adivinarla", async () => {
    const login = await api.rpc("login", { p_id: "a1b2c3d4e5f6", p_pin: "804219" });
    await sql.query(`with c as (insert into public.cuentas (nombre) values ('Otra (prueba)') returning id)
      insert into public.sucursales (cuenta_id, nombre) select id, 'Otra (prueba)' from c`);
    try {
      expect((await falla(api.rpc("login", { p_id: "a1b2c3d4e5f6", p_pin: "804219" }))).message).toMatch(/Hay 2 sucursales/);
      const e = await falla(api.rpc("agregar_gasto", { p_token: login.token, p_id: "gasto-sin-sucursal", p_concepto: "X", p_monto: 1 }));
      expect(e.message).toMatch(/Hay 2 sucursales/);
      expect((await uno("select count(*)::int n from public.gastos where id = 'gasto-sin-sucursal'")).n).toBe(0);
    } finally {
      await sql.query("delete from public.sucursales where nombre = 'Otra (prueba)'; delete from public.cuentas where nombre = 'Otra (prueba)'");
    }
  });

  it("una cuenta activa siempre tiene propietario, también con dos bajas simultáneas", async () => {
    const c = (await uno("select id from public.cuentas")).id;
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    await sql.query("insert into auth.users (id, email) values ($1, 'a@ejemplo.invalid'), ($2, 'b@ejemplo.invalid')", [a, b]);
    // activar sin propietario no se confirma
    expect((await falla(sql.query("update public.cuentas set estado = 'activa', activada_en = now() where id = $1", [c]))).message)
      .toMatch(/al menos un propietario/);
    // con el primer propietario en la misma transacción, sí
    await sql.query("begin");
    await sql.query("insert into public.membresias (cuenta_id, auth_user_id, rol) values ($1, $2, 'propietario'), ($1, $3, 'propietario')", [c, a, b]);
    await sql.query("update public.cuentas set estado = 'activa', activada_en = now() where id = $1", [c]);
    await sql.query("commit");
    // dos bajas a la vez: una se confirma y la otra no
    const [x, y] = [await conectar("tq_migracion", false), await conectar("tq_migracion", false)];
    await x.query("begin"); await x.query("delete from public.membresias where auth_user_id = $1", [a]);
    await y.query("begin"); await y.query("delete from public.membresias where auth_user_id = $1", [b]);
    const fin = await Promise.allSettled([x.query("commit"), y.query("commit")]);
    expect(fin.map((f) => f.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await uno("select count(*)::int n from public.membresias where rol = 'propietario'")).n).toBe(1);
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

  it("no se aplica mientras las funciones dependan de cobro_id", async () => {
    const e = await falla(sql.query(CONTRAER));
    await sql.query("rollback").catch(() => {});
    expect(e.message).toMatch(/aún dependen de cobro_id: .*cobrar/);
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
