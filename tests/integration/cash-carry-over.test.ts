import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { CashFloatLockedError, ValidationError } from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import { getTerminalStatus } from "@/modules/cash/queries";
import {
  addCashMovement,
  approveCashClose,
  openCashSession,
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
  const manager = await make("manager", "MANAGER");
  const cashier = await make("cashier", "CASHIER");
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const terminal = await testDb.terminal.create({
    data: { name: "Caja 1", locationId: location.id },
  });
  return { manager, cashier, location, terminal };
}

type World = Awaited<ReturnType<typeof world>>;

let saleSeq = 0;

/** Una venta en efectivo exacto, directo en la base: este módulo solo lee lo que dejaron las ventas. */
async function insertCashSale(w: World, cashSessionId: string, totalCents: number) {
  saleSeq += 1;
  await testDb.sale.create({
    data: {
      number: `T-CARRY-${saleSeq}`,
      clientRequestId: `carry-${saleSeq}`,
      status: "COMPLETED",
      locationId: w.location.id,
      terminalId: w.terminal.id,
      cashSessionId,
      sellerId: w.cashier.id,
      subtotalCents: totalCents,
      taxCents: 0,
      totalCents,
      paidCents: totalCents,
      changeCents: 0,
      payments: { create: [{ method: "CASH", amountCents: totalCents, cashSessionId }] },
    },
  });
}

