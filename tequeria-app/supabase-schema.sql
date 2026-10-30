-- =====================================================================
--  LA TEQUERÍA — Esquema v3
--  · Sin acceso anónimo a las tablas: todo pasa por funciones (RPC)
--    que validan una sesión y el rol del operador en el servidor.
--  · Sesiones con token, PIN con bcrypt y límite de intentos.
--  · Envío de comandas atómico e idempotente; precios y existencias
--    calculados en el servidor.
--  · Corte serializado con total y desglose del servidor.
--
--  Cómo aplicarlo: Supabase -> SQL Editor -> New query -> pega TODO -> Run.
--  Es re-ejecutable y actualiza una base v2 conservando sus datos.
--  Primera instalación: al final ejecuta crear_admin_inicial (ver README).
-- =====================================================================
begin;
set local client_min_messages = warning;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
--  TABLAS
-- ---------------------------------------------------------------------
create table if not exists public.config (
  id int primary key default 1,
  nombre_negocio text default 'La Tequería',
  precios jsonb default '{}'::jsonb,
  extras  jsonb default '[]'::jsonb,
  ocultos jsonb default '[]'::jsonb
);
alter table public.config add column if not exists zona_horaria text default 'America/Mexico_City';
alter table public.config add column if not exists retencion_domicilio_dias int default 90;

create table if not exists public.carnes (
  id text primary key, nombre text not null,
  activo boolean default true, orden int default 0
);

create table if not exists public.bebidas (
  id text primary key, nombre text not null,
  cantidad int default 0, activo boolean default true, precio numeric default 0
);

create table if not exists public.usuarios (
  id text primary key, nombre text not null,
  rol text not null default 'mesero', pin_hash text not null
);
alter table public.usuarios add column if not exists debe_cambiar_pin boolean not null default false;
alter table public.usuarios add column if not exists creado timestamptz default now();

create table if not exists public.mesas (
  id int primary key, estado text default 'libre',
  mesero text, hora text, pedido jsonb, extras jsonb default '[]'::jsonb
);
alter table public.mesas add column if not exists version int not null default 0;

create table if not exists public.tickets (
  id text primary key, tipo text, es_extra boolean default false,
  origen text, mesa_id int, ordenes jsonb default '[]'::jsonb, extras jsonb default '[]'::jsonb,
  mesero text, hora text, fecha text, estado text default 'pendiente',
  archivado_cocina boolean default false, total numeric default 0,
  domicilio jsonb, corte_id text, created_at timestamptz default now()
);
-- Solo al actualizar desde v2 (aún sin creado_por): v2 ocultaba de cocina lo que ya tenía corte;
-- en v3 la cocina depende únicamente de archivado_cocina, así que se archivan una sola vez.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'tickets' and column_name = 'creado_por') then
    update public.tickets set archivado_cocina = true where corte_id is not null and archivado_cocina is not true;
  end if;
end $$;
alter table public.tickets add column if not exists reenvio boolean default false;
alter table public.tickets add column if not exists cuenta text default 'junta';
alter table public.tickets add column if not exists para_llevar boolean default false;
alter table public.tickets add column if not exists referencia text;
alter table public.tickets add column if not exists creado_por text;

create table if not exists public.cortes (
  id text primary key, fecha text, hora text,
  tickets int, total numeric, created_at timestamptz default now()
);
alter table public.cortes add column if not exists detalle jsonb;
alter table public.cortes add column if not exists gastos numeric default 0;
alter table public.cortes add column if not exists hecho_por text;
alter table public.cortes add column if not exists autorizado_por text;

create table if not exists public.gastos (
  id text primary key, concepto text, monto numeric,
  fecha text, hora text, usuario text, created_at timestamptz default now()
);
alter table public.gastos add column if not exists corte_id text;
alter table public.gastos add column if not exists creado_por text;

create table if not exists public.cocina_sesion (
  id int primary key default 1,
  session_id text,
  actualizado timestamptz
);
alter table public.cocina_sesion add column if not exists dispositivo text;

-- Sesiones de operadores (solo se guarda el hash del token)
create table if not exists public.sesiones (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  usuario_id text not null references public.usuarios(id) on delete cascade,
  dispositivo text,
  creada timestamptz not null default now(),
  ultimo_uso timestamptz not null default now(),
  expira timestamptz not null,
  revocada boolean not null default false
);

-- Intentos fallidos de PIN (por usuario, por IP y por sesión)
create table if not exists public.intentos (
  clave text primary key,
  fallos int not null default 0,
  bloqueado_hasta timestamptz,
  ultimo timestamptz not null default now()
);

-- Bitácora de operaciones sensibles (solo escritura desde funciones)
create table if not exists public.bitacora (
  id bigserial primary key,
  usuario_id text,
  usuario_nombre text,
  accion text not null,
  detalle jsonb,
  creado timestamptz not null default now()
);

-- Índices
create index if not exists tickets_periodo_idx on public.tickets (created_at desc) where corte_id is null;
create index if not exists tickets_cocina_idx  on public.tickets (created_at desc) where archivado_cocina is not true;
create index if not exists tickets_corte_idx   on public.tickets (corte_id);
create index if not exists gastos_corte_idx    on public.gastos (corte_id);
create index if not exists sesiones_usuario_idx on public.sesiones (usuario_id);
create index if not exists bitacora_creado_idx on public.bitacora (creado desc);

-- Reglas de dominio (NOT VALID: se aplican a datos nuevos sin rechazar los existentes)
do $$
declare r record;
begin
  for r in select * from (values
    ('bebidas',  'bebidas_cantidad_ck', 'check (cantidad >= 0)'),
    ('bebidas',  'bebidas_precio_ck',   'check (precio >= 0)'),
    ('usuarios', 'usuarios_rol_ck',     'check (rol in (''admin'',''mesero'',''cocinero''))'),
    ('mesas',    'mesas_estado_ck',     'check (estado in (''libre'',''borrador'',''ocupada''))'),
    ('tickets',  'tickets_estado_ck',   'check (estado in (''pendiente'',''preparando'',''listo''))'),
    ('tickets',  'tickets_tipo_ck',     'check (tipo in (''aqui'',''llevar'',''domicilio''))'),
    ('tickets',  'tickets_total_ck',    'check (total >= 0)'),
    ('gastos',   'gastos_monto_ck',     'check (monto > 0)')
  ) as v(tabla, nombre, regla)
  loop
    if not exists (select 1 from pg_constraint where conname = r.nombre) then
      execute format('alter table public.%I add constraint %I %s not valid', r.tabla, r.nombre, r.regla);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  DATOS INICIALES (solo si faltan; no crea usuarios)
-- ---------------------------------------------------------------------
insert into public.carnes (id, nombre, activo, orden)
select * from (values ('pastor','Pastor',true,0), ('bistec','Bistec',true,1),
                      ('tripa','Tripa',true,2), ('chorizo','Chorizo',true,3)) v(id, nombre, activo, orden)
