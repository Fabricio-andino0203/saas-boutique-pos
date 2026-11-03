-- Retiro al cerrar la caja y fondo heredado para el día siguiente (PRD RF-CASH-7 y RF-CASH-8).
-- Todas las columnas son opcionales: los turnos anteriores quedan con NULL (no heredan nada).

-- AlterTable
ALTER TABLE "CashSession" ADD COLUMN     "inheritedFloatCents" INTEGER,
ADD COLUMN     "openingNotes" TEXT,
ADD COLUMN     "withdrawnCents" INTEGER;

-- Lo retirado no puede ser negativo ni mayor que lo contado; lo heredado no puede ser negativo.
ALTER TABLE "CashSession"
  ADD CONSTRAINT "CashSession_withdrawn_valid"
    CHECK ("withdrawnCents" IS NULL OR ("withdrawnCents" >= 0 AND "withdrawnCents" <= COALESCE("countedCashCents", 0))),
  ADD CONSTRAINT "CashSession_inherited_nonneg"
    CHECK ("inheritedFloatCents" IS NULL OR "inheritedFloatCents" >= 0);
