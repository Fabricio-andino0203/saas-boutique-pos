import { messages } from "@/config/messages.es";
import type { PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { CodeTakenError } from "@/lib/errors";
import { hasCapability, requireCapability } from "@/lib/permissions";
import type { Actor } from "@/modules/catalog/service";
import { createVariantCells, freshProductCode, type Named } from "@/modules/products/service";

import { normalize } from "./columns";
import { buildImportPlan, type ImportContext, type ImportPlan, type NamedRef } from "./plan";
import { fileKind, IMPORT_MAX_BYTES, readTable, type UploadedFile } from "./table";

const problems = messages.products.import.problems;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const refs = (rows: { id: string; name: string; archivedAt: Date | null }[]): NamedRef[] =>
  rows.map((row) => ({ id: row.id, name: row.name, archived: row.archivedAt !== null }));

export async function loadImportContext(
  actor: Actor,
  client: Pick<
    PrismaClient,
    "category" | "brand" | "season" | "supplier" | "size" | "color" | "product" | "variant"
  >,
): Promise<ImportContext> {
  const [categories, brands, seasons, suppliers, sizes, colors, products, variants] =
    await Promise.all([
      client.category.findMany({
        where: { archivedAt: null },
        select: { id: true, name: true, parentId: true },
      }),
      client.brand.findMany(),
      client.season.findMany(),
      client.supplier.findMany(),
      client.size.findMany(),
      client.color.findMany(),
      client.product.findMany({ select: { code: true, name: true, categoryId: true } }),
      client.variant.findMany({ select: { barcode: true } }),
    ]);

  const byId = new Map(categories.map((category) => [category.id, category]));
  const path = (id: string): string => {
    const category = byId.get(id);
    return category
      ? category.parentId && byId.has(category.parentId)
        ? `${path(category.parentId)} › ${category.name}`
        : category.name
      : "";
  };

  return {
    canSetCost: hasCapability(actor.role, "product.viewCost"),
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      path: path(category.id),
    })),
    brands: refs(brands),
    seasons: refs(seasons),
    suppliers: refs(suppliers),
    sizes: refs(sizes),
    colors: refs(colors),
    productCodes: new Set(products.map((product) => product.code.toUpperCase())),
    productKeys: new Set(
      products.map((product) => `${normalize(product.name)}|${product.categoryId}`),
    ),
    barcodes: new Set(variants.map((variant) => variant.barcode)),
  };
}

function fileProblem(message: string): ImportPlan {
  return {
    products: [],
    problems: [{ line: 1, column: "", message }],
    totals: { products: 0, variants: 0, units: 0 },
    created: { brands: [], seasons: [], suppliers: [], sizes: [], colors: [] },
    costIgnored: false,
  };
}

/** Lee el archivo y arma el plan sin escribir nada: sirve para la vista previa y antes de importar. */
export async function planImport(
  actor: Actor,
  file: UploadedFile,
  client: PrismaClient = db,
): Promise<ImportPlan> {
  requireCapability(actor, "product.write");
  if (fileKind(file.name) === null) {
    return fileProblem(problems.fileType);
  }
  if (file.size > IMPORT_MAX_BYTES) {
    return fileProblem(problems.fileTooBig);
  }
  let rows: string[][];
  try {
    rows = await readTable(file);
  } catch {
    return fileProblem(problems.fileUnreadable);
  }
  return buildImportPlan(rows, await loadImportContext(actor, client));
}

export type ImportResult = { products: number; variants: number; units: number };

/**
 * Importa todo el archivo en una sola transacción: o entra completo o no entra nada.
 * Si hay problemas devuelve el plan para que se corrijan; no escribe.
 */
