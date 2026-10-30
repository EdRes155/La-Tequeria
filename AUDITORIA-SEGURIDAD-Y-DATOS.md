# Auditoría de seguridad y datos — La Tequería

**Fecha:** 30 de octubre de 2026. **Repositorio:** [EdRes155/La-Tequeria](https://github.com/EdRes155/La-Tequeria).

**Versión auditada:** [`8723f1f20f82400c6e939c6d23c530f30474a078`](https://github.com/EdRes155/La-Tequeria/commit/8723f1f20f82400c6e939c6d23c530f30474a078). Esta revisión desarrolla el segundo enfoque solicitado: autenticación, autorización, privacidad e integridad de operaciones. Complementa el [informe integral](AUDITORIA-LA-TEQUERIA.md), sin sustituirlo.

Las referencias a archivos y líneas de código son relativas a `tequeria-app/` en ese commit. La aplicación conserva el mismo árbol de código que la revisión integral; el commit posterior añadió únicamente aquel informe.

## Resultado y alcance de la evidencia

**El diseño publicado no proporciona una frontera de seguridad entre la pantalla de login y la base de datos.** El login por PIN devuelve un perfil sin crear una sesión autenticada; las políticas SQL permiten operar como `anon`. Con ese esquema instalado y las tablas expuestas por la Data API, una persona con la llave pública puede acceder a datos del negocio sin iniciar sesión. No recomiendo operar con datos reales de clientes ni utilizarlo como registro fiable de caja hasta corregirlo.

Se documentan **11 hallazgos: uno crítico, cuatro altos, cinco medios y uno bajo**. La prioridad refleja el impacto sobre este negocio, sin atribuir una puntuación CVSS ni contar cada tabla expuesta como una vulnerabilidad distinta.

| Evidencia | Qué se verificó | Qué no demuestra |
|---|---|---|
| Repositorio | Estado final del SQL, cliente, flujos de lectura/escritura y archivos de configuración versionados | Que producción haya aplicado exactamente ese SQL |
| Pruebas aisladas | Diez reproducciones con funciones reales y dobles de Supabase; seis comprobaciones textuales del SQL | Permisos efectivos, comportamiento real de Postgres o resistencia a ataques en producción |
| Web pública | HTML y bundle JavaScript servidos por `la-tequeria.vercel.app`; identificación del proyecto referenciado, sin mostrar llaves | Políticas, propietarios, grants heredados o ajustes del proyecto |
| Conexión Supabase disponible | El proyecto conectado no coincide con el referenciado en el bundle | No se consultó la base de ese otro proyecto ni se le atribuyeron hallazgos |

No se realizaron intentos de PIN, lecturas de tablas del negocio, pruebas de escritura, cambios de políticas ni migraciones. Esta entrega añade documentación y un script de reproducción sin red; no implementa correcciones.

## Modelo de acceso e información sensible

El navegador recibe la URL y la llave pública de Supabase, carga datos mediante `loadAll()` y se suscribe a cambios antes de entrar al sistema (`src/App.jsx:425–432,461`). `login()` comprueba un PIN mediante RPC y devuelve `id`, `nombre` y `rol`, que el cliente utiliza para decidir qué mostrar (`src/store.js:125–129`). No hay un token de operador vinculado a las escrituras. La exclusividad de cocina usa un identificador de dispositivo; no es una sesión autenticada.

Los activos relevantes son los domicilios y teléfonos de clientes en `tickets.domicilio`, PIN de operadores, catálogo y precios, existencias, comandas, gastos y cortes. Un visitante sin sesión, un operador con permisos limitados y una persona con acceso a una tablet compartida tienen riesgos diferentes; el análisis los distingue.

### Permisos previstos por el SQL completo

La tabla siguiente describe **lo que declara el script versionado**, una vez ejecutado hasta el final sobre los objetos previstos; no sustituye inspeccionar los ACL y políticas reales, incluidos privilegios heredados o preexistentes.

| Objeto | Acceso declarado para `anon` y `authenticated` | Restricción del script |
|---|---|---|
| `config`, `carnes`, `bebidas`, `mesas`, `tickets`, `gastos` | SELECT, INSERT, UPDATE, DELETE | Política `rw_all` con predicados verdaderos; sin identidad de operador |
| `cortes` | SELECT | El bloque final revoca INSERT, UPDATE y DELETE directos a esos roles |
| `usuarios` | SELECT de `id`, `nombre`, `rol` | Revoca acceso general y concede solo esas columnas; no concede lectura de `pin_hash` |
| `cocina_sesion` | SELECT, INSERT, UPDATE, DELETE | Política permisiva; contiene el identificador utilizado por la exclusividad de cocina |
| `login`, `es_admin_pin` | EXECUTE | Verifican PIN sin crear sesión; el código no limita intentos |
| `crear_usuario`, `eliminar_usuario`, `hacer_corte` finales | EXECUTE | Exigen PIN de algún administrador; no una sesión individual |
| `claim_cocina`, `latido_cocina`, `liberar_cocina` | EXECUTE | No comprueban una identidad ni rol de cocina |

**Precisiones:** las firmas antiguas de usuarios y corte sin PIN se eliminan en `supabase-schema.sql:213–215`; no se consideran APIs finales abiertas. Las funciones `SECURITY DEFINER` sí fijan `search_path`. Los permisos predeterminados de `PUBLIC`, el propietario de las funciones y los permisos de creación de esquemas requieren inspección real antes de afirmar un bypass adicional.

## Hallazgos y correcciones

### SEG-01 · Crítico · Autorización anónima y datos cargados antes del login

**Evidencia:** `supabase-schema.sql:100–123` combina grants CRUD y políticas `USING(true) WITH CHECK(true)`. `src/supabaseClient.js:8–11` no establece sesiones de operadores; `login` SQL (`:57–63`) devuelve únicamente un perfil. `fetchAll()` solicita tickets, gastos, cortes y usuarios (`src/store.js:47–55`) antes de autenticar al operador.

**Impacto:** si producción utiliza este modelo, quien acceda a la API como visitante podría leer datos de domicilio, cambiar precios o inventario y alterar o eliminar pedidos y gastos. Los roles visuales de mesero, cocinero y administrador no ofrecen una separación efectiva en la API. El problema es la combinación de permisos e identidad; la presencia de una llave pública en el navegador es normal.

**Corrección y aceptación:** implantar identidad y sesiones verificables en servidor; reemplazar políticas permisivas por autorizaciones por operación, rol y filas necesarias. Aplicar privilegio mínimo también a columnas y RPC, y evitar cargar datos financieros o personales antes del login. Una petición directa sin sesión debe quedar denegada; un mesero no debe poder alterar precios o acceder a gastos/cortes por la API. Publicar nuevas políticas sin adaptar primero el inicio de sesión dejaría a la aplicación sin acceso: preparar y probar ambos cambios juntos.

**Validación:** T01 y T02 reproducen el comportamiento del cliente con datos sintéticos. La exposición efectiva de la base productiva queda pendiente de confirmar.

### SEG-02 · Alto · Verificación pública de PIN sin defensa implementada contra intentos repetidos

**Evidencia:** `supabase-schema.sql:203–210,247` expone `es_admin_pin(p_pin)`, que permite saber si un PIN pertenece a cualquier administrador sin identificarlo. `login` también es invocable públicamente (`:126`). Las comprobaciones usan SHA-256 con el id como sal (`:62,208,223`); no hay contadores, bloqueo, expiración o registro de intentos en el código. Hay PIN de demostración en los valores iniciales y en el README; no se probó si siguen vigentes.

**Impacto:** un PIN corto y un verificador público reducen la resistencia frente a intentos repetidos. Si los hashes se expusieran por otro medio, SHA-256 es demasiado rápido para proteger secretos de baja entropía; **esta revisión no encontró lectura directa del hash concedida por el SQL final**. No se verificaron límites externos del proveedor.

**Corrección y aceptación:** asociar la autorización sensible a una sesión individual y reautenticación apropiada; limitar intentos por cuenta y origen, registrar eventos sin almacenar el PIN y retirar credenciales de demostración de altas productivas. Si se mantienen contraseñas/PIN propios, usar un mecanismo de derivación apropiado en un servicio confiable. Verificar límites y recuperación con cuentas de prueba, sin enumerar PIN reales.

### SEG-03 · Alto · Integridad financiera y autoría controladas por el cliente

**Evidencia:** `src/store.js:16–20,175–178` remite `total`, autor, fecha, estado y `reenvio` del cliente. `updateTicket` acepta un patch completo sin lista de campos permitidos. Las tablas (`supabase-schema.sql:23–54`) no imponen rangos monetarios, estructura interna de JSON ni referencias de mesa/corte. `hacer_corte` suma el `total` almacenado (`:240–243`); no lo contrasta con productos. No se define una bitácora inmutable de cambios o anulaciones.

**Impacto:** cambiar `total`, `reenvio` o `corte_id` puede desviar o excluir ventas del corte; un autor enviado como texto no demuestra quién hizo la operación. Incluso tras cerrar el acceso anónimo, este riesgo persiste si se conceden escrituras generales a operadores autenticados. No hay evidencia de que alguien lo haya explotado.

**Corrección y aceptación:** calcular totales y descuentos autorizados en servidor, registrar actor desde la sesión y timestamp del servidor, validar cantidades/importes finitos y reglas de dominio, referencias y transiciones. Usar identificadores inmutables de producto/operador, conservar el precio autorizado de cada venta y restringir cambios en campos contables. Registrar anulaciones y correcciones con motivo y actor, conservando evidencia. Una petición con total discordante, autor ajeno, referencia inexistente o estado no permitido debe rechazarse; no limitar la solución a validaciones del formulario.

**Validación:** T04, T05 y T07 confirman qué valores remite el adaptador. No son una prueba de aceptación por una base real.

### SEG-04 · Alto · Escrituras parciales y conflictos entre dispositivos

**Evidencia:** `src/App.jsx:513–527` escribe ticket, inventario y mesa por separado. Calcula el stock y los extras desde un snapshot del navegador. `src/store.js:149–152` captura errores sin propagarlos; la pantalla comunica éxito inmediatamente (`src/App.jsx:872–874`).

**Impacto:** puede guardarse una parte de la operación y fallar otra, o perderse cambios simultáneos. Con diez bebidas y dos clientes que venden una, ambos pueden escribir nueve en lugar de dejar ocho. Es un riesgo de integridad y continuidad operativa, sin necesidad de un atacante.

**Corrección y aceptación:** envío transaccional con identificación idempotente de la operación, actualización atómica de stock y control de conflictos en mesas. Mostrar éxito solo después de confirmarlo y conservar borradores pendientes de forma recuperable. Dos envíos simultáneos deben descontar ambas ventas; repetir el mismo envío no debe duplicar ticket ni consumo; un fallo intermedio no debe dejar cambios parciales.

**Validación:** T03 confirma que un fallo de escritura no se propaga. El patrón de concurrencia se revisó en código; se requiere una prueba con dos conexiones en una base desechable para cerrar el hallazgo.

### SEG-05 · Alto · Corte sin conjunto consistente de tickets ni prueba de cobro

**Evidencia:** `supabase-schema.sql:235–244` recibe fecha/hora/detalle del cliente, suma tickets y luego asigna el corte con otro comando. No fija un conjunto bloqueado ni impide dos cortes simultáneos. La función sí es transaccional; eso por sí solo no evita carreras bajo aislamiento `READ COMMITTED`. No hay un modelo verificable de pago/cancelación. El corte también retira tickets del listado de cocina al excluirse `corte_id` no nulo (`src/store.js:53`).

**Impacto:** dos cortes pueden sumar los mismos tickets; un ticket confirmado entre el agregado y el UPDATE podría archivarse en el corte sin integrar su total. El detalle recibido puede no coincidir con el agregado del servidor. Los pedidos emitidos no equivalen necesariamente a dinero cobrado y un corte durante el servicio puede ocultar cocina pendiente.

**Corrección y aceptación:** serializar cierres y fijar de forma consistente los tickets incluidos; recalcular total y desglose a partir de ese conjunto en servidor. Separar el estado de preparación del cierre contable y definir si el corte corresponde a pedidos o a cobros. En una prueba intercalada de inserción/corte y corte/corte, cada ticket debe pertenecer a un solo cierre y cuadrar con el total; los pendientes deben seguir en cocina.

**Validación:** revisión estática del SQL; no se ejecutaron carreras contra producción.

### SEG-06 · Medio · Exclusividad de cocina manipulable y tolerante a fallos

**Evidencia:** `supabase-schema.sql:151–154` permite leer y modificar `cocina_sesion`. Sus RPC no verifican rol (`:157–191`); el claim lee y después escribe sin bloqueo. `src/store.js:133–141` devuelve éxito al fallar el claim o recibir error en el latido.

**Impacto:** con el esquema actual se puede interferir en el dispositivo de cocina, liberar o sustituir su identificador; dos clientes pueden creer que tienen exclusividad. El identificador de localStorage es de dispositivo, no prueba de identidad.

**Corrección y aceptación:** autorizar por sesión/rol y aplicar adquisición atómica con vencimiento en servidor; restringir acceso directo a la tabla. Ante error, mostrar estado incierto y no prometer exclusividad. Dos reclamaciones concurrentes deben conceder una sola sesión y un visitante no debe modificarla.

**Validación:** T06 reproduce la concesión de éxito ante errores; los permisos y la carrera se revisaron estáticamente.

### SEG-07 · Medio · PIN y domicilios legibles en el respaldo local

**Evidencia:** `src/store.js:64–65` almacena el estado completo en localStorage. En modo local contiene usuarios con PIN y tickets con domicilios (`src/App.jsx:33–35,60,437–440,869`). Cerrar sesión solo restablece el usuario en memoria (`:474`).

**Impacto:** otra persona con acceso al perfil del navegador de una tablet compartida puede recuperar esos datos después de salir. **La persistencia automática del estado se desactiva en modo Supabase**; no se afirma que todos los clientes online almacenen ese respaldo. El navegador puede además conservar información creada anteriormente en modo local.

**Corrección y aceptación:** limitar datos retenidos, evitar PIN legibles, definir duración de conservación y procedimiento de limpieza en dispositivos compartidos sin borrar ventas no sincronizadas. Un cifrado con clave incluida en el mismo cliente no resuelve por sí solo el acceso de un usuario local. Inspeccionar almacenamiento después de cerrar sesión no debe revelar credenciales ni datos personales retenidos innecesariamente.

**Validación:** T08 comprueba la serialización local con PIN y domicilio sintéticos; la permanencia tras logout se revisó en código.

### SEG-08 · Medio · Ciclo de administradores sin garantías en servidor

**Evidencia:** la UI impide borrar al último administrador (`src/App.jsx:1978–1979`), pero la función SQL final elimina cualquier id con un PIN admin válido (`supabase-schema.sql:228–233`). El alta también acepta rol/PIN sin validaciones equivalentes en servidor (`:217–225`). El arranque llama una firma eliminada y no puede crear el primer administrador (`src/store.js:83`, SQL `:213,217`).

**Impacto:** un administrador o alguien con su PIN puede dejar el sistema sin administrador o crear perfiles inválidos mediante la API, saltándose las protecciones visuales. La instalación desde cero carece de una inicialización consistente. No hay atribución a un administrador concreto cuando se autoriza con el PIN de cualquiera.

**Corrección y aceptación:** alta inicial privilegiada y de un solo uso, restricciones de rol y credenciales en servidor y protección transaccional del último administrador, también ante eliminaciones concurrentes. Registrar al actor y ofrecer recuperación administrativa controlada. Probar alta limpia, rol inválido y borrado del último administrador mediante API, sin depender de la UI.

### SEG-09 · Medio · Divergencia entre importes guardados y visibles

**Evidencia:** `money()` (`src/App.jsx:109`) usa `toFixed(0)`, mientras la edición de precios admite decimales (`:1745` y formularios). El adaptador conserva el total decimal.

**Impacto:** un importe 25,50 se presenta como $26 en comandas, tickets y resúmenes que usan esa función. Esto dificulta conciliar lo mostrado con lo registrado; no demuestra un cargo real distinto ni un fraude.

**Corrección y aceptación:** definir representación monetaria uniforme y mostrar los centavos autorizados sin redondeos implícitos; validar igualdad entre importe visible, ticket, persistencia y corte con precios decimales.

**Validación:** T09 ejecuta la función real con 25,50 y confirma `$26`.

### SEG-10 · Medio · Errores y límites de lectura pueden ocultar información contable

**Evidencia:** `src/store.js:47–60` ignora `.error` y transforma respuestas sin datos en colecciones vacías. Tickets, gastos y cortes no paginan. Los agregados de la pantalla se calculan con los registros recibidos.

**Impacto:** una denegación o un fallo puede parecer ausencia de datos; superar el límite configurado de filas de la API puede truncar resúmenes. No se inspeccionó ese límite en producción. Una lectura parcial y una colección realmente vacía no deberían ser indistinguibles para caja.

**Corrección y aceptación:** comunicar errores, conservar el último estado válido y bloquear cierres basados en información incompleta. Paginar históricos y calcular agregados autoritativos. Una consulta fallida debe mostrar un error, y superar el límite de una página debe conservar el total completo.

**Validación:** T10 reproduce respuestas con error que terminan en colecciones vacías.

### SEG-11 · Bajo · Protección insuficiente ante inclusión accidental de secretos

**Evidencia:** `.gitignore` solo excluye `node_modules`, `dist` y `.DS_Store`; no excluye `.env`. El README indica crear ese archivo. `vite.config.js:8` publica prefijos `VITE_` y `NEXT_PUBLIC_`. `.env.example` contiene marcadores de URL y llave anon, sin credenciales reales.

**Impacto:** existe riesgo de versionar accidentalmente configuración local o de introducir un secreto en una variable que se envía al navegador. **No se encontró una llave privilegiada literal en los archivos de código revisados**; el escaneo limitado del bundle identificó una llave de rol público `anon`, sin mostrar su valor. No se hizo un análisis exhaustivo del historial ni una certificación de ausencia de secretos.

**Corrección y aceptación:** excluir archivos de entorno locales conservando el ejemplo, limitar las variables públicas a lo necesario y activar detección de secretos en commits/CI. Si una llave privilegiada se publica, rotarla; una llave pública de cliente no debe tratarse como un secreto ni usarse como control de acceso. Verificar con un archivo sintético que `.env` se ignore y que el bundle no contenga variables privadas.

## Reproducción y criterios para cerrar la auditoría

El commit incluye [`auditoria/seguridad-datos.cjs`](auditoria/seguridad-datos.cjs). Desde la raíz del repositorio, con Node.js 18 o superior:

```bash
node auditoria/seguridad-datos.cjs
```

No requiere instalar paquetes, no realiza peticiones de red y no modifica archivos ni una base de datos. Se ejecutó contra los archivos auditados: **10 reproducciones confirmadas y 6 comprobaciones textuales SQL verificadas**. Un resultado confirmado significa que se reprodujo el comportamiento descrito, incluidos defectos; **no es un certificado de seguridad ni una suite que deba permanecer verde después de corregirlos**. Las pruebas de API usan dobles; comprueban el cliente, no aceptación de datos por Postgres. Los futuros controles deben invertir esas expectativas y comprobar que los defectos ya no ocurren.

Para validar la corrección, utilizar una base desechable con el esquema y los permisos efectivos del despliegue, identidades de visitante/mesero/cocinero/admin y datos sintéticos. La matriz mínima de aceptación es:

| Escenario | Resultado requerido |
|---|---|
| Visitante llama a tablas o RPC sensibles directamente | Sin datos de negocio ni escrituras permitidas |
| Mesero o cocinero intenta una operación administrativa | Denegación por servidor, aunque se cambie el cliente |
| Login con repetición controlada de errores | Limitación verificable y recuperación segura |
| Total, autor, referencias o campos contables manipulados | Rechazo o cálculo/atribución autoritativos |
| Dos envíos sobre el mismo stock y reintento del mismo envío | Descuento correcto y una sola operación persistida |
| Inserción durante corte y dos cortes simultáneos | Sin omisiones, doble inclusión ni detalle discordante |
| Adquisición simultánea de cocina y errores de RPC | Exclusividad real y comunicación del estado incierto |
| Eliminación concurrente de administradores | Conservación de al menos un administrador autorizado |
| Cierre de sesión en dispositivo compartido | Credenciales y datos retenidos conforme a la política definida |
| Precios con centavos, lecturas fallidas e históricos paginados | Importes consistentes y ausencia de totales parciales silenciosos |

**Prioridad de remediación:** primero SEG-01 y SEG-02; después validación autoritativa, atomicidad y corte (SEG-03 a SEG-05); luego controles de cocina, dispositivos, administración y lecturas/importes (SEG-06 a SEG-10), junto con la higiene de secretos (SEG-11).

## Controles positivos y límites pendientes

- El script final limita las columnas legibles de `usuarios`, exige PIN admin para las tres RPC sensibles finales y revoca las escrituras directas de `cortes` a `anon` y `authenticated`. Se revisaron esas protecciones para evitar falsos positivos.
- Los textos se interpolan mediante React y no se encontraron sinks obvios como `dangerouslySetInnerHTML`, `innerHTML`, `document.write` o `eval` en el código de la aplicación. Tampoco se encontró SQL dinámico construido con entradas del usuario en las RPC revisadas. Esto no equivale a demostrar ausencia de XSS o inyección en cualquier configuración futura.
- Quedan pendientes de acceso al proyecto correcto: políticas/ACL reales, grants de `PUBLIC` y heredados, propietario y configuración de las funciones, esquemas expuestos, protecciones de API, políticas de backup/retención, restauración, logs de seguridad y posible exposición histórica de secretos. No se atribuye un fallo de backup, cifrado o red sin evidencia.
- No se auditaron Storage, Edge Functions ni integraciones de pago no presentes en el repositorio. No se verificaron versiones exactas de dependencias productivas; los rangos sin lockfile impiden atribuir una resolución concreta o una vulnerabilidad de paquete a ese despliegue.
- Referencias técnicas consultadas: [RLS y roles de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), [permisos de funciones](https://supabase.com/docs/guides/database/functions) y [seguridad de producto](https://supabase.com/docs/guides/security/product-security).

La confirmación de los hallazgos en código y las reproducciones locales no implica que se hayan explotado en producción. El cierre requiere verificar los controles corregidos sobre la configuración efectiva del proyecto correspondiente.
