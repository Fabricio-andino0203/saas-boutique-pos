import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { localDateKey } from "@/lib/dates";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { openCashSession } from "@/modules/cash/service";
import { buildFinanceExport } from "@/modules/finance/export";
import { getFinanceSummary } from "@/modules/finance/queries";
import { createFinanceEntry, voidFinanceEntry } from "@/modules/finance/service";
import { recordMovement } from "@/modules/inventory/service";
import { getSalesSummary } from "@/modules/reports/queries";
import { rangeForPreset } from "@/modules/reports/ranges";
import { toCsv } from "@/modules/reports/export";
import { completeSale } from "@/modules/sales/service";

import { seedBase } from "../../prisma/seed/run-seed";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

/**
 * El resumen de Finanzas se reconcilia con los reportes: sus ventas, su costo y su utilidad bruta son las de
 * `getSalesSummary`, y los gastos y otros ingresos son la suma de los movimientos vigentes del periodo.
 */

type Actor = { id: string; role: Role };
let manager: Actor;
let cashier: Actor;
const categories: Record<string, string> = {};

beforeAll(async () => {
  await resetDatabase();
  await seedBase(testDb);
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: `Nombre ${username}`, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  const owner = await make("owner", "OWNER");
  manager = await make("manager", "MANAGER");
  cashier = await make("cashier", "CASHIER");

  const location = await testDb.location.findFirstOrThrow({ where: { code: "MAIN" } });
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer-fin" } });
  const product = await testDb.product.create({
    data: {
      code: "FIN-1",
      name: "Blusa de prueba",
      categoryId: category.id,
      basePriceCents: 11_500,
    },
  });
  const variant = await testDb.variant.create({
    data: { productId: product.id, sku: "FIN-1", barcode: "BC-FIN-1", avgCostCents: 4_000 },
  });
  await testDb.$transaction((tx) =>
    recordMovement(tx, {
      variantId: variant.id,
      locationId: location.id,
      userId: owner.id,
      type: "INITIAL",
      quantity: 20,
    }),
  );
  await openCashSession(cashier, { openingFloatCents: 0 }, testDb);
  for (const [index, quantity] of [3, 2].entries()) {
    await completeSale(
      cashier,
      {
        clientRequestId: `request-fin-${index}`,
        lines: [{ variantId: variant.id, quantity }],
        payments: [{ method: "CASH", amountCents: 11_500 * quantity }],
      },
      testDb,
    );
  }

  for (const name of ["Alquiler", "Publicidad"]) {
    categories[name] = (
      await testDb.financeCategory.findFirstOrThrow({ where: { type: "EXPENSE", name } })
    ).id;
  }
  categories.contribution = (
    await testDb.financeCategory.findFirstOrThrow({
      where: { type: "INCOME", name: "Aporte del dueño" },
    })
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
  await closeDatabase();
});

const today = () => localDateKey(new Date());
let seq = 0;
const entry = (
  categoryId: string,
  type: "EXPENSE" | "INCOME",
  amountCents: number,
  overrides = {},
) => ({
  type,
  categoryId,
  amountCents,
  occurredOn: today(),
  paidWith: "TRANSFER",
  description: `Movimiento de prueba ${(seq += 1)}`,
  clientRequestId: `fin-summary-${seq}-${Math.random().toString(36).slice(2, 10)}`,
  ...overrides,
});

describe("getFinanceSummary", () => {
  it("takes the sales from the reports and the rest from the live ledger entries", async () => {
    await createFinanceEntry(manager, entry(categories.Alquiler as string, "EXPENSE", 15_000));
    await createFinanceEntry(manager, entry(categories.Publicidad as string, "EXPENSE", 5_000));
    const mistake = await createFinanceEntry(
      manager,
      entry(categories.Publicidad as string, "EXPENSE", 99_000),
    );
    await voidFinanceEntry(manager, { entryId: mistake.id, reason: "Monto equivocado" });
    await createFinanceEntry(manager, entry(categories.contribution as string, "INCOME", 8_000));
    // Ayer no cuenta en el periodo de hoy.
    const yesterday = new Date(Date.now() - 86_400_000);
    await createFinanceEntry(
      manager,
      entry(categories.Alquiler as string, "EXPENSE", 77_000, {
        occurredOn: localDateKey(yesterday),
      }),
    );

    const range = rangeForPreset("today");
    const reports = await getSalesSummary(range, {}, true);
    const summary = await getFinanceSummary(range);

    // Las ventas y su utilidad bruta son las de los reportes (cada cifra se reconcilia).
    expect(reports.financial).not.toBeNull();
    expect(summary.revenueCents).toBe(reports.financial?.revenueCents);
    expect(summary.costOfSalesCents).toBe(reports.financial?.costCents);
    expect(summary.grossProfitCents).toBe(reports.financial?.profitCents);
    expect(summary.grossMarginBps).toBe(reports.financial?.marginBps);
    expect(summary.revenueCents).toBeGreaterThan(0);

    // Gastos: 15,000 + 5,000 (el de 99,000 está anulado y el de ayer no es de hoy).
    expect(summary.expensesCents).toBe(20_000);
    expect(summary.otherIncomeCents).toBe(8_000);
    expect(summary.netProfitCents).toBe(summary.grossProfitCents + 8_000 - 20_000);
    expect(summary.expenseLines.map((line) => [line.name, line.totalCents])).toEqual([
      ["Alquiler", 15_000],
      ["Publicidad", 5_000],
    ]);
    expect(summary.incomeLines.map((line) => [line.name, line.totalCents])).toEqual([
      ["Aporte del dueño", 8_000],
    ]);
  });

  it("changes with the period: yesterday's expense shows up when the period includes it", async () => {
    const yesterday = rangeForPreset("yesterday");
    expect((await getFinanceSummary(yesterday)).expensesCents).toBe(77_000);
  });
});

describe("buildFinanceExport", () => {
  it("is for people with Finance access only", async () => {
    expect(await buildFinanceExport("resumen", {}, cashier)).toBeNull();
    expect(await buildFinanceExport("movimientos", {}, cashier)).toBeNull();
  });

  it("exports the summary with the same figures as the screen", async () => {
    const table = await buildFinanceExport("resumen", { rango: "today" }, manager);
    expect(table?.sheets.map((sheet) => sheet.name)).toEqual([
      "Resumen",
      "Gastos por categoría",
      "Ingresos por categoría",
    ]);
    const summary = await getFinanceSummary(rangeForPreset("today"));
    const rows = table?.sheets[0]?.rows ?? [];
    const amount = (concept: string) => rows.find((row) => row.concept === concept)?.amount;
    expect(amount("Ventas netas (sin ISV)")).toBe(summary.revenueCents / 100);
    expect(amount("Utilidad bruta")).toBe(summary.grossProfitCents / 100);
    expect(amount("Gastos")).toBe(-20_000 / 100);
    expect(amount("Utilidad neta")).toBe(summary.netProfitCents / 100);
    expect(table?.sheets[1]?.rows).toEqual([
      { category: "Alquiler", amount: 150 },
      { category: "Publicidad", amount: 50 },
    ]);
  });

  it("exports the movements, with the voided ones only when asked, and as a CSV that Excel opens", async () => {
    const live = await buildFinanceExport("movimientos", { rango: "today" }, manager);
    const withVoided = await buildFinanceExport(
      "movimientos",
      { rango: "today", anulados: "1" },
      manager,
    );
    expect(live?.sheets[0]?.rows).toHaveLength(3);
    expect(withVoided?.sheets[0]?.rows).toHaveLength(4);
    const voided = withVoided?.sheets[0]?.rows.find((row) => row.status === "Anulado");
    expect(voided).toMatchObject({ voidReason: "Monto equivocado", amount: 990, type: "Gasto" });

    const onlyIncome = await buildFinanceExport(
      "movimientos",
      { rango: "today", tipo: "INCOME" },
      manager,
    );
    expect(onlyIncome?.sheets[0]?.rows).toHaveLength(1);

    const csv = toCsv(live!);
    expect(csv.startsWith("﻿Fecha,Tipo,Categoría,Descripción")).toBe(true);
    expect(csv).toContain("Aporte del dueño");
  });
});
