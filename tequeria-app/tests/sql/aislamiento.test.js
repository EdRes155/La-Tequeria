// Matriz de aislamiento entre sucursales. Los casos por función quedan pendientes (it.todo) hasta
// implementar el núcleo de docs/multinegocio/MODELO.md; se escriben con tests/fixtures/multinegocio.js.
// La guardia ya está activa: cada firma que pueden ejecutar anon o authenticated necesita su entrada
// con al menos un caso.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { URL_ADMIN, ESQUEMA, STUB, crearBase, cerrarTodo } from "./util.js";
import { MATRIZ, casosDe, revisarMatriz } from "./matriz-aislamiento.js";

describe("guardia de la matriz (sin base)", () => {
  const externas = ["estado(text, text[])", "login(text, text, text)"];
  const matriz = { "estado(text, text[])": { sesion: true }, "login(text, text, text)": { casos: ["x"] } };

  it("detecta una sobrecarga nueva de una función que ya está en la matriz", () => {
    expect(revisarMatriz([...externas, "estado(text, text[], boolean)"], matriz).faltan).toEqual(["estado(text, text[], boolean)"]);
  });
  it("detecta una función que solo puede ejecutar authenticated", () => {
    // la lista de externas incluye las de anon y las de authenticated; aquí basta con que aparezca
    expect(revisarMatriz([...externas, "solo_dueno(text)"], matriz).faltan).toEqual(["solo_dueno(text)"]);
  });
  it("rechaza una entrada que no genera ningún caso", () => {
    expect(revisarMatriz(externas, { ...matriz, "nueva_api()": {} }).sinCasos).toEqual(["nueva_api()"]);
  });
  it("pide pasar a firma completa una función futura que ya existe", () => {
    expect(revisarMatriz([...externas, "desbloquear(text, text)"], { ...matriz, desbloquear: { futura: true, casos: ["x"] } }).futurasQueYaExisten).toEqual(["desbloquear"]);
  });
});

const d = URL_ADMIN ? describe : describe.skip;
d("guardia de la matriz contra el esquema", () => {
  let externas = [];
  beforeAll(async () => {
    const sql = await crearBase("tq_matriz", [STUB, ESQUEMA]);
    externas = (await sql.query(`select p.proname || '(' || oidvectortypes(p.proargtypes) || ')' firma from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
      order by 1`)).rows.map((r) => r.firma);
  });
  afterAll(cerrarTodo);

  it("cada firma ejecutable desde fuera tiene casos, y no sobra ninguna", () => {
    expect(externas.length).toBeGreaterThan(0);
    expect(revisarMatriz(externas)).toEqual({ faltan: [], sobran: [], sinCasos: [], futurasQueYaExisten: [] });
  });
});

describe("matriz de aislamiento entre sucursales (pendiente del núcleo multinegocio)", () => {
  for (const [firma, f] of Object.entries(MATRIZ)) {
    describe(firma + (f.futura ? " (nueva)" : ""), () => {
      for (const c of casosDe(f)) it.todo(c);
    });
  }
});
