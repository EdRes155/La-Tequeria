# Multinegocio: primer entregable

Trabajo del paso 1 del [plan multinegocio](../../PLAN-MULTINEGOCIO.md) (versión 2.2), «Comenzar en
desarrollo y pruebas». Nada de esto cambia producción: la app publicada sigue siendo de una sola
sucursal.

| Entregable del plan | Dónde | Estado |
|---|---|---|
| Inventario del estado actual | [INVENTARIO.md](INVENTARIO.md), generado por `tequeria-app/scripts/inventario.mjs`; la CI comprueba que esté al día | Listo |
| Entorno de pruebas reproducible, separado de producción | PostgreSQL 16 desechable, local o en la CI (sección siguiente) | Listo |
| Modelo de cuenta, sucursal, membresía, dispositivo y sesión, con el contexto de cada función | [MODELO.md](MODELO.md): un validador por tipo de llamada y estado de cuenta pendiente de activación | Diseño listo; paso 1 del núcleo implementado (abajo) |
| Núcleo, paso 1: cuentas, sucursales y `sucursal_id` | Sección «MULTINEGOCIO» de `tequeria-app/supabase-schema.sql`; `tests/sql/migracion.test.js` | Implementado y ensayado sobre la instantánea de producción; no aplicado en producción |
| Núcleo, paso 5: tiempo real privado y navegador | `_avisar_sucursal`, `privado.puede_escuchar` y la política de `realtime.messages` en `supabase-schema.sql`; `src/claves.js`; `tests/sql/tiempo-real.test.js` y `tests/navegador.test.js` | Implementado y probado con el stub de Realtime; la medición con una conexión abierta queda para staging (paso 7) |
| Configuración del piloto (PLAN §2) | `fijar_negocio` y `fijar_mesas` en `supabase-schema.sql`, el modo local y Administración → Negocio; `tests/sql/configuracion.test.js` | Implementado y probado (servidor, modo local y navegador). En el modo local la zona horaria rige las horas y fechas y las mesas que sobran se desactivan, igual que en el servidor |
| Núcleo, paso 4: dispositivos y dueños | `_vinculacion`, `_identidad` y `_dueno`; alta de cuentas, invitaciones, membresías, códigos, vinculación y revocación en `supabase-schema.sql`; `tests/sql/duenos.test.js` y la matriz | Implementado y probado con el `auth.users` de pruebas; falta probarlo contra Supabase Auth real en staging. El panel y la pantalla de vinculación van con el cliente (paso 6) |
| Núcleo, paso 3: política de seguridad del personal | `_contexto` con tipo de llamada, contadores, `desbloquear` y `restablecer_acceso` en `supabase-schema.sql`; `tests/sql/reloj.test.js` | Implementado y probado con reloj controlado en el servidor; la parte de la interfaz va con el cliente (paso 6) |
| Núcleo, paso 2: validadores y funciones por sucursal | `_dispositivo` y `_contexto` en `supabase-schema.sql`; matriz en `tests/sql/aislamiento.test.js` | Implementado: las funciones de la API prueban sus casos de aislamiento con las dos cuentas; solo quedan pendientes los declarados para pasos posteriores. Desde aquí el esquema exige equipos vinculados y ya no sirve con la app publicada (ver MIGRACION.md) |
| Fixtures de La Tequería y «Taquería Piloto B» | `tequeria-app/tests/fixtures/multinegocio.js`, validadas por `tests/fixtures.test.js` | Se siembran en la matriz con sus dueños (`tests/sql/sembrar.js`) |
| Matriz de aislamiento en la CI | `tequeria-app/tests/sql/aislamiento.test.js`: una receta por función y casos genéricos (token de otra sucursal, otro equipo, equipo revocado, id ajeno igual que inexistente, listas mezcladas, id repetido, PIN ajeno, identidad anónima o de un equipo, persona sin correo verificado o sin membresía, cuenta o sucursal ajena) más los propios; la guardia exige caso y receta para cada firma ejecutable desde fuera, y solo admite pendientes declarados para un paso posterior al actual (`PASO_ACTUAL` en `matriz-aislamiento.js`) | Activa: todos los casos de los pasos 2 a 5 probados; solo queda pendiente la medición del tiempo real con una conexión abierta, declarada para staging (paso 7) |
| Migración diseñada y ensayable | [MIGRACION.md](MIGRACION.md); huella de datos por entidad con versiones de origen y destino (`scripts/huella-datos.sql`, `scripts/huella.mjs`); instantánea del esquema de producción verificada exactamente (`tests/sql/esquema-v3.sql`, `scripts/catalogo-esquema.sql`, `scripts/huella-esquema.mjs`) | Expansión y contracción del estado de cobro ensayadas con datos sintéticos; falta la copia real para el ensayo completo |
| Pruebas de seguridad con reloj controlado | `public._ahora()` en sesión e intentos; `relojControlado()` en `tests/sql/util.js`; casos en `tests/sql/reloj.test.js` | Reloj listo; los casos documentan la política vigente y se actualizan al implementar la nueva |