where not exists (select 1 from public.carnes);

insert into public.bebidas (id, nombre, cantidad, activo, precio)
select * from (values
  ('coca','Coca-Cola',24,true,25), ('sprite','Sprite',12,true,25), ('fanta','Fanta',12,true,25),
  ('jamaica','Agua de Jamaica',20,true,20), ('horchata','Agua de Horchata',20,true,20),
  ('mineral','Agua Mineral',10,true,25), ('botella','Agua Embotellada',30,true,15)) v(id, nombre, cantidad, activo, precio)
where not exists (select 1 from public.bebidas);

insert into public.mesas (id, estado)
select g, 'libre' from generate_series(1, 8) g
where not exists (select 1 from public.mesas);

insert into public.config (id, nombre_negocio, precios, extras, ocultos)
select 1, 'La Tequería',
  '{"quesa-maiz-queso":25,"quesa-queso":35,"volcan-queso":35,"costra-queso":45,"media-costra-queso":25,
    "bolsa-verdura":15,"tortilla-harina":10,"tortilla-maiz":10}'::jsonb
  || coalesce((select jsonb_object_agg(k, p) from public.carnes c,
       lateral (values ('taco-'||c.id,20), ('taco-queso-'||c.id,30), ('gringa-'||c.id,45), ('llenadora-'||c.id,55),
                       ('volcan-'||c.id,40), ('costra-'||c.id,50), ('media-costra-'||c.id,28)) v(k, p)), '{}'::jsonb),
  '[]'::jsonb, '[]'::jsonb
where not exists (select 1 from public.config where id = 1);

insert into public.cocina_sesion (id) values (1) on conflict (id) do nothing;

-- PIN de demostración o triviales en datos v2 (hash SHA-256): obligar a cambiarlos
update public.usuarios u set debe_cambiar_pin = true
where u.pin_hash not like '$2%'
  and exists (select 1 from unnest(array['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999',
                                          '1234','4321','0123','1212','2468','1357','12345','123456']) p
              where u.pin_hash = encode(extensions.digest(p || '|' || u.id, 'sha256'), 'hex'));

-- ---------------------------------------------------------------------
--  RETIRAR LA API ANTERIOR (verificador de PIN público, firmas viejas)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
--  FUNCIONES INTERNAS (no se exponen a la API)
-- ---------------------------------------------------------------------
create or replace function public._error(p_codigo text, p_mensaje text)
returns void language plpgsql set search_path = public as $$
begin
  raise exception using message = p_codigo, hint = p_mensaje;
end $$;

create or replace function public._ahora_local()
returns timestamp language sql stable set search_path = public as $$
  select now() at time zone coalesce((select zona_horaria from public.config where id = 1), 'America/Mexico_City');
$$;
create or replace function public._fecha() returns text language sql stable set search_path = public as $$
  select to_char(public._ahora_local(), 'DD/MM/YYYY');
$$;
create or replace function public._hora() returns text language sql stable set search_path = public as $$
  select to_char(public._ahora_local(), 'HH24:MI');
$$;

create or replace function public._ip()
returns text language plpgsql stable set search_path = public as $$
declare h json;
begin
  h := nullif(current_setting('request.headers', true), '')::json;
  return nullif(btrim(coalesce(h->>'cf-connecting-ip', h->>'x-real-ip',
                               split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1))), '');
exception when others then return null;
end $$;

create or replace function public._hash_pin(p_pin text)
returns text language sql volatile set search_path = public, extensions as $$
  select crypt(p_pin, gen_salt('bf', 10));
$$;

-- Acepta hashes bcrypt y los SHA-256 heredados de v2 (se actualizan al entrar)
create or replace function public._pin_ok(p_hash text, p_pin text, p_id text)
returns boolean language sql stable set search_path = public, extensions as $$
  select case
    when p_hash is null or p_pin is null then false
    when p_hash like '$2%' then crypt(p_pin, p_hash) = p_hash
    else p_hash = encode(digest(p_pin || '|' || p_id, 'sha256'), 'hex')
  end;
$$;

create or replace function public._pin_formato_ok(p_pin text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_pin ~ '^[0-9]{4,8}$', false);
$$;

create or replace function public._pin_debil(p_pin text)
returns boolean language sql immutable set search_path = public as $$
  select p_pin is null
      or p_pin ~ '^(.)\1+$'
      or p_pin = any(array['1234','4321','0123','1212','2468','1357','12345','123456','654321','12341234'])
      or position(p_pin in '0123456789012345') > 0
      or position(p_pin in '9876543210987654') > 0;
$$;

create or replace function public._espera(p_clave text)
returns int language sql stable set search_path = public as $$
  select coalesce(greatest(0, ceil(extract(epoch from (bloqueado_hasta - now()))))::int, 0)
  from (select max(bloqueado_hasta) bloqueado_hasta from public.intentos where clave = p_clave) x;
$$;

-- Registra un fallo; al llegar al umbral bloquea 5, 10, 15… hasta 60 minutos
create or replace function public._fallo(p_clave text, p_umbral int)
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  insert into public.intentos as i (clave, fallos, ultimo) values (p_clave, 1, now())
  on conflict (clave) do update set
    fallos = case when i.ultimo < now() - interval '30 minutes'
                   and coalesce(i.bloqueado_hasta, '-infinity'::timestamptz) < now()
                  then 1 else i.fallos + 1 end,
    ultimo = now()
  returning fallos into n;
  if n >= p_umbral then
    update public.intentos
       set bloqueado_hasta = now() + make_interval(mins => least(60, 5 * (n - p_umbral + 1)))
     where clave = p_clave;
  end if;
  return greatest(0, p_umbral - n);
end $$;

create or replace function public._limpiar_intentos(p_clave text)
returns void language sql set search_path = public as $$
  delete from public.intentos where clave = p_clave;
$$;

create or replace function public._log(p_uid text, p_nombre text, p_accion text, p_detalle jsonb default null)
returns void language sql set search_path = public as $$
  insert into public.bitacora (usuario_id, usuario_nombre, accion, detalle) values (p_uid, p_nombre, p_accion, p_detalle);
$$;

-- Valida el token y devuelve la sesión con su usuario
create or replace function public._sesion(p_token text,
  out sid uuid, out uid text, out nombre text, out rol text, out cambiar_pin boolean)
language plpgsql set search_path = public, extensions as $$
declare r record;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    perform public._error('SESION', 'Tu sesión no es válida. Vuelve a entrar.');
  end if;
  select s.id, s.ultimo_uso, s.creada, u.id as uid, u.nombre, u.rol, u.debe_cambiar_pin into r
    from public.sesiones s join public.usuarios u on u.id = s.usuario_id
   where s.token_hash = encode(digest(p_token, 'sha256'), 'hex')
     and not s.revocada and s.expira > now();
  if not found then
    perform public._error('SESION', 'Tu sesión expiró. Vuelve a entrar.');
  end if;
  if r.ultimo_uso < now() - interval '1 minute' then
    update public.sesiones
       set ultimo_uso = now(), expira = least(r.creada + interval '3 days', now() + interval '14 hours')
     where id = r.id;
  end if;
  sid := r.id; uid := r.uid; nombre := r.nombre; rol := r.rol; cambiar_pin := coalesce(r.debe_cambiar_pin, false);
