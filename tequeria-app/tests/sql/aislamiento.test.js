// Matriz de aislamiento entre sucursales (tests/sql/matriz-aislamiento.js) sobre el esquema real.
// Se siembran las dos cuentas de tests/fixtures/multinegocio.js (A: La Tequería Centro, B: Taquería
// Piloto B), que comparten a propósito claves locales («Mesa 1», «pastor», «coca»). Cada función tiene una
// receta: cómo llamarla bien desde A. Los casos genéricos cambian un solo elemento de esa llamada (el
// token, el equipo, un id, una lista o el PIN) por uno de la otra sucursal y comprueban que se rechaza o
// que se trata igual que algo inexistente, sin efecto en la otra sucursal. Cada intento se deshace al
// terminar (transacción), así que los casos no dependen del orden.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { URL_ADMIN, ESQUEMA, STUB, crearBase, conectarComo, cerrarTodo, falla } from "./util.js";
import { MATRIZ, PASO_ACTUAL, casosDe, revisarMatriz, pasoDe, pendienteDeclarado } from "./matriz-aislamiento.js";
import { sembrar } from "./sembrar.js";

describe("guardia de la matriz (sin base)", () => {
  const externas = ["estado(text, text[])", "login(text, text, text)"];
  const matriz = { "estado(text, text[])": { sesion: true }, "login(text, text, text)": { casos: ["x"] } };

  it("detecta una sobrecarga nueva de una función que ya está en la matriz", () => {
    expect(revisarMatriz([...externas, "estado(text, text[], boolean)"], matriz).faltan).toEqual(["estado(text, text[], boolean)"]);
  });
  it("detecta una función que solo puede ejecutar authenticated", () => {
    expect(revisarMatriz([...externas, "solo_dueno(text)"], matriz).faltan).toEqual(["solo_dueno(text)"]);
  });
  it("rechaza una entrada que no genera ningún caso", () => {
    expect(revisarMatriz(externas, { ...matriz, "nueva_api()": {} }).sinCasos).toEqual(["nueva_api()"]);
  });
  it("pide pasar a firma completa una función futura que ya existe", () => {
    expect(revisarMatriz([...externas, "desbloquear(text, text)"], { ...matriz, desbloquear: { futura: 3, casos: ["x"] } }).futurasQueYaExisten).toEqual(["desbloquear"]);
  });
  it("una función futura debe declarar el paso en que llega", () => {
    expect(revisarMatriz(externas, { ...matriz, nueva: { futura: true, casos: ["x"] } }).futuraSinPaso).toEqual(["nueva"]);
  });
  it("un pendiente declarado para un paso ya terminado hace fallar la guardia", () => {
    const m = { ...matriz, "login(text, text, text)": { casos: ["a (paso 2)", "b (paso 3)"] }, vieja: { futura: 2, casos: ["c"] } };
    expect(revisarMatriz(externas, m, 2).pasoVencido).toEqual(["login(text, text, text): a (paso 2)", "vieja: c"]);
    expect(pendienteDeclarado({}, "b (paso 3)", 2)).toBe(true);
    expect(pendienteDeclarado({}, "sin paso", 2)).toBe(false);
    expect(pasoDe({ futura: 4 }, "d (paso 5)")).toBe(5);
  });
});

// ---------------------------------------------------------------------------------------------------
const NO_EXISTE = "zz-no-existe-0001";
const item = (key, cantidad = 1) => ({ key, cantidad, nombre: key, precio: 1 });
const comanda = (id, extra = {}) => ({
  id, tipo: "llevar", esExtra: false, cuenta: "junta", extras: [],
  ordenes: [{ id: "o1", nombre: "Orden 1", prep: "con-todo", items: [item("taco-pastor")] }], ...extra,
});
let n = 0;
const nuevo = (pref = "zz") => `${pref}-nuevo-${String(++n).padStart(6, "0")}`;

