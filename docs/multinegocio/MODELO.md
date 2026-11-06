# Modelo multinegocio: cuenta, sucursal, membresía, dispositivo y sesión

Primer entregable del [plan multinegocio](../../PLAN-MULTINEGOCIO.md), versión 2.2. Los pasos 1 a 4 del
§9 (tablas, `sucursal_id`, los cinco validadores, todas las funciones por sucursal, la política de
seguridad del personal, dispositivos y dueños) y el 5 (tiempo real privado y claves del navegador por
sucursal) están implementados en `supabase-schema.sql` y en la app; lo demás es diseño. La lista de tablas, funciones, candados y claves que hay que cubrir está en el
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
  `activada_en`, `creada_por` (quien la creó con `crear_cuenta`; nulo si la creó la migración o el
  proveedor) y `revision_propietarios` (§3.0).
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
| `bitacora` | sin sucursal | + `cuenta_id`, `sucursal_id` (nulo solo para acciones de cuenta, regla `bitacora_alcance_ck`), `auth_user_id` (la persona o el equipo, cuando no actúa un operador) |
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
| `_vinculacion(p_codigo)` | `vincular_dispositivo` | Identidad anónima de Supabase (`auth.uid()`) **sin** dispositivo (ni vigente ni revocado); código vigente y sin usar; su sucursal activa y su cuenta `activa` | `codigo_id`, `sucursal_id`, `cuenta_id`, `monitor_cocina`, `aprobado_por`; si el código no sirve, `espera` o `restantes` (§4) |
| `_dispositivo()` | `usuarios_login`, `login` | `auth.uid()` de un dispositivo sin revocar; su sucursal activa y su cuenta `activa` | `dispositivo_id`, `sucursal_id`, `cuenta_id`, `monitor_cocina` |
| `_contexto(p_token, p_roles, p_tipo)` | Toda operación de sucursal (§3.2) | Lo de `_dispositivo()` y además una sesión de operador de **esa sucursal y ese dispositivo**, no vencida ni revocada; rol y estado (§5) | Lo de `_dispositivo()` más `sid`, `uid`, `nombre`, `rol` y si solo puede leer cocina (§5.4) |
| `_identidad()` | `crear_cuenta`, `aceptar_invitacion`, `mis_cuentas` | Sesión de Supabase de una persona: **no anónima**, con correo verificado, sin suspender ni borrar, y que nunca fue un equipo. No exige membresía: estas llamadas la crean | `auth_user_id`, `correo` |
| `_dueno(p_cuenta, p_roles, p_tipo)` | Operaciones de dueños (§3.2) | Lo de `_identidad()` y además membresía en `p_cuenta` con uno de los roles; cuenta `activa`. `p_tipo`: `lectura` o `escritura` | `cuenta_id`, `rol`, `auth_user_id`, `correo` |

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
  `interaccion`, `lectura`, `automatica`, `latido`, `sesion`, `desbloqueo` o `salida`.
- **Implementado (paso 4):**
  - **Identidad vigente en Supabase Auth** (`_auth_vigente`): los tres validadores que leen
    `auth.users` (`_dispositivo`, `_vinculacion` e `_identidad`) exigen que la identidad exista, sea
    anónima (equipo) o no (persona) según el caso, y no esté suspendida (`banned_until` futuro) ni
    borrada (`deleted_at`). Se revisa en cada llamada y no en el JWT, que sigue siendo válido hasta que
    vence y puede ser de antes de verificar el correo, de convertir la identidad, de suspenderla o de
    borrarla. Un equipo cuya identidad se convierte en una con correo deja de servir como equipo y
    tampoco entra como persona.
  - `_dueno(p_cuenta, p_roles, p_tipo)`: una **escritura** escribe la fila de la cuenta
    (`cuentas.revision`) antes que cualquier otra (orden fijo: cuenta → lo demás) y vuelve a leer la
    membresía en otra sentencia. Si otro dueño la quitó mientras esperaba, se rechaza: lo que hace un
    dueño al que acaban de quitar no se confirma después de su baja. Escribir, y no solo bloquear, es
    lo que hace que dos escrituras de la misma cuenta choquen también en REPEATABLE READ y SERIALIZABLE
    (§3.3, «Límites»). Cuenta ajena e inexistente dan la misma respuesta (`CUENTA`); un rol
    insuficiente, `PERMISO`.
  - `_vinculacion(p_codigo)` cuenta los fallos (§4) y los **devuelve** en lugar de lanzarlos, para que
    el conteo se confirme.
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
  actualización concurrente (código `40001`). Una función no puede reintentarse a sí misma (su
  fotografía de los datos no cambia), así que reintenta **quien la llama** (la app, paso 6); PostgREST
  usa READ COMMITTED. Además, las escrituras de dueños escriben la fila de la cuenta al empezar
  (`_dueno`), así que se ordenan entre sí, y `quitar_miembro` responde `ultimo_propietario` antes de
  llegar al invariante (que sigue como respaldo).
