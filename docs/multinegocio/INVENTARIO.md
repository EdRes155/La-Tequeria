# Inventario del estado actual

Generado por `tequeria-app/scripts/inventario.mjs` a partir de `supabase-schema.sql` y del código del navegador.
No se edita a mano: `npm run inventario` lo regenera y la CI comprueba que esté al día.
Sirve de lista de control para el [plan multinegocio](../../PLAN-MULTINEGOCIO.md): cada tabla, función, candado,
canal y clave del navegador de esta lista debe quedar ligada a una sucursal o justificarse como global.

## Resumen

- **24 tablas** en `public`, ninguna con acceso directo para `anon`: correcto.
- **76 funciones**: 39 de la API (ejecutables por `anon` o `authenticated`) y 37 internas.
- **Fila única `id = 1`** (configuración y cocina activa) en 0 funciones: —; y a través de otras en 0 más: —.
- **Candados** (`pg_advisory_xact_lock`): `tequeria:cobro:` por id; `tequeria:corte:` por sucursal; `tequeria:ticket:` por id. Ninguno global: el del corte es por sucursal y los de comanda y cobro son por su id, que es global.
- **Devuelven lo ya guardado** si se repite el id: `cobrar`, `enviar_comanda`, `reenviar_cocina`. Todas comprueban que sea de la misma sucursal.
- **PIN de administrador:** `crear_usuario`, `eliminar_usuario`, `hacer_corte`, `no_cobrar`, `restablecer_acceso`, `restablecer_pin`. Todas lo buscan solo en la sucursal de la sesión.
- **Tiempo real:** el servidor avisa en el canal `tequeria` (público y único para todos; el canal privado por sucursal es el paso 5); el navegador escucha `tequeria`.
- **Funciones de la API que el navegador no usa:** `desbloquear`, `restablecer_acceso` (compatibilidad; decidir si se retiran).

## Tablas

