import { describe, expect, it } from "vitest";

import {
  staticDirectory,
  TenantDirectoryError,
  type DirectoryEntry,
  type TenantDirectory,
} from "@/lib/tenancy/directory";
import { classifyHost, type HostConfig } from "@/lib/tenancy/host";
import { isCertificateAllowed } from "@/lib/tenancy/tls";

const active = staticDirectory({
  "tienda-a.localhost": { id: "a", databaseUrl: "postgresql://a" },
});

/** Un directorio con un negocio activo, uno suspendido y uno que hace fallar la consulta. */
const directory: TenantDirectory = {
  async lookupByHost(host): Promise<DirectoryEntry | undefined> {
    if (host === "suspendida.localhost") {
      return { state: "suspended", tenant: { id: "s", slug: "suspendida", name: "S" } };
    }
    if (host === "rota.localhost") {
      throw new TenantDirectoryError("sin base central");
    }
    return active.lookupByHost(host);
  },
};

const multi: HostConfig = { mode: "multi", platformHost: "admin.localhost:3000", directory };
const single: HostConfig = { mode: "single", platformHost: "admin.localhost", directory };

describe("classifyHost", () => {
  it("sends the platform host to the platform panel, ignoring case and port", async () => {
    expect(await classifyHost("admin.localhost:3100", multi)).toBe("platform");
    expect(await classifyHost("ADMIN.Localhost", multi)).toBe("platform");
  });

  it("in multi mode only hosts in the directory are businesses", async () => {
    expect(await classifyHost("tienda-a.localhost:3000", multi)).toBe("tenant");
    expect(await classifyHost("tienda-b.localhost", multi)).toBe("unknown");
    expect(await classifyHost("localhost", multi)).toBe("unknown");
    expect(await classifyHost("", multi)).toBe("unknown");
    expect(await classifyHost(null, multi)).toBe("unknown");
    expect(await classifyHost("no es un host!", multi)).toBe("unknown");
  });

  it("a business that exists but cannot operate is 'suspended', not unknown and not a business", async () => {
    expect(await classifyHost("suspendida.localhost:3000", multi)).toBe("suspended");
  });

  it("the loopback host Next uses for its internal fetches is unknown in multi mode", async () => {
    // Next pide las redirecciones de las acciones a http://localhost:<puerto>; debe dar 404 para que navegue el navegador.
    expect(await classifyHost("localhost:3000", multi)).toBe("unknown");
    expect(await classifyHost("127.0.0.1:3000", multi)).toBe("unknown");
  });

  it("in single mode any host is the one business, and the platform host is ignored", async () => {
    expect(await classifyHost("tienda.mi-boutique.hn", single)).toBe("tenant");
    expect(await classifyHost("127.0.0.1:3100", single)).toBe("tenant");
    expect(await classifyHost(null, single)).toBe("tenant");
    expect(await classifyHost("admin.localhost", single)).toBe("tenant");
    expect(await classifyHost("suspendida.localhost", single)).toBe("tenant");
  });

  it("without a platform host nothing is the platform", async () => {
    expect(await classifyHost("admin.localhost", { ...multi, platformHost: undefined })).toBe(
      "unknown",
    );
  });

  it("does not treat a lookalike or a subdomain of the platform host as the platform", async () => {
    expect(await classifyHost("evil-admin.localhost", multi)).toBe("unknown");
    expect(await classifyHost("admin.localhost.evil.com", multi)).toBe("unknown");
    expect(await classifyHost("x.admin.localhost", multi)).toBe("unknown");
  });

  it("lets a directory failure through, so the caller answers 503 instead of guessing", async () => {
    await expect(classifyHost("rota.localhost", multi)).rejects.toBeInstanceOf(
      TenantDirectoryError,
    );
    // El panel no depende del directorio.
    expect(await classifyHost("admin.localhost", multi)).toBe("platform");
  });
});

describe("isCertificateAllowed (Caddy's on-demand TLS question)", () => {
  it("allows the panel and the businesses that exist, including a suspended one", async () => {
    expect(await isCertificateAllowed("admin.localhost", multi)).toBe(true);
    expect(await isCertificateAllowed("tienda-a.localhost", multi)).toBe(true);
    expect(await isCertificateAllowed("suspendida.localhost", multi)).toBe(true);
  });

  it("refuses names that belong to nobody, so nobody can spend the certificate quota", async () => {
    expect(await isCertificateAllowed("nadie.localhost", multi)).toBe(false);
    expect(await isCertificateAllowed("evil.com", multi)).toBe(false);
    expect(await isCertificateAllowed("tienda-a.localhost.evil.com", multi)).toBe(false);
  });

  it("is never used in single mode", async () => {
    expect(await isCertificateAllowed("tienda-a.localhost", single)).toBe(false);
    expect(await isCertificateAllowed("cualquiera.com", single)).toBe(false);
  });

  it("surfaces a directory failure instead of answering yes or no", async () => {
    await expect(isCertificateAllowed("rota.localhost", multi)).rejects.toBeInstanceOf(
      TenantDirectoryError,
    );
  });
});