- **Invitación inicial:** la del propietario de una cuenta pendiente la crea el proveedor desde el
  servidor (SQL Editor o un script de alta), nunca la app:
  `select public.crear_invitacion_inicial('<id de la cuenta>', '<correo>');` (implementado; sin permiso
  para `anon` ni `authenticated`). Devuelve el token una sola vez, deja sin efecto las anteriores sin
  usar, vence (7 días por omisión) y, como toda invitación, solo la acepta una identidad con el mismo
  correo verificado.
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
| Alta de personas | `crear_cuenta`, `aceptar_invitacion`, `mis_cuentas` (nuevas) | `_identidad` | — | — |
| Dueños: propietario | `crear_sucursal`, `crear_administrador`, `invitar_miembro`, `cancelar_invitacion`, `quitar_miembro` (nuevas) | `_dueno(cuenta, {propietario}, escritura)` | — | — |
| Dueños: propietario o encargado | `generar_codigo`, `revocar_dispositivo` (escritura); `listar_dispositivos`, `listar_miembros` (lectura) (nuevas) | `_dueno(cuenta, {propietario, encargado}, …)` | — | — |

Consecuencia que conviene confirmar: con la cocina bloqueada por inactividad, `marcar_recibido` no se
registra. El mesero verá «Enviado» hasta que alguien desbloquee la cocina con su PIN.

### 3.3 Alta, panel de dueños y vinculación (implementado, paso 4)

Las funciones de dueños reciben la cuenta y, si tocan algo concreto, la sucursal o el id, y los buscan
siempre dentro de esa cuenta: lo de otra cuenta responde igual que lo inexistente (`no_existe`). Los
errores de datos vuelven como `{ok: false, error}`; los de identidad o permiso se lanzan (`IDENTIDAD`,
`CUENTA`, `PERMISO`). Todo queda en la bitácora de la cuenta, nunca con el código ni el token.

