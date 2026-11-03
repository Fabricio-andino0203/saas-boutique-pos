import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  CashSessionClosedError,
  CashSessionOpenError,
  CashSessionStateError,
  ForbiddenError,
  InsufficientCashError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import {
  countPendingApprovals,
  getCashSessionDetail,
  getOpenSessionOf,
  getTerminalStatus,
  listCashSessions,
} from "@/modules/cash/queries";
import {
  addCashMovement,
  approveCashClose,
  openCashSession,
  previewCashClose,
  submitCashClose,
} from "@/modules/cash/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const closeAll = async () => {
  await db.$disconnect();
  await closeDatabase();
};

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
  const cashier2 = await make("cashier2", "CASHIER");
  const warehouse = await make("warehouse", "WAREHOUSE");
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const terminal = await testDb.terminal.create({
    data: { name: "Caja 1", locationId: location.id },
  });
  return { owner, manager, cashier, cashier2, warehouse, location, terminal };
}

type World = Awaited<ReturnType<typeof world>>;

let saleSeq = 0;

/** Una venta ya hecha, directo en la base: este módulo solo lee lo que dejaron las ventas. */
async function insertSale(
  w: World,
  cashSessionId: string,
  sale: {
    totalCents: number;
    payments: { method: "CASH" | "CARD"; amountCents: number }[];
    changeCents?: number;
    status?: "COMPLETED" | "VOIDED";
  },
) {
  saleSeq += 1;
  const paid = sale.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  return testDb.sale.create({
    data: {
      number: `T-TEST-${saleSeq}`,
      clientRequestId: `req-${saleSeq}`,
      status: sale.status ?? "COMPLETED",
      locationId: w.location.id,
      terminalId: w.terminal.id,
      cashSessionId,
      sellerId: w.cashier.id,
      subtotalCents: sale.totalCents,
      taxCents: 0,
      totalCents: sale.totalCents,
      paidCents: paid,
      changeCents: sale.changeCents ?? 0,
      payments: {
        create: sale.payments.map((payment) => ({ ...payment, cashSessionId })),
      },
    },
  });
}

