import { expect, test, type Browser, type Page } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { createInvoiceRange, deactivateInvoiceRange } from "./helpers/billing";
import { closeLeftoverCash, fillMoney } from "./helpers/cash";
import { loginAs } from "./helpers/login";
import { addStock, createSimpleProduct } from "./helpers/products";

const copy = messages.cash;

// Hay una sola terminal ("Caja 1"): solo puede haber un turno abierto. Todo lo que abre caja va en este archivo y en
// fila, porque los archivos distintos corren en paralelo.
test.describe.configure({ mode: "serial" });

test("people without a cash drawer have no cash menu and cannot open the screens", async ({
  page,
}) => {
  await loginAs(page, "warehouse");
  await expect(page.getByRole("link", { name: messages.nav.cash, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: messages.nav.sell, exact: true })).toHaveCount(0);
  for (const path of ["/caja", "/caja/cierres", "/vender", "/imprimir/cierre/cualquiera"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();
  }
});

test("the cashier opens the shift, moves cash, closes with a difference and a manager approves", async ({
  page,
  browser,
}) => {
  test.slow();
  await loginAs(page, "cashier");
  await closeLeftoverCash(page);
  await page.goto("/caja");

  // Abrir con fondo de L 500
  await expect(page.getByRole("heading", { name: copy.open.title })).toBeVisible();
  await fillMoney(page, copy.open.float, "500");
  await page.getByRole("button", { name: copy.open.submit }).click();
  const expected = page.getByRole("group", { name: copy.current.expected });
  await expect(expected).toContainText("L 500.00");

  // Una salida de L 100 con motivo, y una que no se puede (más de lo que hay)
  await fillMoney(page, copy.movements.amount, "100");
  await page.getByLabel(copy.movements.reason, { exact: true }).fill("E2E pago de flete");
  await page.getByRole("button", { name: copy.movements.submit }).click();
  await expect(expected).toContainText("L 400.00");

  await fillMoney(page, copy.movements.amount, "9999");
  await page.getByLabel(copy.movements.reason, { exact: true }).fill("E2E demasiado");
  await page.getByRole("button", { name: copy.movements.submit }).click();
  await expect(page.getByText(messages.errors.INSUFFICIENT_CASH)).toBeVisible();
  await expect(expected).toContainText("L 400.00");

  // Una entrada de L 50
  await page.getByRole("radio", { name: copy.movements.IN }).check();
  await fillMoney(page, copy.movements.amount, "50");
  await page.getByLabel(copy.movements.reason, { exact: true }).fill("E2E cambio del banco");
  await page.getByRole("button", { name: copy.movements.submit }).click();
  await expect(expected).toContainText("L 450.00");

  // Cerrar contando L 449: falta L 1 y el comentario es obligatorio
  await fillMoney(page, copy.close.counted, "449");
  await page.getByRole("button", { name: copy.close.check }).click();
  await expect(page.getByText(`${copy.close.short} L 1.00`)).toBeVisible();
  const closeButton = page.getByRole("button", { name: copy.close.submit, exact: true });
  await expect(closeButton).toBeDisabled();
  await page.getByLabel(copy.close.notes).fill("E2E faltó un billete de un lempira");
  await expect(closeButton).toBeEnabled();
  await closeButton.click();

  // Queda por aprobar; la cajera no puede aprobar su propio cierre
  await expect(page).toHaveURL(/\/caja\/cierres\/[a-z0-9]+$/);
  const detailUrl = page.url();
  await expect(page.getByText(copy.status.CLOSED_PENDING_APPROVAL, { exact: true })).toBeVisible();
  await expect(page.getByText(copy.approve.needManager)).toBeVisible();
  await expect(page.getByRole("button", { name: copy.approve.action })).toHaveCount(0);
  await expect(page.getByRole("region", { name: copy.detail.notes })).toContainText(
    "E2E faltó un billete de un lempira",
  );

  // Una caja cerrada ya no recibe movimientos: /caja vuelve a pedir abrir
  await page.goto("/caja");
  await expect(page.getByRole("heading", { name: copy.open.title })).toBeVisible();

  // El gerente la ve en la lista de pendientes y la aprueba
  const other = await browser.newContext({ baseURL: new URL(detailUrl).origin });
  const manager = await other.newPage();
  await loginAs(manager, "manager");
  await manager.goto("/caja/cierres");
  await expect(
    manager.getByText(copy.list.pending).or(manager.getByText(copy.list.pendingOne)),
  ).toBeVisible();
  await manager.goto(detailUrl);
  await manager.getByRole("button", { name: copy.approve.action }).click();
  await expect(manager.getByText(copy.approve.approved)).toBeVisible();
  await expect(manager.getByText(copy.status.CLOSED, { exact: true })).toBeVisible();
  await expect(manager.getByRole("button", { name: copy.approve.action })).toHaveCount(0);

  // La hoja para imprimir lleva el resumen y las firmas
  await manager.goto(detailUrl.replace("/caja/cierres/", "/imprimir/cierre/"));
  await expect(manager.getByRole("heading", { name: copy.print.title })).toBeVisible();
  await expect(manager.getByText(copy.print.signCashier)).toBeVisible();
  await expect(manager.getByText(copy.print.signManager)).toBeVisible();
  await expect(manager.getByRole("button", { name: copy.print.print })).toBeVisible();
  await other.close();
});

test("the cashier counts bills and coins and closes a shift that balances", async ({ page }) => {
  test.slow();
  await loginAs(page, "cashier");
  await closeLeftoverCash(page);
  await page.goto("/caja");

  await fillMoney(page, copy.open.float, "0");
  await page.getByRole("button", { name: copy.open.submit }).click();
  const expected = page.getByRole("group", { name: copy.current.expected });
  await expect(expected).toContainText("L 0.00");

  await page.getByRole("radio", { name: copy.movements.IN }).check();
  await fillMoney(page, copy.movements.amount, "700");
  await page.getByLabel(copy.movements.reason, { exact: true }).fill("E2E cambio inicial");
  await page.getByRole("button", { name: copy.movements.submit }).click();
  await expect(expected).toContainText("L 700.00");

  // L 500 + L 200 por denominaciones: el total sale solo
  await page.getByRole("checkbox", { name: copy.close.byDenomination }).check();
  await page.getByLabel(`${copy.close.denomination} L 500.00`, { exact: true }).fill("1");
  await page.getByLabel(`${copy.close.denomination} L 200.00`, { exact: true }).fill("1");
  await expect(page.getByText(copy.close.denominationsTotal)).toContainText("L 700.00");
  await page.getByRole("button", { name: copy.close.check }).click();
  await expect(page.getByText(copy.close.matches)).toBeVisible();

  // Cuadra: no hace falta comentario
  const closeButton = page.getByRole("button", { name: copy.close.submit, exact: true });
  await expect(closeButton).toBeEnabled();
  await closeButton.click();
  await expect(page).toHaveURL(/\/caja\/cierres\/[a-z0-9]+$/);
  await expect(
    page.getByRole("heading", { name: messages.cash.detail.denominationsTitle }),
  ).toBeVisible();
  await expect(page.getByText("× 1")).toHaveCount(2);
});

// ───────────── Punto de venta ─────────────

const pos = messages.pos;

test("without an open shift the sale screen asks to open the cash", async ({ page }) => {
  await loginAs(page, "cashier");
  await closeLeftoverCash(page);
  await page.goto("/vender");
  await expect(page.getByRole("heading", { name: pos.closed.title })).toBeVisible();
  await page.getByRole("link", { name: pos.closed.action }).click();
  await expect(page).toHaveURL(/\/caja$/);
});

test("the cashier sells with search, quantities, a discount, a held ticket and a customer", async ({
  page,
  browser,
}) => {
  test.slow();
  const name = `E2E Venta ${Date.now()}`;
  const baseURL = test.info().project.use.baseURL as string;

  // El propietario crea la prenda y le da 3 existencias
  const ownerContext = await browser.newContext({ baseURL });
  const owner = await ownerContext.newPage();
  await loginAs(owner, "owner");
  await createSimpleProduct(owner, name, "120", "L 120.00");
  await addStock(owner, name, "3");
  await ownerContext.close();

  // La cajera abre su caja y entra a vender
  await loginAs(page, "cashier");
  await closeLeftoverCash(page);
  await page.goto("/caja");
  await fillMoney(page, messages.cash.open.float, "0");
  await page.getByRole("button", { name: messages.cash.open.submit }).click();
  await expect(page.getByRole("group", { name: messages.cash.current.expected })).toBeVisible();
  await page.goto("/vender");
  await expect(page.getByRole("heading", { name: pos.title, level: 1 })).toBeVisible();
  const search = page.getByRole("textbox", { name: pos.search.label });
  await expect(search).toBeFocused();

  // Buscar por nombre y elegir la prenda (tiene una sola variante: entra directo)
  const total = page.getByRole("group", { name: pos.ticket.total });
  await expect(async () => {
    await search.fill(name);
    await page.getByRole("button", { name: `${name}, L 120.00` }).click({ timeout: 3000 });
  }).toPass();
  await expect(page.getByText(`${pos.notices.added} ${name}`)).toBeVisible();
  await expect(total).toContainText("L 120.00");

  // Más cantidad, hasta lo que hay en existencia; una más avisa y no suma
  const more = page.getByRole("button", { name: `${pos.ticket.increase}: ${name}` });
  await more.click();
  await more.click();
  await expect(total).toContainText("L 360.00");
  await more.click();
  await expect(page.getByText(pos.notices.outOfStock)).toBeVisible();
  await expect(total).toContainText("L 360.00");

  // Descuento de 10 % a la línea seleccionada (F4); pasar del límite avisa
  await page.getByRole("button", { name, exact: true }).click();
  await page.keyboard.press("F4");
  const discountValue = page.getByLabel(pos.discount.value, { exact: true });
  await expect(async () => {
    await discountValue.fill("15");
    await expect(page.getByText(pos.discount.overLimit)).toBeVisible({ timeout: 2000 });
  }).toPass();
  await discountValue.fill("10");
  await expect(page.getByText(pos.discount.overLimit)).toHaveCount(0);
  await page.getByRole("button", { name: pos.discount.apply }).click();
  await expect(total).toContainText("L 324.00");
  await expect(page.getByText(`${pos.ticket.lineDiscount} −L 36.00`)).toBeVisible();

  // Poner en espera (F6) y recuperar
  await page.keyboard.press("F6");
  await page.getByRole("button", { name: pos.parked.parkCurrent }).click();
  await expect(page.getByText(pos.parked.parkedNow)).toBeVisible();
  await expect(page.getByText(pos.ticket.empty)).toBeVisible();
  await expect(total).toContainText("L 0.00");
  await page.keyboard.press("F6");
  await page.getByRole("button", { name: pos.parked.resume }).click();
  await expect(total).toContainText("L 324.00");

  // Cliente rápido (F3): solo nombre y teléfono
  await page.keyboard.press("F3");
  await page.getByLabel(pos.customer.name, { exact: true }).fill("E2E Cliente Mostrador");
  await page.getByLabel(pos.customer.phone, { exact: true }).fill("9999-0000");
  await page.getByRole("button", { name: pos.customer.save }).click();
  await expect(page.getByRole("button", { name: "E2E Cliente Mostrador" })).toBeVisible();

  // Quitar la línea deja el ticket vacío; el ticket que quedó guardado se recupera al recargar
  await page.reload();
  await expect(total).toContainText("L 324.00");
  await page.getByRole("button", { name: `${pos.ticket.remove}: ${name}` }).click();
  await expect(page.getByText(pos.ticket.empty)).toBeVisible();

  await closeLeftoverCash(page);
});

// ───────────── Cobro ─────────────

const charge = pos.charge;

/** El propietario crea una prenda con existencias, en su propio navegador. */
async function createStockedProduct(
  browser: Browser,
  baseURL: string,
  name: string,
  price: string,
  shown: string,
  stock: string,
) {
  const context = await browser.newContext({ baseURL });
  const owner = await context.newPage();
  await loginAs(owner, "owner");
  await createSimpleProduct(owner, name, price, shown);
  await addStock(owner, name, stock);
  await context.close();
}

/** La cajera abre su caja con fondo cero y entra a la pantalla de venta. */
async function openCashAndSell(page: Page) {
  await loginAs(page, "cashier");
  await closeLeftoverCash(page);
  await page.goto("/caja");
  await fillMoney(page, messages.cash.open.float, "0");
  await page.getByRole("button", { name: messages.cash.open.submit }).click();
  await expect(page.getByRole("group", { name: messages.cash.current.expected })).toBeVisible();
  await page.goto("/vender");
  await expect(page.getByRole("heading", { name: pos.title, level: 1 })).toBeVisible();
}

/** Busca una prenda de una sola variante por su nombre y la agrega al ticket. */
async function addToTicket(page: Page, name: string, shown: string) {
  const search = page.getByRole("textbox", { name: pos.search.label });
  await expect(async () => {
    await search.fill(name);
    await page.getByRole("button", { name: `${name}, ${shown}` }).click({ timeout: 3000 });
  }).toPass();
  await expect(page.getByText(`${pos.notices.added} ${name}`)).toBeVisible();
}

test("the cashier charges in cash, sees the change and prints the ticket", async ({
  page,
  browser,
}) => {
  test.slow();
  const name = `E2E Cobro ${Date.now()}`;
  const baseURL = test.info().project.use.baseURL as string;
  await createStockedProduct(browser, baseURL, name, "120", "L 120.00", "3");

  await openCashAndSell(page);
  await addToTicket(page, name, "L 120.00");

  // F12 abre el cobro; con L 500 en efectivo el cambio es L 380
  await page.keyboard.press("F12");
  await expect(page.getByRole("heading", { name: charge.title })).toBeVisible();
  await page.getByRole("button", { name: "L 500.00", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: charge.change })).toContainText(
    "L 380.00",
  );
  await page.getByRole("button", { name: `${charge.submit} L 120.00` }).click();

  // Éxito: el cambio a entregar en grande y el número de ticket
  await expect(page.getByRole("heading", { name: charge.done.title })).toBeVisible();
  const done = page.getByRole("status").filter({ hasText: charge.done.change });
  await expect(done).toContainText("L 380.00");
  const ticketNumber = (
    await page
      .getByText(new RegExp(`^${charge.done.ticket} T-\\d+`))
      .first()
      .innerText()
  )
    .replace(`${charge.done.ticket} `, "")
    .trim();
  const printLink = page.getByRole("link", { name: charge.done.printTicket });
  const printHref = (await printLink.getAttribute("href")) as string;
  expect(printHref).toMatch(/^\/imprimir\/ticket\/[a-z0-9]+\?auto=1$/);

  // Nueva venta: el ticket queda vacío y el ticket cobrado se puede imprimir
  await page.getByRole("button", { name: charge.done.newSale }).click();
  await expect(page.getByText(pos.ticket.empty)).toBeVisible();
  await page.goto(printHref.replace("?auto=1", ""));
  const sheet = page.getByRole("article", { name: `${messages.salesDoc.ticket} ${ticketNumber}` });
  await expect(sheet).toContainText(name);
  await expect(sheet).toContainText("L 120.00");
  await expect(sheet.getByText(messages.salesDoc.received)).toBeVisible();
  await expect(sheet.getByText("L 500.00").first()).toBeVisible();
  await expect(sheet.getByText("L 380.00").first()).toBeVisible();
  await expect(sheet).not.toContainText(messages.salesDoc.cai);

  await closeLeftoverCash(page);
});

