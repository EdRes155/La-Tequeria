// Las herramientas que borran bases (DROP DATABASE … WITH (FORCE)) solo aceptan un servidor desechable.
import { describe, it, expect, afterEach } from "vitest";
import { exigirServidorDesechable, nombreDesechable } from "../scripts/base-desechable.mjs";

describe("protección de bases desechables", () => {
  afterEach(() => { delete process.env.TEQUERIA_BASE_DESECHABLE; });

  it("acepta un servidor local o el de la CI", () => {
    for (const h of ["localhost:54329", "127.0.0.1:5432", "[::1]:5432", "postgres:5432"]) {
      expect(() => exigirServidorDesechable(`postgres://postgres@${h}/postgres`)).not.toThrow();
    }
  });

  it("rechaza siempre Supabase, aunque se declare desechable", () => {
    process.env.TEQUERIA_BASE_DESECHABLE = "si";
    for (const h of ["db.abcdefghijklmnop.supabase.co", "aws-0-us-east-1.pooler.supabase.com"]) {
      expect(() => exigirServidorDesechable(`postgres://postgres:x@${h}:5432/postgres`)).toThrow(/Supabase/);
    }
  });

  it("otro servidor exige declararlo desechable", () => {
    const url = "postgres://postgres:x@pruebas.ejemplo.invalid:5432/postgres";
    expect(() => exigirServidorDesechable(url)).toThrow(/TEQUERIA_BASE_DESECHABLE/);
    process.env.TEQUERIA_BASE_DESECHABLE = "si";
    expect(() => exigirServidorDesechable(url)).not.toThrow();
  });

  it("sin URL o con una URL inválida no hace nada", () => {
    expect(() => exigirServidorDesechable(undefined)).toThrow(/TEST_DATABASE_URL/);
    expect(() => exigirServidorDesechable("no es url")).toThrow(/válida/);
  });

  it("solo crea o borra bases tq_", () => {
    expect(nombreDesechable("tq_op")).toBe("tq_op");
    for (const n of ["postgres", "tequeria", "tq_; drop database postgres", "TQ_X", "tq_"]) {
      expect(() => nombreDesechable(n)).toThrow(/no permitido/);
    }
  });
});