describe("withdrawal when closing and the inherited float", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  /** Fondo 500.00 + una venta de 8,000.00 en efectivo: lo esperado es 8,500.00. */
  async function shiftWithEightThousandInSales(w: World) {
    const { id } = await openCashSession(w.cashier, { openingFloatCents: 50000 }, testDb);
    await insertCashSale(w, id, 800000);
    return id;
  }

  it("keeps in the drawer what is not withdrawn, and hands that over to the next opening", async () => {
    const w = await world();
    const id = await shiftWithEightThousandInSales(w);
    await submitCashClose(w.cashier, { countedCashCents: 850000, withdrawnCents: 700000 }, testDb);

    const session = await testDb.cashSession.findUniqueOrThrow({ where: { id } });
    expect(session).toMatchObject({ countedCashCents: 850000, withdrawnCents: 700000 });
    const closing = await testDb.auditLog.findFirstOrThrow({
      where: { entityId: id, action: "CASH_SESSION_CLOSED" },
    });
    expect(closing.after).toMatchObject({ withdrawnCents: 700000, leftInDrawerCents: 150000 });

    const status = await getTerminalStatus();
    expect(status.inherited).toMatchObject({ cents: 150000, closedByName: "cashier" });

    const { id: nextId } = await openCashSession(w.cashier, { openingFloatCents: 150000 }, testDb);
    const next = await testDb.cashSession.findUniqueOrThrow({ where: { id: nextId } });
    expect(next).toMatchObject({
      openingFloatCents: 150000,
      inheritedFloatCents: 150000,
      openingNotes: null,
    });
    expect(await testDb.auditLog.count({ where: { action: "CASH_FLOAT_ADJUSTED" } })).toBe(0);
  });

  it("withdraws nothing when the cashier does not say so", async () => {
    const w = await world();
    const id = await shiftWithEightThousandInSales(w);
    await submitCashClose(w.cashier, { countedCashCents: 850000 }, testDb);
    expect((await testDb.cashSession.findUniqueOrThrow({ where: { id } })).withdrawnCents).toBe(0);
    expect((await getTerminalStatus()).inherited?.cents).toBe(850000);
  });

  it("does not let the withdrawal change what the system expected", async () => {
    const w = await world();
    const id = await shiftWithEightThousandInSales(w);
    await expect(
      submitCashClose(w.cashier, { countedCashCents: 850000, withdrawnCents: 850000 }, testDb),
    ).resolves.toEqual({ id, expectedCents: 850000, differenceCents: 0 });
  });

  it("refuses to withdraw more than was counted and leaves the shift open", async () => {
    const w = await world();
    const id = await shiftWithEightThousandInSales(w);
    await expect(
      submitCashClose(w.cashier, { countedCashCents: 850000, withdrawnCents: 850001 }, testDb),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await testDb.cashSession.findUniqueOrThrow({ where: { id } })).status).toBe("OPEN");
  });

  it("hands over what was counted, not what was expected: a shortage does not carry over", async () => {
    const w = await world();
    await shiftWithEightThousandInSales(w);
    await submitCashClose(
      w.cashier,
      { countedCashCents: 840000, withdrawnCents: 700000, notes: "Faltaron L 100.00" },
      testDb,
    );
    expect((await getTerminalStatus()).inherited?.cents).toBe(140000);
  });

  it("offers the float of a closing that still waits for approval and of an approved one", async () => {
    const w = await world();
    await shiftWithEightThousandInSales(w);
    const { id } = await submitCashClose(
      w.cashier,
      { countedCashCents: 850000, withdrawnCents: 700000 },
      testDb,
    );
    expect((await getTerminalStatus()).inherited?.cents).toBe(150000);
    await approveCashClose(w.manager, id, testDb);
    expect((await getTerminalStatus()).inherited?.cents).toBe(150000);
  });

  it("offers nothing on a terminal that was never closed", async () => {
    const w = await world();
    expect((await getTerminalStatus()).inherited).toBeNull();
    const { id } = await openCashSession(w.cashier, { openingFloatCents: 12345 }, testDb);
    const session = await testDb.cashSession.findUniqueOrThrow({ where: { id } });
    expect(session.inheritedFloatCents).toBeNull();
  });

  it("does not inherit from a closing made before the withdrawal existed", async () => {
    const w = await world();
    await testDb.cashSession.create({
      data: {
        terminalId: w.terminal.id,
        userId: w.cashier.id,
        openingFloatCents: 0,
        status: "CLOSED",
        closedAt: new Date(),
        expectedCashCents: 90000,
        countedCashCents: 90000,
        differenceCents: 0,
      },
    });
    expect((await getTerminalStatus()).inherited).toBeNull();
    await expect(
      openCashSession(w.cashier, { openingFloatCents: 20000 }, testDb),
    ).resolves.toHaveProperty("id");
  });

  it("does not let the previous balance be changed: it opens with exactly what was left", async () => {
    const w = await world();
    await shiftWithEightThousandInSales(w);
    await submitCashClose(w.cashier, { countedCashCents: 850000, withdrawnCents: 700000 }, testDb);

    for (const openingFloatCents of [0, 120000, 150001]) {
      await expect(
        openCashSession(w.cashier, { openingFloatCents }, testDb),
      ).rejects.toBeInstanceOf(CashFloatLockedError);
    }
    // Un comentario no abre la puerta: ya no existe esa salida
    await expect(
      openCashSession(
        w.cashier,
        { openingFloatCents: 120000, openingNotes: "Se llevaron L 300.00 para el banco" },
        testDb,
      ),
    ).rejects.toBeInstanceOf(CashFloatLockedError);
    expect(await testDb.cashSession.count({ where: { status: "OPEN" } })).toBe(0);

    const { id } = await openCashSession(w.cashier, { openingFloatCents: 150000 }, testDb);
    expect(await testDb.cashSession.findUniqueOrThrow({ where: { id } })).toMatchObject({
      openingFloatCents: 150000,
      inheritedFloatCents: 150000,
      openingNotes: null,
    });
    expect(await testDb.auditLog.count({ where: { action: "CASH_FLOAT_ADJUSTED" } })).toBe(0);
  });

  it("fixes a drawer that does not match the previous balance with a movement and its reason", async () => {
    const w = await world();
    await shiftWithEightThousandInSales(w);
    await submitCashClose(w.cashier, { countedCashCents: 850000, withdrawnCents: 700000 }, testDb);
    const { id } = await openCashSession(w.cashier, { openingFloatCents: 150000 }, testDb);

    await addCashMovement(
      w.cashier,
      { type: "OUT", amountCents: 30000, reason: "Se llevaron L 300.00 para el banco" },
      testDb,
    );
    const movement = await testDb.cashMovement.findFirstOrThrow({ where: { cashSessionId: id } });
    expect(movement).toMatchObject({
      type: "OUT",
      amountCents: 30000,
      reason: "Se llevaron L 300.00 para el banco",
      userId: w.cashier.id,
    });
    // Lo esperado ya lo descuenta; el fondo del turno sigue siendo el saldo anterior
    const [detail] = await testDb.cashSession.findMany({ where: { id } });
    expect(detail?.openingFloatCents).toBe(150000);
    await expect(
      submitCashClose(w.cashier, { countedCashCents: 120000 }, testDb),
    ).resolves.toMatchObject({ expectedCents: 120000, differenceCents: 0 });
  });

  it("lets any float open after everything was withdrawn, still noting what was inherited", async () => {
    const w = await world();
    await shiftWithEightThousandInSales(w);
    await submitCashClose(w.cashier, { countedCashCents: 850000, withdrawnCents: 850000 }, testDb);
    expect((await getTerminalStatus()).inherited?.cents).toBe(0);
    const { id } = await openCashSession(w.cashier, { openingFloatCents: 30000 }, testDb);
    expect(await testDb.cashSession.findUniqueOrThrow({ where: { id } })).toMatchObject({
      openingFloatCents: 30000,
      inheritedFloatCents: 0,
    });
  });
});
