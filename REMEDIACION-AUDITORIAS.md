# Remediación de las auditorías — La Tequería v3

Fecha: 30 de octubre de 2026. Corrige los hallazgos de:

- [Auditoría integral](AUDITORIA-LA-TEQUERIA.md)
- [Auditoría de seguridad y datos](AUDITORIA-SEGURIDAD-Y-DATOS.md)
- [Auditoría de diseño y usabilidad](AUDITORIA-DISENO-Y-USABILIDAD.md)

Código en `tequeria-app/`. Las auditorías y sus scripts de `auditoria/` se conservan
como evidencia de la versión auditada. Esos scripts reproducen los defectos de esa
versión y ya no aplican al código nuevo. Los controles que los sustituyen (con las
expectativas invertidas) están en `tequeria-app/tests/`.

## Estado

**En producción desde el 31 de octubre de 2026.** El esquema v3 se aplicó en el proyecto
de Supabase de La Tequería y la app v3 está publicada en Vercel desde `main`. Se
conservaron todos los datos: tickets, cortes, inventario y usuarios. Antes de aplicar
la migración se guardó una copia de las tablas v2 en el esquema privado
`respaldo_v2_20261030`; esa copia no incluye 2 tickets creados después.

Comprobaciones hechas en producción:
- Las funciones coinciden byte a byte con la versión probada en local.
- El rol `anon` ya no tiene acceso a ninguna tabla y la API v2 ya no existe.
- La página publicada ya llama a la API nueva con respuestas 200.
- Avisos de Supabase: solo quedan los esperados, las funciones de la API (que
  validan la sesión por dentro) y las tablas con RLS sin políticas.

| Verificación | Resultado |
|---|---|
| `npm test` (dominio y modo local) | 15 pruebas ✓ |
| `npm run test:sql` (PostgreSQL 16 real, actualización v2→v3, concurrencia con dos conexiones, adaptador remoto) | 22 pruebas ✓ |
| `npm run test:e2e` (Chromium, escenarios UX de la auditoría) | 6 recorridos ✓ |
| `npm run build` y `npm run check:secrets` | ✓ |

## Seguridad y datos

| Hallazgo | Corrección | Verificación |
|---|---|---|
| Integral 1 · SEG-01 Crítico: acceso anónimo y datos antes del login | Se revocó todo acceso a tablas para `anon`/`authenticated`, sin políticas permisivas. La API son funciones `SECURITY DEFINER` que validan un token de sesión y el rol. Antes de entrar solo se ven los nombres de usuario. | `esquema.test.js` › «anon ya no puede leer ni escribir…», «cada rol solo ve y hace lo suyo» |
| Integral 2 · SEG-02: PIN sin límite de intentos y verificador público | Se eliminó `es_admin_pin`. Los PIN usan bcrypt y el hash SHA-256 se migra al entrar. Bloqueo de 5 a 60 min tras 5 fallos por usuario y 30 por IP. La reautenticación también tiene límite. Los PIN de demostración o triviales obligan a cambiarlo. El README ya no publica credenciales. | «bloquea tras 5 PIN incorrectos…», «limita los fallos por IP…», «obliga a cambiar el PIN de demostración…» |
| SEG-03: total, autor y campos contables decididos por el cliente | `enviar_comanda` calcula nombre, categoría, precio y total desde el catálogo del servidor. El autor sale de la sesión, y la fecha y hora del servidor. No hay `update` genérico: el estado del ticket solo cambia por transiciones permitidas. Se agregó la tabla `bitacora` para corte, precios, bajas y liberaciones. | «calcula el total con precios del servidor…», «rechaza … el producto no existe» |
| Integral 4/5 · SEG-04: escrituras parciales, éxito falso y stock perdido | Ticket, mesa y existencias se escriben en una sola transacción. El stock se descuenta con `cantidad >= q`. Es idempotente por id del ticket. La app solo confirma después de la respuesta del servidor. | «reintentar … no duplica», «dos dispositivos … descuentan ambas ventas», e2e UX-03 |
| Integral 7 · SEG-05: el corte oculta pendientes y tiene carreras | Bloqueo exclusivo por corte. Un solo `UPDATE` fija el conjunto de tickets y el total y el desglose se calculan sobre ese conjunto. La cola de cocina (`archivado_cocina`) es independiente del corte. Los gastos del periodo entran en el corte. | «el corte … no oculta pendientes de cocina y no pierde tickets concurrentes», e2e cocina |
| SEG-06: exclusividad de cocina manipulable | Se asigna en `login` con `FOR UPDATE`, ligada a la sesión del cocinero. La tabla no es accesible desde fuera. Si el latido falla se muestra un estado incierto, en vez de conceder la exclusividad. | «solo una cocina activa…» |
| SEG-07: PIN y domicilios en localStorage | El modo local guarda los PIN como hash y borra los tickets cerrados al hacer el corte. En modo Supabase no se guarda estado en el navegador: solo el token en `sessionStorage`. El mesero solo ve los domicilios de sus pedidos. Los domicilios se anonimizan a los 90 días (configurable). | `localStore.test.js` › «sin PIN en texto plano», «el mesero solo ve el domicilio…» |
| Integral 6 · SEG-08: primer administrador y último administrador | `crear_admin_inicial` solo se ejecuta desde el SQL Editor y una sola vez. El servidor valida rol y PIN. La baja bloquea a los administradores y nunca deja cero, incluso con bajas simultáneas. Se agregó el restablecimiento de PIN por un administrador. | «el primer administrador solo se crea…», «protege al último administrador…» |
| SEG-09 · UX-12: importes redondeados | `money()` muestra centavos cuando existen ($25.50). El servidor redondea a centavos. | `dominio.test.js` › importes |
| Integral 11 · SEG-10: errores de lectura ocultos y sin paginar | Cada lectura valida errores, conserva el último estado válido y muestra un aviso con «Reintentar». El corte se bloquea con datos desactualizados. Los totales del periodo los calcula el servidor. El historial se limita a 1000 filas con el total completo. El refresco es por partes. | revisión de código y prueba `remoto.test.js` |
| SEG-11: protección ante secretos | `.env` está ignorado. Solo se exponen variables `VITE_*`. Se agregó `scripts/check-secrets.mjs` en la CI, que detecta JWT no anónimos y `sb_secret_`. Se agregaron encabezados CSP y otros en `vercel.json`. | CI › job `app` |

