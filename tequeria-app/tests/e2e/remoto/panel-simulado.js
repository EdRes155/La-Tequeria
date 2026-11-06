// Funciones de dueños simuladas (supabase-schema.sql, MODELO.md §3.3) para los recorridos del panel: cuentas,
// sucursales, miembros, invitaciones, códigos y equipos en memoria, con las mismas respuestas que el servidor.
// La persona que llama sale del JWT (claims.email): la del panel, no la identidad de un equipo.
import { PIN_NUEVO_RE, pinDebil } from "../../../src/dominio.js";
import { errorDe } from "./servidor-simulado.js";

export function panelSimulado() {
  let n = 0;
  const nuevo = (p) => `${p}-${++n}`;
  const m = { cuentas: [], sucursales: [], miembros: [], invitaciones: [], equipos: [], codigos: [], admins: [] };
  const miembro = (cuenta, correo) => m.miembros.find((x) => x.cuenta === cuenta && x.correo === correo);
  // como _dueno: sin membresía, CUENTA; con un rol que no alcanza, PERMISO
  const dueno = (c, roles = ["propietario"]) => {
    const x = miembro(c.p_cuenta, c.correo);
    if (!x) return { error: errorDe("CUENTA", "No tienes acceso a esa cuenta.") };
    if (!roles.includes(x.rol)) return { error: errorDe("PERMISO", "Solo un propietario puede hacer eso.") };
    return { x };
  };
  const conDueno = (roles, f) => (a, quien, claims) => {
    if (!claims.email || claims.is_anonymous) return errorDe("IDENTIDAD", "Entra con un correo verificado.");
    const d = dueno({ ...a, correo: claims.email }, roles);
    return d.error || f(a, claims.email, d.x);
  };
  const pinMal = (pin) => (!PIN_NUEVO_RE.test(pin || "") ? "formato" : pinDebil(pin) ? "debil" : null);
  const crearSuc = (cuenta, nombre, adminNombre) => {
    const s = { id: nuevo("suc"), cuenta, nombre, activa: true };
    m.sucursales.push(s);
    m.admins.push({ sucursal: s.id, nombre: adminNombre });
    return s;
  };
  const respuestas = {
    mis_cuentas: (a, q, claims) => ({ correo: claims.email, cuentas: m.miembros.filter((x) => x.correo === claims.email).map((x) => {
      const c = m.cuentas.find((k) => k.id === x.cuenta);
      return { id: c.id, nombre: c.nombre, estado: c.estado, rol: x.rol,
        sucursales: m.sucursales.filter((s) => s.cuenta === c.id).map(({ id, nombre, activa }) => ({ id, nombre, activa })) };
    }) }),
    crear_cuenta: (a, q, claims) => {
      if (!a.p_nombre?.trim()) return { ok: false, error: "nombre" };
      if (!a.p_admin_nombre?.trim()) return { ok: false, error: "admin_nombre" };
      const mal = pinMal(a.p_admin_pin);
      if (mal) return { ok: false, error: mal };
      const c = { id: nuevo("cuenta"), nombre: a.p_nombre, estado: "activa" };
      m.cuentas.push(c);
      m.miembros.push({ id: "p-" + claims.email, cuenta: c.id, correo: claims.email, rol: "propietario" });
      const s = crearSuc(c.id, a.p_sucursal || a.p_nombre, a.p_admin_nombre);   // sin nombre, el del negocio
      return { ok: true, cuenta: { id: c.id, nombre: c.nombre }, sucursal: { id: s.id, nombre: s.nombre }, admin: { id: nuevo("u"), nombre: a.p_admin_nombre } };
    },
    crear_sucursal: conDueno(["propietario"], (a) => {
      if (!a.p_nombre?.trim()) return { ok: false, error: "nombre" };
      const mal = pinMal(a.p_admin_pin);
      if (mal) return { ok: false, error: mal };
      const s = crearSuc(a.p_cuenta, a.p_nombre, a.p_admin_nombre);
      return { ok: true, sucursal: { id: s.id, nombre: s.nombre }, admin: { id: nuevo("u"), nombre: a.p_admin_nombre } };
    }),
    crear_administrador: conDueno(["propietario"], (a) => {
      const mal = pinMal(a.p_pin);
      if (mal) return { ok: false, error: mal };
      m.admins.push({ sucursal: a.p_sucursal, nombre: a.p_nombre });
      return { ok: true, admin: { id: nuevo("u"), nombre: a.p_nombre } };
    }),
    listar_miembros: conDueno(["propietario", "encargado"], (a, correo) => ({ ok: true,
      miembros: m.miembros.filter((x) => x.cuenta === a.p_cuenta).map((x) => ({ id: x.id, correo: x.correo, rol: x.rol, yo: x.correo === correo })),
      invitaciones: m.invitaciones.filter((v) => v.cuenta === a.p_cuenta && !v.usada && !v.cancelada).map(({ id, correo: c, rol, vence }) => ({ id, correo: c, rol, vence })) })),
    invitar_miembro: conDueno(["propietario"], (a) => {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.p_correo || "")) return { ok: false, error: "correo" };
      if (miembro(a.p_cuenta, a.p_correo)) return { ok: false, error: "ya_miembro" };
      const v = { id: nuevo("inv"), cuenta: a.p_cuenta, correo: a.p_correo.toLowerCase(), rol: a.p_rol, token: nuevo("clave"),
        vence: new Date(Date.now() + 7 * 864e5).toISOString() };
      m.invitaciones.push(v);
      return { ok: true, token: v.token, invitacion: { id: v.id, correo: v.correo, rol: v.rol, vence: v.vence } };
    }),
    cancelar_invitacion: conDueno(["propietario"], (a) => {
      const v = m.invitaciones.find((x) => x.id === a.p_invitacion && x.cuenta === a.p_cuenta);
      if (!v) return { ok: false, error: "no_existe" };
      v.cancelada = true;
      return { ok: true };
    }),
    quitar_miembro: conDueno(["propietario"], (a) => {
      const x = m.miembros.find((k) => k.id === a.p_miembro && k.cuenta === a.p_cuenta);
      if (!x) return { ok: false, error: "no_existe" };
      if (x.rol === "propietario" && m.miembros.filter((k) => k.cuenta === a.p_cuenta && k.rol === "propietario").length === 1) return { ok: false, error: "ultimo_propietario" };
      m.miembros = m.miembros.filter((k) => k !== x);
      return { ok: true };
    }),
    aceptar_invitacion: (a, q, claims) => {
      const v = m.invitaciones.find((x) => x.token === a.p_clave && !x.usada && !x.cancelada && x.correo === claims.email);
      if (!v) return errorDe("INVITACION", "La invitación no es válida.");
      v.usada = true;
      m.miembros.push({ id: "p-" + claims.email, cuenta: v.cuenta, correo: claims.email, rol: v.rol });
      return { ok: true, cuenta: { id: v.cuenta, rol: v.rol } };
    },
    generar_codigo: conDueno(["propietario", "encargado"], (a) => {
      if (!m.sucursales.some((s) => s.id === a.p_sucursal && s.cuenta === a.p_cuenta)) return { ok: false, error: "no_existe" };
      const codigo = "ABCD" + String(2345 + m.codigos.length);
      m.codigos.push({ codigo, sucursal: a.p_sucursal, monitor: !!a.p_monitor });
      return { ok: true, codigo, vence: new Date(Date.now() + 600e3).toISOString(), monitorCocina: !!a.p_monitor };
    }),
    listar_dispositivos: conDueno(["propietario", "encargado"], (a) => ({ ok: true,
      dispositivos: m.equipos.filter((d) => d.cuenta === a.p_cuenta && (!a.p_sucursal || d.sucursal === a.p_sucursal)).map((d) => ({
        id: d.id, nombre: d.nombre, sucursal: { id: d.sucursal, nombre: m.sucursales.find((s) => s.id === d.sucursal)?.nombre },
        monitorCocina: d.monitor, creado: d.creado, ultimoUso: d.creado, aprobadoPor: d.aprobadoPor, revocadoEn: d.revocadoEn || null })) })),
    revocar_dispositivo: conDueno(["propietario", "encargado"], (a) => {
      const d = m.equipos.find((x) => x.id === a.p_dispositivo && x.cuenta === a.p_cuenta);
      if (!d) return { ok: false, error: "no_existe" };
      const ya = !!d.revocadoEn;
      d.revocadoEn = d.revocadoEn || new Date().toISOString();
      return { ok: true, yaRevocado: ya };
    }),
  };
  // Un equipo se vincula con el último código de la sucursal (lo que haría vincular_dispositivo)
  const vincularEquipo = (nombre, aprobadoPor) => {
    const c = m.codigos.at(-1);
    const s = m.sucursales.find((x) => x.id === c.sucursal);
    const d = { id: nuevo("disp"), cuenta: s.cuenta, sucursal: s.id, nombre, monitor: c.monitor, creado: new Date().toISOString(), aprobadoPor };
    m.equipos.push(d);
    return d;
  };
  return { respuestas, modelo: m, vincularEquipo };
}