// Recetas: cómo llamar bien a cada función desde la sucursal X. «rol» decide el token y el equipo
// (cocinero → monitor de cocina; los demás → caja). Las secciones id, lista e idem dicen qué argumento
// cambiar y por qué: con(X, v) arma ese argumento con el valor v; ajeno(Y) es el de la otra sucursal.
const RECETAS = {
  "usuarios_login()": { sinSesion: true, args: () => ({}) },
  "login(text, text, text)": {
    sinSesion: true, args: (X) => ({ p_id: X.per.mesero.id, p_pin: X.per.mesero.pin }),
    id: { con: (X, v) => ({ p_id: v.id, p_pin: v.pin }), ajeno: (Y) => Y.per.mesero, inexistente: { id: NO_EXISTE, pin: "918273" } },
  },
  "logout(text)": { rol: "mesero", args: () => ({}) },
  "cambiar_pin(text, text, text)": { rol: "mesero", args: (X) => ({ p_pin_actual: X.per.mesero.pin, p_pin_nuevo: "583920" }) },
  "estado(text, text[])": { rol: "admin", args: () => ({}) },
  "latido_cocina(text)": { rol: "cocinero", args: () => ({}) },
  "liberar_cocina(text)": { rol: "cocinero", args: () => ({}) },
  "marcar_recibido(text, text[])": {
    rol: "cocinero", args: (X) => ({ p_ids: [X.t.llevar] }),
    id: { con: (X, v) => ({ p_ids: [v] }), ajeno: (Y) => Y.t.llevar, inexistente: NO_EXISTE },
    lista: { con: (X, v) => ({ p_ids: [X.t.llevar, v] }), ajeno: (Y) => Y.t.llevar, inexistente: NO_EXISTE },
  },
  "guardar_borrador_mesa(text, integer, jsonb, integer)": {
    rol: "mesero", args: () => ({ p_mesa_id: 1, p_pedido: { ordenes: [{ id: "o1", items: [item("taco-pastor")] }], extras: [] } }),
    // las mesas son locales: la 8 solo existe en A, así que la prueba se hace desde B
    id: { desde: "B", con: (X, v) => ({ p_mesa_id: v }), ajeno: () => 8, inexistente: 99 },
  },
  "liberar_mesa(text, integer)": {
    rol: "mesero", args: () => ({ p_mesa_id: 1 }),
    id: { desde: "B", con: (X, v) => ({ p_mesa_id: v }), ajeno: () => 8, inexistente: 99 },
  },
  "enviar_comanda(text, jsonb)": {
    rol: "mesero", args: () => ({ p_ticket: comanda(nuevo()) }),
    id: { desde: "B", con: (X, v) => ({ p_ticket: comanda("zz-mesa-ajena-0001", { tipo: "aqui", mesaId: v }) }), ajeno: () => 8, inexistente: 99 },
    idem: { con: (X, v) => ({ p_ticket: comanda(v) }), ajeno: (Y) => Y.t.llevar },
  },
  "reenviar_cocina(text, text, integer)": {
    rol: "mesero", args: () => ({ p_id: nuevo(), p_mesa_id: 3 }),
    id: { desde: "B", con: (X, v) => ({ p_id: "zz-reenvio-0001", p_mesa_id: v }), ajeno: () => 8, inexistente: 99 },
    idem: { con: (X, v) => ({ p_id: v }), ajeno: (Y) => Y.t.mesa3 },
  },
  "mover_tickets(text, jsonb, text)": {
    rol: "cocinero", args: (X) => ({ p_tickets: JSON.stringify([{ id: X.t.llevar, estado: "pendiente" }]), p_hacia: "preparando" }),
    id: { con: (X, v) => ({ p_tickets: JSON.stringify([{ id: v, estado: "pendiente" }]) }), ajeno: (Y) => Y.t.llevar, inexistente: NO_EXISTE },
    lista: { con: (X, v) => ({ p_tickets: JSON.stringify([{ id: X.t.llevar, estado: "pendiente" }, { id: v, estado: "pendiente" }]) }),
             ajeno: (Y) => Y.t.llevar, inexistente: NO_EXISTE },
  },
  "archivar_tickets(text, text[])": {
    rol: "cocinero", args: (X) => ({ p_ids: [X.t.llevar] }),
    id: { con: (X, v) => ({ p_ids: [v] }), ajeno: (Y) => Y.t.llevar, inexistente: NO_EXISTE },
    lista: { con: (X, v) => ({ p_ids: [X.t.llevar, v] }), ajeno: (Y) => Y.t.llevar, inexistente: NO_EXISTE },
  },
  "marcar_hecho(text, text, text, boolean)": {
    rol: "cocinero", args: (X) => ({ p_ticket: X.t.llevar, p_linea: "o1|taco-pastor", p_hecho: true }),
    id: { con: (X, v) => ({ p_ticket: v }), ajeno: (Y) => Y.t.llevar, inexistente: NO_EXISTE },
  },
  "cobrar(text, text, text[], text, numeric, numeric, boolean)": {
    rol: "mesero", args: (X) => ({ p_id: nuevo(), p_tickets: [X.t.llevar], p_metodo: "tarjeta" }),
    id: { con: (X, v) => ({ p_id: "zz-cobro-0001", p_tickets: [v] }), ajeno: (Y) => Y.t.llevar, inexistente: NO_EXISTE },
    lista: { con: (X, v) => ({ p_tickets: [X.t.llevar, v] }), ajeno: (Y) => Y.t.llevar, inexistente: NO_EXISTE },
    idem: { con: (X, v) => ({ p_id: v }), ajeno: (Y) => Y.cobro },
  },
  "no_cobrar(text, text, text[], text, boolean)": {
    rol: "mesero", args: (X) => ({ p_admin_pin: X.per.admin.pin, p_tickets: [X.t.llevar], p_motivo: "Prueba" }),
    id: { con: (X, v) => ({ p_tickets: [v] }), ajeno: (Y) => Y.t.llevar, inexistente: NO_EXISTE },
    lista: { con: (X, v) => ({ p_tickets: [X.t.llevar, v] }), ajeno: (Y) => Y.t.llevar, inexistente: NO_EXISTE },
    pin: true,
  },
  "anular_cobro(text, text, text)": {
    rol: "admin", args: (X) => ({ p_id: X.cobro, p_motivo: "Prueba" }),
    id: { con: (X, v) => ({ p_id: v }), ajeno: (Y) => Y.cobro, inexistente: NO_EXISTE },
  },
  "hacer_corte(text, text)": { rol: "cocinero", args: (X) => ({ p_admin_pin: X.per.admin.pin }), pin: true },
  "ajustar_bebida(text, text, integer)": {
    rol: "admin", args: (X) => ({ p_id: X.bebida, p_delta: 1 }),
    id: { con: (X, v) => ({ p_id: v }), ajeno: (Y) => Y.bebida, inexistente: NO_EXISTE },
  },
  "actualizar_bebida(text, text, jsonb)": {
    rol: "admin", args: (X) => ({ p_id: X.bebida, p_cambios: { precio: 31, nombre: "Cambiada" } }),
    id: { con: (X, v) => ({ p_id: v }), ajeno: (Y) => Y.bebida, inexistente: NO_EXISTE },
  },
  "agregar_bebida(text, text, numeric, integer)": { rol: "admin", args: () => ({ p_nombre: "Nueva", p_precio: 10, p_cantidad: 1 }) },
  "eliminar_bebida(text, text)": {
    rol: "admin", args: (X) => ({ p_id: X.bebida }),
    id: { con: (X, v) => ({ p_id: v }), ajeno: (Y) => Y.bebida, inexistente: NO_EXISTE },
  },
  "actualizar_carne(text, text, boolean)": {
    rol: "admin", args: (X) => ({ p_id: X.carne, p_activo: false }),
    id: { con: (X, v) => ({ p_id: v }), ajeno: (Y) => Y.carne, inexistente: NO_EXISTE },
  },
  "agregar_carne(text, text)": { rol: "admin", args: () => ({ p_nombre: "Cabeza" }) },
  "eliminar_carne(text, text)": {
    rol: "admin", args: (X) => ({ p_id: X.carne }),
    id: { con: (X, v) => ({ p_id: v }), ajeno: (Y) => Y.carne, inexistente: NO_EXISTE },
  },
  "fijar_precio(text, text, numeric)": { rol: "admin", args: () => ({ p_clave: "taco-pastor", p_precio: 21 }) },
  "fijar_precio_extra(text, text, numeric)": {
    rol: "admin", args: (X) => ({ p_id: X.extra, p_precio: 33 }),
    id: { con: (X, v) => ({ p_id: v }), ajeno: (Y) => Y.extra, inexistente: NO_EXISTE },
  },
  "agregar_extra(text, text, text, numeric)": { rol: "admin", args: () => ({ p_cat: "taco", p_nombre: "Especial", p_precio: 30 }) },
  "eliminar_extra(text, text)": {
    rol: "admin", args: (X) => ({ p_id: X.extra }),
    id: { con: (X, v) => ({ p_id: v }), ajeno: (Y) => Y.extra, inexistente: NO_EXISTE },
  },
  "alternar_oculto(text, text)": { rol: "admin", args: () => ({ p_clave: "taco-pastor" }) },
  "fijar_ajuste(text, text, jsonb)": { rol: "admin", args: () => ({ p_clave: "variasCocinas", p_valor: "true" }) },
  "agregar_gasto(text, text, text, numeric)": {
    rol: "admin", args: () => ({ p_id: nuevo(), p_concepto: "Hielo", p_monto: 10 }),
    idem: { con: (X, v) => ({ p_id: v }), ajeno: (Y) => Y.gasto },
  },
  "eliminar_gasto(text, text)": {
    rol: "admin", args: (X) => ({ p_id: X.gasto }),
    id: { con: (X, v) => ({ p_id: v }), ajeno: (Y) => Y.gasto, inexistente: NO_EXISTE },
  },
  "crear_usuario(text, text, text, text, text)": {
    rol: "admin", args: (X) => ({ p_admin_pin: X.per.admin.pin, p_nombre: "Nuevo", p_pin: "583920", p_rol: "mesero" }), pin: true,
  },
  "eliminar_usuario(text, text, text)": {
    rol: "admin", args: (X) => ({ p_admin_pin: X.per.admin.pin, p_id: X.per.mesero.id }),
    id: { con: (X, v) => ({ p_id: v }), ajeno: (Y) => Y.per.mesero.id, inexistente: NO_EXISTE }, pin: true,
  },
  "restablecer_pin(text, text, text, text)": {
    rol: "admin", args: (X) => ({ p_admin_pin: X.per.admin.pin, p_id: X.per.mesero.id, p_pin_nuevo: "583920" }),
    id: { con: (X, v) => ({ p_id: v }), ajeno: (Y) => Y.per.mesero.id, inexistente: NO_EXISTE }, pin: true,
  },
};

