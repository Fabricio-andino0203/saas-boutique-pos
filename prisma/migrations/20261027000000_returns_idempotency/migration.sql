-- Devoluciones: idempotencia por clientRequestId y cliente que recibe el crédito.
-- La tabla todavía no tiene filas (las devoluciones llegan con esta migración).
ALTER TABLE "ReturnDoc" ADD COLUMN "clientRequestId" TEXT NOT NULL,
ADD COLUMN "customerId" TEXT;

CREATE UNIQUE INDEX "ReturnDoc_clientRequestId_key" ON "ReturnDoc"("clientRequestId");
CREATE INDEX "ReturnDoc_customerId_idx" ON "ReturnDoc"("customerId");

ALTER TABLE "ReturnDoc" ADD CONSTRAINT "ReturnDoc_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
