import { describe, expect, it } from "vitest";

import { generateTemporaryPassword } from "@/lib/tenancy/support-reader";
import { PLATFORM_AUDIT_ACTIONS } from "@/modules/platform/audit";
import { isOpen, SUPPORT_MINUTES } from "@/modules/platform/support";

const NOW = new Date("2026-11-03T12:00:00.000Z");

describe("isOpen", () => {
  it("is open only while nobody closed it and it has not expired", () => {
    expect(isOpen({ endedAt: null, expiresAt: new Date(NOW.getTime() + 1) }, NOW)).toBe(true);
    expect(isOpen({ endedAt: null, expiresAt: NOW }, NOW)).toBe(false); // vence justo ahora
    expect(isOpen({ endedAt: null, expiresAt: new Date(NOW.getTime() - 1) }, NOW)).toBe(false);
    expect(isOpen({ endedAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000) }, NOW)).toBe(false);
  });
});

describe("support session durations", () => {
  it("are short, and never beyond the two hours the database allows", () => {
    expect([...SUPPORT_MINUTES]).toEqual([15, 30, 60, 120]);
    expect(Math.max(...SUPPORT_MINUTES)).toBeLessThanOrEqual(120);
  });
});

describe("generateTemporaryPassword", () => {
  it("makes 16 characters without the ones that are confused when dictated", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(16);
      expect(password).toMatch(/^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
      expect(password).not.toMatch(/[0O1lIo]/);
      seen.add(password);
    }
    expect(seen.size).toBe(200);
  });
});

describe("audit trail", () => {
  it("names every support action", () => {
    expect(PLATFORM_AUDIT_ACTIONS).toEqual(
      expect.arrayContaining([
        "SUPPORT_SESSION_OPENED",
        "SUPPORT_SESSION_CLOSED",
        "SUPPORT_VIEWED",
        "SUPPORT_USER_UNLOCKED",
        "SUPPORT_PASSWORD_RESET",
      ]),
    );
  });
});
