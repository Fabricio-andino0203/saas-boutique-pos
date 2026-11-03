import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  FinanceDrawerEntryError,
  FinanceEntryVoidedError,
  ForbiddenError,
  ItemInUseError,
  NameTakenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import {
  ENTRY_LIST_LIMIT,
  listFinanceCategories,
  listFinanceEntries,
} from "@/modules/finance/queries";
import {
  createFinanceCategory,
  createFinanceEntry,
  renameFinanceCategory,
  setFinanceCategoryArchived,
  voidFinanceEntry,
} from "@/modules/finance/service";

import { seedBase } from "../../prisma/seed/run-seed";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const closeAll = async () => {
  await db.$disconnect();
  await closeDatabase();
};

type Actor = { id: string; role: Role };

const NOW = new Date("2026-11-03T18:00:00Z"); // 12:00 en Tegucigalpa

async function setup() {
  await seedBase(testDb);
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: `Nombre ${username}`, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  const rent = await testDb.financeCategory.findFirstOrThrow({
    where: { type: "EXPENSE", name: "Alquiler" },
  });
  const contribution = await testDb.financeCategory.findFirstOrThrow({
    where: { type: "INCOME", name: "Aporte del dueño" },
  });
  return {
    owner: await make("owner", "OWNER"),
    manager: await make("manager", "MANAGER"),
    cashier: await make("cashier", "CASHIER"),
    warehouse: await make("warehouse", "WAREHOUSE"),
    rent,
    contribution,
  };
}

