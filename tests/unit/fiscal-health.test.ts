import { describe, expect, it } from "vitest";

import { fiscalRangeHealth } from "@/modules/fiscal/health";

// La fecha límite se guarda como el mediodía local del día (UTC−6): el 31/12/2026 son las 18:00 UTC.
// El rango vale hasta el final de ese día local: 2027-01-01T05:59:59.999Z.
const EXPIRES = new Date("2026-12-31T18:00:00.000Z");
const range = (nextNumber: number, extra: { rangeEnd?: number; expiresAt?: Date } = {}) => ({
  rangeStart: 1,
  rangeEnd: extra.rangeEnd ?? 1000,
  nextNumber,
  expiresAt: extra.expiresAt ?? EXPIRES,
});
// Las 10:00 de la mañana en Honduras = 16:00 UTC
const at = (day: string) => new Date(`${day}T16:00:00.000Z`);

describe("fiscalRangeHealth: expiry", () => {
  it("is fine with plenty of time", () => {
    // Del 1/oct 10:00 al fin del 31/dic: 91 días y 14 horas
    expect(fiscalRangeHealth(range(1), at("2026-10-01"))).toEqual({
      status: "ok",
      daysLeft: 91,
      remaining: 1000,
      usable: true,
    });
  });

  it("warns 30 days before and counts the days left", () => {
    // 19/dic 10:00 → 12 días y 14 horas
    expect(fiscalRangeHealth(range(1), at("2026-12-19"))).toMatchObject({
      status: "expiring",
      daysLeft: 12,
      usable: true,
    });
    // 1/dic 10:00 → 30 días y 14 horas: justo el límite del aviso
    expect(fiscalRangeHealth(range(1), at("2026-12-01")).status).toBe("expiring");
    // 30/nov 10:00 → 31 días y 14 horas: todavía no
    expect(fiscalRangeHealth(range(1), at("2026-11-30")).status).toBe("ok");
  });

  it("still works on the last day, until it ends", () => {
    // 31/dic 14:00 hora local = 20:00 UTC: quedan casi 10 horas
    const lastDay = fiscalRangeHealth(range(1), new Date("2026-12-31T20:00:00.000Z"));
    expect(lastDay).toMatchObject({ status: "expiring", daysLeft: 0, usable: true });
    // Un milisegundo antes de que termine el día local
    expect(fiscalRangeHealth(range(1), new Date("2027-01-01T05:59:59.999Z")).usable).toBe(true);
  });

  it("expires when the local day is over", () => {
    const expired = fiscalRangeHealth(range(1), new Date("2027-01-01T06:00:00.000Z"));
    expect(expired).toMatchObject({ status: "expired", daysLeft: -1, usable: false });
    expect(fiscalRangeHealth(range(1), at("2027-02-15"))).toMatchObject({
      status: "expired",
      usable: false,
    });
  });
});

describe("fiscalRangeHealth: numbers left", () => {
  const early = at("2026-10-01");

  it("counts what remains from the next number to the end", () => {
    expect(fiscalRangeHealth(range(1), early).remaining).toBe(1000);
    expect(fiscalRangeHealth(range(401), early).remaining).toBe(600);
    expect(fiscalRangeHealth(range(1000), early).remaining).toBe(1);
  });

  it("warns at the greater of 50 numbers or 10 % of the range", () => {
    // Rango de 1000: 10 % = 100
    expect(fiscalRangeHealth(range(901), early)).toMatchObject({ status: "low", remaining: 100 });
    expect(fiscalRangeHealth(range(900), early)).toMatchObject({ status: "ok", remaining: 101 });
    // Rango de 100: 10 % = 10, vale el piso de 50
    expect(fiscalRangeHealth(range(51, { rangeEnd: 100 }), early)).toMatchObject({
      status: "low",
      remaining: 50,
    });
    expect(fiscalRangeHealth(range(50, { rangeEnd: 100 }), early).status).toBe("ok");
    // Rango de 2000: 10 % = 200
    expect(fiscalRangeHealth(range(1801, { rangeEnd: 2000 }), early).status).toBe("low");
    expect(fiscalRangeHealth(range(1800, { rangeEnd: 2000 }), early).status).toBe("ok");
  });

  it("is exhausted after the last number, and that beats any other warning", () => {
    const spent = fiscalRangeHealth(range(1001), at("2026-12-19"));
    expect(spent).toEqual({ status: "exhausted", daysLeft: 12, remaining: 0, usable: false });
    expect(fiscalRangeHealth(range(1001), at("2027-03-01")).status).toBe("exhausted");
  });

  it("reports an expired range before a low one", () => {
    expect(fiscalRangeHealth(range(990), at("2027-03-01")).status).toBe("expired");
  });

  it("reports the expiry warning before the low-numbers one", () => {
    expect(fiscalRangeHealth(range(990), at("2026-12-19")).status).toBe("expiring");
  });
});
