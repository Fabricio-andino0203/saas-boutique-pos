-- Etapa 4: planes, suscripciones y pagos.

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'CARD', 'OTHER');

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL,
    "interval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
    "limits" JSONB NOT NULL DEFAULT '{}',
    "features" TEXT[],
    "trialDays" INTEGER NOT NULL DEFAULT 14,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "readOnlyDays" INTEGER NOT NULL DEFAULT 60,
    "priceCentsSnapshot" INTEGER NOT NULL,
    "intervalSnapshot" "BillingInterval" NOT NULL,
    "nextPlanId" TEXT,
    "reason" TEXT,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "coversFrom" TIMESTAMP(3) NOT NULL,
    "coversUntil" TIMESTAMP(3) NOT NULL,
    "registeredById" TEXT,
    "registeredByUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");

-- CreateIndex
CREATE INDEX "Plan_isActive_sortOrder_idx" ON "Plan"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "Subscription_tenantId_startsAt_idx" ON "Subscription"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "PlatformPayment_tenantId_paidAt_idx" ON "PlatformPayment"("tenantId", "paidAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Restricciones que Prisma no puede expresar ──

-- Precio y días de prueba razonables.
ALTER TABLE "Plan"
  ADD CONSTRAINT "Plan_price_not_negative" CHECK ("priceCents" >= 0),
  ADD CONSTRAINT "Plan_trial_days_range" CHECK ("trialDays" BETWEEN 0 AND 365);

-- Fechas en orden y plazos razonables; lo acordado no puede ser negativo.
ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_period_ordered" CHECK ("currentPeriodEnd" >= "currentPeriodStart"),
  ADD CONSTRAINT "Subscription_grace_range" CHECK ("graceDays" BETWEEN 0 AND 90),
  ADD CONSTRAINT "Subscription_read_only_range" CHECK ("readOnlyDays" BETWEEN 0 AND 365),
  ADD CONSTRAINT "Subscription_price_not_negative" CHECK ("priceCentsSnapshot" >= 0);

-- Solo una suscripción vigente (no reemplazada) por negocio: el historial son las filas EXPIRED.
CREATE UNIQUE INDEX "Subscription_one_current_per_tenant"
  ON "Subscription" ("tenantId")
  WHERE "status" <> 'EXPIRED';

-- Un pago es de dinero real y de un tramo de tiempo que termina después de empezar.
ALTER TABLE "PlatformPayment"
  ADD CONSTRAINT "PlatformPayment_amount_positive" CHECK ("amountCents" > 0),
  ADD CONSTRAINT "PlatformPayment_covers_ordered" CHECK ("coversUntil" > "coversFrom");

-- Los pagos son de solo inserción, como la auditoría (la función se creó en `init_control`).
CREATE TRIGGER "PlatformPayment_append_only"
  BEFORE UPDATE OR DELETE ON "PlatformPayment"
  FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();
