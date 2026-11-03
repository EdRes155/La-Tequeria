// Los datos de prueba del plan multinegocio cumplen lo que el plan pide de ellos.
import { describe, it, expect } from "vitest";
import { CUENTAS, sucursales } from "./fixtures/multinegocio.js";
import { pinDebil } from "../src/dominio.js";

describe("datos de prueba multinegocio", () => {
  it("son dos cuentas independientes con su propia sucursal", () => {
    expect(CUENTAS.map((c) => c.clave)).toEqual(["tequeria", "piloto-b"]);
    const suc = sucursales();
    expect(new Set(suc.map((s) => s.clave)).size).toBe(suc.length);
    for (const c of CUENTAS) expect(c.duenos.some((d) => d.rol === "propietario")).toBe(true);
  });

  it("comparten a propósito claves locales para probar el aislamiento", () => {
    for (const s of sucursales()) {
      expect(s.mesas).toBeGreaterThanOrEqual(1);              // las dos tienen «Mesa 1»
      expect(s.carnes).toContain("pastor");
      expect(s.bebidas.map((b) => b.id)).toContain("coca");
      expect(Object.keys(s.precios)).toContain("taco-pastor");
    }
  });

  it("cada sucursal tiene administrador, mesero, cocinero y un monitor de cocina", () => {
    for (const s of sucursales()) {
      expect(s.personal.map((p) => p.rol).sort()).toEqual(["admin", "cocinero", "mesero"]);
      expect(s.dispositivos.some((d) => d.monitorCocina)).toBe(true);
    }
  });

  it("los PIN cumplen la política nueva: 6 a 8 dígitos, no triviales y sin repetirse", () => {
    const pins = sucursales().flatMap((s) => s.personal.map((p) => p.pin));
    for (const p of pins) {
      expect(p).toMatch(/^[0-9]{6,8}$/);
      expect(pinDebil(p)).toBe(false);
    }
    expect(new Set(pins).size).toBe(pins.length);
  });

  it("no contienen datos reales: correos en un dominio reservado y nombres de prueba", () => {
    for (const c of CUENTAS) for (const d of c.duenos) expect(d.correo).toMatch(/@ejemplo\.invalid$/);
    for (const s of sucursales()) for (const p of s.personal) expect(p.nombre).toMatch(/Prueba$/);
  });
});
