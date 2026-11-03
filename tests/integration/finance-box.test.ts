import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { localDateKey } from "@/lib/dates";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { openCashSession, submitCashClose } from "@/modules/cash/service";
import { BOX_DEPOSIT_LIMIT, getFinanceBox, getFinanceSummary } from "@/modules/finance/queries";
import { createFinanceEntry, voidFinanceEntry } from "@/modules/finance/service";
import { rangeForPreset } from "@/modules/reports/ranges";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

/**
 * La caja de finanzas no tiene tabla: su saldo sale de lo retirado en los cierres de caja y de los movimientos vigentes
 * pagados en «efectivo fuera de caja». Estas pruebas verifican esa cuenta contra la base real.
 */

type Actor = { id: string; role: Role };

async function world() {
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: username, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  const manager = await make("manager", "MANAGER");
  const cashier = await make("cashier", "CASHIER");
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  await testDb.terminal.create({ data: { name: "Caja 1", locationId: location.id } });
  const expense = await testDb.financeCategory.create({ data: { type: "EXPENSE", name: "Luz" } });
  const income = await testDb.financeCategory.create({ data: { type: "INCOME", name: "Aporte" } });
  return { manager, cashier, expenseId: expense.id, incomeId: income.id };
}

type World = Awaited<ReturnType<typeof world>>;

let seq = 0;
const entry = (
  categoryId: string,
  type: "EXPENSE" | "INCOME",
  amountCents: number,
  paidWith: string,
) => ({
  type,
  categoryId,
  amountCents,
  occurredOn: localDateKey(new Date()),
  paidWith,
  description: `Movimiento de prueba ${(seq += 1)}`,
  clientRequestId: `box-${seq}-${Math.random().toString(36).slice(2, 10)}`,
});

/** Abre y cierra un turno contando `counted` y retirando `withdrawn`. */
async function closeShift(w: World, counted: number, withdrawn: number) {
  await openCashSession(
    w.cashier,
    { openingFloatCents: counted, openingNotes: "Fondo para la prueba" },
    testDb,
  );
  const { id } = await submitCashClose(
    w.cashier,
    { countedCashCents: counted, withdrawnCents: withdrawn, notes: "Cierre de prueba" },
    testDb,
  );
  return id;
}

describe("getFinanceBox", () => {
  beforeEach(resetDatabase);
  afterAll(async () => {
    await db.$disconnect();
    await closeDatabase();
  });

  it("starts at zero with nothing to review", async () => {
    await world();
    expect(await getFinanceBox()).toMatchObject({
      balanceCents: 0,
      depositsCents: 0,
      depositCount: 0,
      deposits: [],
      needsReview: false,
    });
  });

  it("receives what each closing withdraws, newest first, and ignores closings that withdrew nothing", async () => {
    const w = await world();
    const first = await closeShift(w, 850_000, 700_000);
    const second = await closeShift(w, 300_000, 0);
    const third = await closeShift(w, 200_000, 150_000);

    const box = await getFinanceBox();
    expect(box).toMatchObject({
      depositsCents: 850_000,
      balanceCents: 850_000,
      depositCount: 2,
    });
    expect(box.deposits.map((row) => [row.cashSessionId, row.amountCents])).toEqual([
      [third, 150_000],
      [first, 700_000],
    ]);
    expect(box.deposits.map((row) => row.cashSessionId)).not.toContain(second);
    expect(box.deposits[0]).toMatchObject({ terminalName: "Caja 1", closedByName: "cashier" });
  });

  it("adds the cash income and subtracts the cash expenses paid outside the drawer", async () => {
    const w = await world();
    await closeShift(w, 850_000, 700_000);
    await createFinanceEntry(w.manager, entry(w.incomeId, "INCOME", 50_000, "CASH_OTHER"));
    await createFinanceEntry(w.manager, entry(w.expenseId, "EXPENSE", 125_050, "CASH_OTHER"));

    expect(await getFinanceBox()).toMatchObject({
      depositsCents: 700_000,
      cashIncomeCents: 50_000,
      cashExpenseCents: 125_050,
      balanceCents: 624_950,
      needsReview: false,
    });
  });

  it("does not count entries paid another way, nor voided ones", async () => {
    const w = await world();
    await closeShift(w, 100_000, 100_000);
    await createFinanceEntry(w.manager, entry(w.expenseId, "EXPENSE", 11_111, "TRANSFER"));
    await createFinanceEntry(w.manager, entry(w.expenseId, "EXPENSE", 22_222, "CARD"));
    const mistake = await createFinanceEntry(
      w.manager,
      entry(w.expenseId, "EXPENSE", 33_333, "CASH_OTHER"),
    );
    await voidFinanceEntry(w.manager, { entryId: mistake.id, reason: "Monto equivocado" });

    expect(await getFinanceBox()).toMatchObject({
      cashExpenseCents: 0,
      balanceCents: 100_000,
    });
  });

  it("flags a negative balance for review instead of hiding it", async () => {
    const w = await world();
    await createFinanceEntry(w.manager, entry(w.expenseId, "EXPENSE", 40_000, "CASH_OTHER"));
    expect(await getFinanceBox()).toMatchObject({ balanceCents: -40_000, needsReview: true });
  });

  it("keeps the full balance when only the most recent deposits are listed", async () => {
    const w = await world();
    const terminal = await testDb.terminal.findFirstOrThrow();
    for (let index = 0; index < BOX_DEPOSIT_LIMIT + 3; index += 1) {
      await testDb.cashSession.create({
        data: {
          terminalId: terminal.id,
          userId: w.cashier.id,
          status: "CLOSED",
          openingFloatCents: 0,
          closedAt: new Date(Date.now() - index * 60_000),
          expectedCashCents: 1_000,
          countedCashCents: 1_000,
          differenceCents: 0,
          withdrawnCents: 1_000,
        },
      });
    }
    const box = await getFinanceBox();
    expect(box.deposits).toHaveLength(BOX_DEPOSIT_LIMIT);
    expect(box.depositCount).toBe(BOX_DEPOSIT_LIMIT + 3);
    expect(box.balanceCents).toBe((BOX_DEPOSIT_LIMIT + 3) * 1_000);
  });

  it("does not turn a withdrawal into income or expense: the net profit does not move", async () => {
    const w = await world();
    const range = rangeForPreset("today");
    const before = await getFinanceSummary(range);
    await closeShift(w, 850_000, 700_000);
    const after = await getFinanceSummary(range);
    expect(after.netProfitCents).toBe(before.netProfitCents);
    expect(after.expensesCents).toBe(before.expensesCents);
    expect(after.otherIncomeCents).toBe(before.otherIncomeCents);
  });
});