test("the cashier splits the payment, a manager approves the discount and an invoice with CAI comes out", async ({
  page,
  browser,
}) => {
  test.slow();
  const name = `E2E Factura ${Date.now()}`;
  const prefix = `E2E-${Date.now() % 100000}-`;
  const baseURL = test.info().project.use.baseURL as string;
  await createStockedProduct(browser, baseURL, name, "200", "L 200.00", "5");

  const ownerContext = await browser.newContext({ baseURL });
  const owner = await ownerContext.newPage();
  await loginAs(owner, "owner");
  await createInvoiceRange(owner, prefix);

  await openCashAndSell(page);
  await addToTicket(page, name, "L 200.00");
  await page.getByRole("button", { name: `${pos.ticket.increase}: ${name}` }).click();

  // 20 % a la línea: pasa del límite del cajero (10 %), el cobro lo avisará
  await page.getByRole("button", { name, exact: true }).click();
  await page.keyboard.press("F4");
  const value = page.getByLabel(pos.discount.value, { exact: true });
  await expect(async () => {
    await value.fill("20");
    await expect(page.getByText(pos.discount.overLimit)).toBeVisible({ timeout: 2000 });
  }).toPass();
  await page.getByRole("button", { name: pos.discount.apply }).click();
  const total = page.getByRole("group", { name: pos.ticket.total });
  await expect(total).toContainText("L 320.00"); // 2 × 200 − 20 %

  // Pago mixto: tarjeta L 100 con referencia + efectivo con billete de L 500
  await page.keyboard.press("F12");
  await page.getByRole("button", { name: charge.methods.CARD, exact: true }).click();
  const amount = page.getByLabel(charge.amount, { exact: true });
  await expect(async () => {
    await amount.click();
    await amount.press("ControlOrMeta+a");
    await amount.pressSequentially("100");
    await amount.blur();
    await expect(amount).toHaveValue("L 100.00");
  }).toPass();
  await page.getByLabel(charge.reference, { exact: true }).fill("4242");
  await page.getByRole("button", { name: charge.addPayment }).click();
  await expect(page.getByRole("list", { name: charge.payments })).toContainText("L 100.00");
  await page.getByRole("button", { name: charge.methods.CASH, exact: true }).click();
  await page.getByRole("button", { name: "L 500.00", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: charge.change })).toContainText(
    "L 280.00",
  );

  // Con factura a nombre del cliente
  await page.getByRole("checkbox", { name: charge.invoice }).check();
  await page.getByLabel(charge.invoiceTaxId, { exact: true }).fill("0801-1999-12345");
  await page.getByLabel(charge.invoiceName, { exact: true }).fill("E2E Cliente Factura");

  // Sin autorización no cobra; con el PIN del gerente sí
  await page.getByRole("button", { name: `${charge.submit} L 320.00` }).click();
  await expect(page.getByText(messages.errors.DISCOUNT_NEEDS_APPROVAL)).toBeVisible();
  await page.getByLabel(charge.approval.username, { exact: true }).fill("manager");
  await page.getByLabel(charge.approval.pin, { exact: true }).fill("2222");
  await page.getByRole("button", { name: `${charge.submit} L 320.00` }).click();
  await expect(page.getByRole("heading", { name: charge.done.title })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: charge.done.change })).toContainText(
    "L 280.00",
  );
  const invoiceLink = page.getByRole("link", { name: charge.done.printInvoice });
  const invoiceHref = (await invoiceLink.getAttribute("href")) as string;
  expect(invoiceHref).toMatch(/^\/imprimir\/factura\/[a-z0-9]+\?auto=1$/);
  await expect(
    page.getByText(new RegExp(`${charge.done.invoice} ${prefix}00000001`)),
  ).toBeVisible();

  // La factura lleva los datos fiscales y los importes
  await page.goto(invoiceHref.replace("?auto=1", ""));
  const invoice = page.getByRole("article", {
    name: `${messages.salesDoc.invoice} ${prefix}00000001`,
  });
  await expect(invoice).toContainText("E2E Cliente Factura");
  await expect(invoice).toContainText("0801-1999-12345");
  await expect(invoice).toContainText("E2E001-E2E002-E2E003-E2E004-E2E005-E6");
  await expect(invoice).toContainText(`${prefix}00000001 al ${prefix}00000100`);
  await expect(invoice).toContainText(messages.salesDoc.taxable);
  await expect(invoice).toContainText("L 320.00");

  await closeLeftoverCash(page);
  await deactivateInvoiceRange(owner, prefix);
  await ownerContext.close();
});

