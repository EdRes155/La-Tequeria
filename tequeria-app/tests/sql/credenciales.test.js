// Credenciales del personal bajo concurrencia y PIN pendiente de renovación (MODELO.md §5 y §6).
// Las carreras se reproducen con dos conexiones: una deja abierta su transacción a mitad del cambio (o
// del quinto fallo) y la otra intenta entrar; la prueba comprueba que la segunda espera y ve el resultado.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { URL_ADMIN, ESQUEMA, STUB, crearBase, conectar, cerrarTodo, falla } from "./util.js";

const d = URL_ADMIN ? describe : describe.skip;
const BASE = "tq_credenciales";
const PIN_ANA = "864213";

d("credenciales: PIN pendiente de renovación y carreras", () => {
  let sql, caja, tablet, ana, n = 0;
  const login = (c, id, pin) => c.rpc("login", { p_id: id, p_pin: pin });
  const token = async (c, id, pin) => {
    const r = await login(c, id, pin);
    if (!r.ok) throw new Error("login falló: " + JSON.stringify(r));
    return r.token;
  };
  const nuevo = async (rol, pin) => {
    const t = await token(caja, ana, PIN_ANA);
    const r = await caja.rpc("crear_usuario", { p_token: t, p_admin_pin: PIN_ANA, p_nombre: `${rol} ${++n}`, p_pin: pin, p_rol: rol });
    if (!r.ok) throw new Error("crear_usuario falló: " + JSON.stringify(r));
    return r.usuario.id;
  };
  // como queda tras la migración: PIN heredado de 4 dígitos
  const heredado = (id, pin) => sql.query(
    "update public.usuarios set pin_hash = public._hash_pin($2), politica_pin = 0, debe_cambiar_pin = false where id = $1", [id, pin]);
  const pidDe = async (c) => (await c.query("select pg_backend_pid() p")).rows[0].p;
  // ¿La conexión quedó esperando un candado? (hasta 5 s)
  const esperaCandado = async (pid) => {
    for (let i = 0; i < 100; i++) {
      const { rows } = await sql.query("select wait_event_type from pg_stat_activity where pid = $1", [pid]);
      if (rows[0]?.wait_event_type === "Lock") return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  // Deja `a` a mitad de su transacción, lanza `b` (que debe esperar), confirma `a` y devuelve lo de `b`
  async function carrera(a, primero, b, segundo) {
    const pid = await pidDe(b.con);
    await a.con.query("begin");
    try {
      const r1 = await a.con.rpc(...primero);
      const p2 = b.con.rpc(...segundo).then((x) => ({ ok: x }), (e) => ({ error: e.message }));
      const espero = await esperaCandado(pid);
      await a.con.query("commit");
      return { r1, r2: await p2, espero };
    } catch (e) {
      await a.con.query("rollback").catch(() => {});
      throw e;
    }
  }

  beforeAll(async () => {
    sql = await crearBase(BASE, [STUB, ESQUEMA]);
    ana = (await sql.query(`select public.crear_admin_inicial('Ana Prueba', '${PIN_ANA}') id`)).rows[0].id;
    caja = await conectar(BASE, true, "203.0.113.20", "caja");
    tablet = await conectar(BASE, true, "203.0.113.21", "tablet");
  });
  afterAll(cerrarTodo);

  // --- 1. PIN pendiente de renovación ----------------------------------------------------------------------
  it("con el PIN pendiente de renovación la sesión solo sirve para cambiarlo, desbloquear o salir", async () => {
    const id = await nuevo("admin", "517384");
    await heredado(id, "4821");
    const r = await login(caja, id, "4821");
    expect(r).toMatchObject({ ok: true, debeCambiarPin: true });
    // todas las funciones con sesión, incluidas las de lectura, salvo cambiar el PIN, desbloquear y salir
    const { rows } = await sql.query(`select p.proname, coalesce(p.proargnames, '{}') nombres, p.pronargs, p.pronargdefaults
      from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')
       and 'p_token' = any (coalesce(p.proargnames, '{}')) and p.proname not in ('cambiar_pin', 'desbloquear', 'logout') order by 1`);
    expect(rows.length).toBeGreaterThan(30);
    const resultados = {};
    for (const f of rows) {
      const nombres = f.nombres.slice(0, f.pronargs - f.pronargdefaults);
      const args = nombres.map((x, i) => x + " => $" + (i + 1)).join(", ");
      resultados[f.proname] = (await falla(caja.query("select public." + f.proname + "(" + args + ")",
        nombres.map((x) => (x === "p_token" ? r.token : null))))).message;
    }
    for (const [fn, m] of Object.entries(resultados)) expect([fn, m]).toEqual([fn, "CAMBIAR_PIN"]);
    // desbloquear sí (con el PIN heredado), y sigue sin poder hacer nada más
    expect(await caja.rpc("desbloquear", { p_token: r.token, p_pin: "4821" })).toEqual({ ok: true });
    expect((await falla(caja.rpc("estado", { p_token: r.token }))).message).toBe("CAMBIAR_PIN");
    // al cambiarlo, todo vuelve
    expect((await caja.rpc("cambiar_pin", { p_token: r.token, p_pin_actual: "4821", p_pin_nuevo: "604917" })).ok).toBe(true);
    expect((await caja.rpc("estado", { p_token: r.token })).usuarios.length).toBeGreaterThan(0);
  });

  it("un PIN puesto por un administrador también queda pendiente hasta que la persona elige el suyo", async () => {
    const id = await nuevo("mesero", "517384");
    const t = await token(caja, ana, PIN_ANA);
    expect((await caja.rpc("restablecer_pin", { p_token: t, p_admin_pin: PIN_ANA, p_id: id, p_pin_nuevo: "640217" })).ok).toBe(true);
    const r = await login(tablet, id, "640217");
    expect(r).toMatchObject({ ok: true, debeCambiarPin: true });
    expect((await falla(tablet.rpc("estado", { p_token: r.token, p_partes: ["mesas"] }))).message).toBe("CAMBIAR_PIN");
    expect((await falla(tablet.rpc("latido_cocina", { p_token: r.token }))).message).toBe("CAMBIAR_PIN");
    expect((await tablet.rpc("cambiar_pin", { p_token: r.token, p_pin_actual: "640217", p_pin_nuevo: "580317" })).ok).toBe(true);
    expect((await tablet.rpc("estado", { p_token: r.token, p_partes: ["mesas"] })).mesas).toHaveLength(8);
  });

  it("un PIN de administrador pendiente de renovación no autoriza operaciones administrativas", async () => {
    const admin = await nuevo("admin", "517384");
    await heredado(admin, "4821");
    const otro = await nuevo("admin", "739154");
    const tOtro = await token(caja, ana, PIN_ANA);
    expect((await caja.rpc("restablecer_pin", { p_token: tOtro, p_admin_pin: PIN_ANA, p_id: otro, p_pin_nuevo: "640217" })).ok).toBe(true);
    const mesero = await token(caja, await nuevo("mesero", "580317"), "580317");
    await caja.rpc("enviar_comanda", { p_token: mesero, p_ticket: { id: "credenciales-0001", tipo: "llevar", ordenes: [{ id: "o1", items: [{ key: "taco-pastor", cantidad: 1 }] }] } });
    const noCobrar = (pin) => caja.rpc("no_cobrar", { p_token: mesero, p_admin_pin: pin, p_tickets: ["credenciales-0001"], p_motivo: "Prueba" });
    expect(await noCobrar("4821")).toEqual({ ok: false, error: "pin_vencido" });     // heredado
    expect(await noCobrar("640217")).toEqual({ ok: false, error: "pin_vencido" });   // puesto por otro administrador
    const { rows } = await sql.query("select estado_cobro from public.tickets where id = 'credenciales-0001'");
    expect(rows[0].estado_cobro).toBe("pendiente");
    // con un PIN vigente sí
    expect((await noCobrar(PIN_ANA)).ok).toBe(true);
  });

  // --- 2. Sesiones con el PIN anterior ----------------------------------------------------------------------
  it("un inicio de sesión con el PIN anterior no sobrevive a un cambio de PIN, en ningún orden", async () => {
    const id = await nuevo("mesero", "517384");
    const t = await token(caja, id, "517384");
    const otraCaja = await conectar(BASE, true, "203.0.113.20", "caja");
    // a) el cambio va primero: el inicio con el PIN anterior espera y luego ya no entra
    const a = await carrera({ con: caja }, ["cambiar_pin", { p_token: t, p_pin_actual: "517384", p_pin_nuevo: "580317" }],
                           { con: tablet }, ["login", { p_id: id, p_pin: "517384" }]);
    expect(a.r1.ok).toBe(true);
    expect(a.espero).toBe(true);
    expect(a.r2.ok).toMatchObject({ ok: false, error: "pin" });
    // b) el inicio con el PIN anterior va primero: la sesión que abre deja de servir al confirmarse el cambio
    const b = await carrera({ con: tablet }, ["login", { p_id: id, p_pin: "580317" }],
                           { con: otraCaja }, ["cambiar_pin", { p_token: t, p_pin_actual: "580317", p_pin_nuevo: "604917" }]);
    expect(b.r1.ok).toBe(true);
    expect(b.espero).toBe(true);
    expect(b.r2.ok).toEqual({ ok: true });
    expect((await falla(tablet.rpc("estado", { p_token: b.r1.token, p_partes: ["mesas"] }))).message).toBe("SESION");
    // la sesión que hizo el cambio sigue funcionando
    expect((await caja.rpc("estado", { p_token: t, p_partes: ["mesas"] })).mesas).toHaveLength(8);
  });

  it("tampoco sobrevive a un restablecimiento de PIN, en ningún orden", async () => {
    const id = await nuevo("mesero", "517384");
    const admin = await token(caja, ana, PIN_ANA);
    const a = await carrera({ con: caja }, ["restablecer_pin", { p_token: admin, p_admin_pin: PIN_ANA, p_id: id, p_pin_nuevo: "640217" }],
                           { con: tablet }, ["login", { p_id: id, p_pin: "517384" }]);
    expect(a.r1.ok).toBe(true);
    expect(a.espero).toBe(true);
    expect(a.r2.ok).toMatchObject({ ok: false, error: "pin" });
    const b = await carrera({ con: tablet }, ["login", { p_id: id, p_pin: "640217" }],
                           { con: caja }, ["restablecer_pin", { p_token: admin, p_admin_pin: PIN_ANA, p_id: id, p_pin_nuevo: "739154" }]);
    expect(b.r1.ok).toBe(true);
    expect(b.espero).toBe(true);
    expect(b.r2.ok).toEqual({ ok: true });
    expect((await falla(tablet.rpc("desbloquear", { p_token: b.r1.token, p_pin: "640217" }))).message).toBe("SESION");
  });

  it("cada operación comprueba la versión de la credencial con la que se abrió la sesión", async () => {
    const id = await nuevo("mesero", "517384");
    const t = await token(caja, id, "517384");
    expect((await caja.rpc("estado", { p_token: t, p_partes: ["mesas"] })).mesas).toHaveLength(8);
    // una credencial que cambia sin revocar la sesión (lo que dejaba pasar la carrera) la invalida igual
    await sql.query("update public.usuarios set version_pin = version_pin + 1 where id = $1", [id]);
    expect((await falla(caja.rpc("estado", { p_token: t, p_partes: ["mesas"] }))).message).toBe("SESION");
  });

  // --- 3. Un acierto concurrente no borra un bloqueo recién generado ----------------------------------------
  it("un acierto que llega con el quinto fallo en curso no borra el bloqueo (inicio de sesión)", async () => {
    const id = await nuevo("mesero", "517384");
    for (let i = 0; i < 4; i++) expect((await login(i % 2 ? caja : tablet, id, "000000")).error).toBe("pin");
    const r = await carrera({ con: tablet }, ["login", { p_id: id, p_pin: "000000" }], { con: caja }, ["login", { p_id: id, p_pin: "517384" }]);
    expect(r.r1).toMatchObject({ error: "pin", restantes: 0 });
    expect(r.espero).toBe(true);
    expect(r.r2.ok).toMatchObject({ ok: false, error: "bloqueado", motivo: "operador", espera: 900 });
    expect(await login(caja, id, "517384")).toMatchObject({ error: "bloqueado", motivo: "operador" });
  });

  it("tampoco al desbloquear ni al cambiar el PIN", async () => {
    for (const [fn, args] of [["desbloquear", (pin) => ({ p_pin: pin })],
                              ["cambiar_pin", (pin) => ({ p_pin_actual: pin, p_pin_nuevo: "604917" })]]) {
      const id = await nuevo("mesero", "517384");
      const t = await token(caja, id, "517384");
      const otraCaja = await conectar(BASE, true, "203.0.113.20", "caja");
      for (let i = 0; i < 4; i++) expect([fn, (await caja.rpc(fn, { p_token: t, ...args("000000") })).error]).toEqual([fn, "pin"]);
      const r = await carrera({ con: caja }, [fn, { p_token: t, ...args("000000") }], { con: otraCaja }, [fn, { p_token: t, ...args("517384") }]);
      expect([fn, r.r1]).toEqual([fn, expect.objectContaining({ error: "pin", restantes: 0 })]);
      expect([fn, r.espero]).toEqual([fn, true]);
      expect([fn, r.r2.ok]).toEqual([fn, expect.objectContaining({ ok: false, error: "bloqueado" })]);
      expect([fn, await login(tablet, id, "517384")]).toEqual([fn, expect.objectContaining({ error: "bloqueado", motivo: "operador" })]);
    }
  });

  it("tampoco en la reautenticación administrativa", async () => {
    const t = await token(caja, ana, PIN_ANA);
    const otraCaja = await conectar(BASE, true, "203.0.113.20", "caja");
    for (let i = 0; i < 4; i++) expect((await caja.rpc("hacer_corte", { p_token: t, p_admin_pin: "000000" })).error).toBe("pin");
    const r = await carrera({ con: caja }, ["hacer_corte", { p_token: t, p_admin_pin: "000000" }],
                           { con: otraCaja }, ["hacer_corte", { p_token: t, p_admin_pin: PIN_ANA }]);
    expect(r.r1).toMatchObject({ error: "pin", restantes: 0 });
    expect(r.espero).toBe(true);
    expect(r.r2.ok).toMatchObject({ ok: false, error: "bloqueado", espera: 900 });
  });
});
