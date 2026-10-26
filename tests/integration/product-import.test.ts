import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { messages } from "@/config/messages.es";
import { ForbiddenError } from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import { parseCsv } from "@/modules/products/import/csv";
import { importProducts, planImport } from "@/modules/products/import/service";
import { IMPORT_MAX_BYTES, readTable, type UploadedFile } from "@/modules/products/import/table";
import { buildTemplateCsv, buildTemplateXlsx } from "@/modules/products/import/template";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

type Actor = { id: string; role: Role };

const problems = messages.products.import.problems;

async function world() {
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: username, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  const owner = await make("owner", "OWNER");
  const warehouse = await make("warehouse", "WAREHOUSE");
  const cashier = await make("cashier", "CASHIER");
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const women = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  await testDb.category.create({
    data: { name: "Vestidos", slug: "mujer-vestidos", parentId: women.id },
  });
  await testDb.size.create({ data: { name: "M", sortOrder: 5 } });
  await testDb.color.create({ data: { name: "Rojo", sortOrder: 7 } });
  return { owner, warehouse, cashier, location };
}

const csv = (...lines: string[]): UploadedFile => {
  const bytes = new TextEncoder().encode(lines.join("\r\n"));
  return { name: "productos.csv", size: bytes.length, bytes };
};

const HEADER = "Producto,Categoría,Precio,Costo,Marca,Código,Talla,Color,Cantidad,Código de barras";

const GOOD = csv(
  HEADER,
  "Vestido floral,Mujer › Vestidos,850,380,Mango,VF1,M,Rojo,4,",
  "Vestido floral,Mujer › Vestidos,850,380,Mango,VF1,L,Verde,6,9000001",
  "Cinturón,Mujer,320,140,,,,,10,",
);

