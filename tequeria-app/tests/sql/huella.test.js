// La huella de datos (scripts/huella-datos.sql) resume y además firma cada fila, sin exponer datos
// personales. La comparación por entidad (scripts/huella.mjs) detecta lo que los agregados no ven.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { URL_ADMIN, STUB, leer, crearBase, conectar, cerrarTodo, falla, huellaDe } from "./util.js";
import { compararHuellas } from "../../scripts/huella.mjs";

const ORIGEN = [STUB, leer("tests/sql/esquema-v3.sql"), leer("tests/sql/produccion-extra.sql"), leer("tests/sql/datos-v3.sql")];
const d = URL_ADMIN ? describe : describe.skip;

d("huella de datos", () => {
  let sql;
  const sal = randomBytes(16).toString("hex");
  const huella = () => huellaDe(sql, "origen", sal);
  // Aplica un cambio, toma la huella y lo deshace
  const conCambio = async (cambio) => {
    await sql.query("begin");
    try { await sql.query(cambio); return await huella(); } finally { await sql.query("rollback"); }
  };
  beforeAll(async () => { sql = await crearBase("tq_huella", ORIGEN); });
  afterAll(cerrarTodo);

  it("exige la versión y una sal suficiente", async () => {
    const otra = await conectar("tq_huella", false); // sesión nueva, sin parámetros
    expect((await falla(otra.query(leer("scripts/huella-datos.sql")))).message).toMatch(/huella\.version/);
    expect((await falla(huellaDe(sql, "intermedia", sal))).message).toMatch(/huella: huella\.version/);
    expect((await falla(huellaDe(sql, "origen", "corta"))).message).toMatch(/16 caracteres/);
  });

  it("resume cada estado de cobro y no encuentra referencias rotas", async () => {
    const h = await huella();
    expect(h.resumen.ventas.por_estado_cobro).toEqual({ previo: 3, cobrado: 3, no_cobrado: 1, pendiente: 1 });
    expect(h.resumen.abierto.por_cobrar).toBe(1);
    expect(Object.values(h.resumen.referencias_rotas).every((n) => n === 0)).toBe(true);
    expect(Object.keys(h.entidades.tickets)).toHaveLength(8);
  });

  it("es estable: dos huellas de los mismos datos son iguales", async () => {
    expect(compararHuellas(await huella(), await huella()).iguales).toBe(true);
  });

  it("intercambiar existencias entre dos bebidas no cambia el resumen, pero sí la comparación por entidad", async () => {
    const antes = await huella();
    const despues = await conCambio(`update public.bebidas b set cantidad = x.c from (values ('coca', (select cantidad from public.bebidas where id = 'jamaica')),
      ('jamaica', (select cantidad from public.bebidas where id = 'coca'))) x(id, c) where b.id = x.id`);
    expect(despues.resumen).toEqual(antes.resumen);
    const r = compararHuellas(antes, despues);
    expect(r.iguales).toBe(false);
    expect(r.resumen).toEqual([]);
    expect(r.entidades).toEqual({ bebidas: { faltan: [], sobran: [], distintas: ["coca", "jamaica"] } });
  });

  it("detecta filas que faltan, sobran o cambian, y referencias rotas", async () => {
    const antes = await huella();
    const despues = await conCambio(`delete from public.gastos where id = 'gasto-0002';
      insert into public.gastos (id, concepto, monto) values ('gasto-intruso', 'X', 1);
      update public.tickets set cobro_id = 'no-existe' where id = 't-cobrado-3'`);
    const r = compararHuellas(antes, despues);
    expect(r.entidades.gastos).toEqual({ faltan: ["gasto-0002"], sobran: ["gasto-intruso"], distintas: [] });
    expect(r.entidades.tickets.distintas).toEqual(["t-cobrado-3"]);
    expect(despues.resumen.referencias_rotas.tickets_cobro).toBe(1);
  });

  it("no contiene datos personales en claro", async () => {
    const texto = JSON.stringify(await huella());
    for (const s of ["Ana Prueba", "Luis Prueba", "Toño Prueba", "Cliente Prueba", "Calle Ficticia", "5550009999",
                     "a1b2c3d4e5f6", "b2c3d4e5f6a1", "c3d4e5f6a1b2", "$2"]) {
      expect(texto).not.toContain(s);
    }
  });

  it("no compara huellas tomadas con sales distintas", async () => {
    const otra = await huellaDe(sql, "origen", randomBytes(16).toString("hex"));
    expect(() => compararHuellas(otra, otra)).not.toThrow();
    await huellaDe(sql, "origen", sal);
    expect(() => compararHuellas(otra, { ...otra, sal: "distinta" })).toThrow(/sales distintas/);
  });
});
