import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { approveCashClose, openCashSession, submitCashClose } from "@/modules/cash/service";
import { recordMovement } from "@/modules/inventory/service";
import {
  EXPORT_KINDS,
  buildExport,
  toCsv,
  toXlsx,
  type ExportKind,
  type ExportParams,
  type ExportTable,
} from "@/modules/reports/export";
import { processReturn } from "@/modules/returns/service";
import { completeSale } from "@/modules/sales/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

type Actor = { id: string; role: Role };
let owner: Actor;
let manager: Actor;
let cashier: Actor;
let warehouse: Actor;
let sessionId = "";

beforeAll(async () => {
  await resetDatabase();
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: `Nombre ${username}`, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  owner = await make("owner", "OWNER");
  manager = await make("manager", "MANAGER");
  cashier = await make("cashier", "CASHIER");
  warehouse = await make("warehouse", "WAREHOUSE");
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  await testDb.terminal.create({ data: { name: "Caja 1", locationId: location.id } });
  const women = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const brand = await testDb.brand.create({ data: { name: "Marca Aurora" } });
  const size = await testDb.size.create({ data: { name: "M", group: "ropa", sortOrder: 1 } });
  const color = await testDb.color.create({ data: { name: "Rojo", hex: "#B42318", sortOrder: 1 } });
  const variants: Record<string, string> = {};
  for (const [key, price, cost] of [
    ["D", 11500, 4000],
    ["S", 20000, 8000],
  ] as const) {
    const product = await testDb.product.create({
      data: {
        code: key,
        name: `Producto ${key}`,
        categoryId: women.id,
        brandId: key === "D" ? brand.id : null,
        basePriceCents: price,
      },
    });
    const variant = await testDb.variant.create({
      data: {
        productId: product.id,
        sku: key,
        barcode: `BC-${key}`,
        avgCostCents: cost,
        sizeId: size.id,
        colorId: color.id,
      },
    });
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: variant.id,
        locationId: location.id,
        userId: owner.id,
        type: "INITIAL",
        quantity: 30,
      }),
    );
    variants[key] = variant.id;
  }
  const session = await openCashSession(cashier, { openingFloatCents: 10000 }, testDb);
  sessionId = session.id;
  let seq = 0;
  const sell = (actor: Actor, key: string, quantity: number, total: number) =>
    completeSale(
      actor,
      {
        clientRequestId: `request-exp-${(seq += 1)}`,
        lines: [{ variantId: variants[key] as string, quantity }],
        payments: [{ method: "CASH", amountCents: total }],
      },
      testDb,
    );
  const first = await sell(cashier, "D", 2, 23000);
  await sell(cashier, "S", 1, 20000);
  await sell(manager, "D", 1, 11500);
  const line = await testDb.saleItem.findFirstOrThrow({ where: { saleId: first.id } });
  await processReturn(
    cashier,
    {
      clientRequestId: "request-exp-return",
      saleId: first.id,
      items: [{ saleItemId: line.id, quantity: 1, condition: "RESELLABLE" }],
      reason: "Talla incorrecta",
      refundMethod: "STORE_CREDIT",
      customerId: (await testDb.customer.create({ data: { name: "Ana" } })).id,
    },
    testDb,
  );
  await submitCashClose(
    cashier,
    { countedCashCents: 64500 - 100, notes: "Faltó un billete" },
    testDb,
  );
  await approveCashClose(manager, sessionId, testDb);
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
  await closeDatabase();
});

const COST_WORDS = ["Costo", "Utilidad", "Margen", "Ingreso sin ISV", "A costo", "Capital parado"];

async function xlsx(table: ExportTable): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await toXlsx(table)) as unknown as ArrayBuffer);
  return workbook;
}

const everything: [ExportKind, ExportParams][] = [
  ["ventas", { por: "periodo", rango: "today" }],
  ["ventas", { por: "hora", rango: "today" }],
  ["ventas", { por: "cajero", rango: "today" }],
  ["ventas", { por: "categoria", rango: "today" }],
  ["ventas", { por: "marca", rango: "today" }],
  ["ventas", { por: "metodo", rango: "today" }],
  ["productos", { rango: "today" }],
  ["tallas", { rango: "today" }],
];

