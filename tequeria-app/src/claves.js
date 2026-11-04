/* ============================================================
   Claves del navegador por sucursal (docs/multinegocio/MODELO.md §8).
   · Toda preferencia o dato guardado por la app lleva la sucursal del equipo:
     «tequeria:<sucursal>:<nombre>» (papel, estación, sonido del monitor,
     último usuario, sesión del operador…).
   · La sucursal la dice el servidor en la pantalla de entrada (usuarios_login);
     se recuerda en «tequeria:sucursal» para la siguiente carga.
   · Si el equipo aparece en otra sucursal, se borran las claves de la anterior.
   · Si deja de estar autorizado (revocado), se borra todo lo de la app.
   · Las claves de antes (una sola sucursal, «tequeria_*») se pasan una vez a la
     sucursal del equipo y se borran.
   El modo local usa la sucursal «local».
   ============================================================ */
const PREFIJO = "tequeria:";
const SUCURSAL_KEY = PREFIJO + "sucursal";
export const ANTERIORES = {
  tequeria_papel: "papel", tequeria_estacion: "estacion", tequeria_autoprint: "autoprint",
  tequeria_monitor_sonido: "monitor_sonido", tequeria_ultimo_usuario: "ultimo_usuario",
};
// De antes y sin equivalente: la sesión de operador anterior ya no sirve (se revocó al migrar)
const OBSOLETAS = ["tequeria_sesion", "tequeria_cocina_sid"];

const almacenes = () => [globalThis.localStorage, globalThis.sessionStorage].filter(Boolean);
const llaves = (s) => { const r = []; try { for (let i = 0; i < s.length; i++) r.push(s.key(i)); } catch {} return r.filter(Boolean); };
const quitar = (filtro) => {
  for (const s of almacenes()) for (const k of llaves(s)) if (filtro(k)) { try { s.removeItem(k); } catch {} }
};

let sucursal = (() => { try { return globalThis.localStorage?.getItem(SUCURSAL_KEY) || null; } catch { return null; } })();

export const sucursalActual = () => sucursal;
export const clave = (nombre) => `${PREFIJO}${sucursal || "sin-sucursal"}:${nombre}`;

// El servidor dijo de qué sucursal es este equipo. Devuelve true si cambió (otra sucursal que la anterior).
export function cambiarSucursal(id) {
  if (!id) return false;
  const antes = sucursal;
  if (antes && antes !== id) quitar((k) => k.startsWith(`${PREFIJO}${antes}:`));
  sucursal = id;
  try { globalThis.localStorage?.setItem(SUCURSAL_KEY, id); } catch {}
  try {
    const ls = globalThis.localStorage;
    for (const [vieja, nombre] of Object.entries(ANTERIORES)) {
      const v = ls?.getItem(vieja);
      if (v == null) continue;
      if (ls.getItem(clave(nombre)) == null) ls.setItem(clave(nombre), v);
      ls.removeItem(vieja);
    }
    for (const vieja of OBSOLETAS) { ls?.removeItem(vieja); globalThis.sessionStorage?.removeItem(vieja); }
  } catch {}
  return Boolean(antes && antes !== id);
}

// El equipo dejó de estar autorizado: se borra todo lo de la app en este navegador (salvo los datos del
// modo local, que no son de ningún servidor)
export function borrarTodo() {
  sucursal = null;
  quitar((k) => k.startsWith(PREFIJO) || k in ANTERIORES || OBSOLETAS.includes(k) || k === "tequeria_dispositivo");
}

// Lectura y escritura de texto, sin fallar si el navegador no deja guardar
export function leer(nombre, almacen = globalThis.localStorage) {
  try { return almacen?.getItem(clave(nombre)) ?? null; } catch { return null; }
}
export function guardar(nombre, valor, almacen = globalThis.localStorage) {
  try { valor == null ? almacen?.removeItem(clave(nombre)) : almacen?.setItem(clave(nombre), String(valor)); } catch {}
}
export const leerJson = (nombre, def, almacen) => { try { const v = leer(nombre, almacen); return v == null ? def : JSON.parse(v); } catch { return def; } };
export const guardarJson = (nombre, valor, almacen) => guardar(nombre, valor == null ? null : JSON.stringify(valor), almacen);