end $$;

-- Sesión válida + rol permitido + PIN ya cambiado (para operaciones de escritura)
create or replace function public._exigir(p_token text, p_roles text[],
  out sid uuid, out uid text, out nombre text, out rol text)
language plpgsql set search_path = public as $$
declare s record;
begin
  select * into s from public._sesion(p_token);
  if not (s.rol = any(p_roles)) then
    perform public._error('PERMISO', 'Tu usuario no tiene permiso para esta acción.');
  end if;
  if s.cambiar_pin then
    perform public._error('CAMBIAR_PIN', 'Primero cambia tu PIN.');
  end if;
  sid := s.sid; uid := s.uid; nombre := s.nombre; rol := s.rol;
end $$;

-- Reautenticación: comprueba el PIN de un administrador con límite de intentos.
-- Si p_uid se indica, solo vale el PIN de ese administrador.
create or replace function public._verificar_admin(p_pin text, p_sid uuid, p_uid text default null)
returns json language plpgsql set search_path = public as $$
declare v_ip text := public._ip(); v_espera int; v_admin record; v_rest int;
begin
  v_espera := greatest(public._espera('s:' || p_sid), coalesce(public._espera('ip:' || v_ip), 0));
  if v_espera > 0 then
    return json_build_object('ok', false, 'error', 'bloqueado', 'espera', v_espera);
  end if;
  select u.id, u.nombre into v_admin from public.usuarios u
   where u.rol = 'admin' and (p_uid is null or u.id = p_uid) and public._pin_ok(u.pin_hash, p_pin, u.id)
   limit 1;
  if v_admin.id is null then
    v_rest := public._fallo('s:' || p_sid, 5);
    if v_ip is not null then perform public._fallo('ip:' || v_ip, 30); end if;
    return json_build_object('ok', false, 'error', 'pin', 'restantes', v_rest);
  end if;
  perform public._limpiar_intentos('s:' || p_sid);
  return json_build_object('ok', true, 'id', v_admin.id, 'nombre', v_admin.nombre);
end $$;

create or replace function public._ticket_json(t public.tickets, p_domicilio boolean default true)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'tipo', t.tipo, 'esExtra', coalesce(t.es_extra, false), 'origen', t.origen,
    'mesaId', t.mesa_id, 'ordenes', coalesce(t.ordenes, '[]'::jsonb), 'extras', coalesce(t.extras, '[]'::jsonb),
    'mesero', t.mesero, 'hora', t.hora, 'fecha', t.fecha, 'estado', coalesce(t.estado, 'pendiente'),
    'total', coalesce(t.total, 0), 'domicilio', case when p_domicilio then t.domicilio end,
    'reenvio', coalesce(t.reenvio, false), 'cuenta', coalesce(t.cuenta, 'junta'),
    'paraLlevar', coalesce(t.para_llevar, false), 'referencia', t.referencia,
    'archivado', coalesce(t.archivado_cocina, false), 'creado', t.created_at);
$$;

create or replace function public._mesa_json(m public.mesas)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', m.id, 'estado', coalesce(m.estado, 'libre'), 'mesero', m.mesero, 'hora', m.hora,
    'pedido', m.pedido, 'extras', coalesce(m.extras, '[]'::jsonb), 'version', coalesce(m.version, 0));
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
                where (p_corte is null and corte_id is null) or corte_id = p_corte)
  );
$$;

-- Catálogo autoritativo: nombre, categoría y precio de un producto por su clave.
-- p_empaque = true acepta solo extras de empaque; false los rechaza.
create or replace function public._resolver_item(p_key text, p_empaque boolean)
returns table (ok boolean, nombre text, corto text, cat text, precio numeric, inv_id text)
language plpgsql stable set search_path = public as $$
declare
  cfg public.config; v_carne public.carnes; v_beb public.bebidas; e jsonb;
  v_pref text; v_label text; v_cat text; v_resto text;
begin
  select * into cfg from public.config where id = 1;
  ok := false;
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{1,80}$' then return next; return; end if;

  if p_key in ('verdura-aparte', 'bolsa-verdura', 'tortilla-harina', 'tortilla-maiz') then
    if not p_empaque then return next; return; end if;
    ok := true; cat := 'empaque';
    precio := case when p_key = 'verdura-aparte' then 0 else coalesce((cfg.precios->>p_key)::numeric, 0) end;
    nombre := case p_key when 'verdura-aparte' then 'Verdura aparte (sin costo)'
                         when 'bolsa-verdura' then 'Bolsa de verdura (zanahoria, pepino, limón)'
                         when 'tortilla-harina' then 'Tortillas extra (harina)' else 'Tortillas extra (maíz)' end;
    corto := case p_key when 'verdura-aparte' then 'Verdura aparte' when 'bolsa-verdura' then 'Bolsa de verdura'
                        when 'tortilla-harina' then 'Tortillas harina' else 'Tortillas maíz' end;
    return next; return;
  end if;
  if p_empaque then return next; return; end if;
  if coalesce(cfg.ocultos, '[]'::jsonb) ? p_key then return next; return; end if;

  if p_key like 'beb-%' then
    select * into v_beb from public.bebidas where id = substr(p_key, 5) and activo is not false;
    if found then
      ok := true; nombre := v_beb.nombre; cat := 'bebida'; precio := coalesce(v_beb.precio, 0); inv_id := v_beb.id;
    end if;
    return next; return;
  end if;

  if p_key like 'extra-%' then
    select x into e from jsonb_array_elements(coalesce(cfg.extras, '[]'::jsonb)) x
     where x->>'id' = substr(p_key, 7) and coalesce((x->>'activo')::boolean, true) limit 1;
    if e is not null and e->>'cat' in ('taco', 'quesa', 'volcan', 'costra') then
      ok := true; nombre := e->>'nombre'; cat := e->>'cat'; precio := coalesce((e->>'precio')::numeric, 0);
    end if;
    return next; return;
  end if;

  if p_key in ('quesa-maiz-queso', 'quesa-queso', 'volcan-queso', 'costra-queso', 'media-costra-queso') then
    ok := true;
    nombre := case p_key when 'quesa-maiz-queso' then 'Quesadilla de maíz (queso)' when 'quesa-queso' then 'Quesadilla de queso'
                         when 'volcan-queso' then 'Volcán de queso' when 'costra-queso' then 'Costra de queso'
                         else 'Media costra de queso' end;
    cat := case p_key when 'quesa-maiz-queso' then 'taco' when 'quesa-queso' then 'quesa'
                      when 'volcan-queso' then 'volcan' else 'costra' end;
    precio := coalesce((cfg.precios->>p_key)::numeric, 0);
    return next; return;
  end if;

  foreach v_pref in array array['taco-queso-', 'taco-', 'gringa-', 'llenadora-', 'volcan-', 'media-costra-', 'costra-'] loop
    if left(p_key, length(v_pref)) = v_pref then
      v_resto := substr(p_key, length(v_pref) + 1);
      select * into v_carne from public.carnes where id = v_resto and activo is not false;
      if found then
        v_label := case v_pref when 'taco-queso-' then 'Taco de queso' when 'taco-' then 'Taco' when 'gringa-' then 'Gringa'
                               when 'llenadora-' then 'Llenadora' when 'volcan-' then 'Volcán'
                               when 'media-costra-' then 'Media costra' else 'Costra' end;
        v_cat := case v_pref when 'taco-queso-' then 'taco' when 'taco-' then 'taco' when 'gringa-' then 'quesa'
                             when 'llenadora-' then 'quesa' when 'volcan-' then 'volcan' else 'costra' end;
        ok := true; nombre := v_label || ' ' || v_carne.nombre; cat := v_cat;
        precio := coalesce((cfg.precios->>p_key)::numeric, 0);
      end if;
      return next; return;
    end if;
  end loop;
  return next;
