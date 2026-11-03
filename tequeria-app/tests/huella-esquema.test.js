// La normalización de la huella del esquema quita comentarios y espacios solo fuera de los literales.
import { describe, it, expect } from "vitest";
import { normalizarSql, huellaEsquema, diferenciasEsquema } from "../scripts/huella-esquema.mjs";

describe("huella del esquema: normalización", () => {
  it("quita comentarios de línea y de bloque (anidados) y reduce los espacios", () => {
    expect(normalizarSql("select  1 -- uno\n\n  from /* a /* b */ c */ t")).toBe("select 1 from t");
    expect(normalizarSql("begin\n  -- comentario\n  x := 1;\nend")).toBe(normalizarSql("begin x := 1; end"));
  });

  it("conserva exacto el contenido de los literales", () => {
    expect(normalizarSql("select 'a  b -- no es comentario'")).toBe("select 'a  b -- no es comentario'");
    expect(normalizarSql("select 'a  b'")).not.toBe(normalizarSql("select 'a b'"));
    expect(normalizarSql("select 'it''s  x'")).toBe("select 'it''s  x'");
    expect(normalizarSql("select E'a\\'  b'")).toBe("select E'a\\'  b'");
    expect(normalizarSql('select "Columna  Rara"')).toBe('select "Columna  Rara"');
    expect(normalizarSql("execute $q$ select  1 -- x\n $q$")).toBe("execute $q$ select  1 -- x\n $q$");
  });

  it("no confunde parámetros ni identificadores con literales", () => {
    expect(normalizarSql("select  $1,   $2")).toBe("select $1, $2");
    expect(normalizarSql("select precio$x  from t")).toBe("select precio$x from t");
  });

  it("la huella ordena las entradas y señala las diferencias", () => {
    const a = [{ categoria: "funciones", entrada: "f()", cuerpo: "select 1 -- x" }, { categoria: "tablas", entrada: "t rls=true", cuerpo: null }];
    const b = [{ categoria: "tablas", entrada: "t rls=true", cuerpo: null }, { categoria: "funciones", entrada: "f()", cuerpo: "select  1" }];
    expect(huellaEsquema(a)).toEqual(huellaEsquema(b));
    const c = [{ categoria: "tablas", entrada: "t rls=false", cuerpo: null }, a[0]];
    expect(diferenciasEsquema(a, c)).toEqual({ tablas: { soloA: ["t rls=true"], soloB: ["t rls=false"] } });
  });
});
