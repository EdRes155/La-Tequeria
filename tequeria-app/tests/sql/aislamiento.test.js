// Matriz de aislamiento entre sucursales (tests/sql/matriz-aislamiento.js) sobre el esquema real.
// Se siembran las dos cuentas de tests/fixtures/multinegocio.js (A: La Tequería Centro, B: Taquería
// Piloto B), que comparten a propósito claves locales («Mesa 1», «pastor», «coca»). Cada función tiene una
// receta: cómo llamarla bien desde A. Los casos genéricos cambian un solo elemento de esa llamada (el
// token, el equipo, un id, una lista, el PIN, la persona, la cuenta o la sucursal) por uno de la otra
// cuenta y comprueban que se rechaza o que se trata igual que algo inexistente, sin efecto en la otra.
// Cada intento se deshace al terminar (transacción), así que los casos no dependen del orden.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { URL_ADMIN, ESQUEMA, STUB, crearBase, conectarComo, cerrarTodo, falla, crearPersona, crearAnonimo, comoEquipo, pidDe, esperaCandado } from "./util.js";
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
  "desbloquear(text, text)": { rol: "mesero", args: (X) => ({ p_pin: X.per.mesero.pin }) },
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
  "fijar_negocio(text, text, text)": { rol: "admin", args: () => ({ p_nombre: "Nombre nuevo", p_zona_horaria: "America/Tijuana" }) },
  "fijar_mesas(text, integer)": { rol: "admin", args: () => ({ p_cantidad: 7 }) },
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
  "restablecer_acceso(text, text, text)": {
    rol: "admin", args: (X) => ({ p_admin_pin: X.per.admin.pin, p_id: X.per.mesero.id }),
    id: { con: (X, v) => ({ p_id: v }), ajeno: (Y) => Y.per.mesero.id, inexistente: NO_EXISTE }, pin: true,
  },
  "restablecer_pin(text, text, text, text)": {
    rol: "admin", args: (X) => ({ p_admin_pin: X.per.admin.pin, p_id: X.per.mesero.id, p_pin_nuevo: "583920" }),
    id: { con: (X, v) => ({ p_id: v }), ajeno: (Y) => Y.per.mesero.id, inexistente: NO_EXISTE }, pin: true,
  },

  // Paso 4. «quien» es la conexión que llama: una identidad anónima sin equipo, una persona invitada o un
  // dueño de la cuenta. «ref» dice qué argumento (sucursal o id) cambiar por el de la otra cuenta.
  "vincular_dispositivo(text, text)": { quien: "anonimo", args: (X) => ({ p_codigo: X.codigo, p_nombre: "Caja nueva" }) },
  "crear_cuenta(text, text, text, text, text)": {
    quien: "propietario", args: () => ({ p_nombre: "Cuenta nueva", p_sucursal: "Matriz", p_zona_horaria: "America/Mexico_City",
                                         p_admin_nombre: "Admin nuevo", p_admin_pin: "583920" }),
  },
  "aceptar_invitacion(text)": { quien: "invitado", args: (X) => ({ p_clave: X.invitacion.token }) },
  "mis_cuentas()": { quien: "propietario", args: () => ({}) },
  "crear_sucursal(uuid, text, text, text, text)": {
    quien: "propietario", args: (X) => ({ p_cuenta: X.cuenta, p_nombre: "Sucursal nueva", p_zona_horaria: null,
                                          p_admin_nombre: "Admin de la nueva", p_admin_pin: "583920" }),
  },
  "crear_administrador(uuid, uuid, text, text)": {
    quien: "propietario", args: (X) => ({ p_cuenta: X.cuenta, p_sucursal: X.id, p_nombre: "Rescate", p_pin: "583920" }),
    ref: { con: (X, v) => ({ p_sucursal: v }), ajeno: (Y) => Y.id },
  },
  "invitar_miembro(uuid, text, text)": {
    quien: "propietario", args: (X) => ({ p_cuenta: X.cuenta, p_correo: `nuevo.${X.pref.toLowerCase()}@ejemplo.invalid`, p_rol: "encargado" }),
  },
  "cancelar_invitacion(uuid, uuid)": {
    quien: "propietario", args: (X) => ({ p_cuenta: X.cuenta, p_invitacion: X.invitacion.id }),
    ref: { con: (X, v) => ({ p_invitacion: v }), ajeno: (Y) => Y.invitacion.id },
  },
  "quitar_miembro(uuid, uuid)": {
    quien: "propietario", args: (X) => ({ p_cuenta: X.cuenta, p_miembro: X.encargado }),
    ref: { con: (X, v) => ({ p_miembro: v }), ajeno: (Y) => Y.encargado },
  },
  "listar_miembros(uuid)": { quien: "propietario", args: (X) => ({ p_cuenta: X.cuenta }) },
  "generar_codigo(uuid, uuid, boolean)": {
    quien: "propietario", args: (X) => ({ p_cuenta: X.cuenta, p_sucursal: X.id, p_monitor: false }),
    ref: { con: (X, v) => ({ p_sucursal: v }), ajeno: (Y) => Y.id },
  },
  "listar_dispositivos(uuid, uuid)": {
    quien: "propietario", args: (X) => ({ p_cuenta: X.cuenta, p_sucursal: X.id }),
    ref: { con: (X, v) => ({ p_sucursal: v }), ajeno: (Y) => Y.id },
  },
  "revocar_dispositivo(uuid, uuid)": {
    quien: "propietario", args: (X) => ({ p_cuenta: X.cuenta, p_dispositivo: X.equipoId.caja }),
    ref: { con: (X, v) => ({ p_dispositivo: v }), ajeno: (Y) => Y.equipoId.caja },
  },
};