end $$;

-- Convierte la lista de productos del cliente en la versión con precios del servidor
create or replace function public._valorar_items(p_items jsonb, p_empaque boolean)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_res jsonb := '[]'::jsonb; it jsonb; r record; v_cant int;
begin
  if p_items is null or jsonb_typeof(p_items) = 'null' then return v_res; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then
    perform public._error('DATOS', 'La comanda tiene un formato no válido.');
  end if;
  for it in select x from jsonb_array_elements(p_items) x loop
    if coalesce(it->>'cantidad', '') !~ '^[0-9]{1,3}$' or (it->>'cantidad')::int < 1 then
      perform public._error('DATOS', 'Cantidad no válida en ' || coalesce(it->>'nombre', it->>'key', 'un producto') || '.');
    end if;
    v_cant := (it->>'cantidad')::int;
    select * into r from public._resolver_item(it->>'key', p_empaque);
    if not r.ok then
      perform public._error('PRODUCTO', coalesce(it->>'nombre', it->>'key', 'Un producto')
        || ' ya no está disponible. Quítalo de la comanda e inténtalo de nuevo.');
    end if;
    v_res := v_res || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'key', it->>'key', 'nombre', r.nombre, 'corto', r.corto, 'cat', r.cat,
      'precio', round(r.precio, 2), 'cantidad', v_cant, 'invId', r.inv_id)));
  end loop;
  return v_res;
end $$;

create or replace function public._total_items(p_items jsonb)
returns numeric language sql immutable set search_path = public as $$
  select coalesce(sum((i->>'precio')::numeric * (i->>'cantidad')::numeric), 0)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i;
$$;

-- Aviso de cambios por Realtime Broadcast: solo el nombre de la tabla, nunca datos
create or replace function public._avisar_cambio()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform realtime.send(jsonb_build_object('t', tg_table_name), 'cambio', 'tequeria', false);
  exception when others then null;
  end;
  return null;
end $$;

-- ---------------------------------------------------------------------
--  API PÚBLICA: login y sesión
-- ---------------------------------------------------------------------
-- Pantalla de entrada: nombres para elegir usuario (sin roles ni datos del negocio)
create or replace function public.usuarios_login()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'negocio', coalesce((select nombre_negocio from public.config where id = 1), 'La Tequería'),
    'usuarios', coalesce((select json_agg(json_build_object('id', id, 'nombre', nombre) order by nombre)
                            from public.usuarios), '[]'::json),
    'hayAdmin', exists (select 1 from public.usuarios where rol = 'admin'));
$$;

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

  -- Una sola cocina activa: otro dispositivo con latido reciente la conserva
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

create or replace function public.logout(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_sid uuid;
begin
  update public.sesiones set revocada = true
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and not revocada
  returning id into v_sid;
  if v_sid is not null then
    update public.cocina_sesion set session_id = null where id = 1 and session_id = v_sid::text;
  end if;
end $$;

create or replace function public.cambiar_pin(p_token text, p_pin_actual text, p_pin_nuevo text)
returns json language plpgsql security definer set search_path = public as $$
declare s record; u public.usuarios; v_espera int; v_rest int;
begin
  select * into s from public._sesion(p_token);
  v_espera := public._espera('s:' || s.sid);
  if v_espera > 0 then return json_build_object('ok', false, 'error', 'bloqueado', 'espera', v_espera); end if;
  select * into u from public.usuarios where id = s.uid;
  if not public._pin_ok(u.pin_hash, p_pin_actual, u.id) then
    v_rest := public._fallo('s:' || s.sid, 5);
    return json_build_object('ok', false, 'error', 'pin', 'restantes', v_rest);
  end if;
  if not public._pin_formato_ok(p_pin_nuevo) then
    return json_build_object('ok', false, 'error', 'formato');
  end if;
  if public._pin_debil(p_pin_nuevo) or p_pin_nuevo = p_pin_actual then
    return json_build_object('ok', false, 'error', 'debil');
  end if;
  perform public._limpiar_intentos('s:' || s.sid);
  update public.usuarios set pin_hash = public._hash_pin(p_pin_nuevo), debe_cambiar_pin = false where id = u.id;
  update public.sesiones set revocada = true where usuario_id = u.id and id <> s.sid;
  perform public._log(s.uid, s.nombre, 'cambiar_pin');
  return json_build_object('ok', true);
end $$;

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
      'ocultos', coalesce(cfg.ocultos, '[]'::jsonb));
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
      'detalle', detalle) order by created_at desc) from (
        select * from public.cortes order by created_at desc limit 60) c), '[]'::jsonb));
  end if;
  if s.rol = 'admin' and (todo or 'gastos' = any(p_partes)) then
    r := r || jsonb_build_object('gastos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'concepto', concepto,
      'monto', coalesce(monto, 0), 'fecha', fecha, 'hora', hora, 'user', usuario) order by created_at desc)
      from public.gastos where corte_id is null), '[]'::jsonb));
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------
--  API: mesas y comandas
-- ---------------------------------------------------------------------
create or replace function public.guardar_borrador_mesa(p_token text, p_mesa_id int, p_pedido jsonb, p_version int default null)
returns json language plpgsql security definer set search_path = public as $$
declare s record; m public.mesas; v_items int;
begin
  select * into s from public._exigir(p_token, array['mesero', 'admin']);
  select * into m from public.mesas where id = p_mesa_id for update;
  if m.id is null then perform public._error('MESA', 'La mesa no existe.'); end if;
  if m.estado = 'ocupada' then
    perform public._error('MESA_OCUPADA', 'La mesa ya tiene una comanda enviada. Usa «Agregar orden extra».');
  end if;
  if p_version is not null and coalesce(m.version, 0) <> p_version then
    perform public._error('CONFLICTO', 'Otro dispositivo cambió esta mesa. Revisa el borrador antes de guardar.');
  end if;
  if p_pedido is not null and (jsonb_typeof(p_pedido->'ordenes') <> 'array' or pg_column_size(p_pedido) > 65536) then
    perform public._error('DATOS', 'El borrador tiene un formato no válido.');
  end if;
  select count(*) into v_items
    from jsonb_array_elements(coalesce(p_pedido->'ordenes', '[]'::jsonb)) o,
         jsonb_array_elements(coalesce(o->'items', '[]'::jsonb)) i;
  if v_items = 0 then
    update public.mesas set estado = 'libre', pedido = null, mesero = null, hora = null, extras = '[]'::jsonb,
           version = coalesce(version, 0) + 1
     where id = m.id returning * into m;
  else
    update public.mesas set estado = 'borrador', pedido = p_pedido, mesero = s.nombre, hora = public._hora(),
           version = coalesce(version, 0) + 1
     where id = m.id returning * into m;
  end if;
  return public._mesa_json(m);
