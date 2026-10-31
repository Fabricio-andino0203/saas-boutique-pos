import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { proxy } from "@/proxy";
import { setTenantDirectory, staticDirectory } from "@/lib/tenancy/directory";

function request(url: string, init: { cookie?: string } = {}): NextRequest {
  const { host } = new URL(url);
  return new NextRequest(url, {
    headers: { host, ...(init.cookie ? { cookie: init.cookie } : {}) },
  });
}

const saved = { mode: process.env.TENANCY_MODE, platform: process.env.PLATFORM_HOST };

beforeEach(() => {
  process.env.PLATFORM_HOST = "admin.localhost";
  setTenantDirectory(
    staticDirectory({ "a.localhost": { id: "a", databaseUrl: "postgresql://a" } }),
  );
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
  it("shows the login without a session, rewriting it to the internal /platform route", () => {
    const response = proxy(request("http://admin.localhost:3000/login"));
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://admin.localhost:3000/platform/login",
    );
  });

  it("rewrites the root and nested panel routes under /platform", () => {
    const cookie = "boutique_platform=token";
    expect(
      proxy(request("http://admin.localhost:3000/", { cookie })).headers.get(
        "x-middleware-rewrite",
      ),
    ).toBe("http://admin.localhost:3000/platform");
    expect(
      proxy(request("http://admin.localhost:3000/negocios?x=1", { cookie })).headers.get(
        "x-middleware-rewrite",
      ),
    ).toBe("http://admin.localhost:3000/platform/negocios?x=1");
  });

  it("sends the panel pages to the login when there is no platform cookie", () => {
    const response = proxy(request("http://admin.localhost:3000/negocios"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") as string).pathname).toBe("/login");
  });

  it("a business cookie does not open the panel", () => {
    const response = proxy(
      request("http://admin.localhost:3000/", { cookie: "boutique_session=abc" }),
    );
    expect(response.status).toBe(307);
  });

  it("serves the platform health check without a session", () => {
    const response = proxy(request("http://admin.localhost:3000/api/health"));
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://admin.localhost:3000/platform/api/health",
    );
  });

  it("does not expose the internal /platform prefix as a public address", () => {
    const response = proxy(
      request("http://admin.localhost:3000/platform/negocios", { cookie: "boutique_platform=t" }),
    );
    expect(response.status).toBe(404);
  });
});

describe("proxy — business hosts", () => {
  it.each(["single", "multi"])("never reaches /platform from a business host (%s mode)", (mode) => {
    process.env.TENANCY_MODE = mode;
    for (const path of [
      "/platform",
      "/platform/login",
      "/platform/negocios",
      "/platform/api/health",
    ]) {
      const response = proxy(
        request(`http://a.localhost:3000${path}`, { cookie: "boutique_session=x" }),
      );
      expect(response.status, `${mode} ${path}`).toBe(404);
    }
  });

  it("keeps working as before for a business: login redirect and pass-through with a cookie", () => {
    process.env.TENANCY_MODE = "multi";
    const redirect = proxy(request("http://a.localhost:3000/productos"));
    expect(redirect.status).toBe(307);
    expect(new URL(redirect.headers.get("location") as string).pathname).toBe("/login");
    const ok = proxy(
      request("http://a.localhost:3000/productos", { cookie: "boutique_session=x" }),
    );
    expect(ok.status).toBe(200);
  });

  it("in multi mode an unknown host gets 404 on every route, including the login", () => {
    process.env.TENANCY_MODE = "multi";
    for (const path of ["/", "/login", "/productos"]) {
      expect(proxy(request(`http://nadie.localhost:3000${path}`)).status, path).toBe(404);
    }
  });

  it("without PLATFORM_HOST the admin address is just another host", () => {
    delete process.env.PLATFORM_HOST;
    process.env.TENANCY_MODE = "single";
    const response = proxy(request("http://admin.localhost:3000/login"));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.status).toBe(200);
  });
});
