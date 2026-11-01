-- Etapa 3: alta automática (ProvisioningRun), migración de la flota y baja controlada.

-- CreateEnum
CREATE TYPE "ProvisioningStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'UNDONE');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedDbName" TEXT,
ADD COLUMN     "canary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deleteAfter" TIMESTAMP(3),
ADD COLUMN     "deletionReason" TEXT,
ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "migrationError" TEXT,
ADD COLUMN     "migrationFailedAt" TIMESTAMP(3),
ADD COLUMN     "statusBeforeDeletion" "TenantStatus";

-- CreateTable
CREATE TABLE "ProvisioningRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "ProvisioningStatus" NOT NULL DEFAULT 'RUNNING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "steps" JSONB NOT NULL,
    "error" TEXT,
    "ownerName" TEXT NOT NULL,
    "ownerUsername" TEXT NOT NULL,
    "ownerEmail" TEXT,
    "secretEnc" TEXT,
    "actorId" TEXT,
    "actorUsername" TEXT,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ProvisioningRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProvisioningRun_tenantId_startedAt_idx" ON "ProvisioningRun"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "ProvisioningRun_status_idx" ON "ProvisioningRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_archivedDbName_key" ON "Tenant"("archivedDbName");

-- AddForeignKey
ALTER TABLE "ProvisioningRun" ADD CONSTRAINT "ProvisioningRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Restricciones que Prisma no puede expresar ──

-- Un negocio en mantenimiento por una migración fallida también tiene su base, su rol y su credencial.
ALTER TABLE "Tenant" DROP CONSTRAINT "Tenant_operating_has_database";
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_operating_has_database" CHECK (
    "status" NOT IN ('ACTIVE', 'SUSPENDED', 'MIGRATION_FAILED')
    OR ("dbName" IS NOT NULL AND "dbRole" IS NOT NULL AND "dbCredentialEnc" IS NOT NULL)
  );

-- Una baja pendiente tiene fecha de eliminación y el estado al que volver si se cancela.
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_pending_deletion_has_dates" CHECK (
    "status" <> 'PENDING_DELETION'
    OR ("deletionRequestedAt" IS NOT NULL AND "deleteAfter" IS NOT NULL AND "statusBeforeDeletion" IS NOT NULL)
  );

-- Un negocio archivado ya no tiene rol ni credencial y dice dónde quedó su base.
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_archived_is_consistent" CHECK (
    "archivedAt" IS NULL
    OR ("status" = 'DELETED' AND "archivedDbName" IS NOT NULL AND "dbRole" IS NULL AND "dbCredentialEnc" IS NULL)
  );
