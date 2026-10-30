-- Datos sintéticos con la forma que deja la app v2, para probar la actualización a v3:
-- PIN con SHA-256 (incluidos los de demostración), mesas ocupadas, tickets abiertos y en cocina.
insert into public.config (id, nombre_negocio, precios, extras, ocultos) values
  (1, 'La Tequería', '{"taco-pastor":20,"taco-bistec":20,"quesa-queso":35,"bolsa-verdura":15,"costra-queso":45.5}',
   '[{"id":"x1","nombre":"Taco especial","cat":"taco","precio":33,"activo":true}]', '[]')
on conflict (id) do nothing;
insert into public.carnes (id, nombre, activo, orden) values ('pastor','Pastor',true,0), ('bistec','Bistec',true,1)
on conflict do nothing;
insert into public.bebidas (id, nombre, cantidad, activo, precio) values ('coca','Coca-Cola',10,true,25), ('jamaica','Agua de Jamaica',5,true,20)
on conflict do nothing;
insert into public.mesas (id, estado) select g, 'libre' from generate_series(1, 8) g on conflict do nothing;
update public.mesas set estado = 'ocupada', mesero = 'Edwin', hora = '13:10',
  pedido = '{"ordenes":[{"id":"o1","nombre":"Orden 1","prep":"con-todo","items":[{"key":"taco-pastor","nombre":"Taco Pastor","cat":"taco","precio":20,"cantidad":3}]}],"extras":[]}'
where id = 2;

insert into public.usuarios (id, nombre, rol, pin_hash) values
  ('u1', 'Edwin', 'admin', encode(extensions.digest('1234|u1', 'sha256'), 'hex')),
  ('u2', 'Mesero 1', 'mesero', encode(extensions.digest('1111|u2', 'sha256'), 'hex')),
  ('u3', 'Cocina', 'cocinero', encode(extensions.digest('8642|u3', 'sha256'), 'hex'))
on conflict do nothing;

insert into public.tickets (id, tipo, origen, mesa_id, ordenes, mesero, hora, fecha, estado, total, domicilio) values
  ('t-viejo-1', 'aqui', 'Mesa 2', 2,
   '[{"id":"o1","nombre":"Orden 1","items":[{"key":"taco-pastor","nombre":"Taco Pastor","cat":"taco","precio":20,"cantidad":3}]}]',
   'Edwin', '13:10', '30/10/2026', 'pendiente', 60, null),
  ('t-viejo-2', 'domicilio', 'Ana', null,
   '[{"id":"o1","nombre":"Orden 1","items":[{"key":"quesa-queso","nombre":"Quesadilla de queso","cat":"quesa","precio":35,"cantidad":1}]}]',
   'Edwin', '13:20', '30/10/2026', 'listo', 35, '{"nombre":"Ana","direccion":"Calle 1","telefono":"5550001111","pago":"efectivo"}')
on conflict do nothing;

-- ticket de un corte anterior que v2 ocultaba de cocina aunque no estaba archivado
insert into public.cortes (id, fecha, hora, tickets, total) values ('corte-viejo', '01/07/2026', '23:00', 1, 20) on conflict do nothing;
insert into public.tickets (id, tipo, origen, ordenes, mesero, hora, fecha, estado, total, corte_id) values
  ('t-cortado-1', 'llevar', 'Para llevar', '[]', 'Edwin', '22:00', '01/07/2026', 'listo', 20, 'corte-viejo')
on conflict do nothing;
create table if not exists public.app_state (id int primary key, data jsonb);
grant all on public.app_state to anon;

insert into public.gastos (id, concepto, monto, fecha, hora, usuario) values ('g-viejo-1', 'Gas', 250, '30/10/2026', '09:00', 'Edwin')
on conflict do nothing;