describe("who can export what", () => {
  it("lets a manager export every report and an owner too", async () => {
    for (const user of [manager, owner]) {
      for (const kind of EXPORT_KINDS) {
        expect(
          await buildExport(kind, { rango: "year" }, user),
          `${user.role} ${kind}`,
        ).not.toBeNull();
      }
    }
  });

  it("gives a cashier only the sales reports, and the warehouse nothing", async () => {
    for (const kind of ["ventas", "productos", "tallas"] as const) {
      expect(await buildExport(kind, { rango: "year" }, cashier), kind).not.toBeNull();
    }
    expect(await buildExport("cierres", { rango: "year" }, cashier)).toBeNull();
    expect(await buildExport("inventario", {}, cashier)).toBeNull();
    for (const kind of EXPORT_KINDS) {
      expect(await buildExport(kind, { rango: "year" }, warehouse), kind).toBeNull();
    }
  });
});

describe("what a cashier receives", () => {
  it("never contains a cost, profit or margin column, in any format", async () => {
    for (const [kind, params] of everything) {
      const table = (await buildExport(kind, params, cashier)) as ExportTable;
      const text = JSON.stringify(table) + toCsv(table);
      for (const word of COST_WORDS) {
        expect(text, `${kind} ${params.por ?? ""} ${word}`).not.toContain(word);
      }
      const book = await xlsx(table);
      for (const sheet of book.worksheets) {
        sheet.eachRow((row) =>
          row.eachCell((cell) => {
            for (const word of COST_WORDS) {
              expect(String(cell.value)).not.toContain(word);
            }
          }),
        );
      }
    }
  });

  it("only has the cashier's own sales", async () => {
    const table = (await buildExport(
      "ventas",
      { por: "cajero", rango: "today" },
      cashier,
    )) as ExportTable;
    const sheet = table.sheets.find((s) => s.primary);
    expect(sheet?.rows).toEqual([
      { cashier: "Nombre cashier", tickets: 2, sales: 430, average: 215 },
    ]);
    const summary = table.sheets[0]?.rows[0];
    expect(summary).toMatchObject({ sales: 430, returns: 115, net: 315, tickets: 2 });
  });
});

describe("what a manager receives", () => {
  it("has the profit columns, with the figures of the reports", async () => {
    const table = (await buildExport(
      "ventas",
      { por: "categoria", rango: "today" },
      manager,
    )) as ExportTable;
    expect(table.sheets.map((s) => s.name)).toEqual(["Resumen", "Por categoría"]);
    const headers = table.sheets[1]?.columns.map((column) => column.header);
    expect(headers).toEqual([
      "Categoría",
      "Prendas",
      "Ventas",
      "Devoluciones",
      "Netas",
      "Ingreso sin ISV",
      "Costo",
      "Utilidad",
      "Margen",
    ]);
    // Mujer: vendió 3×115 + 200 = 545,00; devolvió 115,00; netas 430,00
    expect(table.sheets[1]?.rows[0]).toMatchObject({
      name: "Mujer",
      sold: 545,
      returned: 115,
      net: 430,
    });
    expect(table.sheets[0]?.rows[0]).toMatchObject({
      sales: 545,
      returns: 115,
      net: 430,
      tickets: 3,
    });
  });
});

