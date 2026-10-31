import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

// CLAUDE.md §6.2: el stock solo cambia mediante StockMovement, dentro de inventory/service.ts.
const DETECTORS = [
  /\bstockLevel\s*\.\s*(update|updateMany|create|createMany|upsert|delete|deleteMany)\s*\(/,
  /\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+"?StockLevel"?/i,
];

const ROOT = process.cwd();
const ALLOWED = join("src", "modules", "inventory", "service.ts");

function writesStockLevel(source: string): boolean {
  return DETECTORS.some((detector) => detector.test(source));
}

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function scannedFiles(): string[] {
  const source = walk(join(ROOT, "src")).filter(
    (file) =>
      /\.(ts|tsx)$/.test(file) && !relative(ROOT, file).startsWith(join("src", "generated") + sep),
  );
  const seed = [join(ROOT, "prisma", "seed.ts"), ...walk(join(ROOT, "prisma", "seed"))].filter(
    (file) => /\.ts$/.test(file) && exists(file),
  );
  return [...source, ...seed].map((file) => relative(ROOT, file));
}

function exists(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

// Propuesta SaaS, aislamiento por construcción: solo `src/lib/tenancy/` crea clientes de base de datos y solo los procesos
// y pruebas (no el código de la aplicación) pueden fijar un negocio predeterminado para todo el proceso.
const TENANCY_DIR = join("src", "lib", "tenancy") + sep;
const CREATES_CLIENT = /\bnew\s+PrismaClient\s*\(/;
const SETS_DEFAULT_TENANT = /\bsetProcessDefaultTenant\s*\(/;

function appFilesOutsideTenancy(): string[] {
  return walk(join(ROOT, "src"))
    .map((file) => relative(ROOT, file))
    .filter(
      (file) =>
        /\.(ts|tsx)$/.test(file) &&
        !file.startsWith(join("src", "generated") + sep) &&
        !file.startsWith(TENANCY_DIR),
    );
}

describe("a business can only reach its own database", () => {
  it("the detectors flag the dangerous calls", () => {
    expect(CREATES_CLIENT.test("const c = new PrismaClient({ adapter })")).toBe(true);
    expect(CREATES_CLIENT.test("import { PrismaClient } from '@/generated/prisma/client'")).toBe(
      false,
    );
    expect(SETS_DEFAULT_TENANT.test("setProcessDefaultTenant({ id: 'x' })")).toBe(true);
  });

  it("scans real files", () => {
    expect(appFilesOutsideTenancy()).toContain(join("src", "lib", "db.ts"));
    expect(appFilesOutsideTenancy()).not.toContain(join("src", "lib", "tenancy", "resolver.ts"));
  });

  it("no application code creates its own database client", () => {
    const offenders = appFilesOutsideTenancy().filter((file) =>
      CREATES_CLIENT.test(readFileSync(join(ROOT, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("no application code sets a process-wide default business", () => {
    const offenders = appFilesOutsideTenancy().filter((file) =>
      SETS_DEFAULT_TENANT.test(readFileSync(join(ROOT, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

// Propuesta SaaS, plano de control: la base central y el panel de la plataforma no se mezclan con los datos de un negocio.
const PLATFORM_SIDE = [
  join("src", "modules", "platform") + sep,
  join("src", "app", "platform") + sep,
  join("src", "lib", "platform-auth.ts"),
  join("src", "lib", "platform-cookie.ts"),
  join("src", "config", "messages.platform.es.ts"),
];
/** Infraestructura que ve ambos lados: el enrutado por host y el envoltorio del acceso a datos. */
const SHARED_INFRASTRUCTURE = [join("src", "proxy.ts"), TENANCY_DIR];
const IMPORTS_CONTROL = /from\s+["']@\/(lib\/tenancy\/control-db|generated\/control)/;
const IMPORTS_BUSINESS_DB = /from\s+["']@\/(lib\/db|generated\/prisma)/;
const IMPORTS_PLATFORM = /from\s+["']@\/(modules\/platform|lib\/platform-)/;

const isPlatformSide = (file: string) => PLATFORM_SIDE.some((entry) => file.startsWith(entry));
const isShared = (file: string) => SHARED_INFRASTRUCTURE.some((entry) => file.startsWith(entry));

function sourceFiles(): string[] {
  return appFilesOutsideTenancy().concat(
    walk(join(ROOT, TENANCY_DIR))
      .map((file) => relative(ROOT, file))
      .filter((file) => /\.(ts|tsx)$/.test(file)),
  );
}

describe("the platform and the businesses stay apart", () => {
  it("the detectors flag the dangerous imports", () => {
    expect(IMPORTS_CONTROL.test('import { controlDb } from "@/lib/tenancy/control-db";')).toBe(
      true,
    );
    expect(IMPORTS_CONTROL.test('import type { Tenant } from "@/generated/control/client";')).toBe(
      true,
    );
    expect(IMPORTS_CONTROL.test('import { db } from "@/lib/db";')).toBe(false);
    expect(IMPORTS_BUSINESS_DB.test('import { db } from "@/lib/db";')).toBe(true);
    expect(
      IMPORTS_PLATFORM.test('import { requirePlatformSession } from "@/lib/platform-auth";'),
    ).toBe(true);
  });

  it("scans real files on both sides", () => {
    const files = sourceFiles();
    expect(files.some(isPlatformSide)).toBe(true);
    expect(files).toContain(join("src", "modules", "platform", "service.ts"));
    expect(files).toContain(join("src", "modules", "sales", "service.ts"));
  });

  it("only the platform side (and the tenancy layer) can reach the central database", () => {
    const offenders = sourceFiles().filter(
      (file) =>
        !isPlatformSide(file) &&
        !file.startsWith(TENANCY_DIR) &&
        IMPORTS_CONTROL.test(readFileSync(join(ROOT, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("pages and components of the panel never import the central database directly", () => {
    const offenders = sourceFiles().filter(
      (file) =>
        (file.startsWith(join("src", "app", "platform") + sep) ||
          file.includes(join("platform", "components") + sep)) &&
        IMPORTS_CONTROL.test(readFileSync(join(ROOT, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("the platform side never touches the database of a business", () => {
    const offenders = sourceFiles().filter(
      (file) =>
        isPlatformSide(file) && IMPORTS_BUSINESS_DB.test(readFileSync(join(ROOT, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("business code never imports the platform side", () => {
    const offenders = sourceFiles().filter(
      (file) =>
        !isPlatformSide(file) &&
        !isShared(file) &&
        IMPORTS_PLATFORM.test(readFileSync(join(ROOT, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("stock writes go through inventory/service.ts only", () => {
  it("the detector flags direct writes and not reads", () => {
    expect(writesStockLevel("await db.stockLevel.update({ where: {} })")).toBe(true);
    expect(writesStockLevel("await tx.stockLevel.upsert({ where: {} })")).toBe(true);
    expect(writesStockLevel('await tx.$executeRaw`UPDATE "StockLevel" SET "onHand" = 1`')).toBe(
      true,
    );
    expect(writesStockLevel("await db.stockLevel.findMany({})")).toBe(false);
  });

  it("scans real files", () => {
    expect(scannedFiles()).toContain(join("src", "lib", "db.ts"));
  });

  it("no other file writes stockLevel", () => {
    const offenders = scannedFiles().filter(
      (file) => file !== ALLOWED && writesStockLevel(readFileSync(join(ROOT, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
