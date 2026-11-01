-- Etapa 5: sesiones de soporte (permiso con motivo y duración limitada para mirar los datos de un negocio).

-- CreateTable
CREATE TABLE "SupportSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminUsername" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportSession_tenantId_startedAt_idx" ON "SupportSession"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "SupportSession_adminId_expiresAt_idx" ON "SupportSession"("adminId", "expiresAt");

-- AddForeignKey
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restricciones que Prisma no expresa.

-- Una persona solo puede tener una sesión de soporte abierta por negocio.
CREATE UNIQUE INDEX "SupportSession_one_open" ON "SupportSession"("tenantId", "adminId") WHERE "endedAt" IS NULL;

-- Siempre hay un motivo que se pueda leer después, y la sesión dura a lo sumo dos horas.
ALTER TABLE "SupportSession"
  ADD CONSTRAINT "SupportSession_reason_length" CHECK (char_length(btrim("reason")) BETWEEN 10 AND 300);

ALTER TABLE "SupportSession"
  ADD CONSTRAINT "SupportSession_duration" CHECK (
    "expiresAt" > "startedAt" AND "expiresAt" <= "startedAt" + interval '2 hours'
  );

ALTER TABLE "SupportSession"
  ADD CONSTRAINT "SupportSession_ended_after_start" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");
