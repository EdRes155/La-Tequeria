// El inventario cuenta también lo que una función hace a través de las que llama: un ayudante que
// no toca tablas pero llama a otro que lee la configuración depende de la sucursal.
import { describe, it, expect } from "vitest";
import { directo, conDependencias } from "../scripts/inventario-analisis.mjs";

const fn = (nombre, cuerpo, extra = {}) => ({
  nombre, args: "", resultado: "void", api: false,
  def: `CREATE OR REPLACE FUNCTION public.${nombre}()\n AS $function$\n${cuerpo}\n$function$`, ...extra,
});
const analizar = (fs) => {
  const tablas = new Set(["config", "sesiones", "usuarios", "bebidas"]);
  const nombres = new Set(fs.map((f) => f.nombre));
  return Object.fromEntries(conDependencias(fs.map((f) => ({ ...f, ...directo(f, tablas, nombres) }))).map((f) => [f.nombre, f]));
};

describe("inventario: dependencias indirectas", () => {
  const r = analizar([
    fn("_ahora_local", "select now() at time zone (select zona from public.config where id = 1)"),
    fn("_fecha", "select to_char(_ahora_local(), 'YYYY-MM-DD')"),
    fn("_sesion", "update public.sesiones set ultimo_uso = now(); select * from public.usuarios"),
    fn("_exigir", "perform public._sesion(p_token); perform _error('x', 'y')"),
    fn("_error", "raise exception 'x'"),
    fn("_ciclo_a", "perform _ciclo_b()"),
    fn("_ciclo_b", "perform _ciclo_a(); select 1 from public.bebidas"),
    fn("vender", "perform _exigir(p_token, array['mesero']); perform _fecha(); insert into public.bebidas values (1)",
      { api: true, args: "p_token text" }),
    fn("_no_es_llamada", "select 1 -- _fecha() solo en un comentario\n; select 'x_fecha(1)'"),
  ]);

  it("un ayudante sin tablas propias hereda las de las funciones que llama", () => {
    expect(r._fecha.lee).toEqual([]);
    expect(r._fecha.leeIndirecto).toEqual(["config"]);
    expect(r._fecha.indirectas).toContain("fila única `id = 1` (vía `_ahora_local`)");
    expect(r._fecha.contexto).toMatch(/quien la llama \(indirecto\)/);
  });

  it("la validación de sesión cuenta como lectura y escritura indirecta", () => {
    expect(r._exigir.leeIndirecto).toEqual(["usuarios"]);
    expect(r._exigir.escribeIndirecto).toEqual(["sesiones"]);
    expect(r._exigir.contexto).toMatch(/sesión/);
  });

  it("la API suma lo directo y lo de toda la cadena, sin repetir", () => {
    expect(r.vender.escribe).toEqual(["bebidas"]);
    expect(r.vender.leeIndirecto).toEqual(["config", "usuarios"]);
    expect(r.vender.escribeIndirecto).toEqual(["sesiones"]);
    expect(r.vender.llama).toEqual(["_exigir", "_fecha"]);
    expect(r.vender.acceso).toBe("Sesión: mesero");
  });

  it("solo es «Ninguno» si no toca datos ni directa ni indirectamente", () => {
    expect(r._error.contexto).toMatch(/^Ninguno/);
    expect(r._no_es_llamada.llama).toEqual([]);
    expect(r._no_es_llamada.contexto).toMatch(/^Ninguno/);
  });

  it("las llamadas en ciclo terminan y conservan lo que tocan", () => {
    expect(r._ciclo_a.leeIndirecto).toEqual(["bebidas"]);
  });
});