| Tabla | Columnas | Llaves y referencias | RLS |
|---|---|---|---|
| `bebidas` | id, nombre, cantidad, activo, precio, sucursal_id | PK (sucursal_id, id); FK (sucursal_id) REFERENCES sucursales(id) | sí |
| `bitacora` | id, usuario_id, usuario_nombre, accion, detalle, creado, sucursal_id | PK (id); FK (sucursal_id) REFERENCES sucursales(id) | sí |
| `carnes` | id, nombre, activo, orden, sucursal_id | PK (sucursal_id, id); FK (sucursal_id) REFERENCES sucursales(id) | sí |
| `cobros` | id, metodo, total, propina, recibido, tickets, origen, cobrado_por, cobrado_nombre, fecha, hora, corte_id, anulado, anulado_por, anulado_motivo, created_at, sucursal_id | FK (sucursal_id, corte_id) REFERENCES cortes(sucursal_id, id) DEFERRABLE INITIALLY DEFERRED; PK (id); FK (sucursal_id) REFERENCES sucursales(id); único (sucursal_id, id) | sí |
| `cocina_hechos` | ticket_id, linea, hecho, por, actualizado, sucursal_id | PK (ticket_id, linea); FK (sucursal_id) REFERENCES sucursales(id); FK (sucursal_id, ticket_id) REFERENCES tickets(sucursal_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED | sí |
| `cocina_sesion` | session_id, actualizado, dispositivo, sucursal_id | PK (sucursal_id); FK (sucursal_id) REFERENCES sucursales(id) | sí |
| `codigos_vinculacion` | id, sucursal_id, codigo_hash, monitor_cocina, creado_por, creado, vence, usado_en, dispositivo_id | FK (sucursal_id, dispositivo_id) REFERENCES dispositivos(sucursal_id, id); único (codigo_hash); PK (id); FK (sucursal_id) REFERENCES sucursales(id) | sí |
| `config` | nombre_negocio, precios, extras, ocultos, zona_horaria, retencion_domicilio_dias, ajustes, sucursal_id | PK (sucursal_id); FK (sucursal_id) REFERENCES sucursales(id) | sí |
| `cortes` | id, fecha, hora, tickets, total, created_at, detalle, gastos, hecho_por, autorizado_por, cobrado, por_cobrar, sucursal_id | PK (id); FK (sucursal_id) REFERENCES sucursales(id); único (sucursal_id, id) | sí |
| `cuentas` | id, nombre, estado, creada, activada_en, revision_propietarios | PK (id) | sí |
| `dispositivos` | id, sucursal_id, auth_user_id, nombre, monitor_cocina, aprobado_por, creado, ultimo_uso, revocado_en, revocado_por | FK (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE; único (auth_user_id); PK (id); FK (sucursal_id) REFERENCES sucursales(id); único (sucursal_id, id) | sí |
| `folios` | sucursal_id, periodo, ultimo | PK (sucursal_id, periodo); FK (sucursal_id) REFERENCES sucursales(id) | sí |
| `gastos` | id, concepto, monto, fecha, hora, usuario, created_at, corte_id, creado_por, sucursal_id | FK (sucursal_id, corte_id) REFERENCES cortes(sucursal_id, id) DEFERRABLE INITIALLY DEFERRED; PK (id); FK (sucursal_id) REFERENCES sucursales(id); único (sucursal_id, id) | sí |
| `intentos` | clave, fallos, bloqueado_hasta, ultimo, nivel | PK (clave) | sí |
| `intentos_dispositivo` | id (identidad), sucursal_id, dispositivo_id, creado | FK (sucursal_id, dispositivo_id) REFERENCES dispositivos(sucursal_id, id) ON DELETE CASCADE; PK (id) | sí |
| `intentos_operador` | sucursal_id, usuario_id, fallos, nivel, bloqueado_hasta, ultimo | PK (sucursal_id, usuario_id); FK (sucursal_id, usuario_id) REFERENCES usuarios(sucursal_id, id) ON DELETE CASCADE | sí |
| `invitaciones` | id, cuenta_id, correo, rol, token_hash, vence, creada, creada_por, usada_en, usada_por | FK (cuenta_id) REFERENCES cuentas(id); PK (id); único (token_hash) | sí |
| `membresias` | cuenta_id, auth_user_id, rol, creada, creada_por | FK (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE; FK (cuenta_id) REFERENCES cuentas(id); PK (cuenta_id, auth_user_id) | sí |
| `mesas` | id, estado, mesero, hora, pedido, extras, version, sucursal_id | PK (sucursal_id, id); FK (sucursal_id) REFERENCES sucursales(id) | sí |
| `sesiones` | id, token_hash, usuario_id, dispositivo, creada, vence_absoluta, revocada, sucursal_id, motivo_fin, dispositivo_id | FK (sucursal_id, dispositivo_id) REFERENCES dispositivos(sucursal_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED; PK (id); FK (sucursal_id) REFERENCES sucursales(id); único (sucursal_id, id); único (token_hash); FK (sucursal_id, usuario_id) REFERENCES usuarios(sucursal_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED; FK (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE | sí |
| `sesiones_actividad` | sesion_id, ultima_interaccion | PK (sesion_id) | sí |
| `sucursales` | id, cuenta_id, nombre, zona_horaria, retencion_domicilio_dias, activa, creada | FK (cuenta_id) REFERENCES cuentas(id); único (cuenta_id, id); PK (id) | sí |
| `tickets` | id, tipo, es_extra, origen, mesa_id, ordenes, extras, mesero, hora, fecha, estado, archivado_cocina, total, domicilio, corte_id, created_at, reenvio, cuenta, para_llevar, referencia, creado_por, folio (identidad), recibido_at, cobro_id, sucursal_id, estado_cobro, folio_periodo | FK (sucursal_id, cobro_id) REFERENCES cobros(sucursal_id, id) DEFERRABLE INITIALLY DEFERRED; FK (sucursal_id, corte_id) REFERENCES cortes(sucursal_id, id) DEFERRABLE INITIALLY DEFERRED; único (sucursal_id, folio_periodo, folio); FK (sucursal_id, mesa_id) REFERENCES mesas(sucursal_id, id) DEFERRABLE INITIALLY DEFERRED; PK (id); FK (sucursal_id) REFERENCES sucursales(id); único (sucursal_id, id) | sí |
| `usuarios` | id, nombre, rol, pin_hash, debe_cambiar_pin, creado, sucursal_id, politica_pin, pin_cambiado_en | PK (id); FK (sucursal_id) REFERENCES sucursales(id); único (sucursal_id, id) | sí |

## Funciones de la API

Contexto: de dónde deberá salir la sucursal en el modelo multinegocio ([MODELO.md](MODELO.md)).

Lee y escribe: primero lo directo; «por otras» es lo que hace a través de las funciones que llama.

| Función | Acceso hoy | Lee | Escribe | Llama a | Puntos a cuidar | Contexto que deberá recibir |
|---|---|---|---|---|---|---|
| `actualizar_bebida(p_token text, p_id text, p_cambios jsonb)` | Sesión: admin · interaccion | por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `bebidas` · por otras: `bitacora`, `sesiones_actividad` | `_contexto`, `_error`, `_log`, `_precio_ok` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `actualizar_carne(p_token text, p_id text, p_activo boolean)` | Sesión: admin · interaccion | por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `carnes` · por otras: `sesiones_actividad` | `_contexto` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `agregar_bebida(p_token text, p_nombre text, p_precio numeric, p_cantidad integer)` | Sesión: admin · interaccion | por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `bebidas` · por otras: `sesiones_actividad` | `_contexto`, `_error`, `_precio_ok` | usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `agregar_carne(p_token text, p_nombre text)` | Sesión: admin · interaccion | `carnes` · por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `carnes`, `config` · por otras: `sesiones_actividad` | `_contexto`, `_error` | usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `agregar_extra(p_token text, p_cat text, p_nombre text, p_precio numeric)` | Sesión: admin · interaccion | por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `config` · por otras: `sesiones_actividad` | `_contexto`, `_error`, `_precio_ok` | usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `agregar_gasto(p_token text, p_id text, p_concepto text, p_monto numeric)` | Sesión: admin · interaccion | `gastos` · por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `gastos` · por otras: `sesiones_actividad` | `_contexto`, `_error`, `_fecha`, `_hora` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `ajustar_bebida(p_token text, p_id text, p_delta integer)` | Sesión: admin · interaccion | por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `bebidas` · por otras: `sesiones_actividad` | `_contexto`, `_error` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `alternar_oculto(p_token text, p_clave text)` | Sesión: admin · interaccion | por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `config` · por otras: `sesiones_actividad` | `_contexto`, `_error` | usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `anular_cobro(p_token text, p_id text, p_motivo text)` | Sesión: admin · interaccion | `cobros` · por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `cobros`, `tickets` · por otras: `bitacora`, `sesiones_actividad` | `_contexto`, `_error`, `_log` | candado `tequeria:corte:` por sucursal; recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `archivar_tickets(p_token text, p_ids text[])` | Sesión: cocinero, admin · interaccion | `tickets` · por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `tickets` · por otras: `sesiones_actividad` | `_contexto`, `_error` | recibe ids del cliente (p_ids); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `cambiar_pin(p_token text, p_pin_actual text, p_pin_nuevo text)` | Sesión: cualquier rol · sesion | `usuarios` · por otras: `cuentas`, `dispositivos`, `intentos_dispositivo`, `intentos_operador`, `sesiones`, `sesiones_actividad`, `sucursales` | `sesiones`, `usuarios` · por otras: `bitacora`, `intentos_dispositivo`, `intentos_operador`, `sesiones_actividad` | `_ahora`, `_contexto`, `_espera_equipo`, `_espera_operador`, `_fallo_equipo`, `_fallo_operador`, `_hash_pin`, `_limpiar_operador`, `_log`, `_pin_debil`, `_pin_formato_ok`, `_pin_ok` | verifica o guarda PIN; usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `cobrar(p_token text, p_id text, p_tickets text[], p_metodo text, p_recibido numeric, p_propina numeric, p_liberar_mesa boolean)` | Sesión: mesero, admin · interaccion | `cobros`, `mesas`, `tickets` · por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `cobros`, `mesas`, `tickets` · por otras: `bitacora`, `sesiones_actividad` | `_contexto`, `_error`, `_fecha`, `_hora`, `_log` | candado `tequeria:cobro:` por id; candado `tequeria:corte:` (compartido) por sucursal; devuelve lo ya guardado si se repite el id (solo de su sucursal); recibe ids del cliente (p_id, p_tickets); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `crear_usuario(p_token text, p_admin_pin text, p_nombre text, p_pin text, p_rol text)` | Sesión: admin · interaccion | por otras: `cuentas`, `dispositivos`, `intentos`, `intentos_dispositivo`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `usuarios` · por otras: `bitacora`, `intentos`, `intentos_dispositivo`, `sesiones_actividad` | `_ahora`, `_contexto`, `_hash_pin`, `_log`, `_pin_debil`, `_pin_formato_ok`, `_verificar_admin` | PIN de administrador de su sucursal; verifica o guarda PIN; usa `now()` (vía `_ahora`); contadores de intentos `ip:`, `s:` (vía `_verificar_admin`) | Sucursal de la sesión operativa |
| `desbloquear(p_token text, p_pin text)` | Sesión: cualquier rol · desbloqueo | `usuarios` · por otras: `cuentas`, `dispositivos`, `intentos_dispositivo`, `intentos_operador`, `sesiones`, `sesiones_actividad`, `sucursales` | por otras: `intentos`, `intentos_dispositivo`, `intentos_operador`, `sesiones_actividad` | `_contexto`, `_espera_equipo`, `_espera_operador`, `_fallo`, `_fallo_equipo`, `_fallo_operador`, `_ip`, `_limpiar_operador`, `_marcar_interaccion`, `_pin_ok` | verifica o guarda PIN; contadores de intentos `ip:`; usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `eliminar_bebida(p_token text, p_id text)` | Sesión: admin · interaccion | `bebidas` · por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `bebidas` · por otras: `bitacora`, `sesiones_actividad` | `_contexto`, `_log` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `eliminar_carne(p_token text, p_id text)` | Sesión: admin · interaccion | `carnes` · por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `carnes` · por otras: `bitacora`, `sesiones_actividad` | `_contexto`, `_log` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `eliminar_extra(p_token text, p_id text)` | Sesión: admin · interaccion | por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `config` · por otras: `sesiones_actividad` | `_contexto` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `eliminar_gasto(p_token text, p_id text)` | Sesión: admin · interaccion | `gastos` · por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `gastos` · por otras: `bitacora`, `sesiones_actividad` | `_contexto`, `_error`, `_log` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `eliminar_usuario(p_token text, p_admin_pin text, p_id text)` | Sesión: admin · interaccion | `sesiones`, `usuarios` · por otras: `cuentas`, `dispositivos`, `intentos`, `intentos_dispositivo`, `sesiones_actividad`, `sucursales` | `cocina_sesion`, `usuarios` · por otras: `bitacora`, `intentos`, `intentos_dispositivo`, `sesiones_actividad` | `_contexto`, `_log`, `_verificar_admin` | PIN de administrador de su sucursal; recibe ids del cliente (p_id); usa `now()` (vía `_ahora`); verifica o guarda PIN (vía `_verificar_admin`); contadores de intentos `ip:`, `s:` (vía `_verificar_admin`) | Sucursal de la sesión operativa |
| `enviar_comanda(p_token text, p_ticket jsonb)` | Sesión: mesero, admin · interaccion | `bebidas`, `mesas`, `tickets` · por otras: `carnes`, `cobros`, `cocina_hechos`, `config`, `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `bebidas`, `mesas`, `tickets` · por otras: `folios`, `sesiones_actividad` | `_contexto`, `_error`, `_fecha`, `_hora`, `_siguiente_folio`, `_ticket_json`, `_total_items`, `_valorar_items` | candado `tequeria:ticket:` por id; devuelve lo ya guardado si se repite el id (solo de su sucursal); recibe ids del cliente (p_ticket); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `estado(p_token text, p_partes text[])` | Sesión: cualquier rol · lectura | `bebidas`, `carnes`, `config`, `cortes`, `gastos`, `mesas`, `tickets`, `usuarios` · por otras: `cobros`, `cocina_hechos`, `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales` | por otras: `sesiones_actividad` | `_contexto`, `_mesa_json`, `_resumen`, `_ticket_json` | usa `now()` | Sucursal de la sesión operativa |
| `fijar_ajuste(p_token text, p_clave text, p_valor jsonb)` | Sesión: admin · interaccion | por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `config` · por otras: `bitacora`, `sesiones_actividad` | `_contexto`, `_error`, `_log` | usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `fijar_precio(p_token text, p_clave text, p_precio numeric)` | Sesión: admin · interaccion | por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `config` · por otras: `bitacora`, `sesiones_actividad` | `_contexto`, `_error`, `_log`, `_precio_ok` | usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `fijar_precio_extra(p_token text, p_id text, p_precio numeric)` | Sesión: admin · interaccion | por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `config` · por otras: `bitacora`, `sesiones_actividad` | `_contexto`, `_log`, `_precio_ok` | recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `guardar_borrador_mesa(p_token text, p_mesa_id integer, p_pedido jsonb, p_version integer)` | Sesión: mesero, admin · interaccion | `mesas` · por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `tickets`, `usuarios` | `mesas` · por otras: `sesiones_actividad` | `_contexto`, `_error`, `_hora`, `_mesa_json` | recibe ids del cliente (p_mesa_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `hacer_corte(p_token text, p_admin_pin text)` | Sesión: cocinero, admin · interaccion | `cobros`, `sucursales`, `tickets` · por otras: `cuentas`, `dispositivos`, `gastos`, `intentos`, `intentos_dispositivo`, `sesiones`, `sesiones_actividad`, `usuarios` | `cobros`, `cortes`, `gastos`, `tickets` · por otras: `bitacora`, `intentos`, `intentos_dispositivo`, `sesiones_actividad` | `_contexto`, `_fecha`, `_hora`, `_log`, `_resumen`, `_verificar_admin` | candado `tequeria:corte:` por sucursal; PIN de administrador de su sucursal; usa `now()`; verifica o guarda PIN (vía `_verificar_admin`); contadores de intentos `ip:`, `s:` (vía `_verificar_admin`) | Sucursal de la sesión operativa |
| `latido_cocina(p_token text)` | Sesión: cualquier rol · latido | `config` · por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `cocina_sesion` · por otras: `sesiones_actividad` | `_ahora`, `_contexto` | usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `liberar_cocina(p_token text)` | Sesión: cualquier rol · interaccion | por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `cocina_sesion` · por otras: `sesiones_actividad` | `_contexto` | usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `liberar_mesa(p_token text, p_mesa_id integer)` | Sesión: mesero, admin · interaccion | `mesas`, `tickets` · por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `mesas` · por otras: `bitacora`, `sesiones_actividad` | `_contexto`, `_error`, `_log`, `_mesa_json` | recibe ids del cliente (p_mesa_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `login(p_id text, p_pin text, p_dispositivo text)` | Equipo vinculado, sin operador | `cocina_sesion`, `intentos`, `intentos_dispositivo`, `sesiones`, `sesiones_actividad`, `usuarios` · por otras: `cuentas`, `dispositivos`, `intentos_operador`, `sucursales` | `cocina_sesion`, `intentos`, `intentos_dispositivo`, `sesiones`, `sesiones_actividad`, `usuarios` · por otras: `intentos_operador` | `_ahora`, `_dispositivo`, `_espera`, `_espera_equipo`, `_espera_operador`, `_fallo`, `_fallo_equipo`, `_fallo_operador`, `_hash_pin`, `_ip`, `_limpiar_operador`, `_marcar_interaccion`, `_pin_debil`, `_pin_formato_ok`, `_pin_ok` | verifica o guarda PIN; contadores de intentos `ip:`; recibe ids del cliente (p_id); usa `now()` (vía `_ahora`) | Sucursal del dispositivo vinculado |
| `logout(p_token text)` | Sesión: cualquier rol · salida | por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `cocina_sesion`, `sesiones` · por otras: `sesiones_actividad` | `_contexto` | usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `marcar_hecho(p_token text, p_ticket text, p_linea text, p_hecho boolean)` | Sesión: cocinero, admin · interaccion | `tickets` · por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `cocina_hechos` · por otras: `sesiones_actividad` | `_contexto`, `_error` | usa `now()`; recibe ids del cliente (p_ticket) | Sucursal de la sesión operativa |
| `marcar_recibido(p_token text, p_ids text[])` | Sesión: cocinero, admin · automatica | `tickets` · por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `tickets` · por otras: `sesiones_actividad` | `_contexto`, `_error` | usa `now()`; recibe ids del cliente (p_ids) | Sucursal de la sesión operativa |
| `mover_tickets(p_token text, p_tickets jsonb, p_hacia text)` | Sesión: cocinero, admin · interaccion | `tickets` · por otras: `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `tickets` · por otras: `sesiones_actividad` | `_contexto`, `_error` | usa `now()`; recibe ids del cliente (p_tickets) | Sucursal de la sesión operativa |
| `no_cobrar(p_token text, p_admin_pin text, p_tickets text[], p_motivo text, p_liberar_mesa boolean)` | Sesión: mesero, admin · interaccion | `mesas`, `tickets` · por otras: `cuentas`, `dispositivos`, `intentos`, `intentos_dispositivo`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `mesas`, `tickets` · por otras: `bitacora`, `intentos`, `intentos_dispositivo`, `sesiones_actividad` | `_contexto`, `_error`, `_log`, `_verificar_admin` | candado `tequeria:corte:` (compartido) por sucursal; PIN de administrador de su sucursal; recibe ids del cliente (p_tickets); usa `now()` (vía `_ahora`); verifica o guarda PIN (vía `_verificar_admin`); contadores de intentos `ip:`, `s:` (vía `_verificar_admin`) | Sucursal de la sesión operativa |
| `reenviar_cocina(p_token text, p_id text, p_mesa_id integer)` | Sesión: mesero, admin · interaccion | `mesas`, `tickets` · por otras: `cobros`, `cocina_hechos`, `cuentas`, `dispositivos`, `sesiones`, `sesiones_actividad`, `sucursales`, `usuarios` | `tickets` · por otras: `folios`, `sesiones_actividad` | `_contexto`, `_error`, `_fecha`, `_hora`, `_siguiente_folio`, `_ticket_json` | candado `tequeria:ticket:` por id; devuelve lo ya guardado si se repite el id (solo de su sucursal); recibe ids del cliente (p_id, p_mesa_id); usa `now()` (vía `_ahora`) | Sucursal de la sesión operativa |
| `restablecer_acceso(p_token text, p_admin_pin text, p_id text)` | Sesión: admin · interaccion | `usuarios` · por otras: `cuentas`, `dispositivos`, `intentos`, `intentos_dispositivo`, `intentos_operador`, `sesiones`, `sesiones_actividad`, `sucursales` | por otras: `bitacora`, `intentos`, `intentos_dispositivo`, `intentos_operador`, `sesiones_actividad` | `_contexto`, `_espera_operador`, `_limpiar_operador`, `_log`, `_verificar_admin` | PIN de administrador de su sucursal; recibe ids del cliente (p_id); usa `now()` (vía `_ahora`); verifica o guarda PIN (vía `_verificar_admin`); contadores de intentos `ip:`, `s:` (vía `_verificar_admin`) | Sucursal de la sesión operativa |
| `restablecer_pin(p_token text, p_admin_pin text, p_id text, p_pin_nuevo text)` | Sesión: admin · interaccion | `usuarios` · por otras: `cuentas`, `dispositivos`, `intentos`, `intentos_dispositivo`, `sesiones`, `sesiones_actividad`, `sucursales` | `sesiones`, `usuarios` · por otras: `bitacora`, `intentos`, `intentos_dispositivo`, `intentos_operador`, `sesiones_actividad` | `_ahora`, `_contexto`, `_hash_pin`, `_limpiar_operador`, `_log`, `_pin_debil`, `_pin_formato_ok`, `_verificar_admin` | PIN de administrador de su sucursal; verifica o guarda PIN; recibe ids del cliente (p_id); usa `now()` (vía `_ahora`); contadores de intentos `ip:`, `s:` (vía `_verificar_admin`) | Sucursal de la sesión operativa |
| `usuarios_login()` | Equipo vinculado, sin operador | `config`, `usuarios` · por otras: `cuentas`, `dispositivos`, `sucursales` | — | `_dispositivo` | — | Sucursal del dispositivo vinculado |

## Funciones internas

| Función | Lee | Escribe | Llama a | Puntos a cuidar | Contexto que deberá recibir |
|---|---|---|---|---|---|
| `_ahora()` | — | — | — | usa `now()` | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_ahora_local(p_sucursal uuid)` | `sucursales` | — | `_ahora` | usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama |
| `_avisar_cambio()` | — | — | — | aviso en tiempo real (canal `tequeria`, público) | Sucursal de la fila (canal privado por sucursal) |
| `_contexto(p_token text, p_roles text[], p_tipo text, OUT sucursal_id uuid, OUT cuenta_id uuid, OUT dispositivo_id uuid, OUT monitor_cocina boolean, OUT sid uuid, OUT uid text, OUT nombre text, OUT rol text, OUT cambiar_pin boolean, OUT solo_cocina boolean)` | `sesiones`, `sesiones_actividad`, `usuarios` · por otras: `cuentas`, `dispositivos`, `sucursales` | por otras: `sesiones_actividad` | `_ahora`, `_dispositivo`, `_error`, `_marcar_interaccion` | usa `now()` (vía `_ahora`) | Es el validador de la operación: equipo y sesión del operador de esa sucursal y ese equipo (revisado) |
| `_cuenta_con_propietario()` | `cuentas`, `membresias` | `cuentas` | — | — | Cuenta de la fila: invariante de propietario (MODELO.md §3.0) (revisado) |
| `_dispositivo(OUT dispositivo_id uuid, OUT sucursal_id uuid, OUT cuenta_id uuid, OUT monitor_cocina boolean)` | `cuentas`, `dispositivos`, `sucursales` | — | `_error` | — | Es el validador del equipo: de aquí sale la sucursal (auth.uid() → dispositivo sin revocar) (revisado) |
| `_error(p_codigo text, p_mensaje text)` | — | — | — | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_espera(p_clave text)` | `intentos` | — | `_ahora` | usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama |
| `_espera_equipo(p_dispositivo uuid)` | `intentos_dispositivo` | — | `_ahora` | usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama |
| `_espera_operador(p_sucursal uuid, p_usuario text)` | `intentos_operador` | — | `_ahora` | usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama |
| `_fallo(p_clave text, p_umbral integer)` | — | `intentos` | `_ahora` | usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama |
| `_fallo_equipo(p_sucursal uuid, p_dispositivo uuid)` | `dispositivos` · por otras: `intentos_dispositivo` | `intentos_dispositivo` | `_ahora`, `_espera_equipo` | usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama |
| `_fallo_escalado(p_clave text)` | `intentos` | `intentos` | `_ahora`, `_minutos_bloqueo` | usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama |
| `_fallo_operador(p_sucursal uuid, p_usuario text)` | `intentos_operador` | `intentos_operador` | `_ahora`, `_minutos_bloqueo` | usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama |
| `_fecha(p_sucursal uuid)` | por otras: `sucursales` | — | `_ahora_local` | usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama (indirecto) |
| `_hash_pin(p_pin text)` | — | — | — | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_hora(p_sucursal uuid)` | por otras: `sucursales` | — | `_ahora_local` | usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama (indirecto) |
| `_ip()` | — | — | — | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_limpiar_intentos(p_clave text)` | — | `intentos` | — | — | Recibe la sucursal de quien la llama |
| `_limpiar_operador(p_sucursal uuid, p_usuario text)` | — | `intentos_operador` | — | — | Recibe la sucursal de quien la llama |
| `_log(p_sucursal uuid, p_uid text, p_nombre text, p_accion text, p_detalle jsonb)` | — | `bitacora` | — | — | Recibe la sucursal de quien la llama |
| `_marcar_interaccion(p_sesion uuid)` | — | `sesiones_actividad` | `_ahora` | usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama |
| `_mesa_json(m mesas)` | `tickets` | — | — | — | Recibe la sucursal de quien la llama |
| `_minutos_bloqueo(p_nivel integer)` | — | — | — | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_pin_debil(p_pin text)` | — | — | — | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_pin_formato_ok(p_pin text)` | — | — | — | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_pin_ok(p_hash text, p_pin text, p_id text)` | — | — | — | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_precio_ok(p numeric)` | — | — | `_error` | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_resolver_item(p_sucursal uuid, p_key text, p_empaque boolean)` | `bebidas`, `carnes`, `config` | — | — | — | Recibe la sucursal de quien la llama |
| `_resumen(p_sucursal uuid, p_corte text)` | `cobros`, `gastos`, `tickets` | — | — | — | Recibe la sucursal de quien la llama |
| `_siguiente_folio(p_sucursal uuid, p_periodo text)` | — | `folios` | — | — | Recibe la sucursal de quien la llama |
| `_ticket_json(t tickets, p_domicilio boolean)` | `cobros`, `cocina_hechos` | — | — | — | Recibe la sucursal de quien la llama |
| `_total_items(p_items jsonb)` | — | — | — | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_usa_cobro_id_heredado(p_src text)` | — | — | — | — | Ninguno (no toca datos, ni directa ni indirectamente) |
| `_valorar_items(p_sucursal uuid, p_items jsonb, p_empaque boolean)` | por otras: `bebidas`, `carnes`, `config` | — | `_error`, `_resolver_item` | — | Recibe la sucursal de quien la llama (indirecto) |
| `_verificar_admin(p_sucursal uuid, p_dispositivo uuid, p_pin text, p_sid uuid, p_uid text)` | `usuarios` · por otras: `dispositivos`, `intentos`, `intentos_dispositivo` | por otras: `intentos`, `intentos_dispositivo` | `_espera`, `_espera_equipo`, `_fallo`, `_fallo_equipo`, `_fallo_escalado`, `_ip`, `_limpiar_intentos`, `_pin_ok` | verifica o guarda PIN; contadores de intentos `ip:`, `s:`; usa `now()` (vía `_ahora`) | Recibe la sucursal de quien la llama |
| `crear_admin_inicial(p_nombre text, p_pin text, p_sucursal uuid)` | `sucursales`, `usuarios` | `usuarios` · por otras: `bitacora` | `_ahora`, `_hash_pin`, `_log`, `_pin_debil`, `_pin_formato_ok` | verifica o guarda PIN; usa `now()` (vía `_ahora`) | Se reemplaza por el registro del dueño |

## Disparadores

| Tabla | Disparador | Definición |
|---|---|---|
| `bebidas` | `avisar_cambio` | `AFTER INSERT OR DELETE OR UPDATE ON public.bebidas FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |
| `carnes` | `avisar_cambio` | `AFTER INSERT OR DELETE OR UPDATE ON public.carnes FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |
| `cobros` | `avisar_cambio` | `AFTER INSERT OR UPDATE ON public.cobros FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |
| `cocina_hechos` | `avisar_cambio` | `AFTER INSERT OR UPDATE ON public.cocina_hechos FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |
| `config` | `avisar_cambio` | `AFTER INSERT OR DELETE OR UPDATE ON public.config FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |
| `cortes` | `avisar_cambio` | `AFTER INSERT OR DELETE OR UPDATE ON public.cortes FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |
| `cuentas` | `cuenta_con_propietario` | `CREATE CONSTRAINT TRIGGER cuenta_con_propietario AFTER INSERT OR UPDATE OF estado ON public.cuentas DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION _cuenta_con_propietario()` |
| `gastos` | `avisar_cambio` | `AFTER INSERT OR DELETE OR UPDATE ON public.gastos FOR EACH STATEMENT EXECUTE FUNCTION _avisar_cambio()` |
| `membresias` | `cuenta_con_propietario` | `CREATE CONSTRAINT TRIGGER cuenta_con_propietario AFTER DELETE OR UPDATE ON public.membresias DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION _cuenta_con_propietario()` |
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

Funciones que llama el navegador (37): `actualizar_bebida`, `actualizar_carne`, `agregar_bebida`, `agregar_carne`, `agregar_extra`, `agregar_gasto`, `ajustar_bebida`, `alternar_oculto`, `anular_cobro`, `archivar_tickets`, `cambiar_pin`, `cobrar`, `crear_usuario`, `eliminar_bebida`, `eliminar_carne`, `eliminar_extra`, `eliminar_gasto`, `eliminar_usuario`, `enviar_comanda`, `estado`, `fijar_ajuste`, `fijar_precio`, `fijar_precio_extra`, `guardar_borrador_mesa`, `hacer_corte`, `latido_cocina`, `liberar_cocina`, `liberar_mesa`, `login`, `logout`, `marcar_hecho`, `marcar_recibido`, `mover_tickets`, `no_cobrar`, `reenviar_cocina`, `restablecer_pin`, `usuarios_login`.

## Pruebas con PIN de 4 o 5 dígitos

La política nueva exige PIN de 6 a 8 dígitos. Estas pruebas usan textos de 4 o 5 dígitos (casi siempre PIN) y
deberán adaptarse cuando se implemente, además de agregar casos de rechazo y transición.

| Archivo | Apariciones |
|---|---|
| `tests/dominio.test.js` | 8 |
| `tests/e2e/comandas.spec.js` | 10 |
| `tests/localStore.test.js` | 32 |
| `tests/sql/esquema.test.js` | 20 |
| `tests/sql/reloj.test.js` | 8 |
| `tests/sql/remoto.test.js` | 3 |
