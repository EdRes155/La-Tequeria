// Matriz de aislamiento entre sucursales (PLAN-MULTINEGOCIO.md, «Criterio para cerrar el piloto»).
// La llave es la firma completa, como la da el catálogo: nombre(tipos de los argumentos). Así una
// sobrecarga nueva (otra versión de estado, por ejemplo) necesita su propia entrada.
// Las marcas siguen a los validadores de docs/multinegocio/MODELO.md §3:
//   dispositivo: _dispositivo (equipo vinculado, sin operador) · sesion: _contexto (equipo + operador) ·
//   identidad: _identidad (persona, sin membresía) · dueno: _dueno (persona con membresía) ·
//   ids: recibe ids de la app · lista: recibe varias · idem: devuelve lo ya guardado si se repite el id ·
//   pin: pide PIN de administrador · casos: casos propios ·
//   futura: aún no existe (la crea el plan; la llave es solo el nombre)
// Un caso que termina en «(paso N)» depende de un paso posterior del plan y queda pendiente hasta entonces.
// Las pruebas están en tests/sql/aislamiento.test.js.

export const MATRIZ = {
  "usuarios_login()": { dispositivo: true, casos: ["solo lista el personal de la sucursal del dispositivo"] },
  "login(text, text, text)": { dispositivo: true, ids: true, casos: [
    "un usuario de otra sucursal no entra en este equipo",
    "los fallos en otra sucursal no bloquean al operador",
    "los fallos cuentan también por equipo (paso 3)",
  ] },
  "logout(text)": { sesion: true },
  "cambiar_pin(text, text, text)": { sesion: true },
  "estado(text, text[])": { sesion: true, casos: ["todas las partes devuelven solo datos de su sucursal", "el folio y los resúmenes son los de su sucursal"] },
  "latido_cocina(text)": { sesion: true, casos: ["la cocina activa es por sucursal"] },
  "liberar_cocina(text)": { sesion: true },
  "marcar_recibido(text, text[])": { sesion: true, ids: true, lista: true },
  "guardar_borrador_mesa(text, integer, jsonb, integer)": { sesion: true, ids: true, casos: ["«Mesa 1» de otra sucursal no se toca"] },
  "liberar_mesa(text, integer)": { sesion: true, ids: true },
  "enviar_comanda(text, jsonb)": { sesion: true, ids: true, idem: true, casos: ["precios, existencias y folio salen de su sucursal"] },
  "reenviar_cocina(text, text, integer)": { sesion: true, ids: true, idem: true },
  "mover_tickets(text, jsonb, text)": { sesion: true, ids: true, lista: true },
  "archivar_tickets(text, text[])": { sesion: true, ids: true, lista: true },
  "marcar_hecho(text, text, text, boolean)": { sesion: true, ids: true },
  "cobrar(text, text, text[], text, numeric, numeric, boolean)": { sesion: true, ids: true, lista: true, idem: true, casos: ["liberar la mesa solo afecta a su sucursal"] },
  "no_cobrar(text, text, text[], text, boolean)": { sesion: true, ids: true, lista: true, pin: true },
  "anular_cobro(text, text, text)": { sesion: true, ids: true },
  "hacer_corte(text, text)": { sesion: true, pin: true, casos: ["el corte no incluye ni frena tickets, cobros o gastos de otra sucursal"] },
  "ajustar_bebida(text, text, integer)": { sesion: true, ids: true },
  "actualizar_bebida(text, text, jsonb)": { sesion: true, ids: true },
  "agregar_bebida(text, text, numeric, integer)": { sesion: true },
  "eliminar_bebida(text, text)": { sesion: true, ids: true },
  "actualizar_carne(text, text, boolean)": { sesion: true, ids: true },
  "agregar_carne(text, text)": { sesion: true, casos: ["«pastor» puede existir en las dos sucursales"] },
  "eliminar_carne(text, text)": { sesion: true, ids: true },
  "fijar_precio(text, text, numeric)": { sesion: true },
  "fijar_precio_extra(text, text, numeric)": { sesion: true, ids: true },
  "agregar_extra(text, text, text, numeric)": { sesion: true },
  "eliminar_extra(text, text)": { sesion: true, ids: true },
  "alternar_oculto(text, text)": { sesion: true },
  "fijar_ajuste(text, text, jsonb)": { sesion: true },
  "agregar_gasto(text, text, text, numeric)": { sesion: true, idem: true },
  "eliminar_gasto(text, text)": { sesion: true, ids: true },
  "crear_usuario(text, text, text, text, text)": { sesion: true, pin: true },
  "eliminar_usuario(text, text, text)": { sesion: true, ids: true, pin: true },
  "restablecer_pin(text, text, text, text)": { sesion: true, ids: true, pin: true },
  // funciones nuevas del plan (al crearlas, la entrada pasa a su firma completa)
  vincular_dispositivo: { futura: true, casos: [
    "un código vencido, ya usado o de otra cuenta se rechaza",
    "una identidad que ya es un dispositivo vigente no se vincula otra vez",
    "una identidad de persona (no anónima) no se vincula como equipo",
  ] },
  desbloquear: { futura: true, sesion: true, casos: ["no reinicia las 12 horas (paso 3)", "el PIN de otro operador no desbloquea (paso 3)"] },
  restablecer_acceso: { futura: true, sesion: true, ids: true, casos: ["solo un administrador de la misma sucursal; queda en bitácora (paso 3)"] },
  crear_cuenta: { futura: true, identidad: true, casos: ["la cuenta nace activa con quien la crea como propietario, en la misma transacción"] },
  aceptar_invitacion: { futura: true, identidad: true, casos: [
    "una invitación de otra cuenta, vencida, ya usada o para otro correo no da acceso",
    "la primera invitación de propietario activa la cuenta pendiente; una de encargado no puede ser la primera",
  ] },
  crear_sucursal: { futura: true, dueno: true, casos: ["solo un propietario; la sucursal queda en su cuenta"] },
  invitar_miembro: { futura: true, dueno: true, casos: ["solo un propietario; la invitación queda en su cuenta"] },
  quitar_miembro: { futura: true, dueno: true, ids: true, casos: ["no deja una cuenta activa sin propietario, ni con dos bajas simultáneas"] },
  generar_codigo: { futura: true, dueno: true, casos: [
    "solo propietarios o encargados de la cuenta de esa sucursal",
    "una cuenta pendiente de activación no genera códigos",
  ] },
  listar_dispositivos: { futura: true, dueno: true, casos: ["solo lista los equipos de las sucursales de su cuenta"] },
  revocar_dispositivo: { futura: true, dueno: true, ids: true, casos: ["el equipo revocado pierde datos de inmediato y avisos en el tiempo máximo medido"] },
};

