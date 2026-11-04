# Modelo multinegocio: cuenta, sucursal, membresía, dispositivo y sesión

Primer entregable del [plan multinegocio](../../PLAN-MULTINEGOCIO.md), versión 2.2. Los pasos 1 a 3 del
§9 (tablas, `sucursal_id`, validadores `_dispositivo` y `_contexto`, todas las funciones por sucursal y la
política de seguridad del personal) están implementados en `supabase-schema.sql`; lo demás es diseño. La lista de tablas, funciones, candados y claves que hay que cubrir está en el
[inventario](INVENTARIO.md), generado del código.

## 1. Entidades nuevas

| Tabla | Para qué | Llave | Referencias |
|---|---|---|---|
| `cuentas` | La empresa: agrupa sucursales, suscripción y dueños | `id uuid` | — |
| `sucursales` | Unidad que separa los datos de operación | `id uuid` | `cuenta_id → cuentas` |
| `membresias` | Dueños de una cuenta y su rol (`propietario`, `encargado`) | `(cuenta_id, auth_user_id)` | `cuenta_id → cuentas`, `auth_user_id → auth.users` |
| `invitaciones` | Invitar por correo a un miembro | `id uuid`; único `token_hash` | `cuenta_id → cuentas` |
| `dispositivos` | Equipos vinculados a una sucursal | `id uuid`; único `auth_user_id`; único `(sucursal_id, id)` | `sucursal_id → sucursales` |
| `codigos_vinculacion` | Códigos de un solo uso para vincular | `id uuid`; único `codigo_hash` | `sucursal_id → sucursales` |
| `folios` | Último folio por sucursal y periodo | `(sucursal_id, periodo)` | `sucursal_id → sucursales` |
| `intentos_operador` | Fallos y bloqueo de cada operador | `(sucursal_id, usuario_id)` | `(sucursal_id, usuario_id) → usuarios` |
| `intentos_dispositivo` | Fallos de PIN por dispositivo (ventana de 15 min) | `id bigint` | `(sucursal_id, dispositivo_id) → dispositivos` |

Columnas principales:

- `cuentas`: `nombre`, `estado` (`pendiente_activacion`, `activa`, `suspendida`; §3.0), `creada`,
  `activada_en`.
- `sucursales`: `nombre`, `zona_horaria`, `retencion_domicilio_dias`, `creada`, `activa`.
- `membresias`: `rol`, `creada`, `creada_por`. Una persona puede estar en varias cuentas; una cuenta
  activa conserva siempre al menos un `propietario` (§3.0).
- `invitaciones`: `correo`, `rol`, `token_hash`, `vence`, `creada_por` (nulo si la crea el proveedor),
  `usada_en`, `usada_por`.
- `dispositivos`:
  - `nombre`, `auth_user_id` (su identidad de Supabase, ver §4), `aprobado_por`, `creado`,
    `ultimo_uso`;
  - `monitor_cocina boolean`: autorizado como monitor dedicado (§5.4);
  - `revocado_en`, `revocado_por`.
- `codigos_vinculacion`:
  - `codigo_hash`, `sucursal_id`, `creado_por`, `vence` (10 min), `usado_en`, `dispositivo_id`;
  - `monitor_cocina`: el código ya dice si el equipo será monitor dedicado.
- `usuarios` (personal), además de `sucursal_id`: `politica_pin smallint` (versión de la política que
  cumplió su PIN, §6), `pin_cambiado_en`.

## 2. Tablas actuales: llave y referencias por sucursal

Regla general: **toda fila de operación lleva `sucursal_id uuid not null`**. Los identificadores que ya
son aleatorios y globales (comandas, cobros, cortes, gastos, usuarios, sesiones) conservan su llave
`id`. Además tienen un único `(sucursal_id, id)`, para que las referencias compuestas impidan
mezclar sucursales. Las claves locales pasan a ser únicas dentro de la sucursal.

