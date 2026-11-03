-- Lo que producción tiene además de tests/sql/esquema-v3.sql: la tabla de la versión 1 (app_state),
-- cerrada pero sin borrar (PLAN-MULTINEGOCIO.md, orden de limpieza). Solo la estructura, sin datos.
-- Con esto, esquema-v3.sql + este archivo dan la misma huella de esquema que producción el 3 de
-- noviembre de 2026 (scripts/huella-esquema.sql; se comprueba en tests/sql/migracion.test.js).
create table if not exists public.app_state (
  id integer primary key,
  data jsonb not null,
  rev text,
  updated_at timestamptz default now()
);
alter table public.app_state enable row level security;
drop policy if exists app_state_select on public.app_state;
drop policy if exists app_state_insert on public.app_state;
drop policy if exists app_state_update on public.app_state;
create policy app_state_select on public.app_state for select using (false);
create policy app_state_insert on public.app_state for insert with check (false);
create policy app_state_update on public.app_state for update using (false);
revoke all on public.app_state from public, anon, authenticated;
