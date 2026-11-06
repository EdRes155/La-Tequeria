#!/usr/bin/env node
// Prueba de humo contra STAGING (Supabase real; docs/multinegocio/STAGING.md). Nunca contra producción.
//   node scripts/staging/humo.mjs                      → alta, vinculación, operación, aislamiento y tiempo real
//   node scripts/staging/humo.mjs --medir-revocacion   → además, cuánto tarda un equipo revocado con la conexión
//                                                         de tiempo real abierta en dejar de recibir avisos
// Requisitos: el token de administración de Supabase lo inyecta el proxy del entorno en api.supabase.com, y el
// host del proyecto está permitido. La llave service_role se lee de la API de administración y solo vive en
// memoria: crea las personas de prueba con el correo ya confirmado. Nada se imprime ni se guarda.
// Cada ejecución crea dos cuentas nuevas con personas, equipos y datos sintéticos (dominio .invalid).
import { createClient } from "@supabase/supabase-js";

const REF = process.env.STAGING_REF || "izcaeojzbaoqlxkerria";
const PRODUCCION = new Set(["ahmkfmoftpvhdcrjnhoe"]);
const MEDIR = process.argv.includes("--medir-revocacion");
const ADMIN_API = `https://api.supabase.com/v1/projects/${REF}`;
const URL_PROYECTO = `https://${REF}.supabase.co`;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
// única por ejecución: los correos de prueba no se repiten
const marca = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14) + Math.random().toString(36).slice(2, 6);

async function administracion(ruta) {
  const r = await fetch(ADMIN_API + ruta, { headers: { Authorization: "Bearer proxy-injected" } });
  if (!r.ok) throw new Error(`API de administración ${ruta}: HTTP ${r.status}`);
  return r.json();
}

const resultados = [];
async function paso(nombre, fn) {
  try { const extra = await fn(); resultados.push({ nombre, ok: true }); console.log(`✓ ${nombre}${extra ? " — " + extra : ""}`); }
  catch (e) { resultados.push({ nombre, ok: false }); console.log(`✗ ${nombre} — ${e.message}`); }
}
function igual(a, b, que) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${que}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); }
async function falla(promesa, codigo) {
  const { data, error } = await promesa;
  if (!error) throw new Error(`se esperaba ${codigo} y respondió ${JSON.stringify(data)}`);
  if (codigo && error.message !== codigo && error.code !== codigo) throw new Error(`se esperaba ${codigo} y fue ${error.code} ${error.message}`);
}
async function datos(promesa, que) {
  const { data, error } = await promesa;
  if (error) throw new Error(`${que}: ${error.code} ${error.message} ${error.hint || ""}`);
  return data;
}

// --- Guardia: solo un proyecto de staging -------------------------------------------------------------
const proyecto = await administracion("");
if (PRODUCCION.has(REF) || !/staging/i.test(proyecto.name)) {
  console.error(`Se niega: ${REF} («${proyecto.name}») no es un proyecto de staging.`);
  process.exit(2);
}
const llaves = await administracion("/api-keys?reveal=true");
const ANON = llaves.find((k) => k.name === "anon")?.api_key;
const SERVICIO = llaves.find((k) => k.name === "service_role")?.api_key;
if (!ANON || !SERVICIO) { console.error("No se encontraron las llaves del proyecto."); process.exit(2); }
console.log(`Staging: ${proyecto.name} (${REF}), ${new Date().toISOString()}\n`);

const cliente = () => createClient(URL_PROYECTO, ANON, { auth: { persistSession: false, autoRefreshToken: true } });
const servicio = createClient(URL_PROYECTO, SERVICIO, { auth: { persistSession: false, autoRefreshToken: false } });

