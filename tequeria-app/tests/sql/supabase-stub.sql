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

create schema if not exists realtime;
create table if not exists realtime.avisos (id bigserial primary key, payload jsonb, evento text, tema text, privado boolean, creado timestamptz default now());
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql as $$
  insert into realtime.avisos (payload, evento, tema, privado) values (payload, event, topic, private);
$$;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
