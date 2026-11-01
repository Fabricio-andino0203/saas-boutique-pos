import { describe, expect, it } from "vitest";

import { PLATFORM_AUDIT_ACTIONS } from "@/modules/platform/audit";
import {
  BACKUP_FRESH_MS,
  backupStateOf,
  controlDatabaseName,
  formatBytes,
  needsAttention,
} from "@/modules/platform/backups";
import { planSchema } from "@/modules/platform/billing";
import { hasManagedRole } from "@/modules/platform/restore";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-11-03T12:00:00.000Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

describe("backupStateOf", () => {
  const old = ago(24 * 10);

  it("is ok with a good backup from the last 26 hours, including the exact boundary", () => {
    expect(backupStateOf({ lastOkAt: ago(1), lastFailureAt: null, createdAt: old }, NOW)).toBe(
      "ok",
    );
    expect(backupStateOf({ lastOkAt: ago(26), lastFailureAt: null, createdAt: old }, NOW)).toBe(
      "ok",
    );
    expect(BACKUP_FRESH_MS).toBe(26 * HOUR);
  });

  it("is stale once the last good backup is older than 26 hours", () => {
    expect(
      backupStateOf(
        { lastOkAt: new Date(ago(26).getTime() - 1), lastFailureAt: null, createdAt: old },
        NOW,
      ),
    ).toBe("stale");
  });

  it("is failed when the latest attempt failed and no good backup came after it", () => {
    expect(backupStateOf({ lastOkAt: ago(30), lastFailureAt: ago(2), createdAt: old }, NOW)).toBe(
      "failed",
    );
    // Nunca hubo uno bueno y ya falló: «falló» manda sobre «nunca».
    expect(backupStateOf({ lastOkAt: null, lastFailureAt: ago(2), createdAt: old }, NOW)).toBe(
      "failed",
    );
  });

  it("recovers: a failure older than the last good backup does not count", () => {
    expect(backupStateOf({ lastOkAt: ago(3), lastFailureAt: ago(20), createdAt: old }, NOW)).toBe(
      "ok",
    );
    expect(backupStateOf({ lastOkAt: ago(30), lastFailureAt: ago(40), createdAt: old }, NOW)).toBe(
      "stale",
    );
  });

  it("is pending for a new business and never for an old one without any good backup", () => {
    expect(backupStateOf({ lastOkAt: null, lastFailureAt: null, createdAt: ago(5) }, NOW)).toBe(
      "pending",
    );
    expect(backupStateOf({ lastOkAt: null, lastFailureAt: null, createdAt: ago(26) }, NOW)).toBe(
      "pending",
    );
    expect(backupStateOf({ lastOkAt: null, lastFailureAt: null, createdAt: ago(27) }, NOW)).toBe(
      "never",
    );
  });
});

describe("needsAttention", () => {
  it("asks for action on stale, failed and never — not on ok or pending", () => {
    expect(
      (["ok", "stale", "failed", "never", "pending"] as const).filter((state) =>
        needsAttention(state),
      ),
    ).toEqual(["stale", "failed", "never"]);
  });
});

describe("formatBytes", () => {
  it("shows bytes, KB, MB and GB with one decimal", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(125_616)).toBe("122.7 KB");
    expect(formatBytes(2_740_384)).toBe("2.6 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
  });
});

describe("controlDatabaseName", () => {
  it("takes the database name from the control URL, as the backup service knows it", () => {
    expect(
      controlDatabaseName({
        CONTROL_DATABASE_URL: "postgresql://u:p@db:5432/boutique_pos_control?schema=public",
      }),
    ).toBe("boutique_pos_control");
  });

  it("falls back to the default name and rejects a name that is not a safe identifier", () => {
    expect(controlDatabaseName({})).toBe("boutique_pos_control");
    expect(() =>
      controlDatabaseName({ CONTROL_DATABASE_URL: "postgresql://u:p@db/Mal-Nombre" }),
    ).toThrow();
  });
});

describe("hasManagedRole", () => {
  it("is true only for a business created by the automatic sign-up (t_<id> with a role of the same name)", () => {
    expect(hasManagedRole({ dbName: "t_abc123", dbRole: "t_abc123" })).toBe(true);
    // El negocio #1 usa la cuenta principal del servidor: sus permisos no se tocan.
    expect(hasManagedRole({ dbName: "boutique_pos", dbRole: "boutique" })).toBe(false);
    expect(hasManagedRole({ dbName: "t_abc123", dbRole: "otro" })).toBe(false);
    expect(hasManagedRole({ dbName: null, dbRole: null })).toBe(false);
  });
});

describe("plan backup retention", () => {
  const base = {
    name: "Plan",
    priceCents: 1000,
    interval: "MONTHLY",
    limits: { users: null, products: null, terminals: null, locations: null },
    features: [],
    trialDays: 14,
    sortOrder: 0,
  };

  it("defaults to 30 days and accepts 7 to 3650", () => {
    expect(planSchema.parse(base).backupRetentionDays).toBe(30);
    expect(planSchema.parse({ ...base, backupRetentionDays: 7 }).backupRetentionDays).toBe(7);
    expect(planSchema.parse({ ...base, backupRetentionDays: 3650 }).backupRetentionDays).toBe(3650);
  });

  it("rejects less than a week, more than ten years and fractions", () => {
    for (const bad of [6, 0, -1, 3651, 7.5, Number.NaN]) {
      expect(planSchema.safeParse({ ...base, backupRetentionDays: bad }).success).toBe(false);
    }
  });
});

describe("audit trail", () => {
  it("names the new backup actions", () => {
    expect(PLATFORM_AUDIT_ACTIONS).toEqual(
      expect.arrayContaining(["BACKUP_REQUESTED", "TENANT_RELINKED"]),
    );
  });
});
