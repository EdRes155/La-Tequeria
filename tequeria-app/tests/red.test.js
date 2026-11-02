// Fallos de red en el adaptador remoto (src/store.js): tiempo límite, reintentos solo en lo que no
// se duplica y mensajes claros. El cliente de Supabase se sustituye por uno controlado.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function almacen() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }
globalThis.localStorage = almacen();
globalThis.sessionStorage = almacen();

let llamadas = [];
let responder = () => ({ data: null, error: null, status: 200 });
vi.mock("../src/supabaseClient.js", () => ({
  supabase: {
    rpc(fn) {
      llamadas.push(fn);
      const r = responder(fn, llamadas.filter((x) => x === fn).length);
      let senal = null;
      const p = r === "colgar"
        ? new Promise((ok) => { const iv = setInterval(() => { if (senal?.aborted) { clearInterval(iv); ok({ data: null, error: { message: "AbortError: aborted" }, status: 0 }); } }, 100); })
        : Promise.resolve(r);
      const q = { abortSignal(s) { senal = s; return q; }, then: (a, b) => p.then(a, b) };
      return q;
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel() {},
  },
}));
const { api, ErrorApi } = await import("../src/store.js");

const falla = async (p) => { try { await p; } catch (e) { return e; } throw new Error("se esperaba error"); };
const sinRed = { data: null, error: { message: "TypeError: Failed to fetch" }, status: 0 };
const bien = (data) => ({ data, error: null, status: 200 });

describe("red y errores del servidor", () => {
  beforeEach(() => { llamadas = []; });
  afterEach(() => { vi.useRealTimers(); });

  it("reintenta solo lo idempotente ante un fallo de red pasajero", async () => {
    responder = (fn, n) => (n === 1 ? sinRed : bien({ yo: { id: "a" } }));
    expect(await api.cargar()).toEqual({ yo: { id: "a" } });
    expect(llamadas).toEqual(["estado", "estado"]);

    llamadas = [];
    responder = () => sinRed;
    const e = await falla(api.acciones.ajustarBebida("coca", 1));   // sumar existencias dos veces sería un error
    expect(e).toBeInstanceOf(ErrorApi);
    expect(e.codigo).toBe("RED");
    expect(llamadas).toEqual(["ajustar_bebida"]);
  });

  it("corta una petición que no responde y lo dice claro", async () => {
    vi.useFakeTimers();
    responder = () => "colgar";
    const p = falla(api.cargar());
    await vi.advanceTimersByTimeAsync(60000);
    const e = await p;
    expect(e.codigo).toBe("RED");
    expect(e.message).toMatch(/tardó demasiado/);
    expect(llamadas).toHaveLength(3);   // el intento y dos reintentos
  });

  it("distingue servidor caído, reglas del negocio y errores desconocidos", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    responder = () => ({ data: null, error: { message: "Service Unavailable" }, status: 503 });
    expect((await falla(api.acciones.liberarMesa(1))).message).toMatch(/no está disponible/);
    responder = () => ({ data: null, error: { code: "P0001", message: "POR_COBRAR", hint: "La Mesa 1 tiene 1 cuenta(s) por cobrar." }, status: 400 });
    const regla = await falla(api.acciones.liberarMesa(1));
    expect([regla.codigo, regla.message]).toEqual(["POR_COBRAR", "La Mesa 1 tiene 1 cuenta(s) por cobrar."]);
    responder = () => ({ data: null, error: { code: "XX000", message: "algo" }, status: 500 });
    const rara = await falla(api.acciones.liberarMesa(1));
    expect(rara.codigo).toBe("SERVIDOR");
    expect(rara.message).toMatch(/XX000/);
  });
});
