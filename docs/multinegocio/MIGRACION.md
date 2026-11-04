# Migración de La Tequería al modelo multinegocio

Primer entregable del [plan multinegocio](../../PLAN-MULTINEGOCIO.md), paso 6: la migración se diseña
al principio y se ejecuta al final. La expansión y la contracción de los pasos 1 y 2 ya están escritas
en `tequeria-app/supabase-schema.sql` y ensayadas sobre una copia exacta del esquema de producción con
datos sintéticos (`tests/sql/migracion.test.js`). Nada se ha aplicado en producción.

**Desde el paso 2, el esquema de la rama ya no funciona con la app publicada** (exige equipos
vinculados). Se aplica en la ventana del cambio, junto con la app nueva (§5). La versión que solo
expandía, compatible con la app de hoy, quedó en el commit `2d88d20`.

## 1. Principios

- **Expandir antes de contraer:**
  - primero se agregan tablas y columnas sin romper nada;
  - luego se rellenan y se valida;
  - al final se imponen restricciones y se cambian las funciones.
- **Todo en una transacción**, con la validación al final: si algo no cuadra, la migración se aborta
  y la base queda como estaba.
- **Se ensaya completa sobre una copia desechable** antes de tocar producción.
- **La huella de datos** (`tequeria-app/scripts/huella-datos.sql`) compara antes y después:
  - es solo lectura (se puede correr en una transacción `read only`);
  - tiene dos versiones equivalentes, `origen` (esquema de hoy) y `destino` (ya migrado), que se
    eligen con `set huella.version`; el estado de cobro se compara por su significado (en origen se
    deduce de `cobro_id`; en destino se lee de `estado_cobro`);
  - el **resumen** (conteos, sumas, máximos y referencias rotas) sirve para leer de un vistazo, pero no
    basta: intercambiar existencias entre dos bebidas conserva la suma;
  - por eso además firma **cada fila de cada tabla** (md5 con una sal elegida para el ensayo,
    `set huella.sal`) y `node scripts/huella.mjs comparar antes.json despues.json` dice qué filas
    faltan, sobran o cambiaron;
  - no devuelve nombres, PIN, teléfonos ni direcciones: solo aparecen dentro de firmas con sal, y las
    llaves de usuarios también se firman;
  - sus pruebas están en `tests/sql/huella.test.js` y `tests/sql/migracion.test.js`.
- **La huella del esquema** (`tequeria-app/scripts/catalogo-esquema.sql` + `scripts/huella-esquema.mjs`)
  resume el catálogo sin leer datos:
  - funciones con sus argumentos y valores por omisión, atributos, dueño y cuerpo; el cuerpo se compara
    sin comentarios y con los espacios reducidos **solo fuera de los literales** (analizador léxico),
    porque Supabase puede descartar los comentarios al aplicar el SQL;
  - permisos uno por uno para `PUBLIC`, `anon` y `authenticated` en funciones, tablas, secuencias y el
    esquema; RLS y políticas (órdenes, roles y expresiones); columnas, restricciones, índices,
    disparadores y tablas publicadas en tiempo real;
  - `node scripts/huella-esquema.mjs a.json b.json` dice qué entradas difieren.
  Con ella se comprobó que `tests/sql/esquema-v3.sql` + `tests/sql/produccion-extra.sql` reproducen
  **exactamente** el esquema de producción; la prueba guarda esa huella y comprueba que cambia con
  políticas, permisos, valores por omisión o espacios dentro de un texto, y no con comentarios.
- Al hacerla más estricta aparecieron dos diferencias que la versión anterior ocultaba, ya reflejadas en
  la instantánea: las 3 políticas antiguas de `app_state` en producción son `true` (sin efecto, porque
  `anon` y `authenticated` no tienen permisos sobre la tabla; se eliminan en la limpieza, §7), y la
  secuencia del folio no tiene permisos para la app. `supabase-schema.sql` ahora retira explícitamente
  los permisos de todas las secuencias.
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

### 4.1 Expandir

