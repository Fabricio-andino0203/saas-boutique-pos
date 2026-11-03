import { describe, expect, it } from "vitest";

import {
  PENDING_LOOKBACK_MONTHS,
  dueDateKey,
  isPeriod,
  nextPeriod,
  pendingPeriods,
  periodOf,
  periodStart,
  periodsBetween,
  previousPeriod,
} from "@/modules/finance/periods";

describe("periods", () => {
  it("recognizes only real year-month texts", () => {
    expect(["2026-11", "2026-01", "2026-12"].every(isPeriod)).toBe(true);
    expect(["2026-13", "2026-00", "2026-1", "26-11", "2026-11-01", ""].some(isPeriod)).toBe(false);
  });

  it("takes the month in Honduras time, not in UTC", () => {
    // 1 de noviembre a las 23:30 en Tegucigalpa (UTC−6) ya es 2 de noviembre en UTC.
    expect(periodOf(new Date("2026-11-02T05:30:00Z"))).toBe("2026-11");
    // 31 de octubre a las 20:00 en Tegucigalpa es 1 de noviembre en UTC: sigue siendo octubre allá.
    expect(periodOf(new Date("2026-11-01T02:00:00Z"))).toBe("2026-10");
  });

  it("walks months across a year boundary", () => {
    expect(nextPeriod("2026-11")).toBe("2026-12");
    expect(nextPeriod("2026-12")).toBe("2027-01");
    expect(previousPeriod("2027-01")).toBe("2026-12");
    expect(previousPeriod("2026-03")).toBe("2026-02");
  });

  it("lists the months between two, inclusive, oldest first", () => {
    expect(periodsBetween("2026-11", "2027-02")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
    expect(periodsBetween("2026-11", "2026-11")).toEqual(["2026-11"]);
    expect(periodsBetween("2026-12", "2026-11")).toEqual([]);
  });

  it("stores a month as noon of its first local day", () => {
    expect(periodStart("2026-11").toISOString()).toBe("2026-11-01T18:00:00.000Z");
  });

  it("builds the due date of a month", () => {
    expect(dueDateKey("2026-11", 5)).toBe("2026-11-05");
    expect(dueDateKey("2026-02", 28)).toBe("2026-02-28");
  });
});

describe("pendingPeriods", () => {
  const none = new Set<string>();

  it("is the current month for a cost that starts this month", () => {
    expect(
      pendingPeriods({ startsOn: "2026-11", endsOn: null, paid: none, current: "2026-11" }),
    ).toEqual(["2026-11"]);
  });

  it("is nothing before the cost starts", () => {
    expect(
      pendingPeriods({ startsOn: "2026-12", endsOn: null, paid: none, current: "2026-11" }),
    ).toEqual([]);
  });

  it("leaves out the months that already have a payment", () => {
    expect(
      pendingPeriods({
        startsOn: "2026-09",
        endsOn: null,
        paid: new Set(["2026-09", "2026-11"]),
        current: "2026-11",
      }),
    ).toEqual(["2026-10"]);
  });

  it("does not go back further than the look-back window", () => {
    const result = pendingPeriods({
      startsOn: "2024-01",
      endsOn: null,
      paid: none,
      current: "2026-11",
    });
    expect(result).toHaveLength(PENDING_LOOKBACK_MONTHS + 1);
    expect(result[0]).toBe("2026-05");
    expect(result[result.length - 1]).toBe("2026-11");
  });

  it("stops at the last month of a cost that already ended", () => {
    expect(
      pendingPeriods({ startsOn: "2026-08", endsOn: "2026-09", paid: none, current: "2026-11" }),
    ).toEqual(["2026-08", "2026-09"]);
  });

  it("still counts the current month for a cost that ends later", () => {
    expect(
      pendingPeriods({ startsOn: "2026-10", endsOn: "2027-06", paid: none, current: "2026-11" }),
    ).toEqual(["2026-10", "2026-11"]);
  });
});
