import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

// Reglas de la base de datos del retiro al cerrar y del fondo heredado (migración `cash_float_carry_over`).

async function failure(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
  } catch (error) {
    return error instanceof Error ? `${error.message} ${JSON.stringify(error.cause ?? "")}` : "";
  }
  throw new Error("La operación debía fallar y terminó bien");
}

async function openSession() {
  const user = await testDb.user.create({
    data: { name: "Cajera", username: "cajera-float", passwordHash: "x", role: "CASHIER" },
  });
  const location = await testDb.location.create({ data: { code: "MAIN", name: "Tienda" } });
  const terminal = await testDb.terminal.create({
    data: { name: "Caja 1", locationId: location.id },
  });
  return testDb.cashSession.create({
    data: { terminalId: terminal.id, userId: user.id, openingFloatCents: 10000 },
  });
}

describe("cash session withdrawal and inherited float", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("starts without a withdrawal or an inherited float", async () => {
    const session = await openSession();
    expect(session.withdrawnCents).toBeNull();
    expect(session.inheritedFloatCents).toBeNull();
    expect(session.openingNotes).toBeNull();
  });

  it("accepts a withdrawal between zero and the counted cash", async () => {
    const session = await openSession();
    for (const withdrawnCents of [0, 700_000, 800_000]) {
      const updated = await testDb.cashSession.update({
        where: { id: session.id },
        data: { countedCashCents: 800_000, withdrawnCents },
      });
      expect(updated.withdrawnCents).toBe(withdrawnCents);
    }
  });

  it("refuses to withdraw more than was counted", async () => {
    const session = await openSession();
    const text = await failure(
      testDb.cashSession.update({
        where: { id: session.id },
        data: { countedCashCents: 800_000, withdrawnCents: 800_001 },
      }),
    );
    expect(text).toContain("CashSession_withdrawn_valid");
  });

  it("refuses a withdrawal on a shift that was never counted", async () => {
    const session = await openSession();
    const text = await failure(
      testDb.cashSession.update({ where: { id: session.id }, data: { withdrawnCents: 100 } }),
    );
    expect(text).toContain("CashSession_withdrawn_valid");
  });

  it("refuses negative amounts", async () => {
    const session = await openSession();
    expect(
      await failure(
        testDb.cashSession.update({
          where: { id: session.id },
          data: { countedCashCents: 800_000, withdrawnCents: -1 },
        }),
      ),
    ).toContain("CashSession_withdrawn_valid");
    expect(
      await failure(
        testDb.cashSession.update({
          where: { id: session.id },
          data: { inheritedFloatCents: -1 },
        }),
      ),
    ).toContain("CashSession_inherited_nonneg");
  });
});
