-- La Tequería · modo de cocina (impresora o monitor) y ajustes del negocio (aditiva).
-- Equivale a las partes nuevas de supabase-schema.sql; se puede ejecutar más de una vez.
begin;


-- Ajustes del negocio que cambia el administrador (modo de la cocina, etc.)
alter table public.config add column if not exists ajustes jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------
--  API: lectura del estado según el rol
-- ---------------------------------------------------------------------
create or replace function public.estado(p_token text, p_partes text[] default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  s record; cfg public.config; r jsonb;
  todo boolean := p_partes is null;
  caja boolean;
begin
  select * into s from public._sesion(p_token);
  caja := s.rol in ('cocinero', 'admin');
  select * into cfg from public.config where id = 1;
  r := jsonb_build_object('yo', jsonb_build_object('id', s.uid, 'nombre', s.nombre, 'rol', s.rol, 'cambiarPin', s.cambiar_pin),
                          'servidor', now());

  if todo or 'config' = any(p_partes) then
    r := r || jsonb_build_object('nombreNegocio', coalesce(cfg.nombre_negocio, 'La Tequería'),
      'precios', coalesce(cfg.precios, '{}'::jsonb), 'extras', coalesce(cfg.extras, '[]'::jsonb),
      'ocultos', coalesce(cfg.ocultos, '[]'::jsonb), 'ajustes', coalesce(cfg.ajustes, '{}'::jsonb));
  end if;
  if todo or 'carnes' = any(p_partes) then
    r := r || jsonb_build_object('carnes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre,
      'activo', activo is not false) order by orden, nombre) from public.carnes), '[]'::jsonb));
  end if;
  if todo or 'bebidas' = any(p_partes) then
    r := r || jsonb_build_object('bebidas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre,
      'cantidad', coalesce(cantidad, 0), 'activo', activo is not false, 'precio', coalesce(precio, 0)) order by nombre)
      from public.bebidas), '[]'::jsonb));
  end if;
  if todo or 'usuarios' = any(p_partes) then
    r := r || jsonb_build_object('usuarios', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre,
      'rol', rol) order by nombre) from public.usuarios), '[]'::jsonb));
  end if;
  if todo or 'mesas' = any(p_partes) then
    r := r || jsonb_build_object('mesas', coalesce((select jsonb_agg(public._mesa_json(m) order by m.id)
      from public.mesas m), '[]'::jsonb));
  end if;
  if todo or 'cocina' = any(p_partes) then
    r := r || jsonb_build_object('cocina', coalesce((select jsonb_agg(j order by c desc) from (
      select public._ticket_json(t, s.rol <> 'mesero' or t.creado_por = s.uid) j, t.created_at c
        from public.tickets t where t.archivado_cocina is not true
       order by t.created_at desc limit 300) x), '[]'::jsonb));
  end if;
  if caja and (todo or 'historial' = any(p_partes)) then
    r := r || jsonb_build_object(
      'historial', coalesce((select jsonb_agg(j order by c desc) from (
        select public._ticket_json(t) j, t.created_at c from public.tickets t
         where t.corte_id is null and t.reenvio is not true
         order by t.created_at desc limit 1000) x), '[]'::jsonb),
      'periodo', public._resumen(null));
  end if;
  if caja and (todo or 'cortes' = any(p_partes)) then
    r := r || jsonb_build_object('cortes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'fecha', fecha,
      'hora', hora, 'tickets', tickets, 'total', coalesce(total, 0), 'gastos', coalesce(gastos, 0),
      'cobrado', coalesce(cobrado, 0), 'porCobrar', coalesce(por_cobrar, 0),
      'detalle', detalle) order by created_at desc) from (
        select * from public.cortes order by created_at desc limit 60) c), '[]'::jsonb));
  end if;
  if s.rol in ('mesero', 'admin') and (todo or 'porCobrar' = any(p_partes)) then
    r := r || jsonb_build_object('porCobrar', coalesce((select jsonb_agg(j order by c desc) from (
      select public._ticket_json(t, s.rol <> 'mesero' or t.creado_por = s.uid) j, t.created_at c
        from public.tickets t where t.cobro_id is null and t.reenvio is not true
       order by t.created_at desc limit 200) x), '[]'::jsonb));
  end if;
  if s.rol = 'admin' and (todo or 'gastos' = any(p_partes)) then
    r := r || jsonb_build_object('gastos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'concepto', concepto,
      'monto', coalesce(monto, 0), 'fecha', fecha, 'hora', hora, 'user', usuario) order by created_at desc)
      from public.gastos where corte_id is null), '[]'::jsonb));
  end if;
  return r;
end $$;

-- Ajustes del negocio: solo claves conocidas y valores válidos
--   modoCocina: 'impresora' (la cocina imprime cada comanda) o 'monitor' (pantalla de cocina)
--   imprimirCocinaMonitor: en modo monitor, imprimir también la comanda en cocina
create or replace function public.fijar_ajuste(p_token text, p_clave text, p_valor jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare s record; v jsonb;
begin
  select * into s from public._exigir(p_token, array['admin']);
  if not ((p_clave = 'modoCocina' and jsonb_typeof(p_valor) = 'string' and p_valor #>> '{}' in ('impresora', 'monitor'))
       or (p_clave = 'imprimirCocinaMonitor' and jsonb_typeof(p_valor) = 'boolean')) then
    perform public._error('DATOS', 'Ajuste no válido.');
  end if;
  update public.config set ajustes = coalesce(ajustes, '{}'::jsonb) || jsonb_build_object(p_clave, p_valor)
   where id = 1 returning ajustes into v;
  perform public._log(s.uid, s.nombre, 'ajuste', jsonb_build_object('clave', p_clave, 'valor', p_valor));
  return v::json;
end $$;

revoke all on function public.fijar_ajuste(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.fijar_ajuste(text, text, jsonb) to anon, authenticated;

commit;
