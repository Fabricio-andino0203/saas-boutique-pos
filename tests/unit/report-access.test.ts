import { describe, expect, it } from "vitest";

import { formatHour, formatPeriodKey } from "@/modules/reports/labels";
import { reportAccess } from "@/modules/reports/access";

describe("reportAccess", () => {
  it("lets the owner and the manager see everything, costs included", () => {
    for (const role of ["OWNER", "MANAGER"] as const) {
      expect(reportAccess({ id: "u1", role })).toEqual({
        scope: {},
        withCosts: true,
        seesEveryone: true,
      });
    }
  });

  it("limits a cashier to their own sales and hides every cost", () => {
    expect(reportAccess({ id: "cajero-7", role: "CASHIER" })).toEqual({
      scope: { onlySellerId: "cajero-7" },
      withCosts: false,
      seesEveryone: false,
    });
  });

  it("is the safe choice for any role that is not financial", () => {
    // El almacén no ve reportes, pero si alguna vez llegara a consultar, nunca vería costos ni ventas ajenas
    expect(reportAccess({ id: "a1", role: "WAREHOUSE" })).toEqual({
      scope: { onlySellerId: "a1" },
      withCosts: false,
      seesEveryone: false,
    });
  });
});

describe("report labels", () => {
  it("formats days, months and hours", () => {
    expect(formatPeriodKey("2026-10-27")).toBe("27/10/2026");
    expect(formatPeriodKey("2026-01")).toBe("Enero 2026");
    expect(formatPeriodKey("2026-12")).toBe("Diciembre 2026");
    expect(formatPeriodKey("otra cosa")).toBe("otra cosa");
    expect(formatHour(9)).toBe("09:00");
    expect(formatHour(17)).toBe("17:00");
  });
});
