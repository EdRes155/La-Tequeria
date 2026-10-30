#!/usr/bin/env node
// Reproducciones de la auditoría; confirmar un comportamiento NO significa
// que sea seguro. No usa red, credenciales, dependencias externas ni una BD.
// Uso desde la raíz: node auditoria/seguridad-datos.cjs [ruta-a-tequeria-app]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'tequeria-app'));
const store = fs.readFileSync(path.join(root, 'src/store.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase-schema.sql'), 'utf8');
let confirmed = 0;

function context(supabase, storage = new Map()) {
  const ctx = vm.createContext({
    supabase,
    console: { error() {} },
    localStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v),
    },
    setTimeout, clearTimeout,
  });
  const source = store.replace(/^import[^\n]*\n/, '').replace(/\bexport /g, '');
  vm.runInContext(source + '\nglobalThis.api = {login, fetchAll, io, saveBlob, claimCocina, latidoCocina};', ctx);
  return ctx.api;
}

async function reproduce(label, fn) {
  await fn();
  confirmed++;
  console.log(`CONFIRMADO ${label}`);
}

(async () => {
  await reproduce('T01: se cargan datos sensibles sin ejecutar login', async () => {
    const queries = [];
    const rows = {
      config: { id: 1 }, usuarios: [{ id: 'test-user', nombre: 'Prueba', rol: 'mesero' }],
      tickets: [{ id: 'test-ticket', domicilio: { telefono: 'dato-sintetico' } }],
      gastos: [{ id: 'test-expense', monto: 10 }], cortes: [{ id: 'test-close', total: 10 }],
    };
    const api = context({ from(table) {
      queries.push(table);
      const response = { data: rows[table] || [], error: null };
      const query = {
        select() { return this; }, eq() { return this; }, is() { return this; },
        order() { return this; }, maybeSingle() { return this; },
        then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
      };
      return query;
    }});
    const data = await api.fetchAll();
    assert.equal(data.historial[0].domicilio.telefono, 'dato-sintetico');
    for (const table of ['tickets', 'gastos', 'cortes', 'usuarios']) assert.ok(queries.includes(table));
  });

  await reproduce('T02: el login devuelve un perfil sin establecer una sesión de Auth', async () => {
    let calls = 0;
    const api = context({
      auth: new Proxy({}, { get() { throw new Error('La función llamó a Auth'); } }),
      async rpc(name, args) {
        calls++;
        assert.equal(name, 'login');
        assert.equal(args.p_id, 'test-user');
        return { data: [{ id: 'test-user', nombre: 'Prueba', rol: 'mesero' }], error: null };
      },
    });
    const user = await api.login('test-user', 'PIN-SINTETICO');
    assert.equal(user.rol, 'mesero');
    assert.equal(user.access_token, undefined);
    assert.equal(calls, 1);
  });

  await reproduce('T03: una escritura fallida se resuelve sin propagar el error', async () => {
    const api = context({ from: () => ({ insert: async () => ({ error: { message: 'Error simulado' } }) }) });
    assert.equal(await api.io.addTicket({ id: 'test-ticket' }), undefined);
  });

  await reproduce('T04: el cliente remite total, autor y reenvío manipulados', async () => {
    let sent;
    const api = context({ from(table) {
      assert.equal(table, 'tickets');
      return { insert: async (row) => { sent = row; return { error: null }; } };
    }});
    await api.io.addTicket({ id: 'test-ticket', total: -100, mesero: 'Autor ajeno', reenvio: true });
    assert.equal(sent.total, -100);
    assert.equal(sent.mesero, 'Autor ajeno');
    assert.equal(sent.reenvio, true);
  });

  await reproduce('T05: updateTicket remite campos contables sin lista de permitidos', async () => {
    let sent;
    const api = context({ from: () => ({ update(patch) {
      sent = patch;
      return { eq: async () => ({ error: null }) };
    }}) });
    await api.io.updateTicket('test-ticket', { corte_id: 'test-close', reenvio: true, total: 0 });
    assert.equal(sent.corte_id, 'test-close');
    assert.equal(sent.reenvio, true);
  });

  await reproduce('T06: cocina concede éxito ante errores de sus RPC', async () => {
    const api = context({ rpc: async () => ({ data: null, error: { message: 'Error simulado' } }) });
    assert.equal(await api.claimCocina('test-device'), true);
    assert.equal(await api.latidoCocina('test-device'), true);
  });

  await reproduce('T07: gasto negativo y autor arbitrario se envían sin validación del adaptador', async () => {
    let sent;
    const api = context({ from: () => ({ insert: async (row) => { sent = row; return { error: null }; } }) });
    await api.io.addGasto({ id: 'test-expense', concepto: 'Prueba', monto: -1, user: 'Autor ajeno' });
    assert.equal(sent.monto, -1);
    assert.equal(sent.usuario, 'Autor ajeno');
  });

  await reproduce('T08: el respaldo local conserva PIN y domicilio en texto legible', () => {
    const storage = new Map();
    const api = context(null, storage);
    api.saveBlob({ usuarios: [{ pin: 'PIN-SINTETICO' }], historial: [{ domicilio: { direccion: 'DOMICILIO-SINTETICO' } }] });
    const saved = storage.get('tequeria_state');
    assert.ok(saved.includes('PIN-SINTETICO'));
    assert.ok(saved.includes('DOMICILIO-SINTETICO'));
  });

  await reproduce('T09: un importe con centavos se muestra redondeado a pesos', () => {
    const declaration = app.match(/^const money = .*;$/m);
    assert.ok(declaration);
    const ctx = vm.createContext({});
    vm.runInContext(declaration[0] + '\nglobalThis.format = money;', ctx);
    assert.equal(ctx.format(25.50), '$26');
  });

  await reproduce('T10: errores de lectura se convierten en colecciones vacías', async () => {
    const api = context({ from() {
      const query = {
        select() { return this; }, eq() { return this; }, is() { return this; },
        order() { return this; }, maybeSingle() { return this; },
        then(resolve, reject) { return Promise.resolve({ data: null, error: { message: 'Error simulado' } }).then(resolve, reject); },
      };
      return query;
    }});
    const data = await api.fetchAll();
    assert.equal(data.historial.length, 0);
    assert.equal(data.usuarios.length, 0);
    assert.equal(data.gastos.length, 0);
  });

  // Salvaguardas de lectura del informe: comprobaciones textuales, no ejecución SQL.
  assert.match(sql, /revoke all on public\.usuarios from anon, authenticated/i);
  assert.match(sql, /grant select \(id, nombre, rol\) on public\.usuarios/i);
  assert.match(sql, /drop function if exists public\.crear_usuario\(text,text,text,text\)/i);
  assert.match(sql, /drop function if exists public\.eliminar_usuario\(text\)/i);
  assert.match(sql, /drop function if exists public\.hacer_corte\(text,text,text\)/i);
  assert.match(sql, /revoke insert, update, delete on public\.cortes from anon, authenticated/i);
  console.log(`\n${confirmed} reproducciones confirmadas. 6 comprobaciones textuales SQL verificadas.`);
  console.log('El resultado documenta defectos de la versión auditada; NO certifica seguridad ni permisos de producción.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
