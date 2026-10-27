-- Apartados: pago "LAYAWAY" (los abonos ya recibidos, aplicados a la venta al saldar), idempotencia por clientRequestId,
-- datos de la cancelación y quién recibió cada abono. Las tablas de apartados todavía no tienen filas.
ALTER TYPE "PaymentMethod" ADD VALUE 'LAYAWAY';

ALTER TABLE "Layaway"
  ADD COLUMN "clientRequestId" TEXT NOT NULL,
  ADD COLUMN "retainedCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "cancelledById" TEXT;

CREATE UNIQUE INDEX "Layaway_clientRequestId_key" ON "Layaway"("clientRequestId");
ALTER TABLE "Layaway" ADD CONSTRAINT "Layaway_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Layaway" ADD CONSTRAINT "Layaway_retained_valid"
  CHECK ("retainedCents" >= 0 AND "retainedCents" <= "paidCents");

ALTER TABLE "LayawayPayment"
  ADD COLUMN "userId" TEXT NOT NULL,
  ADD COLUMN "reference" TEXT;

ALTER TABLE "LayawayPayment" ADD CONSTRAINT "LayawayPayment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "LayawayPayment_userId_idx" ON "LayawayPayment"("userId");
