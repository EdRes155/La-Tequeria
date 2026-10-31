import { describe, it, expect } from "vitest";
import {
  money, leerImporte, buildMenu, resolverItem, pinDebil, nombreTicket, resumenPeriodo, pedidoParaEnviar,
  preciosDefault, CARNES_DEFAULT, BEBIDAS_DEFAULT, ticketTotal, puede, puedeEditar,
  ordenarItems, nombreCocina, estadoPedido, pedidosDeMesa, unirTickets, porPreparar, leerAjustes,
} from "../src/dominio.js";

const datos = {
  precios: { ...preciosDefault(CARNES_DEFAULT), "taco-pastor": 25.5 },
  extras: [{ id: "x1", nombre: "Taco especial", cat: "taco", precio: 33, activo: true }],
  ocultos: ["volcan-queso"],
  carnes: CARNES_DEFAULT.map((c) => ({ ...c, activo: c.id !== "tripa" })),
  bebidas: BEBIDAS_DEFAULT,
};

describe("importes", () => {
  it("muestra centavos solo cuando existen, sin redondeo implícito (SEG-09)", () => {
    expect(money(25)).toBe("$25");
    expect(money(25.5)).toBe("$25.50");
    expect(money(1234.5)).toBe("$1,234.50");
    expect(money(0.1 + 0.2)).toBe("$0.30");
  });
  it("lee importes con punto o coma y rechaza basura", () => {
    expect(leerImporte("25,50")).toBe(25.5);
    expect(leerImporte(" 30 ")).toBe(30);
    expect(leerImporte("abc")).toBeNull();
    expect(leerImporte("-4")).toBeNull();
  });
  it("suma totales a centavos", () => {
    expect(ticketTotal({ ordenes: [{ items: [{ cantidad: 3, precio: 25.5 }] }], extras: [{ cantidad: 1, precio: 0.1 }] })).toBe(76.6);
  });
});

describe("catálogo", () => {
  it("oculta productos ocultos, carnes inactivas y bebidas agotadas", () => {
    const m = buildMenu(datos.carnes, [...datos.bebidas.slice(0, 2), { id: "z", nombre: "Agotada", cantidad: 0, activo: true, precio: 1 }], datos.extras, datos.precios, datos.ocultos);
    expect(m.tacos.map((i) => i.key)).toContain("extra-x1");
    expect(m.tacos.some((i) => i.key === "taco-tripa")).toBe(false);
    expect(m.volcan.some((i) => i.key === "volcan-queso")).toBe(false);
    expect(m.bebs.map((b) => b.key)).toEqual(["beb-coca", "beb-sprite"]);
    expect(m.tacos.find((i) => i.key === "taco-pastor").precio).toBe(25.5);
  });
  it("resuelve claves igual que el servidor", () => {
    expect(resolverItem("taco-queso-pastor", false, datos)).toMatchObject({ ok: true, nombre: "Taco de queso Pastor", cat: "taco" });
    expect(resolverItem("media-costra-bistec", false, datos)).toMatchObject({ ok: true, nombre: "Media costra Bistec", cat: "costra" });
    expect(resolverItem("beb-coca", false, datos)).toMatchObject({ ok: true, precio: 25, invId: "coca" });
    expect(resolverItem("taco-tripa", false, datos).ok).toBe(false);          // carne inactiva
    expect(resolverItem("volcan-queso", false, datos).ok).toBe(false);        // oculto
    expect(resolverItem("bolsa-verdura", false, datos).ok).toBe(false);       // empaque fuera de extras
    expect(resolverItem("bolsa-verdura", true, datos)).toMatchObject({ ok: true, precio: 15 });
    expect(resolverItem("verdura-aparte", true, datos).precio).toBe(0);
    expect(resolverItem("x'; drop table", false, datos).ok).toBe(false);
  });
  it("al enviar solo viajan claves y cantidades", () => {
    const p = pedidoParaEnviar({ ordenes: [{ id: "o1", nombre: "Ana", prep: "natural", items: [{ key: "taco-pastor", nombre: "Taco Pastor", precio: 1, cantidad: 2, cat: "taco" }] }], extras: [] });
    expect(p.ordenes[0].items[0]).toEqual({ key: "taco-pastor", cantidad: 2, nombre: "Taco Pastor" });
  });
});

