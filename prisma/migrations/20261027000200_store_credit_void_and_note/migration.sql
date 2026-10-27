-- Crédito de tienda: al anular una venta pagada con crédito se devuelve (SALE_VOID) y cada movimiento puede llevar una nota
-- (el motivo de un ajuste manual).
ALTER TYPE "StoreCreditReason" ADD VALUE 'SALE_VOID';
ALTER TABLE "StoreCreditEntry" ADD COLUMN "note" TEXT;
