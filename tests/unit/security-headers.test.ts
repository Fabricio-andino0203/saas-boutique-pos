import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, securityHeaders } from "@/config/security-headers";

describe("securityHeaders", () => {
  const byKey = (isDevelopment: boolean) =>
    Object.fromEntries(securityHeaders(isDevelopment).map((header) => [header.key, header.value]));

  it("sends the headers a production page needs", () => {
    const headers = byKey(false);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });

  it("does not set HSTS itself (Caddy does, over HTTPS)", () => {
    expect(byKey(false)["Strict-Transport-Security"]).toBeUndefined();
  });

  it("keeps the CSP closed to other origins, frames and plugins", () => {
    const policy = contentSecurityPolicy(false);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toMatch(/\bhttps?:\/\//);
  });

  it("only allows eval and websockets in development", () => {
    const dev = contentSecurityPolicy(true);
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("ws:");
  });
});