describe("importProducts", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("creates products, variants, new catalog entries and initial stock", async () => {
    const w = await world();
    const { imported, plan } = await importProducts(w.owner, GOOD, testDb);

    expect(plan.problems).toEqual([]);
    expect(imported).toEqual({ products: 2, variants: 3, units: 20 });

    const dress = await testDb.product.findUniqueOrThrow({
      where: { code: "VF1" },
      include: { brand: true, variants: { include: { size: true, color: true } } },
    });
    expect(dress).toMatchObject({
      name: "Vestido floral",
      basePriceCents: 85000,
      baseCostCents: 38000,
    });
    expect(dress.brand?.name).toBe("Mango");
    expect(dress.variants.map((v) => v.sku).sort()).toEqual(["VF1-L-VERDE", "VF1-M-ROJO"]);
    expect(dress.variants.find((v) => v.sizeId !== null && v.size?.name === "L")?.barcode).toBe(
      "9000001",
    );

    // Tallas y colores nuevos van al final del orden existente.
    expect((await testDb.size.findUniqueOrThrow({ where: { name: "L" } })).sortOrder).toBe(6);
    expect((await testDb.color.findUniqueOrThrow({ where: { name: "Verde" } })).sortOrder).toBe(8);

    const belt = await testDb.product.findFirstOrThrow({
      where: { name: "Cinturón" },
      include: { variants: true },
    });
    expect(belt.code).toMatch(/^P\d{5}$/);
    expect(belt.variants).toHaveLength(1);
    expect(belt.variants[0]?.barcode).toMatch(/^200\d{10}$/);

    const levels = await testDb.stockLevel.findMany({ orderBy: { onHand: "asc" } });
    expect(levels.map((level) => level.onHand)).toEqual([4, 6, 10]);
    const movements = await testDb.stockMovement.findMany();
    expect(movements).toHaveLength(3);
    expect(movements.every((m) => m.type === "INITIAL" && m.userId === w.owner.id)).toBe(true);

    const logs = await testDb.auditLog.findMany({ where: { action: "PRODUCT_CREATED" } });
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.reason === messages.products.import.title)).toBe(true);
  });

  it("writes nothing when any row has a problem", async () => {
    const w = await world();
    const { imported, plan } = await importProducts(
      w.owner,
      csv(
        HEADER,
        "Vestido floral,Mujer › Vestidos,850,380,Mango,VF1,M,Rojo,4,",
        "Mala,Zapatos,100,50,,,,,1,",
      ),
      testDb,
    );
    expect(imported).toBeNull();
    expect(plan.problems.map((p) => `${p.line}:${p.column}`)).toEqual(["3:Categoría"]);
    expect(await testDb.product.count()).toBe(0);
    expect(await testDb.brand.count()).toBe(0);
    expect(await testDb.stockMovement.count()).toBe(0);
  });

  it("refuses to import the same file twice", async () => {
    const w = await world();
    await importProducts(w.owner, GOOD, testDb);
    const again = await importProducts(w.owner, GOOD, testDb);
    expect(again.imported).toBeNull();
    expect(again.plan.problems.map((p) => p.message)).toEqual(
      expect.arrayContaining([
        problems.codeExists.replace("{value}", "VF1"),
        problems.productExists,
        problems.barcodeExists.replace("{value}", "9000001"),
      ]),
    );
    expect(await testDb.product.count()).toBe(2);
  });

  it("is allowed for the warehouse (without costs) and refused for the cashier", async () => {
    const w = await world();
    await expect(planImport(w.cashier, GOOD, testDb)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(importProducts(w.cashier, GOOD, testDb)).rejects.toBeInstanceOf(ForbiddenError);

    const result = await importProducts(w.warehouse, GOOD, testDb);
    expect(result.plan.costIgnored).toBe(true);
    expect(result.imported?.products).toBe(2);
    const costs = (await testDb.product.findMany()).map((p) => p.baseCostCents);
    expect(costs).toEqual([0, 0]);
  });

  it("reads Excel files, including numeric cells", async () => {
    const w = await world();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Productos");
    sheet.addRow(HEADER.split(","));
    sheet.addRow(["Blusa de lino", "Mujer", 450, 190, "", "BL1", "M", "Rojo", 6, ""]);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());

    const result = await importProducts(
      w.owner,
      { name: "productos.xlsx", size: bytes.length, bytes },
      testDb,
    );
    expect(result.plan.problems).toEqual([]);
    const blouse = await testDb.product.findUniqueOrThrow({ where: { code: "BL1" } });
    expect(blouse).toMatchObject({ basePriceCents: 45000, baseCostCents: 19000 });
    const variant = await testDb.variant.findFirstOrThrow({ where: { productId: blouse.id } });
    expect(variant.sku).toBe("BL1-M-ROJO");
  });

  it("reads CSV files saved in Windows-1252, as Excel in Spanish does", async () => {
    const w = await world();
    const bytes = new Uint8Array(
      Buffer.from(
        `${HEADER}\r\nCamisón de seda;Mujer;500;200;;CS1;;;3;`.replace(/;/g, ","),
        "latin1",
      ),
    );
    const result = await importProducts(
      w.owner,
      { name: "productos.csv", size: bytes.length, bytes },
      testDb,
    );
    expect(result.plan.problems).toEqual([]);
    expect((await testDb.product.findUniqueOrThrow({ where: { code: "CS1" } })).name).toBe(
      "Camisón de seda",
    );
  });

  it("explains unusable files", async () => {
    const w = await world();
    const message = async (file: UploadedFile) =>
      (await planImport(w.owner, file, testDb)).problems.map((p) => p.message);

    expect(await message({ ...GOOD, name: "productos.pdf" })).toEqual([problems.fileType]);
    expect(await message({ ...GOOD, size: IMPORT_MAX_BYTES + 1 })).toEqual([problems.fileTooBig]);
    const garbage = new Uint8Array([1, 2, 3, 4]);
    expect(await message({ name: "roto.xlsx", size: 4, bytes: garbage })).toEqual([
      problems.fileUnreadable,
    ]);
    expect(await message(csv(""))).toEqual([problems.fileEmpty]);
  });
});

describe("templates", () => {
  it("offers the same headers in CSV and Excel, and an empty data sheet", async () => {
    const [csvHeader] = parseCsv(buildTemplateCsv());
    expect(csvHeader).toHaveLength(14);
    expect(csvHeader?.slice(0, 3)).toEqual(["Producto", "Categoría", "Precio"]);

    const rows = await readTable({
      name: "plantilla.xlsx",
      size: 0,
      bytes: await buildTemplateXlsx(),
    });
    expect(rows).toEqual([csvHeader]);
  });
});
