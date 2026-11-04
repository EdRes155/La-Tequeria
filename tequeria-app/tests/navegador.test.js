// Datos del navegador por sucursal (docs/multinegocio/MODELO.md §7 y §8; multinegocio paso 5), con el
// cliente de Supabase sustituido por uno controlado: claves con la sucursal, paso de las claves anteriores,
// cambio de sucursal en el mismo navegador, equipo revocado, respuestas tardías y canal privado.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Almacén como el del navegador (con key y length, que usa la limpieza)
function almacen() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, _m: m,
  };
}

let responder, canales, setAuth;
vi.mock("../src/supabaseClient.js", () => ({
  supabase: {
    rpc(fn, args) {
      const p = Promise.resolve(responder(fn, args));
      const q = { abortSignal() { return q; }, then: (a, b) => p.then(a, b) };
      return q;
    },
    channel(nombre, opciones) {
      const ch = { nombre, opciones, oyentes: [], suscrito: false, quitado: false,
        on(tipo, filtro, fn) { this.oyentes.push({ tipo, filtro, fn }); return this; },
        subscribe(fn) { this.suscrito = true; fn?.("SUBSCRIBED"); return this; } };
      canales.push(ch);
      return ch;
    },
    removeChannel(ch) { ch.quitado = true; },
    realtime: { setAuth: () => { setAuth++; return Promise.resolve(); } },
  },
}));

const bien = (data) => ({ data, error: null, status: 200 });
const error = (codigo, hint = "x") => ({ data: null, error: { code: "P0001", message: codigo, hint }, status: 400 });
const SUC_A = "11111111-1111-1111-1111-111111111111", SUC_B = "22222222-2222-2222-2222-222222222222";
const pantalla = (id) => bien({ sucursal: { id, nombre: "S" }, negocio: "S", usuarios: [{ id: "u1", nombre: "Ana" }], hayAdmin: true });
const esperar = () => new Promise((r) => setTimeout(r, 0));

let api, claves;
async function cargar() {
  vi.resetModules();
  claves = await import("../src/claves.js");
  ({ api } = await import("../src/store.js"));
}
// Llaves que hay en los dos almacenes
const todas = () => [...localStorage._m.keys(), ...sessionStorage._m.keys()].sort();

