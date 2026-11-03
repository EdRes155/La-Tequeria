-- Datos sintéticos con la forma de producción (esquema v3, noviembre de 2026) para ensayar la
-- migración multinegocio. Cubren cada estado de cobro: comandas anteriores al registro de cobros
-- («previo»), cobradas, una cerrada sin cobro («no_cobrado») y una pendiente; además un corte,
-- gastos, una comanda en cocina con un producto tachado, bitácora y una sesión vigente.
-- Nombres, teléfonos y direcciones son ficticios. Se carga sobre tests/sql/esquema-v3.sql.
update public.config set nombre_negocio = 'La Tequería', zona_horaria = 'America/Mexico_City' where id = 1;

insert into public.usuarios (id, nombre, rol, pin_hash) values
  ('a1b2c3d4e5f6', 'Ana Prueba', 'admin', public._hash_pin('804219')),
  ('b2c3d4e5f6a1', 'Luis Prueba', 'mesero', public._hash_pin('571936')),
  ('c3d4e5f6a1b2', 'Toño Prueba', 'cocinero', public._hash_pin('39071528'));

-- Corte anterior: lo vendido antes de registrar cobros quedó como «previo»
insert into public.cortes (id, fecha, hora, tickets, total, gastos, cobrado, por_cobrar, hecho_por, autorizado_por) values
  ('corte-0001', '01/11/2026', '23:10', 3, 140, 250, 0, 0, 'a1b2c3d4e5f6', 'a1b2c3d4e5f6');
insert into public.tickets (id, tipo, origen, mesa_id, ordenes, mesero, hora, fecha, estado, archivado_cocina, total,
                            corte_id, cobro_id, creado_por, domicilio) values
  ('t-previo-1', 'aqui', 'Mesa 1', 1,
   '[{"id":"o1","nombre":"Orden 1","items":[{"key":"taco-pastor","nombre":"Taco Pastor","cat":"taco","precio":20,"cantidad":3}]}]',
   'Luis Prueba', '13:00', '01/11/2026', 'listo', true, 60, 'corte-0001', 'previo', 'b2c3d4e5f6a1', null),
  ('t-previo-2', 'llevar', 'Para llevar', null,
   '[{"id":"o1","nombre":"Orden 1","items":[{"key":"taco-bistec","nombre":"Taco Bistec","cat":"taco","precio":20,"cantidad":2}]}]',
   'Luis Prueba', '15:30', '01/11/2026', 'listo', true, 40, 'corte-0001', 'previo', 'b2c3d4e5f6a1', null),
  ('t-previo-3', 'domicilio', 'Cliente Prueba', null,
   '[{"id":"o1","nombre":"Orden 1","items":[{"key":"taco-pastor","nombre":"Taco Pastor","cat":"taco","precio":20,"cantidad":2}]}]',
   'Ana Prueba', '20:10', '01/11/2026', 'listo', true, 40, 'corte-0001', 'previo', 'a1b2c3d4e5f6',
   '{"nombre":"Cliente Prueba","direccion":"Calle Ficticia 123","telefono":"5550009999","pago":"efectivo"}');
insert into public.gastos (id, concepto, monto, fecha, hora, usuario, creado_por, corte_id) values
  ('gasto-0001', 'Gas', 250, '01/11/2026', '09:00', 'Ana Prueba', 'a1b2c3d4e5f6', 'corte-0001');

-- Periodo abierto
insert into public.cobros (id, metodo, total, propina, recibido, tickets, origen, cobrado_por, cobrado_nombre, fecha, hora) values
  ('cobro-0001', 'efectivo', 80, 10, 100, 2, 'Mesa 3', 'b2c3d4e5f6a1', 'Luis Prueba', '03/11/2026', '14:00'),
  ('cobro-0002', 'tarjeta', 45, 0, null, 1, 'Para llevar', 'a1b2c3d4e5f6', 'Ana Prueba', '03/11/2026', '14:20');
insert into public.tickets (id, tipo, es_extra, origen, mesa_id, ordenes, mesero, hora, fecha, estado, archivado_cocina,
                            total, cobro_id, creado_por) values
  ('t-cobrado-1', 'aqui', false, 'Mesa 3', 3,
   '[{"id":"o1","nombre":"Orden 1","items":[{"key":"taco-pastor","nombre":"Taco Pastor","cat":"taco","precio":20,"cantidad":3}]}]',
   'Luis Prueba', '13:40', '03/11/2026', 'listo', true, 60, 'cobro-0001', 'b2c3d4e5f6a1'),
  ('t-cobrado-2', 'aqui', true, 'Mesa 3', 3,
   '[{"id":"o2","nombre":"Orden 2","items":[{"key":"taco-bistec","nombre":"Taco Bistec","cat":"taco","precio":20,"cantidad":1}]}]',
   'Luis Prueba', '13:50', '03/11/2026', 'listo', true, 20, 'cobro-0001', 'b2c3d4e5f6a1'),
  ('t-cobrado-3', 'llevar', false, 'Para llevar', null,
   '[{"id":"o1","nombre":"Orden 1","items":[{"key":"gringa-pastor","nombre":"Gringa Pastor","cat":"gringa","precio":45,"cantidad":1}]}]',
   'Ana Prueba', '14:10', '03/11/2026', 'listo', true, 45, 'cobro-0002', 'a1b2c3d4e5f6'),
  ('t-no-cobrado', 'aqui', false, 'Mesa 4', 4,
   '[{"id":"o1","nombre":"Orden 1","items":[{"key":"taco-pastor","nombre":"Taco Pastor","cat":"taco","precio":20,"cantidad":1}]}]',
   'Luis Prueba', '14:15', '03/11/2026', 'listo', true, 20, 'no_cobrado', 'b2c3d4e5f6a1'),
  ('t-pendiente', 'aqui', false, 'Mesa 5', 5,
   '[{"id":"o1","nombre":"Orden 1","items":[{"key":"taco-pastor","nombre":"Taco Pastor","cat":"taco","precio":20,"cantidad":2},{"key":"coca","nombre":"Coca-Cola","cat":"bebida","precio":25,"cantidad":1}]}]',
   'Luis Prueba', '14:30', '03/11/2026', 'preparando', false, 65, null, 'b2c3d4e5f6a1');
update public.mesas set estado = 'ocupada', mesero = 'Luis Prueba', hora = '14:30',
  pedido = '{"ordenes":[{"id":"o1","nombre":"Orden 1","items":[]}],"extras":[]}', version = 3
 where id = 5;
insert into public.cocina_hechos (ticket_id, linea, hecho, por) values ('t-pendiente', 'o1|taco-pastor', true, 'Toño Prueba');
insert into public.gastos (id, concepto, monto, fecha, hora, usuario, creado_por) values
  ('gasto-0002', 'Tortillas', 120, '03/11/2026', '10:00', 'Ana Prueba', 'a1b2c3d4e5f6');
insert into public.bitacora (usuario_id, usuario_nombre, accion, detalle) values
  ('a1b2c3d4e5f6', 'Ana Prueba', 'corte', '{"id":"corte-0001"}'),
  ('a1b2c3d4e5f6', 'Ana Prueba', 'no_cobrado', '{"tickets":["t-no-cobrado"],"motivo":"cortesía"}');
insert into public.sesiones (token_hash, usuario_id, dispositivo, expira) values
  (encode(extensions.digest('token-de-prueba', 'sha256'), 'hex'), 'b2c3d4e5f6a1', 'caja', now() + interval '10 hours');