let counter = 0;
function expenseInput(categoryId: string, overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    type: "EXPENSE",
    categoryId,
    amountCents: 800_000,
    occurredOn: "2026-11-03",
    paidWith: "TRANSFER",
    description: "Alquiler de noviembre",
    clientRequestId: `request-${counter}-${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  };
}

describe("createFinanceEntry", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("records an expense with its audit entry, on the local day of the date", async () => {
    const { manager, rent } = await setup();
    const { id } = await createFinanceEntry(manager, expenseInput(rent.id), db, NOW);

    const saved = await testDb.financeEntry.findUniqueOrThrow({ where: { id } });
    expect(saved).toMatchObject({
      type: "EXPENSE",
      amountCents: 800_000,
      paidWith: "TRANSFER",
      description: "Alquiler de noviembre",
      createdById: manager.id,
      voidedAt: null,
      cashMovementId: null,
    });
    // 3 de noviembre, mediodía en Tegucigalpa (UTC−6).
    expect(saved.occurredAt.toISOString()).toBe("2026-11-03T18:00:00.000Z");

    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "FINANCE_ENTRY_CREATED" },
    });
    expect(log).toMatchObject({ entityType: "FinanceEntry", entityId: id, userId: manager.id });
    expect(log.after).toMatchObject({ amountCents: 800_000, categoryId: rent.id });
  });

  it("records an income that is not a sale", async () => {
    const { owner, contribution } = await setup();
    const { id } = await createFinanceEntry(
      owner,
      expenseInput(contribution.id, {
        type: "INCOME",
        description: "Aporte para inventario",
        paidWith: "CASH_OTHER",
      }),
      db,
      NOW,
    );
    expect(await testDb.financeEntry.findUniqueOrThrow({ where: { id } })).toMatchObject({
      type: "INCOME",
      paidWith: "CASH_OTHER",
    });
  });

  it("is idempotent: the same request id returns the same entry and does not duplicate it", async () => {
    const { manager, rent } = await setup();
    const input = expenseInput(rent.id);
    const first = await createFinanceEntry(manager, input, db, NOW);
    const again = await createFinanceEntry(manager, input, db, NOW);
    expect(again.id).toBe(first.id);
    expect(await testDb.financeEntry.count()).toBe(1);
    expect(await testDb.auditLog.count({ where: { action: "FINANCE_ENTRY_CREATED" } })).toBe(1);
  });

  it("survives five identical submissions at once", async () => {
    const { manager, rent } = await setup();
    const input = expenseInput(rent.id);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => createFinanceEntry(manager, input, db, NOW)),
    );
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(await testDb.financeEntry.count()).toBe(1);
  });

  it("does not hand one user's entry to another who reuses the request id", async () => {
    const { manager, owner, rent } = await setup();
    const input = expenseInput(rent.id);
    await createFinanceEntry(manager, input, db, NOW);
    await expect(createFinanceEntry(owner, input, db, NOW)).rejects.toBeInstanceOf(ValidationError);
  });

  it("is only for the owner and the manager", async () => {
    const { cashier, warehouse, rent } = await setup();
    await expect(
      createFinanceEntry(cashier, expenseInput(rent.id), db, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createFinanceEntry(warehouse, expenseInput(rent.id), db, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await testDb.financeEntry.count()).toBe(0);
  });

  it.each([
    ["a zero amount", { amountCents: 0 }],
    ["a negative amount", { amountCents: -500 }],
    ["an amount with decimals", { amountCents: 100.5 }],
    ["an amount over the cap", { amountCents: 1_000_000_001 }],
    ["a description that is too short", { description: "ab" }],
    ["a date that is not real", { occurredOn: "2026-02-30" }],
    ["a future date", { occurredOn: "2026-11-04" }],
    ["a payment method that only the till can set", { paidWith: "CASH_DRAWER" }],
    ["a request id that is too short", { clientRequestId: "abc" }],
  ])("rejects %s", async (_name, overrides) => {
    const { manager, rent } = await setup();
    await expect(
      createFinanceEntry(manager, expenseInput(rent.id, overrides), db, NOW),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await testDb.financeEntry.count()).toBe(0);
  });

  it("rejects an unknown, archived or other-type category", async () => {
    const { manager, rent, contribution } = await setup();
    await expect(
      createFinanceEntry(manager, expenseInput("no-existe"), db, NOW),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createFinanceEntry(manager, expenseInput(contribution.id), db, NOW),
    ).rejects.toBeInstanceOf(ValidationError);
    await testDb.financeCategory.update({
      where: { id: rent.id },
      data: { archivedAt: new Date() },
    });
    await expect(
      createFinanceEntry(manager, expenseInput(rent.id), db, NOW),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts a supplier and rejects an unknown or archived one", async () => {
    const { manager, rent } = await setup();
    const supplier = await testDb.supplier.create({ data: { name: "Distribuidora Luna" } });
    const { id } = await createFinanceEntry(
      manager,
      expenseInput(rent.id, { supplierId: supplier.id }),
      db,
      NOW,
    );
    expect((await testDb.financeEntry.findUniqueOrThrow({ where: { id } })).supplierId).toBe(
      supplier.id,
    );

    await expect(
      createFinanceEntry(manager, expenseInput(rent.id, { supplierId: "no-existe" }), db, NOW),
    ).rejects.toBeInstanceOf(NotFoundError);
    await testDb.supplier.update({ where: { id: supplier.id }, data: { archivedAt: new Date() } });
    await expect(
      createFinanceEntry(manager, expenseInput(rent.id, { supplierId: supplier.id }), db, NOW),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("voidFinanceEntry", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("voids with a reason, keeps the row and audits who did it", async () => {
    const { manager, owner, rent } = await setup();
    const { id } = await createFinanceEntry(manager, expenseInput(rent.id), db, NOW);

    await voidFinanceEntry(owner, { entryId: id, reason: "Se registró dos veces" }, db, NOW);

    const saved = await testDb.financeEntry.findUniqueOrThrow({ where: { id } });
    expect(saved).toMatchObject({ voidedById: owner.id, voidReason: "Se registró dos veces" });
    expect(saved.voidedAt?.toISOString()).toBe(NOW.toISOString());
    expect(saved.amountCents).toBe(800_000);

    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "FINANCE_ENTRY_VOIDED" },
    });
    expect(log).toMatchObject({ entityId: id, userId: owner.id, reason: "Se registró dos veces" });
    expect(log.before).toMatchObject({ amountCents: 800_000 });
  });

  it("does not void twice", async () => {
    const { manager, rent } = await setup();
    const { id } = await createFinanceEntry(manager, expenseInput(rent.id), db, NOW);
    await voidFinanceEntry(manager, { entryId: id, reason: "Monto equivocado" }, db, NOW);
    await expect(
      voidFinanceEntry(manager, { entryId: id, reason: "Otra vez por error" }, db, NOW),
    ).rejects.toBeInstanceOf(FinanceEntryVoidedError);
    expect(await testDb.auditLog.count({ where: { action: "FINANCE_ENTRY_VOIDED" } })).toBe(1);
  });

  it("needs a reason, an existing entry and the right role", async () => {
    const { manager, cashier, rent } = await setup();
    const { id } = await createFinanceEntry(manager, expenseInput(rent.id), db, NOW);
    await expect(
      voidFinanceEntry(manager, { entryId: id, reason: "  " }, db, NOW),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      voidFinanceEntry(manager, { entryId: "no-existe", reason: "Motivo válido" }, db, NOW),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      voidFinanceEntry(cashier, { entryId: id, reason: "Motivo válido" }, db, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await testDb.financeEntry.findUniqueOrThrow({ where: { id } })).voidedAt).toBeNull();
  });

  it("refuses to void an expense that came out of the till", async () => {
    const { manager, rent } = await setup();
    const terminal = await testDb.terminal.findFirstOrThrow();
    const session = await testDb.cashSession.create({
      data: { terminalId: terminal.id, userId: manager.id, openingFloatCents: 100_000 },
    });
    const movement = await testDb.cashMovement.create({
      data: {
        cashSessionId: session.id,
        type: "OUT",
        amountCents: 20_000,
        reason: "Gasto de caja",
        userId: manager.id,
      },
    });
    const entry = await testDb.financeEntry.create({
      data: {
        type: "EXPENSE",
        categoryId: rent.id,
        amountCents: 20_000,
        occurredAt: NOW,
        paidWith: "CASH_DRAWER",
        description: "Compra de bolsas",
        cashMovementId: movement.id,
        clientRequestId: "drawer-expense-1",
        createdById: manager.id,
      },
    });
    await expect(
      voidFinanceEntry(manager, { entryId: entry.id, reason: "Motivo válido" }, db, NOW),
    ).rejects.toBeInstanceOf(FinanceDrawerEntryError);
    expect(
      (await testDb.financeEntry.findUniqueOrThrow({ where: { id: entry.id } })).voidedAt,
    ).toBeNull();
  });
});

describe("finance categories", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("starts with the default categories", async () => {
    await setup();
    const expense = await listFinanceCategories({ type: "EXPENSE" });
    const income = await listFinanceCategories({ type: "INCOME" });
    expect(expense.map((row) => row.name)).toContain("Alquiler");
    expect(income.map((row) => row.name)).toEqual(["Aporte del dueño", "Otros ingresos"]);
  });

  it("creates one at the end of its type, audited", async () => {
    const { manager } = await setup();
    const { id } = await createFinanceCategory(manager, { type: "EXPENSE", name: "Seguridad" });
    const all = await listFinanceCategories({ type: "EXPENSE" });
    expect(all[all.length - 1]).toMatchObject({ id, name: "Seguridad", archived: false });
    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "FINANCE_CATEGORY_CHANGED" },
    });
    expect(log).toMatchObject({ entityId: id, userId: manager.id });
  });

  it("does not repeat a name in a type, ignoring case, but allows it in the other type", async () => {
    const { manager } = await setup();
    await expect(
      createFinanceCategory(manager, { type: "EXPENSE", name: "alquiler" }),
    ).rejects.toBeInstanceOf(NameTakenError);
    await createFinanceCategory(manager, { type: "INCOME", name: "Alquiler" });
  });

  it("renames, and refuses a name another category has", async () => {
    const { manager, rent } = await setup();
    await renameFinanceCategory(manager, rent.id, { name: "Alquiler del local" });
    expect((await testDb.financeCategory.findUniqueOrThrow({ where: { id: rent.id } })).name).toBe(
      "Alquiler del local",
    );
    await expect(
      renameFinanceCategory(manager, rent.id, { name: "Publicidad" }),
    ).rejects.toBeInstanceOf(NameTakenError);
    await expect(
      renameFinanceCategory(manager, "no-existe", { name: "Nuevo nombre" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("archives and restores, but not while an active fixed cost uses it", async () => {
    const { manager, owner, rent } = await setup();
    const fixedCost = await testDb.fixedCost.create({
      data: {
        name: "Alquiler del local",
        categoryId: rent.id,
        amountCents: 800_000,
        dueDay: 5,
        startsOn: new Date("2026-01-01T00:00:00Z"),
      },
    });
    await expect(setFinanceCategoryArchived(manager, rent.id, true)).rejects.toBeInstanceOf(
      ItemInUseError,
    );

    await testDb.fixedCost.update({
      where: { id: fixedCost.id },
      data: { archivedAt: new Date() },
    });
    await setFinanceCategoryArchived(owner, rent.id, true, db, NOW);
    expect((await listFinanceCategories({ type: "EXPENSE" })).map((row) => row.name)).not.toContain(
      "Alquiler",
    );
    expect(
      (await listFinanceCategories({ type: "EXPENSE", includeArchived: true })).map(
        (row) => row.name,
      ),
    ).toContain("Alquiler");

    await setFinanceCategoryArchived(owner, rent.id, false);
    expect((await listFinanceCategories({ type: "EXPENSE" })).map((row) => row.name)).toContain(
      "Alquiler",
    );
  });

  it("is only for the owner and the manager", async () => {
    const { cashier, rent } = await setup();
    await expect(
      createFinanceCategory(cashier, { type: "EXPENSE", name: "Seguridad" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      renameFinanceCategory(cashier, rent.id, { name: "Otro nombre" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setFinanceCategoryArchived(cashier, rent.id, true)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("listFinanceEntries", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  const range = {
    from: new Date("2026-11-01T06:00:00Z"),
    to: new Date("2026-11-30T05:59:59Z"),
  };

  it("lists the period newest first with totals that leave out voided entries", async () => {
    const { manager, owner, rent, contribution } = await setup();
    const day = (date: string) => ({ occurredOn: date });
    await createFinanceEntry(
      manager,
      expenseInput(rent.id, { ...day("2026-11-02"), amountCents: 800_000 }),
      db,
      NOW,
    );
    const second = await createFinanceEntry(
      manager,
      expenseInput(rent.id, { ...day("2026-11-03"), amountCents: 30_000, description: "Bolsas" }),
      db,
      NOW,
    );
    await createFinanceEntry(
      owner,
      expenseInput(contribution.id, {
        type: "INCOME",
        ...day("2026-11-03"),
        amountCents: 500_000,
        description: "Aporte",
      }),
      db,
      NOW,
    );
    await voidFinanceEntry(owner, { entryId: second.id, reason: "Monto equivocado" }, db, NOW);

    const visible = await listFinanceEntries({ range });
    expect(visible.rows.map((row) => row.description)).toEqual(["Aporte", "Alquiler de noviembre"]);
    expect(visible.totals).toEqual({ expenseCents: 800_000, incomeCents: 500_000 });

    const withVoided = await listFinanceEntries({ range, includeVoided: true });
    expect(withVoided.rows).toHaveLength(3);
    expect(withVoided.rows.find((row) => row.id === second.id)).toMatchObject({
      voidReason: "Monto equivocado",
      voidedByName: "Nombre owner",
    });
    // Los anulados nunca suman, ni al pedirlos.
    expect(withVoided.totals).toEqual({ expenseCents: 800_000, incomeCents: 500_000 });
  });

  it("filters by type, category, payment method and period", async () => {
    const { manager, rent, contribution } = await setup();
    await createFinanceEntry(
      manager,
      expenseInput(rent.id, { occurredOn: "2026-11-02", paidWith: "CARD" }),
      db,
      NOW,
    );
    await createFinanceEntry(
      manager,
      expenseInput(contribution.id, {
        type: "INCOME",
        occurredOn: "2026-11-03",
        paidWith: "TRANSFER",
      }),
      db,
      NOW,
    );

    expect((await listFinanceEntries({ range, type: "INCOME" })).rows).toHaveLength(1);
    expect((await listFinanceEntries({ range, categoryId: rent.id })).rows).toHaveLength(1);
    expect((await listFinanceEntries({ range, paidWith: "CARD" })).rows).toHaveLength(1);
    expect(
      (
        await listFinanceEntries({
          range: { from: new Date("2026-11-03T06:00:00Z"), to: range.to },
        })
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await listFinanceEntries({
          range: { from: new Date("2026-12-01T06:00:00Z"), to: new Date("2026-12-31T06:00:00Z") },
        })
      ).rows,
    ).toHaveLength(0);
  });

  it("shows at most the list limit but totals every row", async () => {
    const { manager, rent } = await setup();
    await testDb.financeEntry.createMany({
      data: Array.from({ length: ENTRY_LIST_LIMIT + 5 }, (_, index) => ({
        type: "EXPENSE" as const,
        categoryId: rent.id,
        amountCents: 100,
        occurredAt: new Date("2026-11-03T18:00:00Z"),
        paidWith: "OTHER" as const,
        description: `Gasto ${index}`,
        clientRequestId: `bulk-${index}`,
        createdById: manager.id,
      })),
    });
    const result = await listFinanceEntries({ range });
    expect(result.rows).toHaveLength(ENTRY_LIST_LIMIT);
    expect(result.truncated).toBe(true);
    expect(result.totals.expenseCents).toBe((ENTRY_LIST_LIMIT + 5) * 100);
  });
});