// ───────────── Historial, anulación y cambio de cajero ─────────────

const history = messages.salesHistory;

test("the cashier finds the sale in the history and a manager's PIN voids it", async ({
  page,
  browser,
}) => {
  test.slow();
  const name = `E2E Anular ${Date.now()}`;
  const baseURL = test.info().project.use.baseURL as string;
  await createStockedProduct(browser, baseURL, name, "150", "L 150.00", "3");

  await openCashAndSell(page);
  await addToTicket(page, name, "L 150.00");
  await page.keyboard.press("F12");
  await page.getByRole("button", { name: `${charge.submit} L 150.00` }).click();
  await expect(page.getByRole("heading", { name: charge.done.title })).toBeVisible();
  const number = (
    await page
      .getByText(new RegExp(`^${charge.done.ticket} T-\\d+`))
      .first()
      .innerText()
  )
    .replace(`${charge.done.ticket} `, "")
    .trim();
  await page.getByRole("button", { name: charge.done.newSale }).click();

  // El historial muestra la venta de hoy; el detalle trae las prendas y los pagos
  await page.goto("/ventas");
  const row = page.getByRole("row", { name: new RegExp(number) });
  await expect(row).toContainText(history.status.COMPLETED);
  await expect(row).toContainText("L 150.00");
  await row.getByRole("link", { name: number }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `${history.detail.title} ${number}` }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: new RegExp(name) })).toBeVisible();

  // Un cajero no puede anular solo: pide el usuario y el PIN de un gerente
  await page.getByRole("button", { name: history.void.action }).click();
  await page.getByLabel(history.void.reason, { exact: true }).fill("E2E se equivocó de talla");
  await page.getByRole("button", { name: history.void.submit }).click();
  await expect(page.getByText(history.void.needsManager)).toBeVisible();
  await page.getByLabel(history.void.managerUsername, { exact: true }).fill("manager");
  await page.getByLabel(history.void.managerPin, { exact: true }).fill("2222");
  await page.getByRole("button", { name: history.void.submit }).click();

  await expect(page.getByText(history.detail.voidedTitle)).toBeVisible();
  await expect(page.getByText("E2E se equivocó de talla")).toBeVisible();
  await expect(page.getByRole("button", { name: history.void.action })).toHaveCount(0);

  // En la lista queda como anulada y fuera de lo vendido
  await page.goto("/ventas");
  await expect(page.getByRole("row", { name: new RegExp(number) })).toContainText(
    history.status.VOIDED,
  );

  await closeLeftoverCash(page);
});

