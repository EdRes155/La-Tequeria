# Multinegocio: primer entregable

Trabajo del paso 1 del [plan multinegocio](../../PLAN-MULTINEGOCIO.md) (versión 2.2), «Comenzar en
desarrollo y pruebas». Nada de esto cambia producción: la app publicada sigue siendo de una sola
sucursal.

| Entregable del plan | Dónde | Estado |
|---|---|---|
| Inventario del estado actual | [INVENTARIO.md](INVENTARIO.md), generado por `tequeria-app/scripts/inventario.mjs`; la CI comprueba que esté al día | Listo |
| Entorno de pruebas reproducible, separado de producción | PostgreSQL 16 desechable, local o en la CI (sección siguiente) | Listo |
| Modelo de cuenta, sucursal, membresía, dispositivo y sesión, con el contexto de cada función | [MODELO.md](MODELO.md) | Diseño listo; sin implementar |
| Fixtures de La Tequería y «Taquería Piloto B» | `tequeria-app/tests/fixtures/multinegocio.js`, validadas por `tests/fixtures.test.js` | Listas; se siembran cuando exista el modelo |
| Matriz de aislamiento en la CI | `tequeria-app/tests/sql/aislamiento.test.js`: casos por función (pendientes) y una guardia activa que exige casos para toda función nueva | Guardia activa; casos pendientes del núcleo |
| Migración diseñada y ensayable | [MIGRACION.md](MIGRACION.md) y la huella de datos `tequeria-app/scripts/huella-datos.sql` (`tests/sql/huella.test.js`) | Diseño y huella listos; falta la copia de producción para el ensayo |
| Pruebas de seguridad con reloj controlado | `public._ahora()` en sesión e intentos; `relojControlado()` en `tests/sql/util.js`; casos en `tests/sql/reloj.test.js` | Reloj listo; los casos documentan la política vigente y se actualizan al implementar la nueva |

## Entorno de pruebas

Base desechable de PostgreSQL 16. Las pruebas crean y borran sus propias bases. Nunca se apunta a
producción.

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
psql "$TEST_DATABASE_URL" -f scripts/huella-datos.sql   # huella de una base (sobre una copia o un ensayo)
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
2. **Implementar el núcleo** en el orden de [MODELO.md §9](MODELO.md#9-orden-sugerido-para-implementar-paso-3-del-plan),
   pasando los casos de la matriz de pendientes a pruebas reales función por función.
