-- CreateEnum
CREATE TYPE "FinanceEntryType" AS ENUM ('EXPENSE', 'INCOME');

-- CreateEnum
CREATE TYPE "FinancePaymentMethod" AS ENUM ('CASH_DRAWER', 'CASH_OTHER', 'TRANSFER', 'CARD', 'OTHER');

-- CreateTable
CREATE TABLE "FinanceCategory" (
    "id" TEXT NOT NULL,
    "type" "FinanceEntryType" NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceEntry" (
    "id" TEXT NOT NULL,
    "type" "FinanceEntryType" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "paidWith" "FinancePaymentMethod" NOT NULL,
    "description" TEXT NOT NULL,
    "supplierId" TEXT,
    "cashMovementId" TEXT,
    "fixedCostId" TEXT,
    "period" TEXT,
    "clientRequestId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "FinanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedCost" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceCategory_type_archivedAt_idx" ON "FinanceCategory"("type", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceCategory_type_name_key" ON "FinanceCategory"("type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceEntry_cashMovementId_key" ON "FinanceEntry"("cashMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceEntry_clientRequestId_key" ON "FinanceEntry"("clientRequestId");

-- CreateIndex
CREATE INDEX "FinanceEntry_occurredAt_idx" ON "FinanceEntry"("occurredAt");

-- CreateIndex
CREATE INDEX "FinanceEntry_type_categoryId_idx" ON "FinanceEntry"("type", "categoryId");

-- CreateIndex
CREATE INDEX "FinanceEntry_fixedCostId_idx" ON "FinanceEntry"("fixedCostId");

-- CreateIndex
CREATE INDEX "FixedCost_archivedAt_idx" ON "FixedCost"("archivedAt");

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinanceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_cashMovementId_fkey" FOREIGN KEY ("cashMovementId") REFERENCES "CashMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_fixedCostId_fkey" FOREIGN KEY ("fixedCostId") REFERENCES "FixedCost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedCost" ADD CONSTRAINT "FixedCost_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinanceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Reglas que Prisma no puede expresar ──

-- Montos y días válidos.
ALTER TABLE "FinanceEntry"
  ADD CONSTRAINT "FinanceEntry_amount_positive" CHECK ("amountCents" > 0);

ALTER TABLE "FixedCost"
  ADD CONSTRAINT "FixedCost_valid" CHECK ("amountCents" > 0 AND "dueDay" BETWEEN 1 AND 28);

-- La anulación se registra completa (fecha, quién y motivo) o no se registra.
ALTER TABLE "FinanceEntry"
  ADD CONSTRAINT "FinanceEntry_void_complete" CHECK (
    ("voidedAt" IS NULL AND "voidedById" IS NULL AND "voidReason" IS NULL)
    OR ("voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND "voidReason" IS NOT NULL)
  );

-- Efectivo de la caja ⇔ salida de caja enlazada.
ALTER TABLE "FinanceEntry"
  ADD CONSTRAINT "FinanceEntry_drawer_link" CHECK (
    ("paidWith" = 'CASH_DRAWER') = ("cashMovementId" IS NOT NULL)
  );

-- Un costo fijo solo tiene un pago vigente por mes; si se anula, se puede volver a registrar.
CREATE UNIQUE INDEX "FinanceEntry_fixedCost_period_active_key"
  ON "FinanceEntry"("fixedCostId", "period")
  WHERE "fixedCostId" IS NOT NULL AND "voidedAt" IS NULL;

ALTER TABLE "FinanceEntry"
  ADD CONSTRAINT "FinanceEntry_fixedCost_period" CHECK (("fixedCostId" IS NULL) = ("period" IS NULL));

-- Libro inmutable: no se borra, y lo único que puede cambiar es la anulación (una sola vez).
CREATE FUNCTION finance_entry_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un movimiento de Finanzas no se borra: se anula con motivo'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."voidedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Un movimiento de Finanzas anulado ya no cambia'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW."id", NEW."type", NEW."categoryId", NEW."amountCents", NEW."occurredAt", NEW."paidWith",
      NEW."description", NEW."supplierId", NEW."cashMovementId", NEW."fixedCostId", NEW."period",
      NEW."clientRequestId", NEW."createdById", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."type", OLD."categoryId", OLD."amountCents", OLD."occurredAt", OLD."paidWith",
      OLD."description", OLD."supplierId", OLD."cashMovementId", OLD."fixedCostId", OLD."period",
      OLD."clientRequestId", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'Un movimiento de Finanzas solo cambia al anularse'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FinanceEntry_guard"
  BEFORE UPDATE OR DELETE ON "FinanceEntry"
  FOR EACH ROW EXECUTE FUNCTION finance_entry_guard();

-- ── Categorías iniciales (los negocios que ya existen las reciben al activar el módulo) ──
INSERT INTO "FinanceCategory" ("id", "type", "name", "sortOrder", "updatedAt") VALUES
  ('fcat_expense_alquiler', 'EXPENSE', 'Alquiler', 0, CURRENT_TIMESTAMP),
  ('fcat_expense_servicios_agua_luz_internet', 'EXPENSE', 'Servicios (agua, luz, internet)', 1, CURRENT_TIMESTAMP),
  ('fcat_expense_sueldos_y_comisiones', 'EXPENSE', 'Sueldos y comisiones', 2, CURRENT_TIMESTAMP),
  ('fcat_expense_publicidad', 'EXPENSE', 'Publicidad', 3, CURRENT_TIMESTAMP),
  ('fcat_expense_transporte_y_envios', 'EXPENSE', 'Transporte y envíos', 4, CURRENT_TIMESTAMP),
  ('fcat_expense_empaques', 'EXPENSE', 'Empaques', 5, CURRENT_TIMESTAMP),
  ('fcat_expense_mantenimiento', 'EXPENSE', 'Mantenimiento', 6, CURRENT_TIMESTAMP),
  ('fcat_expense_impuestos_y_permisos', 'EXPENSE', 'Impuestos y permisos', 7, CURRENT_TIMESTAMP),
  ('fcat_expense_otros_gastos', 'EXPENSE', 'Otros gastos', 8, CURRENT_TIMESTAMP),
  ('fcat_income_aporte_del_dueno', 'INCOME', 'Aporte del dueño', 9, CURRENT_TIMESTAMP),
  ('fcat_income_otros_ingresos', 'INCOME', 'Otros ingresos', 10, CURRENT_TIMESTAMP)
ON CONFLICT ("type", "name") DO NOTHING;
