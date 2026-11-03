# Plan: La Tequería para varias taquerías

Versión 2.1, 3 de noviembre de 2026. Primera versión: 31 de octubre de 2026.
Estado: **plan aprobado, sin ejecutar.** Nada de esto está implementado todavía.

Esta versión incorpora la [revisión de factibilidad](REVISION-PLAN-MULTINEGOCIO.md) y puntos
adicionales encontrados al contrastarla con el código.

## Decisión

**Opción 1: una sola app y una sola base de datos para todas las taquerías**, con cada dato
ligado a su taquería. La app sigue en Vercel y la base en Supabase. No hace falta cambiar React,
Vite, Vercel ni Supabase.

**El primer objetivo es un piloto:** dos taquerías operando por separado con el menú y las reglas
que hoy tiene La Tequería. La personalización amplia se hace después, según lo que muestre el
piloto. Es una refactorización importante más un sistema nuevo de identidad y cobro de
suscripciones: no exige rehacer el producto, pero tampoco es solo agregar configuración.

La opción 2 (una instalación por cliente) queda solo como un plan «dedicado» para un cliente
grande que la pague. Se haría siempre desde este mismo repositorio, con la configuración de
cada cliente en variables y sin copias del código.

Se descartó una base separada por cliente dentro de la misma web. Se puede hacer (la app vería
qué base usar según el subdominio), pero junta lo caro de las dos opciones: pagar y actualizar
una base por cliente y, además, la complejidad de la opción 1.

## Comparación

Los costos y la capacidad son estimaciones: hay que revisar los precios vigentes y medir el uso
real antes de prometer un número de clientes por plan.

| | 1. Una app para todos | 2. Una instalación por cliente |
|---|---|---|
| Costo por cliente | Bajo: los servicios se comparten (hay que medirlo) | Un proyecto de Supabase por cliente, unos 10 a 25 USD al mes cada uno |
| Actualizaciones | Una migración y una publicación sirven para todos | Migrar y publicar una vez por cada cliente |
| Alta de un cliente | Se registra solo con Google o correo | Hay que armar a mano el proyecto, la base y los usuarios |
| Aislamiento de datos | Depende de que cada función compruebe la taquería | Total: cada cliente tiene su base |
| Personalización | Por configuración, igual para todos | A medida, pero un repositorio por cliente termina en varias versiones distintas que mantener |
| Restaurar un respaldo | Afecta a todos; un solo cliente requiere un proceso especial | Afecta a un solo cliente |
| Si algo falla | Afecta a todos a la vez | Afecta a un solo cliente |

## Por qué la opción 1 le queda a esta app

- El navegador no puede tocar las tablas: todo pasa por funciones del servidor que revisan la
  sesión. La taquería se puede resolver ahí, en un solo lugar.
- Envío de comandas, existencias, cobros y corte ya son transaccionales; sus reglas se conservan
  dentro de cada taquería si se adaptan consultas, referencias y bloqueos.
- Dominio, datos, estilos y diálogos están separados, y ya hay pruebas unitarias, de SQL y de
  navegador en la CI para agregar las de aislamiento.
- Lo caro es mantener y actualizar, y la opción 2 lo multiplica.

## Cambios respecto a la versión 1

- El plan ahora apunta primero a un piloto de dos taquerías, no a todo de una vez.
- Seguridad: no basta con poner la taquería en la llave de cada tabla; cada función debe
  comprobar que el dato pertenece a la taquería de la sesión.
- Vincular un dispositivo **reduce** el riesgo de que prueben PINs, pero no lo elimina; los
  límites de intentos se quedan.
- La configuración (paso 2) se divide en lo del piloto y lo de después; el antiguo paso 4,
  «menú configurable», se integra ahí.
- Tiempo real y datos del navegador también se separan por taquería (paso 4 nuevo).
- La migración de La Tequería se diseña al principio, aunque se ejecute al final.
- La suscripción necesita una parte de servidor, y restaurar a un solo cliente necesita un
  proceso propio.
- «Una sola cocina activa» ya es configurable (`variasCocinas`); se corrigió en el paso 2.

En la versión 2.1:

