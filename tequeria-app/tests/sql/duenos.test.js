// Dueños y dispositivos (MODELO.md §3, §3.0 y §4; multinegocio paso 4): el alta completa de un cliente,
// las reglas del código de vinculación (vence, un solo uso, límites de intentos), las identidades que no se
// mezclan, las invitaciones, el invariante de propietario bajo concurrencia y la revocación de un equipo.
// La matriz de aislamiento (aislamiento.test.js) prueba cada función contra la otra cuenta; aquí van los
// flujos y las carreras, con datos confirmados y un reloj controlado.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  URL_ADMIN, ESQUEMA, STUB, crearBase, conectarComo, cerrarTodo, falla, relojControlado,
  crearPersona, crearAnonimo, pidDe, esperaCandado,
} from "./util.js";

const d = URL_ADMIN ? describe : describe.skip;
const BASE = "tq_duenos";
const PIN = "583920";

d("dueños y dispositivos", () => {
  let sql, reloj, nIp = 0, nCorreo = 0;
  const ip = () => `198.51.100.${++nIp}`;
  const persona = async (correo = `persona-${++nCorreo}@ejemplo.invalid`, opciones) => {
    const uid = await crearPersona(sql, correo, opciones);
    return { uid, correo, con: await conectarComo(BASE, uid, ip(), { persona: true }) };
  };
  const anonimo = async (dir = ip()) => {
    const uid = await crearAnonimo(sql);
    return { uid, con: await conectarComo(BASE, uid, dir) };
  };
  // Una cuenta creada con la API por una persona nueva
  async function cuentaNueva(nombre = "Taquería de prueba") {
    const p = await persona();
    const r = await p.con.rpc("crear_cuenta", { p_nombre: nombre, p_sucursal: null, p_zona_horaria: null, p_admin_nombre: "Admin", p_admin_pin: PIN });
    if (!r.ok) throw new Error("crear_cuenta falló: " + JSON.stringify(r));
    return { p, cuenta: r.cuenta.id, sucursal: r.sucursal.id, admin: r.admin };
  }
  const codigo = async (dueno, cuenta, sucursal, monitor = false) => {
    const r = await dueno.con.rpc("generar_codigo", { p_cuenta: cuenta, p_sucursal: sucursal, p_monitor: monitor });
    if (!r.ok) throw new Error("generar_codigo falló: " + JSON.stringify(r));
    return r.codigo;
  };
  const vincular = (eq, cod, nombre = "Equipo") => eq.con.rpc("vincular_dispositivo", { p_codigo: cod, p_nombre: nombre });
  // Un segundo propietario, invitado y aceptado con la API
  async function otroPropietario(dueno, cuenta) {
    const q = await persona();
    const inv = await dueno.con.rpc("invitar_miembro", { p_cuenta: cuenta, p_correo: q.correo, p_rol: "propietario" });
    expect((await q.con.rpc("aceptar_invitacion", { p_clave: inv.token })).cuenta.rol).toBe("propietario");
    return q;
  }
  const propietarios = async (cuenta) => (await sql.query(
    "select coalesce(array_agg(auth_user_id order by auth_user_id), '{}') p from public.membresias where cuenta_id = $1 and rol = 'propietario'",
    [cuenta])).rows[0].p;

  beforeAll(async () => {
    sql = await crearBase(BASE, [STUB, ESQUEMA]);
    reloj = await relojControlado(sql, new Date("2026-11-04T18:00:00Z"));
  });
  afterAll(cerrarTodo);

  // --- Alta y vinculación -------------------------------------------------------------------------------
  it("alta completa: la persona crea la cuenta, genera un código, vincula el equipo y su administrador entra", async () => {
    const { p, cuenta, sucursal, admin } = await cuentaNueva("Taquería del Alta");
    const eq = await anonimo();
    const v = await vincular(eq, await codigo(p, cuenta, sucursal), "Caja");
    expect(v).toMatchObject({ ok: true, dispositivo: { nombre: "Caja", monitorCocina: false }, sucursal: { id: sucursal, nombre: "Taquería del Alta" } });
    expect((await eq.con.rpc("usuarios_login")).usuarios).toEqual([{ id: admin.id, nombre: "Admin" }]);
    const l = await eq.con.rpc("login", { p_id: admin.id, p_pin: PIN });
    expect(l).toMatchObject({ ok: true, debeCambiarPin: false, usuario: { rol: "admin" } });
    const e = await eq.con.rpc("estado", { p_token: l.token });
    expect([e.mesas.length, e.carnes.length, e.bebidas.length, e.precios["taco-pastor"]]).toEqual([8, 4, 7, 20]);
    // en el panel: quién lo aprobó y cuándo se usó por última vez
    const lista = (await p.con.rpc("listar_dispositivos", { p_cuenta: cuenta, p_sucursal: null })).dispositivos;
    expect(lista).toEqual([expect.objectContaining({ id: v.dispositivo.id, aprobadoPor: p.correo, revocadoEn: null })]);
    expect(lista[0].ultimoUso).not.toBeNull();
    // y en la bitácora de la cuenta, sin el código
    const { rows } = await sql.query("select accion, sucursal_id is null de_cuenta, detalle::text detalle from public.bitacora where cuenta_id = $1 order by id", [cuenta]);
    expect(rows.map((r) => [r.accion, r.de_cuenta])).toEqual([
      ["crear_cuenta", true], ["crear_sucursal", false], ["generar_codigo", false], ["vincular_dispositivo", false]]);
  });

  it("el catálogo inicial es el mismo en la primera instalación y en cada sucursal nueva", async () => {
    const { sucursal } = await cuentaNueva();
    const inicial = (await sql.query("select s.id from public.sucursales s join public.cuentas c on c.id = s.cuenta_id where c.creada_por is null and c.estado = 'pendiente_activacion'")).rows[0].id;
    const catalogo = async (s) => (await sql.query(`select
        (select json_agg(json_build_object('id', id, 'nombre', nombre, 'orden', orden, 'activo', activo) order by orden) from public.carnes where sucursal_id = $1) carnes,
        (select json_agg(json_build_object('id', id, 'nombre', nombre, 'cantidad', cantidad, 'precio', precio) order by id) from public.bebidas where sucursal_id = $1) bebidas,
        (select count(*)::int from public.mesas where sucursal_id = $1 and estado = 'libre') mesas,
        (select precios from public.config where sucursal_id = $1) precios,
        (select count(*)::int from public.cocina_sesion where sucursal_id = $1) cocina`, [s])).rows[0];
    const nueva = await catalogo(sucursal);
    expect(await catalogo(inicial)).toEqual(nueva);
    expect(nueva.carnes.map((k) => k.id)).toEqual(["pastor", "bistec", "tripa", "chorizo"]);
    expect([nueva.mesas, nueva.cocina, nueva.precios["gringa-chorizo"]]).toEqual([8, 1, 45]);
  });

  it("un código para monitor de cocina vincula el equipo como monitor dedicado", async () => {
    const { p, cuenta, sucursal } = await cuentaNueva();
    const v = await vincular(await anonimo(), await codigo(p, cuenta, sucursal, true), "Monitor");
    expect(v.dispositivo.monitorCocina).toBe(true);
    expect((await sql.query("select monitor_cocina from public.dispositivos where id = $1", [v.dispositivo.id])).rows[0].monitor_cocina).toBe(true);
  });

  it("el código vence a los 10 minutos y es de un solo uso", async () => {
    const { p, cuenta, sucursal } = await cuentaNueva();
    const viejo = await codigo(p, cuenta, sucursal);
    await reloj.avanzar({ minutos: 10 });
    const eq = await anonimo();
    expect(await vincular(eq, viejo)).toEqual({ ok: false, error: "codigo", restantes: 4 });
    const nuevo = await codigo(p, cuenta, sucursal);
    await reloj.avanzar({ minutos: 9, segundos: 59 });
    expect((await vincular(eq, nuevo)).ok).toBe(true);
    expect(await vincular(await anonimo(), nuevo)).toEqual({ ok: false, error: "codigo", restantes: 4 });
    // en la base solo está el hash y, ya usado, a qué equipo vinculó
    const { rows } = await sql.query(`select usado_en is not null usado, dispositivo_id is not null con_equipo,
      codigo_hash = public._hash_secreto('codigo', $1) hash from public.codigos_vinculacion where sucursal_id = $2 and usado_en is not null`, [nuevo, sucursal]);
    expect(rows).toEqual([{ usado: true, con_equipo: true, hash: true }]);
  });

  it("dos equipos con el mismo código a la vez: solo uno queda vinculado", async () => {
    const { p, cuenta, sucursal } = await cuentaNueva();
    const cod = await codigo(p, cuenta, sucursal);
    const [x, y] = [await anonimo(), await anonimo()];
    const pidY = await pidDe(y.con);
    await x.con.query("begin");
    const rx = await vincular(x, cod, "X");
    const py = vincular(y, cod, "Y");
    expect(await esperaCandado(sql, pidY)).toBe(true);   // espera a la fila del código
    await x.con.query("commit");
    expect(rx.ok).toBe(true);
    expect(await py).toEqual({ ok: false, error: "codigo", restantes: 4 });
    expect((await sql.query("select array_agg(nombre) n from public.dispositivos where sucursal_id = $1", [sucursal])).rows[0].n).toEqual(["X"]);
  });

  it("hasta 10 códigos vigentes por sucursal", async () => {
    const { p, cuenta, sucursal } = await cuentaNueva();
    for (let i = 0; i < 10; i++) await codigo(p, cuenta, sucursal);
    expect(await p.con.rpc("generar_codigo", { p_cuenta: cuenta, p_sucursal: sucursal, p_monitor: false })).toEqual({ ok: false, error: "limite" });
    await reloj.avanzar({ minutos: 10 });
    expect((await p.con.rpc("generar_codigo", { p_cuenta: cuenta, p_sucursal: sucursal, p_monitor: false })).ok).toBe(true);
  });

  it("los intentos fallidos se limitan por identidad (5 → 15 min, luego 30) y por IP (30), y quedan registrados", async () => {
    const { p, cuenta, sucursal } = await cuentaNueva();
    const bueno = await codigo(p, cuenta, sucursal);
    // identidad: 5 fallos y ni el código bueno entra
    const eq = await anonimo();
    for (const restantes of [4, 3, 2, 1, 0]) expect(await vincular(eq, "AAAA-AAAA")).toEqual({ ok: false, error: "codigo", restantes });
    expect(await vincular(eq, bueno)).toEqual({ ok: false, error: "bloqueado", espera: 900 });
    await reloj.avanzar({ minutos: 15 });
    const vigente = await codigo(p, cuenta, sucursal);   // el primero ya venció
    // la escalada sigue: 5 fallos más bloquean 30 minutos
    for (let i = 0; i < 5; i++) await vincular(eq, "BBBB-BBBB");
    expect(await vincular(eq, vigente)).toEqual({ ok: false, error: "bloqueado", espera: 1800 });
    // IP: 30 fallos repartidos entre 6 identidades nuevas bloquean a cualquier otra de esa IP
    const red = ip();
    for (let i = 0; i < 6; i++) {
      const otro = await anonimo(red);
      for (let j = 0; j < 5; j++) await vincular(otro, "CCCC-CCCC");
    }
    const ultima = await anonimo(red);
    expect(await vincular(ultima, vigente)).toMatchObject({ ok: false, error: "bloqueado" });
    // desde otra red, el mismo código sí: los fallos se confirmaron, pero el código sigue sin usar
    expect((await vincular(await anonimo(), vigente)).ok).toBe(true);
    expect((await sql.query("select count(*)::int n from public.intentos where clave like 'vin:%' or clave = 'vip:' || $1", [red])).rows[0].n)
      .toBeGreaterThanOrEqual(8);
  });

  // --- Identidades que no se mezclan --------------------------------------------------------------------
  it("una identidad anónima de un equipo que se convierte en una con correo deja de valer como equipo y no entra como persona", async () => {
    const { p, cuenta, sucursal } = await cuentaNueva();
    const eq = await anonimo();
    expect((await vincular(eq, await codigo(p, cuenta, sucursal))).ok).toBe(true);
    expect((await eq.con.rpc("usuarios_login")).usuarios).toHaveLength(1);
    await sql.query("update auth.users set is_anonymous = false, email = 'convertida@ejemplo.invalid', email_confirmed_at = now() where id = $1", [eq.uid]);
    expect((await falla(eq.con.rpc("usuarios_login"))).message).toBe("DISPOSITIVO");
    expect((await falla(eq.con.rpc("mis_cuentas"))).message).toBe("IDENTIDAD");
    expect((await falla(eq.con.rpc("crear_cuenta", { p_nombre: "x", p_sucursal: null, p_zona_horaria: null, p_admin_nombre: "x", p_admin_pin: PIN }))).message).toBe("IDENTIDAD");
  });

  it("una persona suspendida o borrada en Supabase Auth no administra", async () => {
    const { p, cuenta } = await cuentaNueva();
    const listar = () => p.con.rpc("listar_miembros", { p_cuenta: cuenta });
    await sql.query("update auth.users set banned_until = $2 where id = $1", [p.uid, new Date(reloj.ahora.getTime() + 3600e3).toISOString()]);
    expect((await falla(listar())).message).toBe("IDENTIDAD");
    await reloj.avanzar({ horas: 1 });
    expect((await listar()).ok).toBe(true);
    await sql.query("update auth.users set deleted_at = now() where id = $1", [p.uid]);
    expect((await falla(listar())).message).toBe("IDENTIDAD");
  });

  // --- Identidades suspendidas o borradas en Supabase Auth ---------------------------------------------
  // Su JWT sigue siendo válido hasta que vence: la regla se revisa en auth.users en cada llamada.
  async function equipoConSesion() {
    const { p, cuenta, sucursal, admin } = await cuentaNueva();
    const eq = await anonimo();
    expect((await vincular(eq, await codigo(p, cuenta, sucursal))).ok).toBe(true);
    const token = (await eq.con.rpc("login", { p_id: admin.id, p_pin: PIN })).token;
    return { p, cuenta, sucursal, admin, eq, token };
  }
  const sinAcceso = async (eq, token, adminId) => {
    for (const [fn, args] of [["usuarios_login", {}], ["login", { p_id: adminId, p_pin: PIN }], ["estado", { p_token: token, p_partes: ["mesas"] }]]) {
      expect([fn, (await falla(eq.con.rpc(fn, args))).message]).toEqual([fn, "DISPOSITIVO"]);
    }
  };

  it("un equipo suspendido en Supabase Auth (banned_until) no se vincula ni opera mientras dure la suspensión", async () => {
    const { p, cuenta, sucursal, eq, token, admin } = await equipoConSesion();
    // vincular: la identidad suspendida no usa el código, y el código sigue sirviendo para otra
    const susp = await anonimo();
    const cod = await codigo(p, cuenta, sucursal);
    await sql.query("update auth.users set banned_until = $2 where id = $1", [susp.uid, new Date(reloj.ahora.getTime() + 5 * 60e3).toISOString()]);
    expect((await falla(vincular(susp, cod))).message).toBe("IDENTIDAD");
    // operar: el equipo ya vinculado pierde el acceso
    await sql.query("update auth.users set banned_until = $2 where id = $1", [eq.uid, new Date(reloj.ahora.getTime() + 5 * 60e3).toISOString()]);
    await sinAcceso(eq, token, admin.id);
    // al terminar la suspensión, los dos vuelven a servir (la sesión sigue dentro de sus 15 minutos)
    await reloj.avanzar({ minutos: 5 });
    expect((await eq.con.rpc("estado", { p_token: token, p_partes: ["mesas"] })).mesas).toHaveLength(8);
    expect((await vincular(susp, cod)).ok).toBe(true);
  });

  it("un equipo borrado en Supabase Auth (deleted_at) no se vincula ni opera", async () => {
    const { p, cuenta, sucursal, eq, token, admin } = await equipoConSesion();
    const borrada = await anonimo();
    const cod = await codigo(p, cuenta, sucursal);
    await sql.query("update auth.users set deleted_at = now() where id = $1", [borrada.uid]);
    expect((await falla(vincular(borrada, cod))).message).toBe("IDENTIDAD");
    await sql.query("update auth.users set deleted_at = now() where id = $1", [eq.uid]);
    await sinAcceso(eq, token, admin.id);
    // el código no se gastó
    expect((await vincular(await anonimo(), cod)).ok).toBe(true);
  });

  // --- Límites con escrituras simultáneas ----------------------------------------------------------------
  // Partiendo de uno menos que el límite, dos llamadas a la vez. La segunda espera a la primera y, al
  // seguir, ve lo que la primera confirmó: en READ COMMITTED responde «limite»; en REPEATABLE READ y
  // SERIALIZABLE falla con 40001 y, al reintentarla en una transacción nueva (como hará la app), «limite».
  async function simultaneas(nivel, [ca, cb], llamar) {
    const pidB = await pidDe(cb);
    await ca.query(`begin isolation level ${nivel}`);
    await cb.query(`begin isolation level ${nivel}`);
    try {
      await cb.query("select 1");   // la fotografía de la segunda es de antes de la primera
      const r1 = await llamar(ca, 1);
      const p2 = llamar(cb, 2).then((ok) => ({ ok }), (e) => ({ error: e.code }));
      expect(await esperaCandado(sql, pidB)).toBe(true);
      await ca.query("commit");
      const r2 = await p2;
      await cb.query(r2.error ? "rollback" : "commit");
      // quien llama reintenta un 40001 en una transacción nueva, con el mismo aislamiento
      let r3;
      if (r2.error === "40001") {
        await cb.query(`begin isolation level ${nivel}`);
        r3 = await llamar(cb, 2);
        await cb.query("commit");
      }
      return { r1, r2, r3 };
    } finally {
      await ca.query("rollback").catch(() => {});
      await cb.query("rollback").catch(() => {});
    }
  }
  const esperado = (nivel) => (nivel === "read committed"
    ? { r2: { ok: { ok: false, error: "limite" } }, r3: undefined }
    : { r2: { error: "40001" }, r3: { ok: false, error: "limite" } });
  const dosConexiones = async (q) => [q.con, await conectarComo(BASE, q.uid, ip(), { persona: true })];

  for (const nivel of ["read committed", "repeatable read", "serializable"]) {
    describe(`límites con dos llamadas simultáneas (${nivel})`, () => {
      it("sucursales por cuenta (20)", async () => {
        const { p, cuenta } = await cuentaNueva();
        await sql.query("insert into public.sucursales (cuenta_id, nombre) select $1, 'Relleno ' || g from generate_series(1, 18) g", [cuenta]);
        const r = await simultaneas(nivel, await dosConexiones(p), (c, i) => c.rpc("crear_sucursal",
          { p_cuenta: cuenta, p_nombre: "Nueva " + i, p_zona_horaria: null, p_admin_nombre: "Admin", p_admin_pin: PIN }));
        expect(r.r1.ok).toBe(true);
        expect({ r2: r.r2, r3: r.r3 }).toEqual(esperado(nivel));
        expect((await sql.query("select count(*)::int n from public.sucursales where cuenta_id = $1", [cuenta])).rows[0].n).toBe(20);
      });

      it("invitaciones vigentes por cuenta (30)", async () => {
        const { p, cuenta } = await cuentaNueva();
        await sql.query(`insert into public.invitaciones (cuenta_id, correo, rol, token_hash, vence)
          select $1, 'relleno-' || g || '@ejemplo.invalid', 'encargado', md5(random()::text || g), public._ahora() + interval '1 day'
          from generate_series(1, 29) g`, [cuenta]);
        const r = await simultaneas(nivel, await dosConexiones(p), (c, i) => c.rpc("invitar_miembro",
          { p_cuenta: cuenta, p_correo: `simultanea-${i}@ejemplo.invalid`, p_rol: "encargado" }));
        expect(r.r1.ok).toBe(true);
        expect({ r2: r.r2, r3: r.r3 }).toEqual(esperado(nivel));
        expect((await sql.query("select count(*)::int n from public.invitaciones where cuenta_id = $1 and usada_en is null and vence > public._ahora()",
          [cuenta])).rows[0].n).toBe(30);
      });

      it("códigos vigentes por sucursal (10)", async () => {
        const { p, cuenta, sucursal } = await cuentaNueva();
        await sql.query(`insert into public.codigos_vinculacion (sucursal_id, codigo_hash, creado_por, creado, vence)
          select $1, md5(random()::text || g), $2, public._ahora(), public._ahora() + interval '10 minutes' from generate_series(1, 9) g`, [sucursal, p.uid]);
        const r = await simultaneas(nivel, await dosConexiones(p), (c) => c.rpc("generar_codigo", { p_cuenta: cuenta, p_sucursal: sucursal, p_monitor: false }));
        expect(r.r1.ok).toBe(true);
        expect({ r2: r.r2, r3: r.r3 }).toEqual(esperado(nivel));
        expect((await sql.query("select count(*)::int n from public.codigos_vinculacion where sucursal_id = $1 and usado_en is null and vence > public._ahora()",
          [sucursal])).rows[0].n).toBe(10);
      });

      it("cuentas creadas por persona (3)", async () => {
        const q = await persona();
        const alta = (c, i) => c.rpc("crear_cuenta", { p_nombre: "Cuenta " + i, p_sucursal: null, p_zona_horaria: null, p_admin_nombre: "Admin", p_admin_pin: PIN });
        expect((await alta(q.con, "a")).ok).toBe(true);
        expect((await alta(q.con, "b")).ok).toBe(true);
        const r = await simultaneas(nivel, await dosConexiones(q), alta);
        expect(r.r1.ok).toBe(true);
        expect({ r2: r.r2, r3: r.r3 }).toEqual(esperado(nivel));
        expect((await sql.query("select count(*)::int n from public.cuentas where creada_por = $1", [q.uid])).rows[0].n).toBe(3);
      });
    });
  }

  // --- Cuentas e invitaciones ---------------------------------------------------------------------------
  it("hasta 3 cuentas por persona, también con altas simultáneas", async () => {
    const p = await persona();
    const otra = await conectarComo(BASE, p.uid, ip(), { persona: true });
    const alta = (c, n) => c.rpc("crear_cuenta", { p_nombre: "Cuenta " + n, p_sucursal: null, p_zona_horaria: "America/Cancun", p_admin_nombre: "Admin", p_admin_pin: PIN });
    expect((await alta(p.con, 1)).ok).toBe(true);
    expect((await alta(p.con, 2)).ok).toBe(true);
    const pidOtra = await pidDe(otra);
    await p.con.query("begin");
    expect((await alta(p.con, 3)).ok).toBe(true);
    const segunda = alta(otra, 4);
    expect(await esperaCandado(sql, pidOtra)).toBe(true);   // espera a la otra alta de la misma persona
    await p.con.query("commit");
    expect(await segunda).toEqual({ ok: false, error: "limite" });
    expect((await sql.query("select count(*)::int n from public.cuentas where creada_por = $1", [p.uid])).rows[0].n).toBe(3);
    // la zona horaria se valida
    expect(await (await persona()).con.rpc("crear_cuenta", { p_nombre: "x", p_sucursal: null, p_zona_horaria: "Marte/Olimpo", p_admin_nombre: "x", p_admin_pin: PIN }))
      .toEqual({ ok: false, error: "zona" });
  });

  it("una invitación nueva al mismo correo deja sin efecto la anterior", async () => {
    const { p, cuenta } = await cuentaNueva();
    const q = await persona();
    const inv1 = await p.con.rpc("invitar_miembro", { p_cuenta: cuenta, p_correo: q.correo, p_rol: "encargado" });
    const inv2 = await p.con.rpc("invitar_miembro", { p_cuenta: cuenta, p_correo: q.correo.toUpperCase(), p_rol: "propietario" });
    expect((await p.con.rpc("listar_miembros", { p_cuenta: cuenta })).invitaciones.map((i) => i.rol)).toEqual(["propietario"]);
    expect((await falla(q.con.rpc("aceptar_invitacion", { p_clave: inv1.token }))).message).toBe("INVITACION");
    expect(await q.con.rpc("aceptar_invitacion", { p_clave: inv2.token })).toMatchObject({ ok: true, cuenta: { rol: "propietario" } });
    // y ya usada no sirve otra vez
    expect((await falla(q.con.rpc("aceptar_invitacion", { p_clave: inv2.token }))).message).toBe("INVITACION");
  });

  it("cambiar el rol de un miembro con la API: se quita y se vuelve a invitar con el rol nuevo", async () => {
    const { p, cuenta } = await cuentaNueva();
    const q = await persona();
    const invitar = (rol) => p.con.rpc("invitar_miembro", { p_cuenta: cuenta, p_correo: q.correo, p_rol: rol });
    const aceptar = async (inv) => (await q.con.rpc("aceptar_invitacion", { p_clave: inv.token })).cuenta.rol;
    expect(await aceptar(await invitar("encargado"))).toBe("encargado");
    // a quien ya es miembro no se le invita otra vez: no hay un «cambiar rol» directo
    expect(await invitar("propietario")).toEqual({ ok: false, error: "ya_miembro" });
    // subir: quitar e invitar como propietario
    expect((await p.con.rpc("quitar_miembro", { p_cuenta: cuenta, p_miembro: q.uid })).ok).toBe(true);
    expect(await aceptar(await invitar("propietario"))).toBe("propietario");
    // bajar: igual, mientras quede otro propietario
    expect((await p.con.rpc("quitar_miembro", { p_cuenta: cuenta, p_miembro: q.uid })).ok).toBe(true);
    expect(await aceptar(await invitar("encargado"))).toBe("encargado");
    expect(await propietarios(cuenta)).toEqual([p.uid]);
  });

  it("salvaguarda: si alguien ya es miembro y acepta otra invitación hecha fuera de la API, su rol puede subir pero no bajar", async () => {
    // La API no crea este caso (invitar_miembro responde ya_miembro y una invitación nueva anula la anterior):
    // las invitaciones se insertan con SQL para comprobar la regla de aceptar_invitacion por sí sola.
    const { p, cuenta } = await cuentaNueva();
    const q = await persona();
    const inv = await p.con.rpc("invitar_miembro", { p_cuenta: cuenta, p_correo: q.correo, p_rol: "encargado" });
    await q.con.rpc("aceptar_invitacion", { p_clave: inv.token });
    const aMano = (clave, rol) => sql.query(`insert into public.invitaciones (cuenta_id, correo, rol, token_hash, vence)
      values ($1, $2, $3, public._hash_secreto('invitacion', $4), public._ahora() + interval '1 day')`, [cuenta, q.correo, rol, clave]);
    await aMano("subir", "propietario");
    expect((await q.con.rpc("aceptar_invitacion", { p_clave: "subir" })).cuenta.rol).toBe("propietario");
    await aMano("bajar", "encargado");
    expect((await q.con.rpc("aceptar_invitacion", { p_clave: "bajar" })).cuenta.rol).toBe("propietario");
    expect((await propietarios(cuenta)).sort()).toEqual([p.uid, q.uid].sort());
  });

  it("la invitación inicial del proveedor: no la crea la app, activa la cuenta pendiente y solo sirve la última", async () => {
    // solo desde el SQL Editor (postgres), nunca desde la API
    const priv = (await sql.query(`select has_function_privilege('authenticated', 'public.crear_invitacion_inicial(uuid, text, integer)', 'execute') a,
      has_function_privilege('anon', 'public.crear_invitacion_inicial(uuid, text, integer)', 'execute') b`)).rows[0];
    expect(priv).toEqual({ a: false, b: false });
    // la cuenta que crea la instalación (como la de la migración): pendiente, sin propietario
    const { rows: [pend] } = await sql.query(`select c.id cuenta, s.id sucursal from public.cuentas c join public.sucursales s on s.cuenta_id = c.id
      where c.estado = 'pendiente_activacion' and c.creada_por is null`);
    const dueno = await persona("dueno.inicial@ejemplo.invalid");
    const inicial = async () => (await sql.query("select public.crear_invitacion_inicial($1, $2) t", [pend.cuenta, "Dueno.Inicial@ejemplo.invalid"])).rows[0].t;
    const t1 = await inicial();
    const t2 = await inicial();
    expect((await falla(dueno.con.rpc("aceptar_invitacion", { p_clave: t1 }))).message).toBe("INVITACION");
    // otra persona, aunque tenga el token, no la acepta
    expect((await falla((await persona()).con.rpc("aceptar_invitacion", { p_clave: t2 }))).message).toBe("INVITACION");
    expect(await dueno.con.rpc("aceptar_invitacion", { p_clave: t2 })).toMatchObject({ ok: true, cuenta: { id: pend.cuenta, rol: "propietario" } });
    expect((await sql.query("select estado from public.cuentas where id = $1", [pend.cuenta])).rows[0].estado).toBe("activa");
    // activa ya no recibe invitaciones del proveedor; sus propietarios invitan desde el panel
    expect((await falla(inicial())).message).toMatch(/ya está activa/);
    // y ya puede vincular equipos a su sucursal
    expect((await vincular(await anonimo(), await codigo(dueno, pend.cuenta, pend.sucursal))).ok).toBe(true);
  });

  // --- Miembros -----------------------------------------------------------------------------------------
  it("al quitar a un propietario, sus invitaciones y códigos pendientes dejan de servir y ya no puede actuar", async () => {
    const { p, cuenta, sucursal } = await cuentaNueva();
    const q = await otroPropietario(p, cuenta);
    const z = await persona();
    const inv = await q.con.rpc("invitar_miembro", { p_cuenta: cuenta, p_correo: z.correo, p_rol: "encargado" });
    const cod = await codigo(q, cuenta, sucursal);
    expect(await p.con.rpc("quitar_miembro", { p_cuenta: cuenta, p_miembro: q.uid })).toEqual({ ok: true, propio: false });
    expect((await falla(z.con.rpc("aceptar_invitacion", { p_clave: inv.token }))).message).toBe("INVITACION");
    expect(await vincular(await anonimo(), cod)).toMatchObject({ ok: false, error: "codigo" });
    expect((await falla(q.con.rpc("listar_dispositivos", { p_cuenta: cuenta, p_sucursal: null }))).message).toBe("CUENTA");
    expect((await sql.query("select detalle->>'correo' c from public.bitacora where cuenta_id = $1 and accion = 'quitar_miembro'", [cuenta])).rows)
      .toEqual([{ c: q.correo }]);
  });

  it("un propietario al que quitan mientras actúa: su acción espera y se rechaza", async () => {
    const { p, cuenta, sucursal } = await cuentaNueva();
    const q = await otroPropietario(p, cuenta);
    const pidQ = await pidDe(q.con);
    await p.con.query("begin");
    expect((await p.con.rpc("quitar_miembro", { p_cuenta: cuenta, p_miembro: q.uid })).ok).toBe(true);
    const accion = q.con.rpc("generar_codigo", { p_cuenta: cuenta, p_sucursal: sucursal, p_monitor: false }).then((ok) => ({ ok }), (e) => ({ error: e.message }));
    expect(await esperaCandado(sql, pidQ)).toBe(true);
    await p.con.query("commit");
    expect(await accion).toEqual({ error: "CUENTA" });
    expect((await sql.query("select count(*)::int n from public.codigos_vinculacion where creado_por = $1", [q.uid])).rows[0].n).toBe(0);
  });

  it("en REPEATABLE READ, la segunda de dos bajas simultáneas falla con 40001 y al reintentarla se rechaza", async () => {
    const { p, cuenta } = await cuentaNueva();
    const q = await otroPropietario(p, cuenta);
    const pidQ = await pidDe(q.con);
    await p.con.query("begin isolation level repeatable read");
    await q.con.query("begin isolation level repeatable read");
    await q.con.query("select 1");   // la fotografía de q es de antes de la baja
    expect((await p.con.rpc("quitar_miembro", { p_cuenta: cuenta, p_miembro: q.uid })).ok).toBe(true);
    const segunda = q.con.rpc("quitar_miembro", { p_cuenta: cuenta, p_miembro: p.uid }).then((ok) => ({ ok }), (e) => ({ error: e.code }));
    expect(await esperaCandado(sql, pidQ)).toBe(true);
    await p.con.query("commit");
    expect(await segunda).toEqual({ error: "40001" });
    await q.con.query("rollback");
    // el reintento (lo hace quien llama) ve la baja: ya no es miembro
    await q.con.query("begin isolation level repeatable read");
    expect((await falla(q.con.rpc("quitar_miembro", { p_cuenta: cuenta, p_miembro: p.uid }))).message).toBe("CUENTA");
    await q.con.query("rollback");
    expect(await propietarios(cuenta)).toEqual([p.uid]);
  });

  it("un propietario puede quitarse si queda otro; el último no", async () => {
    const { p, cuenta } = await cuentaNueva();
    const q = await otroPropietario(p, cuenta);
    expect(await q.con.rpc("quitar_miembro", { p_cuenta: cuenta, p_miembro: q.uid })).toEqual({ ok: true, propio: true });
    expect(await p.con.rpc("quitar_miembro", { p_cuenta: cuenta, p_miembro: p.uid })).toEqual({ ok: false, error: "ultimo_propietario" });
    // y el invariante lo sostiene aunque se intente por fuera de la función
    expect((await falla(sql.query("delete from public.membresias where cuenta_id = $1", [cuenta]))).code).toBe("23514");
  });

  // --- Revocación ---------------------------------------------------------------------------------------
  it("revocar un equipo cierra sus sesiones, suelta la cocina y solo se recupera con una identidad nueva", async () => {
    const { p, cuenta, sucursal, admin } = await cuentaNueva();
    const eq = await anonimo();
    const v = await vincular(eq, await codigo(p, cuenta, sucursal), "Cocina");
    const tAdmin = (await eq.con.rpc("login", { p_id: admin.id, p_pin: PIN })).token;
    const coc = await eq.con.rpc("crear_usuario", { p_token: tAdmin, p_admin_pin: PIN, p_nombre: "Cocinera", p_pin: "604917", p_rol: "cocinero" });
    expect((await eq.con.rpc("login", { p_id: coc.usuario.id, p_pin: "604917" })).ok).toBe(true);
    expect((await sql.query("select dispositivo from public.cocina_sesion where sucursal_id = $1", [sucursal])).rows[0].dispositivo).toBe(v.dispositivo.id);
    // un encargado puede revocar
    const e = await persona();
    const inv = await p.con.rpc("invitar_miembro", { p_cuenta: cuenta, p_correo: e.correo, p_rol: "encargado" });
    await e.con.rpc("aceptar_invitacion", { p_clave: inv.token });
    expect(await e.con.rpc("revocar_dispositivo", { p_cuenta: cuenta, p_dispositivo: v.dispositivo.id })).toEqual({ ok: true, yaRevocado: false });
    expect((await falla(eq.con.rpc("estado", { p_token: tAdmin }))).message).toBe("DISPOSITIVO");
    const { rows } = await sql.query(`select count(*) filter (where not revocada)::int vivas, count(*) filter (where motivo_fin = 'equipo_revocado')::int revocadas,
      (select session_id from public.cocina_sesion where sucursal_id = $2) cocina from public.sesiones where dispositivo_id = $1`, [v.dispositivo.id, sucursal]);
    expect(rows[0]).toEqual({ vivas: 0, revocadas: 2, cocina: null });
    // la misma identidad no se vuelve a vincular; una nueva, con otro código, sí
    expect((await falla(vincular(eq, await codigo(p, cuenta, sucursal)))).message).toBe("REVOCADO");
    expect((await vincular(await anonimo(), await codigo(p, cuenta, sucursal))).ok).toBe(true);
    const lista = (await p.con.rpc("listar_dispositivos", { p_cuenta: cuenta, p_sucursal: sucursal })).dispositivos;
    expect(lista.map((x) => [x.revocadoEn === null, x.revocadoPor])).toEqual([[true, null], [false, e.correo]]);
  });

  // --- Bitácora -----------------------------------------------------------------------------------------
  it("la bitácora dice la cuenta de cada acción; solo las de cuenta van sin sucursal", async () => {
    const { cuenta, sucursal } = await cuentaNueva();
    expect((await sql.query("select count(*)::int n from public.bitacora where cuenta_id is null")).rows[0].n).toBe(0);
    expect((await falla(sql.query("insert into public.bitacora (cuenta_id, accion) values ($1, 'cobrar')", [cuenta]))).code).toBe("23514");
    // una sucursal de otra cuenta no se puede anotar en esta
    const otra = await cuentaNueva();
    expect((await falla(sql.query("insert into public.bitacora (cuenta_id, sucursal_id, accion) values ($1, $2, 'cobrar')",
      [cuenta, otra.sucursal]))).code).toBe("23503");
    expect((await sql.query("insert into public.bitacora (cuenta_id, sucursal_id, accion) values ($1, $2, 'cobrar') returning 1", [cuenta, sucursal])).rowCount).toBe(1);
  });
});
