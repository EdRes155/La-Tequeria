-- Huella del esquema public: funciones (sin comentarios ni espacios), columnas, restricciones,
-- índices, disparadores y permisos de anon/authenticated. Solo lee el catálogo; sirve para comprobar
-- que tests/sql/esquema-v3.sql reproduce el esquema de producción (tests/sql/migracion.test.js).
-- Los comentarios se quitan porque la forma de aplicar el SQL en Supabase puede descartarlos.
with
funciones as (
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || pg_get_function_result(p.oid)
         || '|' || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '')
         || '|' || md5(btrim(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
         || '|' || has_function_privilege('anon', p.oid, 'execute')::text
         || '|' || has_function_privilege('authenticated', p.oid, 'execute')::text as x
    from pg_proc p where p.pronamespace = 'public'::regnamespace
),
columnas as (
  select c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text
         || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ' ' || a.attidentity::text || a.attgenerated::text as x
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
),
tablas as (
  select c.relname || ' rls=' || c.relrowsecurity::text
         || ' anon=' || has_table_privilege('anon', c.oid, 'select,insert,update,delete')::text
         || ' auth=' || has_table_privilege('authenticated', c.oid, 'select,insert,update,delete')::text as x
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
),
restricciones as (
  select c.relname || ' ' || k.conname || ' ' || pg_get_constraintdef(k.oid) as x
    from pg_constraint k join pg_class c on c.oid = k.conrelid where c.relnamespace = 'public'::regnamespace
),
indices as (
  select pg_get_indexdef(i.indexrelid) as x
    from pg_index i join pg_class c on c.oid = i.indrelid where c.relnamespace = 'public'::regnamespace
),
disparadores as (
  select pg_get_triggerdef(t.oid) as x
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
)
select jsonb_build_object(
  'funciones', (select count(*) from funciones), 'h_funciones', (select md5(string_agg(x, ',' order by x collate "C")) from funciones),
  'columnas', (select count(*) from columnas), 'h_columnas', (select md5(string_agg(x, ',' order by x collate "C")) from columnas),
  'tablas', (select count(*) from tablas), 'h_tablas', (select md5(string_agg(x, ',' order by x collate "C")) from tablas),
  'restricciones', (select count(*) from restricciones), 'h_restricciones', (select md5(string_agg(x, ',' order by x collate "C")) from restricciones),
  'indices', (select count(*) from indices), 'h_indices', (select md5(string_agg(x, ',' order by x collate "C")) from indices),
  'disparadores', (select count(*) from disparadores), 'h_disparadores', (select md5(string_agg(x, ',' order by x collate "C")) from disparadores)
) as huella;
