#!/bin/sh
# Atiende los respaldos que se pidieron desde el panel o la línea de comandos (filas «REQUESTED» de TenantBackup): los toma de uno
# en uno y hace cada respaldo como el diario. Lo llama el ciclo de `loop.sh` cada pocos segundos; si no hay pedidos, no hace nada.
#
# Defensa en profundidad: la aplicación escribe los pedidos, así que aquí se vuelve a comprobar que la base pedida es de verdad
# la de un negocio registrado (o su base archivada, o la base central) antes de volcar nada.
set -u
set -o pipefail

. /scripts/lib.sh

[ -n "$b_registry" ] || exit 0

# Un pedido «en marcha» desde hace horas no lo está haciendo nadie (el servicio se reinició a la mitad): se marca como fallido.
# Con `--boot` se hace sin esperar: al arrancar el servicio no puede haber ninguno en marcha de verdad.
if [ "${1:-}" = "--boot" ]; then
  stale="true"
else
  stale="\"startedAt\" < now() - interval '2 hours'"
fi
cpsql <<SQL > /dev/null 2>&1 || true
UPDATE "TenantBackup"
SET "status" = 'FAILED', "finishedAt" = now(), "error" = 'Se interrumpió (el servicio de respaldos se reinició o tardó demasiado)'
WHERE "status" = 'RUNNING' AND $stale;
SQL

failed=0
while true; do
  claim="$(cpsql <<'SQL' 2> /dev/null
UPDATE "TenantBackup" SET "status" = 'RUNNING', "startedAt" = now(), "error" = NULL
WHERE "id" = (
  SELECT "id" FROM "TenantBackup" WHERE "status" = 'REQUESTED' ORDER BY "requestedAt" LIMIT 1 FOR UPDATE SKIP LOCKED
)
RETURNING "id", "scope", COALESCE("tenantId", '-'), "database", "trigger";
SQL
)" || break
  [ -n "$claim" ] || break

  old_ifs="$IFS"
  IFS='|'
  # shellcheck disable=SC2086
  set -- $claim
  IFS="$old_ifs"
  req_id="$1"
  req_scope="$2"
  req_tenant="$3"
  req_database="$4"
  req_trigger="$5"

  if ! is_identifier "$req_database"; then
    registry_fail "$req_id" "Nombre de base no válido"
    failed=1
    continue
  fi

  # ¿Es de verdad lo que dice ser? Y, de paso, ¿cuántos días se conserva? (el plan del negocio; un volcado final, lo suyo).
  days="$DEFAULT_RETENTION_DAYS"
  case "$req_scope" in
    CONTROL)
      valid=""
      [ "$req_database" != "$CONTROL_DB" ] || valid="yes"
      ;;
    ARCHIVED)
      days="$FINAL_RETENTION_DAYS"
      valid="$(cpsql -v t="$req_tenant" -v d="$req_database" <<'SQL' 2> /dev/null
SELECT 'yes' FROM "Tenant"
WHERE "id" = :'t'
  AND ("archivedDbName" = :'d' OR :'d' LIKE 'z\_replaced\_t\_' || "id" || '\_%');
SQL
)"
      ;;
    *)
      row="$(cpsql -v t="$req_tenant" -v d="$req_database" -v def="$DEFAULT_RETENTION_DAYS" <<'SQL' 2> /dev/null
SELECT 'yes|' || COALESCE(p."backupRetentionDays", :'def'::int)
FROM "Tenant" t
LEFT JOIN "Subscription" s ON s."tenantId" = t."id" AND s."status" <> 'EXPIRED'
LEFT JOIN "Plan" p ON p."id" = s."planId"
WHERE t."id" = :'t' AND t."dbName" = :'d'
  AND t."status" IN ('ACTIVE', 'SUSPENDED', 'PENDING_DELETION', 'MIGRATION_FAILED')
LIMIT 1;
SQL
)"
      valid="${row%%|*}"
      [ -z "$valid" ] || days="${row#*|}"
      ;;
  esac
  if [ "$valid" != "yes" ]; then
    log error backup.request_rejected ",\"id\":\"$req_id\",\"database\":\"$req_database\""
    registry_fail "$req_id" "El pedido no corresponde a una base registrada: no se hizo"
    failed=1
    continue
  fi

  log info backup.request_started ",\"id\":\"$req_id\",\"scope\":\"$req_scope\""
  backup_one "$req_scope" "$req_tenant" "$req_database" "$req_trigger" "$req_id" "$days" || failed=1
done

registry_mark_pruned
[ "$failed" = "0" ] || exit 1