| Función | Qué hace | Límites y respuestas propias |
|---|---|---|
| `crear_cuenta(nombre, sucursal, zona, admin_nombre, admin_pin)` | La cuenta nace `activa` con quien la crea como propietario, en la misma transacción; su primera sucursal con el catálogo inicial y el primer administrador del personal | 3 cuentas creadas por persona (`cuentas_por_persona`); `nombre`, `zona`, `admin_nombre`, `formato`, `debil`, `limite` |
| `aceptar_invitacion(clave)` | Crea la membresía; la primera de propietario activa una cuenta pendiente. Salvaguarda: si la persona ya fuera miembro, su rol puede subir pero nunca bajar (la API no llega a ese caso; ver «Cambiar el rol») | `INVITACION`, igual para inexistente, vencida, usada, de otro correo, cuenta suspendida o de encargado en una cuenta pendiente |
| `mis_cuentas()` | Cuentas de la persona, con su rol y sus sucursales | — |
| `crear_sucursal(cuenta, nombre, zona, admin_nombre, admin_pin)` | Sucursal con el catálogo inicial y su primer administrador | 20 por cuenta |
| `crear_administrador(cuenta, sucursal, nombre, pin)` | Rescate: administrador del personal si nadie puede entrar como tal | `formato`, `debil` |
| `invitar_miembro(cuenta, correo, rol)` | Devuelve el token una vez (se guarda su hash); vence en 7 días; una vigente por correo: la anterior deja de servir | 30 vigentes por cuenta; `ya_miembro`, `correo`, `rol` |
| `cancelar_invitacion(cuenta, invitacion)` | La invitación deja de servir | `no_existe` |
| `quitar_miembro(cuenta, miembro)` | También a sí mismo. Las invitaciones y los códigos que dejó pendientes dejan de servir | `ultimo_propietario` |
| `listar_miembros(cuenta)` | Miembros (correo y rol) e invitaciones vigentes | — |
| `generar_codigo(cuenta, sucursal, monitor)` | Código de 8 caracteres (sin I, L, O, 0 ni 1; se acepta con minúsculas, espacios o guiones), vence en 10 minutos, se guarda como hash | 10 vigentes por sucursal |
| `listar_dispositivos(cuenta, sucursal)` | Equipos con su sucursal, quién lo aprobó, último uso (se anota al entrar) y revocación | — |
| `revocar_dispositivo(cuenta, dispositivo)` | Revoca (§4); repetirlo responde `yaRevocado` | — |
| `vincular_dispositivo(codigo, nombre)` | §4 | `codigo` (con `restantes`), `bloqueado` (con `espera`), `nombre`; se lanzan `IDENTIDAD`, `VINCULADO`, `REVOCADO` |

El correo de la invitación lo envía la app o un servicio aparte (se decide con el cliente, paso 6): el
servidor solo devuelve el token para armar el enlace.

- **Cambiar el rol de un miembro:** no hay una función propia. `invitar_miembro` responde `ya_miembro`
  a quien ya está en la cuenta, así que el cambio se hace quitando al miembro (`quitar_miembro`) e
  invitándolo de nuevo con el rol nuevo (`invitar_miembro` y `aceptar_invitacion`). Para bajar a un
  propietario a encargado debe quedar otro propietario. La regla de `aceptar_invitacion` para quien ya
  es miembro (sube, nunca baja) es una salvaguarda para invitaciones creadas fuera de la API; su prueba
  las inserta con SQL y no representa un flujo de la app.
- **Límites bajo concurrencia:** se comprueban con lo último confirmado en cualquier nivel de
  aislamiento. Sucursales por cuenta, invitaciones vigentes por cuenta y códigos vigentes por sucursal
  pasan por `_dueno` (escritura), que escribe la fila de la cuenta; las cuentas por persona, por la fila
  de `cuentas_por_persona`, que se comprueba y se suma en la misma sentencia. Con dos llamadas a la vez,
  en READ COMMITTED la segunda espera y responde `limite`; en REPEATABLE READ y SERIALIZABLE falla con
  `40001` y, al reintentarla en una transacción nueva, responde `limite`. Lo prueba
  `tests/sql/duenos.test.js` para los cuatro límites en los tres niveles.

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
- **Implementado (paso 4):**
  - el código se busca por su hash y se toma su fila hasta confirmar: dos equipos con el mismo código a
    la vez se ordenan y el segundo ya lo ve usado;
  - fallos (código mal escrito, vencido, usado o inexistente): por identidad, 5 → bloqueo de 15, 30 y
    60 minutos; por IP, 30 → de 5 a 60 minutos. Son contadores propios (`vin:` y `vip:`), aparte de
    los del PIN. Mientras dura el bloqueo, ni el código correcto entra;
  - una identidad que ya es equipo responde `VINCULADO`; una revocada, `REVOCADO`: la app inicia otra
    sesión anónima y se vincula con otro código;
  - una identidad suspendida o borrada en Supabase Auth no se vincula (`IDENTIDAD`, sin gastar el
    código) y, si ya era un equipo, pierde el acceso en la siguiente llamada (`DISPOSITIVO`); al
    terminar una suspensión vuelve a servir;
  - revocar termina las sesiones de operador de ese equipo (`motivo_fin = 'equipo_revocado'`) y suelta
    la cocina si la tenía.