## Entorno de pruebas

Base desechable de PostgreSQL 16. Las pruebas crean y borran sus propias bases. Nunca se apunta a
producción: las herramientas que borran bases (`DROP DATABASE … WITH (FORCE)`) solo aceptan un
servidor local o el de la CI (`localhost`, `127.0.0.1`, `::1`, un socket Unix, `postgres`), rechazan
siempre los de Supabase, exigen `TEQUERIA_BASE_DESECHABLE=si` para cualquier otro y solo tocan bases
`tq_*` (`tequeria-app/scripts/base-desechable.mjs`). Se revisa el destino **efectivo** que calcula el
propio cliente de `pg` (incluidos `?host=` y las variables `PG*`), y se usa ese mismo cliente para
conectarse.

```bash
# con Docker
docker run -d --name tq-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres

cd tequeria-app
npm ci
npm test                          # todo: unitarias, SQL (si hay TEST_DATABASE_URL) y matriz
npm run test:sql                  # solo SQL
npm run inventario                # regenera docs/multinegocio/INVENTARIO.md
npm run inventario -- --check     # lo que corre la CI
npm run test:e2e                  # recorridos en navegador: modo local y «remoto simulado» (sin base de datos)
# huella de una base (sobre una copia o un ensayo); la misma sal antes y después
psql "$URL_DE_LA_COPIA" -qAt -c "set huella.version = 'origen'" -c "set huella.sal = '<aleatoria>'" \
  -f scripts/huella-datos.sql -o antes.json
node scripts/huella.mjs comparar antes.json despues.json
```

La CI de GitHub ya levanta PostgreSQL 16 en el job «Esquema SQL contra PostgreSQL» y corre ahí las
pruebas de SQL y la comprobación del inventario.

Para lo que necesita Supabase completo (Auth para dueños y dispositivos, Realtime privado) hará falta
un proyecto de staging o la pila local de Supabase (`supabase start`, requiere Docker). Se decide al
llegar a esos pasos.

## Lo que sigue, hasta cerrar el plan

En orden. Nada de esto toca producción ni `main` hasta el paso 11, que necesita autorización expresa.

**A. Núcleo, en desarrollo**

