#!/bin/sh
# El respaldo de todas las bases: volcado (formato custom de pg_dump) cifrado con AES-256, comprobado, con retención y anotado.
# Variables: PGHOST PGUSER PGPASSWORD PGDATABASE (de Postgres), BACKUP_PASSPHRASE (obligatoria),
#            BACKUP_DIR (por omisión /backups), BACKUP_RETENTION_DAYS (por omisión 30: se usa para un negocio sin plan),
#            CONTROL_PGDATABASE (opcional: la base CENTRAL de la plataforma, que se respalda aparte). Con TENANCY_MODE=multi se
#            respalda siempre (POSTGRES_CONTROL_DB, por omisión boutique_pos_control).
# Resultado: $BACKUP_DIR/boutique-AAAAMMDDTHHMMSSZ.dump.enc (la tienda #1, hora UTC), control-….dump.enc (la base central) y, con
#            varios negocios, tenant-<base>-….dump.enc (uno por negocio, con SU llave y los días de retención de SU plan).
#            Sale con error si algo falla; nunca deja un archivo a medias. Cada respaldo se anota en la base central (tabla
#            TenantBackup) para el panel.
# La base central NO sirve sin la llave maestra de la plataforma (PLATFORM_MASTER_KEY), que no está en estos respaldos a propósito:
# guárdala fuera del servidor.
set -u
set -o pipefail

. /scripts/lib.sh

: "${PGDATABASE:?define PGDATABASE}"
failed=0

# Los negocios que existen y los días que se conservan sus respaldos (los del plan, o los del servidor si no tiene).
tenant_list="$(mktemp)"
trap 'rm -f "$tenant_list"' EXIT
use_registry=""
if [ -n "$b_registry" ] && cpsql -v days="$DEFAULT_RETENTION_DAYS" > "$tenant_list" 2> /dev/null <<'SQL'
SELECT t."id", t."dbName", COALESCE(p."backupRetentionDays", :'days'::int)
FROM "Tenant" t
LEFT JOIN "Subscription" s ON s."tenantId" = t."id" AND s."status" <> 'EXPIRED'
LEFT JOIN "Plan" p ON p."id" = s."planId"
WHERE t."dbName" IS NOT NULL AND t."status" IN ('ACTIVE', 'SUSPENDED', 'PENDING_DELETION', 'MIGRATION_FAILED')
ORDER BY t."createdAt";
SQL
then
  use_registry="yes"
fi

if [ -n "$use_registry" ]; then
  # Se respalda a cada negocio registrado (la tienda #1 incluida: su archivo conserva el nombre `boutique-…`).
  while IFS='|' read -r tenant_id tenant_db days; do
    [ -n "$tenant_id" ] || continue
    is_identifier "$tenant_db" || { log error backup.bad_name ",\"tenant\":\"$tenant_id\""; failed=1; continue; }
    backup_one TENANT "$tenant_id" "$tenant_db" SCHEDULED - "$days" || failed=1
  done < "$tenant_list"
  # La base de siempre (PGDATABASE) se respalda aunque todavía no esté registrada como un negocio.
  if ! grep -q "|$PGDATABASE|" "$tenant_list"; then
    backup_one TENANT - "$PGDATABASE" SCHEDULED - "$DEFAULT_RETENTION_DAYS" || failed=1
  fi
else
  # Sin registro (una sola tienda, o la base central no responde): la tienda de siempre y, si hay, todas las bases t_*.
  backup_one TENANT - "$PGDATABASE" SCHEDULED - "$DEFAULT_RETENTION_DAYS" || failed=1
  if [ "${TENANCY_MODE:-single}" = "multi" ]; then
    tenant_dbs="$(psql --dbname postgres --no-psqlrc --tuples-only --no-align \
      --command "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname LIKE 't\\_%' ORDER BY datname")"
    for tenant_db in $tenant_dbs; do
      backup_one TENANT - "$tenant_db" SCHEDULED - "$DEFAULT_RETENTION_DAYS" || {
        log error backup.tenant_failed ",\"database\":\"$tenant_db\""
        failed=1
      }
    done
  fi
fi

# La base central se respalda siempre que haya varios negocios (o si se pidió con CONTROL_PGDATABASE).
if [ -n "$CONTROL_DB" ]; then
  backup_one CONTROL - "$CONTROL_DB" SCHEDULED - "$DEFAULT_RETENTION_DAYS" || failed=1
fi

registry_mark_pruned
[ "$failed" = "0" ] || exit 1
