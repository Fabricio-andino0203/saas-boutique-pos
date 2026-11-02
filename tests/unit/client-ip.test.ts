import { describe, expect, it } from "vitest";

import { clientIpFrom } from "@/lib/client-ip";

const headers = (values: Record<string, string>) => new Headers(values);

describe("clientIpFrom", () => {
  it("takes the first address of X-Forwarded-For", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "200.30.1.9, 10.0.0.2" }))).toBe("200.30.1.9");
  });

  it("falls back to X-Real-IP and understands IPv6", () => {
    expect(clientIpFrom(headers({ "x-real-ip": "2800:a4:1::7" }))).toBe("2800:a4:1::7");
  });

  describe("behind Railway, which writes X-Real-IP", () => {
    it("believes only X-Real-IP, never a X-Forwarded-For the client could have invented", () => {
      const forged = headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "200.30.1.9" });
      expect(clientIpFrom(forged, "x-real-ip")).toBe("200.30.1.9");
      expect(clientIpFrom(headers({ "x-forwarded-for": "6.6.6.6" }), "x-real-ip")).toBeUndefined();
    });

    it("still ignores anything that does not look like an address", () => {
      expect(clientIpFrom(headers({ "x-real-ip": "<b>x</b>" }), "x-real-ip")).toBeUndefined();
    });
  });

  it("returns undefined when there is no header or it does not look like an address", () => {
    expect(clientIpFrom(headers({}))).toBeUndefined();
    expect(
      clientIpFrom(headers({ "x-forwarded-for": "<script>alert(1)</script>" })),
    ).toBeUndefined();
    expect(clientIpFrom(headers({ "x-forwarded-for": "a".repeat(200) }))).toBeUndefined();
  });
});
