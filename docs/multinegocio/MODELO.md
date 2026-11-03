# Modelo multinegocio: cuenta, sucursal, membresía, dispositivo y sesión

Primer entregable del [plan multinegocio](../../PLAN-MULTINEGOCIO.md), versión 2.2. Es diseño: nada de esto
está implementado. La lista de tablas, funciones, candados y claves que hay que cubrir está en el
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

- `sucursales`: `nombre`, `zona_horaria`, `retencion_domicilio_dias`, `creada`, `activa`.
- `membresias`: `rol`, `creada`, `creada_por`. Una persona puede estar en varias cuentas; cada cuenta
  conserva siempre al menos un `propietario`.
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

Los candados de hoy (`tequeria:corte`, `tequeria:cobro:<id>`, `tequeria:ticket:<id>`) son globales:
un corte de una sucursal frenaría los cobros de todas. Pasan a incluir la sucursal, por ejemplo
`tequeria:corte:<sucursal_id>`. El orden de bloqueo no cambia: primero el candado, después las filas
ordenadas por id.

## 3. Contexto autorizado en cada función

La sucursal **nunca** se recibe como parámetro de la app. Sale de las credenciales:

1. **Dispositivo:** `auth.uid()` (identidad de Supabase del equipo) debe corresponder a una fila de
   `dispositivos` sin revocar. De ahí salen `sucursal_id` y `cuenta_id`.
2. **Sesión del operador:** el token de PIN (`p_token`) debe pertenecer a una sesión de **la misma
   sucursal y el mismo dispositivo**, no vencida ni revocada. Robar solo el token no sirve sin el
   dispositivo, y viceversa.
3. **Rol y estado:** el rol del operador y el estado de la sesión (activa o bloqueada por inactividad,
   §5) deciden qué puede hacer.

Una función auxiliar nueva, `_contexto(p_token, p_roles, p_tipo)`, sustituye a `_sesion` y `_exigir`.
Hace las tres comprobaciones y devuelve `sucursal_id`, `cuenta_id`, `dispositivo_id`, `sid`, `uid`,
`nombre`, `rol` y si la sesión solo puede leer cocina. **Toda función de la API empieza por ella**, y
todas sus consultas filtran por ese `sucursal_id`. Las auxiliares internas lo reciben como parámetro
explícito.

### 3.1 Comprobaciones que no se pueden olvidar

- **Ids que manda la app** (`p_id`, `p_ids`, `p_tickets`, `p_mesa_id`…):
  - se buscan siempre con `sucursal_id = contexto`;
  - un id de otra sucursal se trata igual que uno inexistente.
- **Respuestas idempotentes** (`enviar_comanda`, `reenviar_cocina`, `cobrar`):
  - si el id ya existe en **otra** sucursal, se responde con un error genérico, sin datos;
  - como la llave es global, ese caso solo ocurre por error o por un intento malicioso.
- **PIN de administrador** (`_verificar_admin`): solo se aceptan administradores de la sucursal del
  contexto, y los fallos cuentan en el contador de reautenticación de esa sesión (§6).
- **Listas mezcladas:** si una lista trae ids de otra sucursal, la operación completa se rechaza; no
  se procesa en parte.
- **Sin firmas antiguas:** las funciones que hoy no reciben contexto no se conservan como alternativa.
  Las antiguas `cambiar_estado_ticket` y `archivar_ticket` se retiran, porque ya existen
  `mover_tickets` y `archivar_tickets`.

### 3.2 Funciones de la API por tipo

| Tipo | Funciones | Credenciales | ¿Cuenta como interacción del operador? | Con bloqueo por inactividad |
|---|---|---|---|---|
| Del dispositivo, sin operador | `usuarios_login`, `login`, `vincular_dispositivo` (nueva) | Dispositivo (la vinculación, con código) | — | — |
| Sesión | `logout`, `cambiar_pin`, `desbloquear` (nueva) | Dispositivo + token | Desbloquear sí; no reinicia las 12 h | Solo `desbloquear` y `logout` |
| Lectura | `estado` | Dispositivo + token | No | Solo el monitor dedicado lee cocina y lo necesario para mostrarla |
| Automáticas | `latido_cocina`, `marcar_recibido` | Dispositivo + token | No | El latido sí; `marcar_recibido` no (es escritura) |
| Mesero | `guardar_borrador_mesa`, `liberar_mesa`, `enviar_comanda`, `reenviar_cocina`, `cobrar`, `no_cobrar` | Dispositivo + token | Sí | No (se pide PIN) |
| Cocina | `mover_tickets`, `archivar_tickets`, `marcar_hecho`, `liberar_cocina`, `hacer_corte` | Dispositivo + token | Sí | No (se pide PIN) |
| Administración | Catálogo, precios, ajustes, gastos, usuarios, `anular_cobro`, `restablecer_acceso` (nueva) | Dispositivo + token; algunas con PIN de administrador | Sí | No (se pide PIN) |
| Dueños | `crear_cuenta`, `crear_sucursal`, `invitar_miembro`, `aceptar_invitacion`, `quitar_miembro`, `generar_codigo`, `listar_dispositivos`, `revocar_dispositivo` (nuevas) | Sesión de Supabase de una persona con membresía | — | — |

Consecuencia que conviene confirmar: con la cocina bloqueada por inactividad, `marcar_recibido` no se
registra. El mesero verá «Enviado» hasta que alguien desbloquee la cocina con su PIN.

## 4. Identidad del dispositivo

- **Primera vez:** el equipo abre la app, inicia una sesión anónima de Supabase
  (`signInAnonymously`), y con ella llama a `vincular_dispositivo(codigo, nombre)`.
- **Vincular:** el servidor:
  - busca el código por su hash y rechaza los vencidos o usados;
  - lo marca como usado en la misma transacción;
  - crea el `dispositivo` ligado a `auth.uid()`, a su sucursal y, si el código lo indica, como
    monitor dedicado.
- **Intentos:** se limitan por IP y por identidad anónima. Las identidades anónimas sin
  dispositivo vinculado no tienen ningún permiso.
- **Requisitos en Supabase:** activar el inicio de sesión anónimo y protegerlo con CAPTCHA o límite
  de solicitudes.
- **Revocar:**
  - marca `revocado_en`; desde ese momento `_contexto` rechaza al equipo en todas las funciones;
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
`vence_absoluta` (= `creada + 12 h`), `ultima_interaccion`, `revocada`, `motivo_fin`.

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

1. **Tablas nuevas y `sucursal_id`:**
   - agregar las tablas nuevas y `sucursal_id` como columna con valor nulo permitido;
   - llenarla con la sucursal inicial (ensayo en [MIGRACION.md](MIGRACION.md));
   - después, `not null`, únicos y referencias compuestas.
2. **`_contexto` y `_ahora()`:** pasar las funciones una por una, cada una con sus casos en la matriz
   de aislamiento (`tests/sql/aislamiento.test.js`).
3. **Política de seguridad:** PIN de 6 a 8 dígitos, contadores, sesión de 12 h e inactividad, con
   reloj controlado.
4. **Dispositivos y dueños:** vinculación, revocación, membresías y registro.
5. **Tiempo real privado y claves del navegador por sucursal.**
6. **Cliente:** panel de dueños, vinculación, pantalla de desbloqueo y borradores por autor.