- El respaldo antiguo y `app_state` no se borran al inicio: primero se confirma que están
  cerrados, se verifica una copia recuperable y se ensaya la migración; la eliminación es lo
  último.
- Tiempo real: solo el servidor publica avisos, las políticas separan quién escucha, y se
  comprueba qué pasa con las conexiones abiertas de un dispositivo revocado.
- Se tomaron tres decisiones: cuenta con sucursales, varios dueños por cuenta con roles, y
  vinculación de dispositivos con un código de un solo uso.

## Decisiones

### Tomadas (3 de noviembre de 2026)

1. **Cuenta con sucursales.**
   - La **cuenta** es la empresa: agrupa sus sucursales, tiene la suscripción y a los dueños.
   - La **sucursal** es la unidad que separa los datos de operación: mesas, cocina, folio, corte,
     inventario, menú, personal y dispositivos. **En este plan, «taquería» quiere decir
     sucursal.**
   - En el piloto cada cuenta tendrá una sola sucursal, pero el modelo ya permite varias. Los
     reportes conjuntos y el inventario compartido entre sucursales quedan para después.
2. **Varios dueños por cuenta, con roles.**
   - Membresías entre personas (Supabase Auth, Google o correo) y cuentas, con rol:
     - **encargado:** aprueba y revoca dispositivos, ve reportes;
     - **propietario:** todo lo del encargado, más la suscripción e invitar o quitar miembros.
   - Una persona puede pertenecer a varias cuentas. Siempre queda al menos un propietario, como
     hoy pasa con el último administrador.
   - Los dueños no son el rol operativo **administrador** del personal, que sigue entrando con su
     PIN en la sucursal (precios, usuarios, corte).
3. **Vinculación de dispositivos con un código de un solo uso** (detalle en el paso 3).

### Pendientes

4. **Segunda taquería del piloto:** cuál será y si su menú cabe en la plantilla actual.
5. **Mínimos de seguridad que ningún cliente puede bajar:** largo del PIN, límites de intentos y
   duración de la sesión.

## Seguridad y aislamiento

El riesgo principal es que un error muestre o cambie datos de otra taquería. Se cubre así:

- **La taquería sale de la sesión, en el servidor.** Un selector, un nombre en la dirección o un
  subdominio sirven para mostrar, pero nunca para dar acceso.
- **Cada función comprueba la pertenencia**, no solo al leer o escribir:
  - cuando recibe listas de comandas (por ejemplo `mover_tickets` o `archivar_tickets`);
  - cuando valida el PIN de un administrador (no puede servir el de otra taquería);
  - cuando devuelve algo ya guardado. Hoy `enviar_comanda` y `cobrar` responden con el registro
    existente si llega un identificador repetido; si fuera de otra taquería, filtraría sus datos.
- **Llaves y referencias:**
  - No hace falta volver compuesta cada llave: los identificadores que ya son únicos (comandas,
    cobros) pueden seguir así.
  - Las claves locales («Mesa 1», «pastor», la fila de configuración, la cocina activa) deben
    poder repetirse entre taquerías y ser únicas dentro de cada una.
  - Las referencias deben impedir ligar mesa, usuario, comanda, cobro o corte de taquerías
    distintas.
- **RLS no basta por sí sola.** Las funciones corren como propietario (`SECURITY DEFINER`) y se
  saltan RLS. Hay que mantener las tablas cerradas, autorizar dentro de cada función, cuidar la
  integridad y probarlo. Una segunda barrera con RLS requiere diseñar aparte el propietario y el
  contexto de las funciones.
- **Pruebas de aislamiento:** la matriz de la sección «Criterio para cerrar el piloto», más un
  Supabase de pruebas para todo cambio antes de producción.

## Acceso

- **Modelo:** identidad del dueño → membresía en la cuenta con su rol → dispositivo vinculado a una
  sucursal → PIN del operador → sesión de esa sucursal.
- **Dueños:** entran con Google o correo (Supabase Auth). El propietario crea la cuenta y sus
  sucursales, ve la suscripción e invita a otros miembros. Propietarios y encargados dan de alta
  al personal y aprueban los dispositivos.
