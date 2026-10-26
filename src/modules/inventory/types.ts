import type { StockMovementType } from "@/generated/prisma/enums";

export type StockStatus = "out" | "low" | "ok";

export type StockFilter = "all" | "low" | "out" | "in";

export type StockParams = {
  q?: string;
  categoryId?: string;
  seasonId?: string;
  filter?: StockFilter;
  page?: number;
  /** Solo quien puede ver costos recibe valores a costo. */
  includeCost?: boolean;
};

export type StockCell = {
  variantId: string;
  sku: string;
  sizeName: string | null;
  colorName: string | null;
  colorHex: string | null;
  onHand: number;
  reserved: number;
  reorderPoint: number | null;
  status: StockStatus;
};

export type StockRow = {
  productId: string;
  code: string;
  name: string;
  categoryName: string;
  variantCount: number;
  onHand: number;
  status: StockStatus;
  /** Alguna variante está en su mínimo o por debajo (aunque otras tengan de sobra). */
  hasLowVariant: boolean;
  costValueCents: number | null;
  priceValueCents: number;
  cells: StockCell[];
};

export type StockTotals = {
  products: number;
  units: number;
  costValueCents: number | null;
  priceValueCents: number;
};

export type StockList = {
  rows: StockRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: StockTotals;
};

export type KardexRow = {
  id: string;
  createdAt: Date;
  type: StockMovementType;
  quantity: number;
  /** Existencia de la variante justo después de este movimiento. */
  balance: number;
  unitCostCents: number;
  reason: string | null;
  userName: string;
  locationName: string;
  document: { label: string; href: string | null } | null;
};

export type KardexHeader = {
  variantId: string;
  productId: string;
  productName: string;
  productCode: string;
  sku: string;
  barcode: string;
  sizeName: string | null;
  colorName: string | null;
  onHand: number;
  avgCostCents: number;
};

export type Kardex = {
  header: KardexHeader;
  rows: KardexRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type InventoryActionState = { error?: string; success?: string } | undefined;
