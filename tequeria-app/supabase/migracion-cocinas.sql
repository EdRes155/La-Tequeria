-- La Tequería · varias pantallas de cocina: tachados compartidos, cambios de estado con
-- verificación y lotes (aditiva). Equivale a las partes nuevas de supabase-schema.sql; se puede
-- ejecutar más de una vez.
begin;


-- Productos que la cocina ya tachó en el monitor; se comparte entre pantallas.
-- linea = '<id de la orden>|<clave del producto>'. Desmarcar deja hecho = false.
create table if not exists public.cocina_hechos (
  ticket_id text not null,
  linea text not null,
  hecho boolean not null default true,
  por text,
  actualizado timestamptz not null default now(),
  primary key (ticket_id, linea)
);

alter table public.cocina_hechos enable row level security;
revoke all on public.cocina_hechos from public, anon, authenticated;

create or replace function public._ticket_json(t public.tickets, p_domicilio boolean default true)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'tipo', t.tipo, 'esExtra', coalesce(t.es_extra, false), 'origen', t.origen,
    'mesaId', t.mesa_id, 'ordenes', coalesce(t.ordenes, '[]'::jsonb), 'extras', coalesce(t.extras, '[]'::jsonb),
    'mesero', t.mesero, 'hora', t.hora, 'fecha', t.fecha, 'estado', coalesce(t.estado, 'pendiente'),
    'total', coalesce(t.total, 0), 'domicilio', case when p_domicilio then t.domicilio end,
    'reenvio', coalesce(t.reenvio, false), 'cuenta', coalesce(t.cuenta, 'junta'),
    'paraLlevar', coalesce(t.para_llevar, false), 'referencia', t.referencia,
    'archivado', coalesce(t.archivado_cocina, false), 'creado', t.created_at, 'folio', t.folio,
    'recibido', t.recibido_at,
    'hechos', case when t.archivado_cocina then '[]'::jsonb else coalesce((select jsonb_agg(h.linea order by h.linea)
                from public.cocina_hechos h where h.ticket_id = t.id and h.hecho), '[]'::jsonb) end,
    'cobro', case when t.cobro_id is null then null
                  when t.cobro_id = 'previo' then jsonb_build_object('previo', true)
                  when t.cobro_id = 'no_cobrado' then jsonb_build_object('noCobrado', true)
                  else (select jsonb_build_object('id', c.id, 'metodo', c.metodo, 'hora', c.hora, 'total', c.total,
                                                  'propina', c.propina, 'recibido', c.recibido, 'enCorte', c.corte_id is not null)
                          from public.cobros c where c.id = t.cobro_id) end);
$$;

-- Latido de la cocina. Normalmente una sola cocina activa; con el ajuste «variasCocinas»
-- nadie se queda con la exclusividad y pueden trabajar varias pantallas a la vez.
create or replace function public.latido_cocina(p_token text)
returns boolean language plpgsql security definer set search_path = public as $$
declare s record; v_varias boolean;
begin
  select * into s from public._sesion(p_token);
  if s.rol <> 'cocinero' then return true; end if;
  select coalesce((ajustes->>'variasCocinas')::boolean, false) into v_varias from public.config where id = 1;
  if v_varias then
    update public.cocina_sesion set session_id = null where id = 1 and session_id is not null;
    return true;
  end if;
  -- si nadie la tiene (por ejemplo al volver a una sola cocina), la toma esta pantalla
  update public.cocina_sesion set session_id = s.sid::text, actualizado = now()
   where id = 1 and (session_id = s.sid::text or session_id is null);
  return found;
end $$;

