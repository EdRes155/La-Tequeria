-- Catálogo del esquema public para la huella del esquema (scripts/huella-esquema.mjs). Solo lee el
-- catálogo: ningún dato de las tablas. Devuelve una fila por objeto (categoria, entrada) y, en las
-- funciones, su cuerpo sin tocar; la normalización (quitar comentarios y espacios FUERA de literales)
-- se hace en JavaScript con un analizador léxico, para no alterar el contenido de los textos.
--
-- Cubre lo que decide qué puede hacer la app: argumentos con sus valores por omisión, atributos y
-- dueño de cada función, permisos uno por uno para PUBLIC, anon y authenticated (funciones, tablas,
-- secuencias y el esquema), RLS y sus políticas, columnas, restricciones, índices, disparadores y
-- las tablas publicadas en tiempo real.
with
externos as (
  select oid, rolname::text as rol from pg_roles where rolname in ('anon', 'authenticated')
  union all select 0, 'PUBLIC'
),
objetos as (
  select 'funciones' as categoria,
         p.proname || '(' || pg_get_function_arguments(p.oid) || ') -> ' || coalesce(pg_get_function_result(p.oid), '')
         || ' | kind=' || p.prokind::text || ' volatil=' || p.provolatile::text || ' paralelo=' || p.proparallel::text
         || ' strict=' || p.proisstrict::text || ' definer=' || p.prosecdef::text || ' leakproof=' || p.proleakproof::text
         || ' lenguaje=' || l.lanname || ' dueno=' || pg_get_userbyid(p.proowner)
         || ' config=' || coalesce(array_to_string(p.proconfig, ','), '')
         || ' permisos=' || coalesce((select string_agg(e.rol || ':' || a.privilege_type || case when a.is_grantable then '+' else '' end,
                                                       ',' order by e.rol, a.privilege_type)
                                        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                        join externos e on e.oid = a.grantee), '') as entrada,
         p.prosrc as cuerpo
    from pg_proc p join pg_language l on l.oid = p.prolang
   where p.pronamespace = 'public'::regnamespace
  union all
  select case c.relkind when 'S' then 'secuencias' else 'tablas' end,
         c.relname || ' tipo=' || c.relkind::text || ' rls=' || c.relrowsecurity::text || ' rls_forzada=' || c.relforcerowsecurity::text
         || ' dueno=' || pg_get_userbyid(c.relowner)
         || ' permisos=' || coalesce((select string_agg(e.rol || ':' || a.privilege_type || case when a.is_grantable then '+' else '' end,
                                                       ',' order by e.rol, a.privilege_type)
                                        from aclexplode(coalesce(c.relacl, acldefault(case c.relkind when 'S' then 's' else 'r' end::"char", c.relowner))) a
                                        join externos e on e.oid = a.grantee), ''),
         null
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  union all
  select 'columnas',
         c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' notnull=' || a.attnotnull::text
         || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ' identidad=' || a.attidentity::text
         || ' generada=' || a.attgenerated::text,
         null
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped
  union all
  select 'restricciones', c.relname || ' ' || k.conname || ' ' || pg_get_constraintdef(k.oid), null
    from pg_constraint k join pg_class c on c.oid = k.conrelid where c.relnamespace = 'public'::regnamespace
  union all
  select 'indices', pg_get_indexdef(i.indexrelid), null
    from pg_index i join pg_class c on c.oid = i.indrelid where c.relnamespace = 'public'::regnamespace
  union all
  select 'disparadores', pg_get_triggerdef(t.oid) || ' estado=' || t.tgenabled::text, null
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
  union all
  select 'politicas',
         c.relname || ' ' || pol.polname || ' orden=' || pol.polcmd::text || ' permisiva=' || pol.polpermissive::text
         || ' roles=' || coalesce((select string_agg(case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end, ',' order by 1)
                                     from unnest(pol.polroles) r), '')
         || ' using=' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
         || ' check=' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
         null
    from pg_policy pol join pg_class c on c.oid = pol.polrelid where c.relnamespace = 'public'::regnamespace
  union all
  select 'esquema',
         'public permisos=' || coalesce((select string_agg(e.rol || ':' || a.privilege_type, ',' order by e.rol, a.privilege_type)
                                           from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
                                           join externos e on e.oid = a.grantee), ''),
         null
    from pg_namespace n where n.nspname = 'public'
  union all
  select 'tiempo_real', p.pubname || ' ' || c.relname, null
    from pg_publication p join pg_publication_rel pr on pr.prpubid = p.oid join pg_class c on c.oid = pr.prrelid
   where c.relnamespace = 'public'::regnamespace
)
select categoria, entrada, cuerpo from objetos order by categoria, entrada collate "C";