describe("the CSV", () => {
  it("starts with a BOM, uses commas and Windows line breaks, and writes plain numbers", async () => {
    const table = (await buildExport(
      "ventas",
      { por: "categoria", rango: "today" },
      manager,
    )) as ExportTable;
    const csv = toCsv(table);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(
      "Categoría,Prendas,Ventas,Devoluciones,Netas,Ingreso sin ISV,Costo,Utilidad,Margen",
    );
    // 545.00 con punto decimal, sin símbolo ni separador de miles
    expect(lines[1]?.startsWith("Mujer,3,545.00,115.00,430.00,")).toBe(true);
    expect(lines[1]).toMatch(/,\d+\.\d{2}%$/);
    expect(lines[lines.length - 1]).toBe("");
  });

  it("quotes what has commas and quotes", () => {
    const table: ExportTable = {
      fileBase: "x",
      sheets: [
        {
          name: "Hoja",
          primary: true,
          columns: [{ header: "Nombre", key: "n", kind: "text" }],
          rows: [{ n: 'Blusa "de lino", M' }],
        },
      ],
    };
    expect(toCsv(table)).toBe('﻿Nombre\r\n"Blusa ""de lino"", M"\r\n');
  });
});

describe("the Excel file", () => {
  it("has one sheet per table with a bold header, a frozen first row and a filter", async () => {
    const table = (await buildExport(
      "ventas",
      { por: "categoria", rango: "today" },
      manager,
    )) as ExportTable;
    const book = await xlsx(table);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["Resumen", "Por categoría"]);
    const sheet = book.getWorksheet("Por categoría") as ExcelJS.Worksheet;
    expect(sheet.getRow(1).font?.bold).toBe(true);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
    expect(sheet.getRow(1).getCell(1).value).toBe("Categoría");
  });

  it("writes money as numbers with a currency format, integers with thousands and percentages as percentages", async () => {
    const table = (await buildExport(
      "ventas",
      { por: "categoria", rango: "today" },
      manager,
    )) as ExportTable;
    const sheet = (await xlsx(table)).getWorksheet("Por categoría") as ExcelJS.Worksheet;
    const row = sheet.getRow(2);
    const money = row.getCell(3);
    expect(money.value).toBe(545);
    expect(money.numFmt).toBe('"L" #,##0.00;[Red]-"L" #,##0.00');
    expect(row.getCell(2).value).toBe(3);
    expect(row.getCell(2).numFmt).toBe("#,##0");
    const margin = row.getCell(9);
    expect(typeof margin.value).toBe("number");
    expect(margin.value as number).toBeGreaterThan(0);
    expect(margin.value as number).toBeLessThan(1);
    expect(margin.numFmt).toBe("0.00%");
  });

  it("writes dates as real Excel dates in Honduras time", async () => {
    // Un cierre a las 22:30 del 9 de marzo en Honduras (04:30 UTC del 10)
    await testDb.cashSession.update({
      where: { id: sessionId },
      data: { closedAt: new Date("2026-03-10T04:30:00Z") },
    });
    const table = (await buildExport(
      "cierres",
      { desde: "2026-03-09", hasta: "2026-03-10" },
      manager,
    )) as ExportTable;
    const sheet = (await xlsx(table)).getWorksheet("Cierres de caja") as ExcelJS.Worksheet;
    const date = sheet.getRow(2).getCell(1);
    expect(date.value).toBeInstanceOf(Date);
    expect((date.value as Date).toISOString()).toBe("2026-03-09T22:30:00.000Z");
    expect(date.numFmt).toBe("dd/mm/yyyy hh:mm");
    expect(sheet.getRow(2).getCell(6).value).toBe(-1); // faltó L 1.00
    expect(toCsv(table)).toContain("2026-03-09 22:30");
  });

  it("has a valuation sheet and a dead stock sheet for the inventory", async () => {
    const table = (await buildExport("inventario", { dias: "30" }, manager)) as ExportTable;
    const book = await xlsx(table);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["Valoración", "Sin movimiento"]);
    const valuation = book.getWorksheet("Valoración") as ExcelJS.Worksheet;
    expect(valuation.getRow(2).getCell(1).value).toBe("Mujer");
    // La última fila es el total
    expect(valuation.getRow(valuation.rowCount).getCell(1).value).toBe("Total");
    expect(toCsv(table).split("\r\n")[0]).toContain("Categoría");
    const dead = (await buildExport(
      "inventario",
      { dias: "30", parte: "sinmovimiento" },
      manager,
    )) as ExportTable;
    expect(toCsv(dead).split("\r\n")[0]).toContain("Prenda");
  });
});
