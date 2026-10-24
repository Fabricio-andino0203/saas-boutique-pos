-- Restricciones que Prisma no puede expresar: extensiones, unicidad con NULLs,
-- índices parciales, CHECK de integridad, tablas de solo inserción e índices de búsqueda.
-- Mantener sincronizado con docs/DATA_MODEL.md.

-- ── Extensiones (idempotente; en local ya las crea docker/postgres/init) ──
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ── Unicidad ──
-- (productId, sizeId, colorId) único aunque talla o color sean NULL.
CREATE UNIQUE INDEX "Variant_productId_sizeId_colorId_key"
  ON "Variant" ("productId", "sizeId", "colorId") NULLS NOT DISTINCT;

-- Máximo una caja abierta por usuario y por terminal.
CREATE UNIQUE INDEX "CashSession_one_open_per_user"
  ON "CashSession" ("userId") WHERE "status" = 'OPEN';
CREATE UNIQUE INDEX "CashSession_one_open_per_terminal"
  ON "CashSession" ("terminalId") WHERE "status" = 'OPEN';

-- Un solo rango fiscal activo por tipo de documento y terminal (NULL = rango general).
CREATE UNIQUE INDEX "FiscalRange_one_active_per_type_terminal"
  ON "FiscalRange" ("documentType", COALESCE("terminalId", '')) WHERE "isActive";

-- ── CHECK de integridad ──
ALTER TABLE "StockLevel"
  ADD CONSTRAINT "StockLevel_reserved_nonneg" CHECK ("reserved" >= 0);
-- onHand >= 0 NO se fuerza aquí: el stock negativo es una opción de configuración
-- (sales.allowNegativeStock) y la validación vive en inventory.recordMovement.

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_quantity_nonzero" CHECK ("quantity" <> 0);

ALTER TABLE "FiscalRange"
  ADD CONSTRAINT "FiscalRange_range_valid" CHECK ("rangeStart" <= "rangeEnd"),
  ADD CONSTRAINT "FiscalRange_next_in_range"
    CHECK ("nextNumber" >= "rangeStart" AND "nextNumber" <= "rangeEnd" + 1);

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_money_nonneg" CHECK ("basePriceCents" >= 0 AND "baseCostCents" >= 0);

ALTER TABLE "Variant"
  ADD CONSTRAINT "Variant_money_nonneg"
    CHECK (("priceCents" IS NULL OR "priceCents" >= 0)
       AND ("costCents" IS NULL OR "costCents" >= 0)
       AND "avgCostCents" >= 0);

ALTER TABLE "PriceHistory"
  ADD CONSTRAINT "PriceHistory_has_target" CHECK ("productId" IS NOT NULL OR "variantId" IS NOT NULL);

ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_qty_valid" CHECK ("orderedQty" > 0 AND "receivedQty" >= 0),
  ADD CONSTRAINT "PurchaseOrderItem_cost_nonneg" CHECK ("unitCostCents" >= 0);

ALTER TABLE "GoodsReceiptItem"
  ADD CONSTRAINT "GoodsReceiptItem_valid" CHECK ("quantity" > 0 AND "unitCostCents" >= 0);

ALTER TABLE "StockCountItem"
  ADD CONSTRAINT "StockCountItem_counted_nonneg" CHECK ("countedQty" >= 0);

ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_credit_nonneg" CHECK ("storeCreditCents" >= 0);

ALTER TABLE "CashSession"
  ADD CONSTRAINT "CashSession_float_nonneg" CHECK ("openingFloatCents" >= 0);

ALTER TABLE "CashMovement"
  ADD CONSTRAINT "CashMovement_amount_positive" CHECK ("amountCents" > 0);

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_money_valid"
    CHECK ("subtotalCents" >= 0 AND "discountCents" >= 0 AND "taxCents" >= 0
       AND "totalCents" >= 0 AND "paidCents" >= 0 AND "changeCents" >= 0
       AND "discountCents" <= "subtotalCents");

ALTER TABLE "SaleItem"
  ADD CONSTRAINT "SaleItem_valid"
    CHECK ("quantity" > 0 AND "unitPriceCents" >= 0 AND "unitCostCents" >= 0
       AND "lineDiscountCents" >= 0 AND "taxRate" >= 0 AND "taxCents" >= 0
       AND "lineTotalCents" >= 0);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive" CHECK ("amountCents" > 0);

ALTER TABLE "ReturnDoc"
  ADD CONSTRAINT "ReturnDoc_refund_nonneg" CHECK ("refundCents" >= 0);

ALTER TABLE "ReturnItem"
  ADD CONSTRAINT "ReturnItem_valid" CHECK ("quantity" > 0 AND "refundCents" >= 0);

ALTER TABLE "Layaway"
  ADD CONSTRAINT "Layaway_money_valid"
    CHECK ("totalCents" >= 0 AND "paidCents" >= 0 AND "paidCents" <= "totalCents");

ALTER TABLE "LayawayItem"
  ADD CONSTRAINT "LayawayItem_valid" CHECK ("quantity" > 0 AND "unitPriceCents" >= 0);

ALTER TABLE "LayawayPayment"
  ADD CONSTRAINT "LayawayPayment_amount_positive" CHECK ("amountCents" > 0);

-- ── Tablas de solo inserción (kardex, auditoría, libro de crédito) ──
CREATE FUNCTION prevent_row_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla "%" es de solo inserción: % no permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

CREATE TRIGGER "StockMovement_append_only"
  BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

CREATE TRIGGER "StoreCreditEntry_append_only"
  BEFORE UPDATE OR DELETE ON "StoreCreditEntry"
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

-- ── Búsqueda tolerante a errores (pg_trgm) ──
CREATE INDEX "Product_name_trgm_idx" ON "Product" USING gin ("name" gin_trgm_ops);
CREATE INDEX "Variant_sku_trgm_idx" ON "Variant" USING gin ("sku" gin_trgm_ops);
