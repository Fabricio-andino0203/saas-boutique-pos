import { MAX_CENTS, PRODUCT_LIMITS } from "@/config/constants";
import { messages } from "@/config/messages.es";
import { parseMoney } from "@/lib/format";

import {
  headerLabel,
  mapHeaders,
  normalize,
  REQUIRED_COLUMNS,
  type ImportColumnKey,
} from "./columns";

const problems = messages.products.import.problems;

export const IMPORT_MAX_ROWS = 1000;

export type NamedRef = { id: string; name: string; archived: boolean };

/** Lo que el planificador necesita saber de la base de datos (se carga antes y se pasa completo). */
export type ImportContext = {
  /** Si el rol no puede ver ni cargar costos, la columna Costo se ignora. */
  canSetCost: boolean;
  categories: { id: string; name: string; path: string }[];
  brands: NamedRef[];
  seasons: NamedRef[];
  suppliers: NamedRef[];
  sizes: NamedRef[];
  colors: NamedRef[];
  /** Códigos de producto existentes, en mayúsculas. */
  productCodes: Set<string>;
  /** `nombre normalizado|id de categoría` de los productos existentes. */
  productKeys: Set<string>;
  barcodes: Set<string>;
};

export type ImportProblem = { line: number; column: string; message: string };

export type PlannedVariant = {
  line: number;
  size: string | null;
  color: string | null;
  quantity: number;
  barcode: string | null;
};

export type PlannedProduct = {
  line: number;
  code: string | null;
  name: string;
  categoryId: string;
  brand: string | null;
  season: string | null;
  supplier: string | null;
  basePriceCents: number;
  baseCostCents: number;
  taxCategory: "STANDARD" | "EXEMPT";
  description: string | null;
  variants: PlannedVariant[];
};

export type ImportPlan = {
  products: PlannedProduct[];
  problems: ImportProblem[];
  totals: { products: number; variants: number; units: number };
  /** Nombres que todavía no existen y se crearán al importar. */
  created: {
    brands: string[];
    seasons: string[];
    suppliers: string[];
    sizes: string[];
    colors: string[];
  };
  costIgnored: boolean;
};

const fill = (template: string, value = ""): string => template.replace("{value}", value);

function normalizePath(text: string): string {
  return text
    .split(/[›>/]/)
    .map((part) => normalize(part))
    .join(" › ");
}

type RefKind = "brands" | "seasons" | "suppliers" | "sizes" | "colors";

type Group = {
  key: string;
  product: PlannedProduct;
  /** Valores normalizados de la primera fila, para detectar filas que no coinciden. */
  first: {
    categoryKey: string;
    price: number | null;
    cost: number | null;
    refs: Record<string, string>;
  };
  variantKeys: Set<string>;
};