- **Revocar:**
  - marca `revocado_en`; desde ese momento `_dispositivo` (y con él `_contexto`) rechaza al equipo en
    todas las funciones;
  - la sesión de Supabase dura poco (se configura la expiración del JWT; valor a medir, por ejemplo
    10 minutos);
  - al renovarse, las políticas del tiempo real vuelven a evaluar al equipo (§7).
- **Recuperación:** un equipo perdido o un navegador borrado se revoca y se vincula de nuevo con otro
  código. La credencial anterior no se recupera.
- **Implementado en la app (paso 6, vinculación):**
  - la sesión anónima de Supabase se guarda y se renueva en su propia clave
    (`tequeria-identidad-equipo`, `src/supabaseClient.js`);
  - si la entrada responde `DISPOSITIVO`, la app muestra «Vincular este equipo»: código (con
    minúsculas, espacios o guiones) y nombre del equipo; inicia la sesión anónima si no la hay y llama
    a `vincular_dispositivo`;
  - `REVOCADO`: descarta esa identidad (sin recuperarla), inicia otra y usa el mismo código;
    `VINCULADO`: explica que su sucursal o su cuenta no está activa por ahora; `codigo` y `bloqueado`
    dicen los intentos que quedan o cuánto esperar;
  - la identidad no se borra al recibir `DISPOSITIVO`: si la causa es temporal (sucursal o cuenta
    inactiva, suspensión), el equipo vuelve a servir sin vincularse de nuevo;
  - lo prueban los recorridos `tests/e2e/remoto/vinculacion.spec.js`.
- **Sesiones independientes:** la identidad del dispositivo no es la sesión del operador. Cambiar de
  turno o vencer las 12 horas no obliga a vincular otra vez. Y renovar el JWT del dispositivo no
  devuelve permisos a un operador bloqueado o vencido.

## 5. Sesión del operador

### 5.1 Campos

`sesiones`: `id`, `token_hash`, `sucursal_id`, `dispositivo_id`, `usuario_id`, `creada`,
`vence_absoluta` (= `creada + 12 h`), `revocada`, `motivo_fin` (`salida`, `cambio_pin`,
`pin_restablecido`, `sin_equipo`, `equipo_revocado`).

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
    revocar con `auth_user_id = auth.uid()` y con la identidad vigente (`_auth_vigente`: anónima, sin
    suspender ni borrar), igual que `_dispositivo`;
  - escritura (publicar): **sin política para clientes**, así que ningún dispositivo puede publicar.
- **Revocación con la conexión abierta:** se comprueba en el piloto y se mide el tiempo máximo en que
  el equipo aún recibe avisos (sin datos), con las mitigaciones del §4.
- **Implementado (paso 5):**
  - `_avisar_sucursal()` en 28 disparadores por sentencia (inserción, actualización y borrado; en
    `cobros` y `cocina_hechos`, sin borrado) de las 10 tablas que ve la app. Avisa una vez a cada
    sucursal que tiene filas en la sentencia; una sentencia sin filas no avisa. Se retiró el canal
    público `tequeria` y `_avisar_cambio`.
  - Escuchar: política `tequeria_escuchar_sucursal` (lectura, `authenticated`, solo `broadcast`) con
    `privado.puede_escuchar(topic)`, que aplica las mismas reglas que `_dispositivo`. Vive en el esquema
    `privado`, que la API no expone: la política necesita que `authenticated` la pueda ejecutar.
  - Publicar: no hay política. Si el proyecto tiene **otra** política sobre `realtime.messages`, el
    archivo se detiene y pide revisarla (una de inserción dejaría publicar a los clientes; una de
    lectura más amplia, escuchar canales ajenos).
  - Requisitos en Supabase: en Realtime, desactivar el acceso público a los canales (solo privados); no
    agregar `privado` a los esquemas expuestos de la API.
  - Pruebas: `tests/sql/tiempo-real.test.js` reproduce la autorización de Realtime (con
    `realtime.topic()` y la identidad del equipo) para cada regla. La medición con una conexión ya
    abierta necesita Supabase real (§9, paso 7).