| Tabla | Hoy | Con sucursal |
|---|---|---|
| `config` | fila única `id = 1` | llave `sucursal_id` (una fila por sucursal) |
| `cocina_sesion` | fila única `id = 1` | llave `sucursal_id` |
| `mesas` | llave `id int` | llave `(sucursal_id, id)`; «Mesa 1» se repite entre sucursales |
| `carnes` | llave `id` (`pastor`) | llave `(sucursal_id, id)` |
| `bebidas` | llave `id` (`coca`) | llave `(sucursal_id, id)` |
| `usuarios` | llave `id` | `id` + único `(sucursal_id, id)` |
| `sesiones` | llave `id`, `usuario_id → usuarios` | + `sucursal_id`, `dispositivo_id`; referencias `(sucursal_id, usuario_id)` y `(sucursal_id, dispositivo_id)` |
| `tickets` | llave `id`, `mesa_id` suelto, `cobro_id` con valores especiales | `id` + único `(sucursal_id, id)`; `(sucursal_id, mesa_id) → mesas`; `(sucursal_id, cobro_id) → cobros`; `estado_cobro` aparte (§2.1) |
| `cobros` | llave `id`, `corte_id` suelto | `id` + único `(sucursal_id, id)`; `(sucursal_id, corte_id) → cortes` |
| `cortes`, `gastos` | llave `id` | `id` + único `(sucursal_id, id)`; `gastos.(sucursal_id, corte_id) → cortes` |
| `cocina_hechos` | llave `(ticket_id, linea)` | + `sucursal_id`; `(sucursal_id, ticket_id) → tickets` |
| `bitacora` | sin sucursal | + `cuenta_id`, `sucursal_id` (nulo solo para acciones de cuenta) |
| `intentos` | claves de texto `u:`, `s:`, `ip:` | se sustituye por `intentos_operador`, `intentos_dispositivo` y un contador por IP (§6) |

### 2.1 Estado de cobro de una comanda

Hoy `tickets.cobro_id` guarda el id de un cobro o los valores especiales `previo` y `no_cobrado`, y
por eso no puede tener referencia. Se separa en:

- `estado_cobro text not null`: `pendiente`, `cobrado`, `previo` (vendido antes de registrar cobros)
  o `no_cobrado`;
- `cobro_id`: solo ids reales de `cobros`, con referencia `(sucursal_id, cobro_id) → cobros`;
- regla: `cobro_id` no es nulo si y solo si `estado_cobro = 'cobrado'`.

### 2.2 Folio

- `folios(sucursal_id, periodo, ultimo)`. El periodo es `continuo` (como hoy), la fecha local
  (reinicio diario) o el id del corte abierto (reinicio por corte), según el ajuste de la sucursal.
- Al enviar una comanda se toma el siguiente número con `update … set ultimo = ultimo + 1 returning`
  sobre la fila de la sucursal: es atómico y solo frena a esa sucursal.
- `tickets` guarda `folio` y `folio_periodo`, con único `(sucursal_id, folio_periodo, folio)`. El `id`
  interno sigue siendo el que identifica la comanda.

### 2.3 Candados

- **Corte:** `tequeria:corte:<sucursal_id>`. Antes era global: un corte de una sucursal frenaba los
  cobros de todas. La prueba toma el candado del corte de A y comprueba que B cobra sin esperar.
- **Comanda y cobro:** `tequeria:ticket:<id>` y `tequeria:cobro:<id>` siguen por id, porque el id de
  comandas y cobros es global (es la llave de la tabla): dos sucursales no pueden crear el mismo id, y
  el candado por id hace que la segunda reciba el error genérico (§3.1) en lugar de un error de llave.
- El orden de bloqueo no cambia: primero el candado, después las filas ordenadas por id.

## 3. Contexto autorizado: un validador por tipo de llamada

La app de operación **nunca** envía la sucursal: sale de las credenciales. Pero no todas las llamadas
tienen las mismas credenciales: vincular un equipo ocurre antes de que exista el dispositivo, el
inicio de sesión antes de que exista el operador, y crear una cuenta o aceptar una invitación antes de
que exista la membresía. Por eso no hay un solo validador sino cinco, cada uno con lo que se puede
exigir en ese momento y nada menos. Todos son internos (sin permiso para `anon` ni `authenticated`).