// ---------------------------------------------------------------------------------------------------
const d = URL_ADMIN ? describe : describe.skip;
const BASE = "tq_aislamiento";
const TABLAS = ["config", "cocina_sesion", "carnes", "bebidas", "usuarios", "mesas", "tickets", "cobros", "cortes",
                "gastos", "cocina_hechos", "sesiones", "bitacora", "folios", "dispositivos", "codigos_vinculacion"];
// Lo de la cuenta ($2): sus datos, sucursales, miembros, invitaciones y las acciones de cuenta de la bitácora
const DE_CUENTA = [["cuentas", "x.id = $2"], ["sucursales", "x.cuenta_id = $2"], ["membresias", "x.cuenta_id = $2"],
                   ["invitaciones", "x.cuenta_id = $2"], ["bitacora", "x.cuenta_id = $2 and x.sucursal_id is null"]];
// Huella de las filas de una sucursal y de su cuenta (sin los campos que el uso normal de una sesión actualiza)
const HUELLA_SUCURSAL = `select jsonb_object_agg(t, h) h from (${[...TABLAS.map((t) => [t, "x.sucursal_id = $1"]),
  ...DE_CUENTA.map(([t, w]) => [t + ":cuenta", w])].map(([t, w]) => `select '${t}' t,
  md5(coalesce((select string_agg((to_jsonb(x) - 'ultimo_uso' - 'expira')::text, ',' order by (to_jsonb(x) - 'ultimo_uso' - 'expira')::text)
                from public.${t.replace(":cuenta", "")} x where ${w}), '')) h`).join(" union all ")}) z`;

