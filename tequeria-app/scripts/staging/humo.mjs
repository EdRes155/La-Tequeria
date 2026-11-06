#!/usr/bin/env node
// Prueba de humo contra STAGING (Supabase real; docs/multinegocio/STAGING.md). Nunca contra producción.
//   node scripts/staging/humo.mjs     → configuración efectiva, alta, vinculación, operación, aislamiento y tiempo real
// El tiempo de corte de un equipo revocado con la conexión abierta se mide aparte: corte.mjs (un cliente que no
// suelta el canal) y corte-navegador.mjs (la app real).
// Cada ejecución crea dos cuentas nuevas con personas, equipos y datos sintéticos (dominio .invalid).
import { abrirStaging, administracion, cliente, datos, suscribir, espera, marca, pasos, igual, URL_PROYECTO } from "./comun.mjs";
import { createClient } from "@supabase/supabase-js";

const { proyecto, ANON, SERVICIO } = await abrirStaging({ servicio: true });
console.log(`Staging: ${proyecto.name}, ${new Date().toISOString()}\n`);
const { paso, terminar } = pasos();
async function falla(promesa, codigo) {
  const { data, error } = await promesa;
  if (!error) throw new Error(`se esperaba ${codigo} y respondió ${JSON.stringify(data)}`);
  if (codigo && error.message !== codigo && error.code !== codigo) throw new Error(`se esperaba ${codigo} y fue ${error.code} ${error.message}`);
}
const servicio = createClient(URL_PROYECTO, SERVICIO, { auth: { persistSession: false, autoRefreshToken: false } });
async function persona(etiqueta) {
  const correo = `${etiqueta}.${marca}@ejemplo.invalid`;
  const clave = crypto.randomUUID();
  await datos(servicio.auth.admin.createUser({ email: correo, password: clave, email_confirm: true }), "crear persona");
  const c = cliente(ANON);
  const r = await datos(c.auth.signInWithPassword({ email: correo, password: clave }), "entrar con correo");
  return { c, correo, uid: r.user.id };
}
async function equipo() {
  const c = cliente(ANON);
  const r = await datos(c.auth.signInAnonymously(), "sesión anónima");
  return { c, uid: r.user.id };
}

const PIN_A = "583920", PIN_B = "604917";
let A = {}, B = {};

await paso("configuración declarada: inicio anónimo, correo confirmado, JWT ≤ 300 s, contraseñas ≥ 10 y solo canales privados", async () => {
  const auth = await administracion("/config/auth");
  const rt = await administracion("/config/realtime");
  igual([auth.external_anonymous_users_enabled, auth.mailer_autoconfirm, auth.jwt_exp <= 300, auth.password_min_length >= 10, rt.private_only],
    [true, false, true, true, true], "configuración");
  return `JWT de ${auth.jwt_exp} s; lo que se aplica de verdad se comprueba en los pasos de abajo`;
});

await paso("sin sesión (anon) no se ejecuta ninguna función", async () => {
  await falla(cliente(ANON).rpc("usuarios_login"));
});

await paso("solo canales privados, aplicado: un canal público se rechaza con y sin sesión", async () => {
  const sinSesion = cliente(ANON);
  const anonima = (await equipo()).c;
  const vistos = [];
  for (const c of [sinSesion, anonima]) {
    const r = await suscribir(c, `publico-${marca}`, () => {}, { privado: false });
    if (r.estado === "SUBSCRIBED" || !/PrivateOnly/.test(r.err || "")) throw new Error(`canal público: ${r.estado} ${r.err || ""}`);
    vistos.push(r.err.split(":")[0]);
    await c.removeAllChannels();
  }
  return vistos.join(", ");
});

await paso("alta: dos personas crean su cuenta, su sucursal y su administrador", async () => {
  A.dueno = await persona("duena-a"); B.dueno = await persona("dueno-b");
  for (const [X, pin, n] of [[A, PIN_A, "A"], [B, PIN_B, "B"]]) {
    const r = await datos(X.dueno.c.rpc("crear_cuenta", { p_nombre: `Humo ${n} ${marca}`, p_sucursal: `Centro ${n}`,
      p_zona_horaria: "America/Mexico_City", p_admin_nombre: `Admin ${n}`, p_admin_pin: pin }), "crear_cuenta");
    if (!r.ok) throw new Error(JSON.stringify(r));
    Object.assign(X, { cuenta: r.cuenta.id, sucursal: r.sucursal.id, admin: r.admin.id, pin });
    const mias = await datos(X.dueno.c.rpc("mis_cuentas"), "mis_cuentas");
    igual(mias.cuentas.map((c) => c.id), [X.cuenta], "mis_cuentas");
  }
});