## Fiabilidad e integridad

| Hallazgo | Corrección |
|---|---|
| Integral 3: el modo local fallaba al escribir | El adaptador local (`localStore.js`) tiene la misma interfaz y las mismas reglas que el servidor. |
| Integral 8 · UX-02: «guardar sin enviar» fuera de ventas y ambiguo | Hay un estado `borrador` explícito en la mesa: no es venta, se retoma y se envía una sola vez. «Reenviar» solo aparece en mesas ya enviadas. «Guardar borrador» también está en el celular. |
| Integral 9: se perdían cuenta, para llevar y referencia | Se agregaron las columnas `cuenta`, `para_llevar` y `referencia`, que se guardan y se leen. |
| Integral 10: precios de carne nueva sin guardar | `agregar_carne` crea la carne y sus precios en la misma transacción. |
| Integral 13: sin lockfile, pruebas ni CI | Se agregaron `package-lock.json`, Vitest, Playwright, la CI de GitHub Actions y el README actualizado. `App.jsx` se dividió en dominio, datos, diálogos y estilos. |
| Concurrencia en mesas | La mesa lleva `version`: guardar un borrador sobre otro más nuevo pide decidir. Una mesa no acepta dos comandas originales y la orden extra se agrega en el servidor. |

## Usabilidad y accesibilidad

| Hallazgo | Corrección |
|---|---|
| UX-01 Pérdida de trabajo al salir | Los borradores viven por mesa, para llevar y domicilio y sobreviven a la navegación. La tarjeta muestra «Sin guardar». Se avisa al cerrar la pestaña o la sesión con comandas pendientes. |
| UX-03 Éxito falso | Se muestra «Enviando…». El error queda visible junto al pedido con «Reintentar envío» sin duplicar, y se distingue el resultado incierto por falta de conexión. |
| UX-04 Persona activa oculta | La barra «Añadiendo a:» está fija en el menú (celular y escritorio) con botones `aria-pressed`. Seleccionar y renombrar son controles separados. |
| UX-05 Diálogos | Componente `Modal` con `role="dialog"`, `aria-modal`, foco contenido, Escape y restitución del foco. |
| UX-06 Contraste | Paleta ajustada: lima `#557A1F`, maíz `#94600A` y demás tonos ≥ 4.5:1. Se comprueba en e2e. |
| UX-07 Etiquetas, iconos y objetivos táctiles | Etiquetas `htmlFor`, `aria-label` en botones con icono (con el producto o la orden afectada), controles de 44×44 px y foco visible. |
| UX-08 Borrar sin recuperar | Se pide confirmación al borrar una orden con productos, un gasto, una carne, una bebida o un producto. En cocina, «Listo» se puede regresar a preparación. |
| UX-09 Navegación y catálogo | En el celular todas las secciones se ven en una segunda fila. Hay accesos por categoría y buscador de productos. |
| UX-10 Mensajes | Avisos con `aria-live`. Los errores duran más y se pueden cerrar. Se distinguen PIN incorrecto, bloqueo, conexión y cocina ocupada. |
| UX-11 Zoom | Se quitó `user-scalable=no` y el corte celular/escritorio es el mismo en JS y CSS (760 px). |
| UX-12 Ticket | Los nombres ocupan varias líneas en vez de cortarse, se muestran los centavos y se conservan cuenta e indicaciones. |

## Pendiente (requiere acción fuera del repositorio)

1. Entrar con cada usuario: el administrador con PIN de demostración debe elegir uno nuevo.
   Cuando todo esté confirmado, borrar el respaldo `respaldo_v2_20261030`: contiene hashes
   de PIN viejos y domicilios.
2. Revisar en Supabase los respaldos y el PITR, y la opción de canales públicos de Realtime.
3. Definir si el corte debe registrar **cobros** además de comandas enviadas (hoy no hay modelo de pagos).
4. Probar en los dispositivos reales: impresora térmica de 58 mm, Safari en iPad, teclado virtual y lector de pantalla.
