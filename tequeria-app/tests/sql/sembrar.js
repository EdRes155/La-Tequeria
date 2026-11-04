// Siembra las cuentas de tests/fixtures/multinegocio.js en una base con el esquema, con SQL directo para
// que cada sucursal tenga exactamente el catálogo de la fixture: cuenta activa con sus dueños, y por
// sucursal su configuración, catálogo, mesas, personal (con PIN) y equipos vinculados. El alta real
// (crear_cuenta, generar_codigo, vincular_dispositivo…) se prueba en tests/sql/duenos.test.js.
// Cada llamada usa su propia copia de las fixtures.
import { randomBytes } from "node:crypto";
import { crearCuentas } from "../fixtures/multinegocio.js";
import { vincularDePrueba } from "./util.js";

export async function sembrar(sql, cuentas = crearCuentas()) {
  const res = {};
  for (const c of cuentas) {
    await sql.query("begin");
    const cuenta = (await sql.query("insert into public.cuentas (nombre) values ($1) returning id", [c.nombre])).rows[0].id;
    const duenos = {};
    for (const d of c.duenos) {
      const u = (await sql.query("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [d.correo])).rows[0].id;
      await sql.query("insert into public.membresias (cuenta_id, auth_user_id, rol) values ($1, $2, $3)", [cuenta, u, d.rol]);
      duenos[d.rol] = { authUid: u, correo: d.correo };
    }
    await sql.query("update public.cuentas set estado = 'activa', activada_en = now() where id = $1", [cuenta]);
    await sql.query("commit");
    for (const s of c.sucursales) {
      const id = (await sql.query("insert into public.sucursales (cuenta_id, nombre, zona_horaria) values ($1, $2, $3) returning id",
        [cuenta, s.nombre, s.zonaHoraria])).rows[0].id;
      await sql.query(`insert into public.config (sucursal_id, nombre_negocio, precios, extras, ocultos, ajustes)
        values ($1, $2, $3, '[]', '[]', '{}')`, [id, s.nombre, JSON.stringify(s.precios)]);
      await sql.query("insert into public.cocina_sesion (sucursal_id) values ($1)", [id]);
      await sql.query("insert into public.mesas (sucursal_id, id, estado) select $1, g, 'libre' from generate_series(1, $2::int) g", [id, s.mesas]);
      for (const [i, k] of s.carnes.entries()) {
        await sql.query("insert into public.carnes (sucursal_id, id, nombre, activo, orden) values ($1, $2, $3, true, $4)",
          [id, k, k[0].toUpperCase() + k.slice(1), i]);
      }
      for (const b of s.bebidas) {
        await sql.query("insert into public.bebidas (sucursal_id, id, nombre, cantidad, activo, precio) values ($1, $2, $3, $4, true, $5)",
          [id, b.id, b.nombre, b.cantidad, b.precio]);
      }
      const personal = {};
      for (const p of s.personal) {
        const uid = randomBytes(6).toString("hex");
        await sql.query(`insert into public.usuarios (id, sucursal_id, nombre, rol, pin_hash, politica_pin, pin_cambiado_en)
          values ($1, $2, $3, $4, public._hash_pin($5), 1, now())`, [uid, id, p.nombre, p.rol, p.pin]);
        personal[p.rol] = { id: uid, nombre: p.nombre, pin: p.pin };
      }
      const equipos = {};
      for (const d of s.dispositivos) {
        equipos[d.monitorCocina ? "cocina" : "caja"] = await vincularDePrueba(sql, { sucursal: id, nombre: d.nombre, monitor: d.monitorCocina });
      }
      res[s.clave] = { id, cuenta, sucursal: s, personal, equipos, duenos };
    }
  }
  return res;
}
