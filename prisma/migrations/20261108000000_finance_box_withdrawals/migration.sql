-- Retiros de la caja de finanzas (PRD RF-FIN-12): el efectivo que se lleva el dueño o se deposita en el banco.

-- CreateTable
CREATE TABLE "FinanceBoxWithdrawal" (
    "id" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "FinanceBoxWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBoxWithdrawal_clientRequestId_key" ON "FinanceBoxWithdrawal"("clientRequestId");

-- CreateIndex
CREATE INDEX "FinanceBoxWithdrawal_occurredAt_idx" ON "FinanceBoxWithdrawal"("occurredAt");

-- AddForeignKey
ALTER TABLE "FinanceBoxWithdrawal" ADD CONSTRAINT "FinanceBoxWithdrawal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceBoxWithdrawal" ADD CONSTRAINT "FinanceBoxWithdrawal_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Reglas que Prisma no puede expresar ──

ALTER TABLE "FinanceBoxWithdrawal"
  ADD CONSTRAINT "FinanceBoxWithdrawal_amount_positive" CHECK ("amountCents" > 0);

-- La anulación se registra completa (fecha, quién y motivo) o no se registra.
ALTER TABLE "FinanceBoxWithdrawal"
  ADD CONSTRAINT "FinanceBoxWithdrawal_void_complete" CHECK (
    ("voidedAt" IS NULL AND "voidedById" IS NULL AND "voidReason" IS NULL)
    OR ("voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND "voidReason" IS NOT NULL)
  );

-- Inmutable: no se borra, y lo único que puede cambiar es la anulación (una sola vez).
CREATE FUNCTION finance_box_withdrawal_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un retiro de la caja de finanzas no se borra: se anula con motivo'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."voidedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Un retiro de la caja de finanzas anulado ya no cambia'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW."id", NEW."amountCents", NEW."occurredAt", NEW."reason", NEW."clientRequestId",
      NEW."createdById", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."amountCents", OLD."occurredAt", OLD."reason", OLD."clientRequestId",
      OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'Un retiro de la caja de finanzas solo cambia al anularse'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FinanceBoxWithdrawal_guard"
  BEFORE UPDATE OR DELETE ON "FinanceBoxWithdrawal"
  FOR EACH ROW EXECUTE FUNCTION finance_box_withdrawal_guard();
