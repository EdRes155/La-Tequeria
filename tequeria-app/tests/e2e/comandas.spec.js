// Repite los escenarios de la auditoría de usabilidad (UX-01…UX-11) sobre la app real en modo local.
import { test, expect } from "@playwright/test";

const CEL = { width: 390, height: 844 };

async function entrarComoAdmin(page) {
  await page.goto("/");
  await page.getByLabel("Nombre").fill("Ana");
  await page.getByLabel(/PIN \(4 a 8/).fill("8642");
  await page.getByRole("button", { name: "Crear administrador" }).click();
  await page.getByRole("button", { name: "Ana" }).click();
  await page.getByLabel("PIN", { exact: true }).fill("8642");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
}
const producto = (page, nombre) => page.getByRole("button", { name: new RegExp(`^Agregar ${nombre},`) });
const mesa = (page, n) => page.getByRole("button", { name: new RegExp(`^Mesa ${n},`) });

test("UX-01/02: el borrador sobrevive a la navegación, se guarda en celular y se envía una sola vez", async ({ page }) => {
  await page.setViewportSize(CEL);
  await entrarComoAdmin(page);
  await mesa(page, 1).click();
  await producto(page, "Taco Pastor").click();
  await page.getByRole("button", { name: "Mesas", exact: true }).first().click();
  await expect(mesa(page, 1)).toHaveAccessibleName(/sin guardar/);
  await mesa(page, 1).click();
  await expect(page.getByRole("tab", { name: "Órdenes · 1" })).toBeVisible();

  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByText(/borrador guardado \(no se envió a cocina\)/)).toBeVisible();
  await expect(mesa(page, 1)).toHaveAccessibleName(/Borrador \(guardado, no enviado a cocina\)/);

  await mesa(page, 1).click();
  await expect(page.getByText(/aún no se envía a cocina/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Órdenes · 1" })).toBeVisible();
  await page.getByRole("button", { name: "Enviar a cocina" }).click();
  await expect(page.getByText("Comanda recibida en cocina")).toBeVisible();
  await expect(mesa(page, 1)).toHaveAccessibleName(/Ocupada/);
  await mesa(page, 1).click();
  await expect(page.getByRole("heading", { name: "Lo que ya se envió a cocina" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reenviar a cocina" })).toBeVisible();
});

test("UX-03: un envío rechazado no muestra éxito, conserva la comanda y permite reintentar", async ({ page }) => {
  await entrarComoAdmin(page);
  await page.getByRole("button", { name: /Inventario/ }).click();
  const existencia = page.getByLabel("Existencia de Coca-Cola");
  await existencia.fill("1");
  await existencia.press("Enter");
  await page.getByRole("button", { name: /^Mesas/ }).click();
  await page.getByRole("button", { name: "Para llevar" }).click();
  await producto(page, "Coca-Cola").click();
  await producto(page, "Coca-Cola").click();
  await page.getByRole("button", { name: "Enviar a cocina" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "No se envió a cocina" })).toContainText("quedan 1");
  await expect(page.getByText("Comanda recibida en cocina")).toHaveCount(0);
  await page.getByRole("button", { name: /Quitar un Coca-Cola de Orden 1/ }).click();
  await page.getByRole("button", { name: "Reintentar envío" }).click();
  await expect(page.getByText("Comanda recibida en cocina")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
});

test("UX-04/08: la persona activa se ve en el menú del celular y borrar una orden con productos pide confirmación", async ({ page }) => {
  await page.setViewportSize(CEL);
  await entrarComoAdmin(page);
  await mesa(page, 2).click();
  await producto(page, "Taco Pastor").click();
  await page.getByRole("button", { name: "Agregar orden para otra persona" }).click();
  const grupo = page.getByRole("group", { name: "Persona a la que se agregan los productos" });
  await expect(grupo.getByRole("button", { name: /Orden 2/ })).toHaveAttribute("aria-pressed", "true");
  await producto(page, "Taco Bistec").click();
  await page.getByRole("tab", { name: /Órdenes/ }).click();
  await expect(page.getByRole("button", { name: "Quitar un Taco Bistec de Orden 2" })).toBeVisible();
  await page.getByRole("button", { name: "Eliminar Orden 2" }).click();
  const dlg = page.getByRole("dialog", { name: "Eliminar orden" });
  await expect(dlg).toContainText("1 producto");
  await dlg.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("button", { name: "Eliminar Orden 2" })).toBeVisible();
});

test("UX-05/07: el diálogo de domicilio es accesible, retiene el foco y Escape lo cierra", async ({ page }) => {
  await entrarComoAdmin(page);
  await page.getByRole("button", { name: "Domicilio" }).click();
  const dlg = page.getByRole("dialog", { name: "Datos del domicilio" });
  await expect(dlg).toHaveAttribute("aria-modal", "true");
  await expect(dlg.getByLabel("Dirección")).toBeVisible();
  await expect(dlg.getByLabel("Número telefónico")).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await dlg.getByRole("button", { name: "Guardar datos" }).click();
  await expect(dlg.getByText("Escribe la dirección.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Datos del domicilio" })).toBeVisible();
});

test("UX-06/07/09/11: contraste, objetivos táctiles, navegación en 320 px y zoom permitido", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await entrarComoAdmin(page);
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1/);
  for (const nombre of ["Mesas", "Cocina", "Invent.", "Gastos", "Admin"]) {
    const box = await page.getByRole("navigation", { name: "Secciones" }).getByRole("button", { name: new RegExp(nombre) }).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await mesa(page, 3).click();
  const ratio = await page.evaluate(() => {
    const lum = (rgb) => { const c = rgb.match(/\d+/g).slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    return [...document.querySelectorAll(".col-head")].map((h) => { const a = lum(getComputedStyle(h).backgroundColor), b = lum(getComputedStyle(h).color); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); });
  });
  expect(ratio.length).toBe(3);
  for (const r of ratio) expect(r).toBeGreaterThanOrEqual(4.5);

  await producto(page, "Taco Pastor").click();
  await page.getByRole("tab", { name: /Órdenes/ }).click();
  const mas = await page.getByRole("button", { name: "Agregar un Taco Pastor a Orden 1" }).boundingBox();
  expect(mas.width).toBeGreaterThanOrEqual(44);
  expect(mas.height).toBeGreaterThanOrEqual(44);
});

test("cocina: lo listo se puede regresar a preparación y el corte no borra pendientes", async ({ page }) => {
  await entrarComoAdmin(page);
  for (const tipo of ["Para llevar", "Para llevar"]) {
    await page.getByRole("button", { name: tipo }).click();
    await producto(page, "Taco Pastor").click();
    await page.getByRole("button", { name: "Enviar a cocina" }).click();
    await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
  }
  await page.getByRole("button", { name: /^Cocina/ }).click();
  await page.getByRole("button", { name: "Listo" }).first().click();
  await expect(page.getByRole("button", { name: /Regresar Para llevar a preparación/ })).toBeVisible();
  await page.getByRole("tab", { name: "Ventas / Corte" }).click();
  await expect(page.locator(".corte-total")).toHaveText("$40");
  await page.getByRole("button", { name: "Hacer corte" }).click();
  await page.getByRole("dialog", { name: "Corte del día" }).getByRole("button", { name: "Hacer corte" }).click();
  await page.getByLabel("PIN de administrador").fill("8642");
  await page.getByRole("button", { name: "Autorizar" }).click();
  await expect(page.getByText("Corte guardado: 2 venta(s) · $40")).toBeVisible();
  await page.getByRole("tab", { name: /Pendientes/ }).click();
  await expect(page.locator(".kticket")).toHaveCount(1);
});
