import { describe, expect, it } from "vitest";

import { staticDirectory } from "@/lib/tenancy/directory";
import { classifyHost, type HostConfig } from "@/lib/tenancy/host";

const directory = staticDirectory({
  "tienda-a.localhost": { id: "a", databaseUrl: "postgresql://a" },
});

const multi: HostConfig = { mode: "multi", platformHost: "admin.localhost:3000", directory };
const single: HostConfig = { mode: "single", platformHost: "admin.localhost", directory };

describe("classifyHost", () => {
  it("sends the platform host to the platform panel, ignoring case and port", () => {
    expect(classifyHost("admin.localhost:3100", multi)).toBe("platform");
    expect(classifyHost("ADMIN.Localhost", multi)).toBe("platform");
  });

  it("in multi mode only hosts in the directory are businesses", () => {
    expect(classifyHost("tienda-a.localhost:3000", multi)).toBe("tenant");
    expect(classifyHost("tienda-b.localhost", multi)).toBe("unknown");
    expect(classifyHost("localhost", multi)).toBe("unknown");
    expect(classifyHost("", multi)).toBe("unknown");
    expect(classifyHost(null, multi)).toBe("unknown");
    expect(classifyHost("no es un host!", multi)).toBe("unknown");
  });

  it("the loopback host Next uses for its internal fetches is unknown in multi mode", () => {
    // Next pide las redirecciones de las acciones a http://localhost:<puerto>; debe dar 404 para que navegue el navegador.
    expect(classifyHost("localhost:3000", multi)).toBe("unknown");
    expect(classifyHost("127.0.0.1:3000", multi)).toBe("unknown");
  });

  it("in single mode any host is the one business, and the platform host is ignored", () => {
    expect(classifyHost("tienda.mi-boutique.hn", single)).toBe("tenant");
    expect(classifyHost("127.0.0.1:3100", single)).toBe("tenant");
    expect(classifyHost(null, single)).toBe("tenant");
    expect(classifyHost("admin.localhost", single)).toBe("tenant");
  });

  it("without a platform host nothing is the platform", () => {
    expect(classifyHost("admin.localhost", { ...multi, platformHost: undefined })).toBe("unknown");
  });

  it("does not treat a lookalike or a subdomain of the platform host as the platform", () => {
    expect(classifyHost("evil-admin.localhost", multi)).toBe("unknown");
    expect(classifyHost("admin.localhost.evil.com", multi)).toBe("unknown");
    expect(classifyHost("x.admin.localhost", multi)).toBe("unknown");
  });
});
