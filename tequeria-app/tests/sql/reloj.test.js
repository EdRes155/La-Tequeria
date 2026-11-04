// Política de seguridad del personal (PLAN-MULTINEGOCIO.md, «Mínimos de seguridad»; MODELO.md §5 y §6)
// con el reloj controlado: public._ahora() se reemplaza en la base de prueba y el tiempo se adelanta a
// mano, así que 15 minutos, 12 horas y la escalada 15/30/60 se comprueban sin esperarlos.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { URL_ADMIN, ESQUEMA, STUB, crearBase, conectar, conectarComo, vincularDePrueba, cerrarTodo, falla, relojControlado } from "./util.js";

const d = URL_ADMIN ? describe : describe.skip;
const BASE = "tq_reloj";
const PIN_ANA = "864213";

d("política de seguridad con reloj controlado", () => {
  let sql, reloj, caja, tablet, monitor, ana, n = 0;
  const login = (c, id, pin) => c.rpc("login", { p_id: id, p_pin: pin });
  const token = async (c, id, pin) => {
    const r = await login(c, id, pin);
    if (!r.ok) throw new Error("login falló: " + JSON.stringify(r));
    return r.token;
  };
  // Usuario nuevo de la sucursal (lo crea Ana en la caja)
  const nuevo = async (rol, pin) => {
    const t = await token(caja, ana, PIN_ANA);
    const r = await caja.rpc("crear_usuario", { p_token: t, p_admin_pin: PIN_ANA, p_nombre: `${rol} ${++n}`, p_pin: pin, p_rol: rol });
    if (!r.ok) throw new Error("crear_usuario falló: " + JSON.stringify(r));
    return r.usuario.id;
  };
  const venceDe = async (tk) => (await sql.query(
    "select vence_absoluta from public.sesiones where token_hash = encode(extensions.digest($1, 'sha256'), 'hex')", [tk])).rows[0].vence_absoluta;

  beforeAll(async () => {
    sql = await crearBase(BASE, [STUB, ESQUEMA]);
    ana = (await sql.query(`select public.crear_admin_inicial('Ana Prueba', '${PIN_ANA}') id`)).rows[0].id;
    reloj = await relojControlado(sql, new Date("2026-11-04T15:00:00Z"));
    caja = await conectar(BASE, true, "203.0.113.10", "caja");
    tablet = await conectar(BASE, true, "203.0.113.11", "tablet");
    monitor = await conectarComo(BASE, (await vincularDePrueba(sql, { nombre: "monitor", monitor: true })).authUid, "203.0.113.12");
    // varias pantallas de cocina a la vez: aquí no se prueba la exclusividad de la cocina
    const t = await token(caja, ana, PIN_ANA);
    await caja.rpc("fijar_ajuste", { p_token: t, p_clave: "variasCocinas", p_valor: "true" });
  });
  afterAll(cerrarTodo);

  it("el PIN nuevo tiene de 6 a 8 dígitos y no es trivial, en todas las funciones que lo fijan", async () => {
    const t = await token(caja, ana, PIN_ANA);
    const crear = (pin) => caja.rpc("crear_usuario", { p_token: t, p_admin_pin: PIN_ANA, p_nombre: "X", p_pin: pin, p_rol: "mesero" });
    for (const pin of ["12345", "123456789", "abcdef", ""]) expect([pin, (await crear(pin)).error]).toEqual([pin, "formato"]);
    for (const pin of ["123456", "654321", "890123", "777777", "121212", "123123", "12341234", "112233", "147258"]) {
      expect([pin, (await crear(pin)).error]).toEqual([pin, "debil"]);
    }
    expect((await crear("517384")).ok).toBe(true);     // 6 dígitos
    expect((await crear("62840715")).ok).toBe(true);   // 8 dígitos
    const id = (await crear("739154")).usuario.id;
    const rest = (pin) => caja.rpc("restablecer_pin", { p_token: t, p_admin_pin: PIN_ANA, p_id: id, p_pin_nuevo: pin });
    expect((await rest("12345")).error).toBe("formato");
    expect((await rest("111111")).error).toBe("debil");
    const propio = await token(tablet, id, "739154");
    const cambiar = (nuevoPin) => tablet.rpc("cambiar_pin", { p_token: propio, p_pin_actual: "739154", p_pin_nuevo: nuevoPin });
    expect((await cambiar("1234567")).error).toBe("debil");
    expect((await cambiar("98765")).error).toBe("formato");
    expect((await cambiar("246810")).error).toBe("debil");
    expect((await cambiar("580317")).ok).toBe(true);
    expect((await falla(sql.query("select public.crear_admin_inicial('Otra', '123456')"))).message).toMatch(/Ya existe|6 a 8/);
  });

  it("un PIN heredado solo sirve para entrar y elegir uno nuevo", async () => {
    const id = await nuevo("mesero", "517384");
    // como queda tras la migración: PIN de 4 dígitos de antes de la política
    await sql.query("update public.usuarios set pin_hash = public._hash_pin('4821'), politica_pin = 0, pin_cambiado_en = null where id = $1", [id]);
    const r = await login(caja, id, "4821");
    expect(r).toMatchObject({ ok: true, debeCambiarPin: true });
    expect((await falla(caja.rpc("liberar_mesa", { p_token: r.token, p_mesa_id: 1 }))).message).toBe("CAMBIAR_PIN");
    expect((await caja.rpc("cambiar_pin", { p_token: r.token, p_pin_actual: "4821", p_pin_nuevo: "4822" })).error).toBe("formato");
    expect((await caja.rpc("cambiar_pin", { p_token: r.token, p_pin_actual: "4821", p_pin_nuevo: "604917" })).ok).toBe(true);
    expect((await caja.rpc("liberar_mesa", { p_token: r.token, p_mesa_id: 1 })).estado).toBe("libre");
    const { rows } = await sql.query("select politica_pin, pin_cambiado_en is not null cambiado from public.usuarios where id = $1", [id]);
    expect(rows[0]).toEqual({ politica_pin: 1, cambiado: true });
    expect((await login(caja, id, "604917")).debeCambiarPin).toBe(false);
  });

  it("cinco fallos del mismo operador repartidos entre equipos lo bloquean, con escalada 15/30/60", async () => {
    const id = await nuevo("mesero", "517384");
    for (const c of [caja, caja, caja, tablet]) expect((await login(c, id, "000000")).error).toBe("pin");
    expect(await login(tablet, id, "000000")).toMatchObject({ error: "pin", restantes: 0 });
    // bloqueado en todos los equipos, incluso con el PIN correcto
    expect(await login(caja, id, "517384")).toMatchObject({ error: "bloqueado", motivo: "operador", espera: 900 });
    expect(await login(tablet, id, "517384")).toMatchObject({ error: "bloqueado", motivo: "operador" });
    // un intento rechazado durante el bloqueo no lo alarga ni sube la escalada
    await reloj.avanzar({ minutos: 14 });
    expect(await login(caja, id, "000000")).toMatchObject({ error: "bloqueado", espera: 60 });
    await reloj.avanzar({ minutos: 1, segundos: 1 });
    // segundo bloqueo: 30 minutos; tercero y siguientes: 60
    for (const [espera, avanza] of [[1800, 30], [3600, 60], [3600, 60]]) {
      for (let i = 0; i < 5; i++) await login(i % 2 ? caja : tablet, id, "000000");
      expect(await login(caja, id, "517384")).toMatchObject({ error: "bloqueado", espera });
      await reloj.avanzar({ minutos: avanza, segundos: 1 });
    }
    // entrar bien reinicia los fallos y la escalada
    expect((await login(caja, id, "517384")).ok).toBe(true);
    for (let i = 0; i < 5; i++) await login(tablet, id, "000000");
    expect(await login(caja, id, "517384")).toMatchObject({ error: "bloqueado", espera: 900 });
  });

  it("un administrador de la sucursal restablece el acceso con su PIN y queda en la bitácora", async () => {
    const id = await nuevo("mesero", "517384");
    const otro = await nuevo("mesero", "580317");
    for (let i = 0; i < 5; i++) await login(caja, id, "000000");
    expect((await login(caja, id, "517384")).error).toBe("bloqueado");
    const mesero = await token(caja, otro, "580317");
    const t = await token(caja, ana, PIN_ANA);
    expect((await falla(caja.rpc("restablecer_acceso", { p_token: mesero, p_admin_pin: PIN_ANA, p_id: id }))).message).toBe("PERMISO");
    expect((await caja.rpc("restablecer_acceso", { p_token: t, p_admin_pin: "000000", p_id: id })).error).toBe("pin");
    expect(await caja.rpc("restablecer_acceso", { p_token: t, p_admin_pin: PIN_ANA, p_id: id })).toEqual({ ok: true, estabaBloqueado: true });
    expect((await login(caja, id, "517384")).ok).toBe(true);
    const { rows } = await sql.query("select usuario_id, detalle->>'id' id from public.bitacora where accion = 'restablecer_acceso'");
    expect(rows).toEqual([{ usuario_id: ana, id }]);
  });

  it("treinta fallos en un equipo en 15 minutos bloquean sus accesos por PIN, sin cortar sesiones abiertas ni otros equipos", async () => {
    const equipo = await conectar(BASE, true, "198.51.100.30", "equipo-30");
    const id = await nuevo("mesero", "517384");
    for (let i = 0; i < 29; i++) {
      expect((await login(equipo, "nadie-" + i, "000000")).error).toBe("pin");
      await reloj.avanzar({ segundos: 20 });
    }
    // un acceso correcto de otro operador no reinicia la ventana del equipo
    const abierta = await token(equipo, id, "517384");
    expect((await login(equipo, "nadie-29", "000000")).error).toBe("pin");   // el fallo 30
    expect(await login(equipo, id, "517384")).toMatchObject({ error: "bloqueado", motivo: "equipo", espera: 900 });
    expect((await equipo.rpc("desbloquear", { p_token: abierta, p_pin: "517384" })).error).toBe("bloqueado");
    // la sesión ya abierta sigue trabajando; otro equipo no está bloqueado
    expect((await equipo.rpc("liberar_mesa", { p_token: abierta, p_mesa_id: 2 })).estado).toBe("libre");
    expect((await login(caja, id, "517384")).ok).toBe(true);
    // pasados 15 minutos desde el último fallo, el equipo vuelve a aceptar PIN
    await reloj.avanzar({ minutos: 15, segundos: 1 });
    expect((await login(equipo, id, "517384")).ok).toBe(true);
  });

  it("la sesión dura como máximo 12 horas, aunque haya actividad constante", async () => {
    const id = await nuevo("mesero", "517384");
    const t = await token(caja, id, "517384");
    const vence = await venceDe(t);
    for (let m = 10; m < 12 * 60; m += 10) {
      await reloj.avanzar({ minutos: 10 });
      await caja.rpc("liberar_mesa", { p_token: t, p_mesa_id: 1 });            // interacción
      await caja.rpc("estado", { p_token: t, p_partes: ["mesas"] });           // y lectura
    }
    expect(await venceDe(t)).toEqual(vence);
    await reloj.avanzar({ minutos: 9, segundos: 59 });                        // 11 h 59 min 59 s
    expect((await caja.rpc("estado", { p_token: t, p_partes: ["mesas"] })).yo.rol).toBe("mesero");
    await reloj.avanzar({ segundos: 2 });
    for (const [fn, args] of [["estado", { p_partes: ["mesas"] }], ["latido_cocina", {}], ["desbloquear", { p_pin: "517384" }],
                              ["liberar_mesa", { p_mesa_id: 1 }]]) {
      expect([fn, (await falla(caja.rpc(fn, { p_token: t, ...args }))).message]).toEqual([fn, "SESION"]);
    }
  });

  it("a los 15 minutos sin interacción se pide el PIN; lecturas, latidos y confirmaciones automáticas no lo evitan", async () => {
    const id = await nuevo("cocinero", "628417");
    const t = await token(tablet, id, "628417");
    const vence = await venceDe(t);
    for (const minutos of [5, 5, 4]) {   // 14 minutos de lecturas, latidos y confirmaciones automáticas
      await reloj.avanzar({ minutos });
      await tablet.rpc("estado", { p_token: t, p_partes: ["cocina"] });
      await tablet.rpc("latido_cocina", { p_token: t });
      await tablet.rpc("marcar_recibido", { p_token: t, p_ids: [] });
    }
    await reloj.avanzar({ minutos: 1 });   // 15 minutos sin interacción
    for (const [fn, args] of [["liberar_cocina", {}], ["estado", { p_partes: ["cocina"] }], ["marcar_recibido", { p_ids: ["x"] }],
                              ["cambiar_pin", { p_pin_actual: "628417", p_pin_nuevo: "580317" }]]) {
      expect([fn, (await falla(tablet.rpc(fn, { p_token: t, ...args }))).message]).toEqual([fn, "BLOQUEO_INACTIVIDAD"]);
    }
    expect(await tablet.rpc("latido_cocina", { p_token: t })).toBe(true);   // el latido sí sigue
    // el PIN de otro operador no desbloquea; el propio sí, y no reinicia las 12 horas
    expect(await tablet.rpc("desbloquear", { p_token: t, p_pin: PIN_ANA })).toMatchObject({ ok: false, error: "pin", restantes: 4 });
    expect(await tablet.rpc("desbloquear", { p_token: t, p_pin: "628417" })).toEqual({ ok: true });
    await tablet.rpc("liberar_cocina", { p_token: t });
    expect(await venceDe(t)).toEqual(vence);
    // cerrar sesión se permite aun bloqueada
    await reloj.avanzar({ minutos: 16 });
    await tablet.rpc("logout", { p_token: t });
    expect((await falla(tablet.rpc("latido_cocina", { p_token: t }))).message).toBe("SESION");
  });

  it("los fallos al desbloquear cuentan para el operador y el equipo", async () => {
    const id = await nuevo("mesero", "517384");
    const t = await token(tablet, id, "517384");
    const antes = (await sql.query("select count(*)::int n from public.intentos_dispositivo")).rows[0].n;
    await reloj.avanzar({ minutos: 16 });
    for (let i = 0; i < 5; i++) await tablet.rpc("desbloquear", { p_token: t, p_pin: "000000" });
    expect(await tablet.rpc("desbloquear", { p_token: t, p_pin: "517384" })).toMatchObject({ ok: false, error: "bloqueado" });
    expect(await login(caja, id, "517384")).toMatchObject({ error: "bloqueado", motivo: "operador" });
    expect((await sql.query("select count(*)::int n from public.intentos_dispositivo")).rows[0].n).toBe(antes + 5);
  });

  it("el monitor dedicado solo conserva la lectura de cocina tras la inactividad, y la pierde al vencer o al revocarlo", async () => {
    const id = await nuevo("cocinero", "628417");
    let t = await token(monitor, id, "628417");
    await reloj.avanzar({ minutos: 16 });
    const e = await monitor.rpc("estado", { p_token: t });
    expect(e.bloqueo).toBe("inactividad");
    expect(Object.keys(e).filter((k) => !["yo", "servidor", "bloqueo"].includes(k)).sort())
      .toEqual(["cocina", "extras", "mesas", "nombreNegocio", "ocultos", "ajustes", "precios"].sort());
    expect(Object.keys(await monitor.rpc("estado", { p_token: t, p_partes: ["historial", "cocina", "gastos"] })).sort())
      .toEqual(["bloqueo", "cocina", "servidor", "yo"]);
    expect(await monitor.rpc("latido_cocina", { p_token: t })).toBe(true);
    for (const [fn, args] of [["marcar_recibido", { p_ids: ["x"] }], ["marcar_hecho", { p_ticket: "x", p_linea: "o1|taco", p_hecho: true }],
                              ["liberar_cocina", {}]]) {
      expect([fn, (await falla(monitor.rpc(fn, { p_token: t, ...args }))).message]).toEqual([fn, "BLOQUEO_INACTIVIDAD"]);
    }
    // el mismo cocinero en un equipo que no es monitor no conserva la lectura
    const enTablet = await token(tablet, id, "628417");
    await reloj.avanzar({ minutos: 16 });
    expect((await falla(tablet.rpc("estado", { p_token: enTablet, p_partes: ["cocina"] }))).message).toBe("BLOQUEO_INACTIVIDAD");
    // al desbloquear vuelve todo
    expect((await monitor.rpc("desbloquear", { p_token: t, p_pin: "628417" })).ok).toBe(true);
    const completo = await monitor.rpc("estado", { p_token: t });
    expect(completo.bloqueo).toBeNull();
    expect(completo.historial).toBeDefined();
    // al vencer las 12 horas pierde también la lectura
    await reloj.avanzar({ horas: 12 });
    expect((await falla(monitor.rpc("estado", { p_token: t, p_partes: ["cocina"] }))).message).toBe("SESION");
    // y al revocar el equipo
    t = await token(monitor, id, "628417");
    await reloj.avanzar({ minutos: 16 });
    await sql.query("update public.dispositivos set revocado_en = now() where nombre = 'monitor'");
    try {
      expect((await falla(monitor.rpc("estado", { p_token: t, p_partes: ["cocina"] }))).message).toBe("DISPOSITIVO");
    } finally {
      await sql.query("update public.dispositivos set revocado_en = null where nombre = 'monitor'");
    }
  });

  it("la reautenticación administrativa tiene la misma escalada y sus fallos cuentan para el equipo", async () => {
    const t = await token(caja, ana, PIN_ANA);
    const antes = (await sql.query("select count(*)::int n from public.intentos_dispositivo")).rows[0].n;
    for (let i = 4; i >= 0; i--) {
      expect(await caja.rpc("hacer_corte", { p_token: t, p_admin_pin: "000000" })).toMatchObject({ error: "pin", restantes: i });
    }
    expect(await caja.rpc("hacer_corte", { p_token: t, p_admin_pin: PIN_ANA })).toMatchObject({ error: "bloqueado", espera: 900 });
    expect((await caja.rpc("crear_usuario", { p_token: t, p_admin_pin: PIN_ANA, p_nombre: "Y", p_pin: "517384", p_rol: "mesero" })).error)
      .toBe("bloqueado");
    expect((await sql.query("select count(*)::int n from public.intentos_dispositivo")).rows[0].n).toBe(antes + 5);
    // vencido el bloqueo, otros 5 fallos sin acertar en medio: 30 minutos
    await reloj.avanzar({ minutos: 15, segundos: 1 });
    expect((await caja.rpc("desbloquear", { p_token: t, p_pin: PIN_ANA })).ok).toBe(true);   // la sesión quedó inactiva
    for (let i = 0; i < 5; i++) await caja.rpc("hacer_corte", { p_token: t, p_admin_pin: "000000" });
    expect(await caja.rpc("hacer_corte", { p_token: t, p_admin_pin: PIN_ANA })).toMatchObject({ error: "bloqueado", espera: 1800 });
    // un acierto (ya vencido el bloqueo) reinicia los fallos y la escalada
    await reloj.avanzar({ minutos: 30, segundos: 1 });
    expect((await caja.rpc("desbloquear", { p_token: t, p_pin: PIN_ANA })).ok).toBe(true);
    expect((await caja.rpc("hacer_corte", { p_token: t, p_admin_pin: PIN_ANA })).error).not.toBe("bloqueado");
    for (let i = 0; i < 5; i++) await caja.rpc("hacer_corte", { p_token: t, p_admin_pin: "000000" });
    expect(await caja.rpc("hacer_corte", { p_token: t, p_admin_pin: PIN_ANA })).toMatchObject({ error: "bloqueado", espera: 900 });
  });
});
