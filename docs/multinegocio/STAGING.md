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
| App | Vistas previas de Vercel (rama distinta de `main`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_TURNSTILE_SITE_KEY` (llave de prueba) con destino **Preview** apuntan a staging; las de **Production** siguen apuntando a producción |

Para tenerlo dentro del límite de dos proyectos gratuitos se pausó `cazaofertas-ml` (se reactiva desde el
panel de Supabase con sus datos intactos).

## Configuración

| Ajuste | Valor | Por qué |
|---|---|---|
| Esquema | `tequeria-app/supabase-schema.sql` de la rama, aplicado dos veces seguidas (se puede repetir) | Igual que en producción: una sola transacción |
| Auth: inicio anónimo | Activado | Identidad de los equipos (MODELO.md §4) |
| Auth: confirmar correo | Obligatorio | `_identidad` exige correo verificado |
| Auth: contraseñas | Mínimo 10 caracteres | Compensa que no haya revisión de contraseñas filtradas (ver avisos) |
| Auth: vigencia del JWT | **300 s** (aprobado para producción) | Es el límite elegido para el tiempo de corte del tiempo real (antes, 600 s) |
| Auth: límite de inicios anónimos | 100 por hora y por IP **solo en staging**, para repetir las mediciones (cada una usa de 5 a 7) | En producción, 30 (el de Supabase) |
| Auth: CAPTCHA | Cloudflare Turnstile con las **llaves de prueba** de Cloudflare (públicas; siempre pasan) | Supabase exige un token en cada inicio anónimo y con correo, y lo comprueba con Cloudflare. Producción usará llaves reales (MIGRACION.md §5) |
| Realtime: solo canales privados | Activado **y aplicado** (lo comprueba `humo.mjs`) | Ver «Hallazgos» |

## Avisos de seguridad de Supabase

Los cuatro que muestra el asesor de seguridad, el 6 de noviembre de 2026:

| Aviso | Nivel | Cuántos | Qué es y qué se hizo |
|---|---|---|---|
| Tablas con RLS sin políticas (`rls_enabled_no_policy`) | Info | 25 | Esperado: nadie lee ni escribe las tablas directo; todo pasa por las funciones. |
| Funciones `SECURITY DEFINER` que ejecuta `authenticated` (`authenticated_security_definer_function_executable`) | Aviso | 54 | Esperado: son la API. Cada una valida al equipo, la sesión o la persona (MODELO.md §3); `anon` no ejecuta ninguna (lo comprueba `humo.mjs`). |
| Política que admite usuarios anónimos (`auth_allow_anonymous_sign_ins`) en `realtime.messages` | Aviso | 1 | Esperado: los equipos son identidades anónimas y escuchan su canal con la política `tequeria_escuchar_sucursal`. Solo deja escuchar a un equipo vinculado, sin revocar y vigente en Auth: una identidad anónima sin vincular, una persona, otra sucursal o una llamada sin sesión se rechazan (lo comprueba `humo.mjs` contra el servidor). |
| Protección de contraseñas filtradas desactivada (`auth_leaked_password_protection`) | Aviso | 1 | No se puede activar en el plan gratuito: la API responde 402 («available on Pro Plans and up»). Se subió el mínimo a 10 caracteres, que por ahora basta (decidido el 6 de noviembre); los dueños también podrán entrar con Google (paso 6). |

## Scripts

Todos se niegan a correr si el proyecto no se llama «staging» o es el de producción. Leen las llaves con
la API de administración de Supabase (el token lo inyecta el proxy del entorno de Claude Code); la
`service_role` solo vive en memoria, para crear personas de prueba con el correo confirmado. Cada
ejecución crea cuentas nuevas con datos sintéticos. Lo común está en `scripts/staging/comun.mjs`.

```bash
cd tequeria-app
node scripts/staging/humo.mjs              # unos 30 s
node scripts/staging/navegador.mjs         # unos 40 s; usa la última sucursal de humo.mjs
node scripts/staging/corte.mjs             # unos 9 min
node scripts/staging/corte-navegador.mjs   # unos 5 min
```

**`humo.mjs`**, contra el servidor real:

1. La configuración declarada (inicio anónimo, correo confirmado, JWT ≤ 300 s, contraseñas ≥ 10,
   CAPTCHA con Turnstile, solo canales privados). Lo que se aplica de verdad lo comprueban los pasos
   siguientes.
2. Sin sesión (`anon`) no se ejecuta ninguna función.
3. **CAPTCHA, aplicado:** sin token se rechazan el inicio anónimo y el inicio con correo
   (`captcha_failed`). Los scripts mandan el token de prueba de Cloudflare.
4. **Solo canales privados, aplicado:** un canal público se rechaza (`PrivateOnly`) sin sesión y con una
   identidad anónima.
5. Alta: dos personas entran con correo y contraseña y crean su cuenta, su sucursal y su administrador.
6. Vinculación: los dueños generan códigos; tres identidades anónimas se vinculan (una como monitor); un
   código usado ya no sirve.
7. Entrada: cada equipo ve solo el personal de su sucursal; el administrador entra y lee el estado inicial.
8. Aislamiento: el token de otra sucursal, una persona como equipo, un equipo como persona y un dueño con
   la cuenta de otro se rechazan.
9. Tiempo real: el equipo escucha el canal privado de su sucursal; el de otra sucursal, una persona, una
   identidad anónima sin vincular y una llamada sin sesión se rechazan.
10. Un cambio avisa solo a su sucursal en menos de un segundo y sin datos; un cliente no puede publicar.
11. Revocar: el equipo pierde el acceso a los datos en la siguiente llamada.
12. Supabase Auth real: un equipo o una persona suspendida, o borrada de forma lógica, deja de servir en
    la siguiente llamada (con su JWT todavía vigente); el borrado definitivo de un equipo vinculado se
    rechaza y el equipo sigue igual; una identidad anónima que nunca se vinculó sí se borra.

**`navegador.mjs`**: compila la app como se publica (URL y llave pública de staging, llave de sitio de prueba
del CAPTCHA) y la sirve con las cabeceras de `vercel.json`, la CSP incluida (`servirApp` en `comun.mjs`; también
la usa `corte-navegador.mjs`). Con Chromium recorre lo que hará un equipo nuevo, con el widget real de
Turnstile: pide vincularse, se vincula con un código (escrito con minúsculas y guion), el
administrador entra y ve sus mesas, al recargar conserva la identidad y la sesión, el canal privado queda
conectado («En línea, sincronizado») y, al revocar el equipo, vuelve a «Vincular este equipo» sin datos en
pantalla ni claves guardadas. Al final comprueba que la CSP no bloqueó nada: sin
`challenges.cloudflare.com` en la CSP, Turnstile no carga y la vinculación no avanza (comprobado).

**`corte.mjs`** y **`corte-navegador.mjs`**: el tiempo de corte, abajo.

## Tiempo de corte

Cuánto puede seguir recibiendo avisos un equipo revocado que tiene la conexión de tiempo real abierta.
Los avisos no llevan datos (solo el nombre de la tabla) y desde la revocación el equipo ya no lee ni
escribe nada: las funciones lo rechazan en la siguiente llamada.

**Cómo se mide.** Un cambio cada 5 s en la sucursal. Un equipo de **control**, vigente, escucha el mismo
canal: si un cambio no le llega, la medición no vale (así una interrupción general no se confunde con un
corte). Cada equipo revocado debe haber recibido todo antes de revocarlo, no volver a recibir nada después
de su último aviso, y ese último aviso tiene que llegar dentro del **límite elegido, la vigencia del JWT
(300 s)**, y del vencimiento del JWT que tenía al revocarlo, con 5 s de tolerancia (la resolución de la
medición: el servidor cierra el canal al vencer el JWT y un cambio que sale en ese instante todavía llega).

### Un cliente que no suelta el canal (`corte.mjs`)

Un cliente modificado que ignora `DISPOSITIVO` y sigue escuchando. Cuatro equipos revocados a la vez, cada
uno en un momento distinto de la renovación de su JWT (supabase-js renueva cuando le faltan menos de 120 s):

| Equipo | Edad del JWT al revocar | Último aviso – sin avisos desde | Qué lo cortó |
|---|---|---|---|
| `justo-antes` | 172 · 174 · 173 s | 6–11 · 6–11 · 5–11 s | Su renovación, a los 9 · 6 · 7 s |
| `a-medias` | 84 · 89 · 88 s | 91–97 · 90–96 · 89–94 s | Su renovación, a los 97 · 92 · 93 s |
| `recien` (peor caso de un cliente que renueva) | 13 · 13 · 13 s | 166–171 · 165–170 · 163–168 s | Su renovación, a los 167 · 167 · 168 s |
| `token-fijo` (nunca manda otro JWT) | — · 12 · 12 s | — · 288–293 · 285–291 s | El servidor, al vencer el JWT (288 s) |

Tres corridas (separadas por «·»); el control recibió los 99, 100 y 100 cambios. En todas, el canal de
cada equipo revocado se cerró (`CLOSED`) y no volvió a recibir nada. La primera tenía un `sin-renovar` en
lugar de `token-fijo` y no medía lo que debía (ver «Hallazgos»); la segunda marcó como fallo un aviso de un cambio enviado
justo al vencer el JWT (menos de un segundo), y de ahí la tolerancia de 5 s; la tercera pasó todas las
comprobaciones.

**Conclusión:** Realtime vuelve a evaluar la política cuando el cliente manda un JWT nuevo, y cierra el
canal cuando vence el JWT si el cliente nunca manda otro. El peor caso es la vigencia del JWT: **300 s**
(más unos segundos).

### La app real en el navegador (`corte-navegador.mjs`)

La app en Chromium, con el administrador dentro y en línea. La app no se queda escuchando: con el primer
aviso (o, sin cambios en la sucursal, con su consulta periódica cada 30 s) llama al servidor, recibe
`DISPOSITIVO`, vacía la pantalla, borra sus claves y suelta el canal.

| Equipo | Edad del JWT al revocar | Sin datos en pantalla a los |
|---|---|---|
| `justo-antes`, sin cambios en la sucursal | 148 · 147 s | 29.1 · 30.2 s |
| `a-medias`, sin cambios | 66 · 66 s | 6.2 · 6.8 s |
| `recien`, sin cambios | 6 · 7 s | 32.0 · 31.5 s |
| `con-cambios`, un cambio cada 5 s | 47 · 47 s | 4.8 · 5.1 s |

Dos corridas, las dos con todas las comprobaciones bien: el control siguió en Mesas y recibió los 10
cambios; ningún equipo revocado recibió avisos después de vaciar la pantalla ni conservó claves. Cota
comprobada: 45 s sin cambios, 10 s con cambios.

**Limitación conocida:** con la pestaña oculta la app no hace la consulta periódica; si no hay cambios,
la pantalla se vacía al volver a mostrarse (la primera llamada responde `DISPOSITIVO`). La pantalla de
desbloqueo del paso 6 la cubre.

## Hallazgos

- **«Solo canales privados» no se aplicaba.** Con `private_only = true` en la API, un cliente todavía se
  suscribía a un canal público, con y sin sesión. El ajuste guardado al crear el proyecto no había llegado
  al servidor de Realtime: al desactivarlo y volver a activarlo, los canales públicos se rechazan con
  `PrivateOnly: This project only allows private channels` (comprobado durante 6 minutos y en cada
  ejecución de `humo.mjs`). Por eso `humo.mjs` exige el rechazo efectivo y MIGRACION.md §5 pide
  comprobarlo en producción, no solo leer la configuración.
- **supabase-js renueva el JWT aunque se apague la renovación automática:** el tiempo real pide el JWT
  en cada latido y supabase-js lo renueva si le faltan menos de 90 s. El primer `sin-renovar` se renovó a
  los 214 s y se cortó entonces, no al vencer. Para medir lo que hace el servidor, `token-fijo` abre el
  canal con otro cliente que siempre entrega el mismo JWT.
- **Borrar en Supabase Auth la identidad de un equipo vinculado fallaba por casualidad** («Database
  error deleting user»): `dispositivos` tenía `on delete cascade`, pero lo impedía la referencia del
  código con que se vinculó. Ahora es una regla explícita (`on delete restrict`, MODELO.md §4): se
  conserva su historial; para cortarlo se revoca, se suspende o se borra de forma lógica. El borrado de
  una persona sigue quitando sus membresías, y el del último propietario de una cuenta activa lo rechaza
  `cuenta_con_propietario` (prueba en `tests/sql/duenos.test.js`).
- **Equipo nuevo sin sesión: Supabase responde `42501`, no `DISPOSITIVO`.** Sin identidad anónima la llamada
  va con la llave pública, y `anon` no ejecuta ninguna función. La app mostraba «No hay conexión» en lugar de
  «Vincular este equipo»; corregido en `e7909fa`, y el simulador de los recorridos responde como Supabase
  real. La app no crea una identidad solo por abrirla: la crea al vincular.
- **Los avisos llevan un `id`** además de `t`: es el identificador del mensaje que agrega Realtime. La app
  solo lee `t`.
- **Justo después de cambiar la configuración de Realtime**, las suscripciones privadas pueden fallar
  durante unos minutos (el servicio se reinicia).
- **Vistas previas que apuntaban a producción:** hasta `e7909fa`, las variables `VITE_SUPABASE_*` de Vercel
  aplicaban a Preview y Production, así que las vistas previas usaban la base de producción. Ahora Preview
  usa staging, y las **27 vistas previas compiladas antes** (de `9e5df3b` a `1e4607e`, todas de esta rama)
  se borraron el 6 de noviembre con la API de Vercel; el despliegue de producción no cambió.
- **El CAPTCHA se comprueba con Cloudflare, no solo que haya token:** con el secreto de prueba que
  Cloudflare siempre rechaza, el token de prueba se rechazó (`invalid-input-response`); con el que siempre
  acepta, pasa; sin token, `captcha_failed`. Los cambios de la configuración de Auth tardan unos segundos en
  aplicarse.

## Pendiente

- Llaves reales de Turnstile para producción (MIGRACION.md §5).
- La protección de contraseñas filtradas (plan Pro) se deja para después: por ahora, mínimo de 10
  caracteres (decidido el 6 de noviembre).
- Repetir la medición con el cliente del paso 6 terminado (panel de dueños y desbloqueo).
- Al terminar el piloto técnico: revocar el token de administración de Supabase guardado en el entorno de
  Claude Code y, si ya no se usa, pausar staging para reactivar `cazaofertas-ml`.
