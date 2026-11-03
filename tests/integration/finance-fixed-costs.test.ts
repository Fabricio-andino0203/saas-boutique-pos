import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  FixedCostPaidError,
  ForbiddenError,
  NameTakenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import { listFixedCosts } from "@/modules/finance/queries";
import {
  createFixedCost,
  payFixedCost,
  setFixedCostArchived,
  updateFixedCost,
  voidFinanceEntry,
} from "@/modules/finance/service";

import { seedBase } from "../../prisma/seed/run-seed";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const closeAll = async () => {
  await db.$disconnect();
  await closeDatabase();
};

type Actor = { id: string; role: Role };

const NOW = new Date("2026-11-10T18:00:00Z"); // 10 de noviembre de 2026, mediodía en Tegucigalpa

async function setup() {
  await seedBase(testDb);
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: `Nombre ${username}`, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  return {
    manager: await make("manager", "MANAGER"),
    cashier: await make("cashier", "CASHIER"),
    rent: await testDb.financeCategory.findFirstOrThrow({
      where: { type: "EXPENSE", name: "Alquiler" },
    }),
    income: await testDb.financeCategory.findFirstOrThrow({
      where: { type: "INCOME", name: "Otros ingresos" },
    }),
  };
}

type Base = Awaited<ReturnType<typeof setup>>;

const costInput = (base: Base, overrides: Record<string, unknown> = {}) => ({
  name: "Alquiler del local",
  categoryId: base.rent.id,
  amountCents: 800_000,
  dueDay: 5,
  startsOn: "2026-09",
  ...overrides,
});

