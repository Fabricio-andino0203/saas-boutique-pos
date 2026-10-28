import { describe, expect, it } from "vitest";

import { fillHours } from "@/modules/reports/dashboard";

describe("fillHours", () => {
  it("gives a row for every business hour, with zeros where nothing sold", () => {
    const rows = fillHours([{ hour: 10, tickets: 2, salesCents: 5000 }]);
    expect(rows).toHaveLength(13);
    expect(rows[0]).toEqual({ hour: 8, tickets: 0, salesCents: 0 });
    expect(rows[2]).toEqual({ hour: 10, tickets: 2, salesCents: 5000 });
    expect(rows[12]).toEqual({ hour: 20, tickets: 0, salesCents: 0 });
  });

  it("widens the range for a sale outside business hours instead of dropping it", () => {
    const rows = fillHours([
      { hour: 6, tickets: 1, salesCents: 100 },
      { hour: 22, tickets: 1, salesCents: 200 },
    ]);
    expect(rows[0]?.hour).toBe(6);
    expect(rows[rows.length - 1]?.hour).toBe(22);
    expect(rows.reduce((sum, row) => sum + row.salesCents, 0)).toBe(300);
  });

  it("works with no sales at all", () => {
    const rows = fillHours([]);
    expect(rows).toHaveLength(13);
    expect(rows.every((row) => row.salesCents === 0 && row.tickets === 0)).toBe(true);
  });
});