describe("reglas", () => {
  it("detecta PIN triviales", () => {
    for (const p of ["1234", "1111", "0000", "4321", "2468", "123456", "8765"]) expect(pinDebil(p)).toBe(true);
    for (const p of ["8642", "5173", "739104"]) expect(pinDebil(p)).toBe(false);
  });
  it("permisos por rol", () => {
    expect(puede({ rol: "mesero" }, "gastos")).toBe(false);
    expect(puedeEditar({ rol: "cocinero" }, "cocina")).toBe(true);
    expect(puedeEditar({ rol: "mesero" }, "cocina")).toBe(false);
  });
  it("el ticket abrevia sin cortar el nombre", () => {
    expect(nombreTicket({ nombre: "Quesadilla de maíz (queso)" })).toBe("Quesa. maíz queso");
    expect(nombreTicket({ nombre: "Media costra de queso" })).toBe("½ Costra queso");
  });
  it("el resumen no cuenta reenvíos", () => {
    const r = resumenPeriodo([
      { tipo: "aqui", mesero: "A", total: 50, ordenes: [{ items: [{ nombre: "Taco", cantidad: 2 }] }] },
      { tipo: "aqui", mesero: "A", total: 0, reenvio: true, ordenes: [{ items: [{ nombre: "Taco", cantidad: 2 }] }] },
      { tipo: "llevar", mesero: "B", total: 25.5, ordenes: [] },
    ], [{ monto: 10 }]);
    expect(r).toMatchObject({ total: 75.5, count: 2, gastos: 10, porTipo: { "Para comer aquí": 50, "Para llevar": 25.5 } });
    expect(r.top).toEqual([{ nombre: "Taco", cant: 2 }]);
  });
});