let counter = 0;
const payInput = (fixedCostId: string, overrides: Record<string, unknown> = {}) => {
  counter += 1;
  return {
    fixedCostId,
    period: "2026-11",
    amountCents: 800_000,
    occurredOn: "2026-11-05",
    paidWith: "TRANSFER",
    clientRequestId: `pay-${counter}-${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  };
};

describe("createFixedCost, updateFixedCost and setFixedCostArchived", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("creates a monthly fixed cost with its audit entry", async () => {
    const base = await setup();
    const { id } = await createFixedCost(base.manager, costInput(base, { endsOn: "2027-08" }));
    const saved = await testDb.fixedCost.findUniqueOrThrow({ where: { id } });
    expect(saved).toMatchObject({ name: "Alquiler del local", amountCents: 800_000, dueDay: 5 });
    expect(saved.startsOn.toISOString()).toBe("2026-09-01T18:00:00.000Z");
    expect(saved.endsOn?.toISOString()).toBe("2027-08-01T18:00:00.000Z");
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "FIXED_COST_CHANGED" } });
    expect(log).toMatchObject({ entityId: id, userId: base.manager.id });
    expect(log.after).toMatchObject({
      name: "Alquiler del local",
      startsOn: "2026-09",
      endsOn: "2027-08",
    });
  });

  it.each([
    ["a name that is too short", { name: "A" }],
    ["a zero amount", { amountCents: 0 }],
    ["a day after the 28th", { dueDay: 29 }],
    ["day zero", { dueDay: 0 }],
    ["a start that is not a month", { startsOn: "2026-13" }],
    ["an end before the start", { endsOn: "2026-08" }],
  ])("rejects %s", async (_name, overrides) => {
    const base = await setup();
    await expect(createFixedCost(base.manager, costInput(base, overrides))).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await testDb.fixedCost.count()).toBe(0);
  });

  it("needs an active expense category", async () => {
    const base = await setup();
    await expect(
      createFixedCost(base.manager, costInput(base, { categoryId: base.income.id })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createFixedCost(base.manager, costInput(base, { categoryId: "no-existe" })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await testDb.financeCategory.update({
      where: { id: base.rent.id },
      data: { archivedAt: new Date() },
    });
    await expect(createFixedCost(base.manager, costInput(base))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("does not repeat an active name, ignoring case, and is not for the cashier", async () => {
    const base = await setup();
    await createFixedCost(base.manager, costInput(base));
    await expect(
      createFixedCost(base.manager, costInput(base, { name: "alquiler del LOCAL" })),
    ).rejects.toBeInstanceOf(NameTakenError);
    await expect(
      createFixedCost(base.cashier, costInput(base, { name: "Internet" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("changes the amount for the months to come and audits before and after", async () => {
    const base = await setup();
    const { id } = await createFixedCost(base.manager, costInput(base));
    await updateFixedCost(base.manager, id, costInput(base, { amountCents: 850_000, dueDay: 10 }));
    expect(await testDb.fixedCost.findUniqueOrThrow({ where: { id } })).toMatchObject({
      amountCents: 850_000,
      dueDay: 10,
    });
    const logs = await testDb.auditLog.findMany({
      where: { action: "FIXED_COST_CHANGED" },
      orderBy: { createdAt: "asc" },
    });
    expect(logs).toHaveLength(2);
    expect(logs[1]?.before).toMatchObject({ amountCents: 800_000 });
    expect(logs[1]?.after).toMatchObject({ amountCents: 850_000 });
  });

  it("archives and restores, and an archived one cannot be edited", async () => {
    const base = await setup();
    const { id } = await createFixedCost(base.manager, costInput(base));
    await setFixedCostArchived(base.manager, id, true, db, NOW);
    expect((await testDb.fixedCost.findUniqueOrThrow({ where: { id } })).archivedAt).not.toBeNull();
    await expect(updateFixedCost(base.manager, id, costInput(base))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await setFixedCostArchived(base.manager, id, false);
    expect((await testDb.fixedCost.findUniqueOrThrow({ where: { id } })).archivedAt).toBeNull();
  });
});

describe("listFixedCosts", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("lists the months still to pay, oldest first, flagging the ones past their day", async () => {
    const base = await setup();
    await createFixedCost(base.manager, costInput(base, { startsOn: "2026-09" })); // día 5
    const { costs, pending } = await listFixedCosts({}, NOW);
    expect(costs).toHaveLength(1);
    expect(costs[0]).toMatchObject({
      name: "Alquiler del local",
      pendingCount: 3,
      startsOn: "2026-09",
    });
    expect(pending.map((row) => [row.period, row.dueDate, row.overdue])).toEqual([
      ["2026-09", "2026-09-05", true],
      ["2026-10", "2026-10-05", true],
      ["2026-11", "2026-11-05", true],
    ]);
    // Un día de pago que todavía no llega no es atraso.
    await createFixedCost(
      base.manager,
      costInput(base, { name: "Internet", dueDay: 20, startsOn: "2026-11" }),
    );
    const next = await listFixedCosts({}, NOW);
    expect(next.pending.find((row) => row.name === "Internet")).toMatchObject({
      dueDate: "2026-11-20",
      overdue: false,
    });
  });

  it("drops a month once it is paid and brings it back if the payment is voided", async () => {
    const base = await setup();
    const { id } = await createFixedCost(base.manager, costInput(base, { startsOn: "2026-11" }));
    const paid = await payFixedCost(base.manager, payInput(id), db, NOW);
    expect((await listFixedCosts({}, NOW)).pending).toHaveLength(0);
    await voidFinanceEntry(base.manager, { entryId: paid.id, reason: "Monto equivocado" }, db, NOW);
    expect((await listFixedCosts({}, NOW)).pending.map((row) => row.period)).toEqual(["2026-11"]);
  });

  it("shows nothing for an archived cost unless asked, and no pending months for it", async () => {
    const base = await setup();
    const { id } = await createFixedCost(base.manager, costInput(base));
    await setFixedCostArchived(base.manager, id, true, db, NOW);
    expect((await listFixedCosts({}, NOW)).costs).toHaveLength(0);
    const all = await listFixedCosts({ includeArchived: true }, NOW);
    expect(all.costs).toHaveLength(1);
    expect(all.costs[0]).toMatchObject({ archived: true, pendingCount: 0 });
    expect(all.pending).toHaveLength(0);
  });
});

describe("payFixedCost", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("records the payment as an expense with the fixed cost's category, month and a readable description", async () => {
    const base = await setup();
    const { id } = await createFixedCost(base.manager, costInput(base));
    const paid = await payFixedCost(
      base.manager,
      payInput(id, { amountCents: 812_500, paidWith: "CARD" }),
      db,
      NOW,
    );

    const entry = await testDb.financeEntry.findUniqueOrThrow({ where: { id: paid.id } });
    expect(entry).toMatchObject({
      type: "EXPENSE",
      categoryId: base.rent.id,
      amountCents: 812_500,
      paidWith: "CARD",
      fixedCostId: id,
      period: "2026-11",
      createdById: base.manager.id,
    });
    expect(entry.description).toBe("Alquiler del local (noviembre de 2026)");
    expect(entry.occurredAt.toISOString()).toBe("2026-11-05T18:00:00.000Z");
    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "FINANCE_ENTRY_CREATED" },
    });
    expect(log.after).toMatchObject({ fixedCostId: id, period: "2026-11", amountCents: 812_500 });
  });

  it("is idempotent by request id", async () => {
    const base = await setup();
    const { id } = await createFixedCost(base.manager, costInput(base));
    const input = payInput(id);
    const first = await payFixedCost(base.manager, input, db, NOW);
    const again = await payFixedCost(base.manager, input, db, NOW);
    expect(again.id).toBe(first.id);
    expect(await testDb.financeEntry.count()).toBe(1);
  });

  it("does not pay the same month twice, but allows another month, and the month again after voiding", async () => {
    const base = await setup();
    const { id } = await createFixedCost(base.manager, costInput(base));
    const first = await payFixedCost(base.manager, payInput(id), db, NOW);
    await expect(payFixedCost(base.manager, payInput(id), db, NOW)).rejects.toBeInstanceOf(
      FixedCostPaidError,
    );
    await payFixedCost(base.manager, payInput(id, { period: "2026-10" }), db, NOW);

    await voidFinanceEntry(
      base.manager,
      { entryId: first.id, reason: "Se pagó con otro monto" },
      db,
      NOW,
    );
    await payFixedCost(base.manager, payInput(id), db, NOW);
    expect(await testDb.financeEntry.count({ where: { voidedAt: null } })).toBe(2);
  });

  it("lets only one of two simultaneous payments of the same month through", async () => {
    const base = await setup();
    const { id } = await createFixedCost(base.manager, costInput(base));
    const results = await Promise.allSettled([
      payFixedCost(base.manager, payInput(id), db, NOW),
      payFixedCost(base.manager, payInput(id), db, NOW),
      payFixedCost(base.manager, payInput(id), db, NOW),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(FixedCostPaidError);
      }
    }
    expect(await testDb.financeEntry.count({ where: { voidedAt: null } })).toBe(1);
  });

  it("only pays months the cost covers and that have started", async () => {
    const base = await setup();
    const { id } = await createFixedCost(
      base.manager,
      costInput(base, { startsOn: "2026-09", endsOn: "2026-10" }),
    );
    await expect(
      payFixedCost(base.manager, payInput(id, { period: "2026-08" }), db, NOW),
    ).rejects.toBeInstanceOf(ValidationError); // antes de empezar
    await expect(
      payFixedCost(base.manager, payInput(id, { period: "2026-11" }), db, NOW),
    ).rejects.toBeInstanceOf(ValidationError); // después de terminar
    await payFixedCost(base.manager, payInput(id, { period: "2026-10" }), db, NOW);

    const open = await createFixedCost(
      base.manager,
      costInput(base, { name: "Internet", startsOn: "2026-09" }),
    );
    await expect(
      payFixedCost(base.manager, payInput(open.id, { period: "2026-12" }), db, NOW),
    ).rejects.toBeInstanceOf(ValidationError); // un mes que todavía no llega
  });

  it("rejects an archived cost, a future payment date, a bad amount and the cashier", async () => {
    const base = await setup();
    const { id } = await createFixedCost(base.manager, costInput(base));
    await expect(
      payFixedCost(base.manager, payInput(id, { occurredOn: "2026-11-11" }), db, NOW),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      payFixedCost(base.manager, payInput(id, { amountCents: 0 }), db, NOW),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(payFixedCost(base.cashier, payInput(id), db, NOW)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(payFixedCost(base.manager, payInput("no-existe"), db, NOW)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await setFixedCostArchived(base.manager, id, true, db, NOW);
    await expect(payFixedCost(base.manager, payInput(id), db, NOW)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await testDb.financeEntry.count()).toBe(0);
  });
});
