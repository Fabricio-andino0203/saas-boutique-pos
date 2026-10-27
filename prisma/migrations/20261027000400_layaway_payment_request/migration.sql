-- Abonos: idempotencia por clientRequestId (un doble clic no abona dos veces).
ALTER TABLE "LayawayPayment" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "LayawayPayment_clientRequestId_key" ON "LayawayPayment"("clientRequestId");
