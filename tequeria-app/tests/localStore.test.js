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

  it("no libera una mesa sin cobrar; un administrador puede cerrarla sin cobro", async () => {
    await api.crearAdminInicial("Ana", "8642");
    const { usuarios } = await api.pantallaLogin();
    await api.entrar(usuarios[0].id, "8642");
    await api.acciones.enviar(t("mesa2-1", { tipo: "aqui", mesaId: 2 }));
    let est = await api.cargar();
    const tk = est.cocina.find((x) => x.id === "mesa2-1");
    expect(tk.recibido).toBeNull();
    expect(est.mesas[1].desde).toBe(tk.creado);
    expect(await api.acciones.marcarRecibido(["mesa2-1"])).toBe(1);
    expect((await api.cargar()).cocina[0].recibido).toBeTruthy();

    expect((await falla(api.acciones.liberarMesa(2))).codigo).toBe("POR_COBRAR");
    expect((await falla(api.acciones.noCobrar("0000", ["mesa2-1"], "Se fue", true))).codigo).toBe("pin");
    expect((await falla(api.acciones.noCobrar("8642", ["mesa2-1"], " ", true))).codigo).toBe("DATOS");
    expect(await api.acciones.noCobrar("8642", ["mesa2-1"], "Se fue", true)).toMatchObject({ ok: true, mesaLiberada: true, total: 40 });
    est = await api.cargar();
    expect(est.mesas[1].estado).toBe("libre");
    expect(est.porCobrar).toEqual([]);
    expect(est.historial[0].cobro).toEqual({ noCobrado: true });
    expect(est.periodo).toMatchObject({ noCobrado: 40, porCobrar: 0 });
  });

  it("guarda los ajustes del negocio solo con valores válidos", async () => {
    await api.crearAdminInicial("Ana", "8642");
    const { usuarios } = await api.pantallaLogin();
    await api.entrar(usuarios[0].id, "8642");
    expect((await api.cargar()).ajustes).toEqual({});
    expect((await falla(api.acciones.fijarAjuste("modoCocina", "pantalla"))).codigo).toBe("DATOS");
    expect((await falla(api.acciones.fijarAjuste("otra", true))).codigo).toBe("DATOS");
    await api.acciones.fijarAjuste("modoCocina", "monitor");
    await api.acciones.fijarAjuste("imprimirCocinaMonitor", true);
    expect((await api.cargar(["config"])).ajustes).toEqual({ modoCocina: "monitor", imprimirCocinaMonitor: true });
  });

  it("configuración del piloto: nombre, zona horaria y número de mesas, con las reglas del servidor", async () => {
    await api.crearAdminInicial("Ana", "8642");
    const { usuarios } = await api.pantallaLogin();
    await api.entrar(usuarios[0].id, "8642");
    const a = api.acciones;
    expect((await api.cargar(["config"])).zonaHoraria).toBe("America/Mexico_City");
    expect((await falla(a.fijarNegocio("  ", "America/Mexico_City"))).codigo).toBe("nombre");
    expect((await falla(a.fijarNegocio("Norte", "Marte/Olimpo"))).codigo).toBe("zona");
    await a.fijarNegocio("Taquería Norte", "America/Tijuana");
    expect(await api.cargar(["config"])).toMatchObject({ nombreNegocio: "Taquería Norte", zonaHoraria: "America/Tijuana" });
    expect((await api.pantallaLogin()).negocio).toBe("Taquería Norte");
    for (const n of [0, 61, 2.5]) expect((await falla(a.fijarMesas(n))).codigo).toBe("cantidad");
    await a.fijarMesas(10);
    expect((await api.cargar(["mesas"])).mesas.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await a.enviar(t("local-mesa-10", { tipo: "aqui", mesaId: 10 }));
    const e = await falla(a.fijarMesas(8));
    expect([e.codigo, e.message]).toEqual(["ocupadas", "La Mesa 10 está en uso o con cuentas por cobrar. Libéralas antes de quitarlas."]);
    await a.crearUsuario("8642", "Luis", "5173", "mesero");
    const mesero = (await api.pantallaLogin()).usuarios.find((u) => u.nombre === "Luis");
    await api.entrar(mesero.id, "5173");
    expect((await falla(a.fijarMesas(9))).codigo).toBe("PERMISO");
  });

  it("cocina: cambios con el estado visto, lotes y tachados como el servidor", async () => {
    await api.crearAdminInicial("Ana", "8642");
    const { usuarios } = await api.pantallaLogin();
    await api.entrar(usuarios[0].id, "8642");
    await api.acciones.enviar(t("k1"));
    await api.acciones.enviar(t("k2"));
    const visto = (id, estado = "pendiente") => [{ id, estado }];
    expect(await api.acciones.moverTickets(visto("k1"), "listo")).toEqual({ movidos: 1, conflictos: [] });
    expect(await api.acciones.moverTickets(visto("k1"), "preparando")).toEqual({ movidos: 0, conflictos: ["k1"] });
    expect(await api.acciones.moverTickets(visto("k1"), "listo")).toEqual({ movidos: 0, conflictos: [] });
    await api.acciones.marcarHecho("k2", "o1|taco-pastor", true);
    expect((await api.cargar(["cocina"])).cocina.find((x) => x.id === "k2").hechos).toEqual(["o1|taco-pastor"]);
    await api.acciones.marcarHecho("k2", "o1|taco-pastor", false);
    expect((await api.cargar(["cocina"])).cocina.find((x) => x.id === "k2").hechos).toEqual([]);
    expect((await falla(api.acciones.marcarHecho("k2", "malo", true))).codigo).toBe("DATOS");
    expect(await api.acciones.archivarTickets(["k1", "k2"])).toBe(1);   // k2 no está lista
    expect((await api.cargar(["cocina"])).cocina.map((x) => x.id)).toEqual(["k2"]);
    expect((await api.cargar(["porCobrar"])).porCobrar).toHaveLength(2);   // archivar no borra lo que falta cobrar
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
