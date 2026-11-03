// La huella de datos (scripts/huella-datos.sql) corre sobre el esquema vigente, detecta referencias
// rotas y no expone datos personales. Es la base para comparar antes y después de la migración.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { URL_ADMIN, ESQUEMA, STUB, leer, crearBase, cerrarTodo } from "./util.js";

const HUELLA = leer("scripts/huella-datos.sql");
const d = URL_ADMIN ? describe : describe.skip;

d("huella de datos para la migración", () => {
  let sql;
  const huella = async () => (await sql.query(HUELLA)).rows[0].huella;
  beforeAll(async () => {
    sql = await crearBase("tq_huella", [STUB, leer("tests/sql/esquema-v2.sql"), leer("tests/sql/datos-v2.sql"), ESQUEMA]);
  });
  afterAll(cerrarTodo);

  it("resume los datos actuales sin referencias rotas", async () => {
    const h = await huella();
    expect(h.tablas.tickets).toBeGreaterThan(0);
    expect(h.ventas.folios_repetidos).toBe(0);
    expect(Object.values(h.referencias_rotas).every((n) => n === 0)).toBe(true);
  });

  it("es estable: dos huellas seguidas de los mismos datos son iguales", async () => {
    expect(await huella()).toEqual(await huella());
  });

  it("detecta una referencia rota", async () => {
    await sql.query("update public.tickets set cobro_id = 'no-existe' where id = (select id from public.tickets limit 1)");
    expect((await huella()).referencias_rotas.tickets_cobro).toBe(1);
  });

  it("no contiene datos personales", async () => {
    const texto = JSON.stringify(await huella());
    const { rows } = await sql.query(`select nombre from public.usuarios union all select domicilio->>'telefono' from public.tickets
      where domicilio ? 'telefono' union all select domicilio->>'direccion' from public.tickets where domicilio ? 'direccion'`);
    for (const { nombre } of rows) if (nombre) expect(texto).not.toContain(nombre);
  });
});
