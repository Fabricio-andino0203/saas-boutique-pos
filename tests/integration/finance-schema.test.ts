import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

// Reglas de la base de datos del libro de Finanzas (migración `finance`): lo que se cumple aunque el código falle.

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.message);
    }
    if (typeof current === "object") {
      const record = current as { code?: unknown; meta?: unknown; cause?: unknown };
      if (record.code !== undefined) parts.push(String(record.code));
      if (record.meta !== undefined) parts.push(JSON.stringify(record.meta));
      current = record.cause;
    } else {
      current = undefined;
    }
  }
  return parts.join(" | ");
}

/** El texto del error de una operación que debe fallar (y falla la prueba si no falla). */
async function failure(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
  } catch (error) {
    return errorText(error);
  }
  throw new Error("La operación debía fallar y terminó bien");
}

let counter = 0;

async function fixtures() {
  const user = await testDb.user.create({
    data: { name: "Dueña", username: "owner-fin", passwordHash: "x", role: "OWNER" },
  });
  const category = await testDb.financeCategory.create({
    data: { type: "EXPENSE", name: "Alquiler" },
  });
  const location = await testDb.location.create({ data: { code: "MAIN", name: "Tienda" } });
  const terminal = await testDb.terminal.create({
    data: { name: "Caja 1", locationId: location.id },
  });
  const session = await testDb.cashSession.create({
    data: { terminalId: terminal.id, userId: user.id, openingFloatCents: 10000 },
  });
  const movement = await testDb.cashMovement.create({
    data: {
      cashSessionId: session.id,
      type: "OUT",
      amountCents: 5000,
      reason: "Gasto de prueba",
      userId: user.id,
    },
  });
  return { user, category, movement };
}

type Base = Awaited<ReturnType<typeof fixtures>>;

function entry(base: Base, overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    type: "EXPENSE" as const,
    categoryId: base.category.id,
    amountCents: 5000,
    occurredAt: new Date("2026-11-03T12:00:00Z"),
    paidWith: "TRANSFER" as const,
    description: "Pago del mes",
    clientRequestId: `req-${counter}`,
    createdById: base.user.id,
    ...overrides,
  };
}

