-- =====================================================================
--  MULTINEGOCIO · CONTRACCIÓN DEL ESTADO DE COBRO (MIGRACION.md §4.3 y §4.5)
--  Parte de la contracción: va en la ventana del cambio, junto con las funciones que ya escriben
--  estado_cobro (paso 2). Requiere la expansión de supabase-schema.sql.
--
--  1. estado_cobro deja de calcularse a partir de cobro_id y conserva sus valores.
--  2. cobro_id queda solo con ids reales: «previo» y «no_cobrado» pasan a nulo (su estado ya está
--     guardado en el paso 1, por eso el orden importa).
--  3. Reglas: cobro_id existe si y solo si la comanda está cobrada, y apunta a un cobro de su misma
--     sucursal.
--
--  Guardia: si alguna función todavía usa los valores especiales de cobro_id o «cobro_id is null»
--  para saber qué falta cobrar, se aborta (contaría lo «previo» como pendiente). Solo para ensayar
--  la transformación de los datos en una base desechable se puede omitir con
--    set multinegocio.ensayo_solo_datos = 'si';
-- =====================================================================
begin;

do $$
declare v_funciones text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_funciones
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.prosrc ~* 'cobro_id\s+is\s+(not\s+)?null' or p.prosrc ~* '''(previo|no_cobrado)''');
  if v_funciones is not null and current_setting('multinegocio.ensayo_solo_datos', true) is distinct from 'si' then
    raise exception 'No se puede contraer el estado de cobro: estas funciones aún dependen de cobro_id: %', v_funciones;
  end if;
end $$;

do $$
begin
  -- 1. Deja de ser calculada (PostgreSQL 13 o posterior); si ya no lo es, no hace nada
  if exists (select 1 from pg_attribute where attrelid = 'public.tickets'::regclass and attname = 'estado_cobro' and attgenerated = 's') then
    alter table public.tickets alter column estado_cobro drop expression;
  end if;
end $$;
alter table public.tickets alter column estado_cobro set not null;
alter table public.tickets alter column estado_cobro set default 'pendiente';

-- 2. Solo ids reales en cobro_id
update public.tickets set cobro_id = null where cobro_id in ('previo', 'no_cobrado');

-- 3. Reglas
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tickets_estado_cobro_ck') then
    alter table public.tickets add constraint tickets_estado_cobro_ck
      check (estado_cobro in ('pendiente', 'cobrado', 'previo', 'no_cobrado') and (cobro_id is not null) = (estado_cobro = 'cobrado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tickets_cobro_fk') then
    alter table public.tickets add constraint tickets_cobro_fk foreign key (sucursal_id, cobro_id)
      references public.cobros (sucursal_id, id) deferrable initially deferred;
  end if;
end $$;

commit;
