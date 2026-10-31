# La Tequería — Sistema de comandas (v3)

Página web para tomar comandas (mesas, para llevar, domicilio), cocina, inventario,
gastos, precios y administración. Con **Supabase** todos los dispositivos ven lo
mismo casi al instante: el mesero manda la comanda desde su celular y aparece en
la tablet de cocina.

> **v3** corrige los hallazgos de las tres auditorías (integral, seguridad/datos y
> usabilidad). El detalle está en [`../REMEDIACION-AUDITORIAS.md`](../REMEDIACION-AUDITORIAS.md).

## Cómo funciona la seguridad

- El navegador **no puede leer ni escribir tablas**. Todo pasa por funciones de la
  base (`supabase-schema.sql`) que validan una **sesión** y el **rol** del operador.
- Al entrar con PIN, el servidor entrega un token de sesión (se guarda solo su hash).
  Cerrar sesión lo invalida. Las sesiones vencen solas.
- Los PIN se guardan con **bcrypt**. Tras 5 intentos fallidos el usuario se bloquea
  unos minutos (también hay límite por IP). Los PIN triviales (1234, 1111…) y los de
  demostración obligan a elegir uno nuevo.
- Precios, totales, existencias, fecha/hora y autor de cada venta los pone el
  **servidor**; el cliente solo manda claves de producto y cantidades.
- Enviar una comanda es **una sola operación**: o se guarda todo (ticket, mesa,
  existencias) o nada. Reintentar no la duplica.
- El corte lo calcula el servidor, es exclusivo (no hay dos a la vez) y **no saca de
  cocina** lo pendiente. Las operaciones sensibles quedan en la tabla `bitacora`.

| Rol | Puede |
|---|---|
| Mesero | Tomar comandas, borradores, orden extra, reenviar, liberar mesa y **cobrar**. Ve cocina (solo lectura). |
| Cocinero | Cocina completa y el corte (con PIN de administrador). Una sola cocina activa a la vez. |
| Administrador | Todo: precios, productos, inventario, gastos, usuarios y **anular cobros**. |

## Cobros y corte

- Cada comanda enviada queda **por cobrar**. En «Mesas» aparecen la lista «Cuentas por
  cobrar» y el monto pendiente en cada mesa; en la comanda de la mesa está «Cobrar mesa».
- Al cobrar se elige método (efectivo, tarjeta o transferencia) y propina (10 %, 15 % u
  otra). En efectivo se captura lo recibido y la app calcula el **cambio**; no deja cobrar
  si falta dinero. Se puede liberar la mesa en el mismo paso.
- **Una mesa no se libera sin cobrar.** Si el cliente se fue o la comanda fue un error, un
  administrador puede «Cerrar sin cobro» desde el mismo diálogo, con su PIN y un motivo.
  Esas cuentas quedan como «No cobrado» en el corte y en la `bitacora`.
- El servidor calcula el total y rechaza cobrar dos veces la misma cuenta. Reintentar un
  cobro no lo duplica.
- Solo un administrador puede **anular** un cobro, con motivo, y solo antes del corte.
  Todo queda en la `bitacora`.
- El corte separa las **ventas** (comandas enviadas) de lo **cobrado** por método, con
  las propinas y lo que quedó **por cobrar**. Las cuentas sin cobrar siguen pendientes
  después del corte. Las ventas anteriores a esta versión se marcan como «Sin registro».

## Estatus del pedido (mesero)

Cada mesa y cada pedido para llevar o domicilio muestra su estatus: **Enviado** → **Recibido**
(la cocina ya lo tiene en pantalla) → **En proceso** (Preparando) → **Entregado** (Listo) →
**Cobrado**. Si se paga antes de que salga de cocina se ve, por ejemplo, «En proceso · pagado».
En «Mesas», la lista «Pedidos en curso» junta lo que falta cobrar y lo que sigue en cocina.

## Modo de cocina: impresora o monitor

Se elige en **Administración → Cocina** y aplica a todo el negocio:

- **Impresora** (como siempre): la cocina imprime la comanda de cada pedido y la barra el
  ticket del cliente.
- **Monitor**: la cocina trabaja en una pantalla grande (tablet, iPad o monitor). Al entrar con
  un usuario **Cocinero** se abre directo; un administrador la abre desde Cocina → «Abrir
  monitor». La barra sigue imprimiendo el ticket del cliente; imprimir la comanda en cocina es
  opcional («Imprimir también la comanda en cocina»).

El monitor muestra las comandas de la más antigua a la más nueva, con:
- tiempo de espera en vivo (amarillo a los 10 min, rojo a los 20);
- productos en orden de categoría;
- «Empezar» (pasa a En proceso) y «Listo», y la tira de listos para regresar o quitar;
- el panel «Por preparar» con el total de cada producto;
- aviso con sonido cuando llega una comanda nueva.

Los productos se pueden tachar al prepararlos (se guarda solo en esa pantalla). Las teclas
1–9 avanzan la comanda de esa posición, para usar un teclado o una «bump bar». El monitor
evita que la pantalla se apague y tiene pantalla completa.

### Estaciones de impresión

Cada dispositivo elige su estación con el botón de impresora de la barra superior (se guarda
solo en ese dispositivo):
- **Barra**: imprime el ticket del cliente (folio y precios) de cada pedido nuevo.
- **Cocina**: imprime la comanda de cada pedido nuevo (en modo monitor, solo si está activado).
- **Ninguna**: no imprime solo; cualquier ticket se puede imprimir a mano.

