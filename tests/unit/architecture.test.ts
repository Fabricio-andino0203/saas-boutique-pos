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

// Etapa 6: una cuenta con contraseña temporal no puede usar nada hasta cambiarla. `requireSession` y `getUsableSession` lo
// aplican; `getSession` devuelve la sesión tal cual y solo la pueden usar las pantallas que justamente necesitan verla.
const IMPORTS_RAW_SESSION = /import\s*\{[^}]*\bgetSession\b[^}]*\}\s*from\s*["']@\/lib\/auth["']/;
const MAY_READ_RAW_SESSION = [
  join("src", "lib", "auth.ts"),
  join("src", "app", "(auth)", "login", "page.tsx"),
  join("src", "app", "(auth)", "cambiar-contrasena", "page.tsx"),
];

describe("an account with a temporary password cannot use the system", () => {
  it("the detector flags a raw getSession import, single-line or multi-line", () => {
    expect(IMPORTS_RAW_SESSION.test('import { getSession } from "@/lib/auth";')).toBe(true);
    expect(
      IMPORTS_RAW_SESSION.test('import {\n  clearSession,\n  getSession,\n} from "@/lib/auth";'),
    ).toBe(true);
    expect(IMPORTS_RAW_SESSION.test('import { getUsableSession } from "@/lib/auth";')).toBe(false);
    expect(IMPORTS_RAW_SESSION.test('import { requireSession } from "@/lib/auth";')).toBe(false);
  });

  it("only the sign-in and change-password screens read the raw session", () => {
    const offenders = appFilesOutsideTenancy().filter(
      (file) =>
        !MAY_READ_RAW_SESSION.includes(file) &&
        IMPORTS_RAW_SESSION.test(readFileSync(join(ROOT, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

// Regla 9 del proyecto (permisos y validación siempre en el servidor): cada acción del servidor revisa quién la pide. Una acción
// que olvida su control es una puerta abierta aunque el botón esté oculto. Se acepta que la revisión esté en una función del mismo
// archivo a la que la acción llama (p. ej. `runAsAdmin`); solo las acciones de entrada y salida son públicas a propósito.
const AUTH_CALL =
  /\b(require\w*|getPlatformSession|getUsableSession|runAsAdmin|asAdmin|runOperation)\s*\(/;
const PUBLIC_ACTIONS = new Set([
  "loginAction",
  "logoutAction",
  "platformLoginAction",
  "platformVerifyCodeAction",
  "platformEnrollAction",
  "platformLogoutAction",
]);

type FunctionBody = { exported: boolean; body: string };

function functionsOf(source: string): Map<string, FunctionBody> {
  const hits = [...source.matchAll(/^(export )?(async )?function (\w+)/gm)];
  return new Map(
    hits.map((hit, index) => [
      hit[3] as string,
      {
        exported: Boolean(hit[1]),
        body: source.slice(hit.index, hits[index + 1]?.index ?? source.length),
      },
    ]),
  );
}

/** Las acciones exportadas de un archivo «use server» que no revisan quién las pide (ni directo ni por una función del archivo). */
function unguardedActions(source: string): string[] {
  const functions = functionsOf(source);
  const guarded = (name: string, seen = new Set<string>()): boolean => {
    const entry = functions.get(name);
    if (!entry || seen.has(name)) {
      return false;
    }
    seen.add(name);
    if (AUTH_CALL.test(entry.body)) {
      return true;
    }
    return [...functions.keys()].some(
      (other) =>
        other !== name && new RegExp(`\\b${other}\\s*\\(`).test(entry.body) && guarded(other, seen),
    );
  };
  return [...functions]
    .filter(([name, entry]) => entry.exported && !PUBLIC_ACTIONS.has(name) && !guarded(name))
    .map(([name]) => name);
}

describe("every server action checks who is asking", () => {
  it("the detector understands direct checks, helpers and unprotected actions", () => {
    const protectedDirect = 'export async function a() {\n  await requireUserCapability("x");\n}';
    const viaHelper =
      "async function run() {\n  await getPlatformSession();\n}\nexport async function b() {\n  return run();\n}";
    const open = "export async function c() {\n  await db.user.deleteMany();\n}";
    expect(unguardedActions(protectedDirect)).toEqual([]);
    expect(unguardedActions(viaHelper)).toEqual([]);
    expect(unguardedActions(open)).toEqual(["c"]);
  });

  it("no exported server action in the application is left unprotected", () => {
    const files = walk(join(ROOT, "src"))
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .map((file) => relative(ROOT, file))
      .filter((file) => readFileSync(join(ROOT, file), "utf8").includes('"use server"'));
    expect(files.length).toBeGreaterThan(15);
    const offenders = files.flatMap((file) =>
      unguardedActions(readFileSync(join(ROOT, file), "utf8")).map((name) => `${file}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });
});

// Una pantalla de otro módulo no usa las acciones de Compras: esas exigen el módulo «Compras» del plan, y en un plan sin él la
// pantalla fallaría con «Algo salió mal» (pasó con el buscador de etiquetas de un negocio con el plan Estándar). Cada módulo trae
// su propia búsqueda, con su propio permiso.
const PURCHASING_ACTIONS = "@/modules/purchasing/actions";
const MAY_USE_PURCHASING_ACTIONS = [
  join("src", "modules", "purchasing") + sep,
  join("src", "app", "(app)", "compras") + sep,
];

describe("a screen of another module does not depend on the purchasing module's plan", () => {
  it("only purchasing's own code calls purchasing's server actions", () => {
    const offenders = appFilesOutsideTenancy().filter(
      (file) =>
        !MAY_USE_PURCHASING_ACTIONS.some((allowed) => file.startsWith(allowed)) &&
        readFileSync(join(ROOT, file), "utf8").includes(PURCHASING_ACTIONS),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the shared variant picker does not hide a purchasing dependency", () => {
  const PICKER = join("src", "modules", "purchasing", "components", "variant-picker.tsx");
  const IMPORTS_PURCHASING_COMPONENT = /@\/modules\/purchasing\/components\/([\w-]+)/g;

  it("the picker takes its search as a prop and never imports purchasing actions itself", () => {
    expect(readFileSync(join(ROOT, PICKER), "utf8")).not.toContain(PURCHASING_ACTIONS);
  });

  it("other modules reuse only that picker from purchasing's components (the rest call purchasing actions)", () => {
    const offenders = appFilesOutsideTenancy().flatMap((file) => {
      if (MAY_USE_PURCHASING_ACTIONS.some((allowed) => file.startsWith(allowed))) {
        return [];
      }
      const names = [
        ...readFileSync(join(ROOT, file), "utf8").matchAll(IMPORTS_PURCHASING_COMPONENT),
      ];
      return names
        .filter((match) => match[1] !== "variant-picker")
        .map((match) => `${file}: ${match[1]}`);
    });
    expect(offenders).toEqual([]);
  });
});