| Validador | Lo usan | Exige | Devuelve |
|---|---|---|---|
| `_vinculacion(p_codigo)` | `vincular_dispositivo` | Identidad anónima de Supabase (`auth.uid()`) **sin** dispositivo vigente; código vigente y sin usar; su sucursal activa y su cuenta `activa` | `codigo_id`, `sucursal_id`, `cuenta_id`, `monitor_cocina` |
| `_dispositivo()` | `usuarios_login`, `login` | `auth.uid()` de un dispositivo sin revocar; su sucursal activa y su cuenta `activa` | `dispositivo_id`, `sucursal_id`, `cuenta_id`, `monitor_cocina` |
| `_contexto(p_token, p_roles, p_tipo)` | Toda operación de sucursal (§3.2) | Lo de `_dispositivo()` y además una sesión de operador de **esa sucursal y ese dispositivo**, no vencida ni revocada; rol y estado (§5) | Lo de `_dispositivo()` más `sid`, `uid`, `nombre`, `rol` y si solo puede leer cocina (§5.4) |
| `_identidad()` | `crear_cuenta`, `aceptar_invitacion` | Sesión de Supabase de una persona: **no anónima** y con correo verificado. No exige membresía: estas llamadas la crean | `auth_user_id`, `correo` |
| `_dueno(p_cuenta, p_roles)` | Operaciones de dueños (§3.2) | Lo de `_identidad()` y además membresía en `p_cuenta` con uno de los roles; cuenta `activa` | `cuenta_id`, `rol` |

- **Por qué el token solo no basta:** `_contexto` exige el dispositivo y la sesión del operador a la
  vez. Robar solo el token no sirve sin el equipo, y viceversa.
- **Identidades que no se mezclan:** una identidad anónima (de un equipo) nunca pasa `_identidad`, y
  la de una persona nunca pasa `_dispositivo`. Un dueño que quiere operar la caja vincula el equipo
  como cualquier otro.
- **El panel de dueños sí elige cuenta y sucursal**, porque una persona puede estar en varias. Las
  recibe como parámetro y `_dueno` comprueba la membresía; una sucursal se busca siempre con
  `cuenta_id = p_cuenta`, y una de otra cuenta se trata como inexistente.
- **Auxiliares internas** (`_fecha`, `_valorar_items`, `_ticket_json`…): reciben `sucursal_id` como
  parámetro explícito de quien las llama. El [inventario](INVENTARIO.md) marca cuáles dependen de la
  sucursal directamente y cuáles a través de otras.
- **Implementado (pasos 2 y 3):** `_dispositivo()` y `_contexto(p_token, p_roles, p_tipo)`; sustituyen
  a `_sesion` y `_exigir`. Sin `p_roles`, `_contexto` acepta cualquier rol; con ellos exige el rol y que
  el PIN ya se haya cambiado. `p_tipo` es obligatorio y dice qué es la llamada (§3.2 y §5):
  `interaccion`, `lectura`, `automatica`, `latido`, `sesion`, `desbloqueo` o `salida`. `_vinculacion`,
  `_identidad` y `_dueno` llegan con las funciones que los usan (paso 4).
- **La API solo la ejecuta `authenticated`**: los equipos entran con una sesión anónima de Supabase, que
  tiene ese rol. `anon` no ejecuta ninguna función.

### 3.0 Estado de la cuenta

| Estado | Cómo se llega | Qué permite |
|---|---|---|
| `pendiente_activacion` | La crea la migración (la cuenta actual de La Tequería) o el proveedor al dar de alta a un cliente. No tiene ningún propietario | Solo `aceptar_invitacion` de una invitación con rol `propietario`. Nada más: ni códigos, ni vincular equipos, ni invitar, ni crear sucursales |
| `activa` | Al aceptar la primera invitación de propietario (en la misma transacción que crea la membresía), o directamente con `crear_cuenta`, que crea la cuenta y la membresía de quien la crea a la vez | Todo, según el rol |
| `suspendida` | Fuera del alcance del piloto (suscripción) | Se define con la facturación |