end $$;

create or replace function public.liberar_mesa(p_token text, p_mesa_id int)
returns json language plpgsql security definer set search_path = public as $$
declare s record; m public.mesas;
begin
  select * into s from public._exigir(p_token, array['mesero', 'admin']);
  select * into m from public.mesas where id = p_mesa_id for update;
  if m.id is null then perform public._error('MESA', 'La mesa no existe.'); end if;
  if m.estado = 'ocupada' then
    perform public._log(s.uid, s.nombre, 'liberar_mesa', jsonb_build_object('mesa', m.id, 'mesero', m.mesero));
  end if;
  update public.mesas set estado = 'libre', pedido = null, mesero = null, hora = null, extras = '[]'::jsonb,
         version = coalesce(version, 0) + 1
   where id = m.id returning * into m;
  return public._mesa_json(m);
end $$;

-- Envío atómico: valida, cobra con precios del servidor, descuenta existencias,
-- actualiza la mesa y crea el ticket. Repetir con el mismo id no duplica nada.
create or replace function public.enviar_comanda(p_token text, p_ticket jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  s record; t public.tickets; m public.mesas;
  v_id text := p_ticket->>'id';
  v_tipo text := p_ticket->>'tipo';
  v_extra boolean := coalesce((p_ticket->>'esExtra')::boolean, false);
  v_mesa int; v_llevar boolean := coalesce((p_ticket->>'paraLlevar')::boolean, false);
  v_cuenta text := case when p_ticket->>'cuenta' = 'separada' then 'separada' else 'junta' end;
  v_ref text := nullif(left(btrim(coalesce(p_ticket->>'referencia', '')), 60), '');
  v_dom jsonb; v_ordenes jsonb := '[]'::jsonb; v_extras jsonb; v_total numeric; v_origen text;
  o jsonb; n int := 0; v_items jsonb; b record; v_hora text := public._hora();
begin
  select * into s from public._exigir(p_token, array['mesero', 'admin']);
  if v_id is null or v_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    perform public._error('DATOS', 'Identificador de comanda no válido.');
  end if;

  -- Idempotencia: el mismo id devuelve el ticket ya guardado
  perform pg_advisory_xact_lock(hashtextextended('tequeria:ticket:' || v_id, 0));
  select * into t from public.tickets where id = v_id;
  if t.id is not null then
    return json_build_object('ok', true, 'duplicado', true, 'ticket', public._ticket_json(t));
  end if;

  if v_extra then v_tipo := 'aqui'; end if;
  if v_tipo not in ('aqui', 'llevar', 'domicilio') then perform public._error('DATOS', 'Tipo de comanda no válido.'); end if;
  if jsonb_typeof(p_ticket->'ordenes') <> 'array' or jsonb_array_length(p_ticket->'ordenes') > 30 then
    perform public._error('DATOS', 'La comanda tiene un formato no válido.');
  end if;

  for o in select x from jsonb_array_elements(p_ticket->'ordenes') x loop
    if jsonb_typeof(o->'items') <> 'array' then perform public._error('DATOS', 'La comanda tiene un formato no válido.'); end if;
    n := n + 1;
    v_items := public._valorar_items(o->'items', false);
    if jsonb_array_length(v_items) > 0 then
      v_ordenes := v_ordenes || jsonb_build_array(jsonb_build_object(
        'id', left(coalesce(nullif(o->>'id', ''), md5(random()::text)), 40),
        'nombre', left(coalesce(nullif(btrim(o->>'nombre'), ''), 'Orden ' || n), 40),
        'prep', case when o->>'prep' in ('con-todo', 'natural', 'cilantro', 'cebolla') then o->>'prep' else 'con-todo' end,
        'items', v_items));
    end if;
  end loop;
  v_extras := public._valorar_items(p_ticket->'extras', true);
  if jsonb_array_length(v_ordenes) = 0 and jsonb_array_length(v_extras) = 0 then
    perform public._error('VACIO', 'Agrega al menos un producto.');
  end if;
  v_total := (select coalesce(sum(public._total_items(x->'items')), 0) from jsonb_array_elements(v_ordenes) x)
             + public._total_items(v_extras);

  if v_tipo = 'domicilio' then
    v_dom := p_ticket->'domicilio';
    if v_dom is null or btrim(coalesce(v_dom->>'direccion', '')) = '' or btrim(coalesce(v_dom->>'telefono', '')) = '' then
      perform public._error('DOMICILIO', 'Captura dirección y teléfono del domicilio.');
    end if;
    if coalesce(v_dom->>'telefono', '') !~ '^[0-9 +()-]{7,20}$' then
      perform public._error('DOMICILIO', 'El teléfono debe tener entre 7 y 20 dígitos.');
    end if;
    v_dom := jsonb_build_object(
      'nombre', left(btrim(coalesce(v_dom->>'nombre', '')), 80), 'direccion', left(btrim(v_dom->>'direccion'), 200),
      'referencia', left(btrim(coalesce(v_dom->>'referencia', '')), 200), 'telefono', btrim(v_dom->>'telefono'),
      'pago', case when v_dom->>'pago' in ('efectivo', 'tarjeta', 'transferencia') then v_dom->>'pago' else 'efectivo' end,
      'tiempo', left(regexp_replace(coalesce(v_dom->>'tiempo', ''), '[^0-9]', '', 'g'), 3));
    v_origen := coalesce(nullif(v_dom->>'nombre', ''), 'Domicilio');
  elsif v_tipo = 'llevar' then
    v_origen := 'Para llevar' || coalesce(' · ' || v_ref, '');
  end if;

  -- Existencias: descuento atómico; si no alcanza, nada se guarda
  for b in
    select i->>'invId' as id, sum((i->>'cantidad')::int) as q
      from jsonb_array_elements(v_ordenes) x, jsonb_array_elements(x->'items') i
     where i->>'invId' is not null group by 1 order by 1
  loop
    update public.bebidas set cantidad = cantidad - b.q where id = b.id and cantidad >= b.q;
    if not found then
      perform public._error('SIN_EXISTENCIA', (select format('No hay suficiente %s (quedan %s).', nombre, coalesce(cantidad, 0))
                                               from public.bebidas where id = b.id));
    end if;
  end loop;

  if v_tipo = 'aqui' then
    if coalesce(p_ticket->>'mesaId', '') !~ '^[0-9]{1,4}$' then perform public._error('MESA', 'Falta la mesa de la comanda.'); end if;
    v_mesa := (p_ticket->>'mesaId')::int;
    select * into m from public.mesas where id = v_mesa for update;
    if m.id is null then perform public._error('MESA', 'La mesa no existe.'); end if;
    v_origen := 'Mesa ' || m.id;
    if v_extra then
      if m.estado <> 'ocupada' then
        perform public._error('MESA_NO_OCUPADA', 'La mesa ya no tiene una comanda abierta. Envíala como comanda nueva.');
      end if;
      update public.mesas set extras = coalesce(extras, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
               'id', v_id, 'ordenes', v_ordenes, 'extras', v_extras, 'hora', v_hora, 'total', v_total)),
             version = coalesce(version, 0) + 1
       where id = m.id;
    else
      if m.estado = 'ocupada' then
        perform public._error('MESA_OCUPADA', 'Otro dispositivo ya envió una comanda para esta mesa. Usa «Agregar orden extra».');
      end if;
      update public.mesas set estado = 'ocupada', pedido = jsonb_build_object('ordenes', v_ordenes, 'extras', v_extras),
             mesero = s.nombre, hora = v_hora, extras = '[]'::jsonb, version = coalesce(version, 0) + 1
       where id = m.id;
    end if;
  end if;

  insert into public.tickets (id, tipo, es_extra, origen, mesa_id, ordenes, extras, mesero, hora, fecha, estado,
                              archivado_cocina, total, domicilio, reenvio, cuenta, para_llevar, referencia, creado_por)
  values (v_id, v_tipo, v_extra, v_origen, v_mesa, v_ordenes, v_extras, s.nombre, v_hora, public._fecha(), 'pendiente',
          false, v_total, v_dom, false, v_cuenta, v_tipo = 'aqui' and not v_extra and v_llevar,
          case when v_tipo = 'llevar' then v_ref end, s.uid)
  returning * into t;
  return json_build_object('ok', true, 'ticket', public._ticket_json(t));
