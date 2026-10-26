import { describe, expect, it } from "vitest";

import { messages } from "@/config/messages.es";
import { mapHeaders, normalize } from "@/modules/products/import/columns";
import { detectDelimiter, parseCsv, toCsvLine } from "@/modules/products/import/csv";
import {
  buildImportPlan,
  IMPORT_MAX_ROWS,
  type ImportContext,
} from "@/modules/products/import/plan";

const problems = messages.products.import.problems;

describe("parseCsv", () => {
  it("reads simple rows and ignores the trailing line break", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quotes, escaped quotes, delimiters and line breaks inside quotes", () => {
    expect(parseCsv('"a,b","say ""hi""","line1\nline2"\r\nx,y,z')).toEqual([
      ["a,b", 'say "hi"', "line1\nline2"],
      ["x", "y", "z"],
    ]);
  });

  it("detects semicolons (Excel in Spanish) and tabs", () => {
    expect(parseCsv("Producto;Precio\nBlusa;250")).toEqual([
      ["Producto", "Precio"],
      ["Blusa", "250"],
    ]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(detectDelimiter("solo una columna")).toBe(",");
  });

  it("drops the BOM and keeps empty cells", () => {
    expect(parseCsv("﻿a,,c\n,,")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });

  it("returns nothing for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("toCsvLine", () => {
  it("quotes only when needed", () => {
    expect(toCsvLine(["a", "b c", 'x"y', "p,q", "line\nbreak"])).toBe(
      'a,b c,"x""y","p,q","line\nbreak"',
    );
  });
});

describe("headers", () => {
  it("normalizes accents, case, asterisks and spaces", () => {
    expect(normalize("  Código  de   Barras* ")).toBe("codigo de barras");
  });

  it("recognizes titles and their aliases", () => {
    const map = mapHeaders([
      "Nombre",
      "CATEGORÍA",
      "Precio de venta",
      "SKU",
      "Código de barras",
      "Stock",
      "???",
    ]);
    expect(map).toEqual({ name: 0, category: 1, price: 2, code: 3, barcode: 4, quantity: 5 });
  });
});

const context = (overrides: Partial<ImportContext> = {}): ImportContext => ({
  canSetCost: true,
  categories: [
    { id: "c-women", name: "Mujer", path: "Mujer" },
    { id: "c-dress", name: "Vestidos", path: "Mujer › Vestidos" },
    { id: "c-men-tops", name: "Blusas", path: "Hombre › Blusas" },
    { id: "c-women-tops", name: "Blusas", path: "Mujer › Blusas" },
  ],
  brands: [{ id: "b1", name: "Zara", archived: false }],
  seasons: [],
  suppliers: [],
  sizes: [
    { id: "s-m", name: "M", archived: false },
    { id: "s-xs", name: "XS", archived: true },
  ],
  colors: [{ id: "k-red", name: "Rojo", archived: false }],
  productCodes: new Set(["VES1"]),
  productKeys: new Set(["blusa vieja|c-women"]),
  barcodes: new Set(["7000000000001"]),
  ...overrides,
});

const HEADER = [
  "Producto",
  "Categoría",
  "Precio",
  "Costo",
  "Marca",
  "Temporada",
  "Proveedor",
  "Código",
  "Talla",
  "Color",
  "Cantidad",
  "Código de barras",
  "Impuesto",
  "Descripción",
];

function row(values: Partial<Record<(typeof HEADER)[number], string>>): string[] {
  return HEADER.map((title) => values[title] ?? "");
}

const lines = (plan: ReturnType<typeof buildImportPlan>) =>
  plan.problems.map((p) => `${p.line}:${p.column}:${p.message}`);

describe("buildImportPlan", () => {
  it("groups rows of the same product into variants and totals them", () => {
    const plan = buildImportPlan(
      [
        HEADER,
        row({
          Producto: "Vestido floral",
          Categoría: "Mujer › Vestidos",
          Precio: "1,250.50",
          Costo: "600",
          Marca: "zara",
          Talla: "M",
          Color: "Rojo",
          Cantidad: "4",
        }),
        row({
          Producto: "vestido FLORAL",
          Categoría: "mujer > vestidos",
          Precio: "1250.5",
          Costo: "600",
          Talla: "S",
          Color: "Rojo",
          Cantidad: "6",
          "Código de barras": "7001",
        }),
        row({ Producto: "Cinturón", Categoría: "Mujer", Precio: "L 320" }),
      ],
      context(),
    );

    expect(plan.problems).toEqual([]);
    expect(plan.totals).toEqual({ products: 2, variants: 3, units: 10 });
    const dress = plan.products[0]!;
    expect(dress).toMatchObject({
      name: "Vestido floral",
      categoryId: "c-dress",
      basePriceCents: 125050,
      baseCostCents: 60000,
      brand: "zara", // se conserva como se escribió; al importar se busca la marca por su nombre normalizado
      taxCategory: "STANDARD",
    });
    expect(dress.variants.map((v) => [v.size, v.color, v.quantity, v.barcode])).toEqual([
      ["M", "Rojo", 4, null],
      ["S", "Rojo", 6, "7001"],
    ]);
    expect(plan.products[1]).toMatchObject({
      name: "Cinturón",
      categoryId: "c-women",
      basePriceCents: 32000,
    });
    expect(plan.products[1]?.variants).toEqual([
      { line: 4, size: null, color: null, quantity: 0, barcode: null },
    ]);
    // "S" no existe todavía: se crea. "M" y "Rojo" ya existen.
    expect(plan.created).toEqual({
      brands: [],
      seasons: [],
      suppliers: [],
      sizes: ["S"],
      colors: [],
    });
  });

  it("lists new brands, seasons, suppliers, sizes and colors once each", () => {
    const plan = buildImportPlan(
      [
        HEADER,
        row({
          Producto: "A",
          Categoría: "Mujer",
          Precio: "10",
          Marca: "Mango",
          Temporada: "PV26",
          Proveedor: "Textiles",
          Talla: "L",
          Color: "Verde",
        }),
        row({
          Producto: "B",
          Categoría: "Mujer",
          Precio: "10",
          Marca: "MANGO",
          Temporada: "pv26",
          Proveedor: "textiles",
          Talla: "l",
          Color: "verde",
        }),
      ],
      context(),
    );
    expect(plan.problems).toEqual([]);
    expect(plan.created).toEqual({
      brands: ["Mango"],
      seasons: ["PV26"],
      suppliers: ["Textiles"],
      sizes: ["L"],
      colors: ["Verde"],
    });
  });

  it("reports the line and column of every problem", () => {
    const plan = buildImportPlan(
      [
        HEADER,
        row({ Producto: "", Categoría: "Mujer", Precio: "10" }),
        row({ Producto: "Sin categoría", Categoría: "", Precio: "10" }),
        row({ Producto: "Categoría rara", Categoría: "Zapatos", Precio: "10" }),
        row({ Producto: "Ambigua", Categoría: "Blusas", Precio: "10" }),
        row({ Producto: "Precio malo", Categoría: "Mujer", Precio: "abc" }),
        row({ Producto: "Precio cero", Categoría: "Mujer", Precio: "0" }),
        row({ Producto: "Costo malo", Categoría: "Mujer", Precio: "10", Costo: "x" }),
        row({ Producto: "Cantidad mala", Categoría: "Mujer", Precio: "10", Cantidad: "2.5" }),
        row({ Producto: "Impuesto malo", Categoría: "Mujer", Precio: "10", Impuesto: "tal vez" }),
        row({ Producto: "Código malo", Categoría: "Mujer", Precio: "10", Código: "a b" }),
        row({ Producto: "Código usado", Categoría: "Mujer", Precio: "10", Código: "ves1" }),
        row({ Producto: "Blusa vieja", Categoría: "Mujer", Precio: "10" }),
        row({
          Producto: "Barras malo",
          Categoría: "Mujer",
          Precio: "10",
          "Código de barras": "ab",
        }),
        row({
          Producto: "Barras usado",
          Categoría: "Mujer",
          Precio: "10",
          "Código de barras": "7000000000001",
        }),
        row({ Producto: "Talla archivada", Categoría: "Mujer", Precio: "10", Talla: "xs" }),
      ],
      context(),
    );
    expect(lines(plan)).toEqual([
      `2:Producto:${problems.nameRequired}`,
      `3:Categoría:${problems.categoryRequired}`,
      `4:Categoría:${problems.categoryUnknown.replace("{value}", "Zapatos")}`,
      `5:Categoría:${problems.categoryAmbiguous.replace("{value}", "Blusas")}`,
      `6:Precio:${problems.priceInvalid}`,
      `7:Precio:${problems.priceInvalid}`,
      `8:Costo:${problems.costInvalid}`,
      `9:Cantidad:${problems.quantityInvalid}`,
      `10:Impuesto:${problems.taxInvalid}`,
      `11:Código:${problems.codeInvalid}`,
      `12:Código:${problems.codeExists.replace("{value}", "VES1")}`,
      `13:Producto:${problems.productExists}`,
      `14:Código de barras:${problems.barcodeInvalid}`,
      `15:Código de barras:${problems.barcodeExists.replace("{value}", "7000000000001")}`,
      `16:Talla:${problems.archivedRef.replace("{value}", "xs")}`,
    ]);
  });

  it("flags rows that disagree with the first row of their product", () => {
    const plan = buildImportPlan(
      [
        HEADER,
        row({
          Producto: "Blusa",
          Categoría: "Mujer",
          Precio: "100",
          Costo: "40",
          Marca: "Zara",
          Talla: "M",
        }),
        row({
          Producto: "Blusa",
          Categoría: "Mujer",
          Precio: "120",
          Costo: "50",
          Marca: "Otra",
          Talla: "L",
        }),
        row({ Producto: "Blusa", Categoría: "Mujer", Precio: "", Talla: "M" }),
      ],
      context(),
    );
    expect(lines(plan)).toEqual([
      `3:Precio:${problems.conflict}`,
      `3:Costo:${problems.conflict}`,
      `3:Marca:${problems.conflict}`,
      `4:Talla:${problems.variantDuplicate}`,
    ]);
  });

  it("flags repeated barcodes and codes inside the file", () => {
    const plan = buildImportPlan(
      [
        HEADER,
        row({
          Producto: "A",
          Categoría: "Mujer",
          Precio: "10",
          Código: "abc1",
          Talla: "M",
          "Código de barras": "8000",
        }),
        row({
          Producto: "A",
          Categoría: "Mujer",
          Precio: "10",
          Código: "abc1",
          Talla: "L",
          "Código de barras": "8000",
        }),
        row({ Producto: "B", Categoría: "Mujer", Precio: "10", Código: "ABC1" }),
      ],
      context(),
    );
    expect(lines(plan)).toEqual([
      `3:Código de barras:${problems.barcodeDuplicate.replace("{value}", "8000")}`,
      `4:Código:${problems.codeExists.replace("{value}", "ABC1")}`,
    ]);
  });

  it("takes the product code from any of its rows and rejects two different codes", () => {
    const ok = buildImportPlan(
      [
        HEADER,
        row({ Producto: "A", Categoría: "Mujer", Precio: "10", Talla: "M" }),
        row({ Producto: "A", Categoría: "Mujer", Precio: "10", Talla: "L", Código: "zz-9" }),
      ],
      context(),
    );
    expect(ok.problems).toEqual([]);
    expect(ok.products[0]?.code).toBe("ZZ-9");

    const bad = buildImportPlan(
      [
        HEADER,
        row({ Producto: "A", Categoría: "Mujer", Precio: "10", Código: "ZZ1" }),
        row({ Producto: "A", Categoría: "Mujer", Precio: "10", Código: "ZZ2", Talla: "L" }),
      ],
      context(),
    );
    expect(lines(bad)).toEqual([`3:Código:${problems.sameNameDifferentCode}`]);
  });

  it("reads the exempt tax and ignores costs for roles that cannot set them", () => {
    const plan = buildImportPlan(
      [
        HEADER,
        row({
          Producto: "Libro",
          Categoría: "Mujer",
          Precio: "10",
          Costo: "4",
          Impuesto: "Exento",
        }),
      ],
      context({ canSetCost: false }),
    );
    expect(plan.problems).toEqual([]);
    expect(plan.products[0]).toMatchObject({ taxCategory: "EXEMPT", baseCostCents: 0 });
    expect(plan.costIgnored).toBe(true);
  });

  it("explains missing columns, empty files and oversized files", () => {
    expect(lines(buildImportPlan([], context()))).toEqual([`1::${problems.fileEmpty}`]);
    expect(lines(buildImportPlan([HEADER], context()))).toEqual([`1::${problems.fileEmpty}`]);
    expect(
      lines(
        buildImportPlan(
          [
            ["Producto", "Marca"],
            ["A", "B"],
          ],
          context(),
        ),
      ),
    ).toEqual([
      `1:Categoría:${problems.missingHeader.replace("{value}", "Categoría")}`,
      `1:Precio:${problems.missingHeader.replace("{value}", "Precio")}`,
    ]);

    const many = [
      HEADER,
      ...Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) =>
        row({ Producto: `P${i}`, Categoría: "Mujer", Precio: "10" }),
      ),
    ];
    expect(lines(buildImportPlan(many, context()))).toEqual([`1::${problems.tooManyRows}`]);
  });

  it("skips blank rows but keeps real line numbers", () => {
    const plan = buildImportPlan(
      [HEADER, row({}), row({ Producto: "Blusa", Categoría: "Mujer", Precio: "abc" })],
      context(),
    );
    expect(lines(plan)).toEqual([`3:Precio:${problems.priceInvalid}`]);
  });

  it("limits a product to 200 variants", () => {
    const many = [
      HEADER,
      ...Array.from({ length: 201 }, (_, i) =>
        row({ Producto: "Gigante", Categoría: "Mujer", Precio: "10", Talla: `T${i}` }),
      ),
    ];
    const plan = buildImportPlan(many, context());
    expect(lines(plan)).toEqual([`2:Producto:${problems.tooManyVariants}`]);
  });
});
