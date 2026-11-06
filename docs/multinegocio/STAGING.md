# Staging: Supabase real para el piloto técnico

Proyecto aparte de producción para probar con Supabase real lo que las pruebas locales solo pueden imitar:
el inicio anónimo de los equipos, el correo verificado de los dueños, los canales privados del servidor de
Realtime y el tiempo de corte de un equipo revocado ([MODELO.md §9](MODELO.md#9-orden-sugerido-para-implementar-paso-3-del-plan),
paso 7). Solo tiene datos sintéticos (dominio `.invalid`). Nunca se copian datos de producción aquí.

| | |
|---|---|
| Proyecto | `la-tequeria-staging` (`izcaeojzbaoqlxkerria`), región `us-east-2`, plan gratuito |
| URL | `https://izcaeojzbaoqlxkerria.supabase.co` |
| Producción | `La Tequeria` (`ahmkfmoftpvhdcrjnhoe`), sin cambios |
| App | Vistas previas de Vercel (rama distinta de `main`): `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` con destino **Preview** apuntan a staging; las de **Production** siguen apuntando a producción |

Para tenerlo dentro del límite de dos proyectos gratuitos se pausó `cazaofertas-ml` (se reactiva desde el
panel de Supabase con sus datos intactos).

## Configuración

| Ajuste | Valor | Por qué |
|---|---|---|
| Esquema | `tequeria-app/supabase-schema.sql` de la rama, aplicado dos veces (se puede repetir) | Igual que en producción: una sola transacción |
| Auth: inicio anónimo | Activado | Identidad de los equipos (MODELO.md §4) |
| Auth: confirmar correo | Obligatorio | `_identidad` exige correo verificado |
| Auth: vigencia del JWT | 600 s | Valor a medir para el tiempo de corte del tiempo real |
| Auth: límite de inicios anónimos | 30 por hora y por IP (el de Supabase) | Protección contra altas masivas de identidades |
| Auth: CAPTCHA | **Sin configurar** | Necesita claves de hCaptcha o Turnstile; queda pendiente antes del piloto |
| Realtime: solo canales privados | Activado | Ver «Hallazgos» |

Los avisos de seguridad de Supabase muestran dos tipos, ambos esperados por el diseño: tablas con RLS sin
políticas (nadie las lee directo; todo pasa por las funciones) y funciones `SECURITY DEFINER` que ejecuta
`authenticated` (son la API). Ninguna función la ejecuta `anon`.

## Prueba de humo

`tequeria-app/scripts/staging/humo.mjs` corre contra staging con `supabase-js`, igual que la app:

```bash
cd tequeria-app
node scripts/staging/humo.mjs                      # unos 30 s
node scripts/staging/humo.mjs --medir-revocacion   # además, el tiempo de corte (hasta 15 min)
```

- Se niega a correr si el proyecto no se llama «staging» o es el de producción.
- Lee las llaves con la API de administración de Supabase (el token lo inyecta el proxy del entorno de Claude
  Code); la `service_role` solo vive en memoria para crear personas de prueba con el correo confirmado.
- Cada ejecución crea dos cuentas nuevas, con sus dueños, equipos y datos sintéticos.

Comprueba, contra el servidor real:

1. La configuración (inicio anónimo, correo confirmado, solo canales privados).
2. Sin sesión (`anon`) no se ejecuta ninguna función.
3. Alta: dos personas entran con correo y contraseña y crean su cuenta, su sucursal y su administrador.
4. Vinculación: los dueños generan códigos; tres identidades anónimas se vinculan (una como monitor); un
   código usado ya no sirve.
5. Entrada: cada equipo ve solo el personal de su sucursal; el administrador entra y lee el estado inicial.
6. Aislamiento: el token de otra sucursal, una persona como equipo, un equipo como persona y un dueño con
   la cuenta de otro se rechazan.
7. Tiempo real: el equipo se suscribe al canal privado de su sucursal; el de otra sucursal y el de una persona
   se rechazan («Unauthorized»).
8. Un cambio avisa solo a su sucursal en menos de un segundo y sin datos; un cliente no puede publicar.
9. Revocar: el equipo pierde el acceso a los datos en la siguiente llamada.
10. (Con `--medir-revocacion`) cuánto tarda el equipo revocado, con la conexión abierta, en dejar de recibir
    avisos.

## Recorrido de la app en el navegador

`tequeria-app/scripts/staging/navegador.mjs` levanta la app con la URL y la llave pública de staging y, con
Chromium, recorre lo que hará un equipo nuevo: pide vincularse, se vincula con un código (escrito con
minúsculas y guion), el administrador entra y ve sus mesas, al recargar conserva la identidad y la sesión, el
canal privado queda conectado («En línea, sincronizado») y, al revocar el equipo, vuelve a «Vincular este
equipo» sin datos en pantalla ni claves guardadas. Usa uno o dos inicios anónimos.

## Resultados (6 de noviembre de 2026)

- Prueba de humo, pasos 1 a 9: bien. El aviso llega entre 0.4 y 0.5 s después de la llamada.
- Recorrido en el navegador: 6 de 6 bien.
- **Tiempo de corte con la conexión abierta:** el equipo revocado recibió el último aviso a los 458 s y ninguno
  desde los 479 s, con el JWT de 600 s. El corte coincide con la renovación del JWT del equipo, que vuelve a
  autorizar el canal: el peor caso es la vigencia del JWT (hoy 10 minutos). Desde la revocación el equipo ya
  no lee ni escribe nada (las funciones lo rechazan en la siguiente llamada) y los avisos no llevan datos:
  solo el nombre de la tabla. Bajar la vigencia a 300 s acortaría el peor caso a 5 minutos a cambio de
  renovar el doble de seguido.

## Hallazgos

- **Equipo nuevo sin sesión: Supabase responde `42501`, no `DISPOSITIVO`.** Sin identidad anónima la llamada
  va con la llave pública, y `anon` no ejecuta ninguna función. La app mostraba «No hay conexión» en lugar de
  «Vincular este equipo»; el servidor simulado de los recorridos respondía `DISPOSITIVO` y lo ocultaba.
  Corregido: la app trata `42501` como equipo sin vincular, y el simulador responde como Supabase real. Así
  la app no crea una identidad solo por abrirla: la crea al vincular.
- **Los avisos llevan un `id`** además de `t`: es el identificador del mensaje que agrega Realtime, no un
  dato de la app. La app solo lee `t`.
- **Justo después de cambiar la configuración de Realtime**, las suscripciones privadas fallaron durante unos
  minutos (el servicio se reinicia). Después funcionan.
- **Canales públicos:** con «solo canales privados» activado, un cliente con la llave pública todavía pudo
  suscribirse a un canal público; se volvió a comprobar unos 20 minutos después con el mismo resultado (la API
  sigue diciendo `private_only = true`). Queda por revisar en el panel (Realtime → Settings) o con el soporte
  de Supabase. La app no usa canales públicos y en su canal privado nadie
  puede publicar, así que esto no le afecta.
- **Vistas previas apuntaban a producción:** antes de este cambio, las variables `VITE_SUPABASE_*` de Vercel
  aplicaban a Preview y Production, así que las vistas previas de esta rama usaban la base de producción
  (protegidas por el inicio de sesión de Vercel). Ahora Preview usa staging. Las vistas previas que ya estaban
  compiladas siguen con producción hasta que se borren o se vuelvan a compilar.

## Pendiente

- CAPTCHA del inicio anónimo (claves de hCaptcha o Turnstile).
- Volver a medir el tiempo de corte con la app en el navegador (no solo con el script).
- Al terminar el piloto técnico: revocar el token de administración de Supabase guardado en el entorno de
  Claude Code y, si ya no se usa, pausar staging para reactivar `cazaofertas-ml`.