export async function importProducts(
  actor: Actor,
  file: UploadedFile,
  client: PrismaClient = db,
): Promise<{ plan: ImportPlan; imported: ImportResult | null }> {
  const plan = await planImport(actor, file, client);
  if (plan.problems.length > 0) {
    return { plan, imported: null };
  }

  await client.$transaction(
    async (tx: Tx) => {
      const lookup = {
        brands: new Map<string, string>(),
        seasons: new Map<string, string>(),
        suppliers: new Map<string, string>(),
        sizes: new Map<string, Named>(),
        colors: new Map<string, Named>(),
      };
      const [brands, seasons, suppliers, sizes, colors] = await Promise.all([
        tx.brand.findMany(),
        tx.season.findMany(),
        tx.supplier.findMany(),
        tx.size.findMany(),
        tx.color.findMany(),
      ]);
      for (const row of brands) lookup.brands.set(normalize(row.name), row.id);
      for (const row of seasons) lookup.seasons.set(normalize(row.name), row.id);
      for (const row of suppliers) lookup.suppliers.set(normalize(row.name), row.id);
      for (const row of sizes)
        lookup.sizes.set(normalize(row.name), { id: row.id, name: row.name });
      for (const row of colors)
        lookup.colors.set(normalize(row.name), { id: row.id, name: row.name });

      for (const name of plan.created.brands) {
        lookup.brands.set(normalize(name), (await tx.brand.create({ data: { name } })).id);
      }
      for (const name of plan.created.seasons) {
        lookup.seasons.set(normalize(name), (await tx.season.create({ data: { name } })).id);
      }
      for (const name of plan.created.suppliers) {
        lookup.suppliers.set(normalize(name), (await tx.supplier.create({ data: { name } })).id);
      }
      let nextSize = sizes.reduce((top, row) => Math.max(top, row.sortOrder), 0);
      for (const name of plan.created.sizes) {
        nextSize += 1;
        const created = await tx.size.create({ data: { name, sortOrder: nextSize } });
        lookup.sizes.set(normalize(name), { id: created.id, name: created.name });
      }
      let nextColor = colors.reduce((top, row) => Math.max(top, row.sortOrder), 0);
      for (const name of plan.created.colors) {
        nextColor += 1;
        const created = await tx.color.create({ data: { name, sortOrder: nextColor } });
        lookup.colors.set(normalize(name), { id: created.id, name: created.name });
      }

      for (const planned of plan.products) {
        const code = planned.code ?? (await freshProductCode(tx));
        let product;
        try {
          product = await tx.product.create({
            data: {
              code,
              name: planned.name,
              description: planned.description,
              categoryId: planned.categoryId,
              brandId: planned.brand ? (lookup.brands.get(normalize(planned.brand)) ?? null) : null,
              seasonId: planned.season
                ? (lookup.seasons.get(normalize(planned.season)) ?? null)
                : null,
              defaultSupplierId: planned.supplier
                ? (lookup.suppliers.get(normalize(planned.supplier)) ?? null)
                : null,
              basePriceCents: planned.basePriceCents,
              baseCostCents: planned.baseCostCents,
              taxCategory: planned.taxCategory,
            },
          });
        } catch (error) {
          const duplicate =
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "P2002";
          throw duplicate ? new CodeTakenError() : error;
        }

        await createVariantCells(tx, {
          product,
          actor,
          cells: planned.variants.map((variant) => ({
            size: variant.size ? (lookup.sizes.get(normalize(variant.size)) ?? null) : null,
            color: variant.color ? (lookup.colors.get(normalize(variant.color)) ?? null) : null,
            quantity: variant.quantity,
            barcode: variant.barcode ?? undefined,
          })),
        });
        await audit.log(tx, {
          userId: actor.id,
          action: "PRODUCT_CREATED",
          entityType: "Product",
          entityId: product.id,
          after: {
            code,
            name: planned.name,
            basePriceCents: planned.basePriceCents,
            baseCostCents: planned.baseCostCents,
            variants: planned.variants.length,
          },
          reason: messages.products.import.title,
        });
      }
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  return { plan, imported: plan.totals };
}
