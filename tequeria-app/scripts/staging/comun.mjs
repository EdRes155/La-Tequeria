// Lo común de los scripts de staging (docs/multinegocio/STAGING.md). Nunca contra producción.
// El token de administración de Supabase lo inyecta el proxy del entorno en api.supabase.com. Las llaves del
// proyecto se leen de esa API y solo viven en memoria: nada se imprime ni se guarda.
import { createClient } from "@supabase/supabase-js";

export const REF = process.env.STAGING_REF || "izcaeojzbaoqlxkerria";
const PRODUCCION = new Set(["ahmkfmoftpvhdcrjnhoe"]);
export const ADMIN_API = `https://api.supabase.com/v1/projects/${REF}`;
export const URL_PROYECTO = `https://${REF}.supabase.co`;
export const espera = (ms) => new Promise((r) => setTimeout(r, ms));
// única por ejecución: los correos de prueba no se repiten
export const marca = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14) + Math.random().toString(36).slice(2, 6);

export async function administracion(ruta, { metodo = "GET", cuerpo } = {}) {
  const r = await fetch(ADMIN_API + ruta, { method: metodo,
    headers: { Authorization: "Bearer proxy-injected", "Content-Type": "application/json" }, body: cuerpo && JSON.stringify(cuerpo) });
  if (!r.ok) throw new Error(`API de administración ${metodo} ${ruta}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
export const sql = (query) => administracion("/database/query", { metodo: "POST", cuerpo: { query } });

// Guardia: solo un proyecto que se llame «staging» y no sea el de producción. Devuelve las llaves.
export async function abrirStaging({ servicio = false } = {}) {
  const proyecto = await administracion("");
  if (PRODUCCION.has(REF) || !/staging/i.test(proyecto.name)) {
    console.error(`Se niega: ${REF} («${proyecto.name}») no es un proyecto de staging.`);
    process.exit(2);
  }
  const llaves = await administracion(`/api-keys?reveal=${servicio}`);
  const ANON = llaves.find((k) => k.name === "anon")?.api_key;
  const SERVICIO = servicio ? llaves.find((k) => k.name === "service_role")?.api_key : null;
  if (!ANON || (servicio && !SERVICIO)) { console.error("No se encontraron las llaves del proyecto."); process.exit(2); }
  return { proyecto, ANON, SERVICIO };
}

export const cliente = (ANON, { renovar = true } = {}) =>
  createClient(URL_PROYECTO, ANON, { auth: { persistSession: false, autoRefreshToken: renovar } });

export async function datos(promesa, que) {
  const { data, error } = await promesa;
  if (error) throw new Error(`${que}: ${error.code} ${error.message} ${error.hint || ""}`);
  return data;
}

// Se suscribe al canal y espera el resultado (SUBSCRIBED o el error). privado: false para probar un canal público.
export function suscribir(c, topic, alAviso = () => {}, { privado = true, alEstado = () => {} } = {}) {
  return new Promise((ok) => {
    let resuelto = false;
    const ch = c.channel(topic, { config: { private: privado } }).on("broadcast", { event: "cambio" }, (m) => alAviso(m.payload));
    const reloj = setTimeout(() => { resuelto = true; ok({ ch, estado: "SIN_RESPUESTA" }); }, 15000);
    c.realtime.setAuth().finally(() => ch.subscribe((estado, err) => {
      alEstado(estado, err?.message);
      if (!resuelto && (estado === "SUBSCRIBED" || estado === "CHANNEL_ERROR" || estado === "TIMED_OUT" || estado === "CLOSED")) {
        resuelto = true; clearTimeout(reloj); ok({ ch, estado, err: err?.message });
      }
    }));
  });
}

// Pasos numerados con resultado; el script termina con 1 si alguno falló
export function pasos() {
  const resultados = [];
  return {
    resultados,
    async paso(nombre, fn) {
      try { const extra = await fn(); resultados.push({ nombre, ok: true }); console.log(`✓ ${nombre}${extra ? " — " + extra : ""}`); }
      catch (e) { resultados.push({ nombre, ok: false }); console.log(`✗ ${nombre} — ${e.message}`); }
    },
    terminar() {
      const fallos = resultados.filter((r) => !r.ok).length;
      console.log(`\n${resultados.length - fallos} de ${resultados.length} pasos bien.`);
      process.exit(fallos || !resultados.length ? 1 : 0);
    },
  };
}
export function igual(a, b, que) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${que}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); }

// Una cuenta nueva con su sucursal («Centro <letra>») y su administrador («Admin <letra>», PIN 583920), creada
// por una dueña con el correo confirmado (la service_role solo vive en memoria para crearla).
export const PIN_PRUEBA = "583920";
export async function cuentaDePrueba({ ANON, SERVICIO }, letra) {
  const servicio = createClient(URL_PROYECTO, SERVICIO, { auth: { persistSession: false, autoRefreshToken: false } });
  const correo = `duena-${letra.toLowerCase()}.${marca}@ejemplo.invalid`, clave = crypto.randomUUID();
  await datos(servicio.auth.admin.createUser({ email: correo, password: clave, email_confirm: true }), "crear dueña");
  const duena = cliente(ANON);
  await datos(duena.auth.signInWithPassword({ email: correo, password: clave }), "entrar con correo");
  const alta = await datos(duena.rpc("crear_cuenta", { p_nombre: `Prueba ${letra} ${marca}`, p_sucursal: `Centro ${letra}`,
    p_zona_horaria: "America/Mexico_City", p_admin_nombre: `Admin ${letra}`, p_admin_pin: PIN_PRUEBA }), "crear_cuenta");
  if (!alta.ok) throw new Error(JSON.stringify(alta));
  const X = { duena, cuenta: alta.cuenta.id, sucursal: alta.sucursal.id, admin: alta.admin.id, adminNombre: `Admin ${letra}` };
  X.codigo = async () => (await datos(duena.rpc("generar_codigo", { p_cuenta: X.cuenta, p_sucursal: X.sucursal, p_monitor: false }), "generar_codigo")).codigo;
  X.revocar = async (dispositivo) => {
    const r = await datos(duena.rpc("revocar_dispositivo", { p_cuenta: X.cuenta, p_dispositivo: dispositivo }), "revocar");
    if (!r.ok) throw new Error(JSON.stringify(r));
  };
  return X;
}