- **Invariante:** una cuenta `activa` tiene siempre al menos un `propietario`. Quitar o degradar al
  último propietario se rechaza al confirmar. Para que dos bajas simultáneas no dejen la cuenta vacía,
  cada cambio de propietarios **escribe** la fila de la cuenta (`revision_propietarios`): en READ
  COMMITTED la segunda transacción espera y vuelve a leer; en REPEATABLE READ y SERIALIZABLE falla por
  actualización concurrente (código `40001`), y las funciones de dueños (paso 4) la reintentan.
- **Invitación inicial:** la del propietario de una cuenta pendiente la crea el proveedor desde el
  servidor (SQL Editor o un script de alta), nunca la app. Es de un solo uso, vence y, como toda
  invitación, solo la acepta una identidad con el mismo correo verificado.
- **Para la migración:** como los equipos se vinculan con códigos y los códigos exigen cuenta
  activa, el dueño debe aceptar su invitación **antes** de publicar la app que exige dispositivo
  ([MIGRACION.md](MIGRACION.md) §5).

### 3.1 Comprobaciones que no se pueden olvidar

- **Ids que manda la app** (`p_id`, `p_ids`, `p_tickets`, `p_mesa_id`…):
  - se buscan siempre con `sucursal_id = contexto`;
  - un id de otra sucursal se trata igual que uno inexistente.
- **Respuestas idempotentes** (`enviar_comanda`, `reenviar_cocina`, `cobrar`):
  - si el id ya existe en **otra** sucursal, se responde con un error genérico, sin datos;
  - como la llave es global, ese caso solo ocurre por error o por un intento malicioso.
- **PIN de administrador** (`_verificar_admin`): solo se aceptan administradores de la sucursal del
  contexto, y los fallos cuentan en el contador de reautenticación de esa sesión (§6).
- **Listas mezcladas:** si una lista trae algún id que no existe en la sucursal (sea de otra o
  inexistente), la operación completa se rechaza; no se procesa en parte. Así un id ajeno y uno
  inexistente dan exactamente la misma respuesta.
- **Sin firmas antiguas:** las funciones que hoy no reciben contexto no se conservan como alternativa.
  Las antiguas `cambiar_estado_ticket` y `archivar_ticket` se retiran, porque ya existen
  `mover_tickets` y `archivar_tickets`.

### 3.2 Funciones de la API por tipo

| Tipo | Funciones | Validador | ¿Cuenta como interacción del operador? | Con bloqueo por inactividad |
|---|---|---|---|---|
| Vinculación | `vincular_dispositivo` (nueva) | `_vinculacion` | — | — |
| Del dispositivo, sin operador | `usuarios_login`, `login` | `_dispositivo` | — | — |
| Sesión | `logout`, `cambiar_pin`, `desbloquear` (nueva) | `_contexto` | Desbloquear sí; no reinicia las 12 h | Solo `desbloquear` y `logout` |
| Lectura | `estado` | `_contexto` | No | Solo el monitor dedicado lee cocina y lo necesario para mostrarla |
| Automáticas | `latido_cocina`, `marcar_recibido` | `_contexto` | No | El latido sí; `marcar_recibido` no (es escritura) |
| Mesero | `guardar_borrador_mesa`, `liberar_mesa`, `enviar_comanda`, `reenviar_cocina`, `cobrar`, `no_cobrar` | `_contexto` | Sí | No (se pide PIN) |
| Cocina | `mover_tickets`, `archivar_tickets`, `marcar_hecho`, `liberar_cocina`, `hacer_corte` | `_contexto` | Sí | No (se pide PIN) |
| Administración | Catálogo, precios, ajustes, gastos, usuarios, `anular_cobro`, `restablecer_acceso` (nueva) | `_contexto`; algunas también PIN de administrador | Sí | No (se pide PIN) |
| Alta de personas | `crear_cuenta`, `aceptar_invitacion` (nuevas) | `_identidad` | — | — |
| Dueños: propietario | `crear_sucursal`, `invitar_miembro`, `quitar_miembro` (nuevas) | `_dueno(cuenta, {propietario})` | — | — |
| Dueños: propietario o encargado | `generar_codigo`, `listar_dispositivos`, `revocar_dispositivo` (nuevas) | `_dueno(cuenta, {propietario, encargado})` | — | — |

