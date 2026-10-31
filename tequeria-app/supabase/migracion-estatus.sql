-- La Tequería · estatus del pedido, recibido en cocina y no liberar mesas sin cobrar (aditiva).
-- Equivale a las partes nuevas de supabase-schema.sql; se puede ejecutar más de una vez.
begin;


alter table public.tickets add column if not exists recibido_at timestamptz;

create index if not exists tickets_mesa_idx on public.tickets (mesa_id, created_at desc);

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
    'cobro', case when t.cobro_id is null then null
                  when t.cobro_id = 'previo' then jsonb_build_object('previo', true)
                  when t.cobro_id = 'no_cobrado' then jsonb_build_object('noCobrado', true)
                  else (select jsonb_build_object('id', c.id, 'metodo', c.metodo, 'hora', c.hora, 'total', c.total,
                                                  'propina', c.propina, 'recibido', c.recibido, 'enCorte', c.corte_id is not null)
                          from public.cobros c where c.id = t.cobro_id) end);
$$;

create or replace function public._mesa_json(m public.mesas)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', m.id, 'estado', coalesce(m.estado, 'libre'), 'mesero', m.mesero, 'hora', m.hora,
    'pedido', m.pedido, 'extras', coalesce(m.extras, '[]'::jsonb), 'version', coalesce(m.version, 0),
    -- inicio de la visita actual: la comanda original más reciente de la mesa ocupada
    'desde', case when m.estado = 'ocupada' then (select max(t.created_at) from public.tickets t
                   where t.mesa_id = m.id and t.es_extra is not true and t.reenvio is not true) end);
$$;

-- Total y desglose de un periodo (p_corte null = periodo abierto)
create or replace function public._resumen(p_corte text)
returns jsonb language sql stable set search_path = public as $$
  with t as (
    select * from public.tickets
     where reenvio is not true
       and ((p_corte is null and corte_id is null) or corte_id = p_corte)
  ), it as (
    select coalesce(i->>'corto', i->>'nombre', i->>'key') as nombre,
           coalesce((i->>'cantidad')::numeric, 0) as cant
      from t, jsonb_array_elements(coalesce(t.ordenes, '[]'::jsonb)) o,
           jsonb_array_elements(coalesce(o->'items', '[]'::jsonb)) i
  )
  select jsonb_build_object(
    'count', (select count(*) from t),
    'total', (select coalesce(sum(total), 0) from t),
    'porTipo', coalesce((select jsonb_object_agg(k, s) from (
        select case tipo when 'aqui' then 'Para comer aquí' when 'llevar' then 'Para llevar'
                         when 'domicilio' then 'Domicilio' else 'Otro' end k, sum(total) s
          from t group by 1) x), '{}'::jsonb),
    'porMesero', coalesce((select jsonb_object_agg(k, s) from (
        select coalesce(mesero, '—') k, sum(total) s from t group by 1) x), '{}'::jsonb),
    'top', coalesce((select jsonb_agg(jsonb_build_object('nombre', nombre, 'cant', cant) order by cant desc, nombre)
        from (select nombre, sum(cant) cant from it group by nombre order by 2 desc, 1 limit 5) x), '[]'::jsonb),
    'gastos', (select coalesce(sum(monto), 0) from public.gastos
                where (p_corte is null and corte_id is null) or corte_id = p_corte),
    'porCobrar', (select coalesce(sum(total), 0) from t where cobro_id is null),
    'porCobrarCount', (select count(*) from t where cobro_id is null),
    'noCobrado', (select coalesce(sum(total), 0) from t where cobro_id = 'no_cobrado'),
    'noCobradoCount', (select count(*) from t where cobro_id = 'no_cobrado'),
    'cobrado', (select jsonb_build_object(
        'count', count(*), 'ventas', coalesce(sum(total), 0), 'propinas', coalesce(sum(propina), 0),
        'total', coalesce(sum(total + propina), 0),
        'efectivo', coalesce(sum(total + propina) filter (where metodo = 'efectivo'), 0),
        'tarjeta', coalesce(sum(total + propina) filter (where metodo = 'tarjeta'), 0),
        'transferencia', coalesce(sum(total + propina) filter (where metodo = 'transferencia'), 0))
      from public.cobros where not anulado and ((p_corte is null and corte_id is null) or corte_id = p_corte))
  );
$$;