1. **Paso 5: tiempo real privado y navegador** ([MODELO.md §7 y §8](MODELO.md#7-tiempo-real)) (hecho):
   canal privado `sucursal:<id>` que solo publica el servidor, política de escucha con las reglas del
   equipo, retiro del canal público, y claves del navegador por sucursal con limpieza al cambiar de
   sucursal o al revocar el equipo.
2. **Configuración del piloto** ([PLAN §2](../../PLAN-MULTINEGOCIO.md), «Para el piloto») (hecho):
   `fijar_negocio` (nombre y zona horaria) y `fijar_mesas` (de 1 a 60; las que se quitan se desactivan
   y solo si están libres y sin cuentas por cobrar), en el servidor, el modo local y Administración →
   Negocio. Folio, menú, precios, existencias, extras, ocultos y modo de cocina ya eran por sucursal
   (los cubre la matriz). Pruebas en `tests/sql/configuracion.test.js`, `tests/localStore.test.js` y un
   recorrido en navegador.
3. **Paso 6: cliente:**
   - entrada de dueños (correo verificado o Google) y panel: cuentas, sucursales, miembros,
     invitaciones (con su envío por correo), códigos, equipos y revocación; reintento de `40001` en
     una transacción nueva;
   - pantalla de vinculación (sesión anónima y código) y recuperación (`VINCULADO`, `REVOCADO`,
     `DISPOSITIVO`);
   - desbloqueo por inactividad, `CAMBIAR_PIN` y PIN de 6 a 8 dígitos en la interfaz y el modo local;
   - borradores por sucursal y autor; recorridos en navegador del flujo completo.

**B. Staging con Supabase real**

4. **Proyecto de staging:** el esquema, inicio anónimo (con CAPTCHA o límite), correo con
   confirmación, expiración del JWT y la app en una vista previa.
5. **Pruebas contra Supabase real** (paso 7 del núcleo, MODELO.md §9): vinculación, dueños, suspensión
   y borrado de identidades, tiempo real privado, y medir el tiempo máximo en que un equipo revocado aún
   recibe avisos con la conexión abierta (cierra el último caso pendiente de la matriz).
6. **Pruebas de capacidad** (PLAN §5): equipos a la vez, llamadas, conexiones, CPU, mensajes de tiempo
   real, almacenamiento y exportaciones; de ahí, los costos.
7. **Validar La Tequería y «Taquería Piloto B»** con datos sintéticos: venta, cobro, corte, inventario y
   varias pantallas de cocina sin interferirse, contra el «Criterio para cerrar el piloto».

**C. Migración de La Tequería** ([MIGRACION.md](MIGRACION.md))

8. **Decisiones** ([§8](MIGRACION.md#8-decisiones-pendientes-para-el-ensayo)): cómo obtener la copia de
   producción, la ventana del cambio y quién avisa al personal, y el correo del dueño.
9. **Copia recuperable:** restaurarla en una instancia aparte y comprobar que se lee.
10. **Ensayo completo sobre la copia:** huellas antes y después, prueba de humo, paquete de
    reintegración y recuperación.
11. **Cambio en producción** (§5): configurar Supabase Auth, aplicar, comparar huellas, invitación
    inicial y activación, publicar la app nueva, vincular equipos, PIN nuevos y prueba de humo.
12. **Observación y limpieza final** (§7): borrar el respaldo antiguo y `app_state`, con registro.

**D. Piloto operativo**

13. **Elegir la segunda taquería real:** propietario o encargado disponible, al menos dos equipos y un
    menú que quepa en la plantilla.
14. **Alta y preparación:** `crear_cuenta`, equipos y personal; sus flujos primero con datos de prueba.
15. **Operar el piloto** con registro de incidencias, y verificar los criterios de cierre con las dos
    taquerías reales.

**E. Operación comercial** (PLAN §7 y «Antes de cobrar»)

16. **Planes y aspectos legales:** Vercel Pro, Supabase Pro (respaldos), aviso de privacidad y términos
    (la app guarda domicilios).
17. **Suscripción:** Stripe o Mercado Pago con una parte de servidor, avisos verificados que no se
    aplican dos veces, estados de suscripción (con el estado `suspendida` de la cuenta) y qué pasa si
    falla un pago, sin cortar una comanda o un cobro a la mitad.
18. **Respaldos por cliente:** restaurar en una instancia aparte y reintegrar solo sus datos, ensayado.
19. **Monitoreo y cuotas por cliente**, con los costos medidos.

**F. Después del piloto**

20. **Personalización** según lo que pidan los clientes (PLAN §2, «Después del piloto»): marca, datos
    del ticket, nombres de mesa, tipos de pedido, folio con reinicio y prefijo, menú genérico, tickets,
    cobros, reglas, cocina, corte, domicilio, ajustes que solo endurecen la seguridad y permisos por
    rol.