Consecuencia que conviene confirmar: con la cocina bloqueada por inactividad, `marcar_recibido` no se
registra. El mesero verá «Enviado» hasta que alguien desbloquee la cocina con su PIN.

## 4. Identidad del dispositivo

- **Primera vez:** el equipo abre la app, inicia una sesión anónima de Supabase
  (`signInAnonymously`), y con ella llama a `vincular_dispositivo(codigo, nombre)`.
- **Vincular:** el servidor, con `_vinculacion`:
  - busca el código por su hash y rechaza los vencidos o usados, y los de una cuenta pendiente;
  - lo marca como usado en la misma transacción;
  - crea el `dispositivo` ligado a `auth.uid()`, a su sucursal y, si el código lo indica, como
    monitor dedicado.
- **Intentos:** se limitan por IP y por identidad anónima. Las identidades anónimas sin
  dispositivo vinculado no tienen ningún permiso.
- **Requisitos en Supabase:** activar el inicio de sesión anónimo y protegerlo con CAPTCHA o límite
  de solicitudes.
- **Revocar:**
  - marca `revocado_en`; desde ese momento `_dispositivo` (y con él `_contexto`) rechaza al equipo en
    todas las funciones;
  - la sesión de Supabase dura poco (se configura la expiración del JWT; valor a medir, por ejemplo
    10 minutos);
  - al renovarse, las políticas del tiempo real vuelven a evaluar al equipo (§7).
- **Recuperación:** un equipo perdido o un navegador borrado se revoca y se vincula de nuevo con otro
  código. La credencial anterior no se recupera.
- **Sesiones independientes:** la identidad del dispositivo no es la sesión del operador. Cambiar de
  turno o vencer las 12 horas no obliga a vincular otra vez. Y renovar el JWT del dispositivo no
  devuelve permisos a un operador bloqueado o vencido.

## 5. Sesión del operador

### 5.1 Campos

`sesiones`: `id`, `token_hash`, `sucursal_id`, `dispositivo_id`, `usuario_id`, `creada`,
`vence_absoluta` (= `creada + 12 h`), `revocada`, `motivo_fin` (`salida`, `cambio_pin`,
`pin_restablecido`, `sin_equipo`).

`ultima_interaccion` vive en `sesiones_actividad` (una fila por sesión, **sin** referencia a
`sesiones`). Así marcar la interacción no bloquea la fila de la sesión, y revocar o borrar sesiones de
otro operador (cambio o restablecimiento de PIN, baja de un usuario) nunca espera a una operación en
curso. Con la marca en la propia fila, dos administradores que se daban de baja a la vez llegaban a un
interbloqueo (lo cubre una prueba).

### 5.2 Estados

| Estado | Condición | Qué permite |
|---|---|---|
| Activa | `now < vence_absoluta` y `now − ultima_interaccion < 15 min` | Todo lo de su rol |
| Bloqueada por inactividad | `now < vence_absoluta` y `now − ultima_interaccion ≥ 15 min` | `desbloquear`, `logout` y, solo en monitor dedicado, leer cocina |
| Vencida | `now ≥ vence_absoluta` | Nada: hace falta un nuevo inicio de sesión |
| Revocada | cambio de PIN, baja del usuario, revocación del dispositivo o salida | Nada |

- `ultima_interaccion` solo la actualizan las funciones marcadas como interacción (§3.2), dentro de
  la misma transacción que la acción. Lecturas, latidos, `marcar_recibido`, el polling y el tiempo
  real no la tocan.
- **PIN pendiente de renovación** (heredado, o puesto por un administrador): la sesión solo sirve para
  `cambiar_pin`, `desbloquear` y `logout`; todo lo demás, incluidas las lecturas, responde
  `CAMBIAR_PIN`. Ese PIN tampoco autoriza operaciones administrativas: la reautenticación responde
  `pin_vencido`.
