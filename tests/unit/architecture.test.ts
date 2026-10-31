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