create or replace function public.liberar_mesa(p_token text, p_mesa_id int)
returns json language plpgsql security definer set search_path = public as $$
declare s record; m public.mesas; v_n int;
begin
  select * into s from public._exigir(p_token, array['mesero', 'admin']);
  select * into m from public.mesas where id = p_mesa_id for update;
  if m.id is null then perform public._error('MESA', 'La mesa no existe.'); end if;
  -- una mesa con cuentas sin cobrar no se libera: primero se cobra (o un administrador la cierra sin cobro)
  select count(*) into v_n from public.tickets where mesa_id = m.id and cobro_id is null and reenvio is not true;
  if v_n > 0 then
    perform public._error('POR_COBRAR', format('La Mesa %s tiene %s cuenta(s) por cobrar. Cóbrala antes de liberarla.', m.id, v_n));
  end if;
  if m.estado = 'ocupada' then
    perform public._log(s.uid, s.nombre, 'liberar_mesa', jsonb_build_object('mesa', m.id, 'mesero', m.mesero));
  end if;
  update public.mesas set estado = 'libre', pedido = null, mesero = null, hora = null, extras = '[]'::jsonb,
         version = coalesce(version, 0) + 1
   where id = m.id returning * into m;
  return public._mesa_json(m);
end $$;

-- ---------------------------------------------------------------------
--  API: cocina
-- ---------------------------------------------------------------------
create or replace function public.cambiar_estado_ticket(p_token text, p_id text, p_estado text)
returns void language plpgsql security definer set search_path = public as $$
declare s record; t public.tickets;
begin
  select * into s from public._exigir(p_token, array['cocinero', 'admin']);
  if p_estado not in ('pendiente', 'preparando', 'listo') then perform public._error('DATOS', 'Estado no válido.'); end if;
  select * into t from public.tickets where id = p_id for update;
  if t.id is null or t.archivado_cocina then perform public._error('TICKET', 'La comanda ya no está en cocina.'); end if;
  update public.tickets set estado = p_estado, recibido_at = coalesce(recibido_at, now()) where id = p_id;
end $$;

-- La cocina confirma que ya tiene las comandas en pantalla: el mesero las ve como «Recibido»
create or replace function public.marcar_recibido(p_token text, p_ids text[])
returns int language plpgsql security definer set search_path = public as $$
declare s record; v_n int;
begin
  select * into s from public._exigir(p_token, array['cocinero', 'admin']);
  if p_ids is null or not exists (select 1 from public.tickets where id = any(p_ids[1:300])
                                    and recibido_at is null and archivado_cocina is not true) then
    return 0;
  end if;
  update public.tickets set recibido_at = now()
   where id = any(p_ids[1:300]) and recibido_at is null and archivado_cocina is not true;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Corte: serializado; fija el conjunto de tickets con un solo UPDATE y calcula