await paso("vinculación: cada dueño genera códigos y los equipos (identidades anónimas) se vinculan", async () => {
  for (const [X, eqs] of [[A, [["caja", false], ["cocina", true]]], [B, [["caja", false]]]]) {
    for (const [nombre, monitor] of eqs) {
      const cod = await datos(X.dueno.c.rpc("generar_codigo", { p_cuenta: X.cuenta, p_sucursal: X.sucursal, p_monitor: monitor }), "generar_codigo");
      const e = await equipo();
      const v = await datos(e.c.rpc("vincular_dispositivo", { p_codigo: cod.codigo.toLowerCase().replace(/^(.{4})/, "$1-"), p_nombre: nombre }), "vincular");
      if (!v.ok || v.sucursal.id !== X.sucursal || v.dispositivo.monitorCocina !== monitor) throw new Error(JSON.stringify(v));
      X[nombre] = { ...e, dispositivo: v.dispositivo.id };
      // el código ya no sirve
      const otro = await equipo();
      const r = await datos(otro.c.rpc("vincular_dispositivo", { p_codigo: cod.codigo, p_nombre: "x" }), "código usado");
      igual(r.error, "codigo", "código usado");
      X.suelta = otro;   // identidad anónima que no quedó vinculada
    }
  }
});

await paso("entrada: cada equipo ve solo el personal de su sucursal y el administrador entra", async () => {
  for (const X of [A, B]) {
    const p = await datos(X.caja.c.rpc("usuarios_login"), "usuarios_login");
    igual([p.sucursal.id, p.usuarios.map((u) => u.id)], [X.sucursal, [X.admin]], "pantalla de entrada");
    const l = await datos(X.caja.c.rpc("login", { p_id: X.admin, p_pin: X.pin, p_dispositivo: "humo" }), "login");
    if (!l.ok) throw new Error(JSON.stringify(l));
    X.token = l.token;
    const e = await datos(X.caja.c.rpc("estado", { p_token: X.token }), "estado");
    igual([e.mesas.length, e.carnes.length, e.bebidas.length, e.zonaHoraria], [8, 4, 7, "America/Mexico_City"], "estado inicial");
  }
});

await paso("aislamiento: el token de B no sirve en el equipo de A, ni una persona como equipo, ni un equipo como persona", async () => {
  await falla(A.caja.c.rpc("estado", { p_token: B.token }), "SESION");
  await falla(A.dueno.c.rpc("usuarios_login"), "DISPOSITIVO");
  await falla(A.caja.c.rpc("mis_cuentas"), "IDENTIDAD");
  await falla(B.dueno.c.rpc("generar_codigo", { p_cuenta: A.cuenta, p_sucursal: A.sucursal, p_monitor: false }), "CUENTA");
});

await paso("tiempo real: el equipo escucha el canal privado de su sucursal; otra sucursal, una persona, una identidad sin vincular y sin sesión no", async () => {
  A.avisos = [];
  const propio = await suscribir(A.cocina.c, "sucursal:" + A.sucursal, (p) => A.avisos.push({ t: Date.now(), p }));
  igual(propio.estado, "SUBSCRIBED", "canal propio");
  A.canal = propio.ch;
  const ajeno = await suscribir(A.caja.c, "sucursal:" + B.sucursal);
  if (ajeno.estado === "SUBSCRIBED") throw new Error("se suscribió al canal de otra sucursal");
  const dePersona = await suscribir(A.dueno.c, "sucursal:" + A.sucursal);
  if (dePersona.estado === "SUBSCRIBED") throw new Error("una persona se suscribió al canal de una sucursal");
  const suelta = await suscribir(A.suelta.c, "sucursal:" + A.sucursal);
  if (suelta.estado === "SUBSCRIBED") throw new Error("una identidad anónima sin vincular se suscribió al canal de una sucursal");
  const sinSesion = await suscribir(cliente(ANON), "sucursal:" + A.sucursal);
  if (sinSesion.estado === "SUBSCRIBED") throw new Error("sin sesión se suscribió al canal de una sucursal");
  B.avisos = [];
  const deB = await suscribir(B.caja.c, "sucursal:" + B.sucursal, (p) => B.avisos.push(p));
  igual(deB.estado, "SUBSCRIBED", "canal de B");
  return `otra sucursal, persona, identidad sin vincular y sin sesión: ${[ajeno, dePersona, suelta, sinSesion].map((r) => r.estado).join(", ")}`;
});