- **Versión de la credencial:** `usuarios.version_pin` sube con cada cambio o restablecimiento del PIN;
  cada sesión guarda la versión con la que se abrió y `_contexto` la compara en cada operación. Una
  sesión abierta con el PIN anterior deja de servir aunque se haya creado mientras el PIN cambiaba.
  Además, `login`, `cambiar_pin`, `restablecer_pin` y `desbloquear` toman la fila de la persona, así que
  un inicio con el PIN anterior espera al cambio en curso y luego ve el PIN nuevo.
- `desbloquear(p_token, p_pin)`:
  - verifica el PIN vigente del mismo operador y actualiza `ultima_interaccion`;
  - no cambia `vence_absoluta`;
  - sus fallos cuentan para el operador y el dispositivo (§6).
- Una función con sesión bloqueada responde el código `BLOQUEO_INACTIVIDAD`. La app muestra la
  pantalla de PIN y conserva los borradores (§8).

### 5.3 Reloj

Todo cálculo de vencimientos, bloqueos y ventanas usa una función `_ahora()` y no `now()`
directamente. En producción `_ahora()` devuelve `now()`. Las pruebas la reemplazan por un reloj
controlado para comprobar 15 minutos, 12 horas y la escalada 15/30/60 sin esperar.

### 5.4 Excepción del monitor dedicado

- **Condiciones:** dispositivo con `monitor_cocina = true`, sin revocar, de la misma sucursal, y
  sesión bloqueada por inactividad pero no vencida ni revocada.
- **Qué permite:** `_contexto` marca la sesión como «solo lectura de cocina». Con eso `estado` acepta
  únicamente las partes `cocina`, `config` y `mesas` (lo necesario para mostrar las comandas), y el
  latido.
- **Qué no permite:** cualquier escritura (incluidas `marcar_recibido` y `marcar_hecho`) exige
  desbloquear. Las 12 horas siguen contando.

## 6. Intentos y bloqueos

| Contador | Llave | Regla |
|---|---|---|
| Operador | `(sucursal_id, usuario_id)` | 5 fallos seguidos en cualquier dispositivo → bloqueo de 15 min; si vuelve a llegar a 5 después de esperar, 30 min; después, 60 min |
| Dispositivo | `dispositivo_id`, ventana móvil | 30 fallos de cualquier operador en 15 min → 15 min sin nuevos accesos por PIN en ese equipo |
| Reautenticación administrativa | `(sesión, sucursal)` | 5 fallos → misma escalada 15/30/60 para verificaciones sensibles; también cuentan para el dispositivo |
| IP | IP de origen | Protección adicional con umbral alto; nunca la única barrera |

Reglas de aplicación (del plan):

- **Atomicidad:** el fallo y el bloqueo se registran en la misma transacción, con la fila del
  contador bloqueada.
- **Durante un bloqueo:**
  - un PIN correcto no entra;
  - los intentos rechazados no alargan el bloqueo ni suben la escalada.
- **Al entrar o desbloquear bien** (ya vencido el bloqueo) se reinician los fallos y la escalada de
  ese operador.
- **Implementado (paso 3):** `intentos_operador`, `intentos_dispositivo` y, para la reautenticación y la
  IP, `intentos` con su nivel de escalada. Comprobar el bloqueo, verificar el PIN y registrar el fallo
  o reiniciar el contador ocurren con las filas tomadas y siempre en el mismo orden (equipo, persona,
  contador): un acierto que llega mientras se registra el quinto fallo espera y ve el bloqueo. Reiniciar
  pone el contador en cero en lugar de borrarlo. Un acierto de reautenticación (ya vencido el bloqueo) reinicia
  también su escalada. La IP conserva su umbral alto de 30 fallos como barrera adicional. Las respuestas
  de bloqueo dicen el motivo (`operador`, `equipo` o `red`) y la espera en segundos.
- **Restablecer el acceso:** un administrador de la misma sucursal puede hacerlo con
  `restablecer_acceso`, y queda en la bitácora.