async function persona(etiqueta) {
  const correo = `${etiqueta}.${marca}@ejemplo.invalid`;
  const clave = crypto.randomUUID();
  await datos(servicio.auth.admin.createUser({ email: correo, password: clave, email_confirm: true }), "crear persona");
  const c = cliente();
  await datos(c.auth.signInWithPassword({ email: correo, password: clave }), "entrar con correo");
  return { c, correo };
}
async function equipo() {
  const c = cliente();
  const r = await datos(c.auth.signInAnonymously(), "sesión anónima");
  return { c, uid: r.user.id };
}
// Se suscribe al canal y espera el resultado (SUBSCRIBED o el error)
function suscribir(c, topic, alAviso = () => {}) {
  return new Promise((ok) => {
    const ch = c.channel(topic, { config: { private: true } }).on("broadcast", { event: "cambio" }, (m) => alAviso(m.payload));
    const reloj = setTimeout(() => ok({ ch, estado: "SIN_RESPUESTA" }), 15000);
    c.realtime.setAuth().finally(() => ch.subscribe((estado, err) => {
      if (estado === "SUBSCRIBED" || estado === "CHANNEL_ERROR" || estado === "TIMED_OUT") {
        clearTimeout(reloj); ok({ ch, estado, err: err?.message });
      }
    }));
  });
}

const PIN_A = "583920", PIN_B = "604917";
let A = {}, B = {};

await paso("configuración: inicio anónimo, correo confirmado y solo canales privados", async () => {
  const auth = await administracion("/config/auth");
  const rt = await administracion("/config/realtime");
  igual([auth.external_anonymous_users_enabled, auth.mailer_autoconfirm, rt.private_only], [true, false, true], "configuración");
  return `JWT de ${auth.jwt_exp} s`;
});

await paso("sin sesión (anon) no se ejecuta ninguna función", async () => {
  await falla(cliente().rpc("usuarios_login"));
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

await paso("tiempo real: el equipo escucha el canal privado de su sucursal y no el de otra", async () => {
  A.avisos = [];
  const propio = await suscribir(A.cocina.c, "sucursal:" + A.sucursal, (p) => A.avisos.push({ t: Date.now(), p }));
  igual(propio.estado, "SUBSCRIBED", "canal propio");
  A.canal = propio.ch;
  const ajeno = await suscribir(A.caja.c, "sucursal:" + B.sucursal);
  if (ajeno.estado === "SUBSCRIBED") throw new Error("se suscribió al canal de otra sucursal");
  const dePersona = await suscribir(A.dueno.c, "sucursal:" + A.sucursal);
  if (dePersona.estado === "SUBSCRIBED") throw new Error("una persona se suscribió al canal de una sucursal");
  B.avisos = [];
  const deB = await suscribir(B.caja.c, "sucursal:" + B.sucursal, (p) => B.avisos.push(p));
  igual(deB.estado, "SUBSCRIBED", "canal de B");
  return `otra sucursal: ${ajeno.estado}${ajeno.err ? " (" + ajeno.err + ")" : ""}; persona: ${dePersona.estado}`;
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
  A.revocadoEn = Date.now();
  await falla(A.cocina.c.rpc("usuarios_login"), "DISPOSITIVO");
});

if (MEDIR && resultados.every((r) => r.ok)) {
  await paso("revocar: con la conexión abierta, cuánto tarda en dejar de recibir avisos", async () => {
    // cada 10 s un cambio en A; se anota el último aviso que recibe la cocina revocada
    const limite = A.revocadoEn + 15 * 60 * 1000;
    let ultimoRecibido = null, sinRecibir = 0;
    while (Date.now() < limite && sinRecibir < 3) {
      const n = A.avisos.length;
      await datos(A.caja.c.rpc("ajustar_bebida", { p_token: A.token, p_id: "coca", p_delta: 1 }), "cambio");
      await espera(10000);
      if (A.avisos.length > n) { ultimoRecibido = A.avisos.at(-1).t; sinRecibir = 0; } else sinRecibir++;
      process.stdout.write(`  ${Math.round((Date.now() - A.revocadoEn) / 1000)} s: ${A.avisos.length > n ? "recibe" : "no recibe"}\n`);
    }
    if (sinRecibir < 3) throw new Error("siguió recibiendo avisos 15 minutos después de revocar");
    const s = ultimoRecibido ? Math.round((ultimoRecibido - A.revocadoEn) / 1000) : 0;
    return `último aviso recibido ${s} s después de revocar`;
  });
}

for (const X of [A, B]) for (const k of ["caja", "cocina"]) await X[k]?.c.removeAllChannels().catch(() => {});
const fallos = resultados.filter((r) => !r.ok).length;
console.log(`\n${resultados.length - fallos} de ${resultados.length} pasos bien.`);
process.exit(fallos ? 1 : 0);