-- total y desglose sobre exactamente ese conjunto. No toca la cola de cocina.
create or replace function public.hacer_corte(p_token text, p_admin_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare s record; v_auth json; v_id text := gen_random_uuid()::text; v_res jsonb; v_ret int;
begin
  select * into s from public._exigir(p_token, array['cocinero', 'admin']);
  v_auth := public._verificar_admin(p_admin_pin, s.sid);
  if not (v_auth->>'ok')::boolean then return v_auth; end if;

  perform pg_advisory_xact_lock(hashtextextended('tequeria:corte', 0));
  if not exists (select 1 from public.tickets where corte_id is null and reenvio is not true)
     and not exists (select 1 from public.cobros where corte_id is null and not anulado) then
    return json_build_object('ok', false, 'error', 'vacio');
  end if;
  update public.tickets set corte_id = v_id where corte_id is null;
  update public.gastos set corte_id = v_id where corte_id is null;
  update public.cobros set corte_id = v_id where corte_id is null;
  v_res := public._resumen(v_id);

  insert into public.cortes (id, fecha, hora, tickets, total, gastos, detalle, hecho_por, autorizado_por, cobrado, por_cobrar)
  values (v_id, public._fecha(), public._hora(), (v_res->>'count')::int, (v_res->>'total')::numeric,
          (v_res->>'gastos')::numeric,
          jsonb_build_object('porTipo', v_res->'porTipo', 'porMesero', v_res->'porMesero', 'top', v_res->'top',
                             'gastos', v_res->'gastos', 'cobrado', v_res->'cobrado', 'porCobrar', v_res->'porCobrar',
                             'noCobrado', v_res->'noCobrado'),
          s.uid, v_auth->>'id', (v_res->'cobrado'->>'total')::numeric, (v_res->>'porCobrar')::numeric);
  perform public._log(s.uid, s.nombre, 'corte', jsonb_build_object('corte', v_id, 'autorizo', v_auth->>'nombre',
                      'tickets', v_res->'count', 'total', v_res->'total'));

  -- Retención: anonimiza domicilios de cortes antiguos
  select coalesce(retencion_domicilio_dias, 90) into v_ret from public.config where id = 1;
  update public.tickets set domicilio = jsonb_build_object('anonimizado', true, 'pago', domicilio->>'pago')
   where domicilio is not null and not (domicilio ? 'anonimizado') and corte_id is not null
     and created_at < now() - make_interval(days => coalesce(v_ret, 90));

  return json_build_object('ok', true, 'corte', jsonb_build_object('id', v_id, 'tickets', v_res->'count',
    'total', v_res->'total', 'gastos', v_res->'gastos', 'autorizo', v_auth->>'nombre',
    'cobrado', v_res->'cobrado', 'porCobrar', v_res->'porCobrar'));
end $$;

-- Cierra cuentas que no se van a cobrar (el cliente se fue, comanda equivocada…) con PIN de
-- administrador y motivo. Quedan como «No cobrado» en el corte y en la bitácora.
create or replace function public.no_cobrar(p_token text, p_admin_pin text, p_tickets text[], p_motivo text,
                                            p_liberar_mesa boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  s record; v_auth json; v_motivo text := left(btrim(coalesce(p_motivo, '')), 200);
  v_n int; v_total numeric; v_mesas int[]; v_ya text; v_liberada boolean := false;
begin
  select * into s from public._exigir(p_token, array['mesero', 'admin']);
  if v_motivo = '' then perform public._error('DATOS', 'Escribe el motivo.'); end if;
  if p_tickets is null or cardinality(p_tickets) = 0 or cardinality(p_tickets) > 50 then
    perform public._error('DATOS', 'Elige al menos una cuenta.');
  end if;
  v_auth := public._verificar_admin(p_admin_pin, s.sid);
  if not (v_auth->>'ok')::boolean then return v_auth; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('tequeria:corte', 0));

  perform 1 from public.tickets where id = any(p_tickets) order by id for update;
  select count(*), coalesce(sum(total), 0), array_agg(distinct mesa_id) filter (where mesa_id is not null)
    into v_n, v_total, v_mesas
    from public.tickets where id = any(p_tickets) and reenvio is not true;
  if v_n <> cardinality(array(select distinct unnest(p_tickets))) then
    perform public._error('TICKET', 'Alguna cuenta ya no existe o es una reimpresión.');
  end if;
  select coalesce(origen, 'una cuenta') into v_ya from public.tickets where id = any(p_tickets) and cobro_id is not null limit 1;
  if v_ya is not null then
    perform public._error('YA_COBRADO', 'La cuenta de ' || v_ya || ' ya estaba cerrada. Actualiza la pantalla.');
  end if;
  update public.tickets set cobro_id = 'no_cobrado' where id = any(p_tickets);

  if p_liberar_mesa and coalesce(cardinality(v_mesas), 0) = 1 then
    perform 1 from public.mesas where id = v_mesas[1] for update;
    if not exists (select 1 from public.tickets where mesa_id = v_mesas[1] and cobro_id is null and reenvio is not true) then
      update public.mesas set estado = 'libre', pedido = null, mesero = null, hora = null, extras = '[]'::jsonb,
             version = coalesce(version, 0) + 1
       where id = v_mesas[1] and estado = 'ocupada';
      v_liberada := found;
    end if;
  end if;
  perform public._log(s.uid, s.nombre, 'no_cobrado', jsonb_build_object('tickets', to_jsonb(p_tickets), 'total', v_total,
                      'motivo', v_motivo, 'autorizo', v_auth->>'nombre'));
  return json_build_object('ok', true, 'mesaLiberada', v_liberada, 'total', v_total);
end $$;

revoke all on function public.marcar_recibido(text, text[]) from public, anon, authenticated;
revoke all on function public.no_cobrar(text, text, text[], text, boolean) from public, anon, authenticated;
grant execute on function public.marcar_recibido(text, text[]), public.no_cobrar(text, text, text[], text, boolean)
  to anon, authenticated;

commit;