await paso("tiempo real: un cambio avisa solo a su sucursal, sin datos; un cliente no puede publicar", async () => {
  const antes = A.avisos.length, t0 = Date.now();
  await datos(A.caja.c.rpc("fijar_precio", { p_token: A.token, p_clave: "taco-pastor", p_precio: 21 }), "fijar_precio");
  for (let i = 0; i < 50 && A.avisos.length === antes; i++) await espera(100);
  const nuevos = A.avisos.slice(antes).map((x) => x.p);
  if (!nuevos.some((p) => p.t === "config")) throw new Error("no llegó el aviso de config: " + JSON.stringify(nuevos));
  // solo el nombre de la tabla; Realtime agrega el id del mensaje (no es un dato de la app)
  if (nuevos.some((p) => Object.keys(p).some((k) => k !== "t" && k !== "id"))) throw new Error("un aviso trae datos: " + JSON.stringify(nuevos));
  await espera(2000);
  igual(B.avisos, [], "avisos en B");
  // la caja de A intenta publicar en su propio canal: la cocina de A no lo recibe
  const caja = await suscribir(A.caja.c, "sucursal:" + A.sucursal);
  igual(caja.estado, "SUBSCRIBED", "caja en su canal");
  const n = A.avisos.length;
  await caja.ch.send({ type: "broadcast", event: "cambio", payload: { t: "falso" } });
  await espera(3000);
  if (A.avisos.slice(n).some((x) => x.p.t === "falso")) throw new Error("un cliente pudo publicar");
  A.canalCaja = caja.ch;
  return `el aviso llegó ${A.avisos[antes].t - t0} ms después de llamar`;
});

await paso("revocar: el equipo pierde el acceso a los datos de inmediato", async () => {
  const r = await datos(A.dueno.c.rpc("revocar_dispositivo", { p_cuenta: A.cuenta, p_dispositivo: A.cocina.dispositivo }), "revocar");
  igual(r, { ok: true, yaRevocado: false }, "revocar");
  await falla(A.cocina.c.rpc("usuarios_login"), "DISPOSITIVO");
});

await paso("Supabase Auth real: un equipo o una persona suspendida o borrada (borrado lógico) deja de servir en la siguiente llamada; el borrado definitivo de un equipo vinculado se rechaza", async () => {
  // con el JWT todavía vigente: las funciones leen auth.users en cada llamada
  await datos(servicio.auth.admin.updateUserById(B.caja.uid, { ban_duration: "24h" }), "suspender equipo");
  await falla(B.caja.c.rpc("usuarios_login"), "DISPOSITIVO");
  // el borrado definitivo de un equipo vinculado se rechaza (conserva su historial) y el equipo sigue igual;
  // el borrado lógico lo corta; una identidad anónima que nunca se vinculó sí se borra
  const { error } = await servicio.auth.admin.deleteUser(A.caja.uid);
  if (!error) throw new Error("se pudo borrar de forma definitiva un equipo vinculado");
  await datos(A.caja.c.rpc("usuarios_login"), "el equipo sigue igual");
  await datos(servicio.auth.admin.deleteUser(A.caja.uid, true), "borrar equipo (borrado lógico)");
  await falla(A.caja.c.rpc("usuarios_login"), "DISPOSITIVO");
  await datos(servicio.auth.admin.deleteUser(A.suelta.uid), "borrar identidad sin vincular");
  await datos(servicio.auth.admin.updateUserById(A.dueno.uid, { ban_duration: "24h" }), "suspender persona");
  await falla(A.dueno.c.rpc("mis_cuentas"), "IDENTIDAD");
  await datos(servicio.auth.admin.deleteUser(B.dueno.uid, true), "borrar persona (borrado lógico)");
  await falla(B.dueno.c.rpc("mis_cuentas"), "IDENTIDAD");
});

for (const X of [A, B]) for (const k of ["caja", "cocina"]) await X[k]?.c.removeAllChannels().catch(() => {});
terminar();