export const casosDe = (f) => [
  ...(f.dispositivo ? ["rechaza una identidad sin dispositivo vinculado", "rechaza un dispositivo revocado"] : []),
  ...(f.sesion ? ["rechaza el token de una sesión de otra sucursal", "rechaza el token usado desde otro dispositivo",
    "rechaza un dispositivo revocado"] : []),
  ...(f.identidad ? ["rechaza la identidad anónima de un dispositivo"] : []),
  ...(f.dueno ? ["rechaza a una persona sin membresía en esa cuenta", "una sucursal o un id de otra cuenta se trata como inexistente"] : []),
  ...(f.ids ? ["trata un id de otra sucursal como inexistente"] : []),
  ...(f.lista ? ["rechaza listas que mezclan ids de dos sucursales"] : []),
  ...(f.idem ? ["un id repetido de otra sucursal no devuelve sus datos"] : []),
  ...(f.pin ? ["no acepta el PIN de un administrador de otra sucursal"] : []),
  ...(f.casos || []),
];

// externas: firmas completas que pueden ejecutar anon o authenticated
export function revisarMatriz(externas, matriz = MATRIZ) {
  const firmas = new Set(externas);
  const nombres = new Set(externas.map((f) => f.slice(0, f.indexOf("("))));
  return {
    faltan: externas.filter((f) => !matriz[f]),
    sobran: Object.keys(matriz).filter((k) => !matriz[k].futura && !firmas.has(k)),
    sinCasos: Object.keys(matriz).filter((k) => casosDe(matriz[k]).length === 0),
    futurasQueYaExisten: Object.keys(matriz).filter((k) => matriz[k].futura && nombres.has(k)),
  };
}
