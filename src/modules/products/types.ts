export type Option = { value: string; label: string };

export type ProductFormOptions = {
  categories: Option[];
  brands: Option[];
  seasons: Option[];
  suppliers: Option[];
  sizes: { id: string; name: string }[];
  colors: { id: string; name: string; hex: string | null }[];
};

export type ProductListParams = {
  q?: string;
  categoryId?: string;
  brandId?: string;
  status?: "active" | "archived" | "all";
  page?: number;
};

export type ProductRow = {
  id: string;
  code: string;
  name: string;
  categoryName: string;
  brandName: string;
  basePriceCents: number;
  baseCostCents: number;
  variantCount: number;
  onHand: number;
  lowStock: boolean;
  archived: boolean;
  /** La foto principal del producto, o `null` si no tiene. */
  coverImageId: string | null;
};

export type ProductList = {
  rows: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type VariantRow = {
  id: string;
  sku: string;
  barcode: string;
  sizeName: string | null;
  colorName: string | null;
  colorHex: string | null;
  sizeId: string | null;
  colorId: string | null;
  priceCents: number | null;
  costCents: number | null;
  reorderPoint: number | null;
  onHand: number;
  archived: boolean;
};

export type PriceHistoryRow = {
  id: string;
  changedAt: Date;
  changedBy: string;
  variantLabel: string | null;
  oldPriceCents: number;
  newPriceCents: number;
  oldCostCents: number;
  newCostCents: number;
  reason: string | null;
};

export type ProductDetail = {
  id: string;
  code: string;
  name: string;
  description: string;
  categoryId: string;
  brandId: string;
  seasonId: string;
  supplierId: string;
  basePriceCents: number;
  baseCostCents: number;
  taxCategory: "STANDARD" | "EXEMPT";
  archived: boolean;
  variants: VariantRow[];
  history: PriceHistoryRow[];
};