- **Límite del dispositivo:** conserva su ventana aunque otro usuario entre bien. Aplica al acceso
  por PIN y a la reautenticación, nunca a la lectura del monitor ni a una transacción ya iniciada.

## 7. Tiempo real

- **Canal:** uno privado por sucursal, `sucursal:<id>`. Los avisos siguen sin datos (`{t: tabla}`).
- **Quién publica:** solo el servidor, con `realtime.send(…, private => true)` desde los disparadores.
  - Para saber a qué sucursal avisar, cada tabla tiene disparadores por sentencia con tablas de
    transición (`referencing new table as …`).
  - PostgreSQL 16 solo admite tablas de transición en disparadores de un solo evento, así que hay uno
    para inserción, uno para actualización y uno para borrado (comprobado el 3 de noviembre de 2026).
- **Políticas sobre `realtime.messages`:**
  - lectura (escuchar): solo si `realtime.topic()` es el canal de la sucursal de un dispositivo sin
    revocar con `auth_user_id = auth.uid()`;
  - escritura (publicar): **sin política para clientes**, así que ningún dispositivo puede publicar.
- **Revocación con la conexión abierta:** se comprueba en el piloto y se mide el tiempo máximo en que
  el equipo aún recibe avisos (sin datos), con las mitigaciones del §4.

## 8. Navegador

- **Claves por sucursal:** las claves de la app pasan a llevar la sucursal: `tequeria:<sucursal>:sesion`,
  `…:borradores`, `…:estacion`, `…:papel`, `…:ultimo_usuario`. La lista completa está en el
  [inventario](INVENTARIO.md#navegador).
- **Identidad del dispositivo:** la sesión de Supabase la guarda `supabase-js` en su propia clave.
- **Al revocar el dispositivo o vencer su vinculación:** se borran todas las claves `tequeria:*`, se
  cancelan las suscripciones y se descartan las respuestas que lleguen tarde.
- **Borradores:**
  - se guardan con la sucursal y el autor;
  - tras un bloqueo, solo se recuperan al reautenticar al mismo operador; el siguiente usuario no
    los ve;
  - una escritura que ya empezó se termina; la siguiente acción pide la autorización vigente.

## 9. Orden sugerido para implementar (paso 3 del plan)

1. **Tablas nuevas y `sucursal_id`** (hecho; detalle en [MIGRACION.md §4.1](MIGRACION.md)):
   - tablas nuevas, cuenta y sucursal inicial (pendiente de activación);
   - `sucursal_id not null`, únicos y referencias compuestas;
   - `estado_cobro`, `folios` e invariante de propietario.
2. **Validadores (§3)** (hecho): `_dispositivo` y `_contexto`; todas las funciones reciben la sucursal de
   su validador; llaves locales por sucursal (mesas, carnes, bebidas, configuración, cocina activa);
   candado del corte por sucursal; folio desde `folios`; contracción del estado de cobro. La matriz de
   aislamiento (`tests/sql/aislamiento.test.js`) prueba cada función con las dos cuentas de las fixtures:
   solo quedan pendientes los casos de funciones de los pasos 3 y 4.
3. **Política de seguridad** (hecho): PIN de 6 a 8 dígitos no triviales y transición de los heredados;
   contadores por operador (escalada 15/30/60), por equipo (30 en 15 min) y de reautenticación; sesión
   de 12 h e inactividad de 15 min con el tipo de llamada; `desbloquear` y `restablecer_acceso`;
   excepción del monitor. Pruebas con reloj controlado en `tests/sql/reloj.test.js`. Falta su parte en
   la interfaz (validación del PIN en pantalla y pantalla de desbloqueo), que va con el cliente (paso 6).
4. **Dispositivos y dueños:** vinculación, revocación, membresías y registro.
5. **Tiempo real privado y claves del navegador por sucursal.**
6. **Cliente:** panel de dueños, vinculación, pantalla de desbloqueo, validación del PIN de 6 a 8
   dígitos en la interfaz (también en el modo local) y borradores por autor.
