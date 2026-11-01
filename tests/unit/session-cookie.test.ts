import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sessionCookieName } from "@/lib/session-cookie";
import { setTenantDirectory } from "@/lib/tenancy/control-directory";
import { staticDirectory } from "@/lib/tenancy/directory";
import { proxy } from "@/proxy";

afterEach(() => {
  vi.unstubAllEnvs();
  setTenantDirectory(undefined);
});

describe("sessionCookieName", () => {
  it("keeps the usual name for a single store, in development and in production", () => {
    expect(sessionCookieName()).toBe("boutique_session");
    vi.stubEnv("DEPLOYMENT", "production");
    expect(sessionCookieName()).toBe("boutique_session");
  });

  it("uses the __Host- prefix with several businesses in production, so a sibling subdomain cannot plant it", () => {
    vi.stubEnv("TENANCY_MODE", "multi");
    expect(sessionCookieName()).toBe("boutique_session"); // en local (http) el prefijo no se puede usar
    vi.stubEnv("DEPLOYMENT", "production");
    expect(sessionCookieName()).toBe("__Host-boutique_session");
  });

  it("the proxy only accepts the cookie by its production name", async () => {
    vi.stubEnv("TENANCY_MODE", "multi");
    vi.stubEnv("DEPLOYMENT", "production");
    setTenantDirectory(
      staticDirectory({ "a.mi-plataforma.hn": { id: "a", databaseUrl: "postgresql://a" } }),
    );
    const call = (cookie: string) =>
      proxy(
        new NextRequest("https://a.mi-plataforma.hn/productos", {
          headers: { host: "a.mi-plataforma.hn", cookie },
        }),
      );
    expect((await call("boutique_session=plantada")).status).toBe(307); // una cookie sin el prefijo no vale
    expect((await call("__Host-boutique_session=real")).status).toBe(200);
  });
});