// ---------------------------------------------------------------------------------------------------
const d = URL_ADMIN ? describe : describe.skip;
const BASE = "tq_aislamiento";
const TABLAS = ["config", "cocina_sesion", "carnes", "bebidas", "usuarios", "mesas", "tickets", "cobros", "cortes",
                "gastos", "cocina_hechos", "sesiones", "bitacora", "folios", "dispositivos"];
// Huella de las filas de una sucursal (sin los campos que el uso normal de una sesión actualiza)
const HUELLA_SUCURSAL = `select jsonb_object_agg(t, h) h from (${TABLAS.map((t) => `select '${t}' t,
  md5(coalesce((select string_agg((to_jsonb(x) - 'ultimo_uso' - 'expira')::text, ',' order by (to_jsonb(x) - 'ultimo_uso' - 'expira')::text)
                from public.${t} x where x.sucursal_id = $1), '')) h`).join(" union all ")}) z`;

d("matriz de aislamiento entre sucursales", () => {
  let sql, A, B, sinEquipo;
  const huellaDe = async (c, s) => (await c.query(HUELLA_SUCURSAL, [s.id])).rows[0].h;
  const otra = (X) => (X === A ? B : A);

  // Una sucursal sembrada, con sus equipos conectados, su personal dentro y datos creados por la API
  async function preparar(sem, pref) {
    const X = { id: sem.id, pref, sem, per: sem.personal, mesas: sem.sucursal.mesas };
    X.con = {
      caja: await conectarComo(BASE, sem.equipos.caja.authUid),
      cocina: await conectarComo(BASE, sem.equipos.cocina.authUid),
    };
    X.equipoId = { caja: sem.equipos.caja.dispositivoId, cocina: sem.equipos.cocina.dispositivoId };
    const entrar = async (rol, eq) => {
      const r = await X.con[eq].rpc("login", { p_id: X.per[rol].id, p_pin: X.per[rol].pin });
      if (!r.ok) throw new Error("login falló: " + JSON.stringify(r));
      return r.token;
    };
    X.tok = { admin: await entrar("admin", "caja"), mesero: await entrar("mesero", "caja"), cocinero: await entrar("cocinero", "cocina") };
    const caja = X.con.caja;
    X.t = { mesa3: `${pref}-tk-mesa3-0001`, llevar: `${pref}-tk-llevar-0001`, cobrado: `${pref}-tk-cobrado-0001` };
    await caja.rpc("enviar_comanda", { p_token: X.tok.mesero, p_ticket: comanda(X.t.mesa3, { tipo: "aqui", mesaId: 3 }) });
    await caja.rpc("enviar_comanda", { p_token: X.tok.mesero, p_ticket: comanda(X.t.llevar) });
    await caja.rpc("enviar_comanda", { p_token: X.tok.mesero, p_ticket: comanda(X.t.cobrado) });
    X.cobro = `${pref}-cobro-0001`;
    await caja.rpc("cobrar", { p_token: X.tok.mesero, p_id: X.cobro, p_tickets: [X.t.cobrado], p_metodo: "efectivo" });
    X.gasto = `${pref}-gasto-0001`;
    await caja.rpc("agregar_gasto", { p_token: X.tok.admin, p_id: X.gasto, p_concepto: "Gas", p_monto: 100 });
    X.extra = (await caja.rpc("agregar_extra", { p_token: X.tok.admin, p_cat: "taco", p_nombre: "Taco exclusivo " + pref, p_precio: 30 })).id;
    X.bebida = (await caja.rpc("agregar_bebida", { p_token: X.tok.admin, p_nombre: "Bebida exclusiva " + pref, p_precio: 20, p_cantidad: 5 })).id;
    X.carne = sem.sucursal.carnes.find((k) => k !== "pastor" && !(pref === "A" ? ["tripa"] : ["bistec", "suadero"]).includes(k));
    return X;
  }

  // Llama una función como lo haría un equipo, dentro de una transacción que siempre se deshace.
  // Devuelve el error o el resultado, y si no hubo error, la huella de cada sucursal tras la llamada.
  async function intentar(con, fn, args, preparar) {
    await con.query("begin");
    try {
      if (preparar) { await con.query("reset role"); await preparar(con); await con.query("set role authenticated"); }
      await con.query("savepoint llamada");
      try {
        const ok = await con.rpc(fn, args);
        await con.query("reset role");
        return { ok, huellaA: await huellaDe(con, A), huellaB: await huellaDe(con, B) };
      } catch (e) {
        await con.query("rollback to savepoint llamada");
        return { error: e.message, hint: e.hint ?? null };
      }
    } finally {
      await con.query("rollback");
    }
  }
  const nombreDe = (firma) => firma.slice(0, firma.indexOf("("));
  const equipoDe = (r) => (r.rol === "cocinero" ? "cocina" : "caja");
  const argsDe = (r, X, extra = {}) => ({ ...(r.sinSesion ? {} : { p_token: X.tok[r.rol] }), ...r.args(X), ...extra });
  const sinError = (res) => { if (res.error) throw new Error(`falló: ${res.error} (${res.hint})`); return res; };

  beforeAll(async () => {
    sql = await crearBase(BASE, [STUB, ESQUEMA]);
    const sem = await sembrar(sql);
    A = await preparar(sem["tequeria-centro"], "A");
    B = await preparar(sem["piloto-b-unica"], "B");
    sinEquipo = await conectarComo(BASE, randomUUID());
  });
  afterAll(cerrarTodo);

  it("cada firma ejecutable desde fuera tiene casos y receta, y no sobra ninguna", async () => {
    const externas = (await sql.query(`select p.proname || '(' || oidvectortypes(p.proargtypes) || ')' firma from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
      order by 1`)).rows.map((r) => r.firma);
    expect(externas.length).toBeGreaterThan(30);
    expect(revisarMatriz(externas)).toEqual({ faltan: [], sobran: [], sinCasos: [], futurasQueYaExisten: [], futuraSinPaso: [], pasoVencido: [] });
    expect(externas.filter((f) => !RECETAS[f])).toEqual([]);
    // anon (sin sesión de Supabase) no ejecuta ninguna
    expect((await sql.query(`select count(*)::int n from pg_proc p where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('anon', p.oid, 'execute')`)).rows[0].n).toBe(0);
  });

  // Casos que se repiten en muchas funciones; el texto es el de casosDe() en la matriz
  const GENERICOS = {
    "rechaza el token de una sesión de otra sucursal": (firma, r) => async () => {
      const res = await intentar(A.con[equipoDe(r)], nombreDe(firma), argsDe(r, A, { p_token: B.tok[r.rol] }));
      expect(res.error).toBe("SESION");
    },
    "rechaza el token usado desde otro dispositivo": (firma, r) => async () => {
      const otroEquipo = equipoDe(r) === "caja" ? "cocina" : "caja";
      const res = await intentar(A.con[otroEquipo], nombreDe(firma), argsDe(r, A));
      expect(res.error).toBe("SESION");
    },
    "rechaza un dispositivo revocado": (firma, r) => async () => {
      const eq = r.sinSesion ? "caja" : equipoDe(r);
      const res = await intentar(A.con[eq], nombreDe(firma), argsDe(r, A),
        (c) => c.query("update public.dispositivos set revocado_en = now() where id = $1", [A.equipoId[eq]]));
      expect(res.error).toBe("DISPOSITIVO");
    },
    "rechaza una identidad sin dispositivo vinculado": (firma, r) => async () => {
      expect((await intentar(sinEquipo, nombreDe(firma), argsDe(r, A))).error).toBe("DISPOSITIVO");
    },
    "trata un id de otra sucursal como inexistente": (firma, r) => async () => {
      const X = r.id.desde === "B" ? B : A, Y = otra(X);
      const antesY = await huellaDe(sql, Y);
      const con = X.con[r.sinSesion ? "caja" : equipoDe(r)];
      const ajeno = await intentar(con, nombreDe(firma), argsDe(r, X, r.id.con(X, r.id.ajeno(Y))));
      const inexistente = await intentar(con, nombreDe(firma), argsDe(r, X, r.id.con(X, r.id.inexistente)));
      const resultado = (x) => ({ error: x.error, hint: x.hint, ok: x.ok });
      expect(resultado(ajeno)).toEqual(resultado(inexistente));
      if (!ajeno.error) {
        expect(ajeno[Y === A ? "huellaA" : "huellaB"]).toEqual(antesY);                     // la otra sucursal no cambia
        expect(ajeno[X === A ? "huellaA" : "huellaB"]).toEqual(inexistente[X === A ? "huellaA" : "huellaB"]);   // y aquí, lo mismo
      }
    },
    "rechaza listas que mezclan ids de dos sucursales": (firma, r) => async () => {
      const con = A.con[equipoDe(r)];
      const mezcla = await intentar(con, nombreDe(firma), argsDe(r, A, r.lista.con(A, r.lista.ajeno(B))));
      const conInexistente = await intentar(con, nombreDe(firma), argsDe(r, A, r.lista.con(A, r.lista.inexistente)));
      expect(mezcla.error).toBeTruthy();   // la operación completa se rechaza: no se procesa en parte
      expect({ error: mezcla.error, hint: mezcla.hint }).toEqual({ error: conInexistente.error, hint: conInexistente.hint });
    },
    "un id repetido de otra sucursal no devuelve sus datos": (firma, r) => async () => {
      const res = await intentar(A.con[equipoDe(r)], nombreDe(firma), argsDe(r, A, r.idem.con(A, r.idem.ajeno(B))));
      expect(res.error).toBe("DATOS");
      expect(JSON.stringify(res)).not.toMatch(/B-|Piloto|Omar|Berta|Rita/);
    },
    "no acepta el PIN de un administrador de otra sucursal": (firma, r) => async () => {
      const antes = { A: await huellaDe(sql, A), B: await huellaDe(sql, B) };
      const res = await intentar(A.con[equipoDe(r)], nombreDe(firma), argsDe(r, A, { p_admin_pin: B.per.admin.pin }));
      expect(res.ok).toMatchObject({ ok: false, error: "pin" });
      expect({ A: res.huellaA, B: res.huellaB }).toEqual(antes);
    },
  };

  // Una lista de 300 referencias propias y, en la posición 301, un id ajeno o uno inexistente
  const mas300 = (fn, campo) => async () => {
    const lista = (ultimo) => [...Array(300).fill(A.t.llevar), ultimo];
    const ajeno = await intentar(A.con.cocina, fn, { p_token: A.tok.cocinero, [campo]: lista(B.t.llevar) });
    const inexistente = await intentar(A.con.cocina, fn, { p_token: A.tok.cocinero, [campo]: lista(NO_EXISTE) });
    expect(ajeno.error).toBe("DATOS");
    expect({ error: ajeno.error, hint: ajeno.hint }).toEqual({ error: inexistente.error, hint: inexistente.hint });
    // con 300 sí se procesa
    expect((await intentar(A.con.cocina, fn, { p_token: A.tok.cocinero, [campo]: Array(300).fill(A.t.llevar) })).error).toBeUndefined();
  };

  // Casos propios de cada función
  const CASOS = {
    "marcar_recibido(text, text[])": {
      "una lista de más de 300 se rechaza entera, aunque el id ajeno o inexistente llegue en la posición 301": mas300("marcar_recibido", "p_ids"),
    },
    "archivar_tickets(text, text[])": {
      "una lista de más de 300 se rechaza entera, aunque el id ajeno o inexistente llegue en la posición 301": mas300("archivar_tickets", "p_ids"),
    },
    "usuarios_login()": {
      "solo lista el personal de la sucursal del dispositivo": async () => {
        const r = await A.con.caja.rpc("usuarios_login");
        expect(r.usuarios.map((u) => u.nombre).sort()).toEqual(Object.values(A.per).map((p) => p.nombre).sort());
        expect(r.negocio).toBe(A.sem.sucursal.nombre);
      },
    },
    "login(text, text, text)": {
      "un usuario de otra sucursal no entra en este equipo": async () => {
        const res = await intentar(A.con.caja, "login", { p_id: B.per.mesero.id, p_pin: B.per.mesero.pin });
        expect(res.ok).toMatchObject({ ok: false, error: "pin" });
      },
      "los fallos en otra sucursal no bloquean al operador": async () => {
        for (let i = 0; i < 6; i++) await A.con.caja.rpc("login", { p_id: B.per.mesero.id, p_pin: "000000" });
        const r = await B.con.caja.rpc("login", { p_id: B.per.mesero.id, p_pin: B.per.mesero.pin });
        expect(r.ok).toBe(true);
        await B.con.caja.rpc("logout", { p_token: r.token });
      },
    },
    "estado(text, text[])": {
      "todas las partes devuelven solo datos de su sucursal": async () => {
        const e = await A.con.caja.rpc("estado", { p_token: A.tok.admin });
        const texto = JSON.stringify(e);
        expect(texto).not.toMatch(/"B-|Piloto|exclusiva B|exclusivo B|Berta|Omar|Rita/);
        expect(e.mesas).toHaveLength(A.mesas);
        expect(e.carnes.map((k) => k.id).sort()).toEqual([...A.sem.sucursal.carnes].sort());
        expect(e.usuarios.map((u) => u.nombre).sort()).toEqual(Object.values(A.per).map((p) => p.nombre).sort());
        expect(e.precios["taco-pastor"]).toBe(A.sem.sucursal.precios["taco-pastor"]);
        expect(e.gastos.map((g) => g.id)).toEqual([A.gasto]);
        expect(e.porCobrar.map((t) => t.id).sort()).toEqual([A.t.llevar, A.t.mesa3].sort());
      },
      "el folio y los resúmenes son los de su sucursal": async () => {
        const [ea, eb] = await Promise.all([A.con.caja.rpc("estado", { p_token: A.tok.admin }), B.con.caja.rpc("estado", { p_token: B.tok.admin })]);
        const folios = (e) => e.historial.map((t) => t.folio).sort((x, y) => x - y);
        expect(folios(ea)).toEqual([1, 2, 3]);   // cada sucursal numera desde 1
        expect(folios(eb)).toEqual([1, 2, 3]);
        const total = (X) => 3 * X.sem.sucursal.precios["taco-pastor"];
        expect(ea.periodo).toMatchObject({ count: 3, total: total(A), gastos: 100, porCobrarCount: 2 });
        expect(eb.periodo).toMatchObject({ count: 3, total: total(B), gastos: 100, porCobrarCount: 2 });
      },
    },
    "latido_cocina(text)": {
      "la cocina activa es por sucursal": async () => {
        expect(await A.con.cocina.rpc("latido_cocina", { p_token: A.tok.cocinero })).toBe(true);
        expect(await B.con.cocina.rpc("latido_cocina", { p_token: B.tok.cocinero })).toBe(true);
        expect(await A.con.cocina.rpc("latido_cocina", { p_token: A.tok.cocinero })).toBe(true);
      },
    },
    "guardar_borrador_mesa(text, integer, jsonb, integer)": {
      "«Mesa 1» de otra sucursal no se toca": async () => {
        const antesB = await huellaDe(sql, B);
        const res = sinError(await intentar(A.con.caja, "guardar_borrador_mesa", argsDe(RECETAS["guardar_borrador_mesa(text, integer, jsonb, integer)"], A)));
        expect(res.ok).toMatchObject({ id: 1, estado: "borrador" });
        expect(res.huellaB).toEqual(antesB);
      },
    },
    "enviar_comanda(text, jsonb)": {
      "precios, existencias y folio salen de su sucursal": async () => {
        const antesB = await huellaDe(sql, B);
        const t = comanda(nuevo("A"), { ordenes: [{ id: "o1", items: [item("taco-pastor", 2), item("beb-coca", 1)] }] });
        await A.con.caja.query("begin");
        try {
          const r = await A.con.caja.rpc("enviar_comanda", { p_token: A.tok.mesero, p_ticket: t });
          const precioA = A.sem.sucursal.precios["taco-pastor"], cocaA = A.sem.sucursal.bebidas.find((b) => b.id === "coca");
          expect(r.ticket.total).toBe(2 * precioA + cocaA.precio);
          expect(r.ticket.folio).toBe(4);
          const est = await A.con.caja.rpc("estado", { p_token: A.tok.admin, p_partes: ["bebidas"] });
          expect(est.bebidas.find((b) => b.id === "coca").cantidad).toBe(cocaA.cantidad - 1);
          await A.con.caja.query("reset role");
          expect(await huellaDe(A.con.caja, B)).toEqual(antesB);
        } finally { await A.con.caja.query("rollback"); }
      },
    },
    "cobrar(text, text, text[], text, numeric, numeric, boolean)": {
      "liberar la mesa solo afecta a su sucursal": async () => {
        const antesB = await huellaDe(sql, B);
        const res = sinError(await intentar(A.con.caja, "cobrar", { p_token: A.tok.mesero, p_id: nuevo(), p_tickets: [A.t.mesa3],
          p_metodo: "tarjeta", p_liberar_mesa: true }));
        expect(res.ok.mesaLiberada).toBe(true);
        expect(res.huellaB).toEqual(antesB);   // la Mesa 3 de B sigue ocupada
        const mesasB = (await B.con.caja.rpc("estado", { p_token: B.tok.mesero, p_partes: ["mesas"] })).mesas;
        expect(mesasB.find((m) => m.id === 3).estado).toBe("ocupada");
      },
    },
    "hacer_corte(text, text)": {
      "el corte no incluye ni frena tickets, cobros o gastos de otra sucursal": async () => {
        // incluye: el corte de A deja intacto el periodo abierto de B
        const antesB = await huellaDe(sql, B);
        const res = sinError(await intentar(A.con.cocina, "hacer_corte", { p_token: A.tok.cocinero, p_admin_pin: A.per.admin.pin }));
        expect(res.ok.corte).toMatchObject({ tickets: 3 });
        expect(res.huellaB).toEqual(antesB);
        // frena: con el candado del corte de A tomado, B cobra sin esperar
        const candado = await conectarComo(BASE, null);
        await candado.query("begin");
        await candado.query("select pg_advisory_xact_lock(hashtextextended('tequeria:corte:' || $1, 0))", [A.id]);
        try {
          await B.con.caja.query("set statement_timeout = '3s'");
          const r = await intentar(B.con.caja, "cobrar", { p_token: B.tok.mesero, p_id: nuevo(), p_tickets: [B.t.llevar], p_metodo: "tarjeta" });
          expect(r.error).toBeUndefined();
        } finally {
          await B.con.caja.query("reset statement_timeout");
          await candado.query("rollback");
        }
      },
    },
    "agregar_carne(text, text)": {
      "«pastor» puede existir en las dos sucursales": async () => {
        const deB = B.sem.sucursal.carnes.find((k) => !A.sem.sucursal.carnes.includes(k));   // tripa
        const res = sinError(await intentar(A.con.caja, "agregar_carne", { p_token: A.tok.admin, p_nombre: deB }));
        expect(res.ok).toEqual({ id: deB });
        const dup = await intentar(A.con.caja, "agregar_carne", { p_token: A.tok.admin, p_nombre: "Pastor" });
        expect(dup.error).toBe("DUPLICADO");   // dentro de la sucursal sigue siendo única
      },
    },
  };

  // Solo puede quedar pendiente lo declarado para un paso posterior (matriz-aislamiento.js); cualquier otro
  // caso sin prueba falla aquí y en su propia prueba.
  const sinPrueba = [];
  for (const [firma, f] of Object.entries(MATRIZ)) {
    describe(firma + (f.futura ? ` (nueva, paso ${f.futura})` : ""), () => {
      const r = RECETAS[firma];
      if (!f.futura) {
        it("la receta es válida: la llamada propia funciona", async () => {
          const X = r.id?.desde === "B" ? B : A;
          sinError(await intentar(X.con[r.sinSesion ? "caja" : equipoDe(r)], nombreDe(firma), argsDe(r, X)));
        });
      }
      for (const texto of casosDe(f)) {
        const prueba = f.futura ? null : (GENERICOS[texto]?.(firma, r) || CASOS[firma]?.[texto]);
        if (prueba) it(texto, prueba);
        else if (pendienteDeclarado(f, texto)) it.todo(`${texto} — pendiente del paso ${pasoDe(f, texto)}`);
        else {
          sinPrueba.push(`${firma}: ${texto}`);
          it(texto, () => { throw new Error(`Caso del paso ${PASO_ACTUAL} sin prueba: agrégala en CASOS o GENERICOS.`); });
        }
      }
    });
  }
  it("todos los casos que no se declararon para un paso posterior tienen prueba", () => {
    expect(sinPrueba).toEqual([]);
  });
});
