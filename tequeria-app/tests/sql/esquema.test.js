// Pruebas del esquema v3 contra un PostgreSQL real (no se conecta a producción).
// Requiere TEST_DATABASE_URL apuntando a una base administrativa, p. ej.
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:sql
// Cada bloque crea bases desechables, imita los roles de Supabase y llama a la API como "anon".
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const URL_ADMIN = process.env.TEST_DATABASE_URL;
const d = URL_ADMIN ? describe : describe.skip;
const raiz = path.resolve(import.meta.dirname, "../..");
const leer = (f) => fs.readFileSync(path.join(raiz, f), "utf8");
const ESQUEMA = leer("supabase-schema.sql");
const STUB = leer("tests/sql/supabase-stub.sql");
const V2 = leer("tests/sql/esquema-v2.sql");
const DATOS_V2 = leer("tests/sql/datos-v2.sql");

const bases = [];
const clientes = [];

function urlDe(nombre) {
  const u = new URL(URL_ADMIN);
  u.pathname = "/" + nombre;
  return u.toString();
}

async function crearBase(nombre, scripts) {
  const admin = new pg.Client({ connectionString: URL_ADMIN });
  await admin.connect();
  await admin.query(`drop database if exists ${nombre}`);
  await admin.query(`create database ${nombre}`);
  await admin.end();
  bases.push(nombre);
  const c = await conectar(nombre, false);
  for (const s of scripts) await c.query(s);
  return nombre;
}

