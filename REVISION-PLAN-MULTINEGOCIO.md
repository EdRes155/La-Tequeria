# Factibilidad del plan para varias taquerías

Propuesta revisada: commit [`cfc589d6`](https://github.com/EdRes155/La-Tequeria/commit/cfc589d6f1ab017a34326f2805e55cf33a8677fa), que añadió `PLAN-MULTINEGOCIO.md`.

Código contrastado: `main` en [`824a090`](https://github.com/EdRes155/La-Tequeria/commit/824a090a4be84839ad4ccad2a88441e5247ec01d), posterior al plan. La aplicación ya incluye cobros, monitor de cocina y varias pantallas sincronizadas. Esta es una evaluación de arquitectura y alcance, no una implementación ni una validación de la configuración productiva.

## Dictamen

**La opción de una aplicación y una base compartida es viable sin sustituir React/Vite, Vercel o Supabase. El plan necesita concretarse antes de ejecutarse.** La centralización por RPC y la separación entre dominio, datos e interfaz permiten aprovechar la lógica existente, pero la aplicación actual sigue siendo de un solo negocio.

El plan combina dos trabajos grandes: aislar clientes y convertir las reglas del restaurante en un motor configurable. Conviene entregar primero un piloto de dos negocios con la plantilla actual, sin esperar a que categorías, preparaciones, roles, seguridad y todas las reglas sean editables.

Se revisaron esquema, RPC, autenticación, adaptadores remoto/local, dominio, configuración, pruebas y el cambio desde el commit del plan. Se instalaron las dependencias del lockfile y se ejecutaron las comprobaciones de base: **28 pruebas aprobadas y compilación correcta**. Las **26 pruebas SQL se omitieron** por no configurarse una base desechable en esta evaluación. No se ejecutaron pruebas de carga, aislamiento entre negocios ni consultas productivas. Las pruebas actuales no demuestran capacidad o seguridad multiempresa.

## Qué permite aprovechar el proyecto

| Base existente | Utilidad para el cambio |
|---|---|
| API concentrada en funciones SQL y tablas cerradas al cliente | Permite introducir contexto autorizado por taquería sin repartir llamadas directas a tablas por la interfaz |
| Sesiones de operadores, PIN y permisos centralizados | Se pueden ampliar para incluir negocio y dispositivo, conservando el acceso sin correo del personal |
| Envío, existencias, cobros y corte transaccionales | Sus reglas pueden conservarse dentro de cada negocio si se adaptan consultas, relaciones y bloqueos |
| Dominio, datos, estilos y diálogos separados | Reduce el alcance de cambios visuales para el primer piloto |
| Pruebas unitarias, SQL y navegador en CI | Existe infraestructura para añadir la matriz de aislamiento; no hay que empezar las pruebas desde cero |

## Cambios indispensables y huecos del plan

### 1. El aislamiento abarca mucho más que agregar una columna

El esquema tiene **14 tablas y 64 funciones SQL distintas**, de las que 40 no son helpers `_...`. No contiene `taqueria_id`. Hay que revisar tanto las RPC como sus helpers, reintentos y operaciones por lotes.

La configuración y la cocina utilizan `id=1`; las mesas identificadores enteros; las carnes claves como `pastor`; el folio es una identidad global. El corte, los PIN administrativos, los resúmenes, la retención de domicilios y los bloqueos también operan sobre el único negocio actual.

Recomendación: resolver la taquería desde una sesión autorizada en servidor y propagarla a todas las lecturas y escrituras. Un selector, slug o subdominio no acredita acceso. La pertenencia debe comprobarse también cuando se devuelve una operación idempotente ya guardada, se recibe una lista de ids o se valida un PIN administrativo.

No es necesario cambiar todas las PK a claves compuestas: se pueden conservar ids globales donde ya sean apropiados. Sí hacen falta claves únicas y referencias que impidan enlazar mesa, usuario, ticket, cobro o corte de negocios distintos. Las claves locales, como «mesa 1», deben poder repetirse entre negocios.

Las RPC usan `SECURITY DEFINER`: añadir RLS no protege automáticamente de un filtro omitido si el propietario de la función puede saltárselo. Mantener tablas cerradas es útil, pero hacen falta autorización explícita, integridad referencial y pruebas; una segunda barrera RLS efectiva requiere diseñar propietario y contexto.

Referencias: [tablas y folio](https://github.com/EdRes155/La-Tequeria/blob/824a090a4be84839ad4ccad2a88441e5247ec01d/tequeria-app/supabase-schema.sql#L23), [sesión](https://github.com/EdRes155/La-Tequeria/blob/824a090a4be84839ad4ccad2a88441e5247ec01d/tequeria-app/supabase-schema.sql#L360), [corte global](https://github.com/EdRes155/La-Tequeria/blob/824a090a4be84839ad4ccad2a88441e5247ec01d/tequeria-app/supabase-schema.sql#L1112).

### 2. Dueños y dispositivos son subsistemas nuevos

Hoy no hay registro de dueños con Google/correo, relación con `auth.users`, membresías ni vínculo autorizado de dispositivos. El valor que `store.js` genera en localStorage es un identificador, no una credencial de vinculación. El listado de personal y la autenticación actual no tienen contexto de taquería.

El modelo propuesto es razonable: **identidad del dueño → membresía validada → dispositivo vinculado a una taquería → PIN del operador → sesión operativa de esa taquería**. Supabase Auth encaja para los dueños; el personal puede conservar su flujo de PIN. Hay que distinguir al propietario de la suscripción del rol operativo «administrador».

La vinculación necesita aprobación del dueño, credencial verificable, revocación y recuperación de un equipo perdido o navegador borrado. También debe definirse si un dueño puede tener varias taquerías y si «taquería» significa empresa o sucursal. Inventario compartido y reportes corporativos no aparecen resueltos por el plan.

La frase «vincular impide probar PIN desde internet» es demasiado absoluta: puede restringir el acceso a la pantalla de personal, pero no elimina intentos desde dispositivos autorizados, robados o comprometidos. Deben conservarse límites de intentos y mínimos de seguridad de plataforma.

Referencia: [sesión y dispositivo actuales](https://github.com/EdRes155/La-Tequeria/blob/824a090a4be84839ad4ccad2a88441e5247ec01d/tequeria-app/src/store.js#L28).

### 3. Tiempo real, almacenamiento del navegador y contabilidad también deben separarse

Actualmente existe un canal público global `tequeria`. Cambiarlo a `tequeria:<id>` evita parte de las recargas cruzadas, pero no autoriza al suscriptor. Hay que definir canales autorizados y su identidad: el token propio de las RPC no se convierte automáticamente en un JWT válido para canales privados de Supabase.

Las claves de sesión, datos locales, borradores y preferencias deben incluir el contexto correcto o limpiarse al cambiar de negocio; también se deben cancelar suscripciones y descartar respuestas tardías del negocio anterior.

Folios y bloqueos necesitan ámbito por negocio: un corte de A no debe modificar ni detener innecesariamente cobros de B. Si el folio reinicia por día o corte, la unicidad debe incluir el periodo, manteniendo un id interno independiente. Fechas y anonimización deben usar la zona horaria y retención de la taquería correspondiente.

Referencia: [Broadcast actual](https://github.com/EdRes155/La-Tequeria/blob/824a090a4be84839ad4ccad2a88441e5247ec01d/tequeria-app/supabase-schema.sql#L597). Se contrastó con la documentación de [autorización Realtime](https://supabase.com/docs/guides/realtime/authorization).

### 4. El paso 2 debe dividirse y el paso 4 consolidarse con él

**Para el primer piloto:** nombre del negocio, mesas, zona horaria, carnes, bebidas, precios, ocultos, extras y ajustes de cocina propios. Puede conservarse la plantilla actual del catálogo, MXN y las reglas operativas existentes, haciéndolas independientes por taquería.

**Como ampliación posterior:** categorías arbitrarias, preparaciones, combinaciones de productos, diccionarios completos de abreviaturas, métodos de pago y permisos editables. El cliente y el SQL contienen reglas equivalentes de catálogo; configurarlas exige cambiar ambos, además del adaptador local. Cambiar un campo en `config` no vuelve genérica la aplicación.

El catálogo ya permite productos extra dentro de categorías existentes, pero rechaza categorías nuevas. Esa capacidad permite incorporar un segundo negocio compatible con la plantilla sin construir primero un editor universal. Debe preservarse el nombre/precio histórico de ventas al cambiar el menú.

La documentación ya quedó parcialmente desactualizada: `variasCocinas` permite varias pantallas y la impresión admite 58/80 mm por dispositivo. Conviene reutilizarlo por taquería.

Referencia: [constantes y catálogo](https://github.com/EdRes155/La-Tequeria/blob/824a090a4be84839ad4ccad2a88441e5247ec01d/tequeria-app/src/dominio.js#L7).

### 5. La migración de La Tequería debe diseñarse al principio

No dejar la conservación de datos como último detalle. Hay que ensayar sobre copia desechable: crear la taquería inicial, asignar registros existentes, resolver referencias, validar pertenencia y después imponer restricciones.

Un caso concreto es `tickets.cobro_id`: hoy admite valores especiales `previo` y `no_cobrado`. No puede añadirse una FK compuesta directa hacia cobros sin separar esos estados o transformar los datos heredados. Sesiones, dispositivos, folios y cortes requieren sus propias decisiones de transición.

Antes del cambio productivo, comparar conteos, totales vendidos/cobrados, existencias y relaciones; comprobar pedidos abiertos y acordar una recuperación compatible con las ventas que puedan entrar después del cambio. No basta con tener un respaldo si restaurarlo perdería operaciones nuevas.

### 6. Suscripción y restauración por cliente necesitan diseño propio

Los cobros actuales son pagos del restaurante, no suscripciones SaaS. Stripe o Mercado Pago requiere un componente de servidor con secretos privados, eventos verificados e idempotentes y estados de suscripción. Debe definirse qué ocurre al fallar o vencer un pago, sin cortar una comanda o cobro a mitad de transacción.

Exportar los datos de una taquería no equivale a restaurarla. Para recuperar un cliente en una base compartida hay que ensayar restauración a una instancia aparte y extracción/reintegración selectiva, u otro mecanismo equivalente, sin regresar a todos los demás al pasado.

Los costos «casi cero» y la capacidad de «muchas taquerías» son hipótesis. Hay que medir dispositivos concurrentes, RPC, conexiones, CPU, mensajes Realtime, almacenamiento, exportaciones y soporte. No se verificaron precios comerciales vigentes ni se hizo una prueba de capacidad; no corresponde dar por garantizado un número de clientes por plan.

## Orden de trabajo recomendado

1. **Cerrar decisiones:** negocio frente a sucursal, dueños/membresías, identidad de dispositivo y alcance del piloto. Mantener garantías mínimas de seguridad no editables por cada cliente.
2. **Preparar pruebas y migración desde el inicio:** entorno de pruebas y copia desechable de los datos actuales; inventario de todas las RPC, claves, helpers y canales.
3. **Implementar el núcleo de aislamiento y acceso:** sesiones, datos, referencias, folios, bloqueos, autorización administrativa, dueño y dispositivo. Evitar conservar firmas antiguas de RPC que omitan el contexto.
4. **Probar La Tequería y un segundo negocio:** plantilla de menú actual y configuración esencial. Confirmar venta, pago, corte, inventario y dos cocinas sin interferencias.
5. **Preparar operación comercial:** suscripción, exportación/restauración selectiva, monitoreo y cuotas por cliente. Validar precios de servicios y costos con mediciones.
6. **Ampliar personalización según el piloto:** menú genérico, roles avanzados, reglas, abreviaturas y formatos adicionales.

La puerta de salida del piloto debe incluir intentos de leer o modificar ids ajenos en cada RPC, listas de ids mezcladas, reintentos, PIN administrativo de otra taquería, revocación de dispositivo, cambios de contexto y límites de consulta. Dos negocios deben poder usar «Mesa 1», «Pastor» y sus propios folios sin mezclarse. Cobros, cortes, retención y exportación también deben aislarse bajo concurrencia.

**Conclusión:** conservaría la arquitectura elegida, pero dividiría el alcance. El primer objetivo verificable es que dos taquerías operen de forma independiente con la plantilla existente. Es una refactorización importante y una ampliación de identidad/operación comercial; no exige rehacer todo el producto, pero tampoco puede tratarse como una simple ampliación de configuración.