test("the cashier hands the counter to a manager with a PIN and back", async ({ page }) => {
  test.slow();
  await openCashAndSell(page);
  const who = page.getByRole("link", { name: messages.nav.account });
  await expect(who).toContainText("Cajero Demo");

  const switchTo = async (username: string, pin: string) => {
    await page.getByRole("button", { name: pos.switch.button }).click();
    await page.getByLabel(pos.switch.username, { exact: true }).fill(username);
    await page.getByLabel(pos.switch.pin, { exact: true }).fill(pin);
    await page.getByRole("button", { name: pos.switch.submit, exact: true }).click();
  };

  // Un PIN equivocado no cambia nada
  await switchTo("manager", "0000");
  await expect(page.getByText(pos.switch.invalid)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(who).toContainText("Cajero Demo");

  // Con el PIN correcto entra el gerente; la pantalla de venta sigue ahí
  await switchTo("manager", "2222");
  await expect(who).toContainText("Gerente Demo");
  await expect(page.getByRole("heading", { name: pos.title, level: 1 })).toBeVisible();

  // Y de vuelta a la cajera, que es quien cierra su turno
  await switchTo("cashier", "3333");
  await expect(who).toContainText("Cajero Demo");
  await closeLeftoverCash(page);
});

// ───────────── Aceptación de la Fase 3 ─────────────

test("acceptance: scan three garments, 10 % off, split payment, ticket, and the cash closes at zero", async ({
  page,
  browser,
}) => {
  test.slow();
  const stamp = Date.now();
  const items = [
    { name: `E2E Dia A ${stamp}`, price: "100", shown: "L 100.00" },
    { name: `E2E Dia B ${stamp}`, price: "200", shown: "L 200.00" },
    { name: `E2E Dia C ${stamp}`, price: "300", shown: "L 300.00" },
  ];
  const baseURL = test.info().project.use.baseURL as string;

  // El propietario deja tres prendas con existencias; su código es el que luego se "escanea"
  const ownerContext = await browser.newContext({ baseURL });
  const owner = await ownerContext.newPage();
  await loginAs(owner, "owner");
  const codes: string[] = [];
  for (const item of items) {
    codes.push(await createSimpleProduct(owner, item.name, item.price, item.shown));
    await addStock(owner, item.name, "2");
  }
  await ownerContext.close();

  // La cajera inicia sesión y abre la caja con L 500 de fondo
  await loginAs(page, "cashier");
  await closeLeftoverCash(page);
  await page.goto("/caja");
  await fillMoney(page, messages.cash.open.float, "500");
  await page.getByRole("button", { name: messages.cash.open.submit }).click();
  await expect(page.getByRole("group", { name: messages.cash.current.expected })).toContainText(
    "L 500.00",
  );

  // Escanea las tres: el lector escribe el código y pulsa Enter
  await page.goto("/vender");
  const search = page.getByRole("textbox", { name: pos.search.label });
  await expect(search).toBeFocused();
  await expect(page.getByText(pos.ticket.empty)).toBeVisible();
  for (const [index, code] of codes.entries()) {
    await search.fill(code);
    await search.press("Enter");
    await expect(page.getByText(`${pos.notices.added} ${items[index]?.name}`)).toBeVisible();
  }
  const total = page.getByRole("group", { name: pos.ticket.total });
  await expect(total).toContainText("L 600.00");

  // 10 % a toda la venta (dentro del límite del cajero): L 540
  await page.keyboard.press("F4");
  await page.getByRole("radio", { name: pos.discount.scopeAll }).check();
  const value = page.getByLabel(pos.discount.value, { exact: true });
  await expect(async () => {
    await value.fill("10");
    await expect(value).toHaveValue("10");
  }).toPass();
  await page.getByRole("button", { name: pos.discount.apply }).click();
  await expect(total).toContainText("L 540.00");

  // Pago mixto: tarjeta L 140 y el resto en efectivo, exacto (sin cambio)
  await page.keyboard.press("F12");
  await page.getByRole("button", { name: charge.methods.CARD, exact: true }).click();
  const amount = page.getByLabel(charge.amount, { exact: true });
  await expect(async () => {
    await amount.click();
    await amount.press("ControlOrMeta+a");
    await amount.pressSequentially("140");
    await amount.blur();
    await expect(amount).toHaveValue("L 140.00");
  }).toPass();
  await page.getByLabel(charge.reference, { exact: true }).fill("9999");
  await page.getByRole("button", { name: charge.addPayment }).click();
  await page.getByRole("button", { name: charge.methods.CASH, exact: true }).click();
  await expect(amount).toHaveValue("L 400.00");
  await page.getByRole("button", { name: `${charge.submit} L 540.00` }).click();

  // Venta registrada, sin cambio; el ticket lleva las tres prendas
  await expect(page.getByRole("heading", { name: charge.done.title })).toBeVisible();
  await expect(page.getByText(charge.done.noChange)).toBeVisible();
  const printHref = (await page
    .getByRole("link", { name: charge.done.printTicket })
    .getAttribute("href")) as string;
  await page.goto(printHref.replace("?auto=1", ""));
  const sheet = page.getByRole("article", { name: new RegExp(`^${messages.salesDoc.ticket} T-`) });
  for (const item of items) {
    await expect(sheet).toContainText(item.name);
  }
  await expect(sheet).toContainText("L 540.00");

  // Cierre: debe haber L 500 de fondo + L 400 en efectivo = L 900 (la tarjeta no entra al cajón)
  await page.goto("/caja");
  await expect(page.getByRole("group", { name: messages.cash.current.expected })).toContainText(
    "L 900.00",
  );
  await fillMoney(page, messages.cash.close.counted, "900");
  await page.getByRole("button", { name: messages.cash.close.check }).click();
  await expect(page.getByText(messages.cash.close.matches)).toBeVisible();
  const closeButton = page.getByRole("button", { name: messages.cash.close.submit, exact: true });
  await expect(closeButton).toBeEnabled();
  await closeButton.click();

  // El resumen del turno: una venta, el efectivo y la tarjeta por separado, diferencia cero
  await expect(page).toHaveURL(/\/caja\/cierres\/[a-z0-9]+$/);
  const detailUrl = page.url();
  const summary = page.getByRole("region", { name: messages.cash.detail.summary });
  await expect(summary).toContainText("L 900.00");
  await expect(summary).toContainText(`${messages.cash.detail.salesCount}: 1`);
  await expect(
    page.getByRole("region", { name: messages.cash.detail.paymentsTitle }),
  ).toContainText(`${messages.cash.methods.CARD} (1)`);
  await expect(
    page.getByText(messages.cash.status.CLOSED_PENDING_APPROVAL, { exact: true }),
  ).toBeVisible();

  // El gerente lo aprueba y el turno queda cerrado
  const managerContext = await browser.newContext({ baseURL });
  const manager = await managerContext.newPage();
  await loginAs(manager, "manager");
  await manager.goto(detailUrl);
  await manager.getByRole("button", { name: messages.cash.approve.action }).click();
  await expect(manager.getByText(messages.cash.approve.approved)).toBeVisible();
  await expect(manager.getByText(messages.cash.status.CLOSED, { exact: true })).toBeVisible();
  await managerContext.close();
});

// ───────────── Alertas del CAI ─────────────

test("a billing range about to expire is flagged on the manager's home page", async ({
  browser,
}) => {
  test.slow();
  const baseURL = test.info().project.use.baseURL as string;
  const prefix = `E2E-${Date.now() % 100000}-`;
  // La fecha límite: dentro de 12 días, en la fecha local de Honduras (YYYY-MM-DD)
  const in12Days = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" }).format(
    new Date(Date.now() + 12 * 86_400_000),
  );

  const ownerContext = await browser.newContext({ baseURL });
  const owner = await ownerContext.newPage();
  await loginAs(owner, "owner");
  await createInvoiceRange(owner, prefix, in12Days);

  const managerContext = await browser.newContext({ baseURL });
  const manager = await managerContext.newPage();
  await loginAs(manager, "manager");
  const card = manager.getByRole("region", { name: messages.fiscalAlerts.homeTitle });
  await expect(card).toContainText(
    `${messages.fiscalAlerts.expiresIn} 12 ${messages.fiscalAlerts.days}`,
  );
  await expect(card).toContainText(prefix);
  await managerContext.close();

  // Un cajero no ve la tarjeta de facturación del inicio
  const cashierContext = await browser.newContext({ baseURL });
  const cashier = await cashierContext.newPage();
  await loginAs(cashier, "cashier");
  await expect(cashier.getByRole("region", { name: messages.fiscalAlerts.homeTitle })).toHaveCount(
    0,
  );
  await cashierContext.close();

  await deactivateInvoiceRange(owner, prefix);
  await ownerContext.close();
});