describe("ticket de cocina y estatus del pedido", () => {
  it("ordena por categoría: tacos, gringas, volcanes, costras y bebidas", () => {
    const items = [
      { key: "beb-coca", cat: "bebida" }, { key: "costra-pastor", cat: "costra" }, { key: "gringa-pastor", cat: "quesa" },
      { key: "taco-pastor", cat: "taco" }, { key: "volcan-queso", cat: "volcan" }, { key: "taco-bistec", cat: "taco" },
    ];
    expect(ordenarItems(items).map((i) => i.key)).toEqual(
      ["taco-pastor", "taco-bistec", "gringa-pastor", "volcan-queso", "costra-pastor", "beb-coca"]);
    expect(items[0].key).toBe("beb-coca"); // no modifica el original
  });

  it("abrevia solo lo que se entiende en cocina", () => {
    const n = (nombre, corto) => nombreCocina({ nombre, corto });
    expect(n("Taco Pastor")).toBe("T Pastor");
    expect(n("Taco de queso Bistec")).toBe("T queso Bistec");
    expect(n("Gringa Suadero")).toBe("G Suadero");
    expect(n("Volcán de queso")).toBe("V queso");
    expect(n("Costra Pastor")).toBe("C Pastor");
    expect(n("Media costra de queso")).toBe("½C queso");
    expect(n("Llenadora Pastor")).toBe("Llen. Pastor");
    expect(n("Quesadilla de maíz (queso)")).toBe("Quesa maíz");
    expect(n("Coca-Cola")).toBe("Coca-Cola");
    expect(n("Tortillas extra (harina)", "Tortillas harina")).toBe("Tort. harina");
  });

  it("calcula el estatus que ve el mesero", () => {
    const t = (extra) => ({ id: Math.random().toString(36), estado: "pendiente", recibido: null, cobro: null, ...extra });
    expect(estadoPedido(t()).paso).toBe("enviado");
    expect(estadoPedido(t({ recibido: "2026-10-31T10:00:00Z" })).paso).toBe("recibido");
    expect(estadoPedido(t({ estado: "preparando" })).paso).toBe("proceso");
    expect(estadoPedido(t({ estado: "listo" })).paso).toBe("entregado");
    expect(estadoPedido(t({ estado: "listo", cobro: { metodo: "efectivo" } })).paso).toBe("cobrado");
    // pagado antes de salir de cocina: sigue el paso de cocina y se marca como pagado
    expect(estadoPedido(t({ estado: "preparando", cobro: { metodo: "tarjeta" } }))).toMatchObject({ paso: "proceso", cobrado: true });
    // una mesa con orden extra: manda la comanda más atrasada
    expect(estadoPedido([t({ estado: "listo" }), t({ estado: "preparando" })]).paso).toBe("proceso");
    expect(estadoPedido([t({ reenvio: true })])).toBeNull();
  });

  it("toma solo las comandas de la visita actual de la mesa", () => {
    const mesa = { id: 3, estado: "ocupada", desde: "2026-10-31T12:00:00.000Z" };
    const vieja = { id: "a", mesaId: 3, creado: "2026-10-31T09:00:00.000Z", cobro: { metodo: "efectivo" } };
    const actual = { id: "b", mesaId: 3, creado: "2026-10-31T12:00:00.000Z", cobro: null };
    const extra = { id: "c", mesaId: 3, creado: "2026-10-31T12:20:00.000Z", cobro: { metodo: "tarjeta" }, esExtra: true };
    const otra = { id: "d", mesaId: 4, creado: "2026-10-31T12:30:00.000Z" };
    const todos = unirTickets([actual], [vieja, actual, extra, otra]);
    expect(todos).toHaveLength(4);
    expect(pedidosDeMesa(todos, mesa).map((t) => t.id)).toEqual(["b", "c"]);
    expect(pedidosDeMesa(todos, { ...mesa, estado: "libre" })).toEqual([]);
    expect(pedidosDeMesa(todos, { ...mesa, desde: null }).map((t) => t.id)).toEqual(["b"]);
  });
});

describe("monitor de cocina", () => {
  it("suma lo que falta por preparar en orden de categoría, sin reimpresiones ni lo ya tachado", () => {
    const t1 = { id: "a", ordenes: [{ id: "o1", items: [{ key: "beb-coca", nombre: "Coca-Cola", cat: "bebida", cantidad: 1 }, { key: "taco-pastor", nombre: "Taco Pastor", cat: "taco", cantidad: 3 }] }] };
    const t2 = { id: "b", ordenes: [{ id: "o1", items: [{ key: "taco-pastor", nombre: "Taco Pastor", cat: "taco", cantidad: 2 }, { key: "gringa-pastor", nombre: "Gringa Pastor", cat: "quesa", cantidad: 1 }] }],
      extras: [{ key: "tortilla-maiz", corto: "Tortillas maíz", nombre: "Tortillas extra (maíz)", cat: "empaque", cantidad: 1 }] };
    const re = { id: "c", reenvio: true, ordenes: [{ id: "o1", items: [{ key: "taco-pastor", nombre: "Taco Pastor", cat: "taco", cantidad: 9 }] }] };
    expect(porPreparar([t1, t2, re]).map((x) => `${x.cantidad} ${x.nombre}`))
      .toEqual(["5 Taco Pastor", "1 Gringa Pastor", "1 Coca-Cola", "1 Tortillas maíz"]);
    expect(porPreparar([t1, t2], (k) => k === "a|o1|taco-pastor")[0]).toMatchObject({ key: "taco-pastor", cantidad: 2 });
  });

  it("los ajustes del negocio tienen valores por defecto", () => {
    expect(leerAjustes({})).toEqual({ modoCocina: "impresora", imprimirCocinaMonitor: false });
    expect(leerAjustes({ ajustes: { modoCocina: "monitor" } }).modoCocina).toBe("monitor");
  });
});
