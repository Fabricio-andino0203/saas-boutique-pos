import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import { openCashSession } from "@/modules/cash/service";
import { logCancelledTicket } from "@/modules/sales/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

type Actor = { id: string; role: Role };

async function world() {
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: username, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  const cashier = await make("cashier", "CASHIER");
  const warehouse = await make("warehouse", "WAREHOUSE");
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  await testDb.terminal.create({ data: { name: "Caja 1", locationId: location.id } });
  return { cashier, warehouse };
}

const lines = [
  { productName: "Blusa de lino", variantLabel: "M · Azul", quantity: 2, unitPriceCents: 45000 },
  { productName: "Pantalón", variantLabel: "", quantity: 1, unitPriceCents: 80000 },
];

describe("cancelling a ticket before it is charged", () => {
  beforeEach(resetDatabase);
  afterAll(async () => {
    await db.$disconnect();
    await closeDatabase();
  });

  it("leaves who, why and what the ticket had, tied to the open shift", async () => {
    const w = await world();
    const { id: sessionId } = await openCashSession(w.cashier, { openingFloatCents: 0 }, testDb);

    await logCancelledTicket(
      w.cashier,
      { reason: "El cliente se arrepintió", source: "current", lines },
      testDb,
    );

    const entry = await testDb.auditLog.findFirstOrThrow({ where: { action: "TICKET_CANCELLED" } });
    expect(entry).toMatchObject({
      userId: w.cashier.id,
      entityType: "CashSession",
      entityId: sessionId,
      reason: "El cliente se arrepintió",
      after: { source: "current", units: 3, grossCents: 170000, lines },
    });
  });

  it("also records a held ticket that is discarded, and works without an open shift", async () => {
    const w = await world();
    await logCancelledTicket(
      w.cashier,
      { reason: "Ya no vino por él", source: "parked", lines: lines.slice(0, 1) },
      testDb,
    );
    const entry = await testDb.auditLog.findFirstOrThrow({ where: { action: "TICKET_CANCELLED" } });
    expect(entry).toMatchObject({
      entityType: "User",
      entityId: w.cashier.id,
      after: { source: "parked", units: 2, grossCents: 90000 },
    });
  });

  it("does not accept a missing reason, an empty ticket or nonsense amounts", async () => {
    const w = await world();
    const attempts = [
      { reason: "  ", source: "current", lines },
      { reason: "ab", source: "current", lines },
      { reason: "Sin prendas", source: "current", lines: [] },
      { reason: "Cantidad cero", source: "current", lines: [{ ...lines[0], quantity: 0 }] },
      {
        reason: "Precio negativo",
        source: "current",
        lines: [{ ...lines[0], unitPriceCents: -1 }],
      },
      { reason: "Otro origen", source: "elsewhere", lines },
    ];
    for (const input of attempts) {
      await expect(logCancelledTicket(w.cashier, input, testDb)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    expect(await testDb.auditLog.count({ where: { action: "TICKET_CANCELLED" } })).toBe(0);
  });

  it("is only for people who can sell", async () => {
    const w = await world();
    await expect(
      logCancelledTicket(w.warehouse, { reason: "No vende", source: "current", lines }, testDb),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