end $$;

-- Reimprime en cocina lo enviado de una mesa (no cuenta como venta)
create or replace function public.reenviar_cocina(p_token text, p_id text, p_mesa_id int)
returns json language plpgsql security definer set search_path = public as $$
declare s record; m public.mesas; t public.tickets; v_ordenes jsonb; v_extras jsonb;
begin
  select * into s from public._exigir(p_token, array['mesero', 'admin']);
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{8,64}$' then perform public._error('DATOS', 'Identificador no válido.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('tequeria:ticket:' || p_id, 0));
  select * into t from public.tickets where id = p_id;
  if t.id is not null then return json_build_object('ok', true, 'duplicado', true, 'ticket', public._ticket_json(t)); end if;
  select * into m from public.mesas where id = p_mesa_id;
  if m.id is null or m.estado <> 'ocupada' then
    perform public._error('MESA_NO_OCUPADA', 'Solo se puede reenviar una mesa con comanda enviada.');
  end if;
  select coalesce(m.pedido->'ordenes', '[]'::jsonb) || coalesce(jsonb_agg(o) filter (where o is not null), '[]'::jsonb)
    into v_ordenes from jsonb_array_elements(coalesce(m.extras, '[]'::jsonb)) e
    left join lateral jsonb_array_elements(coalesce(e->'ordenes', '[]'::jsonb)) o on true;
  select coalesce(m.pedido->'extras', '[]'::jsonb) || coalesce(jsonb_agg(x) filter (where x is not null), '[]'::jsonb)
    into v_extras from jsonb_array_elements(coalesce(m.extras, '[]'::jsonb)) e
    left join lateral jsonb_array_elements(coalesce(e->'extras', '[]'::jsonb)) x on true;
  if jsonb_array_length(v_ordenes) = 0 then perform public._error('VACIO', 'La mesa no tiene nada que reenviar.'); end if;
  insert into public.tickets (id, tipo, es_extra, origen, mesa_id, ordenes, extras, mesero, hora, fecha, estado,
                              archivado_cocina, total, reenvio, creado_por)
  values (p_id, 'aqui', false, 'Mesa ' || m.id, m.id, v_ordenes, v_extras, coalesce(m.mesero, s.nombre), public._hora(),
          public._fecha(), 'pendiente', false, 0, true, s.uid)
  returning * into t;
  return json_build_object('ok', true, 'ticket', public._ticket_json(t));
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
  update public.tickets set estado = p_estado where id = p_id;
end $$;

