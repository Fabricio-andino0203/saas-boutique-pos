import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";

const copy = messages.reports;

// Las tarjetas de /reportes se buscan por su dirección: sus nombres también están en el menú lateral.
const card = (page: import("@playwright/test").Page, href: string) =>
  page.locator(`main a[href="${href}"]`);

// Estas pantallas solo leen: no necesitan caja abierta. Usan los datos que haya (la historia de prueba los hace abundantes,
// pero las pruebas no dependen de cifras exactas).
test("a manager reads every report, with profit and margins", async ({ page }) => {
  test.slow();
  await loginAs(page, "manager");
  await page.goto("/reportes");
  await expect(page.getByRole("heading", { name: copy.title, level: 1 })).toBeVisible();
  for (const href of [
    "/reportes/ventas",
    "/reportes/productos",
    "/reportes/tallas",
    "/reportes/cierres",
    "/reportes/inventario",
  ]) {
    await expect(card(page, href).first()).toBeVisible();
  }

  // Ventas: el resumen del periodo y sus desgloses
  await card(page, "/reportes/ventas").first().click();
  await expect(page.getByRole("heading", { name: copy.sales.title, level: 1 })).toBeVisible();
  await page.getByRole("link", { name: copy.filter.presets.year }).click();
  await expect(page.getByRole("link", { name: copy.filter.presets.year })).toHaveAttribute(
    "aria-current",
    "true",
  );
  for (const label of [
    copy.summary.sales,
    copy.summary.returns,
    copy.summary.net,
    copy.summary.tickets,
    copy.summary.average,
    copy.summary.profit,
    copy.summary.margin,
  ]) {
    await expect(page.getByRole("group", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("img", { name: new RegExp(copy.sales.charts.period) })).toBeVisible();
  await expect(page.getByRole("table", { name: copy.sales.by.period })).toBeVisible();

  await page.getByRole("link", { name: copy.sales.by.category }).click();
  const byCategory = page.getByRole("table", { name: copy.sales.by.category });
  await expect(byCategory).toBeVisible();
  await expect(
    byCategory.getByRole("columnheader", { name: copy.sales.columns.profit }),
  ).toBeVisible();

  await page.getByRole("link", { name: copy.sales.by.method }).click();
  await expect(page.getByRole("table", { name: copy.sales.by.method })).toContainText(
    messages.cash.methods.CASH,
  );
  await page.getByRole("link", { name: copy.sales.by.hour }).click();
  await expect(page.getByRole("img", { name: new RegExp(copy.sales.charts.hour) })).toBeVisible();
  await page.getByRole("link", { name: copy.sales.by.cashier }).click();
  await expect(page.getByRole("table", { name: copy.sales.by.cashier })).toBeVisible();

  // Fechas exactas y un periodo sin ventas
  await page.goto("/reportes/ventas?desde=2020-01-01&hasta=2020-01-31");
  await expect(page.getByText(copy.common.empty)).toBeVisible();

  // Productos: más y menos vendidos
  await page.goto("/reportes/productos?rango=year");
  await expect(page.getByRole("table", { name: copy.products.order.best })).toBeVisible();
  await page.getByRole("link", { name: copy.products.order.worst }).click();
  await expect(page.getByRole("table", { name: copy.products.order.worst })).toBeVisible();

  // Tallas y colores, cierres de caja e inventario
  await page.goto("/reportes/tallas?rango=year");
  await expect(page.getByRole("table", { name: copy.sizes.title })).toBeVisible();
  await page.goto("/reportes/cierres?rango=year");
  await expect(page.getByRole("group", { name: copy.closings.cards.count })).toBeVisible();
  await page.goto("/reportes/inventario");
  await expect(page.getByRole("heading", { name: copy.inventory.valuation.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: copy.inventory.dead.title })).toBeVisible();
});

test("a cashier sees only their own sales and never costs, profit or the inventory value", async ({
  page,
}) => {
  test.slow();
  await loginAs(page, "cashier");
  await page.goto("/reportes");
  await expect(card(page, "/reportes/ventas").first()).toBeVisible();
  await expect(card(page, "/reportes/cierres")).toHaveCount(0);
  await expect(card(page, "/reportes/inventario")).toHaveCount(0);

  await page.goto("/reportes/ventas?rango=year");
  await expect(page.getByRole("heading", { name: copy.sales.title, level: 1 })).toBeVisible();
  await expect(page.getByText(copy.onlyMine)).toBeVisible();
  await expect(page.getByRole("group", { name: copy.summary.sales, exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: copy.summary.profit, exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: copy.summary.margin, exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: copy.sales.by.category }).click();
  const byCategory = page.getByRole("table", { name: copy.sales.by.category });
  await expect(byCategory).toBeVisible();
  await expect(
    byCategory.getByRole("columnheader", { name: copy.sales.columns.profit }),
  ).toHaveCount(0);
  await expect(
    byCategory.getByRole("columnheader", { name: copy.sales.columns.revenue }),
  ).toHaveCount(0);

  // Lo que no es suyo no existe para esa persona
  for (const path of ["/reportes/inventario", "/reportes/cierres"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();
  }
});

test("the warehouse has no reports menu and cannot open the screens", async ({ page }) => {
  await loginAs(page, "warehouse");
  await expect(page.getByRole("link", { name: messages.nav.reports, exact: true })).toHaveCount(0);
  for (const path of [
    "/reportes",
    "/reportes/ventas",
    "/reportes/productos",
    "/reportes/inventario",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();
  }
});

// ───────────── Exportación e impresión ─────────────

test("a manager downloads a report as Excel and as CSV, and prints the valuation", async ({
  page,
}) => {
  test.slow();
  await loginAs(page, "manager");
  await page.goto("/reportes/ventas?rango=year&por=categoria");
  await expect(page.getByRole("table", { name: copy.sales.by.category })).toBeVisible();

  const [excel] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: copy.export.excel }).click(),
  ]);
  expect(excel.suggestedFilename()).toMatch(
    /^reporte-ventas-categoria-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await excel.path()) as string);
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    "Resumen",
    copy.sales.by.category,
  ]);
  const sheet = workbook.getWorksheet(copy.sales.by.category) as ExcelJS.Worksheet;
  expect(sheet.getRow(1).getCell(1).value).toBe(copy.sales.columns.category);
  expect(sheet.getRow(1).values).toContain(copy.sales.columns.profit);
  expect(sheet.getRow(2).getCell(3).numFmt).toContain("#,##0.00");

  const [csv] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: copy.export.csv, exact: true }).click(),
  ]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  const text = readFileSync((await csv.path()) as string, "utf8");
  expect(text.startsWith("\uFEFF")).toBe(true);
  expect(text.split("\r\n")[0]).toContain(copy.sales.columns.profit);

  // La valoración en hoja imprimible
  await page.goto("/imprimir/valoracion");
  await expect(page.getByRole("article", { name: copy.inventory.valuation.title })).toBeVisible();
  await expect(page.getByRole("table", { name: copy.inventory.valuation.title })).toBeVisible();
});

