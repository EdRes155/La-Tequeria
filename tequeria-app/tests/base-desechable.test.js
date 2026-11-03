// Las herramientas que borran bases (DROP DATABASE … WITH (FORCE)) solo aceptan un servidor desechable,
// y lo que se revisa es el destino efectivo del cliente que después se conecta. Ninguna prueba se conecta.
import { describe, it, expect, afterEach } from "vitest";
import { clienteDesechable, exigirServidorDesechable, nombreDesechable } from "../scripts/base-desechable.mjs";

describe("protección de bases desechables", () => {
  const PGHOST = process.env.PGHOST;
  afterEach(() => {
    delete process.env.TEQUERIA_BASE_DESECHABLE;
    if (PGHOST === undefined) delete process.env.PGHOST; else process.env.PGHOST = PGHOST;
  });

  it("acepta un servidor local, un socket Unix o el de la CI", () => {
    for (const h of ["localhost:54329", "127.0.0.1:5432", "[::1]:5432", "postgres:5432"]) {
      expect(() => exigirServidorDesechable(`postgres://postgres@${h}/postgres`)).not.toThrow();
    }
    expect(exigirServidorDesechable("postgres://postgres@localhost/postgres?host=/tmp")).toBe("/tmp");
  });

  it("rechaza siempre Supabase, aunque se declare desechable", () => {
    process.env.TEQUERIA_BASE_DESECHABLE = "si";
    for (const h of ["db.abcdefghijklmnop.supabase.co", "aws-0-us-east-1.pooler.supabase.com"]) {
      expect(() => exigirServidorDesechable(`postgres://postgres:x@${h}:5432/postgres`)).toThrow(/Supabase/);
    }
  });

  it("revisa el servidor efectivo: un ?host= en la URL no lo puede cambiar", () => {
    expect(() => exigirServidorDesechable("postgres://postgres@localhost:5432/postgres?host=db.ejemplo.supabase.co")).toThrow(/Supabase/);
    expect(() => exigirServidorDesechable("postgres://postgres@localhost:5432/postgres?host=pruebas.ejemplo.invalid"))
      .toThrow(/TEQUERIA_BASE_DESECHABLE/);
    expect(() => exigirServidorDesechable("postgresql://postgres@localhost,db.ejemplo.supabase.co/postgres")).toThrow(/Se rechaza/);
  });

  it("revisa el servidor efectivo: tampoco lo cambia PGHOST si la URL no trae servidor", () => {
    process.env.PGHOST = "db.ejemplo.supabase.co";
    expect(() => exigirServidorDesechable("postgres:///postgres")).toThrow(/Supabase/);
  });

  it("devuelve el mismo cliente que validó, apuntando a la base pedida", () => {
    const c = clienteDesechable("postgres://postgres@localhost:54329/postgres", "tq_prueba");
    expect(c.connectionParameters.host).toBe("localhost");
    expect(c.connectionParameters.port).toBe(54329);
    expect(c.connectionParameters.database).toBe("tq_prueba");
    expect(() => clienteDesechable("postgres://postgres@localhost/postgres", "produccion")).toThrow(/no permitido/);
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
