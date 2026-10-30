// Modo local (sin Supabase): debe funcionar de punta a punta con las mismas reglas que el servidor.
import { describe, it, expect, beforeEach } from "vitest";

function almacen() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
globalThis.window = globalThis;
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};

let api, ErrorApi;
async function nueva() {
  globalThis.localStorage = almacen();
  globalThis.sessionStorage = almacen();
  const { vi } = await import("vitest");
  vi.resetModules();
  ({ api, ErrorApi } = await import("../src/store.js"));
}
const falla = async (p) => { try { await p; } catch (e) { return e; } throw new Error("se esperaba error"); };
const t = (id, extra = {}) => ({ id, tipo: "llevar", esExtra: false, cuenta: "junta", ordenes: [{ id: "o1", nombre: "Orden 1", prep: "con-todo", items: [{ key: "taco-pastor", cantidad: 2, precio: 0.01 }] }], extras: [], ...extra });

describe("modo local", () => {
  beforeEach(nueva);

  it("usa el adaptador local y arranca sin usuarios de demostración", async () => {
    expect(api.modo).toBe("local");
    const p = await api.pantallaLogin();
    expect(p.hayAdmin).toBe(false);
    expect(p.usuarios).toEqual([]);
    await expect(api.crearAdminInicial("Ana", "1234")).rejects.toThrow(/trivial/);
  });

  it("flujo completo sin errores y sin PIN en texto plano", async () => {
    await api.crearAdminInicial("Ana", "8642");
    const { usuarios } = await api.pantallaLogin();
    expect((await api.entrar(usuarios[0].id, "0000")).error).toBe("pin");
    expect((await api.entrar(usuarios[0].id, "8642")).ok).toBe(true);
    await api.acciones.crearUsuario("8642", "Luis", "5173", "mesero");
    const r = await api.acciones.enviar(t("local-envio-1"));
    expect(r.ticket.total).toBe(40);
    const almacenado = localStorage.getItem("tequeria_local_v3");
    expect(almacenado).not.toMatch(/8642|5173/);
    const est = await api.cargar();
    expect(est.historial).toHaveLength(1);
    expect(est.periodo.total).toBe(40);
  });

  it("valida existencias, idempotencia y mesas como el servidor", async () => {
    await api.crearAdminInicial("Ana", "8642");
    const { usuarios } = await api.pantallaLogin();
    await api.entrar(usuarios[0].id, "8642");
    await api.acciones.actualizarBebida("coca", { cantidad: 1 });
    const e = await falla(api.acciones.enviar(t("sin-coca-1", { tipo: "aqui", mesaId: 1, ordenes: [{ id: "o", items: [{ key: "beb-coca", cantidad: 2 }] }] })));
    expect(e).toBeInstanceOf(ErrorApi);
    expect(e.codigo).toBe("SIN_EXISTENCIA");
    let est = await api.cargar();
    expect(est.mesas[0].estado).toBe("libre");
    expect(est.bebidas.find((b) => b.id === "coca").cantidad).toBe(1);

    const uno = t("coca-ok-1", { ordenes: [{ id: "o", items: [{ key: "beb-coca", cantidad: 1 }] }] });
    await api.acciones.enviar(uno);
    expect((await api.acciones.enviar(uno)).duplicado).toBe(true);
    est = await api.cargar();
    expect(est.bebidas.find((b) => b.id === "coca").cantidad).toBe(0);

    await api.acciones.guardarBorrador(2, { ordenes: [{ id: "o", items: [{ key: "taco-bistec", cantidad: 1 }] }], extras: [] }, 0);
    est = await api.cargar();
    expect(est.mesas[1].estado).toBe("borrador");
    expect(est.historial.some((x) => x.mesaId === 2)).toBe(false);
    expect((await falla(api.acciones.guardarBorrador(2, { ordenes: [] }, 0))).codigo).toBe("CONFLICTO");
  });

  it("el corte no saca de cocina lo pendiente y exige PIN de administrador", async () => {
    await api.crearAdminInicial("Ana", "8642");
    const { usuarios } = await api.pantallaLogin();
    await api.entrar(usuarios[0].id, "8642");
    await api.acciones.enviar(t("pendiente-1"));
    expect((await falla(api.acciones.corte("0000"))).codigo).toBe("pin");
    const r = await api.acciones.corte("8642");
    expect(r.corte).toMatchObject({ tickets: 1, total: 40 });
    const est = await api.cargar();
    expect(est.historial).toEqual([]);
    expect(est.cocina.map((x) => x.id)).toEqual(["pendiente-1"]);
    expect(est.cortes).toHaveLength(1);
  });

  it("aplica permisos por rol y obliga a cambiar un PIN débil", async () => {
    await api.crearAdminInicial("Ana", "8642");
    let { usuarios } = await api.pantallaLogin();
    await api.entrar(usuarios[0].id, "8642");
    await api.acciones.crearUsuario("8642", "Luis", "5173", "mesero");
    await api.acciones.restablecerPin("8642", (await api.pantallaLogin()).usuarios.find((u) => u.nombre === "Luis").id, "1111");
    ({ usuarios } = await api.pantallaLogin());
    const luis = usuarios.find((u) => u.nombre === "Luis");
    const r = await api.entrar(luis.id, "1111");
    expect(r.debeCambiarPin).toBe(true);
    expect((await falla(api.acciones.enviar(t("debil-1")))).codigo).toBe("CAMBIAR_PIN");
    expect((await api.cambiarPin("1111", "2222")).error).toBe("debil");
    expect((await api.cambiarPin("1111", "7391")).ok).toBe(true);
    await api.acciones.enviar(t("mesero-1"));
    expect((await falla(api.acciones.fijarPrecio("taco-pastor", 1))).codigo).toBe("PERMISO");
    const est = await api.cargar();
    expect(est.gastos).toBeUndefined();
    expect(est.historial).toBeUndefined();
  });
});
