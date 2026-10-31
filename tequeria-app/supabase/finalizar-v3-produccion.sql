-- =====================================================================
--  LA TEQUERÍA — Paso final de la migración a v3 en PRODUCCIÓN (31/10/2026)
--  Ejecutar UNA sola vez en Supabase -> SQL Editor, después de las partes
--  ya aplicadas (v3_parte1 … v3_parteA). Completa: funciones de borrado,
--  cambio de API (quita la v2 y el verificador de PIN público), archivado
--  de tickets ya cortados, permisos y avisos de tiempo real.
--  Para instalaciones nuevas usa supabase-schema.sql, no este archivo.
-- =====================================================================
begin;
create or replace function public.eliminar_bebida(p_token text, p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._exigir(p_token, array['admin']);
  delete from public.bebidas where id = p_id;
  perform public._log(s.uid, s.nombre, 'eliminar_bebida', jsonb_build_object('id', p_id));
end $$;
create or replace function public.eliminar_carne(p_token text, p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._exigir(p_token, array['admin']);
  delete from public.carnes where id = p_id;
  perform public._log(s.uid, s.nombre, 'eliminar_carne', jsonb_build_object('id', p_id));
end $$;
create or replace function public.eliminar_gasto(p_token text, p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare s record; g public.gastos;
begin
  select * into s from public._exigir(p_token, array['admin']);
  delete from public.gastos where id = p_id and corte_id is null returning * into g;
  if g.id is null then perform public._error('GASTO', 'El gasto no existe o ya pertenece a un corte.'); end if;
  perform public._log(s.uid, s.nombre, 'eliminar_gasto', jsonb_build_object('concepto', g.concepto, 'monto', g.monto, 'fecha', g.fecha));
end $$;
create or replace function public.eliminar_usuario(p_token text, p_admin_pin text, p_id text)
returns json language plpgsql security definer set search_path = public as $$
declare s record; v_auth json; u public.usuarios; v_admins int;
begin
  select * into s from public._exigir(p_token, array['admin']);
  v_auth := public._verificar_admin(p_admin_pin, s.sid, s.uid);
  if not (v_auth->>'ok')::boolean then return v_auth; end if;
  if p_id = s.uid then return json_build_object('ok', false, 'error', 'propio'); end if;
  perform 1 from public.usuarios where rol = 'admin' order by id for update;
  select * into u from public.usuarios where id = p_id;
  if u.id is null then return json_build_object('ok', false, 'error', 'no_existe'); end if;
  select count(*) into v_admins from public.usuarios where rol = 'admin';
  if u.rol = 'admin' and v_admins <= 1 then return json_build_object('ok', false, 'error', 'ultimo_admin'); end if;
  update public.cocina_sesion set session_id = null
   where id = 1 and session_id in (select id::text from public.sesiones where usuario_id = u.id);
  delete from public.usuarios where id = u.id;
  perform public._log(s.uid, s.nombre, 'eliminar_usuario', jsonb_build_object('id', u.id, 'nombre', u.nombre, 'rol', u.rol));
  return json_build_object('ok', true);
end $$;
update public.tickets set archivado_cocina = true where corte_id is not null and archivado_cocina is not true;
update public.usuarios u set debe_cambiar_pin = true
where u.pin_hash not like '$2%'
  and exists (select 1 from unnest(array['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999',
                                          '1234','4321','0123','1212','2468','1357','12345','123456']) p
              where u.pin_hash = encode(extensions.digest(p || '|' || u.id, 'sha256'), 'hex'));
drop function if exists public.login(text, text);
drop function if exists public.es_admin_pin(text);
drop function if exists public.crear_usuario(text, text, text, text);
drop function if exists public.crear_usuario(text, text, text, text, text);
drop function if exists public.eliminar_usuario(text);
drop function if exists public.eliminar_usuario(text, text);
drop function if exists public.hacer_corte(text, text, text);
drop function if exists public.hacer_corte(text, text, text, text, jsonb);
drop function if exists public.claim_cocina(text);
drop function if exists public.latido_cocina(text);
drop function if exists public.liberar_cocina(text);
create or replace function public.login(p_id text, p_pin text, p_dispositivo text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_ip text := public._ip(); v_espera int; u public.usuarios; cs public.cocina_sesion;
  v_token text; v_sid uuid; v_rest int; v_debil boolean;
begin
  v_espera := greatest(public._espera('u:' || coalesce(p_id, '')), coalesce(public._espera('ip:' || v_ip), 0));
  if v_espera > 0 then
    return json_build_object('ok', false, 'error', 'bloqueado', 'espera', v_espera);
  end if;
  select * into u from public.usuarios where id = p_id;
  if u.id is null or not public._pin_ok(u.pin_hash, p_pin, u.id) then
    v_rest := public._fallo('u:' || coalesce(p_id, ''), 5);
    if v_ip is not null then perform public._fallo('ip:' || v_ip, 30); end if;
    return json_build_object('ok', false, 'error', 'pin', 'restantes', v_rest);
  end if;
  perform public._limpiar_intentos('u:' || u.id);
  v_debil := public._pin_debil(p_pin);
  if u.pin_hash not like '$2%' or (v_debil and not u.debe_cambiar_pin) then
    update public.usuarios
       set pin_hash = case when pin_hash like '$2%' then pin_hash else public._hash_pin(p_pin) end,
           debe_cambiar_pin = debe_cambiar_pin or v_debil
     where id = u.id;
    u.debe_cambiar_pin := u.debe_cambiar_pin or v_debil;
  end if;
  if u.rol = 'cocinero' then
    insert into public.cocina_sesion (id) values (1) on conflict (id) do nothing;
    select * into cs from public.cocina_sesion where id = 1 for update;
    if cs.session_id is not null and cs.actualizado > now() - interval '45 seconds'
       and coalesce(cs.dispositivo, '') <> coalesce(left(p_dispositivo, 64), '-')
       and exists (select 1 from public.sesiones s where s.id::text = cs.session_id and not s.revocada and s.expira > now()) then
      return json_build_object('ok', false, 'error', 'cocina_ocupada');
    end if;
  end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.sesiones (token_hash, usuario_id, dispositivo, expira)
  values (encode(digest(v_token, 'sha256'), 'hex'), u.id, left(p_dispositivo, 64), now() + interval '14 hours')
  returning id into v_sid;
  if u.rol = 'cocinero' then
    update public.cocina_sesion set session_id = v_sid::text, dispositivo = left(p_dispositivo, 64), actualizado = now()
     where id = 1;
  end if;
  delete from public.sesiones where expira < now() - interval '1 day';
  delete from public.intentos where ultimo < now() - interval '1 day' and coalesce(bloqueado_hasta, '-infinity'::timestamptz) < now();
  return json_build_object('ok', true, 'token', v_token, 'debeCambiarPin', u.debe_cambiar_pin,
    'usuario', json_build_object('id', u.id, 'nombre', u.nombre, 'rol', u.rol));
end $$;
create or replace function public.latido_cocina(p_token text)
returns boolean language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._sesion(p_token);
  if s.rol <> 'cocinero' then return true; end if;
  update public.cocina_sesion set actualizado = now() where id = 1 and session_id = s.sid::text;
  return found;
end $$;
create or replace function public.liberar_cocina(p_token text)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._sesion(p_token);
  update public.cocina_sesion set session_id = null where id = 1 and session_id = s.sid::text;
end $$;
create or replace function public.crear_usuario(p_token text, p_admin_pin text, p_nombre text, p_pin text, p_rol text)
returns json language plpgsql security definer set search_path = public as $$
declare s record; v_auth json; v_nombre text := left(btrim(coalesce(p_nombre, '')), 40); v_id text;
begin
  select * into s from public._exigir(p_token, array['admin']);
  v_auth := public._verificar_admin(p_admin_pin, s.sid, s.uid);
  if not (v_auth->>'ok')::boolean then return v_auth; end if;
  if v_nombre = '' then return json_build_object('ok', false, 'error', 'nombre'); end if;
  if p_rol not in ('admin', 'mesero', 'cocinero') then return json_build_object('ok', false, 'error', 'rol'); end if;
  if not public._pin_formato_ok(p_pin) then return json_build_object('ok', false, 'error', 'formato'); end if;
  if public._pin_debil(p_pin) then return json_build_object('ok', false, 'error', 'debil'); end if;
  v_id := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into public.usuarios (id, nombre, rol, pin_hash) values (v_id, v_nombre, p_rol, public._hash_pin(p_pin));
  perform public._log(s.uid, s.nombre, 'crear_usuario', jsonb_build_object('id', v_id, 'nombre', v_nombre, 'rol', p_rol));
  return json_build_object('ok', true, 'usuario', json_build_object('id', v_id, 'nombre', v_nombre, 'rol', p_rol));
end $$;
do $$ declare t text; begin foreach t in array array['config','carnes','bebidas','usuarios','mesas','tickets','cortes','gastos','cocina_sesion','app_state'] loop execute format('drop policy if exists rw_all on public.%I', t); execute format('drop policy if exists usuarios_sel on public.%I', t); begin execute format('alter publication supabase_realtime drop table public.%I', t); exception when others then null; end; end loop; end $$;
do $$ declare t text; begin foreach t in array array['config','carnes','bebidas','usuarios','mesas','tickets','cortes','gastos'] loop execute format('create or replace trigger avisar_cambio after insert or update or delete on public.%I for each statement execute function public._avisar_cambio()', t); end loop; end $$;
do $$ declare t text; begin foreach t in array array['config','carnes','bebidas','usuarios','mesas','tickets','cortes','gastos','cocina_sesion','sesiones','intentos','bitacora','app_state'] loop if to_regclass('public.' || t) is not null then execute format('alter table public.%I enable row level security', t); execute format('revoke all on public.%I from public, anon, authenticated', t); end if; end loop; end $$;
revoke all on sequence public.bitacora_id_seq from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             '_error','_ahora_local','_fecha','_hora','_ip','_hash_pin','_pin_ok','_pin_formato_ok','_pin_debil',
             '_espera','_fallo','_limpiar_intentos','_log','_sesion','_exigir','_verificar_admin','_ticket_json',
             '_mesa_json','_resumen','_resolver_item','_valorar_items','_total_items','_avisar_cambio','_precio_ok',
             'crear_admin_inicial','usuarios_login','login','logout','cambiar_pin','estado','guardar_borrador_mesa',
             'liberar_mesa','enviar_comanda','reenviar_cocina','cambiar_estado_ticket','archivar_ticket','latido_cocina',
             'liberar_cocina','hacer_corte','ajustar_bebida','actualizar_bebida','agregar_bebida','eliminar_bebida',
             'actualizar_carne','agregar_carne','eliminar_carne','fijar_precio','fijar_precio_extra','agregar_extra',
             'eliminar_extra','alternar_oculto','agregar_gasto','eliminar_gasto','crear_usuario','eliminar_usuario',
             'restablecer_pin')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant usage on schema public to anon, authenticated;
grant execute on function
  public.usuarios_login(), public.login(text, text, text), public.logout(text),
  public.cambiar_pin(text, text, text), public.estado(text, text[]),
  public.guardar_borrador_mesa(text, int, jsonb, int), public.liberar_mesa(text, int),
  public.enviar_comanda(text, jsonb), public.reenviar_cocina(text, text, int),
  public.cambiar_estado_ticket(text, text, text), public.archivar_ticket(text, text),
  public.latido_cocina(text), public.liberar_cocina(text), public.hacer_corte(text, text),
  public.ajustar_bebida(text, text, int), public.actualizar_bebida(text, text, jsonb),
  public.agregar_bebida(text, text, numeric, int), public.eliminar_bebida(text, text),
  public.actualizar_carne(text, text, boolean), public.agregar_carne(text, text), public.eliminar_carne(text, text),
  public.fijar_precio(text, text, numeric), public.fijar_precio_extra(text, text, numeric),
  public.agregar_extra(text, text, text, numeric), public.eliminar_extra(text, text), public.alternar_oculto(text, text),
  public.agregar_gasto(text, text, text, numeric), public.eliminar_gasto(text, text),
  public.crear_usuario(text, text, text, text, text), public.eliminar_usuario(text, text, text),
  public.restablecer_pin(text, text, text, text)
to anon, authenticated;
commit;