describe("finance ledger rules in the database", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("rejects an amount that is not positive", async () => {
    const base = await fixtures();
    expect(
      await failure(testDb.financeEntry.create({ data: entry(base, { amountCents: 0 }) })),
    ).toMatch(/amount_positive|check/i);
  });

  it("ties cash-drawer payments to a cash movement, and only them", async () => {
    const base = await fixtures();
    expect(
      await failure(testDb.financeEntry.create({ data: entry(base, { paidWith: "CASH_DRAWER" }) })),
    ).toMatch(/drawer_link|check/i);
    expect(
      await failure(
        testDb.financeEntry.create({
          data: entry(base, { paidWith: "TRANSFER", cashMovementId: base.movement.id }),
        }),
      ),
    ).toMatch(/drawer_link|check/i);

    const linked = await testDb.financeEntry.create({
      data: entry(base, { paidWith: "CASH_DRAWER", cashMovementId: base.movement.id }),
    });
    expect(linked.cashMovementId).toBe(base.movement.id);
    // Una salida de caja da, como mucho, un gasto.
    expect(
      await failure(
        testDb.financeEntry.create({
          data: entry(base, { paidWith: "CASH_DRAWER", cashMovementId: base.movement.id }),
        }),
      ),
    ).toMatch(/cashMovementId|unique/i);
  });

  it("rejects a repeated clientRequestId", async () => {
    const base = await fixtures();
    await testDb.financeEntry.create({ data: entry(base, { clientRequestId: "same" }) });
    expect(
      await failure(testDb.financeEntry.create({ data: entry(base, { clientRequestId: "same" }) })),
    ).toMatch(/clientRequestId|unique/i);
  });

  it("never deletes an entry", async () => {
    const base = await fixtures();
    const saved = await testDb.financeEntry.create({ data: entry(base) });
    expect(await failure(testDb.financeEntry.delete({ where: { id: saved.id } }))).toMatch(
      /no se borra/i,
    );
    expect(await testDb.financeEntry.count()).toBe(1);
  });

  it("lets an entry change only by being voided, once", async () => {
    const base = await fixtures();
    const saved = await testDb.financeEntry.create({ data: entry(base) });

    expect(
      await failure(
        testDb.financeEntry.update({ where: { id: saved.id }, data: { description: "Cambiada" } }),
      ),
    ).toMatch(/solo cambia al anularse/i);
    expect(
      await failure(
        testDb.financeEntry.update({ where: { id: saved.id }, data: { amountCents: 1 } }),
      ),
    ).toMatch(/solo cambia al anularse/i);

    // La anulación debe llevar fecha, usuario y motivo juntos.
    expect(
      await failure(
        testDb.financeEntry.update({ where: { id: saved.id }, data: { voidedAt: new Date() } }),
      ),
    ).toMatch(/void_complete|check/i);

    const voided = await testDb.financeEntry.update({
      where: { id: saved.id },
      data: { voidedAt: new Date(), voidedById: base.user.id, voidReason: "Se registró dos veces" },
    });
    expect(voided.voidReason).toBe("Se registró dos veces");

    expect(
      await failure(
        testDb.financeEntry.update({
          where: { id: saved.id },
          data: { voidReason: "Otro motivo" },
        }),
      ),
    ).toMatch(/anulado ya no cambia/i);
  });

  it("allows one active payment per fixed cost and month, and a new one after voiding it", async () => {
    const base = await fixtures();
    const fixedCost = await testDb.fixedCost.create({
      data: {
        name: "Alquiler del local",
        categoryId: base.category.id,
        amountCents: 800000,
        dueDay: 5,
        startsOn: new Date("2026-01-01T00:00:00Z"),
      },
    });
    const first = await testDb.financeEntry.create({
      data: entry(base, { fixedCostId: fixedCost.id, period: "2026-11" }),
    });
    expect(
      await failure(
        testDb.financeEntry.create({
          data: entry(base, { fixedCostId: fixedCost.id, period: "2026-11" }),
        }),
      ),
    ).toMatch(/period_active|unique/i);

    // Otro mes sí.
    await testDb.financeEntry.create({
      data: entry(base, { fixedCostId: fixedCost.id, period: "2026-12" }),
    });

    await testDb.financeEntry.update({
      where: { id: first.id },
      data: { voidedAt: new Date(), voidedById: base.user.id, voidReason: "Monto equivocado" },
    });
    const again = await testDb.financeEntry.create({
      data: entry(base, { fixedCostId: fixedCost.id, period: "2026-11" }),
    });
    expect(again.period).toBe("2026-11");
  });

  it("needs the fixed cost and the month together", async () => {
    const base = await fixtures();
    expect(
      await failure(testDb.financeEntry.create({ data: entry(base, { period: "2026-11" }) })),
    ).toMatch(/fixedCost_period|check/i);
  });

  it("keeps fixed costs to a real day of the month and a positive amount", async () => {
    const base = await fixtures();
    const data = {
      name: "Internet",
      categoryId: base.category.id,
      amountCents: 90000,
      dueDay: 5,
      startsOn: new Date("2026-01-01T00:00:00Z"),
    };
    expect(await failure(testDb.fixedCost.create({ data: { ...data, dueDay: 29 } }))).toMatch(
      /FixedCost_valid|check/i,
    );
    expect(await failure(testDb.fixedCost.create({ data: { ...data, amountCents: 0 } }))).toMatch(
      /FixedCost_valid|check/i,
    );
  });

  it("keeps category names unique within a type but not across types", async () => {
    await testDb.financeCategory.create({ data: { type: "EXPENSE", name: "Otros" } });
    await testDb.financeCategory.create({ data: { type: "INCOME", name: "Otros" } });
    expect(
      await failure(testDb.financeCategory.create({ data: { type: "EXPENSE", name: "Otros" } })),
    ).toMatch(/unique|type/i);
  });
});
