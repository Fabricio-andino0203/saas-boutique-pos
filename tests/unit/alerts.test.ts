import { describe, expect, it } from "vitest";

import { platformMessages } from "@/config/messages.platform.es";
import { describeAlert } from "@/modules/platform/alert-text";
import { ALERT_CODES, needsAction, type PlatformAlert } from "@/modules/platform/alerts";
import { parseReplacedName } from "@/modules/platform/retired";
import { nearLimit, USAGE_METRICS } from "@/modules/platform/usage";

describe("parseReplacedName", () => {
  it("reads the business and the moment (UTC) out of the name a restore gives to the database it sets aside", () => {
    const parsed = parseReplacedName("z_replaced_t_cmvxvvwn40000qcnfk0ad4zjp_20261101134740");
    expect(parsed?.tenantId).toBe("cmvxvvwn40000qcnfk0ad4zjp");
    expect(parsed?.at.toISOString()).toBe("2026-11-01T13:47:40.000Z");
  });

  it("rejects anything that is not exactly that shape", () => {
    for (const name of [
      "z_archived_cmvxvvwn40000qcnfk0ad4zjp",
      "t_cmvxvvwn40000qcnfk0ad4zjp",
      "z_replaced_cmvxvvwn40000qcnfk0ad4zjp_20261101134740", // falta la «t_»
      "z_replaced_t_abc_2026", // fecha corta
      "z_replaced_t_abc_20261101134740_x",
      "z_replaced_t_ABC_20261101134740",
      "z_replaced_t_abc_20261301134740", // mes 13
      "",
    ]) {
      expect(parseReplacedName(name), name).toBeNull();
    }
  });
});

describe("nearLimit", () => {
  it("is true from 90 % of a cap and never for an unlimited or zero cap", () => {
    expect(nearLimit(9, 10)).toBe(true);
    expect(nearLimit(10, 10)).toBe(true);
    expect(nearLimit(11, 10)).toBe(true);
    expect(nearLimit(8, 10)).toBe(false);
    expect(nearLimit(500, null)).toBe(false);
    expect(nearLimit(0, 0)).toBe(false);
  });
});

describe("usage whitelist", () => {
  it("lists exactly the seven allowed measures, all counts or dates", () => {
    expect([...USAGE_METRICS]).toEqual([
      "activeUsers",
      "products",
      "sales30d",
      "lastSaleAt",
      "lastLoginAt",
      "databaseMb",
      "schemaVersion",
    ]);
  });
});

describe("alerts", () => {
  it("only fails the check for grave alerts and warnings, not for information", () => {
    const alert = (severity: PlatformAlert["severity"]): PlatformAlert => ({
      code: "near_limit",
      severity,
    });
    expect(needsAction([])).toBe(false);
    expect(needsAction([alert("info")])).toBe(false);
    expect(needsAction([alert("info"), alert("warning")])).toBe(true);
    expect(needsAction([alert("critical")])).toBe(true);
  });

  it("has a message for every code, and none of them leaves a placeholder unfilled", () => {
    for (const code of ALERT_CODES) {
      expect(platformMessages.alerts.messages[code], code).toBeTruthy();
      const { text } = describeAlert({
        code,
        severity: "warning",
        slug: "tienda-a",
        name: "Tienda A",
        detail: "users",
      });
      expect(text, code).not.toMatch(/\{(who|detail)\}/);
    }
  });

  it("names the business, or the control database, and links where it can be handled", () => {
    expect(
      describeAlert({
        code: "backup_failed",
        severity: "critical",
        slug: "tienda-a",
        name: "Tienda A",
      }),
    ).toEqual({
      text: "El último respaldo de Tienda A falló y no hay uno bueno reciente.",
      href: "/negocios/tienda-a",
    });
    expect(describeAlert({ code: "backup_stale", severity: "warning", detail: "control" })).toEqual(
      {
        text: "El último respaldo bueno de la base central de la plataforma tiene más de 26 horas.",
        href: "/respaldos",
      },
    );
    expect(
      describeAlert({
        code: "near_limit",
        severity: "info",
        slug: "tienda-a",
        name: "Tienda A",
        detail: "users",
      }).text,
    ).toBe("Tienda A usa casi todo el tope de usuarios de su plan.");
    expect(describeAlert({ code: "server_behind", severity: "warning", detail: "2" }).href).toBe(
      "/negocios/revision",
    );
  });
});