- **Dispositivos:**
  - Se vinculan con un código de un solo uso (paso 3). Después el personal entra como hoy, con su
    nombre y su PIN, sin correo.
  - El identificador que hoy guarda `store.js` en el navegador no es una credencial. La
    vinculación necesita una credencial verificable, que se pueda revocar, y un camino de
    recuperación.
  - Conviene que cada dispositivo vinculado tenga su propia sesión de Supabase. Eso permite usar
    canales privados de tiempo real (paso 4).
- **Antes de entrar** solo se muestra el personal de la taquería del dispositivo. Hoy
  `usuarios_login()` muestra a cualquiera los nombres de todo el personal.
- **Vincular reduce el riesgo pero no lo elimina:** desde un equipo vinculado, robado o
  comprometido se pueden seguir probando PINs, así que los bloqueos por intentos se mantienen.

## Qué hay que cambiar

### 1. Núcleo de aislamiento: la taquería en datos y funciones

- **Tamaño del cambio:**
  - El esquema tiene 14 tablas y 64 funciones; 40 son de la app y el resto son auxiliares
    internas.
  - Todas las tablas y funciones se revisan, incluidas las auxiliares, los reintentos y las
    operaciones en lote.
- **Lo que hoy es único para toda la base y pasa a ser de cada taquería:**
  - la fila de configuración y la cocina activa (`id = 1`, usado en 21 lugares);
  - las mesas (números enteros) y las carnes (claves como `pastor`);
  - el folio, que hoy es una sola numeración;
  - el corte, los resúmenes, la retención de domicilios, la bitácora y los bloqueos del corte.
- **Folios y bloqueos por taquería:**
  - Un corte de una taquería no debe frenar los cobros de otra.
  - Si el folio reinicia por día o por corte, debe ser único dentro de ese periodo, con un
    identificador interno aparte.
- **Fechas y retención por taquería:** cada una usa su propia zona horaria y su propio plazo de
  anonimización.
- **Sin funciones viejas sin contexto:** no se conservan versiones de las funciones que no reciban
  o resuelvan la taquería.
- **Cobro de cada comanda:** `tickets.cobro_id` hoy guarda los valores especiales `previo` y
  `no_cobrado`. Hay que separarlos en un estado propio antes de ligarlo a la tabla de cobros.

### 2. Configuración por taquería

Cambiar un dato en la configuración no vuelve genérica la app: las reglas del catálogo están en
el navegador (`dominio.js`), en el SQL y en el modo local, y hay que cambiar las tres a la vez.
Las ventas guardan el nombre y el precio de cada producto, así que cambiar el menú no altera las
ventas pasadas; esto debe seguir así.

Una taquería nueva arranca con los valores que hoy usa La Tequería, que se indican entre
paréntesis.

#### Para el piloto

Lo mínimo para que dos taquerías trabajen por separado, con la plantilla actual del menú, en
pesos y con las reglas de hoy:

- **Negocio:** nombre y zona horaria (hoy Ciudad de México).
- **Mesas:** cuántas hay (hoy 8 fijas).
- **Folio:** numeración propia de cada taquería, consecutiva como hoy.
- **Menú:**
  - carnes, bebidas y existencias, precios y productos ocultos (hoy ya se editan);
  - productos extra dentro de las categorías existentes (hoy ya se pueden agregar; no se pueden
    crear categorías nuevas).
- **Cocina:** modo impresora o monitor, imprimir también en modo monitor y varias pantallas a la
  vez (hoy ya se configuran en Administración → Cocina).

#### Después del piloto

Según lo que pidan los clientes:

- **Negocio**
  - Logo y color de marca (hoy el logo y la paleta «nopal» son fijos).
  - Dirección, teléfono y datos fiscales que salen en el ticket.
  - Moneda (hoy pesos).
