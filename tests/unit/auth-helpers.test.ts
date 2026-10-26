import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/session-cookie";
import { changePasswordSchema, loginSchema, pinSchema } from "@/modules/auth/schemas";
import { generateSessionToken, hashSessionToken } from "@/modules/auth/token";

describe("session tokens", () => {
  it("generates long, unique, url-safe tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hashes deterministically and never returns the token", () => {
    const token = "token-de-prueba";
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).not.toContain(token);
    expect(hashSessionToken("otro")).not.toBe(hashSessionToken(token));
  });
});

describe("safeNextPath", () => {
  it("keeps internal paths", () => {
    expect(safeNextPath("/productos")).toBe("/productos");
    expect(safeNextPath("/productos?q=vestido")).toBe("/productos?q=vestido");
  });

  it("falls back to home for anything that could leave the site", () => {
    for (const value of [
      "//evil.com",
      "https://evil.com",
      "/\\evil.com",
      "evil",
      "",
      null,
      undefined,
      5,
    ]) {
      expect(safeNextPath(value), String(value)).toBe("/");
    }
  });
});

describe("auth schemas", () => {
  it("requires username and password to log in", () => {
    expect(loginSchema.safeParse({ username: "  cajero ", password: "x" })).toMatchObject({
      success: true,
      data: { username: "cajero" },
    });
    expect(loginSchema.safeParse({ username: "", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ username: "a", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ username: null, password: null }).success).toBe(false);
  });

  it("validates a password change", () => {
    const base = {
      currentPassword: "vieja",
      newPassword: "Nueva-2026",
      confirmPassword: "Nueva-2026",
    };
    expect(changePasswordSchema.safeParse(base).success).toBe(true);
    expect(
      changePasswordSchema.safeParse({ ...base, newPassword: "corta", confirmPassword: "corta" })
        .success,
    ).toBe(false);
    const mismatch = changePasswordSchema.safeParse({ ...base, confirmPassword: "Otra-2026" });
    expect(mismatch.success).toBe(false);
    expect(mismatch.error?.issues[0]?.path).toEqual(["confirmPassword"]);
  });

  it("accepts PINs of 4 to 6 digits only", () => {
    for (const ok of ["1234", "12345", "123456"])
      expect(pinSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["123", "1234567", "12a4", "", " 1234"])
      expect(pinSchema.safeParse(bad).success, bad).toBe(false);
  });
});