Implementado en la sección «MULTINEGOCIO» de `supabase-schema.sql`, que se puede ejecutar varias veces.

- Tablas nuevas: `cuentas`, `sucursales`, `membresias`, `invitaciones`, `dispositivos`,
  `codigos_vinculacion`, `folios`, `intentos_operador` e `intentos_dispositivo`, con RLS y sin
  permisos para `anon` ni `authenticated`.
- `sucursal_id not null` en todas las tablas de operación, con referencia a `sucursales`, sin valor por
  omisión: las filas existentes pasan a la sucursal inicial y cada función indica la de su validador.
- Llaves locales por sucursal: `(sucursal_id, id)` en mesas, carnes y bebidas; `sucursal_id` en
  configuración y cocina activa (se retira su `id = 1`).
- Únicos `(sucursal_id, id)` y referencias compuestas diferidas: `tickets → mesas`, `tickets → cortes`,
  `cobros → cortes`, `gastos → cortes`, `cocina_hechos → tickets`, `sesiones → usuarios` y
  `sesiones → dispositivos`.
- `tickets.estado_cobro`, calculado a partir de `cobro_id` al agregarse (conserva el estado de lo que ya
  existe); `tickets.folio_periodo` y `folios`, que parten del folio más alto que ya existe.
- Invariante de propietario (MODELO.md §3.0) con disparadores diferidos que **escriben** la fila de la
  cuenta, probado con bajas simultáneas en READ COMMITTED, REPEATABLE READ y SERIALIZABLE.
- Se dejan para el paso que las usa: las columnas de seguridad de `sesiones` y `usuarios` (paso 3) y
  `bitacora.cuenta_id` (paso 4, acciones de cuenta).

### 4.2 Cuenta y sucursal inicial

- Crear la cuenta «La Tequería» y su sucursal, con la zona horaria y la retención actuales.
- La cuenta nace en `pendiente_activacion` (MODELO.md §3.0): no tiene propietario.
- Dejar una invitación de propietario para el correo del dueño. Al aceptarla, la cuenta pasa a
  `activa` en la misma transacción. Mientras tanto nadie puede generar códigos ni vincular equipos.

### 4.3 Rellenar

| Dato | Regla |
|---|---|
| `sucursal_id` | La sucursal inicial en todas las filas de operación |
| `tickets.estado_cobro` | `cobro_id` nulo → `pendiente`; `previo` → `previo`; `no_cobrado` → `no_cobrado`; otro valor → `cobrado`. Al agregarse es una columna calculada; la contracción (§4.5) la deja de calcular conservando sus valores y **después** pone `cobro_id` en nulo en `previo` y `no_cobrado`. El orden importa: al revés, esas comandas quedarían como `pendiente` (la prueba lo comprueba) |
| `folios` | Periodo `continuo` con `ultimo = max(folio)`; `tickets.folio_periodo = 'continuo'` |
| `config`, `cocina_sesion` | La fila `id = 1` pasa a ser la de la sucursal inicial; su llave pasa a ser `sucursal_id` |
| `intentos` | No se migran contadores: se registra en la bitácora cualquier bloqueo vigente y se empieza de cero con las tablas nuevas |
| `sesiones` | Se revocan todas las que no tienen equipo (implementado): hay que volver a entrar desde un equipo vinculado |
| `usuarios` | `politica_pin = 0` (heredada): al entrar desde un dispositivo vinculado, el PIN anterior solo sirve para elegir uno nuevo de 6 a 8 dígitos |
| `bitacora` | `cuenta_id` y `sucursal_id` de la inicial |

### 4.4 Validar dentro de la transacción

Antes de confirmar, un bloque de comprobación aborta la migración si algo falla (el de la expansión
está al final de su sección en `supabase-schema.sql`):

