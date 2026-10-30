# Auditoría integral de La Tequería

Fecha: 30 de octubre de 2026. Repositorio: https://github.com/EdRes155/La-Tequeria

Versión de referencia: `873e8d6bde0ced27536e8bb44b76b843b542d497` (rama `main`). Código revisado en `tequeria-app/`. El árbol obtenido de GitHub coincide con los hashes de los archivos revisados.

## Diagnóstico

**No recomiendo usar esta versión con datos reales de clientes o como registro fiable de caja sin corregir los permisos y la persistencia.** El esquema publicado permite acceso anónimo a datos operativos, mientras que los roles se aplican principalmente en la interfaz. Además, una comanda puede mostrarse como enviada aunque falle su escritura.

Esto es una conclusión sobre el código y el esquema del repositorio. **No se ha confirmado que producción tenga exactamente esas políticas.** No se consultaron datos del negocio ni se probaron escrituras contra su base de datos.

La aplicación tiene una base funcional clara: comandas por mesa, cocina, inventario, gastos y roles. Hay medidas útiles, como no exponer el hash del PIN mediante SELECT y exigir PIN de administrador en las versiones finales de las funciones de usuarios y corte. Esas medidas no compensan el acceso abierto al resto de tablas.

## Hallazgos por prioridad

### 1. Crítico — Acceso anónimo a pedidos, inventario y gastos

**Evidencia:** `supabase-schema.sql:100–123` crea políticas `for all using (true) with check (true)` y concede SELECT/INSERT/UPDATE/DELETE a `anon` y `authenticated` en configuración, carnes, bebidas, mesas, tickets y gastos. El bloque final revoca escrituras directas únicamente en `cortes`. `cocina_sesion` también queda abierta en las líneas 151–154. `src/supabaseClient.js:11` indica que no se usa Supabase Auth; `login()` solo devuelve id, nombre y rol.

**Impacto:** con ese esquema instalado, quien obtenga la llave pública del cliente podría leer pedidos y datos de domicilio, alterar precios o existencias y modificar o borrar tickets sin conocer un PIN. Ocultar botones por rol no impide llamar a la API. La llave anon es pública por diseño; la vulnerabilidad está en los permisos.

**Reproducción segura:** en una base aislada con el esquema completo, llamar a la API como `anon`, sin ejecutar `login`, y comprobar lectura y modificación de una fila de prueba. No se ejecutó contra producción.

**Corrección:** establecer identidad verificable mediante Auth o un backend de sesiones; denegar acceso anónimo a datos del negocio y aplicar permisos de cada rol en servidor/RLS. Limitar RPC y acceso a datos personales. Revisar grants efectivos, incluidas posibles herencias y permisos de `PUBLIC`.

### 2. Alto — PIN administrativo sin limitación de intentos en el código

**Evidencia:** `supabase-schema.sql:57–63,203–210,247` expone funciones que comprueban PIN mediante SHA-256, sin contador, bloqueo o límite de intentos. El código y README contienen un administrador de demostración con PIN de cuatro cifras.

**Impacto:** las funciones ofrecen un verificador público de PIN; los PIN cortos tienen un espacio de búsqueda pequeño. No se comprobó si existen protecciones externas ni si las credenciales de demostración siguen vigentes en producción. No se intentó adivinarlas.

**Corrección:** eliminar credenciales de demostración del alta productiva, usar sesiones y autorización en servidor, limitar intentos y emplear un mecanismo apropiado para contraseñas si se mantienen secretos de este tipo.

### 3. Alto — El modo local falla al escribir

**Evidencia:** `src/store.js:163–195` construye llamadas como `w(supabase.from(...))`. Cuando `supabase` es `null`, la expresión falla antes de entrar a `w()`, aunque esa función tenga una protección. `makeDb` llama esas acciones también en modo local.

**Verificación:** comprobación aislada con el código real: `io.updateMesa(1,{})` lanza `TypeError` con Supabase ausente.

**Impacto:** guardar o enviar puede cambiar primero el estado local y luego interrumpir la interacción. El modo sin Supabase anunciado en README no funciona de forma consistente.

**Corrección:** comprobar la disponibilidad antes de construir cada consulta o separar adaptadores local y remoto; verificar el flujo completo sin variables de Supabase.

### 4. Alto — Confirmación de envío aunque falle el guardado

**Evidencia:** `src/store.js:163–168` captura errores y no devuelve un resultado de fallo. `src/App.jsx:513–527` escribe ticket, stock y mesa en peticiones separadas, sin esperar sus resultados. En las líneas 872–874 se muestra éxito y se cambia de pantalla inmediatamente. El respaldo local automático se desactiva cuando hay Supabase configurado.

**Verificación:** una escritura simulada con error devuelve `undefined` y solo cambia el indicador de conexión. No se propaga el fallo al consumidor.

**Impacto:** el mesero puede creer que cocina recibió una orden inexistente. También puede guardarse el ticket y fallar la mesa o el stock. Un refresco posterior sustituye el estado optimista y puede hacer desaparecer cambios no persistidos.

