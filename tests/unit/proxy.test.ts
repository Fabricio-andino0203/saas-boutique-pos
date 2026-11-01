import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { proxy } from "@/proxy";
import { setTenantDirectory } from "@/lib/tenancy/control-directory";
import { TenantDirectoryError, type TenantDirectory } from "@/lib/tenancy/directory";

function request(url: string, init: { cookie?: string } = {}): NextRequest {
  const { host } = new URL(url);
  return new NextRequest(url, {
    headers: { host, ...(init.cookie ? { cookie: init.cookie } : {}) },
  });
}

/** a = negocio activo, s = suspendido, down = el directorio no puede responder; cualquier otro nombre no es de nadie. */
const directory: TenantDirectory = {
  async lookupByHost(host) {
    if (host === "a.localhost") {
      return { state: "active", tenant: { id: "a", slug: "a", databaseUrl: "postgresql://a" } };
    }
    if (host === "s.localhost") {
      return { state: "suspended", tenant: { id: "s", slug: "s", name: "Tienda S" } };
    }
    if (host === "down.localhost") {
      throw new TenantDirectoryError("base central caída");
    }
    return undefined;
  },
};

const saved = { mode: process.env.TENANCY_MODE, platform: process.env.PLATFORM_HOST };

beforeEach(() => {
  // El panel de la plataforma solo existe en modo multi-negocio (ver src/lib/tenancy/host.ts).
  process.env.TENANCY_MODE = "multi";
  process.env.PLATFORM_HOST = "admin.localhost";
  setTenantDirectory(directory);
});

afterEach(() => {
  for (const [key, value] of [
    ["TENANCY_MODE", saved.mode],
    ["PLATFORM_HOST", saved.platform],
  ] as const) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  setTenantDirectory(undefined);
});

describe("proxy — platform host", () => {
  it("shows the login without a session, rewriting it to the internal /platform route", async () => {
    const response = await proxy(request("http://admin.localhost:3000/login"));
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://admin.localhost:3000/platform/login",
    );
  });

  it("rewrites the root and nested panel routes under /platform", async () => {
    const cookie = "boutique_platform=token";
    expect(
      (await proxy(request("http://admin.localhost:3000/", { cookie }))).headers.get(
        "x-middleware-rewrite",
      ),
    ).toBe("http://admin.localhost:3000/platform");
    expect(
      (await proxy(request("http://admin.localhost:3000/negocios?x=1", { cookie }))).headers.get(
        "x-middleware-rewrite",
      ),
    ).toBe("http://admin.localhost:3000/platform/negocios?x=1");
  });

  it("sends the panel pages to the login when there is no platform cookie", async () => {
    const response = await proxy(request("http://admin.localhost:3000/negocios"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") as string).pathname).toBe("/login");
  });

  it("a business cookie does not open the panel", async () => {
    const response = await proxy(
      request("http://admin.localhost:3000/", { cookie: "boutique_session=abc" }),
    );
    expect(response.status).toBe(307);
  });

  it("serves the platform health check without a session", async () => {
    const response = await proxy(request("http://admin.localhost:3000/api/health"));
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://admin.localhost:3000/platform/api/health",
    );
  });

  it("does not expose the internal /platform prefix as a public address", async () => {
    const response = await proxy(
      request("http://admin.localhost:3000/platform/negocios", { cookie: "boutique_platform=t" }),
    );
    expect(response.status).toBe(404);
  });

  it("does not need the directory: the panel still answers while the central database is down", async () => {
    const response = await proxy(request("http://admin.localhost:3000/login"));
    expect(response.status).toBe(200);
  });
});

describe("proxy — business hosts", () => {
  it.each(["single", "multi"])(
    "never reaches /platform from a business host (%s mode)",
    async (mode) => {
      process.env.TENANCY_MODE = mode;
      for (const path of [
        "/platform",
        "/platform/login",
        "/platform/negocios",
        "/platform/api/health",
      ]) {
        const response = await proxy(
          request(`http://a.localhost:3000${path}`, { cookie: "boutique_session=x" }),
        );
        expect(response.status, `${mode} ${path}`).toBe(404);
      }
    },
  );

  it("keeps working as before for a business: login redirect and pass-through with a cookie", async () => {
    const redirect = await proxy(request("http://a.localhost:3000/productos"));
    expect(redirect.status).toBe(307);
    expect(new URL(redirect.headers.get("location") as string).pathname).toBe("/login");
    const ok = await proxy(
      request("http://a.localhost:3000/productos", { cookie: "boutique_session=x" }),
    );
    expect(ok.status).toBe(200);
  });

  it("in multi mode an unknown host gets 404 on every route, including the login", async () => {
    for (const path of ["/", "/login", "/productos"]) {
      expect((await proxy(request(`http://nadie.localhost:3000${path}`))).status, path).toBe(404);
    }
  });

  it("in single mode the platform host is ignored: the admin address is just another host", async () => {
    process.env.TENANCY_MODE = "single";
    const response = await proxy(request("http://admin.localhost:3000/login"));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("without PLATFORM_HOST the admin address is unknown in multi mode", async () => {
    delete process.env.PLATFORM_HOST;
    expect((await proxy(request("http://admin.localhost:3000/login"))).status).toBe(404);
  });

  it("the loopback origin Next uses for internal fetches gets a 404, so the browser navigates itself", async () => {
    // Si devolviera la pantalla de un negocio, Next la mostraría dentro del panel tras cerrar sesión o entrar.
    expect((await proxy(request("http://localhost:3000/login"))).status).toBe(404);
    expect(
      (await proxy(request("http://localhost:3000/", { cookie: "boutique_platform=t" }))).status,
    ).toBe(404);
  });
});

describe("proxy — a business that cannot operate", () => {
  it("a suspended business gets the suspended page (403) on every route, before any cookie is read", async () => {
    for (const path of ["/", "/login", "/productos", "/vender"]) {
      const response = await proxy(
        request(`http://s.localhost:3000${path}`, { cookie: "boutique_session=x" }),
      );
      expect(response.status, path).toBe(403);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toContain("Cuenta suspendida");
    }
  });

  it("a suspended business cannot reach /platform either", async () => {
    expect((await proxy(request("http://s.localhost:3000/platform"))).status).toBe(403);
  });

  it("when the directory cannot answer, the business gets 503 with a retry hint — not a 404 and not a guess", async () => {
    const response = await proxy(request("http://down.localhost:3000/productos"));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(await response.text()).toContain("Servicio no disponible");
  });

  it("the health check and the certificate question pass through on any host", async () => {
    for (const host of ["s.localhost:3000", "nadie.localhost:3000", "127.0.0.1:3000"]) {
      const health = await proxy(request(`http://${host}/api/health`));
      expect(health.status, host).toBe(200);
    }
    // Caddy pregunta directo, con el host interno `app:3000`, que no es de ningún negocio.
    const ask = await proxy(request("http://app:3000/api/internal/tls-allowed?domain=a.localhost"));
    expect(ask.status).toBe(200);
  });

  it("the page of a suspended business never contains data of the business", async () => {
    const html = await (await proxy(request("http://s.localhost:3000/"))).text();
    expect(html).not.toContain("Tienda S");
  });
});