-- Cambia de estado varias comandas a la vez, solo si siguen como las vio la pantalla
-- (p_tickets = [{"id": "...", "estado": "pendiente"}, ...]). Repetirlo no cambia nada.
-- Las que otra pantalla ya movió, o que ya no están en cocina, se devuelven en «conflictos».
create or replace function public.mover_tickets(p_token text, p_tickets jsonb, p_hacia text)
returns json language plpgsql security definer set search_path = public as $$
declare s record; v_ids text[]; v_mov int; v_conf jsonb;
begin
  select * into s from public._exigir(p_token, array['cocinero', 'admin']);
  if p_hacia is null or p_hacia not in ('pendiente', 'preparando', 'listo') then perform public._error('DATOS', 'Estado no válido.'); end if;
  if jsonb_typeof(p_tickets) is distinct from 'array' or jsonb_array_length(p_tickets) = 0 or jsonb_array_length(p_tickets) > 100 then
    perform public._error('DATOS', 'Elige al menos una comanda.');
  end if;
  select array_agg(x->>'id' order by x->>'id') into v_ids from jsonb_array_elements(p_tickets) x;
  perform 1 from public.tickets where id = any(v_ids) order by id for update;   -- mismo orden de bloqueo: sin interbloqueos
  update public.tickets t set estado = p_hacia, recibido_at = coalesce(t.recibido_at, now())
    from (select x->>'id' id, x->>'estado' visto from jsonb_array_elements(p_tickets) x) p
   where t.id = p.id and coalesce(t.estado, 'pendiente') = p.visto and coalesce(t.estado, 'pendiente') <> p_hacia
     and t.archivado_cocina is not true;
  get diagnostics v_mov = row_count;
  select coalesce(jsonb_agg(p.id), '[]'::jsonb) into v_conf
    from unnest(v_ids) p(id) left join public.tickets t on t.id = p.id
   where t.id is null or t.archivado_cocina or coalesce(t.estado, 'pendiente') <> p_hacia;
  return json_build_object('movidos', v_mov, 'conflictos', v_conf);
end $$;

-- Quita de la cocina varias comandas listas a la vez (idempotente)
create or replace function public.archivar_tickets(p_token text, p_ids text[])
returns int language plpgsql security definer set search_path = public as $$
declare s record; v_n int;
begin
  select * into s from public._exigir(p_token, array['cocinero', 'admin']);
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 300 then return 0; end if;
  perform 1 from public.tickets where id = any(p_ids) order by id for update;
  update public.tickets set archivado_cocina = true
   where id = any(p_ids) and estado = 'listo' and archivado_cocina is not true;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Tacha o destacha un producto de una comanda; todas las pantallas de cocina lo ven
create or replace function public.marcar_hecho(p_token text, p_ticket text, p_linea text, p_hecho boolean)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._exigir(p_token, array['cocinero', 'admin']);
  if p_linea is null or p_linea !~ '^[^|]{1,64}[|][A-Za-z0-9_-]{1,80}$' or p_hecho is null then
    perform public._error('DATOS', 'Producto no válido.');
  end if;
  if not exists (select 1 from public.tickets where id = p_ticket and archivado_cocina is not true) then
    perform public._error('TICKET', 'La comanda ya no está en cocina.');
  end if;
  insert into public.cocina_hechos (ticket_id, linea, hecho, por, actualizado)
  values (p_ticket, p_linea, p_hecho, s.nombre, now())
  on conflict (ticket_id, linea) do update set hecho = excluded.hecho, por = excluded.por, actualizado = now()
   where public.cocina_hechos.hecho is distinct from excluded.hecho;
end $$;

-- Ajustes del negocio: solo claves conocidas y valores válidos
--   modoCocina: 'impresora' (la cocina imprime cada comanda) o 'monitor' (pantalla de cocina)
--   imprimirCocinaMonitor: en modo monitor, imprimir también la comanda en cocina
--   variasCocinas: permitir varias pantallas de cocina a la vez
create or replace function public.fijar_ajuste(p_token text, p_clave text, p_valor jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare s record; v jsonb;
begin
  select * into s from public._exigir(p_token, array['admin']);
  if not ((p_clave = 'modoCocina' and jsonb_typeof(p_valor) = 'string' and p_valor #>> '{}' in ('impresora', 'monitor'))
       or (p_clave in ('imprimirCocinaMonitor', 'variasCocinas') and jsonb_typeof(p_valor) = 'boolean')) then
    perform public._error('DATOS', 'Ajuste no válido.');
  end if;
  update public.config set ajustes = coalesce(ajustes, '{}'::jsonb) || jsonb_build_object(p_clave, p_valor)
   where id = 1 returning ajustes into v;
  perform public._log(s.uid, s.nombre, 'ajuste', jsonb_build_object('clave', p_clave, 'valor', p_valor));
  return v::json;
end $$;

create or replace trigger avisar_cambio after insert or update on public.cocina_hechos
  for each statement execute function public._avisar_cambio();

revoke all on function public.mover_tickets(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.archivar_tickets(text, text[]) from public, anon, authenticated;
revoke all on function public.marcar_hecho(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.mover_tickets(text, jsonb, text), public.archivar_tickets(text, text[]),
  public.marcar_hecho(text, text, text, boolean) to anon, authenticated;

commit;