**Corrección:** confirmar éxito después de persistir; agrupar ticket, mesa e inventario en una operación transaccional e idempotente. Mostrar estados pendientes/fallidos y conservar un borrador recuperable. No hay una cola de reenvío fiable en la implementación actual.

### 5. Alto — Pérdida de actualizaciones entre dispositivos

**Evidencia:** `src/App.jsx:525–526` calcula existencias y listas de extras desde el estado del navegador y envía valores absolutos. No existe control de versión ni decremento atómico en el esquema.

**Verificación:** con dos dispositivos simulados que parten de diez bebidas y venden una cada uno, ambos envían existencia nueve. La última escritura deja nueve en lugar de ocho. Las listas de extras y los JSON de precios presentan el mismo patrón de sobrescritura.

**Corrección:** decrementar y validar stock en servidor dentro de la transacción de envío; usar bloqueo o control de versión para mesas y evitar reemplazar colecciones completas desde snapshots antiguos.

### 6. Alto — Una instalación nueva no puede crear el primer usuario

**Evidencia:** `src/store.js:81–84` llama `crear_usuario` sin `p_admin_pin`. El SQL completo elimina esa firma en la línea 213 y crea otra que exige PIN de un administrador ya existente en las líneas 217–225. No hay una inserción inicial de administrador en el esquema.

**Verificación:** el sembrado aislado invoca la RPC sin el parámetro requerido. La incompatibilidad con la firma SQL es verificable estáticamente.

**Impacto:** seguir las instrucciones del README en una base vacía deja el inicio de sesión sin usuarios utilizables.

**Corrección:** ofrecer un procedimiento privilegiado y único para crear el primer administrador. No reabrir la RPC antigua a clientes anónimos. Revisar siempre los errores del sembrado.

### 7. Alto — El corte retira pedidos pendientes y tiene carreras

**Evidencia:** `supabase-schema.sql:240–244` suma tickets abiertos y después les asigna `corte_id`, sin distinguir pedidos pendientes de cocina. `src/store.js:53` carga únicamente tickets sin corte; `src/App.jsx:548` vacía cocina al finalizar. No hay bloqueo entre cortes concurrentes. El total y el UPDATE se ejecutan como sentencias separadas.

**Verificación:** la comprobación local de `hacerCorte()` elimina también una comanda pendiente. La consulta remota excluye igualmente los tickets cortados de futuras cargas.

**Impacto:** un corte durante el servicio puede ocultar pedidos sin preparar. Dos cortes simultáneos pueden calcular totales sobre los mismos tickets; un ticket insertado entre el SELECT y el UPDATE podría quedar incluido en el corte sin formar parte del total calculado.

**Corrección:** separar la cola de preparación del periodo contable y fijar un conjunto consistente de tickets para cada corte, con exclusión mutua y cálculo de detalle en servidor. Definir explícitamente si el corte representa pedidos emitidos o pagos cobrados: el modelo actual no registra un estado de pago verificable.

### 8. Alto — «Guardar sin enviar» deja el pedido fuera del historial de ventas

**Evidencia:** `src/App.jsx:501–505` ocupa la mesa sin crear ticket. Al reabrir una mesa ocupada, las líneas 1050 y siguientes presentan el resumen; «Reenviar a cocina» crea un ticket `reenvio:true,total:0` en las líneas 538–541, que se excluye del historial y del total del corte.

**Verificación:** guardar una mesa en la comprobación aislada la deja ocupada con historial vacío y sin invocación de `addTicket`.

**Impacto:** una orden guardada como borrador puede reenviarse a cocina sin contabilizarse como venta. Falta una transición clara de borrador a ticket original.

**Corrección:** representar explícitamente el borrador y permitir enviarlo una sola vez; reservar el reenvío para tickets originales ya persistidos.

### 9. Medio — Se pierden indicaciones al sincronizar tickets

**Evidencia:** `src/App.jsx:865–870` genera `cuenta`, `paraLlevar` y `referencia`; los mapeos de `src/store.js:11–21` no los guardan ni los recuperan, y el esquema no tiene columnas para ellos.

**Verificación:** el recorrido `ticketToRow → ticketFromRow` elimina los tres campos.

**Impacto:** otro dispositivo o una recarga pierde la cuenta separada y las indicaciones de llevar de una mesa. Cocina puede imprimir información distinta de la que capturó el mesero.

**Corrección:** persistir y recuperar esos atributos; probar la captura en un dispositivo y su impresión desde otro.

### 10. Medio — Los precios de una carne nueva pueden no persistirse

**Evidencia:** `src/App.jsx:555–561` calcula precios nuevos y encola la actualización React, pero llama `saveConfig` con `dataRef.current.precios`, todavía anterior al siguiente render.

**Verificación:** simulando actualizaciones diferidas de React, el estado local contiene `taco-suadero:20`, pero la petición de configuración no lo incluye.

**Impacto:** después de sincronizar o recargar, esos productos pueden quedar sin precio y mostrarse a cero, por el fallback del catálogo.

**Corrección:** construir el nuevo objeto de precios una sola vez y usarlo tanto para la actualización local como para la escritura.

