#!/usr/bin/env node
// Tiempo de corte del tiempo real para equipos revocados que NO sueltan la conexión: un cliente modificado que
// ignora DISPOSITIVO y sigue escuchando el canal de su sucursal (la app real lo suelta antes; eso lo mide
// navegador.mjs --medir-corte). Contra STAGING (docs/multinegocio/STAGING.md), nunca producción.
//   node scripts/staging/corte.mjs        → unos 9 min con el JWT de 300 s
//
// Un equipo de CONTROL, vigente, escucha el mismo canal: cada cambio que no le llega invalida la medición
// (una interrupción general no se confunde con un corte). Cuatro equipos se revocan a la vez, cada uno en un
// momento distinto de la renovación de su JWT:
//   justo-antes   su sesión se renueva poco después de revocarlo
//   a-medias      a la mitad de la vigencia
//   recien        recién emitida: el peor caso para un cliente que renueva
//   token-fijo    recién emitida, y el canal se abre con ese JWT fijo: el cliente nunca manda otro, así que el
//                 corte depende solo de que el servidor cierre el canal al vencer el JWT. (Con supabase-js no
//                 basta apagar la renovación automática: el tiempo real pide el JWT en cada latido y supabase-js
//                 lo renueva si le faltan menos de 90 s.)
// Un cambio cada 5 s. Para cada equipo se comprueba que recibía antes de revocarlo, que deja de recibir y no
// vuelve a recibir, y que su último aviso, con la hora real en que llegó, cae dentro del máximo acordado de
// 300 s (estricto; si el JWT de staging pasa de 300 s, el ensayo falla antes de empezar) y antes de que venza
// el JWT que tenía al revocarlo (más 2 s para un aviso que ya iba en camino).
import { createClient } from "@supabase/supabase-js";
import { abrirStaging, administracion, cliente, datos, suscribir, espera, cuentaDePrueba, PIN_PRUEBA, URL_PROYECTO, conCaptcha } from "./comun.mjs";

const { ANON, SERVICIO } = await abrirStaging({ servicio: true });
const auth = await administracion("/config/auth");
// Máximo acordado (MODELO.md §4): ningún equipo revocado recibe avisos más de 300 s después de revocarlo. Se
// comprueba contra este número fijo, no contra la configuración: si staging tuviera un JWT más largo, falla.
const LIMITE = 300;   // s
const JWT = auth.jwt_exp;   // s: vigencia configurada
const PERIODO = 5000;
// El servidor cierra el canal cuando vence el JWT; un aviso que ya iba en camino puede llegar unos cientos de
// milisegundos después. Solo para comprobar el vencimiento del JWT de cada equipo; el límite es estricto.
const ENTREGA = 2;   // s
const s = (ms) => Math.round(ms / 1000);
console.log(`Staging ${new Date().toISOString()} · JWT de ${JWT} s · máximo acordado ${LIMITE} s · un cambio cada ${PERIODO / 1000} s\n`);
if (!(JWT > 0 && JWT <= LIMITE)) { console.error(`✗ La vigencia del JWT de staging es de ${JWT} s; el máximo acordado es ${LIMITE} s.`); process.exit(1); }

// --- Cuenta, sucursal, administrador y equipos -------------------------------------------------------
const C = await cuentaDePrueba({ ANON, SERVICIO }, "C");
const TOPIC = "sucursal:" + C.sucursal;

async function vincular(nombre, { fijo = false } = {}) {
  const codigo = await C.codigo();
  const c = cliente(ANON, { renovar: !fijo });
  const ses = await datos(c.auth.signInAnonymously(conCaptcha), "sesión anónima");
  const v = await datos(c.rpc("vincular_dispositivo", { p_codigo: codigo, p_nombre: nombre }), "vincular");
  if (!v.ok) throw new Error(JSON.stringify(v));
  // token-fijo: otro cliente que siempre entrega el mismo JWT (no puede renovarlo: no tiene la sesión)
  const jwt = ses.session.access_token;
  const canal = fijo ? createClient(URL_PROYECTO, ANON, { accessToken: async () => jwt }) : c;
  const e = { nombre, c: canal, dispositivo: v.dispositivo.id, vence: ses.session.expires_at * 1000, avisos: [], estados: [], renovaciones: [] };
  if (!fijo) c.auth.onAuthStateChange((ev, sesion) => {
    if (ev === "TOKEN_REFRESHED") { e.renovaciones.push(Date.now()); e.vence = sesion.expires_at * 1000; }
  });
  return e;
}
async function receptor(nombre, opciones) {
  const e = await vincular(nombre, opciones);
  const r = await suscribir(e.c, TOPIC, () => e.avisos.push(Date.now()), { alEstado: (st, err) => e.estados.push({ t: Date.now(), st, err }) });
  if (r.estado !== "SUBSCRIBED") throw new Error(`${nombre} no se suscribió: ${r.estado} ${r.err || ""}`);
  e.desde = Date.now();
  console.log(`  ${nombre}: escuchando (su JWT vence en ${s(e.vence - Date.now())} s)`);
  return e;
}

const caja = await vincular("caja");
const login = await datos(caja.c.rpc("login", { p_id: C.admin, p_pin: PIN_PRUEBA, p_dispositivo: "corte" }), "login");
if (!login.ok) throw new Error(JSON.stringify(login));
const control = await receptor("control");
const revocados = [];
const todos = () => [control, ...revocados];

// Un cambio y, 5 s después, quién lo recibió
const cambios = [];
let signo = 1;
async function ciclo() {
  const antes = new Map(todos().map((e) => [e.nombre, e.avisos.length]));
  const t = Date.now();
  await datos(caja.c.rpc("ajustar_bebida", { p_token: login.token, p_id: "coca", p_delta: (signo = -signo) }), "cambio");
  await espera(PERIODO);
  cambios.push({ t, recibio: Object.fromEntries(todos().filter((e) => antes.has(e.nombre)).map((e) => [e.nombre, e.avisos.length > antes.get(e.nombre)])) });
}

