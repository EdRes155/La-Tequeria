-- Huella de datos para ensayar la migración multinegocio (docs/multinegocio/MIGRACION.md §4.4).
--
-- Antes de ejecutarla, en la misma sesión:
--   set huella.version = 'origen';   -- 'origen': esquema de hoy · 'destino': ya migrado
--   set huella.sal = '…';            -- texto aleatorio de 16 caracteres o más, el MISMO antes y después
-- Solo lee: se puede correr en «begin transaction read only; … rollback;».
-- Para comparar dos huellas: node scripts/huella.mjs comparar antes.json despues.json
--
-- Devuelve:
--   resumen    agregados (conteos, sumas, máximos y referencias rotas): sirven para leer de un vistazo,
--              pero no bastan (un intercambio de existencias entre dos bebidas conserva la suma).
--   entidades  por cada fila de cada tabla, su llave y una firma de su contenido. Detecta filas que
--              faltan, sobran o cambiaron.
--
-- Contenido que se firma: la fila completa, sin las columnas que agrega la migración (sucursal_id,
-- folio_periodo, estado_cobro…). El estado de cobro se compara por su significado: en origen se deduce
-- de cobro_id (nulo, «previo», «no_cobrado» o un id); en destino se lee de estado_cobro. Se firma la
-- pareja (estado de cobro, id del cobro real), así que un «previo» que pasa a cobro_id nulo con
-- estado_cobro «previo» conserva su firma, y uno que acaba como «pendiente» no.
--
-- Datos personales (nombres, PIN, teléfonos, direcciones): solo entran en firmas md5 con sal, nunca
-- en claro. Las llaves de usuarios también se firman, porque las antiguas podían ser nombres.
with
p as (
  select current_setting('huella.version') as version, current_setting('huella.sal') as sal
),
par as (
  -- Si los parámetros no son válidos, falla con este texto (no se puede convertir a booleano). El
  -- left(version, 0) vacío evita que PostgreSQL evalúe el texto constante al planificar la consulta.
  select version, sal from p
   where case when version in ('origen', 'destino') and length(sal) >= 16 then true
              else (left(version, 0) || 'huella: huella.version debe ser origen o destino, y huella.sal tener 16 caracteres o más')::boolean end
),
nuevas as (
  select array['sucursal_id', 'cuenta_id', 'folio_periodo', 'estado_cobro', 'politica_pin', 'pin_cambiado_en', 'version_pin', 'auth_user_id'] as cols
),
t as (
  select x.id, x.cobro_id, x.corte_id, x.mesa_id, x.total, x.reenvio, x.folio, x.archivado_cocina, to_jsonb(x) as j,
         case par.version
           when 'origen' then case when x.cobro_id is null then 'pendiente'
                                   when x.cobro_id in ('previo', 'no_cobrado') then x.cobro_id
                                   else 'cobrado' end
           else to_jsonb(x) ->> 'estado_cobro'
         end as estado
    from public.tickets x, par
),
filas as (
  select 'config' e, 'unica' k, to_jsonb(x) - 'id' - n.cols f from public.config x, nuevas n
  union all select 'cocina_sesion', 'unica', to_jsonb(x) - 'id' - n.cols from public.cocina_sesion x, nuevas n
  union all select 'carnes', x.id, to_jsonb(x) - n.cols from public.carnes x, nuevas n
  union all select 'bebidas', x.id, to_jsonb(x) - n.cols from public.bebidas x, nuevas n
  union all select 'usuarios', 'u:' || left(md5(par.sal || x.id), 16), to_jsonb(x) - n.cols from public.usuarios x, nuevas n, par
  union all select 'mesas', x.id::text, to_jsonb(x) - n.cols from public.mesas x, nuevas n
  union all select 'tickets', t.id, (t.j - n.cols - 'cobro_id')
              || jsonb_build_object('estado_cobro', t.estado, 'cobro_real', case when t.estado = 'cobrado' then t.cobro_id end)
              from t, nuevas n
  union all select 'cobros', x.id, to_jsonb(x) - n.cols from public.cobros x, nuevas n
  union all select 'cortes', x.id, to_jsonb(x) - n.cols from public.cortes x, nuevas n
  union all select 'gastos', x.id, to_jsonb(x) - n.cols from public.gastos x, nuevas n
  union all select 'cocina_hechos', x.ticket_id || '|' || x.linea, to_jsonb(x) - n.cols from public.cocina_hechos x, nuevas n
  union all select 'bitacora', x.id::text, to_jsonb(x) - n.cols from public.bitacora x, nuevas n
),
entidades as (
  select e, jsonb_object_agg(k, left(md5(par.sal || f::text), 16)) firmas from filas, par group by e
)
select jsonb_build_object(
  'version', par.version,
  'sal', left(md5('verificacion:' || par.sal), 8),
  'resumen', jsonb_build_object(
    'tablas', jsonb_build_object(
      'config', (select count(*) from public.config),
      'carnes', (select count(*) from public.carnes),
      'bebidas', (select count(*) from public.bebidas),
      'usuarios', (select jsonb_object_agg(rol, n) from (select rol, count(*) n from public.usuarios group by rol) x),
      'mesas', (select jsonb_object_agg(coalesce(estado, 'libre'), n) from (select estado, count(*) n from public.mesas group by estado) x),
      'tickets', (select count(*) from t),
      'cobros', (select count(*) from public.cobros),
      'cortes', (select count(*) from public.cortes),
      'gastos', (select count(*) from public.gastos),
      'cocina_hechos', (select count(*) from public.cocina_hechos),
      'bitacora', (select count(*) from public.bitacora)
    ),
    'ventas', jsonb_build_object(
      'tickets_sin_reenvio', (select count(*) from t where t.reenvio is not true),
      'total_vendido', (select coalesce(sum(total), 0) from t where t.reenvio is not true),
      'total_periodo_abierto', (select coalesce(sum(total), 0) from t where t.reenvio is not true and t.corte_id is null),
      'por_estado_cobro', (select jsonb_object_agg(estado, n) from (
          select coalesce(estado, '¿sin estado?') estado, count(*) n from t where t.reenvio is not true group by 1) x),
      'folio_maximo', (select max(folio) from t),
      'folios_repetidos', (select count(*) from (select folio from t group by folio having count(*) > 1) x)
    ),
    'cobros', jsonb_build_object(
      'cobrado_valido', (select coalesce(sum(total + propina), 0) from public.cobros where not anulado),
      'anulados', (select count(*) from public.cobros where anulado),
      'por_metodo', (select jsonb_object_agg(metodo, s) from (select metodo, sum(total + propina) s from public.cobros where not anulado group by 1) x)
    ),
    'cortes', jsonb_build_object(
      'total', (select coalesce(sum(total), 0) from public.cortes),
      'gastos', (select coalesce(sum(gastos), 0) from public.cortes),
      'cobrado', (select coalesce(sum(cobrado), 0) from public.cortes)
    ),
    'inventario', jsonb_build_object(
      'existencias', (select coalesce(sum(cantidad), 0) from public.bebidas),
      'gastos_periodo_abierto', (select coalesce(sum(monto), 0) from public.gastos where corte_id is null)
    ),
    'abierto', jsonb_build_object(
      'mesas_ocupadas_o_borrador', (select count(*) from public.mesas where estado in ('ocupada', 'borrador')),
      'en_cocina', (select count(*) from t where t.archivado_cocina is not true),
      'por_cobrar', (select count(*) from t where t.reenvio is not true and t.estado = 'pendiente'),
      'sesiones_vigentes', (select count(*) from public.sesiones s where not s.revocada
                              and coalesce(to_jsonb(s) ->> 'vence_absoluta', to_jsonb(s) ->> 'expira')::timestamptz > now())
    ),
    'referencias_rotas', jsonb_build_object(
      'tickets_sin_estado', (select count(*) from t where t.estado is null
                               or t.estado not in ('pendiente', 'cobrado', 'previo', 'no_cobrado')),
      'tickets_cobro', (select count(*) from t where t.estado = 'cobrado'
                          and not exists (select 1 from public.cobros c where c.id = t.cobro_id)),
      'tickets_mesa', (select count(*) from t where t.mesa_id is not null
                         and not exists (select 1 from public.mesas m where m.id = t.mesa_id)),
      'tickets_corte', (select count(*) from t where t.corte_id is not null
                          and not exists (select 1 from public.cortes k where k.id = t.corte_id)),
      'cobros_corte', (select count(*) from public.cobros c where c.corte_id is not null
                         and not exists (select 1 from public.cortes k where k.id = c.corte_id)),
      'gastos_corte', (select count(*) from public.gastos g where g.corte_id is not null
                         and not exists (select 1 from public.cortes k where k.id = g.corte_id)),
      'hechos_ticket', (select count(*) from public.cocina_hechos h
                          where not exists (select 1 from public.tickets x where x.id = h.ticket_id)),
      'sesiones_usuario', (select count(*) from public.sesiones s
                             where not exists (select 1 from public.usuarios u where u.id = s.usuario_id))
    )
  ),
  -- Solo en destino: filas que quedaron sin sucursal (debe ser 0 en todas). En la bitácora no cuentan las
  -- acciones de cuenta (invitar o quitar miembros, activar la cuenta…), que llevan cuenta y no sucursal.
  'sin_sucursal', case when par.version = 'destino' then (
    select jsonb_object_agg(e, n) from (
      select e, count(*) filter (where f->>'sucursal_id' is null) n from (
        select 'config' e, to_jsonb(x) f from public.config x
        union all select 'carnes', to_jsonb(x) from public.carnes x
        union all select 'bebidas', to_jsonb(x) from public.bebidas x
        union all select 'usuarios', to_jsonb(x) from public.usuarios x
        union all select 'mesas', to_jsonb(x) from public.mesas x
        union all select 'tickets', j from t
        union all select 'cobros', to_jsonb(x) from public.cobros x
        union all select 'cortes', to_jsonb(x) from public.cortes x
        union all select 'gastos', to_jsonb(x) from public.gastos x
        union all select 'cocina_hechos', to_jsonb(x) from public.cocina_hechos x
        union all select 'sesiones', to_jsonb(x) from public.sesiones x
        union all select 'bitacora', to_jsonb(x) from public.bitacora x
                   where to_jsonb(x) ->> 'sucursal_id' is not null or to_jsonb(x) ->> 'cuenta_id' is null
      ) z group by e) y) end,
  'entidades', (select jsonb_object_agg(e, firmas) from entidades)
) as huella
from par;