- **Pertenencia:** ninguna fila de operación tiene `sucursal_id` nulo.
- **Huella:** la de destino es igual a la de origen, **fila por fila**, salvo las diferencias que se
  permiten explícitamente al comparar (`DIFERENCIAS_DEL_CAMBIO` en `scripts/huella.mjs`):
  - `abierto.sesiones_vigentes` pasa a 0 al cambiar (las sesiones no se comparan por fila);
  - los contadores de intentos se reinician (tampoco se comparan por fila).
  El ensayo actual permite solo la primera, y comprueba que sin permitirla la comparación la señala.
- **Referencias:** las compuestas se crean sin errores, y por lo tanto no hay filas de una sucursal
  que apunten a otra.
- **Folios:** son únicos por sucursal y periodo, y el siguiente folio es `max + 1`.

### 4.5 Contraer

Implementado (paso 2) en `supabase-schema.sql`:

- Todas las funciones pasan a sus validadores (`_dispositivo`, `_contexto`; MODELO.md §3) y se retiran
  las antiguas sin contexto (`_sesion`, `_exigir`, las auxiliares sin sucursal, `cambiar_estado_ticket`
  y `archivar_ticket`).
- Estado de cobro: sección «CONTRACCIÓN DEL ESTADO DE COBRO», después de las funciones. Aborta todo el
  archivo si alguna función o índice depende todavía del significado antiguo de `cobro_id` (detectado
  con `_usa_cobro_id_heredado`: valores especiales comparados con `cobro_id`, o `cobro_id is null` como
  «falta cobrar»). Acepta el uso moderno: `estado_cobro` con esos valores y `cobro_id` solo para el
  cobro real. Después, `cobro_id` existe si y solo si la comanda está cobrada y apunta a un cobro de su
  misma sucursal.
  Desde aquí la app anterior deja de funcionar, por eso va junto con la publicación de la nueva
  (§5).

## 5. Cambio en producción (ventana acordada)

1. Fuera del horario de servicio, con el personal avisado.
2. Comprobar que no haya mesas abiertas, comandas en cocina ni cuentas por cobrar. Lo ideal es hacer
   el corte del día antes.
3. Tomar la copia y la huella «antes» (versión `origen`), y anotar la hora del cambio (T).
4. Aplicar la migración (una transacción con validación).
5. **Antes de cualquier otra operación**, tomar la huella «después» (versión `destino`, la misma sal) y
   compararla: `node scripts/huella.mjs comparar antes.json despues.json --permitir abierto.sesiones_vigentes`.
   Debe salir igual. Si no, se aplica la recuperación (§6) antes de abrir. Va aquí porque todo lo que
   sigue cambia datos a propósito.
6. El dueño acepta su invitación (la cuenta pasa a `activa`) y genera los códigos para vincular la
   caja y la cocina. Va antes de publicar porque sin cuenta activa no hay códigos ni equipos.
7. Publicar la app nueva y vincular los equipos.
8. Cada persona del personal entra con su PIN anterior desde un dispositivo vinculado y elige uno
   nuevo de 6 a 8 dígitos.
9. Prueba de humo:
   - una comanda, un cobro y el monitor;
   - tomar otra huella y compararla con la del paso 5. Solo pueden aparecer estas diferencias, cada
     una explicada por los pasos 6 a 9:
     - como «sobran»: la comanda y el cobro de la prueba y sus entradas de bitácora;
     - como «distintas»: los usuarios que eligieron PIN nuevo, la cocina activa si entró la cocina
       y la mesa de la comanda si fue para comer aquí;
     - en el resumen: los conteos y totales de esa comanda y ese cobro, la comanda en cocina y las
       sesiones del personal que entró.
     Cualquier otra diferencia se investiga antes de seguir (`tests/sql/migracion.test.js` comprueba
     esta lista con una prueba de humo);
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
   antiguas de `app_state` (en producción son `true`; hoy no dan acceso porque la tabla no tiene
   permisos para la app), dejando registro.

## 8. Decisiones pendientes para el ensayo

- **Cómo obtener la copia de producción:** respaldo descargado o `pg_dump`, quién la ejecuta y
  dónde se guarda mientras dura el ensayo.
- **Ventana del cambio** y quién avisa al personal.
- **Correo del dueño** para la invitación inicial de propietario.