// --- Equipos en distintos momentos de la renovación ---------------------------------------------------
// supabase-js renueva cuando faltan menos de 120 s (4 ciclos de 30 s): con 300 s, a los 180–210 s de edad
const t0 = Date.now();
const EDAD_JUSTO_ANTES = Math.max(JWT - 130, 0) * 1000;
revocados.push(await receptor("justo-antes"));
while (Date.now() < t0 + EDAD_JUSTO_ANTES / 2) await ciclo();
revocados.push(await receptor("a-medias"));
while (Date.now() < t0 + EDAD_JUSTO_ANTES - 12000) await ciclo();
revocados.push(await receptor("recien"));
revocados.push(await receptor("token-fijo", { fijo: true }));
await ciclo(); await ciclo();

// --- Revocar a los cuatro ----------------------------------------------------------------------------
for (const e of revocados) {
  await C.revocar(e.dispositivo);
  e.revocado = Date.now();
  e.venceAlRevocar = e.vence;
  e.edadAlRevocar = e.revocado - (e.vence - JWT * 1000);
}
const T = Date.now();
console.log(`\nRevocados a las ${new Date(T).toISOString()}; se sigue cambiando cada 5 s hasta ${LIMITE + 60} s después.\n`);
let mostrado = 0;
while (Date.now() < T + (LIMITE + 60) * 1000) {
  await ciclo();
  if (Date.now() - mostrado > 30000) {
    mostrado = Date.now();
    const c = cambios.at(-1);
    console.log(`  ${s(c.t - T)} s: ` + todos().map((e) => `${e.nombre} ${c.recibio[e.nombre] ? "recibe" : "—"}`).join(" · "));
  }
}

// --- Resultados --------------------------------------------------------------------------------------
let fallos = 0;
const mal = (m) => { fallos++; console.log("✗ " + m); };
const bien = (m) => console.log("✓ " + m);
const perdidosControl = cambios.filter((c) => c.recibio.control === false);
if (perdidosControl.length) mal(`el control no recibió ${perdidosControl.length} de ${cambios.length} cambios (${perdidosControl.map((c) => s(c.t - T) + " s").join(", ")}): medición inválida`);
else bien(`control: recibió los ${cambios.length} cambios (sin interrupciones generales)`);
console.log("");
for (const e of revocados) {
  const antes = cambios.filter((c) => c.t >= e.desde && c.t < e.revocado && e.nombre in c.recibio);
  const despues = cambios.filter((c) => c.t >= e.revocado && c.recibio.control);
  // el primer cambio que le llegó al control y a este equipo ya no
  const primerFalta = despues.find((c) => !c.recibio[e.nombre]);
  // con la hora real en que llegó cada aviso (no la de envío del cambio)
  const recibidos = e.avisos.filter((t) => t >= e.revocado);
  const ultimo = recibidos.at(-1);
  const vuelve = primerFalta && recibidos.some((t) => t >= primerFalta.t + PERIODO);
  const corte = ultimo ? (ultimo - e.revocado) / 1000 : 0;
  const cota = (e.venceAlRevocar - e.revocado) / 1000;
  const errores = [...new Set(e.estados.filter((x) => x.t >= e.revocado && x.st !== "SUBSCRIBED").map((x) => `${x.st}${x.err ? ": " + x.err.split(":")[0] : ""}`))];
  const renov = e.renovaciones.filter((t) => t >= e.revocado).map((t) => s(t - e.revocado) + " s");
  console.log(`${e.nombre}: JWT con ${s(e.edadAlRevocar)} s de edad al revocar (vencía en ${Math.round(cota)} s)` +
    `${renov.length ? `; renovó a los ${renov.join(", ")}` : e.nombre === "token-fijo" ? "; nunca manda otro JWT" : "; no renovó"}; último aviso recibido a los ${corte.toFixed(1)} s` +
    `${primerFalta ? `; ya no le llegó el cambio de los ${s(primerFalta.t - e.revocado)} s` : ""}${errores.length ? `; el canal respondió ${errores.join(", ")}` : ""}`);
  if (antes.length === 0 || antes.some((c) => !c.recibio[e.nombre])) mal(`${e.nombre}: no recibía todos los avisos antes de revocarlo (${antes.filter((c) => c.recibio[e.nombre]).length} de ${antes.length})`);
  else if (!primerFalta || despues.filter((c) => c.t >= primerFalta.t).length < 6) mal(`${e.nombre}: seguía recibiendo al terminar`);
  else if (vuelve) mal(`${e.nombre}: dejó de recibir y volvió a recibir`);
  else if (corte > LIMITE) mal(`${e.nombre}: recibió un aviso ${corte.toFixed(1)} s después de revocarlo, más que el máximo de ${LIMITE} s`);
  else if (corte > cota + ENTREGA) mal(`${e.nombre}: recibió un aviso después de que venciera el JWT que tenía al revocarlo (${corte.toFixed(1)} s > ${cota.toFixed(1)} s +${ENTREGA})`);
  else bien(`${e.nombre}: último aviso recibido a los ${corte.toFixed(1)} s, dentro del máximo de ${LIMITE} s y del vencimiento de su JWT (${cota.toFixed(1)} s, +${ENTREGA} de entrega)`);
}
for (const e of [caja, ...todos()]) await e.c.removeAllChannels().catch(() => {});
console.log(fallos ? `\n${fallos} comprobación(es) fallaron.` : "\nTodas las comprobaciones bien.");
process.exit(fallos ? 1 : 0);
