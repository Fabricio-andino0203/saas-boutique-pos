import { describe, expect, it } from "vitest";

import {
  base32Decode,
  base32Encode,
  formatSecretForHumans,
  generateTotpSecret,
  otpauthUri,
  totpCode,
  totpStep,
  verifyTotp,
} from "@/lib/totp";

// RFC 6238 Apéndice B: secreto ASCII "12345678901234567890" (SHA-1). El RFC publica códigos de 8 dígitos; los de 6 son sus
// últimos seis dígitos (el truncado dinámico es el mismo, solo cambia el módulo).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("base32", () => {
  it("encodes and decodes the RFC 4648 test vectors", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    expect(base32Decode("mzxw 6ytb-oi=").toString()).toBe("foobar");
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("MZXW1YTB")).toThrow();
  });

  it("round-trips random secrets of 160 bits", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });
});

describe("totpCode (RFC 6238 vectors)", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])("at unix time %i the code is %s", (seconds, expected) => {
    expect(totpCode(RFC_SECRET, totpStep(new Date(seconds * 1000)))).toBe(expected);
  });
});

describe("verifyTotp", () => {
  const now = new Date(1111111111 * 1000);
  const step = totpStep(now);

  it("accepts the current code and reports its step", () => {
    expect(verifyTotp(RFC_SECRET, "050471", now)).toEqual({ ok: true, step });
  });

  it("tolerates one step of clock drift in either direction, but not two", () => {
    const previous = totpCode(RFC_SECRET, step - 1);
    const next = totpCode(RFC_SECRET, step + 1);
    const tooOld = totpCode(RFC_SECRET, step - 2);
    expect(verifyTotp(RFC_SECRET, previous, now)).toEqual({ ok: true, step: step - 1 });
    expect(verifyTotp(RFC_SECRET, next, now)).toEqual({ ok: true, step: step + 1 });
    expect(verifyTotp(RFC_SECRET, tooOld, now)).toEqual({ ok: false });
  });

  it("ignores spaces and rejects anything that is not six digits", () => {
    expect(verifyTotp(RFC_SECRET, "050 471", now).ok).toBe(true);
    for (const bad of ["", "05047", "0504711", "abcdef", "05047a"]) {
      expect(verifyTotp(RFC_SECRET, bad, now)).toEqual({ ok: false });
    }
  });

  it("does not accept a code that was already used (or an older one)", () => {
    expect(verifyTotp(RFC_SECRET, "050471", now, step)).toEqual({ ok: false });
    expect(verifyTotp(RFC_SECRET, "050471", now, step + 5)).toEqual({ ok: false });
    // el siguiente intervalo todavía vale
    const next = totpCode(RFC_SECRET, step + 1);
    expect(verifyTotp(RFC_SECRET, next, now, step)).toEqual({ ok: true, step: step + 1 });
  });

  it("rejects a code from a different secret", () => {
    const other = generateTotpSecret();
    expect(verifyTotp(other, "050471", now).ok).toBe(false);
  });
});

describe("otpauthUri", () => {
  it("builds the URI that authenticator apps read", () => {
    const uri = otpauthUri({ secret: "ABCDEF234567", account: "ana", issuer: "Boutique POS" });
    expect(uri.startsWith("otpauth://totp/Boutique%20POS:ana?")).toBe(true);
    const params = new URL(uri).searchParams;
    expect(params.get("secret")).toBe("ABCDEF234567");
    expect(params.get("issuer")).toBe("Boutique POS");
    expect(params.get("digits")).toBe("6");
    expect(params.get("period")).toBe("30");
    expect(params.get("algorithm")).toBe("SHA1");
  });

  it("escapes the account name", () => {
    const uri = otpauthUri({ secret: "AAAA", account: "a b/c", issuer: "X" });
    expect(uri).toContain("X:a%20b%2Fc");
  });
});

describe("formatSecretForHumans", () => {
  it("groups the secret in blocks of four", () => {
    expect(formatSecretForHumans("ABCDEFGHIJKL")).toBe("ABCD EFGH IJKL");
  });
});
