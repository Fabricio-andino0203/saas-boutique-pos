import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { localDateKey } from "@/lib/dates";
import { db } from "@/lib/db";
import {
  FinanceBoxInsufficientError,
  FinanceEntryVoidedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import { getFinanceBox, getFinanceSummary } from "@/modules/finance/queries";
import {
  createBoxWithdrawal,
  createFinanceEntry,
  voidBoxWithdrawal,
} from "@/modules/finance/service";
import { rangeForPreset } from "@/modules/reports/ranges";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

/**
 * El retiro de la caja de finanzas (PRD RF-FIN-12): efectivo que sale de la caja, no es un gasto, no se pasa del saldo, es
 * idempotente, inmutable y se anula con motivo.
 */

/** Todo el texto de un error: su mensaje, su código y los de sus causas (el mensaje de un trigger viaja en la causa). */
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

type Actor = { id: string; role: Role };

async function world() {
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: username, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  const owner = await make("owner", "OWNER");
  const manager = await make("manager", "MANAGER");
  const cashier = await make("cashier", "CASHIER");
  const location = await testDb.location.create({ data: { code: "MAIN", name: "Tienda" } });
  const terminal = await testDb.terminal.create({
    data: { name: "Caja 1", locationId: location.id },
  });
  const category = await testDb.financeCategory.create({ data: { type: "EXPENSE", name: "Luz" } });
  return { owner, manager, cashier, terminalId: terminal.id, categoryId: category.id };
}

type World = Awaited<ReturnType<typeof world>>;

/** Pone `cents` en la caja de finanzas: un cierre que retiró ese efectivo del cajón. */
async function fundBox(w: World, cents: number) {
  await testDb.cashSession.create({
    data: {
      terminalId: w.terminalId,
      userId: w.cashier.id,
      status: "CLOSED",
      openingFloatCents: 0,
      closedAt: new Date(),
      expectedCashCents: cents,
      countedCashCents: cents,
      differenceCents: 0,
      withdrawnCents: cents,
    },
  });
}

let seq = 0;
const withdrawal = (amountCents: number, overrides: Record<string, unknown> = {}) => ({
  amountCents,
  occurredOn: localDateKey(new Date()),
  reason: `Retiro de prueba ${(seq += 1)}`,
  clientRequestId: `box-w-${seq}-${Math.random().toString(36).slice(2, 10)}`,
  ...overrides,
});

describe("createBoxWithdrawal", () => {
  beforeEach(resetDatabase);
  afterAll(async () => {
    await db.$disconnect();
    await closeDatabase();
  });

  it("records who took what and why, audits it and lowers the balance", async () => {
    const w = await world();
    await fundBox(w, 700_000);
    const { id } = await createBoxWithdrawal(
      w.manager,
      withdrawal(200_000, { reason: "Se lo llevó la dueña" }),
    );

    const box = await getFinanceBox();
    expect(box).toMatchObject({
      depositsCents: 700_000,
      withdrawalsCents: 200_000,
      balanceCents: 500_000,
      withdrawalCount: 1,
    });
    expect(box.withdrawals[0]).toMatchObject({
      id,
      amountCents: 200_000,
      reason: "Se lo llevó la dueña",
      createdByName: "manager",
      voidedAt: null,
    });
    const entry = await testDb.auditLog.findFirstOrThrow({
      where: { entityId: id, action: "FINANCE_BOX_WITHDRAWAL_CREATED" },
    });
    expect(entry.userId).toBe(w.manager.id);
    expect(entry.after).toMatchObject({
      amountCents: 200_000,
      reason: "Se lo llevó la dueña",
      balanceBeforeCents: 700_000,
    });
  });

  it("can take out exactly the balance but not one cent more", async () => {
    const w = await world();
    await fundBox(w, 700_000);
    await expect(createBoxWithdrawal(w.manager, withdrawal(700_001))).rejects.toBeInstanceOf(
      FinanceBoxInsufficientError,
    );
    expect(await testDb.financeBoxWithdrawal.count()).toBe(0);
    await createBoxWithdrawal(w.manager, withdrawal(700_000));
    expect((await getFinanceBox()).balanceCents).toBe(0);
    await expect(createBoxWithdrawal(w.manager, withdrawal(1))).rejects.toBeInstanceOf(
      FinanceBoxInsufficientError,
    );
  });

  it("counts the cash income and expenses paid outside the drawer in the balance it checks", async () => {
    const w = await world();
    await fundBox(w, 100_000);
    await createFinanceEntry(w.manager, {
      type: "EXPENSE",
      categoryId: w.categoryId,
      amountCents: 40_000,
      occurredOn: localDateKey(new Date()),
      paidWith: "CASH_OTHER",
      description: "Pago de luz en efectivo",
      clientRequestId: "box-w-expense-1",
    });
    // Quedan L 600.00: L 600.01 no se puede.
    await expect(createBoxWithdrawal(w.manager, withdrawal(60_001))).rejects.toBeInstanceOf(
      FinanceBoxInsufficientError,
    );
    await expect(createBoxWithdrawal(w.manager, withdrawal(60_000))).resolves.toHaveProperty("id");
  });

  it("does not create a second withdrawal when the same request is sent again", async () => {
    const w = await world();
    await fundBox(w, 500_000);
    const input = withdrawal(100_000);
    const first = await createBoxWithdrawal(w.manager, input);
    const again = await createBoxWithdrawal(w.manager, input);
    expect(again).toEqual(first);
    expect(await testDb.financeBoxWithdrawal.count()).toBe(1);
    expect(
      await testDb.auditLog.count({ where: { action: "FINANCE_BOX_WITHDRAWAL_CREATED" } }),
    ).toBe(1);
    expect((await getFinanceBox()).balanceCents).toBe(400_000);
    // El identificador de otra persona no se puede usar.
    await expect(createBoxWithdrawal(w.owner, input)).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps one withdrawal when the same request arrives twice at the same time", async () => {
    const w = await world();
    await fundBox(w, 500_000);
    const input = withdrawal(300_000);
    const results = await Promise.allSettled([
      createBoxWithdrawal(w.manager, input),
      createBoxWithdrawal(w.manager, input),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await testDb.financeBoxWithdrawal.count()).toBe(1);
    expect((await getFinanceBox()).balanceCents).toBe(200_000);
  });

  it("never lets two simultaneous withdrawals add up to more than the balance", async () => {
    const w = await world();
    await fundBox(w, 500_000);
    const results = await Promise.allSettled([
      createBoxWithdrawal(w.manager, withdrawal(300_000)),
      createBoxWithdrawal(w.owner, withdrawal(300_000)),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
      FinanceBoxInsufficientError,
    );
    expect(await testDb.financeBoxWithdrawal.count()).toBe(1);
    expect((await getFinanceBox()).balanceCents).toBe(200_000);
  });

  it("needs finance.write: the cashier cannot take cash out of the box", async () => {
    const w = await world();
    await fundBox(w, 100_000);
    await expect(createBoxWithdrawal(w.cashier, withdrawal(1_000))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(createBoxWithdrawal(w.owner, withdrawal(1_000))).resolves.toHaveProperty("id");
  });

  it("refuses an amount of zero, a missing reason and a date in the future", async () => {
    const w = await world();
    await fundBox(w, 100_000);
    const tomorrow = localDateKey(new Date(Date.now() + 2 * 86_400_000));
    for (const bad of [
      withdrawal(0),
      withdrawal(-5),
      withdrawal(1_000, { reason: "ab" }),
      withdrawal(1_000, { occurredOn: tomorrow }),
      withdrawal(1_000, { occurredOn: "no-es-fecha" }),
      withdrawal(1_000, { clientRequestId: "corto" }),
    ]) {
      await expect(createBoxWithdrawal(w.manager, bad)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await testDb.financeBoxWithdrawal.count()).toBe(0);
  });

  it("is not an expense: the net profit does not move", async () => {
    const w = await world();
    await fundBox(w, 500_000);
    const range = rangeForPreset("today");
    const before = await getFinanceSummary(range);
    await createBoxWithdrawal(w.manager, withdrawal(300_000));
    const after = await getFinanceSummary(range);
    expect(after.netProfitCents).toBe(before.netProfitCents);
    expect(after.expensesCents).toBe(before.expensesCents);
    expect(after.otherIncomeCents).toBe(before.otherIncomeCents);
  });
});

describe("voidBoxWithdrawal", () => {
  beforeEach(resetDatabase);
  afterAll(async () => {
    await db.$disconnect();
    await closeDatabase();
  });

  it("gives the cash back to the box, keeps the row and records who voided it and why", async () => {
    const w = await world();
    await fundBox(w, 500_000);
    const { id } = await createBoxWithdrawal(w.manager, withdrawal(300_000));
    await voidBoxWithdrawal(w.owner, { withdrawalId: id, reason: "Monto equivocado" });

    const box = await getFinanceBox();
    expect(box).toMatchObject({ withdrawalsCents: 0, balanceCents: 500_000, withdrawalCount: 1 });
    expect(box.withdrawals[0]).toMatchObject({ id, voidReason: "Monto equivocado" });
    expect(box.withdrawals[0]?.voidedAt).toBeInstanceOf(Date);
    const row = await testDb.financeBoxWithdrawal.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ voidedById: w.owner.id, voidReason: "Monto equivocado" });
    const entry = await testDb.auditLog.findFirstOrThrow({
      where: { entityId: id, action: "FINANCE_BOX_WITHDRAWAL_VOIDED" },
    });
    expect(entry).toMatchObject({ userId: w.owner.id, reason: "Monto equivocado" });
  });

  it("lets a voided withdrawal free the balance for a new one", async () => {
    const w = await world();
    await fundBox(w, 500_000);
    const { id } = await createBoxWithdrawal(w.manager, withdrawal(500_000));
    await expect(createBoxWithdrawal(w.manager, withdrawal(1))).rejects.toBeInstanceOf(
      FinanceBoxInsufficientError,
    );
    await voidBoxWithdrawal(w.manager, { withdrawalId: id, reason: "Se canceló el depósito" });
    await expect(createBoxWithdrawal(w.manager, withdrawal(500_000))).resolves.toHaveProperty("id");
  });

  it("voids only once and refuses what does not exist", async () => {
    const w = await world();
    await fundBox(w, 500_000);
    const { id } = await createBoxWithdrawal(w.manager, withdrawal(100_000));
    await voidBoxWithdrawal(w.manager, { withdrawalId: id, reason: "Primera anulación" });
    await expect(
      voidBoxWithdrawal(w.manager, { withdrawalId: id, reason: "Segunda anulación" }),
    ).rejects.toBeInstanceOf(FinanceEntryVoidedError);
    await expect(
      voidBoxWithdrawal(w.manager, { withdrawalId: "no-existe", reason: "Motivo cualquiera" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await testDb.auditLog.count({ where: { action: "FINANCE_BOX_WITHDRAWAL_VOIDED" } }),
    ).toBe(1);
  });

  it("needs finance.void and a reason", async () => {
    const w = await world();
    await fundBox(w, 500_000);
    const { id } = await createBoxWithdrawal(w.manager, withdrawal(100_000));
    await expect(
      voidBoxWithdrawal(w.cashier, { withdrawalId: id, reason: "Quiero anularlo" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      voidBoxWithdrawal(w.manager, { withdrawalId: id, reason: "ab" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      (await testDb.financeBoxWithdrawal.findUniqueOrThrow({ where: { id } })).voidedAt,
    ).toBeNull();
  });
});

/** Lo que la base de datos hace cumplir aunque el código falle (migración `finance_box_withdrawals`). */
describe("FinanceBoxWithdrawal database rules", () => {
  beforeEach(resetDatabase);
  afterAll(async () => {
    await db.$disconnect();
    await closeDatabase();
  });

  async function insertRow(w: World) {
    return testDb.financeBoxWithdrawal.create({
      data: {
        amountCents: 1_000,
        occurredAt: new Date(),
        reason: "Retiro directo",
        clientRequestId: `direct-${Math.random().toString(36).slice(2, 10)}`,
        createdById: w.owner.id,
      },
    });
  }

  it("refuses a zero or negative amount", async () => {
    const w = await world();
    const text = await failure(
      testDb.financeBoxWithdrawal.create({
        data: {
          amountCents: 0,
          occurredAt: new Date(),
          reason: "Cero",
          clientRequestId: "direct-zero-1",
          createdById: w.owner.id,
        },
      }),
    );
    expect(text).toContain("FinanceBoxWithdrawal_amount_positive");
  });

  it("does not delete and does not change anything but the voiding", async () => {
    const w = await world();
    const row = await insertRow(w);
    expect(await failure(testDb.financeBoxWithdrawal.delete({ where: { id: row.id } }))).toContain(
      "no se borra",
    );
    expect(
      await failure(
        testDb.financeBoxWithdrawal.update({ where: { id: row.id }, data: { amountCents: 2_000 } }),
      ),
    ).toContain("solo cambia al anularse");
  });

  it("voids once, completely, and a voided row no longer changes", async () => {
    const w = await world();
    const row = await insertRow(w);
    expect(
      await failure(
        testDb.financeBoxWithdrawal.update({
          where: { id: row.id },
          data: { voidedAt: new Date() },
        }),
      ),
    ).toContain("FinanceBoxWithdrawal_void_complete");
    await testDb.financeBoxWithdrawal.update({
      where: { id: row.id },
      data: { voidedAt: new Date(), voidedById: w.owner.id, voidReason: "Motivo completo" },
    });
    expect(
      await failure(
        testDb.financeBoxWithdrawal.update({
          where: { id: row.id },
          data: { voidReason: "Otro motivo" },
        }),
      ),
    ).toContain("anulado ya no cambia");
  });
});