d("matriz de aislamiento entre sucursales", () => {
  let sql, A, B, sinEquipo;
  const huellaDe = async (c, s) => (await c.query(HUELLA_SUCURSAL, [s.id, s.cuenta])).rows[0].h;
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

    // Paso 4: la cuenta y sus personas, con la API. Un encargado que ya aceptó, una invitación pendiente,
    // un código de vinculación vigente (cada intento se deshace, así que sigue sin usar), una identidad
    // anónima sin equipo y una persona sin correo verificado.
    const p = pref.toLowerCase();
    X.cuenta = sem.cuenta;
    X.nombreCuenta = (await sql.query("select nombre from public.cuentas where id = $1", [X.cuenta])).rows[0].nombre;
    X.duenos = sem.duenos;
    const persona = async (uid, ip) => conectarComo(BASE, uid, ip, { persona: true });
    X.con.propietario = await persona(sem.duenos.propietario.authUid, "203.0.113.30");
    const invitar = (correo) => X.con.propietario.rpc("invitar_miembro", { p_cuenta: X.cuenta, p_correo: correo, p_rol: "encargado" });
    X.correoMiembro = `miembro.${p}@ejemplo.invalid`;
    const m = await invitar(X.correoMiembro);
    X.encargado = await crearPersona(sql, X.correoMiembro);
    X.con.encargado = await persona(X.encargado, "203.0.113.31");
    await X.con.encargado.rpc("aceptar_invitacion", { p_clave: m.token });
    X.correoInvitado = `invitado.${p}@ejemplo.invalid`;
    const inv = await invitar(X.correoInvitado);
    X.invitacion = { token: inv.token, id: inv.invitacion.id };
    X.invitado = await crearPersona(sql, X.correoInvitado);
    X.con.invitado = await persona(X.invitado, "203.0.113.32");
    X.codigo = (await X.con.propietario.rpc("generar_codigo", { p_cuenta: X.cuenta, p_sucursal: X.id, p_monitor: false })).codigo;
    await sql.query("update public.codigos_vinculacion set vence = now() + interval '1 day' where sucursal_id = $1", [X.id]);
    X.anonimo = await crearAnonimo(sql);
    X.con.anonimo = await conectarComo(BASE, X.anonimo, "203.0.113.33");
    X.correoSinVerificar = `sin-verificar.${p}@ejemplo.invalid`;
    X.sinVerificar = await crearPersona(sql, X.correoSinVerificar, { verificado: false });
    X.con.sinVerificar = await persona(X.sinVerificar, "203.0.113.34");
    X.ajena = personaAjena.uid;
    X.con.ajena = personaAjena.con;
    return X;
  }

  // Llama una función como lo haría un equipo, dentro de una transacción que siempre se deshace.
  // Devuelve el error o el resultado, y si no hubo error, la huella de cada sucursal tras la llamada.
  async function intentar(con, fn, args, preparar, revisar) {
    await con.query("begin");
    try {
      if (preparar) { await con.query("reset role"); await preparar(con); await con.query("set role authenticated"); }
      await con.query("savepoint llamada");
      try {
        const ok = await con.rpc(fn, args);
        await con.query("reset role");
        const extra = revisar ? await revisar(con, ok) : undefined;
        return { ok, extra, huellaA: await huellaDe(con, A), huellaB: await huellaDe(con, B) };
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
  const conDe = (r, X) => X.con[r.quien || (r.sinSesion ? "caja" : equipoDe(r))];
  const argsDe = (r, X, extra = {}) => ({ ...(r.sinSesion || r.quien ? {} : { p_token: X.tok[r.rol] }), ...r.args(X), ...extra });
  const sinError = (res) => { if (res.error) throw new Error(`falló: ${res.error} (${res.hint})`); return res; };

  let personaAjena;
  beforeAll(async () => {
    sql = await crearBase(BASE, [STUB, ESQUEMA]);
    const sem = await sembrar(sql);
    const uid = await crearPersona(sql, "sin-cuentas@ejemplo.invalid");
    personaAjena = { uid, con: await conectarComo(BASE, uid, "203.0.113.35", { persona: true }) };
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
    "rechaza un equipo suspendido o borrado en Supabase Auth": (firma, r) => async () => {
      // el JWT de la identidad sigue siendo válido: la regla se revisa en auth.users en cada llamada
      const X = r.id?.desde === "B" ? B : A, eq = r.sinSesion ? "caja" : equipoDe(r), uid = X.sem.equipos[eq].authUid;
      const conAuth = (cambio) => (c) => c.query(`update auth.users set ${cambio} where id = $1`, [uid]);
      for (const cambio of ["banned_until = now() + interval '1 hour'", "deleted_at = now()"]) {
        expect([cambio, (await intentar(X.con[eq], nombreDe(firma), argsDe(r, X), conAuth(cambio))).error]).toEqual([cambio, "DISPOSITIVO"]);
      }
      // una suspensión que ya terminó no lo impide
      sinError(await intentar(X.con[eq], nombreDe(firma), argsDe(r, X), conAuth("banned_until = now() - interval '1 minute'")));
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
    // Paso 4: personas y dueños
    "rechaza una identidad anónima o la de un equipo": (firma, r) => async () => {
      // Cada una tiene todo lo demás: correo verificado, es propietaria de A y la invitación es para su correo.
      // Así cada regla de _identidad se prueba por separado.
      const darleTodo = (uid, correo, cambio) => async (c) => {
        await c.query(`update auth.users set email = $2, email_confirmed_at = now()${cambio} where id = $1`, [uid, correo]);
        await c.query("insert into public.membresias (cuenta_id, auth_user_id, rol) values ($1, $2, 'propietario')", [A.cuenta, uid]);
        await c.query("update public.invitaciones set correo = $1 where id = $2", [correo, A.invitacion.id]);
      };
      // anónima (aún no es un equipo)
      expect((await intentar(A.con.anonimo, nombreDe(firma), argsDe(r, A), darleTodo(A.anonimo, "anonima@ejemplo.invalid", ""))).error)
        .toBe("IDENTIDAD");
      // la de un equipo, aunque ya no sea anónima
      expect((await intentar(A.con.caja, nombreDe(firma), argsDe(r, A),
        darleTodo(A.sem.equipos.caja.authUid, "equipo@ejemplo.invalid", ", is_anonymous = false"))).error).toBe("IDENTIDAD");
    },
    "rechaza una persona sin correo verificado": (firma, r) => async () => {
      // tiene todo lo demás: es propietaria de A y la invitación es para su correo. Verificado, sí pasa.
      const darleTodo = async (c, verificar) => {
        await c.query("insert into public.membresias (cuenta_id, auth_user_id, rol) values ($1, $2, 'propietario')", [A.cuenta, A.sinVerificar]);
        await c.query("update public.invitaciones set correo = $1 where id = $2", [A.correoSinVerificar, A.invitacion.id]);
        if (verificar) await c.query("update auth.users set email_confirmed_at = now() where id = $1", [A.sinVerificar]);
      };
      expect((await intentar(A.con.sinVerificar, nombreDe(firma), argsDe(r, A), (c) => darleTodo(c, false))).error).toBe("IDENTIDAD");
      sinError(await intentar(A.con.sinVerificar, nombreDe(firma), argsDe(r, A), (c) => darleTodo(c, true)));
    },
    "rechaza a una persona sin membresía en esa cuenta": (firma, r) => async () => {
      // la propietaria de B y una persona sin cuentas, con la cuenta de A: la misma respuesta que una cuenta inexistente
      const deB = await intentar(B.con.propietario, nombreDe(firma), argsDe(r, A));
      const sinCuentas = await intentar(A.con.ajena, nombreDe(firma), argsDe(r, A));
      const inexistente = await intentar(A.con.propietario, nombreDe(firma), argsDe(r, A, { p_cuenta: randomUUID() }));
      expect(deB.error).toBe("CUENTA");
      for (const x of [sinCuentas, inexistente]) expect({ error: x.error, hint: x.hint }).toEqual({ error: deB.error, hint: deB.hint });
    },
    "una sucursal o un id de otra cuenta se trata como inexistente": (firma, r) => async () => {
      const con = A.con.propietario, fn = nombreDe(firma);
      const resultado = (x) => ({ error: x.error, hint: x.hint, ok: x.ok });
      // la cuenta de B (de la que A no es miembro) responde igual que una cuenta que no existe
      const cuentaAjena = await intentar(con, fn, argsDe(r, A, { p_cuenta: B.cuenta }));
      expect(cuentaAjena.error).toBe("CUENTA");
      expect(resultado(cuentaAjena)).toEqual(resultado(await intentar(con, fn, argsDe(r, A, { p_cuenta: randomUUID() }))));
      if (!r.ref) return;
      // con su propia cuenta y la sucursal o el id de B: igual que uno inexistente, y B no cambia
      const antesB = await huellaDe(sql, B);
      const ajeno = await intentar(con, fn, argsDe(r, A, r.ref.con(A, r.ref.ajeno(B))));
      const inexistente = await intentar(con, fn, argsDe(r, A, r.ref.con(A, randomUUID())));
      expect(ajeno.ok).toMatchObject({ ok: false, error: "no_existe" });
      expect(resultado(ajeno)).toEqual(resultado(inexistente));
      expect(ajeno.huellaB).toEqual(antesB);
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
        expect(r.sucursal).toEqual({ id: A.id, nombre: A.sem.sucursal.nombre });   // con ella nombra su canal y sus claves
      },
    },
    "login(text, text, text)": {
      "un usuario de otra sucursal no entra en este equipo": async () => {
        const res = await intentar(A.con.caja, "login", { p_id: B.per.mesero.id, p_pin: B.per.mesero.pin });
        expect(res.ok).toMatchObject({ ok: false, error: "pin" });
      },
      "los fallos cuentan también por equipo": async () => {
        // 30 fallos en la caja de A (dentro de una transacción que se deshace): la caja queda bloqueada para
        // cualquiera; el monitor de A, no
        await A.con.caja.query("begin");
        try {
          for (let i = 0; i < 30; i++) await A.con.caja.rpc("login", { p_id: "nadie-" + i, p_pin: "000000" });
          expect(await A.con.caja.rpc("login", { p_id: A.per.mesero.id, p_pin: A.per.mesero.pin }))
            .toMatchObject({ ok: false, error: "bloqueado", motivo: "equipo" });
        } finally { await A.con.caja.query("rollback"); }
        const r = await intentar(A.con.cocina, "login", { p_id: A.per.mesero.id, p_pin: A.per.mesero.pin });
        expect(r.ok).toMatchObject({ ok: true });
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
    "desbloquear(text, text)": {
      "no reinicia las 12 horas": async () => {
        const vence = async (c) => (await c.query("select vence_absoluta v from public.sesiones where token_hash = encode(extensions.digest($1, 'sha256'), 'hex')",
          [A.tok.mesero])).rows[0].v;
        const antes = await vence(sql);
        await A.con.caja.query("begin");
        try {
          expect(await A.con.caja.rpc("desbloquear", { p_token: A.tok.mesero, p_pin: A.per.mesero.pin })).toEqual({ ok: true });
          await A.con.caja.query("reset role");
          expect(await vence(A.con.caja)).toEqual(antes);
        } finally { await A.con.caja.query("rollback"); }
      },
      "el PIN de otro operador no desbloquea": async () => {
        const r = await intentar(A.con.caja, "desbloquear", { p_token: A.tok.mesero, p_pin: A.per.admin.pin });
        expect(r.ok).toMatchObject({ ok: false, error: "pin" });
      },
    },
    "restablecer_acceso(text, text, text)": {
      "solo un administrador de la misma sucursal; queda en bitácora": async () => {
        const mesero = await intentar(A.con.caja, "restablecer_acceso", { p_token: A.tok.mesero, p_admin_pin: A.per.admin.pin, p_id: A.per.cocinero.id });
        expect(mesero.error).toBe("PERMISO");
        await A.con.caja.query("begin");
        try {
          expect(await A.con.caja.rpc("restablecer_acceso", { p_token: A.tok.admin, p_admin_pin: A.per.admin.pin, p_id: A.per.mesero.id }))
            .toMatchObject({ ok: true });
          await A.con.caja.query("reset role");
          const { rows } = await A.con.caja.query("select sucursal_id, usuario_id from public.bitacora where accion = 'restablecer_acceso'");
          expect(rows).toEqual([{ sucursal_id: A.id, usuario_id: A.per.admin.id }]);
        } finally { await A.con.caja.query("rollback"); }
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
    // ----- Paso 4 -----
    "vincular_dispositivo(text, text)": {
      "un código vencido, ya usado o de otra cuenta se rechaza": async () => {
        const fn = "vincular_dispositivo", args = { p_codigo: A.codigo, p_nombre: "Caja nueva" };
        const codigoA = (c, cambio) => c.query(`update public.codigos_vinculacion set ${cambio} where sucursal_id = $1`, [A.id]);
        const rechazos = [
          await intentar(A.con.anonimo, fn, args, (c) => codigoA(c, "vence = now() - interval '1 second'")),   // vencido
          await intentar(A.con.anonimo, fn, args, (c) => codigoA(c, "usado_en = now()")),                     // ya usado
          await intentar(A.con.anonimo, fn, args, (c) => c.query("update public.cuentas set estado = 'suspendida' where id = $1", [A.cuenta])),
          await intentar(A.con.anonimo, fn, args, (c) => c.query("update public.sucursales set activa = false where id = $1", [A.id])),
          await intentar(A.con.anonimo, fn, { ...args, p_codigo: "ZZZZZZZZ" }),                               // inexistente
        ];
        for (const x of rechazos) expect(x.ok).toEqual({ ok: false, error: "codigo", restantes: 4 });
        // el de otra cuenta solo vincula a esa otra cuenta, y un equipo de A no lo usa para cambiarse a B
        const conCodigoDeB = sinError(await intentar(A.con.anonimo, fn, { ...args, p_codigo: B.codigo }));
        expect(conCodigoDeB.ok).toMatchObject({ ok: true, sucursal: { id: B.id } });
        expect(conCodigoDeB.huellaA).toEqual(await huellaDe(sql, A));
        expect((await intentar(A.con.caja, fn, { ...args, p_codigo: B.codigo })).error).toBe("VINCULADO");
        // el bueno, escrito con minúsculas y guion, sí
        const bueno = sinError(await intentar(A.con.anonimo, fn, { ...args, p_codigo: A.codigo.toLowerCase().replace(/^(.{4})/, "$1-") }));
        expect(bueno.ok).toMatchObject({ ok: true, sucursal: { id: A.id }, dispositivo: { nombre: "Caja nueva", monitorCocina: false } });
      },
      "una identidad que ya es un dispositivo vigente no se vincula otra vez": async () => {
        const fn = "vincular_dispositivo", args = { p_codigo: A.codigo, p_nombre: "Otra vez" };
        expect(await intentar(A.con.caja, fn, args)).toMatchObject({ error: "VINCULADO" });
        // revocado tampoco: la recuperación es una identidad nueva con otro código
        expect(await intentar(A.con.caja, fn, args, (c) => c.query("update public.dispositivos set revocado_en = now() where id = $1",
          [A.equipoId.caja]))).toMatchObject({ error: "REVOCADO" });
      },
      "una identidad suspendida o borrada en Supabase Auth no se vincula": async () => {
        const fn = "vincular_dispositivo", args = { p_codigo: A.codigo, p_nombre: "Caja nueva" };
        const conAuth = (cambio) => (c) => c.query(`update auth.users set ${cambio} where id = $1`, [A.anonimo]);
        for (const cambio of ["banned_until = now() + interval '1 hour'", "deleted_at = now()"]) {
          const res = await intentar(A.con.anonimo, fn, args, conAuth(cambio));
          expect([cambio, res.error]).toEqual([cambio, "IDENTIDAD"]);
        }
        expect((await intentar(A.con.anonimo, fn, args, conAuth("banned_until = now() - interval '1 minute'"))).ok).toMatchObject({ ok: true });
      },
      "una identidad de persona (no anónima) no se vincula como equipo": async () => {
        const fn = "vincular_dispositivo", args = { p_codigo: A.codigo, p_nombre: "Mi celular" };
        expect((await intentar(A.con.propietario, fn, args)).error).toBe("IDENTIDAD");
        // ni una identidad anónima que se convirtió en una con correo
        expect((await intentar(A.con.anonimo, fn, args, (c) => c.query(
          "update auth.users set is_anonymous = false, email = 'convertida@ejemplo.invalid', email_confirmed_at = now() where id = $1",
          [A.anonimo]))).error).toBe("IDENTIDAD");
      },
    },
    "crear_cuenta(text, text, text, text, text)": {
      "la cuenta nace activa con quien la crea como propietario, en la misma transacción": async () => {
        const p = A.con.ajena, args = RECETAS["crear_cuenta(text, text, text, text, text)"].args();
        const antes = { A: await huellaDe(sql, A), B: await huellaDe(sql, B) };
        await p.query("begin");
        try {
          const r = await p.rpc("crear_cuenta", args);
          expect(r).toMatchObject({ ok: true, cuenta: { nombre: "Cuenta nueva", rol: "propietario" }, sucursal: { nombre: "Matriz" },
                                    admin: { nombre: "Admin nuevo", rol: "admin" } });
          await p.query("reset role");
          const uno = async (q, ...v) => (await p.query(q, v)).rows;
          expect(await uno("select estado, activada_en is not null activada, creada_por from public.cuentas where id = $1", r.cuenta.id))
            .toEqual([{ estado: "activa", activada: true, creada_por: A.ajena }]);
          expect(await uno("select auth_user_id, rol from public.membresias where cuenta_id = $1", r.cuenta.id))
            .toEqual([{ auth_user_id: A.ajena, rol: "propietario" }]);
          // en la misma transacción: la cuenta y la membresía las escribió la misma
          expect(await uno(`select (select xmin::text from public.cuentas where id = $1) = (select xmin::text from public.membresias
            where cuenta_id = $1) misma`, r.cuenta.id)).toEqual([{ misma: true }]);
          // su sucursal con el catálogo inicial, en su cuenta, y su administrador
          expect(await uno(`select s.cuenta_id, (select count(*)::int from public.carnes where sucursal_id = s.id) carnes,
              (select count(*)::int from public.bebidas where sucursal_id = s.id) bebidas,
              (select count(*)::int from public.mesas where sucursal_id = s.id) mesas,
              (select (precios->>'taco-pastor')::int from public.config where sucursal_id = s.id) taco,
              (select array_agg(rol) from public.usuarios where sucursal_id = s.id) roles
            from public.sucursales s where s.id = $1`, r.sucursal.id))
            .toEqual([{ cuenta_id: r.cuenta.id, carnes: 4, bebidas: 7, mesas: 8, taco: 20, roles: ["admin"] }]);
          expect({ A: await huellaDe(p, A), B: await huellaDe(p, B) }).toEqual(antes);
        } finally { await p.query("rollback"); }
        // con datos que no sirven (aquí, un PIN trivial) no se crea nada
        const debil = await intentar(p, "crear_cuenta", { ...args, p_admin_pin: "123456" });
        expect(debil.ok).toEqual({ ok: false, error: "debil" });
        expect((await sql.query("select count(*)::int n from public.cuentas where nombre = 'Cuenta nueva'")).rows[0].n).toBe(0);
      },
    },
    "aceptar_invitacion(text)": {
      "una invitación de otra cuenta, vencida, ya usada o para otro correo no da acceso": async () => {
        const fn = "aceptar_invitacion", args = { p_clave: A.invitacion.token };
        const inv = (c, cambio) => c.query(`update public.invitaciones set ${cambio} where id = $1`, [A.invitacion.id]);
        const rechazos = [
          await intentar(B.con.invitado, fn, args),                                                // para otro correo
          await intentar(A.con.invitado, fn, args, (c) => inv(c, "vence = now() - interval '1 second'")),
          await intentar(A.con.invitado, fn, args, (c) => inv(c, "usada_en = now()")),
          await intentar(A.con.invitado, fn, { p_clave: "f".repeat(64) }),                         // inexistente
        ];
        for (const x of rechazos) expect({ error: x.error, hint: x.hint }).toEqual({ error: "INVITACION", hint: rechazos[0].hint });
        // la de B da acceso a B y a nada de A
        const p = B.con.invitado;
        await p.query("begin");
        try {
          expect(await p.rpc(fn, { p_clave: B.invitacion.token })).toMatchObject({ ok: true, cuenta: { id: B.cuenta, rol: "encargado" } });
          expect((await p.rpc("listar_miembros", { p_cuenta: B.cuenta })).ok).toBe(true);
          expect((await falla(p.rpc("listar_miembros", { p_cuenta: A.cuenta }))).message).toBe("CUENTA");
        } finally { await p.query("rollback"); }
      },
      "la primera invitación de propietario activa la cuenta pendiente; una de encargado no puede ser la primera": async () => {
        const p = A.con.invitado;
        await p.query("begin");
        try {
          // una cuenta pendiente (como la de la migración) con la invitación inicial del proveedor y, hecha a mano,
          // una de encargado (la app no puede: invitar_miembro exige una cuenta activa)
          await p.query("reset role");
          const cuenta = (await p.query("insert into public.cuentas (nombre) values ('Pendiente (prueba)') returning id")).rows[0].id;
          const inicial = (await p.query("select public.crear_invitacion_inicial($1, $2) t", [cuenta, A.correoInvitado])).rows[0].t;
          await p.query(`insert into public.invitaciones (cuenta_id, correo, rol, token_hash, vence)
            values ($1, $2, 'encargado', public._hash_secreto('invitacion', 'encargado-primero'), now() + interval '1 day')`, [cuenta, A.correoInvitado]);
          await p.query("set role authenticated");
          await p.query("savepoint s");
          expect((await falla(p.rpc("aceptar_invitacion", { p_clave: "encargado-primero" }))).message).toBe("INVITACION");
          await p.query("rollback to savepoint s");
          expect((await falla(p.rpc("generar_codigo", { p_cuenta: cuenta, p_sucursal: A.id }))).message).toBe("CUENTA");
          await p.query("rollback to savepoint s");
          expect(await p.rpc("aceptar_invitacion", { p_clave: inicial })).toEqual({ ok: true, cuenta: { id: cuenta, nombre: "Pendiente (prueba)", rol: "propietario" } });
          await p.query("reset role");
          expect((await p.query("select estado, activada_en is not null activada from public.cuentas where id = $1", [cuenta])).rows)
            .toEqual([{ estado: "activa", activada: true }]);
          await p.query("set constraints all immediate");   // el invariante de propietario se cumple
          expect((await p.query("select count(*)::int n from public.invitaciones where id <> $1 and cuenta_id = $2 and usada_en is not null",
            [A.invitacion.id, cuenta])).rows[0].n).toBe(1);
        } finally { await p.query("rollback"); }
      },
    },
    "mis_cuentas()": {
      "solo lista las cuentas de las que es miembro": async () => {
        const r = await A.con.encargado.rpc("mis_cuentas");
        expect(r.correo).toBe(A.correoMiembro);
        expect(r.cuentas).toEqual([{ id: A.cuenta, nombre: A.nombreCuenta, estado: "activa", rol: "encargado",
                                     sucursales: [{ id: A.id, nombre: A.sem.sucursal.nombre, activa: true }] }]);
        expect((await A.con.ajena.rpc("mis_cuentas")).cuentas).toEqual([]);
        expect((await B.con.propietario.rpc("mis_cuentas")).cuentas.map((c) => c.id)).toEqual([B.cuenta]);
      },
    },
    "crear_sucursal(uuid, text, text, text, text)": {
      "solo un propietario; la sucursal queda en su cuenta": async () => {
        const args = RECETAS["crear_sucursal(uuid, text, text, text, text)"].args(A);
        expect((await intentar(A.con.encargado, "crear_sucursal", args)).error).toBe("PERMISO");
        const res = sinError(await intentar(A.con.propietario, "crear_sucursal", args, null, async (c, ok) => ({
          fila: (await c.query(`select s.cuenta_id, (select count(*)::int from public.carnes where sucursal_id = s.id) carnes,
              (select array_agg(rol) from public.usuarios where sucursal_id = s.id) roles,
              (select array_agg(accion) from public.bitacora where sucursal_id = s.id) bitacora
            from public.sucursales s where s.id = $1`, [ok.sucursal.id])).rows[0],
        })));
        expect(res.extra.fila).toEqual({ cuenta_id: A.cuenta, carnes: 4, roles: ["admin"], bitacora: ["crear_sucursal"] });
        expect(res.huellaB).toEqual(await huellaDe(sql, B));
      },
    },
    "crear_administrador(uuid, uuid, text, text)": {
      "solo un propietario; el administrador queda en esa sucursal": async () => {
        const args = RECETAS["crear_administrador(uuid, uuid, text, text)"].args(A);
        expect((await intentar(A.con.encargado, "crear_administrador", args)).error).toBe("PERMISO");
        const res = sinError(await intentar(A.con.propietario, "crear_administrador", args, null, async (c, ok) => ({
          fila: (await c.query("select sucursal_id, rol, politica_pin from public.usuarios where id = $1", [ok.admin.id])).rows[0],
        })));
        expect(res.extra.fila).toEqual({ sucursal_id: A.id, rol: "admin", politica_pin: 1 });
        expect((await intentar(A.con.propietario, "crear_administrador", { ...args, p_pin: "111111" })).ok).toEqual({ ok: false, error: "debil" });
      },
    },
    "invitar_miembro(uuid, text, text)": {
      "solo un propietario; la invitación queda en su cuenta": async () => {
        const args = RECETAS["invitar_miembro(uuid, text, text)"].args(A);
        expect((await intentar(A.con.encargado, "invitar_miembro", args)).error).toBe("PERMISO");
        const res = sinError(await intentar(A.con.propietario, "invitar_miembro", args, null, async (c, ok) => ({
          fila: (await c.query(`select cuenta_id, correo, rol, token_hash = public._hash_secreto('invitacion', $2) hash,
              (select count(*)::int from public.invitaciones x where to_jsonb(x)::text like '%' || $2 || '%') en_claro,
              (select count(*)::int from public.bitacora b where b.detalle::text like '%' || $2 || '%') en_bitacora
            from public.invitaciones where id = $1`, [ok.invitacion.id, ok.token])).rows[0],
        })));
        expect(res.extra.fila).toEqual({ cuenta_id: A.cuenta, correo: args.p_correo, rol: "encargado", hash: true, en_claro: 0, en_bitacora: 0 });
        // un miembro no se invita otra vez
        expect((await intentar(A.con.propietario, "invitar_miembro", { ...args, p_correo: A.correoMiembro.toUpperCase() })).ok)
          .toEqual({ ok: false, error: "ya_miembro" });
      },
    },
    "cancelar_invitacion(uuid, uuid)": {
      "solo un propietario; una invitación cancelada ya no da acceso": async () => {
        const args = { p_cuenta: A.cuenta, p_invitacion: A.invitacion.id };
        expect((await intentar(A.con.encargado, "cancelar_invitacion", args)).error).toBe("PERMISO");
        const c = A.con.invitado;
        await c.query("begin");
        try {
          await comoEquipo(c, A.duenos.propietario.authUid, { anonima: false });
          expect(await c.rpc("cancelar_invitacion", args)).toEqual({ ok: true });
          expect(await c.rpc("cancelar_invitacion", args)).toEqual({ ok: false, error: "no_existe" });
          await comoEquipo(c, A.invitado, { anonima: false });
          expect((await falla(c.rpc("aceptar_invitacion", { p_clave: A.invitacion.token }))).message).toBe("INVITACION");
        } finally { await c.query("rollback"); }
      },
    },
    "quitar_miembro(uuid, uuid)": {
      "no deja una cuenta activa sin propietario, ni con dos bajas simultáneas": async () => {
        // A tiene una sola propietaria: no puede quitarse
        expect((await intentar(A.con.propietario, "quitar_miembro", { p_cuenta: A.cuenta, p_miembro: A.duenos.propietario.authUid })).ok)
          .toEqual({ ok: false, error: "ultimo_propietario" });
        expect((await intentar(A.con.encargado, "quitar_miembro", { p_cuenta: A.cuenta, p_miembro: A.duenos.propietario.authUid })).error)
          .toBe("PERMISO");
        // una cuenta aparte con dos propietarias que se quitan la una a la otra al mismo tiempo
        const [p1, p2] = [await crearPersona(sql, "doble-1@ejemplo.invalid"), await crearPersona(sql, "doble-2@ejemplo.invalid")];
        const [c1, c2] = [await conectarComo(BASE, p1, "203.0.113.41", { persona: true }), await conectarComo(BASE, p2, "203.0.113.42", { persona: true })];
        const cuenta = (await c1.rpc("crear_cuenta", { p_nombre: "Dos propietarias", p_sucursal: null, p_zona_horaria: null,
                                                       p_admin_nombre: "Admin", p_admin_pin: "583920" })).cuenta.id;
        const inv = await c1.rpc("invitar_miembro", { p_cuenta: cuenta, p_correo: "doble-2@ejemplo.invalid", p_rol: "propietario" });
        expect((await c2.rpc("aceptar_invitacion", { p_clave: inv.token })).cuenta.rol).toBe("propietario");
        const pid2 = await pidDe(c2);
        await c1.query("begin");
        await c2.query("begin");
        expect(await c1.rpc("quitar_miembro", { p_cuenta: cuenta, p_miembro: p2 })).toEqual({ ok: true, propio: false });
        const segunda = c2.rpc("quitar_miembro", { p_cuenta: cuenta, p_miembro: p1 }).then((ok) => ({ ok }), (e) => ({ error: e.message }));
        expect(await esperaCandado(sql, pid2)).toBe(true);   // la segunda espera a la fila de la cuenta
        await c1.query("commit");
        expect(await segunda).toEqual({ error: "CUENTA" });   // al despertar ya no es miembro
        await c2.query("rollback");
        expect((await sql.query("select array_agg(auth_user_id) p from public.membresias where cuenta_id = $1 and rol = 'propietario'",
          [cuenta])).rows[0].p).toEqual([p1]);
      },
    },
    "listar_miembros(uuid)": {
      "solo lista los miembros e invitaciones de su cuenta": async () => {
        const r = await A.con.encargado.rpc("listar_miembros", { p_cuenta: A.cuenta });
        expect(r.miembros.map((m) => [m.correo, m.rol, m.yo])).toEqual([
          [A.duenos.propietario.correo, "propietario", false], [A.correoMiembro, "encargado", true]]);
        expect(r.invitaciones.map((i) => [i.correo, i.rol])).toEqual([[A.correoInvitado, "encargado"]]);
        expect(JSON.stringify(r)).not.toMatch(/pilotob|\.b@/);
      },
    },
    "generar_codigo(uuid, uuid, boolean)": {
      "solo propietarios o encargados de la cuenta de esa sucursal": async () => {
        const args = { p_cuenta: A.cuenta, p_sucursal: A.id, p_monitor: true };
        for (const quien of ["propietario", "encargado"]) {
          const res = sinError(await intentar(A.con[quien], "generar_codigo", args, null, async (c, ok) => ({
            fila: (await c.query(`select sucursal_id, monitor_cocina, creado_por, round(extract(epoch from vence - creado))::int segundos,
                (select count(*)::int from public.codigos_vinculacion x where to_jsonb(x)::text like '%' || $2 || '%') en_claro
              from public.codigos_vinculacion where codigo_hash = public._hash_secreto('codigo', $1)`, [ok.codigo, ok.codigo])).rows[0],
          })));
          expect(res.ok.codigo).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
          expect(res.extra.fila).toEqual({ sucursal_id: A.id, monitor_cocina: true, creado_por: quien === "propietario" ? A.duenos.propietario.authUid : A.encargado,
                                           segundos: 600, en_claro: 0 });
        }
        // la propietaria de B no genera códigos para la sucursal de A, ni nombrando su propia cuenta ni la de A
        expect((await intentar(B.con.propietario, "generar_codigo", { ...args, p_cuenta: B.cuenta })).ok).toEqual({ ok: false, error: "no_existe" });
        expect((await intentar(B.con.propietario, "generar_codigo", args)).error).toBe("CUENTA");
      },
      "una cuenta pendiente de activación no genera códigos": async () => {
        const pendiente = (c) => c.query("update public.cuentas set estado = 'pendiente_activacion', activada_en = null where id = $1", [A.cuenta]);
        expect((await intentar(A.con.propietario, "generar_codigo", { p_cuenta: A.cuenta, p_sucursal: A.id }, pendiente)).error).toBe("CUENTA");
        // y los que ya tenía no vinculan
        expect((await intentar(A.con.anonimo, "vincular_dispositivo", { p_codigo: A.codigo, p_nombre: "x" }, pendiente)).ok)
          .toMatchObject({ ok: false, error: "codigo" });
      },
    },
    "listar_dispositivos(uuid, uuid)": {
      "solo lista los equipos de las sucursales de su cuenta": async () => {
        for (const p_sucursal of [null, A.id]) {
          const r = await A.con.encargado.rpc("listar_dispositivos", { p_cuenta: A.cuenta, p_sucursal });
          expect(r.dispositivos.map((x) => x.id).sort()).toEqual([A.equipoId.caja, A.equipoId.cocina].sort());
          expect(r.dispositivos.every((x) => x.sucursal.id === A.id)).toBe(true);
        }
        const deB = await B.con.propietario.rpc("listar_dispositivos", { p_cuenta: B.cuenta });
        expect(deB.dispositivos.map((x) => x.id).sort()).toEqual([B.equipoId.caja, B.equipoId.cocina].sort());
      },
    },
    "revocar_dispositivo(uuid, uuid)": {
      "el equipo revocado ya no puede escuchar el canal de su sucursal desde la revocación": async () => {
        // como el servidor de Realtime: con realtime.topic() en el canal, lee realtime.messages como el equipo
        const c = A.con.caja, topic = "sucursal:" + A.id;
        const escucha = async () => {
          await c.query("select set_config('realtime.topic', $1, true)", [topic]);
          return (await c.query("select count(*)::int n from realtime.messages where topic = $1", [topic])).rows[0].n > 0;
        };
        await c.query("begin");
        try {
          expect(await escucha()).toBe(true);
          await comoEquipo(c, A.duenos.propietario.authUid, { anonima: false });
          expect((await c.rpc("revocar_dispositivo", { p_cuenta: A.cuenta, p_dispositivo: A.equipoId.caja })).ok).toBe(true);
          await comoEquipo(c, A.sem.equipos.caja.authUid);
          expect(await escucha()).toBe(false);
          await comoEquipo(c, A.sem.equipos.cocina.authUid);
          expect(await escucha()).toBe(true);   // el otro equipo de A sigue escuchando
        } finally { await c.query("rollback"); }
      },
      "el equipo revocado pierde el acceso a los datos de inmediato": async () => {
        // en una sola transacción: la propietaria revoca la caja y, enseguida, la caja ya no puede nada
        const c = A.con.caja;
        await c.query("begin");
        try {
          await comoEquipo(c, A.duenos.propietario.authUid, { anonima: false });
          expect(await c.rpc("revocar_dispositivo", { p_cuenta: A.cuenta, p_dispositivo: A.equipoId.caja })).toEqual({ ok: true, yaRevocado: false });
          expect(await c.rpc("revocar_dispositivo", { p_cuenta: A.cuenta, p_dispositivo: A.equipoId.caja })).toEqual({ ok: true, yaRevocado: true });
          await comoEquipo(c, A.sem.equipos.cocina.authUid);
          expect(await c.rpc("latido_cocina", { p_token: A.tok.cocinero })).toBe(true);   // el monitor sigue
          await comoEquipo(c, A.sem.equipos.caja.authUid);
          for (const [fn, args] of [["estado", { p_token: A.tok.mesero }], ["usuarios_login", {}],
                                    ["login", { p_id: A.per.mesero.id, p_pin: A.per.mesero.pin }]]) {
            await c.query("savepoint s");
            expect([fn, (await falla(c.rpc(fn, args))).message]).toEqual([fn, "DISPOSITIVO"]);
            await c.query("rollback to savepoint s");
          }
          await c.query("reset role");
          const s = (await c.query(`select count(*) filter (where not revocada)::int vivas,
              count(*) filter (where motivo_fin = 'equipo_revocado')::int revocadas from public.sesiones where dispositivo_id = $1`,
            [A.equipoId.caja])).rows[0];
          expect(s.vivas).toBe(0);
          expect(s.revocadas).toBeGreaterThanOrEqual(2);   // la del administrador y la del mesero
        } finally { await c.query("rollback"); }
      },
    },
    "fijar_negocio(text, text, text)": {
      "el nombre y la zona horaria solo cambian en su sucursal": async () => {
        const antesB = await huellaDe(sql, B);
        const res = sinError(await intentar(A.con.caja, "fijar_negocio", { p_token: A.tok.admin, p_nombre: "Nombre nuevo", p_zona_horaria: "America/Tijuana" },
          null, async (c) => (await c.query("select (select nombre_negocio from public.config where sucursal_id = $1) n, (select zona_horaria from public.sucursales where id = $1) z",
            [A.id])).rows[0]));
        expect(res.extra).toEqual({ n: "Nombre nuevo", z: "America/Tijuana" });
        expect(res.huellaB).toEqual(antesB);
      },
    },
    "fijar_mesas(text, integer)": {
      "solo cambia las mesas de su sucursal": async () => {
        // A baja a 7 y sube a 12; B conserva sus 5 mesas, incluida la 3 ocupada
        const antesB = await huellaDe(sql, B);
        for (const n of [7, 12]) {
          const res = sinError(await intentar(A.con.caja, "fijar_mesas", { p_token: A.tok.admin, p_cantidad: n }, null,
            async (c) => (await c.query("select sucursal_id, count(*) filter (where activa)::int activas from public.mesas group by 1 order by 1")).rows));
          expect(res.ok).toEqual({ ok: true, mesas: n });
          expect(res.extra.find((x) => x.sucursal_id === A.id).activas).toBe(n);
          expect(res.extra.find((x) => x.sucursal_id === B.id).activas).toBe(B.mesas);
          expect(res.huellaB).toEqual(antesB);
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
          sinError(await intentar(conDe(r, X), nombreDe(firma), argsDe(r, X)));
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