describe("openCashSession", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("opens the shift on the terminal with the float", async () => {
    const w = await world();
    const { id } = await openCashSession(w.cashier, { openingFloatCents: 50000 }, testDb);
    const session = await testDb.cashSession.findUniqueOrThrow({ where: { id } });
    expect(session).toMatchObject({
      userId: w.cashier.id,
      terminalId: w.terminal.id,
      status: "OPEN",
      openingFloatCents: 50000,
      closedAt: null,
    });
  });

  it("accepts a zero float", async () => {
    const w = await world();
    const { id } = await openCashSession(w.cashier, { openingFloatCents: 0 }, testDb);
    const session = await testDb.cashSession.findUniqueOrThrow({ where: { id } });
    expect(session.openingFloatCents).toBe(0);
  });

  it("refuses roles without the capability", async () => {
    const w = await world();
    await expect(
      openCashSession(w.warehouse, { openingFloatCents: 0 }, testDb),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses an invalid float", async () => {
    const w = await world();
    for (const openingFloatCents of [-1, 10.5, Number.NaN, "abc"]) {
      await expect(
        openCashSession(w.cashier, { openingFloatCents }, testDb),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("allows only one open shift per user", async () => {
    const w = await world();
    await openCashSession(w.cashier, { openingFloatCents: 0 }, testDb);
    await expect(
      openCashSession(w.cashier, { openingFloatCents: 0 }, testDb),
    ).rejects.toBeInstanceOf(CashSessionOpenError);
  });

  it("allows only one open shift per terminal", async () => {
    const w = await world();
    await openCashSession(w.cashier, { openingFloatCents: 0 }, testDb);
    await expect(
      openCashSession(w.cashier2, { openingFloatCents: 0 }, testDb),
    ).rejects.toBeInstanceOf(CashSessionOpenError);
  });

  it("lets two people who open at the same time end up with exactly one shift", async () => {
    const w = await world();
    const results = await Promise.allSettled([
      openCashSession(w.cashier, { openingFloatCents: 1000 }, testDb),
      openCashSession(w.cashier2, { openingFloatCents: 2000 }, testDb),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(CashSessionOpenError);
    expect(await testDb.cashSession.count({ where: { status: "OPEN" } })).toBe(1);
  });

  it("lets the same person open again after closing", async () => {
    const w = await world();
    await openCashSession(w.cashier, { openingFloatCents: 0 }, testDb);
    await submitCashClose(w.cashier, { countedCashCents: 0 }, testDb);
    await expect(
      openCashSession(w.cashier, { openingFloatCents: 0 }, testDb),
    ).resolves.toHaveProperty("id");
  });

  it("is backed by database indexes: two open shifts per user cannot exist", async () => {
    const w = await world();
    const other = await testDb.terminal.create({
      data: { name: "Caja 2", locationId: w.location.id },
    });
    await testDb.cashSession.create({
      data: { terminalId: w.terminal.id, userId: w.cashier.id, openingFloatCents: 0 },
    });
    await expect(
      testDb.cashSession.create({
        data: { terminalId: other.id, userId: w.cashier.id, openingFloatCents: 0 },
      }),
    ).rejects.toThrow();
  });
});

describe("addCashMovement", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  async function openWith(w: World, floatCents: number) {
    return (await openCashSession(w.cashier, { openingFloatCents: floatCents }, testDb)).id;
  }

  it("records an entry and an exit with who, why and when", async () => {
    const w = await world();
    const sessionId = await openWith(w, 10000);
    await addCashMovement(
      w.cashier,
      { type: "IN", amountCents: 5000, reason: "  Cambio del banco " },
      testDb,
    );
    await addCashMovement(
      w.cashier,
      { type: "OUT", amountCents: 2000, reason: "Pago de flete" },
      testDb,
    );
    const movements = await testDb.cashMovement.findMany({
      where: { cashSessionId: sessionId },
      orderBy: { createdAt: "asc" },
    });
    expect(movements.map((m) => [m.type, m.amountCents, m.reason, m.userId])).toEqual([
      ["IN", 5000, "Cambio del banco", w.cashier.id],
      ["OUT", 2000, "Pago de flete", w.cashier.id],
    ]);
  });

  it("needs an open shift", async () => {
    const w = await world();
    await expect(
      addCashMovement(w.cashier, { type: "IN", amountCents: 100, reason: "Prueba" }, testDb),
    ).rejects.toBeInstanceOf(CashSessionClosedError);
  });

  it("needs the capability, an amount and a reason", async () => {
    const w = await world();
    await openWith(w, 10000);
    await expect(
      addCashMovement(w.warehouse, { type: "IN", amountCents: 100, reason: "Prueba" }, testDb),
    ).rejects.toBeInstanceOf(ForbiddenError);
    for (const input of [
      { type: "IN", amountCents: 0, reason: "Prueba" },
      { type: "IN", amountCents: -5, reason: "Prueba" },
      { type: "IN", amountCents: 100, reason: "" },
      { type: "IN", amountCents: 100, reason: "ab" },
      { type: "MOVE", amountCents: 100, reason: "Prueba" },
    ]) {
      await expect(addCashMovement(w.cashier, input, testDb)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
  });

  it("does not let an exit take out more cash than the drawer has", async () => {
    const w = await world();
    await openWith(w, 10000);
    await expect(
      addCashMovement(w.cashier, { type: "OUT", amountCents: 10001, reason: "Demasiado" }, testDb),
    ).rejects.toBeInstanceOf(InsufficientCashError);
    // Sacar exactamente todo sí se puede
    await expect(
      addCashMovement(w.cashier, { type: "OUT", amountCents: 10000, reason: "Todo" }, testDb),
    ).resolves.toHaveProperty("id");
  });

  it("counts the cash from sales when checking the exit", async () => {
    const w = await world();
    const sessionId = await openWith(w, 1000);
    await insertSale(w, sessionId, {
      totalCents: 9000,
      payments: [{ method: "CASH", amountCents: 9000 }],
    });
    await expect(
      addCashMovement(w.cashier, { type: "OUT", amountCents: 10000, reason: "Con ventas" }, testDb),
    ).resolves.toHaveProperty("id");
  });

  it("serializes simultaneous exits so the drawer never goes negative", async () => {
    const w = await world();
    await openWith(w, 10000);
    const results = await Promise.allSettled([
      addCashMovement(w.cashier, { type: "OUT", amountCents: 6000, reason: "Salida uno" }, testDb),
      addCashMovement(w.cashier, { type: "OUT", amountCents: 6000, reason: "Salida dos" }, testDb),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
      InsufficientCashError,
    );
  });
});

describe("closing a shift", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  /** Fondo 500.00; venta de 300.00 pagada con 500.00 (vuelto 200.00); venta con tarjeta; venta anulada. */
  async function busyShift(w: World) {
    const { id } = await openCashSession(w.cashier, { openingFloatCents: 50000 }, testDb);
    await insertSale(w, id, {
      totalCents: 30000,
      payments: [{ method: "CASH", amountCents: 50000 }],
      changeCents: 20000,
    });
    await insertSale(w, id, {
      totalCents: 10000,
      payments: [{ method: "CARD", amountCents: 10000 }],
    });
    await insertSale(w, id, {
      totalCents: 5000,
      payments: [{ method: "CASH", amountCents: 5000 }],
      status: "VOIDED",
    });
    await addCashMovement(
      w.cashier,
      { type: "IN", amountCents: 20000, reason: "Más cambio" },
      testDb,
    );
    await addCashMovement(
      w.cashier,
      { type: "OUT", amountCents: 15000, reason: "Pago a proveedor" },
      testDb,
    );
    return id;
  }

  it("expects float + cash payments − change + entries − exits, without voided sales or cards", async () => {
    const w = await world();
    const id = await busyShift(w);
    // 50000 + 50000 + 20000 = 120000; − (20000 + 15000) = 85000
    const detail = await getCashSessionDetail(id);
    expect(detail?.totals).toEqual({
      openingFloatCents: 50000,
      cashPaymentsCents: 50000,
      changeGivenCents: 20000,
      movementsInCents: 20000,
      movementsOutCents: 15000,
      layawayCashCents: 0,
      cashRefundsCents: 0,
    });
    expect(detail?.expectedCents).toBe(85000);
    expect(detail?.sales).toEqual({ count: 2, totalCents: 40000, voidedCount: 1 });
    expect(detail?.payments).toEqual(
      expect.arrayContaining([
        { method: "CASH", amountCents: 50000, count: 1 },
        { method: "CARD", amountCents: 10000, count: 1 },
      ]),
    );
  });

  it("previews the difference without closing anything", async () => {
    const w = await world();
    const id = await busyShift(w);
    await expect(previewCashClose(w.cashier, 84000, testDb)).resolves.toEqual({
      expectedCents: 85000,
      differenceCents: -1000,
    });
    await expect(previewCashClose(w.cashier, 86500, testDb)).resolves.toEqual({
      expectedCents: 85000,
      differenceCents: 1500,
    });
    expect((await testDb.cashSession.findUniqueOrThrow({ where: { id } })).status).toBe("OPEN");
  });

  it("closes a shift that balances without needing a comment", async () => {
    const w = await world();
    const id = await busyShift(w);
    await expect(submitCashClose(w.cashier, { countedCashCents: 85000 }, testDb)).resolves.toEqual({
      id,
      expectedCents: 85000,
      differenceCents: 0,
    });
    const session = await testDb.cashSession.findUniqueOrThrow({ where: { id } });
    expect(session).toMatchObject({
      status: "CLOSED_PENDING_APPROVAL",
      expectedCashCents: 85000,
      countedCashCents: 85000,
      differenceCents: 0,
      notes: null,
      approvedById: null,
    });
    expect(session.closedAt).toBeInstanceOf(Date);
  });

  it("demands a comment when the count does not match", async () => {
    const w = await world();
    const id = await busyShift(w);
    await expect(
      submitCashClose(w.cashier, { countedCashCents: 84000 }, testDb),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      submitCashClose(w.cashier, { countedCashCents: 84000, notes: "  " }, testDb),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await testDb.cashSession.findUniqueOrThrow({ where: { id } })).status).toBe("OPEN");

    await submitCashClose(
      w.cashier,
      { countedCashCents: 84000, notes: "Faltó un billete de L 10" },
      testDb,
    );
    const session = await testDb.cashSession.findUniqueOrThrow({ where: { id } });
    expect(session).toMatchObject({
      differenceCents: -1000,
      notes: "Faltó un billete de L 10",
    });
  });

  it("keeps the denominations in the audit trail and refuses ones that do not add up", async () => {
    const w = await world();
    const id = await busyShift(w);
    // 1 × 50000 + 1 × 20000 + 1 × 10000 + 1 × 5000 = 85000
    const denominations = { "50000": 1, "20000": 1, "10000": 1, "5000": 1 };
    await expect(
      submitCashClose(w.cashier, { countedCashCents: 85100, denominations }, testDb),
    ).rejects.toBeInstanceOf(ValidationError);
    await submitCashClose(w.cashier, { countedCashCents: 85000, denominations }, testDb);

    const log = await testDb.auditLog.findFirstOrThrow({
      where: { entityType: "CashSession", entityId: id, action: "CASH_SESSION_CLOSED" },
    });
    expect(log.userId).toBe(w.cashier.id);
    expect(log.after).toEqual({
      expectedCents: 85000,
      countedCents: 85000,
      differenceCents: 0,
      withdrawnCents: 0,
      leftInDrawerCents: 85000,
      denominations,
    });
    expect((await getCashSessionDetail(id))?.denominations).toEqual(denominations);
  });

  it("needs an open shift to close", async () => {
    const w = await world();
    await expect(
      submitCashClose(w.cashier, { countedCashCents: 0 }, testDb),
    ).rejects.toBeInstanceOf(CashSessionClosedError);
    await expect(previewCashClose(w.cashier, 0, testDb)).rejects.toBeInstanceOf(
      CashSessionClosedError,
    );
  });

  it("does not close twice if the button is pressed twice", async () => {
    const w = await world();
    await openCashSession(w.cashier, { openingFloatCents: 1000 }, testDb);
    const results = await Promise.allSettled([
      submitCashClose(w.cashier, { countedCashCents: 1000 }, testDb),
      submitCashClose(w.cashier, { countedCashCents: 1000 }, testDb),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
      CashSessionClosedError,
    );
    expect(await testDb.auditLog.count({ where: { action: "CASH_SESSION_CLOSED" } })).toBe(1);
  });

  it("stops accepting movements once the shift is closed", async () => {
    const w = await world();
    await openCashSession(w.cashier, { openingFloatCents: 1000 }, testDb);
    await submitCashClose(w.cashier, { countedCashCents: 1000 }, testDb);
    await expect(
      addCashMovement(w.cashier, { type: "IN", amountCents: 100, reason: "Tarde" }, testDb),
    ).rejects.toBeInstanceOf(CashSessionClosedError);
  });
});

describe("approveCashClose", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  async function pending(w: World, counted = 1000, notes?: string) {
    const { id } = await openCashSession(w.cashier, { openingFloatCents: 1000 }, testDb);
    await submitCashClose(w.cashier, { countedCashCents: counted, notes }, testDb);
    return id;
  }

  it("lets a manager approve and leaves a trace", async () => {
    const w = await world();
    const id = await pending(w, 900, "Faltó cambio");
    await approveCashClose(w.manager, id, testDb);
    const session = await testDb.cashSession.findUniqueOrThrow({ where: { id } });
    expect(session).toMatchObject({ status: "CLOSED", approvedById: w.manager.id });
    const log = await testDb.auditLog.findFirstOrThrow({
      where: { entityId: id, action: "CASH_SESSION_APPROVED" },
    });
    expect(log.userId).toBe(w.manager.id);
    expect(log.after).toEqual({ differenceCents: -100 });
  });

  it("lets the owner approve too", async () => {
    const w = await world();
    const id = await pending(w);
    await approveCashClose(w.owner, id, testDb);
    expect((await testDb.cashSession.findUniqueOrThrow({ where: { id } })).status).toBe("CLOSED");
  });

  it("refuses cashiers and warehouse", async () => {
    const w = await world();
    const id = await pending(w);
    await expect(approveCashClose(w.cashier, id, testDb)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(approveCashClose(w.warehouse, id, testDb)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await testDb.cashSession.findUniqueOrThrow({ where: { id } })).status).toBe(
      "CLOSED_PENDING_APPROVAL",
    );
  });

  it("only approves what is waiting for approval, once", async () => {
    const w = await world();
    const id = await pending(w);
    await approveCashClose(w.manager, id, testDb);
    await expect(approveCashClose(w.manager, id, testDb)).rejects.toBeInstanceOf(
      CashSessionStateError,
    );

    // El cierre anterior dejó L 10.00 en el cajón: abrir con otro fondo pide el comentario.
    const open = await openCashSession(
      w.cashier2,
      { openingFloatCents: 0, openingNotes: "Abro sin fondo" },
      testDb,
    );
    await expect(approveCashClose(w.manager, open.id, testDb)).rejects.toBeInstanceOf(
      CashSessionStateError,
    );
    await expect(approveCashClose(w.manager, "no-existe", testDb)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("approves only once when two managers click at the same time", async () => {
    const w = await world();
    const id = await pending(w);
    const results = await Promise.allSettled([
      approveCashClose(w.manager, id, testDb),
      approveCashClose(w.owner, id, testDb),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await testDb.auditLog.count({ where: { action: "CASH_SESSION_APPROVED" } })).toBe(1);
  });
});

describe("cash queries", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("finds the open shift of a user and who has the terminal", async () => {
    const w = await world();
    expect(await getOpenSessionOf(w.cashier.id)).toBeNull();
    expect(await getTerminalStatus()).toEqual({
      terminalId: w.terminal.id,
      terminalName: "Caja 1",
      openBy: null,
      inherited: null,
    });

    await openCashSession(w.cashier, { openingFloatCents: 2500 }, testDb);
    const open = await getOpenSessionOf(w.cashier.id);
    expect(open).toMatchObject({
      userName: "cashier",
      terminalName: "Caja 1",
      status: "OPEN",
      openingFloatCents: 2500,
    });
    expect(await getOpenSessionOf(w.cashier2.id)).toBeNull();
    expect(await getTerminalStatus()).toEqual({
      terminalId: w.terminal.id,
      terminalName: "Caja 1",
      openBy: "cashier",
      inherited: null,
    });
  });

  it("lists shifts newest first, filtered by user or status, and counts the pending ones", async () => {
    const w = await world();
    await openCashSession(w.cashier, { openingFloatCents: 0 }, testDb);
    await submitCashClose(w.cashier, { countedCashCents: 0 }, testDb);
    await openCashSession(w.cashier2, { openingFloatCents: 0 }, testDb);
    await submitCashClose(w.cashier2, { countedCashCents: 0 }, testDb);
    const last = await openCashSession(w.cashier, { openingFloatCents: 0 }, testDb);

    const all = await listCashSessions({});
    expect(all.total).toBe(3);
    expect(all.rows[0]?.id).toBe(last.id);

    const mine = await listCashSessions({ userId: w.cashier2.id });
    expect(mine.rows.map((row) => row.userName)).toEqual(["cashier2"]);

    const waiting = await listCashSessions({ status: "CLOSED_PENDING_APPROVAL" });
    expect(waiting.total).toBe(2);
    expect(await countPendingApprovals()).toBe(2);

    await approveCashClose(w.manager, waiting.rows[0]!.id, testDb);
    expect(await countPendingApprovals()).toBe(1);
  });

  it("returns null for a shift that does not exist", async () => {
    await world();
    expect(await getCashSessionDetail("no-existe")).toBeNull();
  });

  it("shows the stored numbers of a closed shift even if sales change later", async () => {
    const w = await world();
    const { id } = await openCashSession(w.cashier, { openingFloatCents: 10000 }, testDb);
    await submitCashClose(w.cashier, { countedCashCents: 10000 }, testDb);
    await insertSale(w, id, {
      totalCents: 500,
      payments: [{ method: "CASH", amountCents: 500 }],
    });
    const detail = await getCashSessionDetail(id);
    expect(detail?.expectedCents).toBe(10000);
    expect(detail?.session.differenceCents).toBe(0);
  });
});
