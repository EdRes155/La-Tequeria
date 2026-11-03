# Migración de La Tequería al modelo multinegocio

Primer entregable del [plan multinegocio](../../PLAN-MULTINEGOCIO.md), paso 6: la migración se diseña
al principio y se ejecuta al final. Es diseño y herramientas de ensayo; la migración en sí se escribe
junto con el núcleo ([MODELO.md](MODELO.md)).

## 1. Principios

- **Expandir antes de contraer:**
  - primero se agregan tablas y columnas sin romper nada;
  - luego se rellenan y se valida;
  - al final se imponen restricciones y se cambian las funciones.
- **Todo en una transacción**, con la validación al final: si algo no cuadra, la migración se aborta
  y la base queda como estaba.
- **Se ensaya completa sobre una copia desechable** antes de tocar producción.
- **La huella de datos** (`tequeria-app/scripts/huella-datos.sql`) compara antes y después:
  - es solo lectura y solo agregados (conteos, sumas, máximos y referencias rotas);
  - no devuelve nombres, PIN, teléfonos ni direcciones;
  - sus pruebas están en `tests/sql/huella.test.js`.
- **Recuperarse sin perder ventas nuevas:** restaurar un respaldo no basta si ya entraron operaciones
  después del cambio (§6).

## 2. Punto de partida

Huella de producción tomada el 3 de noviembre de 2026. Los montos no se guardan en el repositorio.

- 14 tablas con datos de una sola sucursal: 1 configuración, 8 mesas (todas libres), 4 carnes,
  22 bebidas y 3 usuarios (un administrador, un mesero, un cocinero).
- 42 comandas: 32 marcadas como `previo` (vendidas antes de registrar cobros) y 10 cobradas, ninguna
  pendiente. 10 cobros sin anular, 4 cortes y ningún gasto.
- **Consistencia:**
  - el total vendido es igual a la suma de los cortes;
  - lo cobrado es igual a lo cobrado en los cortes;
  - los folios van del 1 al 42 sin repetirse;
  - no hay referencias rotas.
- En ese momento no había mesas abiertas, comandas en cocina ni cuentas por cobrar, y había una
  sesión de personal vigente.

## 3. Copia recuperable (requisito para ensayar)

Hace falta una copia completa de producción, verificada, en un entorno controlado. Contiene hashes de
PIN y domicilios: **nunca se sube al repositorio** y se borra al terminar el ensayo.

Opciones (decisión pendiente; ver §8):

1. Descargar el respaldo diario de Supabase, si el plan contratado lo incluye.
2. `pg_dump` con la cadena de conexión de la base. Lo ejecuta quien tiene acceso; la contraseña no se
   comparte en conversaciones ni se guarda en archivos del proyecto.

**Verificación:** se restaura en una base desechable, se corre la huella y debe coincidir con la de
producción tomada en el mismo momento. Una copia que no se restauró y comparó no cuenta como
recuperable.

## 4. Pasos de la migración

### 4.1 Expandir (compatible con la app actual)

- Crear `cuentas`, `sucursales`, `membresias`, `invitaciones`, `dispositivos`, `codigos_vinculacion`,
  `folios`, `intentos_operador` e `intentos_dispositivo`.
- Agregar `sucursal_id` (todavía nulo permitido) a todas las tablas de operación.
- Agregar las columnas nuevas:
  - `tickets.estado_cobro` y `tickets.folio_periodo`;
  - en `sesiones`: `dispositivo_id`, `vence_absoluta` y `ultima_interaccion`;
  - en `usuarios`: `politica_pin` y `pin_cambiado_en`.

### 4.2 Cuenta y sucursal inicial

- Crear la cuenta «La Tequería» y su sucursal, con la zona horaria y la retención actuales.
- La cuenta nace en `pendiente_activacion` (MODELO.md §3.0): no tiene propietario.
- Dejar una invitación de propietario para el correo del dueño. Al aceptarla, la cuenta pasa a
  `activa` en la misma transacción. Mientras tanto nadie puede generar códigos ni vincular equipos.

### 4.3 Rellenar

