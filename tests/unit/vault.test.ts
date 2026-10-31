import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  VaultError,
  createVault,
  generateMasterKey,
  parseMasterKey,
  vaultContext,
  vaultFromEnvironment,
} from "@/lib/tenancy/vault";

const key1 = { version: 1, key: randomBytes(32) };
const key2 = { version: 2, key: randomBytes(32) };

describe("vault", () => {
  const context = vaultContext.tenantDatabase("tenant-a");

  it("encrypts and decrypts, and never stores the plain text", () => {
    const vault = createVault(key1);
    const envelope = vault.encrypt("s3cr3t-password", context);
    expect(envelope).not.toContain("s3cr3t");
    expect(envelope).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(vault.decrypt(envelope, context)).toBe("s3cr3t-password");
  });

  it("uses a fresh nonce every time", () => {
    const vault = createVault(key1);
    expect(vault.encrypt("same", context)).not.toBe(vault.encrypt("same", context));
  });

  it("handles empty and non-ASCII secrets", () => {
    const vault = createVault(key1);
    expect(vault.decrypt(vault.encrypt("", context), context)).toBe("");
    expect(vault.decrypt(vault.encrypt("contraseña-ñandú-🔑", context), context)).toBe(
      "contraseña-ñandú-🔑",
    );
  });

  it("refuses an envelope moved to another record (the context is authenticated)", () => {
    const vault = createVault(key1);
    const envelope = vault.encrypt("pw", vaultContext.tenantDatabase("tenant-a"));
    expect(() => vault.decrypt(envelope, vaultContext.tenantDatabase("tenant-b"))).toThrow(
      VaultError,
    );
    expect(() => vault.decrypt(envelope, vaultContext.platformUserTotp("tenant-a"))).toThrow(
      VaultError,
    );
  });

  it("detects tampering in any part of the envelope", () => {
    const vault = createVault(key1);
    const [version, nonce, data, tag] = vault.encrypt("pw", context).split(".") as [
      string,
      string,
      string,
      string,
    ];
    const flip = (value: string) => `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
    for (const tampered of [
      [version, flip(nonce), data, tag],
      [version, nonce, flip(data), tag],
      [version, nonce, data, flip(tag)],
    ]) {
      expect(() => vault.decrypt(tampered.join("."), context)).toThrow(VaultError);
    }
  });

  it("rejects malformed envelopes", () => {
    const vault = createVault(key1);
    for (const bad of ["", "nonsense", "v1.a.b", "x1.a.b.c", "v1..b.c"]) {
      expect(() => vault.decrypt(bad, context)).toThrow(VaultError);
    }
  });

  it("does not decrypt with a different key", () => {
    const envelope = createVault(key1).encrypt("pw", context);
    const other = createVault({ version: 1, key: randomBytes(32) });
    expect(() => other.decrypt(envelope, context)).toThrow(VaultError);
  });

  it("rotates: the new key encrypts, the previous one still decrypts, and rotation is idempotent", () => {
    const old = createVault(key1).encrypt("pw", context);
    const vault = createVault(key2, [key1]);

    expect(vault.needsRotation(old)).toBe(true);
    expect(vault.decrypt(old, context)).toBe("pw");

    const rotated = vault.rotate(old, context);
    expect(rotated.startsWith("v2.")).toBe(true);
    expect(vault.needsRotation(rotated)).toBe(false);

    // Una vez re-cifrado todo, la llave anterior ya no hace falta.
    expect(createVault(key2).decrypt(rotated, context)).toBe("pw");
    expect(() => createVault(key2).decrypt(old, context)).toThrow(/versión 1/);
  });

  it("validates its keys", () => {
    expect(() => createVault({ version: 1, key: randomBytes(16) })).toThrow(VaultError);
    expect(() => createVault(key1, [key1])).toThrow(/repetida/);
  });
});

describe("master key handling", () => {
  it("generates 32-byte keys that parse back", () => {
    const text = generateMasterKey();
    expect(parseMasterKey(text)).toHaveLength(32);
    expect(generateMasterKey()).not.toBe(text);
  });

  it("rejects keys of the wrong size", () => {
    expect(() => parseMasterKey("corta")).toThrow(VaultError);
    expect(() => parseMasterKey(randomBytes(31).toString("base64"))).toThrow(VaultError);
  });

  it("builds the vault from the environment, with an optional previous key", () => {
    const current = generateMasterKey();
    const previous = generateMasterKey();
    const vault = vaultFromEnvironment({
      PLATFORM_MASTER_KEY: current,
      PLATFORM_MASTER_KEY_VERSION: "3",
      PLATFORM_MASTER_KEY_PREVIOUS: previous,
    });
    expect(vault.currentVersion).toBe(3);
    // la anterior se asume como la versión inmediata anterior (2)
    const legacy = createVault({ version: 2, key: parseMasterKey(previous) }).encrypt("x", "ctx");
    expect(vault.decrypt(legacy, "ctx")).toBe("x");
  });

  it("refuses to start without a master key", () => {
    expect(() => vaultFromEnvironment({})).toThrow(/PLATFORM_MASTER_KEY/);
  });
});
