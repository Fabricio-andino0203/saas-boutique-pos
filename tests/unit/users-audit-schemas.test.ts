import { describe, expect, it } from "vitest";

import { messages } from "@/config/messages.es";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { parseAuditFilters } from "@/modules/audit/schemas";
import {
  createUserSchema,
  resetPasswordSchema,
  resetPinSchema,
  updateUserSchema,
} from "@/modules/users/schemas";

const valid = {
  name: "  Ana Pérez ",
  username: "  Ana.Perez ",
  role: "CASHIER",
  password: "Clave-2026",
  pin: "",
};

describe("createUserSchema", () => {
  it("trims, lowercases the username and treats an empty PIN as no PIN", () => {
    const parsed = createUserSchema.parse(valid);
    expect(parsed).toMatchObject({ name: "Ana Pérez", username: "ana.perez", role: "CASHIER" });
    expect(parsed.pin).toBeUndefined();
  });

  it("accepts a valid PIN", () => {
    expect(createUserSchema.parse({ ...valid, pin: "4821" }).pin).toBe("4821");
  });

  it.each([
    ["name", { name: "  " }],
    ["short username", { username: "ab" }],
    ["username with spaces", { username: "ana perez" }],
    ["username with accents", { username: "andrés" }],
    ["unknown role", { role: "ADMIN" }],
    ["short password", { password: "corta" }],
    ["bad PIN", { pin: "12ab" }],
  ])("rejects %s", (_label, override) => {
    expect(createUserSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });

  it("reports problems in Spanish", () => {
    const result = createUserSchema.safeParse({ ...valid, username: "ab" });
    expect(result.error?.issues[0]?.message).toBe(messages.users.validation.username);
  });
});

describe("other user schemas", () => {
  it("validates updates, password resets and PIN resets", () => {
    expect(updateUserSchema.safeParse({ name: "Ana", role: "MANAGER" }).success).toBe(true);
    expect(updateUserSchema.safeParse({ name: "", role: "MANAGER" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ newPassword: "Clave-2026" }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ newPassword: "corta" }).success).toBe(false);
    expect(resetPinSchema.safeParse({ pin: "1234" }).success).toBe(true);
    expect(resetPinSchema.safeParse({ pin: "12" }).success).toBe(false);
  });
});

describe("audit labels and filters", () => {
  it("has a Spanish label for every audit action", () => {
    expect(Object.keys(messages.audit.actions).sort()).toEqual([...AUDIT_ACTIONS].sort());
  });

  it("parses valid filters and ignores invalid values", () => {
    expect(
      parseAuditFilters({ action: "SALE_VOIDED", userId: "u1", from: "2026-10-01", page: "3" }),
    ).toMatchObject({ action: "SALE_VOIDED", userId: "u1", from: "2026-10-01", page: 3 });

    const ignored = parseAuditFilters({ action: "INVENTADA", page: "-4", entityType: "" });
    expect(ignored.action).toBeUndefined();
    expect(ignored.entityType).toBeUndefined();
    expect(ignored.page).toBe(1);
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(parseAuditFilters({ entityType: ["User", "Sale"] }).entityType).toBe("User");
  });
});