create or replace function public.archivar_ticket(p_token text, p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._exigir(p_token, array['cocinero', 'admin']);
  update public.tickets set archivado_cocina = true where id = p_id and estado = 'listo';
  if not found then perform public._error('TICKET', 'Solo se pueden quitar comandas marcadas como listas.'); end if;
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
  if not exists (select 1 from public.tickets where corte_id is null and reenvio is not true) then
    return json_build_object('ok', false, 'error', 'vacio');
  end if;
  update public.tickets set corte_id = v_id where corte_id is null;
  update public.gastos set corte_id = v_id where corte_id is null;
  v_res := public._resumen(v_id);

  insert into public.cortes (id, fecha, hora, tickets, total, gastos, detalle, hecho_por, autorizado_por)
  values (v_id, public._fecha(), public._hora(), (v_res->>'count')::int, (v_res->>'total')::numeric,
          (v_res->>'gastos')::numeric,
          jsonb_build_object('porTipo', v_res->'porTipo', 'porMesero', v_res->'porMesero', 'top', v_res->'top',
                             'gastos', v_res->'gastos'),
          s.uid, v_auth->>'id');
  perform public._log(s.uid, s.nombre, 'corte', jsonb_build_object('corte', v_id, 'autorizo', v_auth->>'nombre',
                      'tickets', v_res->'count', 'total', v_res->'total'));

  -- Retención: anonimiza domicilios de cortes antiguos
  select coalesce(retencion_domicilio_dias, 90) into v_ret from public.config where id = 1;
  update public.tickets set domicilio = jsonb_build_object('anonimizado', true, 'pago', domicilio->>'pago')
   where domicilio is not null and not (domicilio ? 'anonimizado') and corte_id is not null
     and created_at < now() - make_interval(days => coalesce(v_ret, 90));

  return json_build_object('ok', true, 'corte', jsonb_build_object('id', v_id, 'tickets', v_res->'count',
    'total', v_res->'total', 'gastos', v_res->'gastos', 'autorizo', v_auth->>'nombre'));
end $$;

-- ---------------------------------------------------------------------
--  API: inventario, catálogo y precios (administrador)
-- ---------------------------------------------------------------------
create or replace function public._precio_ok(p numeric) returns numeric language plpgsql immutable set search_path = public as $$
begin
  if p is null or p < 0 or p > 100000 then perform public._error('DATOS', 'Precio no válido.'); end if;
  return round(p, 2);
end $$;

create or replace function public.ajustar_bebida(p_token text, p_id text, p_delta int)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._exigir(p_token, array['admin']);
  if p_delta is null or abs(p_delta) > 10000 then perform public._error('DATOS', 'Cantidad no válida.'); end if;
  update public.bebidas set cantidad = greatest(0, coalesce(cantidad, 0) + p_delta) where id = p_id;
end $$;

create or replace function public.actualizar_bebida(p_token text, p_id text, p_cambios jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare s record; v_nombre text;
begin
  select * into s from public._exigir(p_token, array['admin']);
  if p_cambios ? 'cantidad' and coalesce(p_cambios->>'cantidad', '') !~ '^[0-9]{1,6}$' then
    perform public._error('DATOS', 'Existencia no válida.');
  end if;
  v_nombre := nullif(left(btrim(coalesce(p_cambios->>'nombre', '')), 60), '');
  update public.bebidas set
    nombre = coalesce(v_nombre, nombre),
    activo = case when p_cambios ? 'activo' then (p_cambios->>'activo')::boolean else activo end,
    precio = case when p_cambios ? 'precio' then public._precio_ok((p_cambios->>'precio')::numeric) else precio end,
    cantidad = case when p_cambios ? 'cantidad' then (p_cambios->>'cantidad')::int else cantidad end
  where id = p_id;
  if p_cambios ? 'precio' then
    perform public._log(s.uid, s.nombre, 'precio_bebida', jsonb_build_object('id', p_id, 'precio', p_cambios->'precio'));
  end if;
end $$;

create or replace function public.agregar_bebida(p_token text, p_nombre text, p_precio numeric, p_cantidad int)
returns json language plpgsql security definer set search_path = public as $$
declare s record; v_id text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10); v_nombre text := left(btrim(coalesce(p_nombre, '')), 60);
begin
  select * into s from public._exigir(p_token, array['admin']);
  if v_nombre = '' then perform public._error('DATOS', 'Escribe el nombre de la bebida.'); end if;
  if p_cantidad is null or p_cantidad < 0 or p_cantidad > 100000 then perform public._error('DATOS', 'Existencia no válida.'); end if;
  insert into public.bebidas (id, nombre, cantidad, activo, precio) values (v_id, v_nombre, p_cantidad, true, public._precio_ok(p_precio));
  return json_build_object('id', v_id);
end $$;

create or replace function public.eliminar_bebida(p_token text, p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._exigir(p_token, array['admin']);
  delete from public.bebidas where id = p_id;
  perform public._log(s.uid, s.nombre, 'eliminar_bebida', jsonb_build_object('id', p_id));
end $$;

create or replace function public.actualizar_carne(p_token text, p_id text, p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._exigir(p_token, array['admin']);
  update public.carnes set activo = coalesce(p_activo, true) where id = p_id;
end $$;

create or replace function public.agregar_carne(p_token text, p_nombre text)
returns json language plpgsql security definer set search_path = public as $$
declare s record; v_nombre text := left(btrim(coalesce(p_nombre, '')), 40); v_id text;
begin
  select * into s from public._exigir(p_token, array['admin']);
  if v_nombre = '' then perform public._error('DATOS', 'Escribe el nombre de la carne.'); end if;
  v_id := trim(both '-' from regexp_replace(translate(lower(v_nombre), 'áéíóúüñàèìòù', 'aeiouunaeiou'), '[^a-z0-9]+', '-', 'g'));
  if v_id = '' then v_id := substr(md5(random()::text), 1, 8); end if;
  if exists (select 1 from public.carnes where id = v_id) then perform public._error('DUPLICADO', 'Esa carne ya existe.'); end if;
  insert into public.carnes (id, nombre, activo, orden)
  values (v_id, v_nombre, true, coalesce((select max(orden) + 1 from public.carnes), 0));
  -- precios por defecto en la misma transacción (los existentes se conservan)
  update public.config set precios = jsonb_build_object(
      'taco-' || v_id, 20, 'taco-queso-' || v_id, 30, 'gringa-' || v_id, 45, 'llenadora-' || v_id, 55,
      'volcan-' || v_id, 40, 'costra-' || v_id, 50, 'media-costra-' || v_id, 28) || coalesce(precios, '{}'::jsonb)
   where id = 1;
  return json_build_object('id', v_id);
end $$;

create or replace function public.eliminar_carne(p_token text, p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._exigir(p_token, array['admin']);
  delete from public.carnes where id = p_id;
  perform public._log(s.uid, s.nombre, 'eliminar_carne', jsonb_build_object('id', p_id));
end $$;

create or replace function public.fijar_precio(p_token text, p_clave text, p_precio numeric)
returns void language plpgsql security definer set search_path = public as $$
declare s record; v numeric;
begin
  select * into s from public._exigir(p_token, array['admin']);
  if p_clave is null or p_clave !~ '^[a-z0-9-]{1,80}$' then perform public._error('DATOS', 'Producto no válido.'); end if;
  v := public._precio_ok(p_precio);
  update public.config set precios = jsonb_set(coalesce(precios, '{}'::jsonb), array[p_clave], to_jsonb(v)) where id = 1;
  perform public._log(s.uid, s.nombre, 'precio', jsonb_build_object('clave', p_clave, 'precio', v));
end $$;

create or replace function public.fijar_precio_extra(p_token text, p_id text, p_precio numeric)
returns void language plpgsql security definer set search_path = public as $$
declare s record; v numeric;
begin
  select * into s from public._exigir(p_token, array['admin']);
  v := public._precio_ok(p_precio);
  update public.config set extras = coalesce((select jsonb_agg(case when e->>'id' = p_id then jsonb_set(e, '{precio}', to_jsonb(v)) else e end)
                                              from jsonb_array_elements(coalesce(extras, '[]'::jsonb)) e), '[]'::jsonb)
   where id = 1;
  perform public._log(s.uid, s.nombre, 'precio', jsonb_build_object('extra', p_id, 'precio', v));
end $$;

create or replace function public.agregar_extra(p_token text, p_cat text, p_nombre text, p_precio numeric)
returns json language plpgsql security definer set search_path = public as $$
declare s record; v_id text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10); v_nombre text := left(btrim(coalesce(p_nombre, '')), 60);
begin
  select * into s from public._exigir(p_token, array['admin']);
  if p_cat not in ('taco', 'quesa', 'volcan', 'costra') then perform public._error('DATOS', 'Categoría no válida.'); end if;
  if v_nombre = '' then perform public._error('DATOS', 'Escribe el nombre del producto.'); end if;
  update public.config set extras = coalesce(extras, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'id', v_id, 'nombre', v_nombre, 'cat', p_cat, 'precio', public._precio_ok(p_precio), 'activo', true))
   where id = 1;
  return json_build_object('id', v_id);
end $$;

create or replace function public.eliminar_extra(p_token text, p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._exigir(p_token, array['admin']);
  update public.config set extras = coalesce((select jsonb_agg(e) from jsonb_array_elements(coalesce(extras, '[]'::jsonb)) e
                                              where e->>'id' is distinct from p_id), '[]'::jsonb)
   where id = 1;
end $$;

create or replace function public.alternar_oculto(p_token text, p_clave text)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public._exigir(p_token, array['admin']);
  if p_clave is null or p_clave !~ '^[A-Za-z0-9_-]{1,80}$' then perform public._error('DATOS', 'Producto no válido.'); end if;
  update public.config set ocultos = case when coalesce(ocultos, '[]'::jsonb) ? p_clave
                                         then coalesce(ocultos, '[]'::jsonb) - p_clave
                                         else coalesce(ocultos, '[]'::jsonb) || to_jsonb(p_clave) end
   where id = 1;
end $$;

-- ---------------------------------------------------------------------
--  API: gastos (administrador)
-- ---------------------------------------------------------------------
create or replace function public.agregar_gasto(p_token text, p_id text, p_concepto text, p_monto numeric)
returns void language plpgsql security definer set search_path = public as $$
declare s record; v_concepto text := left(btrim(coalesce(p_concepto, '')), 120);
begin
  select * into s from public._exigir(p_token, array['admin']);
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{8,64}$' then perform public._error('DATOS', 'Identificador no válido.'); end if;
  if v_concepto = '' then perform public._error('DATOS', 'Escribe el concepto del gasto.'); end if;
  if p_monto is null or p_monto <= 0 or p_monto > 1000000 then perform public._error('DATOS', 'El monto debe ser mayor a cero.'); end if;
  insert into public.gastos (id, concepto, monto, fecha, hora, usuario, creado_por)
  values (p_id, v_concepto, round(p_monto, 2), public._fecha(), public._hora(), s.nombre, s.uid)
  on conflict (id) do nothing;
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

-- ---------------------------------------------------------------------
--  API: usuarios (administrador + su propio PIN)
-- ---------------------------------------------------------------------
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

create or replace function public.eliminar_usuario(p_token text, p_admin_pin text, p_id text)
returns json language plpgsql security definer set search_path = public as $$
declare s record; v_auth json; u public.usuarios; v_admins int;
begin
  select * into s from public._exigir(p_token, array['admin']);
  v_auth := public._verificar_admin(p_admin_pin, s.sid, s.uid);
  if not (v_auth->>'ok')::boolean then return v_auth; end if;
  if p_id = s.uid then return json_build_object('ok', false, 'error', 'propio'); end if;
  -- bloquea a todos los administradores para que dos bajas simultáneas no dejen cero
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

create or replace function public.restablecer_pin(p_token text, p_admin_pin text, p_id text, p_pin_nuevo text)
returns json language plpgsql security definer set search_path = public as $$
declare s record; v_auth json; u public.usuarios;
begin
  select * into s from public._exigir(p_token, array['admin']);
  v_auth := public._verificar_admin(p_admin_pin, s.sid, s.uid);
  if not (v_auth->>'ok')::boolean then return v_auth; end if;
  select * into u from public.usuarios where id = p_id;
  if u.id is null then return json_build_object('ok', false, 'error', 'no_existe'); end if;
  if not public._pin_formato_ok(p_pin_nuevo) then return json_build_object('ok', false, 'error', 'formato'); end if;
  -- El usuario deberá elegir su propio PIN al entrar
  update public.usuarios set pin_hash = public._hash_pin(p_pin_nuevo), debe_cambiar_pin = (u.id <> s.uid) or public._pin_debil(p_pin_nuevo)
   where id = u.id;
  update public.sesiones set revocada = true where usuario_id = u.id and id <> s.sid;
  perform public._limpiar_intentos('u:' || u.id);
  perform public._log(s.uid, s.nombre, 'restablecer_pin', jsonb_build_object('id', u.id, 'nombre', u.nombre));
  return json_build_object('ok', true);
end $$;

-- Alta del primer administrador. NO se expone a la API: ejecútala en el SQL Editor:
--   select public.crear_admin_inicial('Tu nombre', 'PIN de 4 a 8 dígitos');
create or replace function public.crear_admin_inicial(p_nombre text, p_pin text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
begin
  if exists (select 1 from public.usuarios where rol = 'admin') then
    raise exception 'Ya existe un administrador; crea más usuarios desde la app.';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' then raise exception 'Escribe un nombre.'; end if;
  if not public._pin_formato_ok(p_pin) or public._pin_debil(p_pin) then
    raise exception 'Usa un PIN de 4 a 8 dígitos que no sea trivial (no 1234, 1111, etc.).';
  end if;
  insert into public.usuarios (id, nombre, rol, pin_hash) values (v_id, left(btrim(p_nombre), 40), 'admin', public._hash_pin(p_pin));
  perform public._log(null, 'SQL Editor', 'crear_admin_inicial', jsonb_build_object('id', v_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------------
--  TIEMPO REAL: aviso por Broadcast (sin datos) en lugar de postgres_changes
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['config','carnes','bebidas','usuarios','mesas','tickets','cortes','gastos'] loop
    execute format('drop trigger if exists avisar_cambio on public.%I', t);
    execute format('create trigger avisar_cambio after insert or update or delete on public.%I
                    for each statement execute function public._avisar_cambio()', t);
    begin
      execute format('alter publication supabase_realtime drop table public.%I', t);
    exception when others then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  PERMISOS: nada directo para anon/authenticated; solo las funciones de la API
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['config','carnes','bebidas','usuarios','mesas','tickets','cortes','gastos',
                           'cocina_sesion','sesiones','intentos','bitacora'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists rw_all on public.%I', t);
    execute format('drop policy if exists usuarios_sel on public.%I', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.bitacora_id_seq from public, anon, authenticated;

-- Tabla de la versión 1 (estado en un solo bloque): ya no se usa; se cierra sin borrarla
do $$
begin
  if to_regclass('public.app_state') is not null then
    execute 'alter table public.app_state enable row level security';
    execute 'revoke all on public.app_state from public, anon, authenticated';
    begin
      execute 'alter publication supabase_realtime drop table public.app_state';
    exception when others then null;
    end;
  end if;
end $$;

do $$
declare f record;
begin
  -- Ninguna función del esquema es ejecutable por defecto…
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

-- …salvo la API, que valida sesión y rol por dentro.
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

-- Después de ejecutar, si es una instalación nueva (sin usuarios):
--   select public.crear_admin_inicial('Tu nombre', 'tu PIN');
