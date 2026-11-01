-- Etapa 4: una prueba gratuita sigue siéndolo hasta el primer pago, aunque el barrido diario ya haya anotado que venció.
ALTER TABLE "Subscription" ADD COLUMN "isTrial" BOOLEAN NOT NULL DEFAULT false;

-- El plan con el que se da de alta un negocio viaja con el alta (que puede retomarse) y se aplica al terminarla.
ALTER TABLE "ProvisioningRun" ADD COLUMN "planId" TEXT;
