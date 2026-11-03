-- Huella de datos para ensayar la migración multinegocio (docs/multinegocio/MIGRACION.md).
-- Solo lectura y solo agregados: conteos, sumas, máximos y referencias rotas. No devuelve nombres,
-- PIN, teléfonos ni direcciones, así que se puede correr sobre producción o sobre una copia.
-- Se compara la huella antes y después de migrar; las diferencias esperadas están en MIGRACION.md.
select jsonb_build_object(
  'tablas', jsonb_build_object(
    'config', (select count(*) from public.config),
    'carnes', (select count(*) from public.carnes),
    'bebidas', (select count(*) from public.bebidas),
    'usuarios', (select jsonb_object_agg(rol, n) from (select rol, count(*) n from public.usuarios group by rol) x),
    'mesas', (select jsonb_object_agg(coalesce(estado, 'libre'), n) from (select estado, count(*) n from public.mesas group by estado) x),
    'tickets', (select count(*) from public.tickets),
    'cobros', (select count(*) from public.cobros),
    'cortes', (select count(*) from public.cortes),
    'gastos', (select count(*) from public.gastos),
    'cocina_hechos', (select count(*) from public.cocina_hechos),
    'bitacora', (select count(*) from public.bitacora)
  ),
  'ventas', jsonb_build_object(
    'tickets_sin_reenvio', (select count(*) from public.tickets where reenvio is not true),
    'total_vendido', (select coalesce(sum(total), 0) from public.tickets where reenvio is not true),
    'total_periodo_abierto', (select coalesce(sum(total), 0) from public.tickets where reenvio is not true and corte_id is null),
    'por_estado_cobro', (select jsonb_object_agg(e, n) from (
        select case when cobro_id is null then 'pendiente' when cobro_id in ('previo', 'no_cobrado') then cobro_id else 'cobrado' end e,
               count(*) n
          from public.tickets where reenvio is not true group by 1) x),
    'folio_maximo', (select max(folio) from public.tickets),
    'folios_repetidos', (select count(*) from (select folio from public.tickets group by folio having count(*) > 1) x)
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
    'en_cocina', (select count(*) from public.tickets where archivado_cocina is not true),
    'por_cobrar', (select count(*) from public.tickets where reenvio is not true and cobro_id is null),
    'sesiones_vigentes', (select count(*) from public.sesiones where not revocada and expira > now())
  ),
  'referencias_rotas', jsonb_build_object(
    'tickets_cobro', (select count(*) from public.tickets t where t.cobro_id is not null and t.cobro_id not in ('previo', 'no_cobrado')
                       and not exists (select 1 from public.cobros c where c.id = t.cobro_id)),
    'tickets_mesa', (select count(*) from public.tickets t where t.mesa_id is not null
                       and not exists (select 1 from public.mesas m where m.id = t.mesa_id)),
    'tickets_corte', (select count(*) from public.tickets t where t.corte_id is not null
                       and not exists (select 1 from public.cortes k where k.id = t.corte_id)),
    'cobros_corte', (select count(*) from public.cobros c where c.corte_id is not null
                       and not exists (select 1 from public.cortes k where k.id = c.corte_id)),
    'gastos_corte', (select count(*) from public.gastos g where g.corte_id is not null
                       and not exists (select 1 from public.cortes k where k.id = g.corte_id)),
    'hechos_ticket', (select count(*) from public.cocina_hechos h
                       where not exists (select 1 from public.tickets t where t.id = h.ticket_id)),
    'sesiones_usuario', (select count(*) from public.sesiones s
                       where not exists (select 1 from public.usuarios u where u.id = s.usuario_id))
  )
) as huella;