test("a cashier's exports never carry costs and the manager-only reports are not there", async ({
  page,
  browser,
}) => {
  test.slow();
  await loginAs(page, "cashier");
  const csv = await page.request.get(
    "/api/reportes/ventas/exportar?formato=csv&rango=year&por=categoria",
  );
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-disposition"]).toContain("attachment");
  const body = await csv.text();
  for (const word of ["Costo", "Utilidad", "Margen", "Ingreso sin ISV"]) {
    expect(body, word).not.toContain(word);
  }
  const xlsx = await page.request.get("/api/reportes/productos/exportar?formato=xlsx&rango=year");
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");

  for (const path of [
    "/api/reportes/cierres/exportar?formato=csv",
    "/api/reportes/inventario/exportar?formato=csv",
    "/api/reportes/nada/exportar",
  ]) {
    expect((await page.request.get(path)).status(), path).toBe(404);
  }
  await page.goto("/imprimir/valoracion");
  await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();

  // Sin sesión tampoco
  const anonymous = await browser.newContext({
    baseURL: test.info().project.use.baseURL as string,
  });
  // El sistema manda a iniciar sesión (o responde que no existe): en ningún caso entrega el archivo
  const denied = await anonymous.request.get("/api/reportes/ventas/exportar?formato=csv", {
    maxRedirects: 0,
  });
  expect([302, 303, 307, 308, 404]).toContain(denied.status());
  expect(denied.headers()["content-disposition"] ?? "").not.toContain("attachment");
  await anonymous.close();
});