// Cliente de la API: entra como el rol "anon", igual que el navegador vía PostgREST.
async function conectar(nombre, comoAnon = true, ip = "203.0.113.10") {
  const c = new pg.Client({ connectionString: urlDe(nombre) });
  await c.connect();
  clientes.push(c);
  if (comoAnon) {
    await c.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ "x-forwarded-for": ip })]);
    await c.query("set role anon");
  }
  c.rpc = async (fn, args = {}) => {
    const ks = Object.keys(args);
    const sql = `select public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
    const { rows } = await c.query(sql, ks.map((k) => args[k]));
    return rows[0].r;
  };
  return c;
}

async function falla(promesa) {
  try { await promesa; } catch (e) { return e; }
  throw new Error("se esperaba un error");
}

async function entrar(c, id, pin, dispositivo) {
  const r = await c.rpc("login", { p_id: id, p_pin: pin, p_dispositivo: dispositivo || null });
  if (!r.ok) throw new Error("login falló: " + JSON.stringify(r));
  return r.token;
}

const item = (key, cantidad = 1, extra = {}) => ({ key, cantidad, nombre: key, precio: 1, ...extra });
const ticket = (id, extra = {}) => ({
  id, tipo: "llevar", esExtra: false, cuenta: "junta",
  ordenes: [{ id: "o1", nombre: "Orden 1", prep: "con-todo", items: [item("taco-pastor", 2)] }],
  extras: [], ...extra,
});

afterAll(async () => {
  for (const c of clientes) await c.end().catch(() => {});
  if (!URL_ADMIN) return;
  const admin = new pg.Client({ connectionString: URL_ADMIN });
  await admin.connect();
  for (const b of bases) await admin.query(`drop database if exists ${b} with (force)`).catch(() => {});
  await admin.end();
});

d("instalación nueva", () => {
  let base, api;
  beforeAll(async () => {
    base = await crearBase("tq_nueva", [STUB, ESQUEMA]);
    api = await conectar(base);
  });

  it("siembra catálogo y mesas pero ningún usuario", async () => {
    const r = await api.rpc("usuarios_login");
    expect(r.hayAdmin).toBe(false);
    expect(r.usuarios).toEqual([]);
    const sql = await conectar(base, false);
    const { rows } = await sql.query("select (select count(*) from mesas)::int m, (select count(*) from carnes)::int c, (select precios->>'taco-pastor' from config) p");
    expect(rows[0]).toEqual({ m: 8, c: 4, p: "20" });
  });

  it("el primer administrador solo se crea desde el SQL Editor y una sola vez", async () => {
    const e = await falla(api.rpc("crear_admin_inicial", { p_nombre: "X", p_pin: "8642" }));
    expect(e.message).toMatch(/permission denied/);
    const sql = await conectar(base, false);
    expect((await falla(sql.query("select public.crear_admin_inicial('Ana', '1234')"))).message).toMatch(/trivial/);
    await sql.query("select public.crear_admin_inicial('Ana', '8642')");
    expect((await falla(sql.query("select public.crear_admin_inicial('Otra', '9753')"))).message).toMatch(/Ya existe/);
    const r = await api.rpc("usuarios_login");
    expect(r.hayAdmin).toBe(true);
    expect(r.usuarios.map((u) => u.nombre)).toEqual(["Ana"]);
    expect(r.usuarios[0].rol).toBeUndefined();
  });
});

d("actualización desde v2", () => {
  let base, api, sql;
  beforeAll(async () => {
    base = await crearBase("tq_v2", [STUB, V2, DATOS_V2, ESQUEMA, ESQUEMA]);
    api = await conectar(base);
    sql = await conectar(base, false);
  });

  it("anon ya no puede leer ni escribir tablas ni usar la API vieja", async () => {
    for (const t of ["config", "carnes", "bebidas", "mesas", "tickets", "cortes", "gastos", "usuarios", "cocina_sesion", "sesiones", "bitacora"]) {
      expect((await falla(api.query(`select * from public.${t} limit 1`))).message).toMatch(/permission denied/);
    }
    expect((await falla(api.query("update public.bebidas set cantidad = 0"))).message).toMatch(/permission denied/);
    expect((await falla(api.query("delete from public.tickets"))).message).toMatch(/permission denied/);
    expect((await falla(api.rpc("es_admin_pin", { p_pin: "1234" }))).message).toMatch(/does not exist/);
    expect((await falla(api.rpc("_sesion", { p_token: "x" }))).message).toMatch(/permission denied/);
    expect((await falla(api.rpc("estado", { p_token: "0".repeat(64) }))).message).toBe("SESION");
  });

  it("conserva datos y migra el PIN SHA-256 a bcrypt al entrar", async () => {
    const r = await api.rpc("login", { p_id: "u3", p_pin: "8642", p_dispositivo: "tablet-a" });
    expect(r.ok).toBe(true);
    expect(r.usuario).toEqual({ id: "u3", nombre: "Cocina", rol: "cocinero" });
    const { rows } = await sql.query("select left(pin_hash, 4) h from usuarios where id = 'u3'");
    expect(rows[0].h).toBe("$2a$");
    // mismo dispositivo: puede volver a entrar aunque su cocina siga activa
    expect((await api.rpc("login", { p_id: "u3", p_pin: "8642", p_dispositivo: "tablet-a" })).ok).toBe(true);
    await api.rpc("logout", { p_token: r.token });
  });

  it("obliga a cambiar el PIN de demostración antes de operar", async () => {
    const r = await api.rpc("login", { p_id: "u1", p_pin: "1234" });
    expect(r.ok).toBe(true);
    expect(r.debeCambiarPin).toBe(true);
    const e = await falla(api.rpc("fijar_precio", { p_token: r.token, p_clave: "taco-pastor", p_precio: 21 }));
    expect(e.message).toBe("CAMBIAR_PIN");
    expect((await api.rpc("cambiar_pin", { p_token: r.token, p_pin_actual: "1234", p_pin_nuevo: "4444" })).error).toBe("debil");
    expect((await api.rpc("cambiar_pin", { p_token: r.token, p_pin_actual: "1234", p_pin_nuevo: "7391" })).ok).toBe(true);
    await api.rpc("fijar_precio", { p_token: r.token, p_clave: "taco-pastor", p_precio: 21.5 });
    const est = await api.rpc("estado", { p_token: r.token });
    expect(est.precios["taco-pastor"]).toBe(21.5);
    expect(est.historial.map((t) => t.id).sort()).toEqual(["t-viejo-1", "t-viejo-2"]);
    // lo vendido antes de registrar cobros no aparece como deuda
    expect(est.historial.every((t) => t.cobro?.previo)).toBe(true);
    expect(est.porCobrar).toEqual([]);
    expect(est.historial.every((t) => Number.isInteger(t.folio))).toBe(true);
    // lo que v2 ya había cortado no reaparece en cocina; lo abierto sí sigue ahí
    expect(est.cocina.map((t) => t.id).sort()).toEqual(["t-viejo-1", "t-viejo-2"]);
    expect((await falla(api.query("select * from public.app_state"))).message).toMatch(/permission denied/);
    expect(est.gastos).toHaveLength(1);
    expect(est.mesas.find((m) => m.id === 2).estado).toBe("ocupada");
  });

  it("bloquea tras 5 PIN incorrectos aunque luego se use el correcto", async () => {
    const otra = await conectar(base, true, "198.51.100.7");
    for (let i = 0; i < 5; i++) expect((await otra.rpc("login", { p_id: "u2", p_pin: "0000" })).error).toBe("pin");
    const r = await otra.rpc("login", { p_id: "u2", p_pin: "1111" });
    expect(r.error).toBe("bloqueado");
    expect(r.espera).toBeGreaterThan(200);
    await sql.query("update intentos set bloqueado_hasta = now() - interval '1 second' where clave = 'u:u2'");
    expect((await otra.rpc("login", { p_id: "u2", p_pin: "1111" })).ok).toBe(true);
  });

  it("limita los fallos por IP aunque se cambie de usuario", async () => {
    const ip = await conectar(base, true, "192.0.2.99");
    for (let i = 0; i < 30; i++) await ip.rpc("login", { p_id: "nadie-" + i, p_pin: "0000" });
    expect((await ip.rpc("login", { p_id: "u3", p_pin: "8642" })).error).toBe("bloqueado");
  });
});

d("operación", () => {
  let base, api, sql, admin, mesero, cocina;
  beforeAll(async () => {
    base = await crearBase("tq_op", [STUB, ESQUEMA]);
    sql = await conectar(base, false);
    await sql.query("select public.crear_admin_inicial('Admin', '8642')");
    api = await conectar(base);
    const { rows } = await sql.query("select id from usuarios");
    admin = await entrar(api, rows[0].id, "8642");
    const m = await api.rpc("crear_usuario", { p_token: admin, p_admin_pin: "8642", p_nombre: "Mesero", p_pin: "5173", p_rol: "mesero" });
    const k = await api.rpc("crear_usuario", { p_token: admin, p_admin_pin: "8642", p_nombre: "Cocina", p_pin: "6284", p_rol: "cocinero" });
    mesero = await entrar(api, m.usuario.id, "5173");
    cocina = await entrar(api, k.usuario.id, "6284", "tablet-1");
    await sql.query("update bebidas set cantidad = 3 where id = 'coca'");
  });

  it("cada rol solo ve y hace lo suyo", async () => {
    const em = await api.rpc("estado", { p_token: mesero });
    expect(em.historial).toBeUndefined();
    expect(em.gastos).toBeUndefined();
    expect(em.cortes).toBeUndefined();
    const ek = await api.rpc("estado", { p_token: cocina });
    expect(ek.historial).toEqual([]);
    expect(ek.gastos).toBeUndefined();
    expect((await falla(api.rpc("fijar_precio", { p_token: mesero, p_clave: "taco-pastor", p_precio: 1 }))).message).toBe("PERMISO");
    expect((await falla(api.rpc("enviar_comanda", { p_token: cocina, p_ticket: ticket("cocina-intenta-1") }))).message).toBe("PERMISO");
    expect((await falla(api.rpc("agregar_gasto", { p_token: mesero, p_id: "gasto-mesero-1", p_concepto: "x", p_monto: 5 }))).message).toBe("PERMISO");
  });

  it("calcula el total con precios del servidor y guarda las indicaciones", async () => {
    const r = await api.rpc("enviar_comanda", { p_token: mesero, p_ticket: ticket("envio-precio-1", {
      referencia: "Luis", cuenta: "separada",
      ordenes: [{ id: "o1", nombre: "Ana", prep: "natural", items: [item("taco-pastor", 2, { precio: 0.01 }), item("beb-coca", 1)] }],
      extras: [item("bolsa-verdura", 1), item("verdura-aparte", 1)],
    }) });
    expect(r.ok).toBe(true);
    expect(r.ticket.total).toBe(20 * 2 + 25 + 15);
    expect(r.ticket).toMatchObject({ cuenta: "separada", referencia: "Luis", origen: "Para llevar · Luis", mesero: "Mesero" });
    expect(r.ticket.ordenes[0]).toMatchObject({ nombre: "Ana", prep: "natural" });
    expect(r.ticket.ordenes[0].items[0]).toMatchObject({ nombre: "Taco Pastor", cat: "taco", precio: 20 });
    const { rows } = await sql.query("select cantidad from bebidas where id = 'coca'");
    expect(rows[0].cantidad).toBe(2);
  });

  it("reintentar el mismo envío no duplica ticket ni consumo", async () => {
    const t = ticket("envio-repetido-1", { ordenes: [{ id: "o1", nombre: "Orden 1", items: [item("beb-coca", 1)] }] });
    const a = await api.rpc("enviar_comanda", { p_token: mesero, p_ticket: t });
    const b = await api.rpc("enviar_comanda", { p_token: mesero, p_ticket: t });
    expect(b.duplicado).toBe(true);
    expect(b.ticket.id).toBe(a.ticket.id);
    const { rows } = await sql.query("select (select count(*) from tickets where id = 'envio-repetido-1')::int n, (select cantidad from bebidas where id = 'coca') c");
    expect(rows[0]).toEqual({ n: 1, c: 1 });
  });

  it("rechaza sin cambios parciales si no alcanza la existencia o el producto no existe", async () => {
    const e = await falla(api.rpc("enviar_comanda", { p_token: mesero, p_ticket: ticket("sin-coca-1", {
      tipo: "aqui", mesaId: 5, ordenes: [{ id: "o1", items: [item("taco-pastor", 1), item("beb-coca", 5)] }] }) }));
    expect(e.message).toBe("SIN_EXISTENCIA");
    expect(e.hint).toMatch(/Coca-Cola \(quedan 1\)/);
    const p = await falla(api.rpc("enviar_comanda", { p_token: mesero, p_ticket: ticket("producto-falso-1", {
      ordenes: [{ id: "o1", items: [item("taco-inexistente", 1)] }] }) }));
    expect(p.message).toBe("PRODUCTO");
    const { rows } = await sql.query("select (select estado from mesas where id = 5) e, (select count(*) from tickets where id in ('sin-coca-1','producto-falso-1'))::int n, (select cantidad from bebidas where id = 'coca') c");
    expect(rows[0]).toEqual({ e: "libre", n: 0, c: 1 });
  });

  it("dos dispositivos que venden la misma bebida a la vez descuentan ambas ventas", async () => {
    await sql.query("update bebidas set cantidad = 10 where id = 'jamaica'");
    const a = await conectar(base), b = await conectar(base);
    const t = (id) => ticket(id, { ordenes: [{ id: "o1", items: [item("beb-jamaica", 1)] }] });
    await Promise.all([
      a.rpc("enviar_comanda", { p_token: mesero, p_ticket: t("concurrente-a1") }),
      b.rpc("enviar_comanda", { p_token: mesero, p_ticket: t("concurrente-b1") }),
    ]);
    const { rows } = await sql.query("select cantidad from bebidas where id = 'jamaica'");
    expect(rows[0].cantidad).toBe(8);
  });

  it("una mesa no acepta dos comandas originales; la extra se agrega en el servidor", async () => {
    const original = ticket("mesa3-orig-1", { tipo: "aqui", mesaId: 3 });
    await api.rpc("enviar_comanda", { p_token: mesero, p_ticket: original });
    const e = await falla(api.rpc("enviar_comanda", { p_token: mesero, p_ticket: { ...original, id: "mesa3-orig-2" } }));
    expect(e.message).toBe("MESA_OCUPADA");
    await api.rpc("enviar_comanda", { p_token: mesero, p_ticket: { ...original, id: "mesa3-extra-1", esExtra: true } });
    const est = await api.rpc("estado", { p_token: mesero, p_partes: ["mesas"] });
    const m = est.mesas.find((x) => x.id === 3);
    expect(m.estado).toBe("ocupada");
    expect(m.extras.map((x) => x.id)).toEqual(["mesa3-extra-1"]);
    expect(est.cocina).toBeUndefined();
  });

  it("el borrador no es venta y se envía una sola vez", async () => {
    const pedido = { ordenes: [{ id: "o1", nombre: "Orden 1", items: [item("taco-bistec", 1)] }], extras: [] };
    const m = await api.rpc("guardar_borrador_mesa", { p_token: mesero, p_mesa_id: 4, p_pedido: pedido, p_version: 0 });
    expect(m.estado).toBe("borrador");
    const c = await falla(api.rpc("guardar_borrador_mesa", { p_token: mesero, p_mesa_id: 4, p_pedido: pedido, p_version: 0 }));
    expect(c.message).toBe("CONFLICTO");
    const est = await api.rpc("estado", { p_token: cocina });
    expect(est.historial.some((t) => t.mesaId === 4)).toBe(false);
    await api.rpc("enviar_comanda", { p_token: mesero, p_ticket: ticket("mesa4-envio-1", { tipo: "aqui", mesaId: 4, ordenes: pedido.ordenes }) });
    const e = await falla(api.rpc("guardar_borrador_mesa", { p_token: mesero, p_mesa_id: 4, p_pedido: pedido, p_version: 2 }));
    expect(e.message).toBe("MESA_OCUPADA");
  });

  it("el reenvío llega a cocina con total cero y fuera de las ventas", async () => {
    const r = await api.rpc("reenviar_cocina", { p_token: mesero, p_id: "reenvio-mesa3-1", p_mesa_id: 3 });
    expect(r.ticket).toMatchObject({ reenvio: true, total: 0 });
    expect(r.ticket.ordenes).toHaveLength(2);
    const est = await api.rpc("estado", { p_token: cocina });
    expect(est.cocina.some((t) => t.id === "reenvio-mesa3-1")).toBe(true);
    expect(est.historial.some((t) => t.id === "reenvio-mesa3-1")).toBe(false);
  });

  it("el mesero solo ve el domicilio de sus propios pedidos", async () => {
    const dom = { nombre: "Rosa", direccion: "Calle 2", telefono: "555 123 4567", pago: "tarjeta" };
    await api.rpc("enviar_comanda", { p_token: admin, p_ticket: ticket("dom-admin-1", { tipo: "domicilio", domicilio: dom }) });
    const est = await api.rpc("estado", { p_token: mesero, p_partes: ["cocina"] });
    expect(est.cocina.find((t) => t.id === "dom-admin-1").domicilio).toBeNull();
    const ek = await api.rpc("estado", { p_token: cocina, p_partes: ["cocina"] });
    expect(ek.cocina.find((t) => t.id === "dom-admin-1").domicilio.direccion).toBe("Calle 2");
    const e = await falla(api.rpc("enviar_comanda", { p_token: mesero, p_ticket: ticket("dom-sin-tel-1", { tipo: "domicilio", domicilio: { direccion: "x" } }) }));
    expect(e.message).toBe("DOMICILIO");
  });

  it("cobra cuentas con cambio, evita el doble cobro, libera la mesa y permite anular", async () => {
    const t1 = ticket("cobro-mesa6-1", { tipo: "aqui", mesaId: 6, ordenes: [{ id: "o1", items: [item("taco-pastor", 3)] }] });
    const t2 = ticket("cobro-mesa6-2", { tipo: "aqui", mesaId: 6, esExtra: true, ordenes: [{ id: "o1", items: [item("taco-bistec", 1)] }] });
    await api.rpc("enviar_comanda", { p_token: mesero, p_ticket: t1 });
    await api.rpc("enviar_comanda", { p_token: mesero, p_ticket: t2 });
    const pc = await api.rpc("estado", { p_token: mesero, p_partes: ["porCobrar"] });
    const ids = pc.porCobrar.filter((t) => t.mesaId === 6).map((t) => t.id).sort();
    expect(ids).toEqual(["cobro-mesa6-1", "cobro-mesa6-2"]);
    const cobro = { p_token: mesero, p_id: "cobro-mesa6-a", p_tickets: ids, p_metodo: "efectivo" };
    expect((await falla(api.rpc("cobrar", { ...cobro, p_recibido: 50 }))).message).toBe("PAGO");
    expect((await falla(api.rpc("cobrar", { ...cobro, p_token: cocina }))).message).toBe("PERMISO");
    const r = await api.rpc("cobrar", { ...cobro, p_recibido: 100, p_propina: 10, p_liberar_mesa: true });
    expect(r.cobro).toMatchObject({ total: 80, propina: 10, recibido: 100, cambio: 10, origen: "Mesa 6" });
    expect(r.mesaLiberada).toBe(true);
    expect((await api.rpc("cobrar", { ...cobro, p_recibido: 100, p_propina: 10 })).duplicado).toBe(true);
    const doble = await falla(api.rpc("cobrar", { ...cobro, p_id: "cobro-mesa6-b", p_tickets: [ids[0]], p_metodo: "tarjeta" }));
    expect(doble.message).toBe("YA_COBRADO");

    let est = await api.rpc("estado", { p_token: admin, p_partes: ["historial", "porCobrar", "mesas"] });
    expect(est.mesas.find((m) => m.id === 6).estado).toBe("libre");
    expect(est.porCobrar.some((t) => t.mesaId === 6)).toBe(false);
    expect(est.historial.find((t) => t.id === "cobro-mesa6-1").cobro).toMatchObject({ metodo: "efectivo", total: 80 });
    expect(est.periodo.cobrado).toMatchObject({ ventas: 80, propinas: 10, efectivo: 90, tarjeta: 0 });

    expect((await falla(api.rpc("anular_cobro", { p_token: mesero, p_id: "cobro-mesa6-a", p_motivo: "x" }))).message).toBe("PERMISO");
    await api.rpc("anular_cobro", { p_token: admin, p_id: "cobro-mesa6-a", p_motivo: "Se cobró con tarjeta" });
    est = await api.rpc("estado", { p_token: admin, p_partes: ["historial", "porCobrar"] });
    expect(est.porCobrar.filter((t) => t.mesaId === 6)).toHaveLength(2);
    expect(est.periodo.cobrado.ventas).toBe(0);
    const t = await api.rpc("cobrar", { ...cobro, p_id: "cobro-mesa6-c", p_metodo: "tarjeta", p_recibido: 999 });
    expect(t.cobro).toMatchObject({ metodo: "tarjeta", recibido: 80, cambio: 0 });
    const { rows } = await sql.query("select count(*)::int n from bitacora where accion in ('cobro', 'anular_cobro')");
    expect(rows[0].n).toBe(3);
  });

  it("el corte exige PIN admin, no oculta pendientes de cocina y no pierde tickets concurrentes", async () => {
    expect((await api.rpc("hacer_corte", { p_token: cocina, p_admin_pin: "0000" })).error).toBe("pin");
    await api.rpc("agregar_gasto", { p_token: admin, p_id: "gasto-corte-1", p_concepto: "Hielo", p_monto: 30.5 });
    const antes = await api.rpc("estado", { p_token: cocina });
    const pendientes = antes.cocina.filter((t) => t.estado !== "listo").map((t) => t.id).sort();

    // A hace el corte dentro de una transacción; B envía una comanda mientras tanto
    const a = await conectar(base), b = await conectar(base);
    await a.query("begin");
    const corte = await a.rpc("hacer_corte", { p_token: cocina, p_admin_pin: "8642" });
    await b.rpc("enviar_comanda", { p_token: mesero, p_ticket: ticket("durante-corte-1") });
    const segundo = b.rpc("hacer_corte", { p_token: admin, p_admin_pin: "8642" }); // espera al primero
    await a.query("commit");
    const corte2 = await segundo;

    expect(corte.ok).toBe(true);
    expect(corte.corte.total).toBe(antes.periodo.total);
    expect(corte.corte.tickets).toBe(antes.periodo.count);
    expect(corte.corte.gastos).toBe(30.5);
    expect(corte.corte.cobrado).toMatchObject({ tarjeta: 80, efectivo: 0 });
    expect(corte.corte.porCobrar).toBe(antes.periodo.porCobrar);
    expect(antes.periodo.porCobrar).toBeGreaterThan(0);
    expect(corte2.ok).toBe(true);
    expect(corte2.corte.tickets).toBe(1); // solo el ticket que llegó durante el primer corte

    const { rows } = await sql.query(`select (select count(*) from tickets where corte_id is null)::int abiertos,
      (select sum(total) from cortes)::numeric = (select sum(total) from tickets where reenvio is not true) cuadra`);
    expect(rows[0]).toEqual({ abiertos: 0, cuadra: true });
    const despues = await api.rpc("estado", { p_token: cocina });
    expect(despues.historial).toEqual([]);
    for (const id of pendientes) expect(despues.cocina.some((t) => t.id === id)).toBe(true);
    expect(despues.cortes[1].detalle.gastos).toBe(30.5);
    const { rows: log } = await sql.query("select count(*)::int n from bitacora where accion = 'corte'");
    expect(log[0].n).toBe(2);
  });

  it("solo una cocina activa; la otra entra cuando la primera deja de latir", async () => {
    const { rows } = await sql.query("select id from usuarios where rol = 'cocinero'");
    const otra = await api.rpc("login", { p_id: rows[0].id, p_pin: "6284", p_dispositivo: "tablet-2" });
    expect(otra.error).toBe("cocina_ocupada");
    expect(await api.rpc("latido_cocina", { p_token: cocina })).toBe(true);
    await sql.query("update cocina_sesion set actualizado = now() - interval '1 minute'");
    const t2 = await entrar(api, rows[0].id, "6284", "tablet-2");
    expect(await api.rpc("latido_cocina", { p_token: cocina })).toBe(false);
    expect(await api.rpc("latido_cocina", { p_token: t2 })).toBe(true);
  });

  it("protege al último administrador y a uno mismo", async () => {
    const { rows } = await sql.query("select id from usuarios where rol = 'admin'");
    expect((await api.rpc("eliminar_usuario", { p_token: admin, p_admin_pin: "8642", p_id: rows[0].id })).error).toBe("propio");
    expect((await api.rpc("crear_usuario", { p_token: admin, p_admin_pin: "8642", p_nombre: "X", p_pin: "5173", p_rol: "jefe" })).error).toBe("rol");
    expect((await api.rpc("crear_usuario", { p_token: admin, p_admin_pin: "9999", p_nombre: "X", p_pin: "5173", p_rol: "admin" })).error).toBe("pin");
    const otro = await api.rpc("crear_usuario", { p_token: admin, p_admin_pin: "8642", p_nombre: "Admin 2", p_pin: "3917", p_rol: "admin" });
    const t2 = await entrar(api, otro.usuario.id, "3917");
    // Dos administradores intentan borrarse mutuamente a la vez: debe quedar uno
    const a = await conectar(base), b = await conectar(base);
    const [r1, r2] = await Promise.all([
      a.rpc("eliminar_usuario", { p_token: admin, p_admin_pin: "8642", p_id: otro.usuario.id }),
      b.rpc("eliminar_usuario", { p_token: t2, p_admin_pin: "3917", p_id: rows[0].id }).catch((e) => ({ error: e.message })),
    ]);
    const { rows: quedan } = await sql.query("select count(*)::int n from usuarios where rol = 'admin'");
    expect(quedan[0].n).toBe(1);
    expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
  });

  it("avisa cambios por Broadcast sin enviar datos", async () => {
    const { rows } = await sql.query("select distinct payload->>'t' t, privado from realtime.avisos order by 1");
    expect(rows.map((r) => r.t)).toEqual(expect.arrayContaining(["bebidas", "mesas", "tickets", "cortes"]));
    expect(rows.every((r) => r.privado === false)).toBe(true);
    const { rows: claves } = await sql.query("select distinct jsonb_object_keys(payload) k from realtime.avisos");
    expect(claves.map((r) => r.k)).toEqual(["t"]);
  });

  it("al cerrar sesión el token deja de servir", async () => {
    const { rows } = await sql.query("select id from usuarios where rol = 'mesero'");
    const t = await entrar(api, rows[0].id, "5173");
    await api.rpc("logout", { p_token: t });
    expect((await falla(api.rpc("estado", { p_token: t }))).message).toBe("SESION");
  });
});