## 8. Navegador

- **Claves por sucursal:** las claves de la app pasan a llevar la sucursal: `tequeria:<sucursal>:sesion`,
  `…:borradores`, `…:estacion`, `…:papel`, `…:ultimo_usuario`. La lista completa está en el
  [inventario](INVENTARIO.md#navegador).
- **Identidad del dispositivo:** la sesión de Supabase la guarda `supabase-js` en su propia clave.
- **Al revocar el dispositivo o vencer su vinculación:** se borran todas las claves `tequeria:*`, se
  cancelan las suscripciones y se descartan las respuestas que lleguen tarde.
- **Implementado (paso 5):** `src/claves.js`:
  - la sucursal la dice el servidor en la pantalla de entrada (`usuarios_login` devuelve
    `sucursal`) y se recuerda en `tequeria:sucursal`; el modo local usa la sucursal `local`;
  - sesión del operador, estación, papel, sonido del monitor y último usuario van en
    `tequeria:<sucursal>:…`; las claves anteriores (`tequeria_*`) pasan una vez a la sucursal del
    equipo y la sesión anterior se borra;
  - si el equipo aparece en otra sucursal, se borran las claves de la anterior y su sesión;
  - si el servidor responde `DISPOSITIVO`, se borran todas las claves de la app, se sueltan los canales
    y sube la «generación»: las respuestas de antes se descartan (`DESCARTADA`) y la app vuelve a la
    entrada. La pantalla de vinculación llega con el cliente (paso 6);
  - en la pantalla, `DISPOSITIVO` y `SESION` cierran la sesión igual llegue en una recarga, en el
    latido de cocina o en una acción: la pantalla se vacía, el reintento pendiente se cancela y lo que
    responda después ya no la toca. Lo prueban los recorridos «remoto simulado»
    (`tests/e2e/remoto/`), con la app compilada contra un servidor que intercepta Playwright.
- **Borradores** (paso 6):
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
4. **Dispositivos y dueños** (hecho): validadores `_vinculacion`, `_identidad` y `_dueno`; alta de
   cuentas con su primera sucursal, catálogo inicial único y primer administrador; invitaciones (también
   la inicial del proveedor), membresías y bajas sin dejar la cuenta sin propietario; códigos de
   vinculación, vinculación, panel de equipos y revocación; identidades suspendidas o borradas en
   Supabase Auth rechazadas en cada llamada; límites que se respetan en cualquier nivel de aislamiento;
   bitácora por cuenta (§3.3 y §4). Pruebas en la matriz y en `tests/sql/duenos.test.js` (flujos,
   límites y carreras). Falta probarlo contra Supabase Auth real (inicio anónimo, correo verificado,
   suspensión) en un proyecto de staging antes del piloto.
5. **Tiempo real privado y claves del navegador por sucursal** (hecho): canal `sucursal:<id>` que
   solo publica el servidor, política de escucha con las reglas de `_dispositivo`, y claves del navegador
   por sucursal con limpieza al cambiar de sucursal o al revocar el equipo (§7 y §8).
6. **Cliente:** vinculación del equipo (hecha, §4); panel de dueños, pantalla de desbloqueo,
   validación del PIN de 6 a 8 dígitos en la interfaz (también en el modo local) y borradores por
   autor.
7. **Validación con Supabase real (staging):** inicio anónimo, correo verificado, suspensión de
   identidades, canales privados con el servidor de Realtime real y la medición del tiempo máximo en
   que un equipo revocado aún recibe avisos con la conexión abierta (el caso «(paso 7)» de la matriz).
