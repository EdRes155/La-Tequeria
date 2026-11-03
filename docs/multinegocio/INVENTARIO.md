# Inventario del estado actual

Generado por `tequeria-app/scripts/inventario.mjs` a partir de `supabase-schema.sql` y del código del navegador.
No se edita a mano: `npm run inventario` lo regenera y la CI comprueba que esté al día.
Sirve de lista de control para el [plan multinegocio](../../PLAN-MULTINEGOCIO.md): cada tabla, función, candado,
canal y clave del navegador de esta lista debe quedar ligada a una sucursal o justificarse como global.

## Resumen

- **14 tablas** en `public`, ninguna con acceso directo para `anon`: correcto.
- **65 funciones**: 39 de la API (ejecutables por `anon` o `authenticated`) y 26 internas.
- **Fila única `id = 1`** (configuración y cocina activa) en 17 funciones: `_ahora_local`, `_resolver_item`, `agregar_carne`, `agregar_extra`, `alternar_oculto`, `eliminar_extra`, `eliminar_usuario`, `estado`, `fijar_ajuste`, `fijar_precio`, `fijar_precio_extra`, `hacer_corte`, `latido_cocina`, `liberar_cocina`, `login`, `logout`, `usuarios_login`; y a través de otras en 8 más: `_fecha`, `_hora`, `_valorar_items`, `agregar_gasto`, `cobrar`, `enviar_comanda`, `guardar_borrador_mesa`, `reenviar_cocina`.
- **Candados** (`pg_advisory_xact_lock`) globales hoy: `tequeria:cobro:`, `tequeria:corte`, `tequeria:ticket:`. Deben incluir la sucursal.
- **Devuelven lo ya guardado** si se repite el id: `cobrar`, `enviar_comanda`, `reenviar_cocina`. Deben comprobar que sea de la misma sucursal.
- **PIN de administrador:** `crear_usuario`, `eliminar_usuario`, `hacer_corte`, `no_cobrar`, `restablecer_pin`. No debe servir el de otra sucursal.
- **Tiempo real:** el servidor avisa en el canal `tequeria` (público y único para todos); el navegador escucha `tequeria`.
- **Funciones de la API que el navegador no usa:** — (compatibilidad; decidir si se retiran).

## Tablas

