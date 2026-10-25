import { describe, expect, it } from "vitest";

import { hashSecret, verifySecret } from "@/lib/password";

describe("password hashing", () => {
  it("hashes with Argon2id and never returns the plain text", async () => {
    const hashed = await hashSecret("Demo-Cajero-2026");
    expect(hashed).not.toBe("Demo-Cajero-2026");
    expect(hashed.startsWith("$argon2id$")).toBe(true);
  });

  it("verifies the right secret and rejects another", async () => {
    const hashed = await hashSecret("Demo-Cajero-2026");
    expect(await verifySecret(hashed, "Demo-Cajero-2026")).toBe(true);
    expect(await verifySecret(hashed, "otra-cosa")).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashSecret("x")).not.toBe(await hashSecret("x"));
  });

  it("returns false for a malformed hash", async () => {
    expect(await verifySecret("no-es-un-hash", "x")).toBe(false);
  });
});
