// Configuración del piloto (PLAN-MULTINEGOCIO.md §2, «Para el piloto»): nombre del negocio, zona horaria y
// número de mesas de cada sucursal. El aislamiento entre sucursales está en la matriz (aislamiento.test.js);
// aquí van las reglas, la concurrencia con los borradores y el efecto de la zona horaria.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { URL_ADMIN, ESQUEMA, STUB, crearBase, conectar, cerrarTodo, falla, relojControlado, pidDe, esperaCandado } from "./util.js";

const d = URL_ADMIN ? describe : describe.skip;
const BASE = "tq_configuracion";
const PIN = "864213";

d("configuración del piloto: negocio y mesas", () => {
  let sql, caja, tablet, tAdmin, tMesero, reloj;
  const comanda = (id, mesaId) => ({ id, tipo: mesaId ? "aqui" : "llevar", mesaId, esExtra: false, cuenta: "junta", extras: [],
    ordenes: [{ id: "o1", nombre: "Orden 1", prep: "con-todo", items: [{ key: "taco-pastor", cantidad: 1, nombre: "x", precio: 1 }] }] });
  const borrador = { ordenes: [{ id: "o1", items: [{ key: "taco-pastor", cantidad: 1 }] }], extras: [] };
  const mesasActivas = async (c = caja, t = tAdmin) => (await c.rpc("estado", { p_token: t, p_partes: ["mesas"] })).mesas.map((m) => m.id);

  beforeAll(async () => {
    sql = await crearBase(BASE, [STUB, ESQUEMA]);
    reloj = await relojControlado(sql, new Date("2026-11-04T18:00:00Z"));
    const admin = (await sql.query(`select public.crear_admin_inicial('Ana', '${PIN}') id`)).rows[0].id;
    caja = await conectar(BASE, true, "203.0.113.60", "caja");
    tablet = await conectar(BASE, true, "203.0.113.61", "tablet");
    tAdmin = (await caja.rpc("login", { p_id: admin, p_pin: PIN })).token;
    const mesero = (await caja.rpc("crear_usuario", { p_token: tAdmin, p_admin_pin: PIN, p_nombre: "Luis", p_pin: "517384", p_rol: "mesero" })).usuario.id;
    tMesero = (await tablet.rpc("login", { p_id: mesero, p_pin: "517384" })).token;
  });
  afterAll(cerrarTodo);

  it("sube y baja el número de mesas; las que se quitan no se borran y no se pueden usar", async () => {
    const fijar = (n) => caja.rpc("fijar_mesas", { p_token: tAdmin, p_cantidad: n });
    expect(await mesasActivas()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await fijar(10)).toEqual({ ok: true, mesas: 10 });
    expect(await mesasActivas()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // la 10 con comanda y la 9 con borrador no se pueden quitar
    await tablet.rpc("enviar_comanda", { p_token: tMesero, p_ticket: comanda("cfg-mesa10", 10) });
    await tablet.rpc("guardar_borrador_mesa", { p_token: tMesero, p_mesa_id: 9, p_pedido: borrador });
    expect(await fijar(8)).toEqual({ ok: false, error: "ocupadas", mesas: [9, 10] });
    // se cobra y se liberan: ya se pueden quitar
    await tablet.rpc("cobrar", { p_token: tMesero, p_id: "cfg-cobro-1", p_tickets: ["cfg-mesa10"], p_metodo: "efectivo",
      p_recibido: 100, p_propina: 0, p_liberar_mesa: true });
    await tablet.rpc("guardar_borrador_mesa", { p_token: tMesero, p_mesa_id: 9, p_pedido: { ordenes: [], extras: [] } });
    expect(await fijar(8)).toEqual({ ok: true, mesas: 8 });
    expect(await mesasActivas(tablet, tMesero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // una mesa quitada es, para la operación, una que no existe
    for (const [fn, args] of [["guardar_borrador_mesa", { p_mesa_id: 10, p_pedido: borrador }], ["liberar_mesa", { p_mesa_id: 10 }],
                              ["enviar_comanda", { p_ticket: comanda("cfg-mesa10-b", 10) }]]) {
      expect([fn, (await falla(tablet.rpc(fn, { p_token: tMesero, ...args }))).message]).toEqual([fn, "MESA"]);
    }
    // su comanda anterior la sigue señalando, y al volver a subir el número la mesa regresa libre
    expect((await sql.query("select mesa_id from public.tickets where id = 'cfg-mesa10'")).rows[0].mesa_id).toBe(10);
    expect(await fijar(10)).toEqual({ ok: true, mesas: 10 });
    expect((await caja.rpc("estado", { p_token: tAdmin, p_partes: ["mesas"] })).mesas.find((m) => m.id === 10).estado).toBe("libre");
    expect(await fijar(8)).toEqual({ ok: true, mesas: 8 });
    expect((await sql.query("select detalle from public.bitacora where accion = 'mesas' order by id")).rows.map((r) => r.detalle))
      .toEqual([{ antes: 8, ahora: 10 }, { antes: 10, ahora: 8 }, { antes: 8, ahora: 10 }, { antes: 10, ahora: 8 }]);
  });

  it("solo el administrador, y de 1 a 60 mesas", async () => {
    for (const n of [0, 61, null]) expect(await caja.rpc("fijar_mesas", { p_token: tAdmin, p_cantidad: n })).toEqual({ ok: false, error: "cantidad" });
    expect((await falla(tablet.rpc("fijar_mesas", { p_token: tMesero, p_cantidad: 9 }))).message).toBe("PERMISO");
    expect((await falla(tablet.rpc("fijar_negocio", { p_token: tMesero, p_nombre: "x", p_zona_horaria: "America/Mexico_City" }))).message).toBe("PERMISO");
  });

  it("quitar mesas espera a un borrador en curso, y un borrador espera a que se quiten", async () => {
    // el borrador llega primero: quitar la mesa espera y la ve ocupada
    const pidCaja = await pidDe(caja);
    await caja.rpc("fijar_mesas", { p_token: tAdmin, p_cantidad: 9 });
    await tablet.query("begin");
    await tablet.rpc("guardar_borrador_mesa", { p_token: tMesero, p_mesa_id: 9, p_pedido: borrador });
    const quitar = caja.rpc("fijar_mesas", { p_token: tAdmin, p_cantidad: 8 });
    expect(await esperaCandado(sql, pidCaja)).toBe(true);
    await tablet.query("commit");
    expect(await quitar).toEqual({ ok: false, error: "ocupadas", mesas: [9] });
    await tablet.rpc("guardar_borrador_mesa", { p_token: tMesero, p_mesa_id: 9, p_pedido: { ordenes: [], extras: [] } });
    // quitar llega primero: el borrador espera y la mesa ya no existe
    const pidTablet = await pidDe(tablet);
    await caja.query("begin");
    expect(await caja.rpc("fijar_mesas", { p_token: tAdmin, p_cantidad: 8 })).toEqual({ ok: true, mesas: 8 });
    const tarde = tablet.rpc("guardar_borrador_mesa", { p_token: tMesero, p_mesa_id: 9, p_pedido: borrador }).then(() => null, (e) => e.message);
    expect(await esperaCandado(sql, pidTablet)).toBe(true);
    await caja.query("commit");
    expect(await tarde).toBe("MESA");
  });

  it("nombre del negocio y zona horaria: se validan, se ven en la entrada y la hora de las comandas sigue la zona", async () => {
    const fijar = (nombre, zona) => caja.rpc("fijar_negocio", { p_token: tAdmin, p_nombre: nombre, p_zona_horaria: zona });
    expect(await fijar("  ", "America/Mexico_City")).toEqual({ ok: false, error: "nombre" });
    expect(await fijar("Taquería Norte", "Marte/Olimpo")).toEqual({ ok: false, error: "zona" });
    // 18:00 UTC: 12:00 en la Ciudad de México, 10:00 en Tijuana (horario de invierno)
    await tablet.rpc("enviar_comanda", { p_token: tMesero, p_ticket: comanda("cfg-hora-cdmx") });
    expect(await fijar("Taquería Norte", "America/Tijuana")).toEqual({ ok: true, nombreNegocio: "Taquería Norte", zonaHoraria: "America/Tijuana" });
    await tablet.rpc("enviar_comanda", { p_token: tMesero, p_ticket: comanda("cfg-hora-tijuana") });
    expect((await sql.query("select id, hora from public.tickets where id like 'cfg-hora-%' order by id")).rows)
      .toEqual([{ id: "cfg-hora-cdmx", hora: "12:00" }, { id: "cfg-hora-tijuana", hora: "10:00" }]);
    expect((await caja.rpc("usuarios_login")).negocio).toBe("Taquería Norte");
    expect(await caja.rpc("estado", { p_token: tAdmin, p_partes: ["config"] })).toMatchObject({ nombreNegocio: "Taquería Norte", zonaHoraria: "America/Tijuana" });
    expect((await sql.query("select zona_horaria from public.sucursales")).rows).toEqual([{ zona_horaria: "America/Tijuana" }]);
    expect(reloj.ahora.toISOString()).toBe("2026-11-04T18:00:00.000Z");
  });
});