### 11. Medio — Lecturas con error o truncadas producen un estado incompleto

**Evidencia:** `src/store.js:47–60` usa `.data` de ocho consultas sin verificar `.error`. Las consultas de tickets, gastos y cortes no paginan. Cada evento Realtime dispara una recarga de todas las tablas en las líneas 104–111.

**Impacto:** un error de una tabla puede convertirse en una colección vacía sin explicación. Si se supera el límite de filas de la API, las sumas del cliente se calculan sobre datos incompletos; el límite productivo no fue inspeccionado. La recarga global incrementa tráfico y trabajo a medida que crece el historial.

**Corrección:** validar cada respuesta, mantener el último estado válido y mostrar errores. Paginar históricos, calcular agregados financieros en servidor y refrescar solo los datos afectados.

### 12. Medio — Barreras de accesibilidad en formularios y modales

**Evidencia:** `index.html:5` incluye `maximum-scale=1,user-scalable=no`. Los modales no declaran semántica de diálogo ni gestionan trampa y restitución del foco; múltiples botones de iconos no tienen nombre accesible. Las etiquetas del formulario de domicilio (`src/App.jsx:1263–1279`) no se vinculan mediante `htmlFor/id` ni envuelven sus campos.

**Impacto:** se dificulta la ampliación donde el navegador respete la restricción y el uso con teclado o lector de pantalla. Son problemas observables en el código; no se asigna una puntuación WCAG ni se afirma haber completado pruebas visuales.

**Corrección:** permitir zoom, asociar etiquetas, nombrar controles de iconos y gestionar teclado/foco y semántica de los diálogos. Validar después con teclado, lector de pantalla y ampliación al 200 %.

### 13. Medio — Falta de reproducibilidad y controles de regresión

**Evidencia:** el árbol versionado no contiene lockfile, pruebas ni CI; `package.json` solo define dev/build/preview y utiliza rangos de versiones. `App.jsx` concentra 2.383 líneas de componentes, dominio y estilos. El README describe una tabla única `app_state` que no corresponde al modelo actual.

**Impacto:** distintas instalaciones pueden resolver dependencias diferentes; los flujos críticos carecen de protección automática y las instrucciones de operación inducen a errores. No se afirma una vulnerabilidad concreta de dependencias sin un análisis de la resolución efectiva.

**Corrección:** versionar el lockfile, incorporar CI con build y pruebas de los flujos críticos, actualizar el README y separar dominio, acceso a datos y vistas progresivamente.

## Verificación realizada y límites

- Código obtenido mediante el conector GitHub, con referencia al commit indicado. No se modificó el repositorio remoto.
- Ocho comprobaciones aisladas ejecutadas con Node y código extraído de las funciones reales. Todas confirmaron los comportamientos documentados. Usan dobles de Supabase/React; no sustituyen una prueba real de concurrencia Postgres ni un recorrido completo del navegador.
- Reproducción: `node /workspace/audit-checks.cjs`. El script y los archivos fuente revisados acompañan este informe en el workspace.
- La portada publicada respondió HTTP 200 y devolvió el HTML de La Tequería. Se observó HSTS. No se deduce de esto que los flujos internos funcionen ni que el despliegue coincida exactamente con el commit.
- Se consultaron el changelog y la documentación actual de RLS de Supabase como apoyo a la revisión de permisos.
- La navegación automatizada no se completó por un problema de confianza del certificado del proxy del entorno. No hay capturas válidas, mediciones Lighthouse, evaluación visual final ni prueba de impresión física.
- No se verificaron políticas efectivas de producción, backups, métricas, límites de API, revocación real de accesos ni historial completo de secretos. No se realizaron ataques, intentos de PIN ni escrituras productivas.
- `npm run build` completó correctamente con Vite 5.4.21: 1.544 módulos y un bundle JavaScript de 480,53 kB (132,78 kB gzip). Esto no mide el rendimiento real ni garantiza que los flujos funcionen. Sin lockfile versionado, la resolución de dependencias no representa necesariamente la del despliegue existente.

## Orden de corrección y aceptación

1. **Acceso y privacidad:** cerrar acceso anónimo y aplicar autorización en servidor. Aceptación: sin sesión no se leen datos del negocio; cada rol solo puede ejecutar sus operaciones permitidas, incluso llamando directamente a la API.
2. **Fiabilidad operativa:** reparar bootstrap y modo local; hacer atómico el envío y comunicar fallos. Aceptación: una desconexión no muestra éxito falso; reintentar no duplica tickets; dos ventas concurrentes actualizan stock correctamente.
3. **Integridad contable:** separar borradores, preparación y corte; conservar metadatos. Aceptación: toda orden enviada aparece una sola vez en ventas; el corte no oculta cocina pendiente; el ticket conserva sus instrucciones en otro dispositivo.
4. **Calidad sostenida:** paginación, accesibilidad, lockfile, documentación y CI. Aceptación: recuperación explícita ante errores de lectura, históricos completos y controles utilizables con teclado y zoom.

La auditoría no aplica estas correcciones: entrega evidencia y recomendaciones para implementarlas y verificarlas de forma separada.
