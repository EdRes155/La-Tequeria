// Protección para las herramientas que crean y borran bases (DROP DATABASE … WITH (FORCE)):
// las pruebas, el inventario y el ensayo de migración. Solo trabajan sobre un servidor desechable.
//   · Se aceptan servidores locales (localhost, 127.0.0.1, ::1, un socket Unix) o el servicio de la CI
//     (postgres).
//   · Cualquier otro servidor exige declarar TEQUERIA_BASE_DESECHABLE=si.
//   · Un servidor de Supabase se rechaza siempre, se declare lo que se declare.
//   · Solo se crean o borran bases cuyo nombre empieza con tq_.
//
// Lo que se revisa es el destino EFECTIVO: el que el propio cliente de pg calculó a partir de la URL,
// sus parámetros (?host=…) y las variables PG* del entorno. Y se devuelve ese mismo cliente, sin
// conectar, para que no haya forma de validar un servidor y conectarse a otro.
import pg from "pg";

const LOCALES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);

function revisarDestino(host) {
  const h = String(host ?? "").trim().toLowerCase();
  if (!h) throw new Error("No se pudo determinar el servidor de la conexión.");
  if (h.includes(",")) throw new Error(`Se rechaza «${h}»: varias direcciones en una sola conexión.`);
  if (h.includes("supabase")) throw new Error(`Se rechaza ${h}: es un servidor de Supabase, no una base desechable.`);
  if (h.startsWith("/")) return h; // socket Unix: siempre es esta máquina
  if (!LOCALES.has(h) && process.env.TEQUERIA_BASE_DESECHABLE !== "si") {
    throw new Error(`Se rechaza ${h}: solo se borran bases en un servidor local o de CI. `
      + "Si este servidor es desechable, define TEQUERIA_BASE_DESECHABLE=si.");
  }
  return h;
}

export function nombreDesechable(nombre) {
  if (!/^tq_[a-z0-9_]{1,40}$/.test(nombre)) throw new Error(`Nombre de base no permitido: «${nombre}» (solo tq_ seguido de minúsculas, números o _).`);
  return nombre;
}

// Cliente sin conectar hacia el servidor de `url`: a su base administrativa, o a la base desechable
// `base` (tq_…) si se indica. Lanza un error si el destino efectivo no es desechable.
export function clienteDesechable(url, base) {
  if (!url) throw new Error("Falta TEST_DATABASE_URL (servidor PostgreSQL desechable, nunca producción).");
  let u;
  try { u = new URL(url); } catch { throw new Error("TEST_DATABASE_URL no es una URL válida."); }
  if (base) { nombreDesechable(base); u.pathname = "/" + base; }
  const c = new pg.Client({ connectionString: u.toString() });
  const p = c.connectionParameters;
  revisarDestino(p.host);
  if (base && p.database !== base) {
    throw new Error(`La conexión iría a la base «${p.database}» en lugar de «${base}».`);
  }
  return c;
}

// Solo valida (para fallar al inicio, antes de crear nada). Devuelve el servidor efectivo.
export function exigirServidorDesechable(url) {
  return clienteDesechable(url).connectionParameters.host;
}