- **Mesas:** nombre de cada una (hoy «Mesa 1», «Mesa 2»…; por ejemplo «Barra» o «Terraza»).
- **Tipos de pedido:** activar o no «Para comer aquí», «Para llevar» y «Domicilio» (hoy los tres).
- **Folio:** reiniciar cada día o en cada corte, prefijo (por ejemplo «A-») y número inicial.
- **Menú genérico**
  - Tipos de producto por carne (hoy fijos: taco, taco de queso, gringa, llenadora, volcán,
    costra y media costra).
  - Productos sin carne (hoy fijos: quesadilla de maíz, quesadilla de queso, volcán de queso,
    costra y media costra de queso).
  - Categorías nuevas y su orden en tickets y cocina (hoy tacos, gringas, volcanes, costras,
    bebidas). Otra taquería puede vender cosas que no encajan en «carne × tipo de producto».
  - Si se descuenta inventario al vender (hoy sí).
  - Extras de empaque para llevar y domicilio (hoy fijos: verdura aparte, bolsa de verdura,
    tortillas de harina y de maíz; sus precios ya se editan).
  - Preparaciones (hoy fijas: con todo, natural, con cilantro, con cebolla).
- **Ticket de cocina**
  - Contraer los nombres: no abreviar, abreviar solo los productos (como hoy) o abreviar
    productos y carnes (por ejemplo «T Pas.»).
  - Diccionario de abreviaturas editable (hoy T, T queso, G, Llen., V, C, ½C, Quesa, Tort.).
  - Mostrar o no el conteo de tacos (hoy sí).
  - Papel por defecto de 58 u 80 mm (hoy 58; cada dispositivo ya puede cambiarlo).
- **Ticket de cuenta**
  - Mensaje al pie (hoy «¡Gracias por su visita!»).
  - Mostrar o no el precio unitario (hoy sí, cuando hay más de una pieza).
  - Datos del negocio en el encabezado.
- **Cobros**
  - Métodos de pago activos (hoy efectivo, tarjeta y transferencia).
  - Propinas sugeridas (hoy 10 % y 15 %, más una cantidad libre).
  - Montos rápidos de efectivo (hoy el exacto y los billetes que lo cubren).
  - «Liberar la mesa al cobrar» marcado o no por defecto (hoy marcado).
- **Reglas de mesa**
  - No liberar una mesa sin cobrarla (hoy activa).
  - Permitir «Cerrar sin cobro» con PIN de administrador y motivo (hoy activo).
- **Estatus del pedido:** cuándo pasa a «Recibido» (hoy en cuanto aparece en la pantalla de
  cocina; la otra opción es un botón en cocina).
- **Cocina**
  - Minutos para marcar la espera (hoy 10 y 20).
  - Auto-imprimir los pedidos nuevos y los avisos (hoy se eligen en cada dispositivo).
- **Corte**
  - Quién puede hacerlo (hoy cocinero o administrador, siempre con PIN de administrador).
  - Compartir el resumen por WhatsApp (hoy disponible).
- **Domicilio:** días para anonimizar direcciones y teléfonos (hoy 90).
- **Seguridad**, sin bajar de los mínimos acordados:
  - largo del PIN (hoy de 4 a 8 dígitos);
  - intentos antes del bloqueo (hoy 5 por usuario y 30 por conexión);
  - duración de la sesión (hoy 14 horas sin uso y 3 días como máximo).
- **Permisos por rol:** qué secciones ve y edita cada rol (hoy fijos para mesero, cocinero y
  administrador).

### 3. Registro, dueños y dispositivos

- **Registro:**
  - El dueño se registra con Google o correo (Supabase Auth) y crea la cuenta y su primera
    sucursal, con su primer administrador del personal.
  - Sustituye a `crear_admin_inicial`, que hoy solo se ejecuta desde el SQL Editor.
- **Membresías:** propietario y encargado, invitaciones por correo, y el último propietario no se
  puede quitar.
- **Vinculación con un código de un solo uso:**
  1. En su panel, un propietario o encargado elige la sucursal y genera un código de 8
     caracteres que vence en 10 minutos.
  2. En el dispositivo nuevo se escribe ese código.
  3. El servidor lo consume una sola vez: lo guarda como hash, rechaza códigos vencidos o ya
     usados, y limita los intentos por conexión.
  4. El dispositivo recibe su propia credencial: una sesión de Supabase ligada a esa sucursal y a
     ese registro de dispositivo, que también sirve para los canales privados (paso 4).
