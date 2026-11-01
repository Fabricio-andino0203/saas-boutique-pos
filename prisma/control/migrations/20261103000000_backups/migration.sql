-- Etapa 5: registro de respaldos por negocio y días de retención por plan.

-- CreateEnum
CREATE TYPE "BackupScope" AS ENUM ('TENANT', 'CONTROL', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BackupTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'FINAL');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('REQUESTED', 'RUNNING', 'OK', 'FAILED');

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN "backupRetentionDays" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "TenantBackup" (
    "id" TEXT NOT NULL,
    "scope" "BackupScope" NOT NULL,
    "tenantId" TEXT,
    "database" TEXT NOT NULL,
    "trigger" "BackupTrigger" NOT NULL,
    "status" "BackupStatus" NOT NULL,
    "fileName" TEXT,
    "bytes" INTEGER,
    "checksum" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "schemaVersion" TEXT,
    "error" TEXT,
    "requestedById" TEXT,
    "requestedByUsername" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "keepUntil" TIMESTAMP(3),
    "prunedAt" TIMESTAMP(3),

    CONSTRAINT "TenantBackup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantBackup_tenantId_requestedAt_idx" ON "TenantBackup"("tenantId", "requestedAt");

-- CreateIndex
CREATE INDEX "TenantBackup_status_requestedAt_idx" ON "TenantBackup"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "TenantBackup_scope_finishedAt_idx" ON "TenantBackup"("scope", "finishedAt");

-- AddForeignKey
ALTER TABLE "TenantBackup" ADD CONSTRAINT "TenantBackup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restricciones que Prisma no expresa.

-- Los días de retención de un plan tienen un piso (una semana) y un techo (diez años).
ALTER TABLE "Plan"
  ADD CONSTRAINT "Plan_backup_retention_range" CHECK ("backupRetentionDays" BETWEEN 7 AND 3650);

-- Solo el respaldo de la base central no pertenece a un negocio; todos los demás sí.
ALTER TABLE "TenantBackup"
  ADD CONSTRAINT "TenantBackup_scope_tenant" CHECK (
    ("scope" = 'CONTROL' AND "tenantId" IS NULL) OR ("scope" <> 'CONTROL' AND "tenantId" IS NOT NULL)
  );

-- Un respaldo «OK» es un archivo que existe, con su tamaño, su huella y la comprobación de que se puede leer: no hay un OK a medias.
ALTER TABLE "TenantBackup"
  ADD CONSTRAINT "TenantBackup_ok_is_verified" CHECK (
    "status" <> 'OK'
    OR ("fileName" IS NOT NULL AND "bytes" IS NOT NULL AND "checksum" IS NOT NULL AND "verifiedAt" IS NOT NULL AND "finishedAt" IS NOT NULL)
  );

ALTER TABLE "TenantBackup"
  ADD CONSTRAINT "TenantBackup_bytes_positive" CHECK ("bytes" IS NULL OR "bytes" > 0);

-- Solo se retira un archivo que se había hecho bien.
ALTER TABLE "TenantBackup"
  ADD CONSTRAINT "TenantBackup_pruned_was_ok" CHECK ("prunedAt" IS NULL OR "status" = 'OK');
