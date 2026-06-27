-- =====================================================================
--  LA TEQUERÍA — Esquema v2 (tablas separadas, RLS, tiempo real, login)
--  Pega TODO en: Supabase -> SQL Editor -> New query -> Run
--  Es seguro re-ejecutarlo (usa IF NOT EXISTS / OR REPLACE).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- TABLAS ----------
create table if not exists public.config (
  id int primary key default 1,
  nombre_negocio text default 'La Tequería',
  precios jsonb default '{}'::jsonb,
  extras  jsonb default '[]'::jsonb,
  ocultos jsonb default '[]'::jsonb
);

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

create table if not exists public.mesas (
  id int primary key, estado text default 'libre',
  mesero text, hora text, pedido jsonb, extras jsonb default '[]'::jsonb
);

create table if not exists public.tickets (
  id text primary key, tipo text, es_extra boolean default false,
  origen text, mesa_id int, ordenes jsonb default '[]'::jsonb, extras jsonb default '[]'::jsonb,
  mesero text, hora text, fecha text, estado text default 'pendiente',
  archivado_cocina boolean default false, total numeric default 0,
  domicilio jsonb, corte_id text, created_at timestamptz default now()
);

create table if not exists public.cortes (
  id text primary key, fecha text, hora text,
  tickets int, total numeric, created_at timestamptz default now()
);

create table if not exists public.gastos (
  id text primary key, concepto text, monto numeric,
  fecha text, hora text, usuario text, created_at timestamptz default now()
);

-- ---------- FUNCIONES (PIN cifrado, login y corte en el servidor) ----------
create or replace function public.login(p_id text, p_pin text)
returns table(id text, nombre text, rol text)
language sql security definer set search_path = public, extensions as $$
  select u.id, u.nombre, u.rol from public.usuarios u
  where u.id = p_id
    and u.pin_hash = encode(digest(p_pin || '|' || u.id, 'sha256'), 'hex');
$$;

create or replace function public.crear_usuario(p_id text, p_nombre text, p_pin text, p_rol text)
returns void language sql security definer set search_path = public, extensions as $$
  insert into public.usuarios(id, nombre, rol, pin_hash)
  values (p_id, p_nombre, coalesce(nullif(p_rol,''),'mesero'),
          encode(digest(p_pin || '|' || p_id, 'sha256'), 'hex'))
  on conflict (id) do update
    set nombre = excluded.nombre, rol = excluded.rol, pin_hash = excluded.pin_hash;
$$;

create or replace function public.eliminar_usuario(p_id text)
returns void language sql security definer set search_path = public, extensions as $$
  delete from public.usuarios where id = p_id;
$$;

create or replace function public.hacer_corte(p_id text, p_fecha text, p_hora text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_total numeric; v_count int;
begin
  select coalesce(sum(total),0), count(*) into v_total, v_count
    from public.tickets where corte_id is null;
  insert into public.cortes(id, fecha, hora, tickets, total)
    values (p_id, p_fecha, p_hora, v_count, v_total);
  update public.tickets set corte_id = p_id where corte_id is null;
end $$;

-- ---------- SEGURIDAD (RLS) ----------
alter table public.config   enable row level security;
alter table public.carnes   enable row level security;
alter table public.bebidas  enable row level security;
alter table public.usuarios enable row level security;
alter table public.mesas    enable row level security;
alter table public.tickets  enable row level security;
alter table public.cortes   enable row level security;
alter table public.gastos   enable row level security;

-- Operación del negocio (un solo local). Lectura/escritura con la llave anon,
-- EXCEPTO usuarios: su PIN nunca se expone; sólo se entra por la función login().
do $$
declare t text;
begin
  foreach t in array array['config','carnes','bebidas','mesas','tickets','cortes','gastos']
  loop
    execute format('drop policy if exists rw_all on public.%I', t);
    execute format('create policy rw_all on public.%I for all using (true) with check (true)', t);
  end loop;
end $$;

-- PERMISOS de tabla para el rol anon (RLS controla las filas; GRANT da el acceso).
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  public.config, public.carnes, public.bebidas, public.mesas,
  public.tickets, public.cortes, public.gastos
to anon, authenticated;

-- usuarios: sólo se pueden LEER id, nombre y rol (jamás el hash del PIN).
revoke all on public.usuarios from anon, authenticated;
grant select (id, nombre, rol) on public.usuarios to anon, authenticated;
drop policy if exists usuarios_sel on public.usuarios;
create policy usuarios_sel on public.usuarios for select using (true);

-- Las altas/bajas de usuarios y el login pasan por funciones controladas:
grant execute on function public.login(text,text)            to anon, authenticated;
grant execute on function public.crear_usuario(text,text,text,text) to anon, authenticated;
grant execute on function public.eliminar_usuario(text)      to anon, authenticated;
grant execute on function public.hacer_corte(text,text,text) to anon, authenticated;

-- ---------- TIEMPO REAL ----------
do $$
declare t text;
begin
  foreach t in array array['config','carnes','bebidas','usuarios','mesas','tickets','cortes','gastos']
  loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
