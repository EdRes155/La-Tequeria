import { describe, it, expect } from "vitest";
import {
  money, leerImporte, buildMenu, resolverItem, pinDebil, nombreTicket, resumenPeriodo, pedidoParaEnviar,
  preciosDefault, CARNES_DEFAULT, BEBIDAS_DEFAULT, ticketTotal, puede, puedeEditar,
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
