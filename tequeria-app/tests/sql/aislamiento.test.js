// Matriz de aislamiento entre sucursales (PLAN-MULTINEGOCIO.md, «Criterio para cerrar el piloto»).
// Cada función de la API tiene aquí sus casos. Quedan pendientes (it.todo) hasta implementar el núcleo
// de docs/multinegocio/MODELO.md; al implementarlos se escriben con los datos de
// tests/fixtures/multinegocio.js. La primera prueba ya está activa: impide que la API tenga una
// función sin casos en esta matriz.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { URL_ADMIN, ESQUEMA, STUB, crearBase, cerrarTodo } from "./util.js";

// sesion: usa la sesión del operador · ids: recibe ids de la app · lista: recibe varias ·
// idem: devuelve lo ya guardado si se repite el id · pin: pide PIN de administrador ·
// futura: aún no existe (la crea el plan)
const MATRIZ = {
  usuarios_login: { casos: ["solo lista el personal de la sucursal del dispositivo"] },
  login: { ids: true, casos: ["un usuario de otra sucursal no entra en este dispositivo", "los fallos cuentan por operador y sucursal, y por dispositivo"] },
  logout: { sesion: true },
  cambiar_pin: { sesion: true },
  estado: { sesion: true, casos: ["todas las partes devuelven solo datos de su sucursal", "el folio y los resúmenes son los de su sucursal"] },
  latido_cocina: { sesion: true, casos: ["la cocina activa es por sucursal"] },
  liberar_cocina: { sesion: true },
  marcar_recibido: { sesion: true, ids: true, lista: true },
  guardar_borrador_mesa: { sesion: true, ids: true, casos: ["«Mesa 1» de otra sucursal no se toca"] },
  liberar_mesa: { sesion: true, ids: true },
  enviar_comanda: { sesion: true, ids: true, idem: true, casos: ["precios, existencias y folio salen de su sucursal"] },
  reenviar_cocina: { sesion: true, ids: true, idem: true },
  cambiar_estado_ticket: { sesion: true, ids: true, casos: ["se retira: la sustituye mover_tickets"] },
  archivar_ticket: { sesion: true, ids: true, casos: ["se retira: la sustituye archivar_tickets"] },
  mover_tickets: { sesion: true, ids: true, lista: true },
  archivar_tickets: { sesion: true, ids: true, lista: true },
  marcar_hecho: { sesion: true, ids: true },
  cobrar: { sesion: true, ids: true, lista: true, idem: true, casos: ["liberar la mesa solo afecta a su sucursal"] },
  no_cobrar: { sesion: true, ids: true, lista: true, pin: true },
  anular_cobro: { sesion: true, ids: true },
  hacer_corte: { sesion: true, pin: true, casos: ["el corte no incluye ni frena tickets, cobros o gastos de otra sucursal"] },
  ajustar_bebida: { sesion: true, ids: true },
  actualizar_bebida: { sesion: true, ids: true },
  agregar_bebida: { sesion: true },
  eliminar_bebida: { sesion: true, ids: true },
  actualizar_carne: { sesion: true, ids: true },
  agregar_carne: { sesion: true, casos: ["«pastor» puede existir en las dos sucursales"] },
  eliminar_carne: { sesion: true, ids: true },
  fijar_precio: { sesion: true },
  fijar_precio_extra: { sesion: true, ids: true },
  agregar_extra: { sesion: true },
  eliminar_extra: { sesion: true, ids: true },
  alternar_oculto: { sesion: true },
  fijar_ajuste: { sesion: true },
  agregar_gasto: { sesion: true, ids: true, idem: true },
  eliminar_gasto: { sesion: true, ids: true },
  crear_usuario: { sesion: true, pin: true },
  eliminar_usuario: { sesion: true, ids: true, pin: true },
  restablecer_pin: { sesion: true, ids: true, pin: true },
  // funciones nuevas del plan
  vincular_dispositivo: { futura: true, casos: ["un código vencido, ya usado o de otra cuenta se rechaza"] },
  desbloquear: { futura: true, sesion: true, casos: ["no reinicia las 12 horas", "el PIN de otro operador no desbloquea"] },
  restablecer_acceso: { futura: true, sesion: true, ids: true, casos: ["solo un administrador de la misma sucursal; queda en bitácora"] },
  generar_codigo: { futura: true, casos: ["solo propietarios o encargados de la cuenta de esa sucursal"] },
  revocar_dispositivo: { futura: true, ids: true, casos: ["el equipo revocado pierde datos de inmediato y avisos en el tiempo máximo medido"] },
};

const casosDe = (f) => [
  ...(f.sesion ? ["rechaza el token de una sesión de otra sucursal", "rechaza un dispositivo revocado"] : []),
  ...(f.ids ? ["trata un id de otra sucursal como inexistente"] : []),
  ...(f.lista ? ["rechaza listas que mezclan ids de dos sucursales"] : []),
  ...(f.idem ? ["un id repetido de otra sucursal no devuelve sus datos"] : []),
  ...(f.pin ? ["no acepta el PIN de un administrador de otra sucursal"] : []),
  ...(f.casos || []),
];

const d = URL_ADMIN ? describe : describe.skip;
d("matriz de aislamiento: cobertura", () => {
  let api = [];
  beforeAll(async () => {
    const sql = await crearBase("tq_matriz", [STUB, ESQUEMA]);
    api = (await sql.query(`select distinct p.proname n from pg_proc p
      where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute') order by 1`)).rows.map((r) => r.n);
  });
  afterAll(cerrarTodo);

  it("cada función de la API tiene casos en la matriz", () => {
    const faltan = api.filter((n) => !MATRIZ[n]);
    expect(faltan, "agrega estas funciones a MATRIZ en tests/sql/aislamiento.test.js").toEqual([]);
  });

  it("la matriz no conserva funciones que ya no existen (salvo las marcadas como futuras)", () => {
    const sobran = Object.keys(MATRIZ).filter((n) => !MATRIZ[n].futura && !api.includes(n));
    expect(sobran).toEqual([]);
  });
});

describe("matriz de aislamiento entre sucursales (pendiente del núcleo multinegocio)", () => {
  for (const [nombre, f] of Object.entries(MATRIZ)) {
    describe(nombre + (f.futura ? " (nueva)" : ""), () => {
      for (const c of casosDe(f)) it.todo(c);
    });
  }
});