// ───────────── Devoluciones ─────────────

const ret = messages.returns;

test("the cashier returns to store credit, a manager's PIN approves a cash refund, and the sale can no longer be voided", async ({
  page,
  browser,
}) => {
  test.slow();
  const name = `E2E Devol ${Date.now()}`;
  const baseURL = test.info().project.use.baseURL as string;
  await createStockedProduct(browser, baseURL, name, "150", "L 150.00", "4");

  // Vende dos prendas en efectivo
  await openCashAndSell(page);
  await addToTicket(page, name, "L 150.00");
  await page.getByRole("button", { name: `${pos.ticket.increase}: ${name}` }).click();
  await page.keyboard.press("F12");
  await page.getByRole("button", { name: `${charge.submit} L 300.00` }).click();
  await expect(page.getByRole("heading", { name: charge.done.title })).toBeVisible();
  const number = (
    await page
      .getByText(new RegExp(`^${charge.done.ticket} T-\\d+`))
      .first()
      .innerText()
  )
    .replace(`${charge.done.ticket} `, "")
    .trim();
  await page.getByRole("button", { name: charge.done.newSale }).click();

  // F8 lleva a devoluciones; se busca la venta por su ticket
  await page.keyboard.press("F8");
  await expect(page).toHaveURL(/\/devoluciones$/);
  const searchBox = page.getByLabel(ret.search.label, { exact: true });
  await expect(async () => {
    await searchBox.fill(number);
    await expect(searchBox).toHaveValue(number);
  }).toPass();
  await searchBox.press("Enter");
  await page.getByRole("link", { name: `${ret.search.choose} ${number}` }).click();
  await expect(page).toHaveURL(/\/devoluciones\?venta=/);
  const saleUrl = page.url();

  // Una prenda a crédito de tienda, con un cliente que se crea en el momento
  await page.getByRole("button", { name: `+ ${name}` }).click();
  await page.getByLabel(ret.reason.label, { exact: true }).fill("E2E talla incorrecta");
  const total = page.getByRole("group", { name: ret.total.label });
  await expect(total).toContainText("L 150.00");
  await page.getByRole("button", { name: ret.refund.chooseCustomer }).click();
  await page.getByLabel(pos.customer.name, { exact: true }).fill("E2E Cliente Devol");
  await page.getByLabel(pos.customer.phone, { exact: true }).fill("9999-1212");
  await page.getByRole("button", { name: pos.customer.save }).click();
  await expect(page.getByText("E2E Cliente Devol")).toBeVisible();
  await page.getByRole("button", { name: ret.submit }).click();

  await expect(page.getByRole("heading", { name: ret.done.title })).toBeVisible();
  await expect(page.getByText("L 150.00").first()).toBeVisible();
  const printHref = (await page
    .getByRole("link", { name: ret.done.print })
    .getAttribute("href")) as string;
  expect(printHref).toMatch(/^\/imprimir\/devolucion\/[a-z0-9]+\?auto=1$/);
  await page.goto(printHref.replace("?auto=1", ""));
  const receipt = page.getByRole("article", { name: new RegExp(`^${ret.doc.title} DV-`) });
  await expect(receipt).toContainText(name);
  await expect(receipt).toContainText("L 150.00");
  await expect(receipt).toContainText("E2E Cliente Devol");
  await expect(receipt).toContainText(ret.methods.STORE_CREDIT);

  // La otra prenda en efectivo: sin PIN no se puede; con el del gerente sí
  await page.goto(saleUrl);
  await expect(page.getByText(ret.lines.returned)).toBeVisible();
  await page.getByRole("button", { name: `+ ${name}` }).click();
  await page.getByLabel(ret.reason.label, { exact: true }).fill("E2E defecto");
  await page.getByRole("radio", { name: new RegExp(`^${ret.methods.CASH}`) }).check();
  await expect(page.getByText(ret.approval.title, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: ret.submit }).click();
  await expect(page.getByText(messages.errors.APPROVAL_REQUIRED)).toBeVisible();
  await page.getByLabel(ret.approval.username, { exact: true }).fill("manager");
  await page.getByLabel(ret.approval.pin, { exact: true }).fill("2222");
  await page.getByRole("button", { name: ret.submit }).click();
  await expect(page.getByRole("heading", { name: ret.done.title })).toBeVisible();
  await expect(page.getByText(ret.methods.CASH)).toBeVisible();

  // El efectivo esperado bajó con el reembolso: 0 de fondo + 300 de la venta − 150
  await page.goto("/caja");
  await expect(page.getByRole("group", { name: messages.cash.current.expected })).toContainText(
    "L 150.00",
  );
  await expect(page.getByText(messages.cash.current.cashRefunds, { exact: true })).toBeVisible();

  // La venta lista sus dos devoluciones y ya no ofrece anularse
  await page.goto("/ventas");
  await page
    .getByRole("row", { name: new RegExp(number) })
    .getByRole("link", { name: number })
    .click();
  await expect(page.getByRole("heading", { name: ret.detail.title })).toBeVisible();
  await expect(page.getByText(messages.salesHistory.detail.hasReturns)).toBeVisible();
  await expect(page.getByRole("button", { name: messages.salesHistory.void.action })).toHaveCount(
    0,
  );

  await closeLeftoverCash(page);
});
