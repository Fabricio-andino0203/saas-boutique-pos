-- Etapa 5: fotos de uso por negocio (lista blanca) y el borrado definitivo de las bases archivadas.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "archivedDroppedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TenantUsageSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeUsers" INTEGER NOT NULL,
    "products" INTEGER NOT NULL,
    "sales30d" INTEGER NOT NULL,
    "lastSaleAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "databaseMb" INTEGER NOT NULL,
    "schemaVersion" TEXT,

    CONSTRAINT "TenantUsageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantUsageSnapshot_tenantId_takenAt_idx" ON "TenantUsageSnapshot"("tenantId", "takenAt");

-- AddForeignKey
ALTER TABLE "TenantUsageSnapshot" ADD CONSTRAINT "TenantUsageSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restricciones que Prisma no expresa.

-- Las cuentas no pueden ser negativas.
ALTER TABLE "TenantUsageSnapshot"
  ADD CONSTRAINT "TenantUsageSnapshot_counts_not_negative" CHECK (
    "activeUsers" >= 0 AND "products" >= 0 AND "sales30d" >= 0 AND "databaseMb" >= 0
  );

-- Una base solo se da por borrada si el negocio estaba archivado.
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_dropped_was_archived" CHECK (
    "archivedDroppedAt" IS NULL OR ("status" = 'DELETED' AND "archivedDbName" IS NOT NULL)
  );
