-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'PENDING_DELETION', 'DELETED', 'FAILED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'PROVISIONING',
    "ownerEmail" TEXT,
    "dbServerId" TEXT NOT NULL DEFAULT 'primary',
    "dbName" TEXT,
    "dbRole" TEXT,
    "dbCredentialEnc" TEXT,
    "schemaVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecretEnc" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "totpLastStep" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSession" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "mfaVerifiedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorUsername" TEXT,
    "action" TEXT NOT NULL,
    "tenantId" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "details" JSONB,
    "ip" TEXT,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_dbName_key" ON "Tenant"("dbName");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_dbRole_key" ON "Tenant"("dbRole");

-- CreateIndex
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUser_username_key" ON "PlatformUser"("username");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSession_sessionToken_key" ON "PlatformSession"("sessionToken");

-- CreateIndex
CREATE INDEX "PlatformSession_userId_idx" ON "PlatformSession"("userId");

-- CreateIndex
CREATE INDEX "PlatformSession_expires_idx" ON "PlatformSession"("expires");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_at_idx" ON "PlatformAuditLog"("at");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_action_at_idx" ON "PlatformAuditLog"("action", "at");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_actorId_at_idx" ON "PlatformAuditLog"("actorId", "at");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_tenantId_at_idx" ON "PlatformAuditLog"("tenantId", "at");

-- AddForeignKey
ALTER TABLE "PlatformSession" ADD CONSTRAINT "PlatformSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Restricciones que Prisma no puede expresar ──
-- Mantener sincronizado con docs/SAAS_PROPUESTA.md §3.1.

-- Subdominio: minúsculas, números y guiones, sin guion al inicio ni al final (cabe en una etiqueta DNS).
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_slug_format" CHECK ("slug" ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$');

-- Un negocio que ya opera (o está suspendido) tiene su base, su rol y su credencial guardada.
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_operating_has_database" CHECK (
    "status" NOT IN ('ACTIVE', 'SUSPENDED')
    OR ("dbName" IS NOT NULL AND "dbRole" IS NOT NULL AND "dbCredentialEnc" IS NOT NULL)
  );

ALTER TABLE "PlatformUser"
  ADD CONSTRAINT "PlatformUser_username_format" CHECK ("username" ~ '^[a-z0-9._-]{3,40}$');

-- El 2FA no puede estar "confirmado" sin un secreto guardado.
ALTER TABLE "PlatformUser"
  ADD CONSTRAINT "PlatformUser_totp_consistent" CHECK ("totpEnabledAt" IS NULL OR "totpSecretEnc" IS NOT NULL);

-- ── Auditoría de solo inserción ──
CREATE FUNCTION prevent_row_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla "%" es de solo inserción: % no permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PlatformAuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "PlatformAuditLog"
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();
