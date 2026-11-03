-- Lo que producción tiene además de tests/sql/esquema-v3.sql: la tabla de la versión 1 (app_state),
-- cerrada pero sin borrar (PLAN-MULTINEGOCIO.md, orden de limpieza). Solo la estructura, sin datos.
-- Con esto, esquema-v3.sql + este archivo dan la misma huella de esquema que producción el 3 de
-- noviembre de 2026 (scripts/catalogo-esquema.sql y scripts/huella-esquema.mjs; se comprueba en
-- tests/sql/migracion.test.js).
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
-- Así están en producción: abiertas (true), pero sin efecto porque anon y authenticated no tienen
-- ningún permiso sobre la tabla. Se eliminan en la limpieza final (MIGRACION.md §7).
create policy app_state_select on public.app_state for select using (true);
create policy app_state_insert on public.app_state for insert with check (true);
create policy app_state_update on public.app_state for update using (true) with check (true);
revoke all on public.app_state from public, anon, authenticated;

-- En producción la secuencia del folio no tiene permisos para anon ni authenticated. Al cargar
-- esquema-v3.sql en el simulador los recibe por sus privilegios por omisión; aquí se dejan como allá.
revoke all on sequence public.tickets_folio_seq from public, anon, authenticated;
