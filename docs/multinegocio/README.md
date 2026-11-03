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
| Núcleo, paso 2: validadores y funciones por sucursal | `_dispositivo` y `_contexto` en `supabase-schema.sql`; matriz en `tests/sql/aislamiento.test.js` | Implementado: las 37 funciones de la API prueban sus casos de aislamiento con las dos cuentas; quedan pendientes solo los de funciones de los pasos 3 y 4. Desde aquí el esquema exige equipos vinculados y ya no sirve con la app publicada (ver MIGRACION.md) |
| Fixtures de La Tequería y «Taquería Piloto B» | `tequeria-app/tests/fixtures/multinegocio.js`, validadas por `tests/fixtures.test.js` | Listas; se siembran cuando exista el modelo |
| Matriz de aislamiento en la CI | `tequeria-app/tests/sql/aislamiento.test.js`: una receta por función y casos genéricos (token de otra sucursal, otro equipo, equipo revocado, id ajeno igual que inexistente, listas mezcladas, id repetido, PIN ajeno) más los propios; la guardia exige caso y receta para cada firma ejecutable desde fuera | Activa: 198 casos probados; 40 pendientes de los pasos 3 y 4 |
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

## Lo siguiente

1. **Decisiones para el ensayo de la migración** ([MIGRACION.md §8](MIGRACION.md#8-decisiones-pendientes-para-el-ensayo)):
   - cómo obtener la copia de producción;
   - la ventana del cambio;
   - el correo del dueño para la invitación inicial.
2. **Núcleo, paso 3** ([MODELO.md §9](MODELO.md#9-orden-sugerido-para-implementar-paso-3-del-plan)):
   política de seguridad (PIN de 6 a 8 dígitos, contadores por operador y por equipo, sesión de 12 h e
   inactividad con el monitor como excepción), con el reloj controlado.
