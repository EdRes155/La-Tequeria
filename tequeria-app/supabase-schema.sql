-- =====================================================================
--  LA TEQUERÍA — Esquema para Supabase
--  Copia y pega TODO esto en: Supabase  ->  SQL Editor  ->  New query  ->  Run
-- =====================================================================

-- 1) Tabla que guarda todo el estado de la app (un solo renglón, id = 1)
create table if not exists public.app_state (
  id          int primary key,
  data        jsonb not null,
  rev         text,
  updated_at  timestamptz default now()
);

-- 2) Para que el tiempo real envíe el contenido completo en cada cambio
alter table public.app_state replica identity full;

-- 3) Seguridad a nivel de fila (RLS).
--    Para una taquería de un solo negocio, permitimos acceso con la llave anon.
alter table public.app_state enable row level security;

drop policy if exists "app_state_select" on public.app_state;
drop policy if exists "app_state_insert" on public.app_state;
drop policy if exists "app_state_update" on public.app_state;

create policy "app_state_select" on public.app_state for select using (true);
create policy "app_state_insert" on public.app_state for insert with check (true);
create policy "app_state_update" on public.app_state for update using (true) with check (true);

-- 4) Activar Realtime para esta tabla
--    (si marca que ya existe, no pasa nada, ignóralo)
alter publication supabase_realtime add table public.app_state;