| Dato | Regla |
|---|---|
| `sucursal_id` | La sucursal inicial en todas las filas de operación |
| `tickets.estado_cobro` | `cobro_id` nulo → `pendiente`; `previo` → `previo` (con `cobro_id` nulo); `no_cobrado` → `no_cobrado` (con `cobro_id` nulo); otro valor → `cobrado` |
| `folios` | Periodo `continuo` con `ultimo = max(folio)`; `tickets.folio_periodo = 'continuo'` |
| `config`, `cocina_sesion` | La fila `id = 1` pasa a ser la de la sucursal inicial |
| `intentos` | No se migran contadores: se registra en la bitácora cualquier bloqueo vigente y se empieza de cero con las tablas nuevas |
| `sesiones` | Todas se revocan: la política nueva exige iniciar sesión desde un dispositivo vinculado |
| `usuarios` | `politica_pin = 0` (heredada): al entrar desde un dispositivo vinculado, el PIN anterior solo sirve para elegir uno nuevo de 6 a 8 dígitos |
| `bitacora` | `cuenta_id` y `sucursal_id` de la inicial |

### 4.4 Validar dentro de la transacción

Antes de confirmar, un bloque de comprobación aborta la migración si algo falla:

- **Pertenencia:** ninguna fila de operación tiene `sucursal_id` nulo.
- **Huella:** la de después es igual a la de antes, salvo las diferencias esperadas:
  - `sesiones_vigentes` pasa a 0;
  - los contadores de intentos se reinician;
  - `por_estado_cobro` se lee de `estado_cobro`, con los mismos números.
- **Referencias:** las compuestas se crean sin errores, y por lo tanto no hay filas de una sucursal
  que apunten a otra.
- **Folios:** son únicos por sucursal y periodo, y el siguiente folio es `max + 1`.

### 4.5 Contraer

- `sucursal_id not null`; llaves y únicos por sucursal; referencias compuestas (ver MODELO.md §2).
- Reemplazar las funciones por las versiones con sus validadores (`_dispositivo`, `_contexto`; MODELO.md
  §3) y retirar las antiguas sin contexto.
  Desde aquí la app anterior deja de funcionar, por eso va junto con la publicación de la nueva
  (§5).

## 5. Cambio en producción (ventana acordada)

1. Fuera del horario de servicio, con el personal avisado.
2. Comprobar que no haya mesas abiertas, comandas en cocina ni cuentas por cobrar. Lo ideal es hacer
   el corte del día antes.
3. Tomar la copia y la huella «antes», y anotar la hora del cambio (T).
4. Aplicar la migración (una transacción con validación).
5. El dueño acepta su invitación (la cuenta pasa a `activa`) y genera los códigos para vincular la
   caja y la cocina. Va antes de publicar porque sin cuenta activa no hay códigos ni equipos.
6. Publicar la app nueva y vincular los equipos.
7. Cada persona del personal entra con su PIN anterior desde un dispositivo vinculado y elige uno
   nuevo de 6 a 8 dígitos.
8. Prueba de humo:
   - una comanda, un cobro y el monitor;
   - la huella «después» coincide;
   - se revisan los avisos de seguridad de Supabase.

## 6. Recuperación

| Momento | Qué se hace |
|---|---|
| La migración falla o no valida | La transacción se aborta sola; la base queda como estaba y la app anterior sigue funcionando |
| Falla algo después de aplicar, antes de abrir | Corregir hacia adelante, o restaurar la copia del paso 3 (no hay ventas nuevas que perder) |
| Falla algo con el servicio ya abierto | Preferir corregir hacia adelante. Si hay que restaurar: primero se exportan las operaciones posteriores a T (comandas, cobros, gastos, cortes y bitácora), luego se restaura y se reintegran |

El paquete de reintegración (exportar después de T y volver a insertar) se escribe y **se ensaya en la
copia** antes del cambio real.

## 7. Limpieza final

Según el plan 2.1:

1. Confirmar que el respaldo `respaldo_v2_20261030` y `app_state` siguen cerrados.
2. Verificar la copia.
3. Ensayar y hacer la migración.
4. Tras el periodo de observación, eliminarlos de forma controlada, junto con las 3 políticas
   antiguas de `app_state`, dejando registro.

## 8. Decisiones pendientes para el ensayo

- **Cómo obtener la copia de producción:** respaldo descargado o `pg_dump`, quién la ejecuta y
  dónde se guarda mientras dura el ensayo.
- **Ventana del cambio** y quién avisa al personal.
- **Correo del dueño** para la invitación inicial de propietario.