describe("datos del navegador por sucursal", () => {
  beforeEach(async () => {
    globalThis.localStorage = almacen();
    globalThis.sessionStorage = almacen();
    globalThis.window ??= globalThis;
    globalThis.addEventListener ??= () => {};
    globalThis.removeEventListener ??= () => {};
    globalThis.document ??= { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
    canales = []; setAuth = 0;
    responder = (fn) => (fn === "usuarios_login" ? pantalla(SUC_A) : fn === "login" ? bien({ ok: true, token: "t1", usuario: { id: "u1" } }) : bien({}));
    await cargar();
  });

  it("las claves llevan la sucursal que dice el servidor, y las de antes pasan a ella una sola vez", async () => {
    localStorage.setItem("tequeria_papel", "80");
    localStorage.setItem("tequeria_estacion", "barra");
    localStorage.setItem("tequeria_ultimo_usuario", "u1");
    localStorage.setItem("tequeria_sesion", "{\"token\":\"viejo\"}");   // sesión de antes de migrar: ya no sirve
    await api.pantallaLogin();
    expect(claves.sucursalActual()).toBe(SUC_A);
    expect(claves.leer("papel")).toBe("80");
    expect(todas()).toEqual([`tequeria:${SUC_A}:estacion`, `tequeria:${SUC_A}:papel`, `tequeria:${SUC_A}:ultimo_usuario`, "tequeria:sucursal"].sort());
    await api.entrar("u1", "583920");
    expect(JSON.parse(sessionStorage.getItem(`tequeria:${SUC_A}:sesion`)).token).toBe("t1");
    // en la siguiente carga se recuerda la sucursal y la sesión
    await cargar();
    expect(claves.sucursalActual()).toBe(SUC_A);
    expect(api.sesionGuardada()).toMatchObject({ usuario: { id: "u1" } });
  });

  it("si el equipo aparece en otra sucursal, se borra todo lo de la anterior", async () => {
    await api.pantallaLogin();
    await api.entrar("u1", "583920");
    claves.guardar("papel", "80");
    responder = (fn) => (fn === "usuarios_login" ? pantalla(SUC_B) : bien({}));
    await api.pantallaLogin();
    expect(claves.sucursalActual()).toBe(SUC_B);
    expect(api.sesionGuardada()).toBeNull();
    // queda la etiqueta del navegador, que no es de ninguna sucursal
    expect(todas()).toEqual(["tequeria:sucursal", "tequeria_dispositivo"]);
    expect(localStorage.getItem("tequeria:sucursal")).toBe(SUC_B);
  });

  it("un equipo revocado borra sus claves, suelta el canal y descarta lo que llegue tarde", async () => {
    await api.pantallaLogin();
    await api.entrar("u1", "583920");
    claves.guardar("estacion", "barra");
    localStorage.setItem("tequeria_dispositivo", "etiqueta");
    const quitar = api.suscribir(() => {}, () => {});
    await esperar();
    const ch = canales.at(-1);
    expect(ch.suscrito).toBe(true);
    // una lectura en curso cuando llega la revocación
    let soltar;
    responder = (fn, args) => (args?.p_partes?.[0] === "mesas" ? new Promise((ok) => { soltar = ok; })
      : error("DISPOSITIVO", "Este equipo no está autorizado."));
    const tarde = api.cargar(["mesas"]).then(() => null, (e) => e.codigo);
    const revocado = await api.cargar(["config"]).then(() => null, (e) => e.codigo);
    expect(revocado).toBe("DISPOSITIVO");
    expect(todas()).toEqual([]);
    expect(ch.quitado).toBe(true);
    expect(api.sesionGuardada()).toBeNull();
    soltar(bien({ mesas: [{ id: 1 }] }));
    expect(await tarde).toBe("DESCARTADA");
    quitar();
  });

  it("escucha el canal privado de su sucursal, con la sesión de Supabase del equipo", async () => {
    await api.pantallaLogin();
    const cambios = [];
    const quitar = api.suscribir((partes) => cambios.push(partes), () => {});
    await esperar();
    const ch = canales.at(-1);
    expect(ch.nombre).toBe("sucursal:" + SUC_A);
    expect(ch.opciones).toEqual({ config: { private: true } });
    expect(setAuth).toBe(1);
    expect(ch.oyentes.map((o) => [o.tipo, o.filtro])).toEqual([["broadcast", { event: "cambio" }]]);
    quitar();
    expect(ch.quitado).toBe(true);
  });

  it("sin sucursal conocida no abre ningún canal (la app sigue con la consulta periódica)", async () => {
    const estados = [];
    const quitar = api.suscribir(() => {}, (st) => estados.push(st));
    await esperar();
    expect(canales).toEqual([]);
    expect(estados).toEqual(["reconnecting"]);
    quitar();
  });
});

describe("modo local", () => {
  it("usa la sucursal «local» para sus claves", async () => {
    globalThis.localStorage = almacen();
    globalThis.sessionStorage = almacen();
    vi.resetModules();
    vi.doMock("../src/supabaseClient.js", () => ({ supabase: null }));
    const c = await import("../src/claves.js");
    const { api: local } = await import("../src/store.js");
    expect(local.modo).toBe("local");
    expect(c.sucursalActual()).toBe("local");
    expect((await local.pantallaLogin()).sucursal.id).toBe("local");
    c.guardar("papel", "80");
    expect(localStorage.getItem("tequeria:local:papel")).toBe("80");
    vi.doUnmock("../src/supabaseClient.js");
  });
});