| Tabla | Columnas | Llaves y referencias | RLS |
|---|---|---|---|
| `bebidas` | id, nombre, cantidad, activo, precio | PK (id) | sí |
| `bitacora` | id, usuario_id, usuario_nombre, accion, detalle, creado | PK (id) | sí |
| `carnes` | id, nombre, activo, orden | PK (id) | sí |
| `cobros` | id, metodo, total, propina, recibido, tickets, origen, cobrado_por, cobrado_nombre, fecha, hora, corte_id, anulado, anulado_por, anulado_motivo, created_at | PK (id) | sí |
| `cocina_hechos` | ticket_id, linea, hecho, por, actualizado | PK (ticket_id, linea) | sí |
| `cocina_sesion` | id, session_id, actualizado, dispositivo | PK (id) | sí |
| `config` | id, nombre_negocio, precios, extras, ocultos, zona_horaria, retencion_domicilio_dias, ajustes | PK (id) | sí |
| `cortes` | id, fecha, hora, tickets, total, created_at, detalle, gastos, hecho_por, autorizado_por, cobrado, por_cobrar | PK (id) | sí |
| `gastos` | id, concepto, monto, fecha, hora, usuario, created_at, corte_id, creado_por | PK (id) | sí |
| `intentos` | clave, fallos, bloqueado_hasta, ultimo | PK (clave) | sí |
| `mesas` | id, estado, mesero, hora, pedido, extras, version | PK (id) | sí |
| `sesiones` | id, token_hash, usuario_id, dispositivo, creada, ultimo_uso, expira, revocada | PK (id); único (token_hash); FK (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE | sí |
| `tickets` | id, tipo, es_extra, origen, mesa_id, ordenes, extras, mesero, hora, fecha, estado, archivado_cocina, total, domicilio, corte_id, created_at, reenvio, cuenta, para_llevar, referencia, creado_por, folio (identidad), recibido_at, cobro_id | PK (id) | sí |
| `usuarios` | id, nombre, rol, pin_hash, debe_cambiar_pin, creado | PK (id) | sí |

## Funciones de la API

Contexto: de dónde deberá salir la sucursal en el modelo multinegocio ([MODELO.md](MODELO.md)).

Lee y escribe: primero lo directo; «por otras» es lo que hace a través de las funciones que llama.

| Función | Acceso hoy | Lee | Escribe | Llama a | Puntos a cuidar | Contexto que deberá recibir |
|---|---|---|---|---|---|---|
| `actualizar_bebida(p_token text, p_id text, p_cambios jsonb)` | Sesión: admin | por otras: `sesiones`, `usuarios` | `bebidas` · por otras: `bitacora`, `sesiones` | `_error`, `_exigir`, `_log`, `_precio_ok` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `actualizar_carne(p_token text, p_id text, p_activo boolean)` | Sesión: admin | por otras: `sesiones`, `usuarios` | `carnes` · por otras: `sesiones` | `_exigir` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `agregar_bebida(p_token text, p_nombre text, p_precio numeric, p_cantidad integer)` | Sesión: admin | por otras: `sesiones`, `usuarios` | `bebidas` · por otras: `sesiones` | `_error`, `_exigir`, `_precio_ok` | usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `agregar_carne(p_token text, p_nombre text)` | Sesión: admin | `carnes` · por otras: `sesiones`, `usuarios` | `carnes`, `config` · por otras: `sesiones` | `_error`, `_exigir` | fila única `id = 1`; usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `agregar_extra(p_token text, p_cat text, p_nombre text, p_precio numeric)` | Sesión: admin | por otras: `sesiones`, `usuarios` | `config` · por otras: `sesiones` | `_error`, `_exigir`, `_precio_ok` | fila única `id = 1`; usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `agregar_gasto(p_token text, p_id text, p_concepto text, p_monto numeric)` | Sesión: admin | por otras: `config`, `sesiones`, `usuarios` | `gastos` · por otras: `sesiones` | `_error`, `_exigir`, `_fecha`, `_hora` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`); fila única `id = 1` (vía `_ahora_local`) | Sucursal de la sesión operativa |
| `ajustar_bebida(p_token text, p_id text, p_delta integer)` | Sesión: admin | por otras: `sesiones`, `usuarios` | `bebidas` · por otras: `sesiones` | `_error`, `_exigir` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `alternar_oculto(p_token text, p_clave text)` | Sesión: admin | por otras: `sesiones`, `usuarios` | `config` · por otras: `sesiones` | `_error`, `_exigir` | fila única `id = 1`; usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `anular_cobro(p_token text, p_id text, p_motivo text)` | Sesión: admin | `cobros` · por otras: `sesiones`, `usuarios` | `cobros`, `tickets` · por otras: `bitacora`, `sesiones` | `_error`, `_exigir`, `_log` | candado `tequeria:corte`; recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `archivar_ticket(p_token text, p_id text)` | Sesión: cocinero, admin | por otras: `sesiones`, `usuarios` | `tickets` · por otras: `sesiones` | `_error`, `_exigir` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `archivar_tickets(p_token text, p_ids text[])` | Sesión: cocinero, admin | `tickets` · por otras: `sesiones`, `usuarios` | `tickets` · por otras: `sesiones` | `_exigir` | recibe ids del cliente (p_ids); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `cambiar_estado_ticket(p_token text, p_id text, p_estado text)` | Sesión: cocinero, admin | `tickets` · por otras: `sesiones`, `usuarios` | `tickets` · por otras: `sesiones` | `_error`, `_exigir` | usa `now()`; recibe ids del cliente (p_id) | Sucursal de la sesión operativa |
| `cambiar_pin(p_token text, p_pin_actual text, p_pin_nuevo text)` | Sesión: cualquier rol | `usuarios` · por otras: `intentos`, `sesiones` | `sesiones`, `usuarios` · por otras: `bitacora`, `intentos` | `_espera`, `_fallo`, `_hash_pin`, `_limpiar_intentos`, `_log`, `_pin_debil`, `_pin_formato_ok`, `_pin_ok`, `_sesion` | verifica o guarda PIN; contadores de intentos `s:`; usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `cobrar(p_token text, p_id text, p_tickets text[], p_metodo text, p_recibido numeric, p_propina numeric, p_liberar_mesa boolean)` | Sesión: mesero, admin | `cobros`, `mesas`, `tickets` · por otras: `config`, `sesiones`, `usuarios` | `cobros`, `mesas`, `tickets` · por otras: `bitacora`, `sesiones` | `_error`, `_exigir`, `_fecha`, `_hora`, `_log` | candado `tequeria:cobro:`; candado `tequeria:corte` (compartido); devuelve lo ya guardado si se repite el id; recibe ids del cliente (p_id, p_tickets); usa `now()` (vía `_ahora`); fila única `id = 1` (vía `_ahora_local`) | Sucursal de la sesión operativa |
| `crear_usuario(p_token text, p_admin_pin text, p_nombre text, p_pin text, p_rol text)` | Sesión: admin | por otras: `intentos`, `sesiones`, `usuarios` | `usuarios` · por otras: `bitacora`, `intentos`, `sesiones` | `_exigir`, `_hash_pin`, `_log`, `_pin_debil`, `_pin_formato_ok`, `_verificar_admin` | PIN de administrador; verifica o guarda PIN; usa `now()` (vía `_ahora`); contadores de intentos `ip:`, `s:` (vía `_verificar_admin`) | Sucursal de la sesión operativa |
| `eliminar_bebida(p_token text, p_id text)` | Sesión: admin | `bebidas` · por otras: `sesiones`, `usuarios` | `bebidas` · por otras: `bitacora`, `sesiones` | `_exigir`, `_log` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `eliminar_carne(p_token text, p_id text)` | Sesión: admin | `carnes` · por otras: `sesiones`, `usuarios` | `carnes` · por otras: `bitacora`, `sesiones` | `_exigir`, `_log` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `eliminar_extra(p_token text, p_id text)` | Sesión: admin | por otras: `sesiones`, `usuarios` | `config` · por otras: `sesiones` | `_exigir` | fila única `id = 1`; recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `eliminar_gasto(p_token text, p_id text)` | Sesión: admin | `gastos` · por otras: `sesiones`, `usuarios` | `gastos` · por otras: `bitacora`, `sesiones` | `_error`, `_exigir`, `_log` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `eliminar_usuario(p_token text, p_admin_pin text, p_id text)` | Sesión: admin | `sesiones`, `usuarios` · por otras: `intentos` | `cocina_sesion`, `usuarios` · por otras: `bitacora`, `intentos`, `sesiones` | `_exigir`, `_log`, `_verificar_admin` | fila única `id = 1`; PIN de administrador; recibe ids del cliente (p_id); usa `now()` (vía `_ahora`); verifica o guarda PIN (vía `_verificar_admin`); contadores de intentos `ip:`, `s:` (vía `_verificar_admin`) | Sucursal de la sesión operativa |
| `enviar_comanda(p_token text, p_ticket jsonb)` | Sesión: mesero, admin | `bebidas`, `mesas`, `tickets` · por otras: `carnes`, `cobros`, `cocina_hechos`, `config`, `sesiones`, `usuarios` | `bebidas`, `mesas`, `tickets` · por otras: `sesiones` | `_error`, `_exigir`, `_fecha`, `_hora`, `_ticket_json`, `_total_items`, `_valorar_items` | candado `tequeria:ticket:`; devuelve lo ya guardado si se repite el id; recibe ids del cliente (p_ticket); usa `now()` (vía `_ahora`); fila única `id = 1` (vía `_ahora_local`) | Sucursal de la sesión operativa |
| `estado(p_token text, p_partes text[])` | Sesión: cualquier rol | `bebidas`, `carnes`, `config`, `cortes`, `gastos`, `mesas`, `tickets`, `usuarios` · por otras: `cobros`, `cocina_hechos`, `sesiones` | por otras: `sesiones` | `_mesa_json`, `_resumen`, `_sesion`, `_ticket_json` | fila única `id = 1`; usa `now()` | Sucursal de la sesión operativa |
| `fijar_ajuste(p_token text, p_clave text, p_valor jsonb)` | Sesión: admin | por otras: `sesiones`, `usuarios` | `config` · por otras: `bitacora`, `sesiones` | `_error`, `_exigir`, `_log` | fila única `id = 1`; usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `fijar_precio(p_token text, p_clave text, p_precio numeric)` | Sesión: admin | por otras: `sesiones`, `usuarios` | `config` · por otras: `bitacora`, `sesiones` | `_error`, `_exigir`, `_log`, `_precio_ok` | fila única `id = 1`; usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `fijar_precio_extra(p_token text, p_id text, p_precio numeric)` | Sesión: admin | por otras: `sesiones`, `usuarios` | `config` · por otras: `bitacora`, `sesiones` | `_exigir`, `_log`, `_precio_ok` | fila única `id = 1`; recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `guardar_borrador_mesa(p_token text, p_mesa_id integer, p_pedido jsonb, p_version integer)` | Sesión: mesero, admin | `mesas` · por otras: `config`, `sesiones`, `tickets`, `usuarios` | `mesas` · por otras: `sesiones` | `_error`, `_exigir`, `_hora`, `_mesa_json` | recibe ids del cliente (p_mesa_id); usa `now()` (vía `_ahora`); fila única `id = 1` (vía `_ahora_local`) | Sucursal de la sesión operativa |
| `hacer_corte(p_token text, p_admin_pin text)` | Sesión: cocinero, admin | `cobros`, `config`, `tickets` · por otras: `gastos`, `intentos`, `sesiones`, `usuarios` | `cobros`, `cortes`, `gastos`, `tickets` · por otras: `bitacora`, `intentos`, `sesiones` | `_exigir`, `_fecha`, `_hora`, `_log`, `_resumen`, `_verificar_admin` | fila única `id = 1`; candado `tequeria:corte`; PIN de administrador; usa `now()`; verifica o guarda PIN (vía `_verificar_admin`); contadores de intentos `ip:`, `s:` (vía `_verificar_admin`) | Sucursal de la sesión operativa |
| `latido_cocina(p_token text)` | Sesión: cualquier rol | `config` · por otras: `sesiones`, `usuarios` | `cocina_sesion` · por otras: `sesiones` | `_ahora`, `_sesion` | fila única `id = 1`; usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `liberar_cocina(p_token text)` | Sesión: cualquier rol | por otras: `sesiones`, `usuarios` | `cocina_sesion` · por otras: `sesiones` | `_sesion` | fila única `id = 1`; usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `liberar_mesa(p_token text, p_mesa_id integer)` | Sesión: mesero, admin | `mesas`, `tickets` · por otras: `sesiones`, `usuarios` | `mesas` · por otras: `bitacora`, `sesiones` | `_error`, `_exigir`, `_log`, `_mesa_json` | recibe ids del cliente (p_mesa_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `login(p_id text, p_pin text, p_dispositivo text)` | Sin sesión | `cocina_sesion`, `intentos`, `sesiones`, `usuarios` | `cocina_sesion`, `intentos`, `sesiones`, `usuarios` | `_ahora`, `_espera`, `_fallo`, `_hash_pin`, `_ip`, `_limpiar_intentos`, `_pin_debil`, `_pin_ok` | fila única `id = 1`; verifica o guarda PIN; contadores de intentos `ip:`, `u:`; recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal del dispositivo vinculado |
| `logout(p_token text)` | Token propio (sin revisar rol) | — | `cocina_sesion`, `sesiones` | — | fila única `id = 1` | Sucursal de la sesión operativa |
| `marcar_hecho(p_token text, p_ticket text, p_linea text, p_hecho boolean)` | Sesión: cocinero, admin | `tickets` · por otras: `sesiones`, `usuarios` | `cocina_hechos` · por otras: `sesiones` | `_error`, `_exigir` | usa `now()`; recibe ids del cliente (p_ticket) | Sucursal de la sesión operativa |
| `marcar_recibido(p_token text, p_ids text[])` | Sesión: cocinero, admin | `tickets` · por otras: `sesiones`, `usuarios` | `tickets` · por otras: `sesiones` | `_exigir` | usa `now()`; recibe ids del cliente (p_ids) | Sucursal de la sesión operativa |
| `mover_tickets(p_token text, p_tickets jsonb, p_hacia text)` | Sesión: cocinero, admin | `tickets` · por otras: `sesiones`, `usuarios` | `tickets` · por otras: `sesiones` | `_error`, `_exigir` | usa `now()`; recibe ids del cliente (p_tickets) | Sucursal de la sesión operativa |
| `no_cobrar(p_token text, p_admin_pin text, p_tickets text[], p_motivo text, p_liberar_mesa boolean)` | Sesión: mesero, admin | `mesas`, `tickets` · por otras: `intentos`, `sesiones`, `usuarios` | `mesas`, `tickets` · por otras: `bitacora`, `intentos`, `sesiones` | `_error`, `_exigir`, `_log`, `_verificar_admin` | candado `tequeria:corte` (compartido); PIN de administrador; recibe ids del cliente (p_tickets); usa `now()` (vía `_ahora`); verifica o guarda PIN (vía `_verificar_admin`); contadores de intentos `ip:`, `s:` (vía `_verificar_admin`) | Sucursal de la sesión operativa |
| `reenviar_cocina(p_token text, p_id text, p_mesa_id integer)` | Sesión: mesero, admin | `mesas`, `tickets` · por otras: `cobros`, `cocina_hechos`, `config`, `sesiones`, `usuarios` | `tickets` · por otras: `sesiones` | `_error`, `_exigir`, `_fecha`, `_hora`, `_ticket_json` | candado `tequeria:ticket:`; devuelve lo ya guardado si se repite el id; recibe ids del cliente (p_id, p_mesa_id); usa `now()` (vía `_ahora`); fila única `id = 1` (vía `_ahora_local`) | Sucursal de la sesión operativa |
| `restablecer_pin(p_token text, p_admin_pin text, p_id text, p_pin_nuevo text)` | Sesión: admin | `usuarios` · por otras: `intentos`, `sesiones` | `sesiones`, `usuarios` · por otras: `bitacora`, `intentos` | `_exigir`, `_hash_pin`, `_limpiar_intentos`, `_log`, `_pin_debil`, `_pin_formato_ok`, `_verificar_admin` | PIN de administrador; verifica o guarda PIN; contadores de intentos `u:`; recibe ids del cliente (p_id); usa `now()` (vía `_ahora`); contadores de intentos `ip:`, `s:` (vía `_verificar_admin`) | Sucursal de la sesión operativa |
| `usuarios_login()` | Sin sesión | `config`, `usuarios` | — | — | fila única `id = 1` | Sucursal del dispositivo vinculado |

## Funciones internas

| Función | Lee | Escribe | Llama a | Puntos a cuidar | Contexto que deberá recibir |
|---|---|---|---|---|---|
| `_ahora()` | — | — | — | usa `now()` | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_ahora_local()` | `config` | — | `_ahora` | fila única `id = 1`; usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama |
| `_avisar_cambio()` | — | — | — | aviso en tiempo real (canal `tequeria`, público) | Sucursal de la fila (canal privado por sucursal) |
| `_error(p_codigo text, p_mensaje text)` | — | — | — | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_espera(p_clave text)` | `intentos` | — | `_ahora` | usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama |
| `_exigir(p_token text, p_roles text[], OUT sid uuid, OUT uid text, OUT nombre text, OUT rol text)` | por otras: `sesiones`, `usuarios` | por otras: `sesiones` | `_error`, `_sesion` | usa `now()` (vía `_ahora`) | Sucursal de la sesión (resuelve la sesión) |
| `_fallo(p_clave text, p_umbral integer)` | — | `intentos` | `_ahora` | usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama |
| `_fecha()` | por otras: `config` | — | `_ahora_local` | usa `now()` (vía `_ahora`); fila única `id = 1` (vía `_ahora_local`) | Recibe la sucursal de quien la llama (indirecto) |
| `_hash_pin(p_pin text)` | — | — | — | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_hora()` | por otras: `config` | — | `_ahora_local` | usa `now()` (vía `_ahora`); fila única `id = 1` (vía `_ahora_local`) | Recibe la sucursal de quien la llama (indirecto) |
| `_ip()` | — | — | — | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_limpiar_intentos(p_clave text)` | — | `intentos` | — | — | Recibe la sucursal de quien la llama |
| `_log(p_uid text, p_nombre text, p_accion text, p_detalle jsonb)` | — | `bitacora` | — | — | Recibe la sucursal de quien la llama |
| `_mesa_json(m mesas)` | `tickets` | — | — | — | Recibe la sucursal de quien la llama |
| `_pin_debil(p_pin text)` | — | — | — | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_pin_formato_ok(p_pin text)` | — | — | — | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_pin_ok(p_hash text, p_pin text, p_id text)` | — | — | — | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_precio_ok(p numeric)` | — | — | `_error` | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_resolver_item(p_key text, p_empaque boolean)` | `bebidas`, `carnes`, `config` | — | — | fila única `id = 1` | Recibe la sucursal de quien la llama |
| `_resumen(p_corte text)` | `cobros`, `gastos`, `tickets` | — | — | — | Recibe la sucursal de quien la llama |
| `_sesion(p_token text, OUT sid uuid, OUT uid text, OUT nombre text, OUT rol text, OUT cambiar_pin boolean)` | `sesiones`, `usuarios` | `sesiones` | `_ahora`, `_error` | usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama |
| `_ticket_json(t tickets, p_domicilio boolean)` | `cobros`, `cocina_hechos` | — | — | — | Recibe la sucursal de quien la llama |
| `_total_items(p_items jsonb)` | — | — | — | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_valorar_items(p_items jsonb, p_empaque boolean)` | por otras: `bebidas`, `carnes`, `config` | — | `_error`, `_resolver_item` | fila única `id = 1` (vía `_resolver_item`) | Recibe la sucursal de quien la llama (indirecto) |
| `_verificar_admin(p_pin text, p_sid uuid, p_uid text)` | `usuarios` · por otras: `intentos` | por otras: `intentos` | `_espera`, `_fallo`, `_ip`, `_limpiar_intentos`, `_pin_ok` | verifica o guarda PIN; contadores de intentos `ip:`, `s:`; usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama |
| `crear_admin_inicial(p_nombre text, p_pin text)` | `usuarios` | `usuarios` · por otras: `bitacora` | `_hash_pin`, `_log`, `_pin_debil`, `_pin_formato_ok` | verifica o guarda PIN | Se reemplaza por el registro del dueño |

## Disparadores

| Tabla | Disparador | Definición |
|---|---|---|
| `bebidas` | `avisar_cambio` | `AFTER INSERT OR DELETE OR UPDATE ON public.bebidas FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |
| `carnes` | `avisar_cambio` | `AFTER INSERT OR DELETE OR UPDATE ON public.carnes FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |
| `cobros` | `avisar_cambio` | `AFTER INSERT OR UPDATE ON public.cobros FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |
| `cocina_hechos` | `avisar_cambio` | `AFTER INSERT OR UPDATE ON public.cocina_hechos FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |
| `config` | `avisar_cambio` | `AFTER INSERT OR DELETE OR UPDATE ON public.config FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |
| `cortes` | `avisar_cambio` | `AFTER INSERT OR DELETE OR UPDATE ON public.cortes FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |
| `gastos` | `avisar_cambio` | `AFTER INSERT OR DELETE OR UPDATE ON public.gastos FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |
| `mesas` | `avisar_cambio` | `AFTER INSERT OR DELETE OR UPDATE ON public.mesas FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |
| `tickets` | `avisar_cambio` | `AFTER INSERT OR DELETE OR UPDATE ON public.tickets FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |
| `usuarios` | `avisar_cambio` | `AFTER INSERT OR DELETE OR UPDATE ON public.usuarios FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |

## Navegador

Claves guardadas en `localStorage` o `sessionStorage`. Deberán incluir la sucursal o borrarse al cambiar de sucursal.

| Clave | Constante | Archivo |
|---|---|---|
| `tequeria_autoprint` | `AUTOPRINT_KEY` | `src/App.jsx` |
| `tequeria_cocina_sid` | `(literal, versión anterior)` | `src/store.js` |
| `tequeria_dispositivo` | `DISP_KEY` | `src/store.js` |
| `tequeria_estacion` | `ESTACION_KEY` | `src/App.jsx` |
| `tequeria_local_v3` | `KEY` | `src/localStore.js` |
| `tequeria_monitor_sonido` | `SONIDO_KEY` | `src/App.jsx` |
| `tequeria_papel` | `PAPEL_KEY` | `src/App.jsx` |
| `tequeria_sesion` | `SESION_KEY` | `src/store.js` |
| `tequeria_sesion_local` | `SESION_KEY` | `src/localStore.js` |
| `tequeria_ultimo_usuario` | `ULTIMO_KEY` | `src/App.jsx` |

Funciones que llama el navegador (39): `actualizar_bebida`, `actualizar_carne`, `agregar_bebida`, `agregar_carne`, `agregar_extra`, `agregar_gasto`, `ajustar_bebida`, `alternar_oculto`, `anular_cobro`, `archivar_ticket`, `archivar_tickets`, `cambiar_estado_ticket`, `cambiar_pin`, `cobrar`, `crear_usuario`, `eliminar_bebida`, `eliminar_carne`, `eliminar_extra`, `eliminar_gasto`, `eliminar_usuario`, `enviar_comanda`, `estado`, `fijar_ajuste`, `fijar_precio`, `fijar_precio_extra`, `guardar_borrador_mesa`, `hacer_corte`, `latido_cocina`, `liberar_cocina`, `liberar_mesa`, `login`, `logout`, `marcar_hecho`, `marcar_recibido`, `mover_tickets`, `no_cobrar`, `reenviar_cocina`, `restablecer_pin`, `usuarios_login`.

## Pruebas con PIN de 4 o 5 dígitos

La política nueva exige PIN de 6 a 8 dígitos. Estas pruebas usan textos de 4 o 5 dígitos (casi siempre PIN) y
deberán adaptarse cuando se implemente, además de agregar casos de rechazo y transición.

| Archivo | Apariciones |
|---|---|
| `tests/dominio.test.js` | 8 |
| `tests/e2e/comandas.spec.js` | 10 |
| `tests/localStore.test.js` | 32 |
| `tests/sql/esquema.test.js` | 44 |
| `tests/sql/reloj.test.js` | 8 |
| `tests/sql/remoto.test.js` | 9 |