- **Panel de dispositivos:**
  - Lista de equipos con nombre, sucursal, quién lo aprobó y última actividad.
  - **Revocar** surte efecto de inmediato en las funciones de la app, y en el tiempo real dentro
    del tiempo máximo medido (paso 4).
- **Recuperación:** si se pierde un equipo o se borra el navegador, se revoca el registro anterior
  y se vincula de nuevo con otro código. No hay forma de «recuperar» la credencial anterior.
- **Pantalla de entrada:** muestra solo el personal de la sucursal del dispositivo.

### 4. Tiempo real y datos del navegador

- **Canales privados por taquería:**
  - Hoy hay un solo canal público, `tequeria`, para todos. Cambiarle el nombre por taquería evita
    recargas cruzadas, pero no controla quién escucha.
  - Hay que usar [canales privados](https://supabase.com/docs/guides/realtime/authorization),
    que piden la sesión de Supabase del dispositivo. El token de las funciones de la app no
    sirve para eso.
  - Hoy, además, cualquiera con la llave pública puede mandar avisos falsos al canal y hacer que
    todas las pantallas recarguen.
- **Quién escucha y quién publica.** Las políticas de los canales privados separan las dos cosas:
  - Escuchar: solo dispositivos con sesión vigente, no revocada, de la misma taquería que el
    canal.
  - Publicar: ningún dispositivo. Los avisos operativos los publica únicamente el servidor (los
    disparadores de las tablas), así que no hay política de publicación para los clientes.
  - Los avisos siguen sin llevar datos: solo dicen qué parte cambió, y cada pantalla pide los
    datos por las funciones de la app, que ya comprueban sesión y taquería.
- **Dispositivo revocado con la conexión abierta:**
  - Hay que **comprobar** qué pasa. Según la documentación, el permiso del canal se revisa al
    conectarse y no necesariamente en cada mensaje, así que la conexión podría seguir recibiendo
    avisos un tiempo.
  - Mitigaciones previstas:
    - el dispositivo no puede leer ni escribir datos desde el momento de la revocación, porque
      las funciones lo rechazan;
    - su sesión de Supabase dura poco (minutos) y no se puede renovar tras la revocación;
    - al renovarla, la app vuelve a unirse al canal y el permiso se revisa de nuevo.
  - El tiempo máximo en que un dispositivo revocado aún recibe avisos (sin datos) se mide y se
    documenta como parte del piloto.
- **Datos del navegador:**
  - Sesión, borradores, estación de impresión y demás preferencias guardadas llevan la taquería,
    o se limpian al cambiar de taquería.
  - Al cambiar de taquería se cancelan las suscripciones y se descartan las respuestas que
    lleguen tarde de la anterior.

### 5. Pruebas y ambiente de pruebas (desde el inicio)

- Un Supabase de pruebas y una copia desechable de los datos actuales.
- Inventario de todas las funciones, auxiliares, claves y canales, para no dejar ninguno sin
  revisar.
- La matriz de aislamiento del «Criterio para cerrar el piloto», en la CI.
- Pruebas de capacidad: dispositivos a la vez, llamadas, conexiones, CPU, mensajes de tiempo
  real, almacenamiento y exportaciones. Con eso se calculan los costos reales.

### 6. Migración de La Tequería (se diseña al principio, se ejecuta al final)

- **Respaldo antiguo y `app_state`: se borran al final, no al inicio.** El respaldo
  `respaldo_v2_20261030` guarda hashes de PIN viejos y domicilios; `app_state` es la tabla de la
  versión 1. Orden:
  1. **Confirmar que están cerrados** (revisado el 3 de noviembre de 2026):
     - el esquema del respaldo solo lo puede usar el propietario de la base, sin acceso para la
       app ni para `service_role`;
     - `app_state` tiene RLS activa y ningún permiso para la app; conserva 3 políticas antiguas
       que hoy no tienen efecto.
     - Se vuelve a comprobar justo antes de empezar.
  2. **Verificar una copia recuperable** de toda la base: restaurarla en una instancia aparte y
     comprobar que se puede leer, no solo que existe.
  3. **Ensayar la migración** sobre esa copia (siguiente punto) y hacer la migración real.
  4. **Eliminación controlada:**
     - cuando la migración real esté validada y haya pasado un periodo de observación acordado;
     - con la copia verificada a la mano;
     - borrando también las políticas antiguas de `app_state`;
     - dejando registro de qué se borró y cuándo.
- **Ensayo en una copia desechable:**
  1. Crear la taquería inicial.
  2. Asignarle todos los registros.
  3. Resolver referencias y validar la pertenencia.
  4. Al final, imponer las restricciones.
- **Transiciones propias:** sesiones abiertas, dispositivos, folios, cortes y los cobros
  especiales (`previo`, `no_cobrado`).
- **Antes del cambio en producción:**
  - comparar conteos, totales vendidos y cobrados, existencias y relaciones;
  - revisar los pedidos abiertos;
  - acordar cómo recuperarse sin perder ventas que entren después del cambio. Un respaldo no basta
    si restaurarlo borraría operaciones nuevas.

### 7. Suscripción, respaldos y operación comercial

- **Cobro de la suscripción:**
  - Stripe o Mercado Pago necesitan una parte de servidor (Vercel Functions o Supabase Edge
    Functions) con llaves privadas.
  - Los avisos de pago deben verificarse y no aplicarse dos veces.
  - Hacen falta estados de suscripción.
- **Si un pago falla o vence:** definir qué pasa, sin cortar una comanda o un cobro a la mitad.
- **Respaldos por cliente:**
  - Exportar no es restaurar. Para recuperar a un solo cliente se restaura en una instancia aparte
    y se extraen y reintegran solo sus datos.
  - Hay que ensayarlo, porque restaurar la base compartida regresaría a todos al pasado.
- **Operación:** monitoreo y cuotas por cliente, con costos validados por las mediciones del
  paso 5.

## Orden de trabajo

1. **Cerrar las decisiones pendientes** (quedan la segunda taquería y los mínimos de seguridad).
2. **Preparar pruebas y migración:** ambiente de pruebas, copia desechable de los datos e
   inventario de funciones, claves y canales (pasos 5 y 6).
3. **Implementar el núcleo de aislamiento y acceso:** pasos 1, 3 y 4, y la parte de piloto del
   paso 2.
4. **Probar La Tequería y una segunda taquería** con el menú actual. Deben funcionar venta, cobro,
   corte, inventario y dos cocinas sin interferirse.
5. **Preparar la operación comercial:** paso 7, con precios y costos medidos.
6. **Ampliar la personalización** según lo aprendido: la parte «después del piloto» del paso 2.

## Criterio para cerrar el piloto

- Dos taquerías usan «Mesa 1», «Pastor» y sus propios folios sin mezclarse.
- Ninguna función deja leer ni cambiar datos de otra taquería. Se prueba con:
  - identificadores ajenos y listas mezcladas;
  - reintentos de comandas y cobros con identificadores de la otra taquería;
  - el PIN de un administrador de la otra taquería;
  - un código de vinculación vencido, ya usado o de otra cuenta (debe fallar);
  - un dispositivo revocado: no puede leer ni escribir desde ese momento, y deja de recibir
    avisos de tiempo real dentro del tiempo máximo medido;
  - un dispositivo o cualquier cliente que intenta publicar en el canal de tiempo real (debe
    fallar);
  - cambios de taquería en el mismo navegador;
  - límites de las consultas.
- Cobros, cortes, retención de domicilios y exportación quedan aislados también con operaciones
  al mismo tiempo en las dos taquerías.

## Antes de cobrar

Las condiciones de los planes son aproximadas; hay que revisar las vigentes.

- El plan gratis de Vercel no permite uso comercial: hace falta Vercel Pro.
- El plan gratis de Supabase pausa los proyectos inactivos y no incluye respaldos: para clientes
  hace falta Pro.
- La app guarda teléfonos y direcciones de los pedidos a domicilio. Hacen falta aviso de
  privacidad y términos de servicio, conforme a la ley de protección de datos personales.

## Cuándo sí conviene la opción 2

Si solo habrá 2 o 3 clientes, o si una cadena exige sus datos en su propia cuenta. Aun así: un
solo repositorio, con la configuración de cada cliente en variables, sin copias.