Para imprimir sin la ventana del navegador, abre Chrome con impresión silenciosa
(`--kiosk-printing`).

## Tickets

- **Cuenta**: folio, precio unitario, total y el bloque de pago (método, propina, recibido
  y cambio). Después de cobrar se puede imprimir la cuenta de toda la mesa junta.
- **Cocina**: tipo y origen en grande, preparación, productos sin precios y conteo de tacos.
  Los productos salen siempre en orden: tacos, gringas, volcanes, costras y bebidas, y con
  nombres cortos: T (taco), T queso, G (gringa), Llen. (llenadora), V (volcán), C (costra),
  ½C (media costra), Quesa, Tort. (tortillas). Las bebidas y las carnes no se abrevian.
  En la pantalla de cocina y en la cuenta se usa el mismo orden con los nombres completos.
- Papel de **58 o 80 mm**; la elección se recuerda en cada dispositivo.
- En cocina cada comanda muestra su folio y el tiempo de espera (se marca a los 10 y 20 min).

## Diseño

Paleta «nopal» (verde agave con acentos de maíz, barro y oro; todos los textos con
contraste de 4.5:1 o más) y tipografías **Figtree** (texto) y **Bricolage Grotesque**
(títulos y montos), incluidas en el build porque la CSP no permite fuentes externas.
El inicio de sesión muestra la hora, el estado de la conexión, tarjetas con iniciales
por usuario (recuerda el último) y un teclado numérico para el PIN.

---

## Instalación nueva

1. **Supabase** → crea un proyecto → **SQL Editor → New query** → pega TODO
   `supabase-schema.sql` → **Run**.
2. Crea el primer administrador en el mismo SQL Editor (no se puede desde la web):
   ```sql
   select public.crear_admin_inicial('Tu nombre', 'tu PIN de 4 a 8 dígitos');
   ```
3. **Project Settings → API**: copia la **Project URL** y la llave **anon / publishable**.
4. Copia `.env.example` como `.env` y pon esos dos valores (`.env` no se sube a git).
5. Prueba local (Node 18+): `npm ci` y `npm run dev`.
6. **Vercel** → importa el repo (directorio `tequeria-app`, framework Vite) y agrega
   `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Nunca pongas la `service_role` en
   variables `VITE_*`: todo lo que empieza así llega al navegador.

Los demás usuarios se crean desde **Administración → Usuarios** (pide tu PIN).

## Actualizar desde v2 (la versión anterior)

> ⚠️ La app v2 deja de funcionar en cuanto se ejecuta el SQL v3 (ya no hay acceso
> directo a tablas). Hazlo fuera del horario de servicio y publica la app v3 en el
> mismo momento.

1. Haz un respaldo (Supabase → Database → Backups) o exporta las tablas.
2. Ejecuta `supabase-schema.sql` completo en el SQL Editor. Conserva mesas, tickets,
   gastos, cortes y usuarios; es seguro ejecutarlo más de una vez.
3. Publica la v3 (fusiona la rama en `main`; Vercel la despliega).
4. Cada usuario entra con su PIN de siempre. Su hash se actualiza a bcrypt; si era el
   de demostración o uno trivial, la app le pide elegir otro antes de continuar.

## Tiempo real

Los cambios se avisan con **Realtime Broadcast** (canal público `tequeria`, solo con el
nombre de la tabla, nunca datos). Si el tiempo real no está disponible, la app vuelve
a consultar cada 10–45 s y al recuperar la conexión. En Supabase → Realtime → Settings
debe estar permitido el acceso a canales públicos (es lo predeterminado).

## Modo local (sin Supabase)

Sin las variables `VITE_SUPABASE_*` la app funciona solo en ese navegador, con las
mismas reglas. La primera vez pide crear el administrador. Los PIN se guardan como
hash y al hacer corte se borran los tickets cerrados. Sirve para probar y para las
pruebas automáticas; no comparte datos entre dispositivos.

## Pruebas

```bash
npm test                 # unitarias (dominio y modo local)
npm run test:sql         # esquema SQL contra PostgreSQL real (requiere TEST_DATABASE_URL)
npm run test:e2e         # recorridos en Chromium en modo local (Playwright)
npm run check:secrets    # busca llaves privilegiadas en git y en dist/
```

`TEST_DATABASE_URL` apunta a una base administrativa desechable, por ejemplo
`postgres://postgres:postgres@localhost:5432/postgres`; las pruebas crean y borran sus
propias bases. **Nunca** la apuntes a producción. La CI (`.github/workflows/ci.yml`)
corre las cuatro.

## Estructura

- `supabase-schema.sql` — tablas, funciones de la API, permisos y tiempo real (v3)
- `src/supabaseClient.js` — conexión a Supabase (solo URL y llave pública)
- `src/store.js` — acceso a datos por RPC con token de sesión; elige remoto o local
- `src/localStore.js` — modo local con las mismas reglas que el servidor
- `src/dominio.js` — catálogo, precios, totales, permisos y formato (sin React)
- `src/ui.jsx` — diálogos accesibles y avisos
- `src/App.jsx` — pantallas
- `src/estilos.js` — estilos
- `tests/` — pruebas unitarias, de SQL y de navegador
- `vercel.json` — encabezados de seguridad (CSP, etc.)

## Pendiente fuera del código

- Activar en Supabase los respaldos automáticos/PITR según el plan contratado.
- Validar impresión en las impresoras térmicas (58 y 80 mm) y lectura con lector de
  pantalla en los dispositivos reales.
