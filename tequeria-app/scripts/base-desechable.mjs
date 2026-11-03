// Protección para las herramientas que crean y borran bases (DROP DATABASE … WITH (FORCE)):
// las pruebas, el inventario y el ensayo de migración. Solo trabajan sobre un servidor desechable.
//   · Se aceptan servidores locales o el servicio de la CI (localhost, 127.0.0.1, ::1, postgres).
//   · Cualquier otro servidor exige declarar TEQUERIA_BASE_DESECHABLE=si.
//   · Un servidor de Supabase se rechaza siempre, se declare lo que se declare.
//   · Solo se crean o borran bases cuyo nombre empieza con tq_.
const LOCALES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);

export function exigirServidorDesechable(url) {
  if (!url) throw new Error("Falta TEST_DATABASE_URL (servidor PostgreSQL desechable, nunca producción).");
  let u;
  try { u = new URL(url); } catch { throw new Error("TEST_DATABASE_URL no es una URL válida."); }
  const host = u.hostname.toLowerCase();
  if (/(^|\.)supabase\.(co|com|net|in)$/.test(host) || host.includes("supabase")) {
    throw new Error(`Se rechaza ${host}: es un servidor de Supabase, no una base desechable.`);
  }
  if (!LOCALES.has(host) && process.env.TEQUERIA_BASE_DESECHABLE !== "si") {
    throw new Error(`Se rechaza ${host}: solo se borran bases en un servidor local o de CI. `
      + "Si este servidor es desechable, define TEQUERIA_BASE_DESECHABLE=si.");
  }
  return u;
}

export function nombreDesechable(nombre) {
  if (!/^tq_[a-z0-9_]{1,40}$/.test(nombre)) throw new Error(`Nombre de base no permitido: «${nombre}» (solo tq_ seguido de minúsculas, números o _).`);
  return nombre;
}
