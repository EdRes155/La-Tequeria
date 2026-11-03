// Vencimientos y bloqueos con reloj controlado (public._ahora() reemplazada en la base de prueba).
// Documentan la política vigente; al implementar los mínimos del plan multinegocio (PIN de 6 a 8
// dígitos, bloqueos 15/30/60, sesión de 12 h e inactividad de 15 min) estos casos se actualizan.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { URL_ADMIN, ESQUEMA, STUB, crearBase, conectar, cerrarTodo, falla, relojControlado } from "./util.js";

const d = URL_ADMIN ? describe : describe.skip;
const BASE = "tq_reloj";

d("reloj controlado", () => {
  let sql, api, reloj, ana;
  beforeAll(async () => {
    sql = await crearBase(BASE, [STUB, ESQUEMA]);
    ana = (await sql.query("select public.crear_admin_inicial('Ana', '8642') id")).rows[0].id;
    reloj = await relojControlado(sql);
    api = await conectar(BASE);
  });
  afterAll(cerrarTodo);

  const entrar = (pin, dispositivo = "caja") => api.rpc("login", { p_id: ana, p_pin: pin, p_dispositivo: dispositivo });
  const estado = (token) => api.rpc("estado", { p_token: token, p_partes: ["config"] });

  it("bloquea tras 5 PIN incorrectos y libera al pasar el tiempo, sin esperarlo de verdad", async () => {
    for (let i = 0; i < 4; i++) expect((await entrar("0000")).error).toBe("pin");
    expect(await entrar("0000")).toMatchObject({ ok: false, error: "pin", restantes: 0 });
    expect(await entrar("8642")).toMatchObject({ ok: false, error: "bloqueado", espera: 300 });   // un PIN correcto no entra
    await reloj.avanzar({ minutos: 4 });
    expect(await entrar("8642")).toMatchObject({ error: "bloqueado", espera: 60 });
    await reloj.avanzar({ minutos: 1, segundos: 1 });
    expect((await entrar("8642")).ok).toBe(true);
  });

  it("la sesión vence tras 14 h sin uso y como máximo a los 3 días aunque se use", async () => {
    const t1 = (await entrar("8642")).token;
    await reloj.avanzar({ horas: 13 });
    expect((await estado(t1)).yo.nombre).toBe("Ana");
    await reloj.avanzar({ horas: 14, minutos: 1 });
    expect((await falla(estado(t1))).message).toBe("SESION");

    const t2 = (await entrar("8642")).token;
    for (let h = 12; h <= 60; h += 12) {
      await reloj.avanzar({ horas: 12 });
      expect((await estado(t2)).yo.nombre).toBe("Ana");
    }
    await reloj.avanzar({ horas: 12, minutos: 1 });   // 72 h y un minuto desde que se creó
    expect((await falla(estado(t2))).message).toBe("SESION");
  });
});
