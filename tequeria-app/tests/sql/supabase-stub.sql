-- Imita lo mínimo de un proyecto Supabase para probar el esquema en un PostgreSQL normal:
-- roles de la API, esquema "extensions" con pgcrypto, privilegios por defecto que concede
-- Supabase y una función realtime.send que registra los avisos en una tabla.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Tiempo real: realtime.messages con RLS (como en Supabase, las políticas deciden quién escucha y quién
-- publica), realtime.topic() (el canal que se está autorizando) y realtime.send, que registra el aviso.
create schema if not exists realtime;
create table if not exists realtime.messages (
  id bigserial primary key, topic text not null, extension text not null default 'broadcast', payload jsonb,
  event text, private boolean default false, inserted_at timestamptz not null default now()
);
alter table realtime.messages enable row level security;
grant usage on schema realtime to anon, authenticated;
grant select, insert, update, delete on realtime.messages to anon, authenticated;
grant usage, select on all sequences in schema realtime to anon, authenticated;
create or replace function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql security definer as $$
  insert into realtime.messages (topic, extension, payload, event, private) values (topic, 'broadcast', payload, event, private);
$$;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- Identidades de Supabase Auth: lo mínimo para las referencias y para auth.uid()
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  is_anonymous boolean not null default false,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  deleted_at timestamptz
);
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
$$;
