import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { getInvoicingState } from "@/modules/fiscal/alerts";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const closeAll = async () => {
  await db.$disconnect();
  await closeDatabase();
};

const DAY = 86_400_000;

async function world() {
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const terminal = await testDb.terminal.create({
    data: { name: "Caja 1", locationId: location.id },
  });
  const other = await testDb.terminal.create({ data: { name: "Caja 2", locationId: location.id } });
  return { terminal, other };
}

type RangeExtra = Partial<{
  prefix: string;
  rangeEnd: number;
  nextNumber: number;
  expiresAt: Date;
  isActive: boolean;
  terminalId: string | null;
  documentType: "INVOICE" | "CREDIT_NOTE";
}>;

const range = (extra: RangeExtra) =>
  testDb.fiscalRange.create({
    data: {
      documentType: "INVOICE",
      terminalId: null,
      cai: "ABC123-CAI",
      prefix: "000-001-01-",
      rangeStart: 1,
      rangeEnd: 1000,
      nextNumber: 1,
      expiresAt: new Date(Date.now() + 120 * DAY),
      ...extra,
    },
  });

describe("getInvoicingState", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("has no alerts and no invoicing when there is no active range (tickets only)", async () => {
    const w = await world();
    expect(await getInvoicingState(w.terminal.id)).toEqual({ available: false, alerts: [] });
  });

  it("is available and quiet with a healthy range", async () => {
    const w = await world();
    await range({});
    expect(await getInvoicingState(w.terminal.id)).toEqual({ available: true, alerts: [] });
  });

  it("warns about a range that expires soon but keeps invoicing", async () => {
    const w = await world();
    const soon = await range({ expiresAt: new Date(Date.now() + 12 * DAY) });
    const state = await getInvoicingState(w.terminal.id);
    expect(state.available).toBe(true);
    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0]).toMatchObject({
      rangeId: soon.id,
      prefix: "000-001-01-",
      status: "expiring",
      terminalName: null,
      usable: true,
    });
    expect(state.alerts[0]?.daysLeft).toBeGreaterThanOrEqual(11);
    expect(state.alerts[0]?.daysLeft).toBeLessThanOrEqual(13);
  });

  it("warns when few numbers are left", async () => {
    const w = await world();
    await range({ nextNumber: 951 });
    const state = await getInvoicingState(w.terminal.id);
    expect(state.available).toBe(true);
    expect(state.alerts[0]).toMatchObject({ status: "low", remaining: 50 });
  });

  it("stops invoicing with an expired or exhausted range", async () => {
    const w = await world();
    const expired = await range({ expiresAt: new Date(Date.now() - 3 * DAY) });
    expect(await getInvoicingState(w.terminal.id)).toMatchObject({
      available: false,
      alerts: [{ rangeId: expired.id, status: "expired", usable: false }],
    });
    await testDb.fiscalRange.deleteMany();
    await range({ nextNumber: 1001 });
    expect(await getInvoicingState(w.terminal.id)).toMatchObject({
      available: false,
      alerts: [{ status: "exhausted", remaining: 0 }],
    });
  });

  it("uses the terminal's own range before the general one, like the issuer does", async () => {
    const w = await world();
    await range({ prefix: "G-" });
    await range({ prefix: "T1-", terminalId: w.terminal.id, nextNumber: 1001 });
    const state = await getInvoicingState(w.terminal.id);
    // Con el rango propio agotado no se puede facturar, aunque el general esté sano
    expect(state.available).toBe(false);
    expect(state.alerts.map((a) => [a.prefix, a.status, a.terminalName])).toEqual([
      ["T1-", "exhausted", "Caja 1"],
    ]);
  });

  it("ignores inactive ranges, other terminals and other document types", async () => {
    const w = await world();
    await range({ prefix: "OFF-", isActive: false, nextNumber: 1001 });
    await range({ prefix: "C2-", terminalId: w.other.id, nextNumber: 1001 });
    await range({ prefix: "NC-", documentType: "CREDIT_NOTE", nextNumber: 1001 });
    expect(await getInvoicingState(w.terminal.id)).toEqual({ available: false, alerts: [] });
  });
});
