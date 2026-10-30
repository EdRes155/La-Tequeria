// Integra el adaptador remoto (src/store.js) con el esquema real: el cliente de Supabase se
// sustituye por uno que ejecuta cada RPC en PostgreSQL como "anon", igual que PostgREST.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const URL_ADMIN = process.env.TEST_DATABASE_URL;
const d = URL_ADMIN ? describe : describe.skip;
const raiz = path.resolve(import.meta.dirname, "../..");
const BASE = "tq_remoto";
let conexion;

function almacen() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }
globalThis.localStorage = almacen();
globalThis.sessionStorage = almacen();

vi.mock("../../src/supabaseClient.js", () => ({
  supabase: {
    async rpc(fn, args = {}) {
      const ks = Object.keys(args);
      try {
        const { rows } = await conexion.query(`select public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`,
          ks.map((k) => (args[k] !== null && typeof args[k] === "object" && !Array.isArray(args[k]) ? JSON.stringify(args[k]) : args[k])));
        return { data: rows[0].r, error: null, status: 200 };
      } catch (e) {
        const code = e.code === "42883" ? "PGRST202" : e.code;
        return { data: null, error: { code, message: e.message, hint: e.hint || null, details: e.detail || null }, status: 400 };
      }
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel() {},
  },
}));

d("adaptador remoto contra el esquema real", () => {
  let api, ErrorApi;
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: URL_ADMIN });
    await admin.connect();
    await admin.query(`drop database if exists ${BASE} with (force)`);
    await admin.query(`create database ${BASE}`);
    await admin.end();
    const u = new URL(URL_ADMIN); u.pathname = "/" + BASE;
    const sql = new pg.Client({ connectionString: u.toString() });
    await sql.connect();
    await sql.query(fs.readFileSync(path.join(raiz, "tests/sql/supabase-stub.sql"), "utf8"));
    await sql.query(fs.readFileSync(path.join(raiz, "supabase-schema.sql"), "utf8"));
    await sql.query("select public.crear_admin_inicial('Ana', '8642')");
    await sql.end();
    conexion = new pg.Client({ connectionString: u.toString() });
    await conexion.connect();
    await conexion.query("set role anon");
    ({ api, ErrorApi } = await import("../../src/store.js"));
  });
  afterAll(async () => {
    await conexion?.end();
    const admin = new pg.Client({ connectionString: URL_ADMIN });
    await admin.connect();
    await admin.query(`drop database if exists ${BASE} with (force)`);
    await admin.end();
  });

  it("recorre login, envío, cocina, corte y errores con la interfaz de la app", async () => {
    expect(api.modo).toBe("remoto");
    const p = await api.pantallaLogin();
    const ana = p.usuarios[0];
    expect((await api.entrar(ana.id, "1111")).error).toBe("pin");
    const r = await api.entrar(ana.id, "8642");
    expect(r).toMatchObject({ ok: true, usuario: { nombre: "Ana", rol: "admin" }, debeCambiarPin: false });
    expect(api.sesionGuardada().usuario.nombre).toBe("Ana");

    const a = api.acciones;
    await a.crearUsuario("8642", "Luis", "5173", "mesero");
    const malPin = await a.crearUsuario("0000", "X", "5173", "mesero").catch((e) => e);
    expect(malPin).toBeInstanceOf(ErrorApi);
    expect(malPin.codigo).toBe("pin");

    await a.fijarPrecio("taco-pastor", 25.5);
    await a.agregarCarne("Suadero");
    await a.guardarBorrador(1, { ordenes: [{ id: "o1", nombre: "Orden 1", items: [{ key: "taco-suadero", cantidad: 1 }] }], extras: [] }, 0);
    const env = await a.enviar({ id: "remoto-envio-1", tipo: "aqui", esExtra: false, mesaId: 1, cuenta: "separada", paraLlevar: true,
      ordenes: [{ id: "o1", nombre: "Ana", prep: "natural", items: [{ key: "taco-pastor", cantidad: 2 }, { key: "taco-suadero", cantidad: 1 }] }], extras: [] });
    expect(env.ticket).toMatchObject({ total: 71, cuenta: "separada", paraLlevar: true, origen: "Mesa 1" });

    const e = await a.enviar({ id: "remoto-envio-2", tipo: "aqui", mesaId: 1, ordenes: [{ id: "o", items: [{ key: "taco-pastor", cantidad: 1 }] }] }).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorApi);
    expect(e.codigo).toBe("MESA_OCUPADA");
    expect(e.message).toMatch(/orden extra/);

    await a.estadoTicket("remoto-envio-1", "listo");
    await a.reenviar("remoto-reenvio-1", 1);
    const est = await api.cargar();
    expect(est.yo).toMatchObject({ nombre: "Ana", rol: "admin" });
    expect(est.precios["taco-suadero"]).toBe(20);
    expect(est.periodo).toMatchObject({ count: 1, total: 71 });
    expect(est.cocina.map((t) => t.id).sort()).toEqual(["remoto-envio-1", "remoto-reenvio-1"]);

    const corte = await a.corte("8642");
    expect(corte.corte).toMatchObject({ tickets: 1, total: 71, autorizo: "Ana" });
    const parcial = await api.cargar(["historial", "cocina"]);
    expect(parcial.historial).toEqual([]);
    expect(parcial.cocina).toHaveLength(2);
    expect(parcial.mesas).toBeUndefined();

    await api.salir();
    expect(api.sesionGuardada()).toBeNull();
    const fuera = await api.cargar().catch((x) => x);
    expect(fuera.codigo).toBe("SESION");
  });
});