export function buildImportPlan(rows: string[][], context: ImportContext): ImportPlan {
  const found: ImportProblem[] = [];
  const created: ImportPlan["created"] = {
    brands: [],
    seasons: [],
    suppliers: [],
    sizes: [],
    colors: [],
  };
  const createdKeys: Record<RefKind, Set<string>> = {
    brands: new Set(),
    seasons: new Set(),
    suppliers: new Set(),
    sizes: new Set(),
    colors: new Set(),
  };
  const plan = (overrides: Partial<ImportPlan> = {}): ImportPlan => ({
    products: [],
    problems: found,
    totals: { products: 0, variants: 0, units: 0 },
    created,
    costIgnored: false,
    ...overrides,
  });

  const [headerRow, ...rawData] = rows;
  const data = rawData
    .map((cells, index) => ({ cells, line: index + 2 }))
    .filter(({ cells }) => cells.some((cell) => cell.trim() !== ""));
  if (!headerRow || data.length === 0) {
    found.push({ line: 1, column: "", message: problems.fileEmpty });
    return plan();
  }

  const columns = mapHeaders(headerRow);
  for (const key of REQUIRED_COLUMNS) {
    if (columns[key] === undefined) {
      found.push({
        line: 1,
        column: headerLabel(key),
        message: fill(problems.missingHeader, headerLabel(key)),
      });
    }
  }
  if (found.length > 0) {
    return plan();
  }
  if (data.length > IMPORT_MAX_ROWS) {
    found.push({ line: 1, column: "", message: problems.tooManyRows });
    return plan();
  }

  const categoriesByPath = new Map(context.categories.map((c) => [normalizePath(c.path), c.id]));
  const categoriesByName = new Map<string, string[]>();
  for (const category of context.categories) {
    const key = normalize(category.name);
    categoriesByName.set(key, [...(categoriesByName.get(key) ?? []), category.id]);
  }
  const refs: Record<RefKind, Map<string, NamedRef>> = {
    brands: new Map(context.brands.map((r) => [normalize(r.name), r])),
    seasons: new Map(context.seasons.map((r) => [normalize(r.name), r])),
    suppliers: new Map(context.suppliers.map((r) => [normalize(r.name), r])),
    sizes: new Map(context.sizes.map((r) => [normalize(r.name), r])),
    colors: new Map(context.colors.map((r) => [normalize(r.name), r])),
  };

  const problem = (line: number, key: ImportColumnKey, message: string) =>
    found.push({ line, column: headerLabel(key), message });

  /** Valida un nombre de catálogo: lo reconoce, avisa si está archivado o lo marca para crear. */
  const checkRef = (
    kind: RefKind,
    text: string,
    line: number,
    key: ImportColumnKey,
  ): string | null => {
    if (text === "") {
      return null;
    }
    const name = normalize(text);
    const existing = refs[kind].get(name);
    if (existing?.archived) {
      problem(line, key, fill(problems.archivedRef, text));
    } else if (!existing && !createdKeys[kind].has(name)) {
      createdKeys[kind].add(name);
      created[kind].push(text);
    }
    return text;
  };

  const resolveCategory = (text: string, line: number): string | null => {
    if (text === "") {
      problem(line, "category", problems.categoryRequired);
      return null;
    }
    const byPath = categoriesByPath.get(normalizePath(text));
    if (byPath) {
      return byPath;
    }
    const byName = categoriesByName.get(normalize(text)) ?? [];
    if (byName.length === 1) {
      return byName[0] ?? null;
    }
    problem(
      line,
      "category",
      fill(byName.length > 1 ? problems.categoryAmbiguous : problems.categoryUnknown, text),
    );
    return null;
  };

  let costSeen = false;
  const groups = new Map<string, Group>();
  const fileBarcodes = new Set<string>();

  for (const { cells, line } of data) {
    const cell = (key: ImportColumnKey): string => {
      const index = columns[key];
      return index === undefined ? "" : (cells[index] ?? "").trim();
    };

    const name = cell("name");
    if (name === "") {
      problem(line, "name", problems.nameRequired);
      continue;
    }
    const categoryText = cell("category");
    const categoryId = resolveCategory(categoryText, line);

    const priceText = cell("price");
    const price = parseMoney(priceText);
    const priceOk = price !== null && price >= 1 && price <= MAX_CENTS;
    const costText = cell("cost");
    if (costText !== "") {
      costSeen = true;
    }
    const cost = !context.canSetCost || costText === "" ? 0 : parseMoney(costText);
    const costOk = cost !== null && cost <= MAX_CENTS;

    const groupKey = `${normalize(name)}|${categoryId ?? `?${normalize(categoryText)}`}`;
    let group = groups.get(groupKey);

    if (!group) {
      if (!priceOk) {
        problem(line, "price", problems.priceInvalid);
      }
      if (!costOk) {
        problem(line, "cost", problems.costInvalid);
      }
      const taxText = normalize(cell("tax"));
      let taxCategory: "STANDARD" | "EXEMPT" = "STANDARD";
      if (["exento", "exenta"].includes(taxText)) {
        taxCategory = "EXEMPT";
      } else if (!["", "isv", "con isv", "gravado", "standard"].includes(taxText)) {
        problem(line, "tax", problems.taxInvalid);
      }

      const brand = checkRef("brands", cell("brand"), line, "brand");
      const season = checkRef("seasons", cell("season"), line, "season");
      const supplier = checkRef("suppliers", cell("supplier"), line, "supplier");

      const codeText = cell("code").toUpperCase();
      if (codeText !== "" && !/^[A-Z0-9-]{2,20}$/.test(codeText)) {
        problem(line, "code", problems.codeInvalid);
      } else if (codeText !== "" && context.productCodes.has(codeText)) {
        problem(line, "code", fill(problems.codeExists, codeText));
      } else if (codeText !== "" && [...groups.values()].some((g) => g.product.code === codeText)) {
        problem(line, "code", fill(problems.codeExists, codeText));
      }
      if (categoryId && context.productKeys.has(`${normalize(name)}|${categoryId}`)) {
        problem(line, "name", problems.productExists);
      }

      group = {
        key: groupKey,
        product: {
          line,
          code: codeText === "" ? null : codeText,
          name,
          categoryId: categoryId ?? "",
          brand,
          season,
          supplier,
          basePriceCents: priceOk ? price : 0,
          baseCostCents: costOk ? (cost ?? 0) : 0,
          taxCategory,
          description: cell("description") || null,
          variants: [],
        },
        first: {
          categoryKey: categoryId ?? "",
          price: priceOk ? price : null,
          cost: costOk ? cost : null,
          refs: {
            brand: normalize(brand ?? ""),
            season: normalize(season ?? ""),
            supplier: normalize(supplier ?? ""),
          },
        },
        variantKeys: new Set(),
      };
      groups.set(groupKey, group);
    } else {
      // Filas siguientes del mismo producto: deben coincidir con la primera en lo que es del producto.
      const sameCategory = (categoryId ?? "") === group.first.categoryKey;
      const samePrice = priceText === "" || (priceOk && price === group.first.price);
      const sameCost =
        costText === "" || !context.canSetCost || (costOk && cost === group.first.cost);
      if (!sameCategory) {
        problem(line, "category", problems.conflict);
      }
      if (!samePrice) {
        problem(line, "price", problems.conflict);
      }
      if (!sameCost) {
        problem(line, "cost", problems.conflict);
      }
      const later: [ImportColumnKey, RefKind][] = [
        ["brand", "brands"],
        ["season", "seasons"],
        ["supplier", "suppliers"],
      ];
      for (const [key, kind] of later) {
        const text = cell(key);
        if (text !== "" && normalize(text) !== group.first.refs[key]) {
          problem(line, key, problems.conflict);
        } else {
          checkRef(kind, text, line, key);
        }
      }
      const codeText = cell("code").toUpperCase();
      if (codeText !== "" && group.product.code !== null && codeText !== group.product.code) {
        problem(line, "code", problems.sameNameDifferentCode);
      } else if (codeText !== "" && group.product.code === null) {
        group.product.code = codeText;
      }
    }

    // Variante de esta fila
    const sizeText = checkRef("sizes", cell("size"), line, "size");
    const colorText = checkRef("colors", cell("color"), line, "color");
    const variantKey = `${normalize(sizeText ?? "")}|${normalize(colorText ?? "")}`;
    if (group.variantKeys.has(variantKey)) {
      problem(line, "size", problems.variantDuplicate);
    }
    group.variantKeys.add(variantKey);

    const quantityText = cell("quantity");
    let quantity = 0;
    if (quantityText !== "") {
      if (/^\d{1,6}$/.test(quantityText)) {
        quantity = Number(quantityText);
      } else {
        problem(line, "quantity", problems.quantityInvalid);
      }
    }

    const barcodeText = cell("barcode");
    let barcode: string | null = null;
    if (barcodeText !== "") {
      if (!/^[A-Za-z0-9-]{4,32}$/.test(barcodeText)) {
        problem(line, "barcode", problems.barcodeInvalid);
      } else if (fileBarcodes.has(barcodeText)) {
        problem(line, "barcode", fill(problems.barcodeDuplicate, barcodeText));
      } else if (context.barcodes.has(barcodeText)) {
        problem(line, "barcode", fill(problems.barcodeExists, barcodeText));
      } else {
        barcode = barcodeText;
        fileBarcodes.add(barcodeText);
      }
    }

    group.product.variants.push({
      line,
      size: sizeText,
      color: colorText,
      quantity,
      barcode,
    });
  }

  const products = [...groups.values()].map((group) => group.product);
  for (const product of products) {
    if (product.variants.length > PRODUCT_LIMITS.maxVariantsPerBatch) {
      found.push({
        line: product.line,
        column: headerLabel("name"),
        message: problems.tooManyVariants,
      });
    }
  }

  found.sort((a, b) => a.line - b.line);
  return plan({
    products,
    totals: {
      products: products.length,
      variants: products.reduce((sum, product) => sum + product.variants.length, 0),
      units: products.reduce(
        (sum, product) => sum + product.variants.reduce((inner, v) => inner + v.quantity, 0),
        0,
      ),
    },
    costIgnored: costSeen && !context.canSetCost,
  });
}
