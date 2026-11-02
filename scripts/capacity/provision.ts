import "dotenv/config";

import { generateHistory } from "../../prisma/seed/history";
import { db } from "../../src/lib/db";
import { hashSecret } from "../../src/lib/password";
import { closeControlDb, controlDb } from "../../src/lib/tenancy/control-db";
import { runWithTenant } from "../../src/lib/tenancy/tenant-context";
import { openCashSession } from "../../src/modules/cash/service";
import { recordMovement } from "../../src/modules/inventory/service";
import { startProvisioning } from "../../src/modules/platform/provisioning";
import { finishScript, hasFlag, reportScriptError, tenantRefBySlug } from "../lib/tenant-run";
import {
  assertDisposableServer,
  Latencies,
  LOAD_PRODUCT_CODE,
  numberFlag,
  OWNER_PASSWORD,
  OWNER_USERNAME,
  printTable,
  slugFor,
} from "./common";

/**
 * Da de alta N negocios de prueba con el motor de alta REAL (lo mismo que hace el panel) y los llena con datos de tienda:
 * un cajero, 40 prendas con un mes de historia y una prenda de carga con inventario de sobra y la caja abierta.
 *
 *   CAPACITY_CONFIRM=<base central> pnpm capacity:provision [--count 200] [--concurrency 4] [--from 1] [--no-history]
 *
 * Se puede repetir: lo que ya existe se salta. Los nombres de producto llevan el subdominio del negocio, para que las
 * pruebas de carga detecten cualquier mezcla entre negocios.
 */

async function seedTenant(slug: string, index: number, withHistory: boolean): Promise<boolean> {
  const tenant = await tenantRefBySlug(slug);
  return runWithTenant(tenant, async () => {
    // El alta deja al propietario con una contraseña temporal (debe cambiarla al entrar); aquí nadie entra por la pantalla, y
    // las pruebas de carga por HTTP necesitan que las páginas abran. Es seguro repetirlo.
    await db.user.updateMany({
      where: { mustChangePassword: true },
      data: { mustChangePassword: false },
    });
    // El último paso es abrir la caja: si ya está abierta, este negocio quedó completo. Cada paso se salta si ya está hecho,
    // así una corrida interrumpida se retoma.
    if ((await db.cashSession.count({ where: { status: "OPEN" } })) > 0) {
      return false;
    }
    const owner = await db.user.findFirstOrThrow({ where: { role: "OWNER" } });
    if ((await db.user.count({ where: { username: "cajero" } })) === 0) {
      await db.user.create({
        data: {
          name: `Cajero ${slug}`,
          username: "cajero",
          passwordHash: await hashSecret(OWNER_PASSWORD),
          role: "CASHIER",
        },
      });
    }
    if (
      withHistory &&
      (await db.product.count({ where: { code: { startsWith: "HIST-" } } })) === 0
    ) {
      await generateHistory(db, { months: 1, salesPerDay: 6, products: 40, seed: 1000 + index });
    }
    const location = await db.location.findFirstOrThrow({ where: { isDefault: true } });
    const category = await db.category.findFirstOrThrow({ where: { slug: "mujer" } });
    const product =
      (await db.product.findUnique({ where: { code: LOAD_PRODUCT_CODE } })) ??
      (await db.product.create({
        data: {
          code: LOAD_PRODUCT_CODE,
          name: `Prenda de carga ${slug}`,
          categoryId: category.id,
          basePriceCents: 10_000,
        },
      }));
    const sizes = await db.size.findMany({ orderBy: { sortOrder: "asc" }, take: 3 });
    for (const size of sizes) {
      if ((await db.variant.count({ where: { productId: product.id, sizeId: size.id } })) > 0) {
        continue;
      }
      const variant = await db.variant.create({
        data: {
          productId: product.id,
          sizeId: size.id,
          sku: `${LOAD_PRODUCT_CODE}-${size.name}`,
          barcode: `CAP${String(index).padStart(4, "0")}${size.name}`,
          avgCostCents: 4_000,
        },
      });
      await db.$transaction((tx) =>
        recordMovement(tx, {
          variantId: variant.id,
          locationId: location.id,
          userId: owner.id,
          type: "INITIAL",
          quantity: 100_000,
        }),
      );
    }
    await db.$executeRaw`UPDATE "Product" SET "name" = "name" || ${` [${slug}]`} WHERE "name" NOT LIKE '%[cap-%'`;
    await openCashSession({ id: owner.id, role: "OWNER" }, { openingFloatCents: 100_000 });
    return true;
  });
}

async function main(): Promise<void> {
  assertDisposableServer();
  const count = numberFlag("count", 200);
  const from = numberFlag("from", 1);
  const concurrency = numberFlag("concurrency", 4);
  const withHistory = !hasFlag("no-history");

  const plan = await controlDb.plan.findFirst({ where: { name: "Estándar" } });
  if (!plan) {
    throw new Error("Falta el plan «Estándar»: corre antes «pnpm billing:seed-plans».");
  }

  const indexes = Array.from({ length: count }, (_, offset) => from + offset);
  const provisionTimes = new Latencies();
  const seedTimes = new Latencies();
  const failures: string[] = [];
  let skipped = 0;
  const started = performance.now();

  const worker = async (): Promise<void> => {
    for (let index = indexes.shift(); index !== undefined; index = indexes.shift()) {
      const slug = slugFor(index);
      try {
        const existing = await controlDb.tenant.findUnique({
          where: { slug },
          select: { status: true },
        });
        if (existing?.status !== "ACTIVE") {
          const at = performance.now();
          const outcome = await startProvisioning(
            {
              slug,
              name: `Boutique ${slug}`,
              ownerName: `Dueño ${slug}`,
              ownerUsername: OWNER_USERNAME,
              ownerPassword: OWNER_PASSWORD,
              planId: plan.id,
            },
            { actor: null },
          );
          if (outcome.status !== "SUCCEEDED") {
            throw new Error(`alta detenida en «${outcome.step}»: ${outcome.error}`);
          }
          provisionTimes.add(performance.now() - at);
        } else {
          skipped += 1;
        }
        const at = performance.now();
        if (await seedTenant(slug, index, withHistory)) {
          seedTimes.add(performance.now() - at);
        }
      } catch (error) {
        failures.push(`${slug}: ${error instanceof Error ? error.message : String(error)}`);
      }
      const done = count - indexes.length;
      if (done % 10 === 0) {
        console.log(`  … ${done}/${count}`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const seconds = Math.round((performance.now() - started) / 1000);
  const provisioned = provisionTimes.summary();
  const seeded = seedTimes.summary();
  printTable("Altas y datos de prueba", [
    ["", "cuántos", "media ms", "p50 ms", "p95 ms", "máx ms"],
    [
      "alta (receta completa)",
      provisioned.count,
      provisioned.mean,
      provisioned.p50,
      provisioned.p95,
      provisioned.max,
    ],
    ["datos de tienda", seeded.count, seeded.mean, seeded.p50, seeded.p95, seeded.max],
  ]);
  console.log(
    `\nTotal ${seconds} s con ${concurrency} a la vez · ya existían ${skipped} · fallaron ${failures.length}`,
  );
  for (const failure of failures.slice(0, 10)) {
    console.error(`  ${failure}`);
  }
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch(reportScriptError)
  .finally(async () => {
    await finishScript();
    await closeControlDb();
  });
