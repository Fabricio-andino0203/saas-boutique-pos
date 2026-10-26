import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { slugify } from "@/lib/slug";
import type { Actor } from "@/modules/catalog/service";
import { createProductTx } from "@/modules/products/service";
import { cellKey } from "@/modules/products/sku";
import { SAMPLE_PRODUCTS } from "@/modules/settings/sample-products";

type Tx = Prisma.TransactionClient;

async function ensureCategory(tx: Tx, name: string): Promise<string> {
  const found = await tx.category.findFirst({ where: { name, archivedAt: null } });
  if (found) {
    return found.id;
  }
  return (await tx.category.create({ data: { name, slug: `ejemplo-${slugify(name)}` } })).id;
}

async function ensureBrand(tx: Tx, name: string): Promise<string> {
  return (await tx.brand.upsert({ where: { name }, update: {}, create: { name } })).id;
}

async function ensureSize(tx: Tx, name: string): Promise<string> {
  const top = await tx.size.aggregate({ _max: { sortOrder: true } });
  return (
    await tx.size.upsert({
      where: { name },
      update: {},
      create: { name, sortOrder: (top._max.sortOrder ?? 0) + 1 },
    })
  ).id;
}

async function ensureColor(tx: Tx, name: string): Promise<string> {
  const top = await tx.color.aggregate({ _max: { sortOrder: true } });
  return (
    await tx.color.upsert({
      where: { name },
      update: {},
      create: { name, sortOrder: (top._max.sortOrder ?? 0) + 1 },
    })
  ).id;
}

export async function hasSampleData(client: Pick<PrismaClient, "product"> = db): Promise<boolean> {
  return (await client.product.count({ where: { code: { startsWith: "DEMO-" } } })) > 0;
}

/** Crea las prendas de ejemplo que aún no existan (se puede repetir sin duplicar). */
export async function loadSampleData(
  actor: Actor,
  client: PrismaClient = db,
): Promise<{ created: number }> {
  requireCapability(actor, "settings.manage");
  return client.$transaction(
    async (tx) => {
      let created = 0;
      for (const sample of SAMPLE_PRODUCTS) {
        if (await tx.product.findUnique({ where: { code: sample.code } })) {
          continue;
        }
        const sizeIds = [];
        for (const name of sample.sizes) {
          sizeIds.push(await ensureSize(tx, name));
        }
        const colorIds = [];
        for (const name of sample.colors) {
          colorIds.push(await ensureColor(tx, name));
        }
        const quantities: Record<string, number> = {};
        for (const size of sizeIds.length > 0 ? sizeIds : [null]) {
          for (const color of colorIds.length > 0 ? colorIds : [null]) {
            quantities[cellKey(size, color)] = sample.quantity;
          }
        }
        await createProductTx(tx, actor, {
          code: sample.code,
          name: sample.name,
          categoryId: await ensureCategory(tx, sample.category),
          brandId: sample.brand ? await ensureBrand(tx, sample.brand) : undefined,
          basePriceCents: sample.priceCents,
          baseCostCents: sample.costCents,
          sizeIds,
          colorIds,
          quantities,
        });
        created += 1;
      }
      return { created };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
