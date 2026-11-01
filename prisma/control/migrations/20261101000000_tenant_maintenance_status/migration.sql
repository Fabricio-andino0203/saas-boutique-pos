-- Etapa 3: estado «en mantenimiento» de un negocio cuya última migración falló.
-- Va en su propia migración: Postgres no permite usar un valor de enum recién agregado dentro de la misma transacción.
ALTER TYPE "TenantStatus" ADD VALUE 'MIGRATION_FAILED';
