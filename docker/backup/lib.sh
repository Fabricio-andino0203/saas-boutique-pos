#!/bin/sh
# Piezas comunes de los scripts de respaldo y restauración. Se cargan con:  . /scripts/lib.sh
#
# Variables: PGHOST PGUSER PGPASSWORD (Postgres), BACKUP_PASSPHRASE (obligatoria), BACKUP_DIR (por omisión /backups),
#            TENANCY_MODE, CONTROL_PGDATABASE / POSTGRES_CONTROL_DB (la base central, donde se anota cada respaldo).
#
# Cifrado: AES-256-CBC con PBKDF2 (600 000 vueltas). La tienda #1 (`boutique-*`) y la base central (`control-*`) se cifran con
# BACKUP_PASSPHRASE tal cual. El respaldo de cada negocio (`tenant-<base>-*`) y el volcado final de una base archivada
# (`final-<base>-*`) usan una llave PROPIA derivada de la clave y del nombre de la base: así se le puede entregar a alguien el
# respaldo de UN negocio con su llave sin abrir los de los demás. Los respaldos de la Etapa 3 (`tenant-*` cifrados con la clave
# tal cual) se siguen pudiendo abrir: la restauración prueba primero la llave propia y luego la general.

: "${BACKUP_PASSPHRASE:?define BACKUP_PASSPHRASE en .env.production}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
DEFAULT_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
FINAL_RETENTION_DAYS="${FINAL_BACKUP_RETENTION_DAYS:-365}"
CONTROL_DB="${CONTROL_PGDATABASE:-}"
if [ -z "$CONTROL_DB" ] && [ "${TENANCY_MODE:-single}" = "multi" ]; then
  CONTROL_DB="${POSTGRES_CONTROL_DB:-boutique_pos_control}"
fi

log() { printf '{"time":"%s","level":"%s","event":"%s"%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "${3:-}"; }

# ───────────────────────────── Llaves ─────────────────────────────

# Llave propia de una base: SHA-256 de «versión : clave : base» (la base solo lleva [a-z0-9_], así que la unión no es ambigua).
derive_key() {
  printf 'boutique-pos/backup/v1:%s:%s' "$BACKUP_PASSPHRASE" "$1" | openssl dgst -sha256 -r | cut -d' ' -f1
}

# La llave con la que se CIFRA un respaldo: key_for <ámbito> <base>
key_for() {
  case "$1" in
    TENANT | ARCHIVED) derive_key "$2" ;;
    *) printf '%s' "$BACKUP_PASSPHRASE" ;;
  esac
}

# Comprobación de un archivo cifrado que no se puede leer no sirve de nada: (1) se descifra completo, lo que falla si la llave o el
# relleno no cuadran, y (2) se lee el índice del volcado. `pg_restore --list` cierra la tubería en cuanto termina el índice,
# así que en ese paso solo cuenta su resultado (sin pipefail). La llave va en BACKUP_KEY (nunca en la línea de comandos).
verify_archive() {
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_KEY -in "$1" > /dev/null || return 1
  (
    set +o pipefail
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_KEY -in "$1" 2> /dev/null | pg_restore --list > /dev/null
  )
}

sha256_of() { openssl dgst -sha256 -r "$1" | cut -d' ' -f1; }

is_number() {
  case "$1" in '' | *[!0-9]*) return 1 ;; *) return 0 ;; esac
}

# Los nombres de bases los genera el sistema; aun así se validan antes de usarlos (sin inyección posible).
is_identifier() {
  case "$1" in '' | [!a-z]* | *[!a-z0-9_]*) return 1 ;; *) [ "${#1}" -ge 3 ] && [ "${#1}" -le 63 ] ;; esac
}

# ───────────────────────────── Registro en la base central ─────────────────────────────

# Una consulta a la base central. Los valores se pasan con -v y se usan como :'nombre' (nunca pegados al SQL).
# Uso:  cpsql -v a="$a" <<'SQL' ... SQL
cpsql() {
  psql --dbname "$CONTROL_DB" --no-psqlrc --quiet --tuples-only --no-align --field-separator '|' \
    --set ON_ERROR_STOP=1 "$@"
}

# ¿Se puede llevar el registro? Solo con varios negocios y si la base central responde y ya tiene la tabla de respaldos.
registry_ready() {
  [ -n "$CONTROL_DB" ] || return 1
  [ "${TENANCY_MODE:-single}" = "multi" ] || return 1
  cpsql -v ignored=1 <<'SQL' > /dev/null 2>&1
SELECT 1 FROM "TenantBackup" LIMIT 1;
SQL
}

new_backup_id() { printf 'bk%s' "$(openssl rand -hex 10)"; }

# registry_begin <id> <ámbito> <negocio|-> <base> <origen> : crea la fila «en marcha» (o toma la que ya estaba pedida).
registry_begin() {
  cpsql -v id="$1" -v scope="$2" -v tenant="$3" -v db="$4" -v trig="$5" <<'SQL' > /dev/null 2>&1 || true
INSERT INTO "TenantBackup" ("id", "scope", "tenantId", "database", "trigger", "status", "startedAt")
VALUES (:'id', :'scope'::"BackupScope", NULLIF(:'tenant', '-'), :'db', :'trig'::"BackupTrigger", 'RUNNING', now())
ON CONFLICT ("id") DO UPDATE SET "status" = 'RUNNING', "startedAt" = now(), "error" = NULL;
SQL
}

# registry_ok <id> <archivo> <bytes> <sha256> <versión del esquema|-> <días de retención>
registry_ok() {
  cpsql -v id="$1" -v file="$2" -v bytes="$3" -v sum="$4" -v schema="$5" -v days="$6" <<'SQL' > /dev/null 2>&1 || log warn backup.registry_failed ",\"id\":\"$1\""
UPDATE "TenantBackup"
SET "status" = 'OK', "fileName" = :'file', "bytes" = :'bytes'::int, "checksum" = :'sum',
    "schemaVersion" = NULLIF(:'schema', '-'), "verifiedAt" = now(), "finishedAt" = now(), "error" = NULL,
    "keepUntil" = now() + make_interval(days => :'days'::int)
WHERE "id" = :'id';
SQL
}

# registry_fail <id> <motivo>
registry_fail() {
  cpsql -v id="$1" -v msg="$2" <<'SQL' > /dev/null 2>&1 || true
UPDATE "TenantBackup" SET "status" = 'FAILED', "finishedAt" = now(), "error" = left(:'msg', 500) WHERE "id" = :'id';
SQL
}

# La versión del esquema (última migración terminada) de una base de negocio, o «-» si no se puede leer.
schema_version_of() {
  version="$(psql --dbname "$1" --no-psqlrc --quiet --tuples-only --no-align --command \
    'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1' 2> /dev/null || true)"
  printf '%s' "${version:--}"
}

# ───────────────────────────── Un respaldo ─────────────────────────────

# backup_one <ámbito> <negocio|-> <base> <origen> <id del pedido|-> <días de retención>
#   ámbito: TENANT | CONTROL | ARCHIVED     origen: SCHEDULED | MANUAL | FINAL
# Hace el volcado, lo cifra, lo comprueba, lo deja en su lugar y lo anota. Devuelve 0 si quedó bien, 1 si no.
# Nunca deja un archivo a medias.
backup_one() {
  b_scope="$1"
  b_tenant="$2"
  b_database="$3"
  b_trigger="$4"
  b_request="$5"
  b_days="$6"
  is_number "$b_days" || b_days="$DEFAULT_RETENTION_DAYS"
  # Sin negocio al que atribuirlo (la tienda de siempre aún sin registrar) el respaldo se hace igual, solo que no se anota.
  b_use="$b_registry"
  if [ "$b_scope" != "CONTROL" ] && [ "$b_tenant" = "-" ]; then b_use=""; fi

  case "$b_scope" in
    CONTROL) b_prefix="control" ;;
    ARCHIVED) b_prefix="final-$b_database" ;;
    *)
      # La tienda de siempre (la base de PGDATABASE) conserva su nombre de archivo histórico.
      if [ "$b_database" = "${PGDATABASE:-}" ]; then b_prefix="boutique"; else b_prefix="tenant-$b_database"; fi
      ;;
  esac
  if [ "$b_prefix" = "boutique" ] || [ "$b_scope" = "CONTROL" ]; then
    BACKUP_KEY="$BACKUP_PASSPHRASE"
  else
    BACKUP_KEY="$(derive_key "$b_database")"
  fi
  export BACKUP_KEY

  b_id="$b_request"
  [ "$b_id" != "-" ] || b_id="$(new_backup_id)"
  b_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  b_final="$BACKUP_DIR/$b_prefix-$b_stamp.dump.enc"
  b_partial="$b_final.partial"

  mkdir -p "$BACKUP_DIR"
  [ -z "$b_use" ] || registry_begin "$b_id" "$b_scope" "$b_tenant" "$b_database" "$b_trigger"
  log info backup.start ",\"file\":\"$(basename "$b_final")\""

  if ! { pg_dump --dbname "$b_database" --format=custom --no-owner --no-privileges \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_KEY -out "$b_partial"; }; then
    log error backup.dump_failed ",\"database\":\"$b_database\""
    rm -f "$b_partial"
    [ -z "$b_use" ] || registry_fail "$b_id" "pg_dump falló: la base no respondió o no se pudo leer"
    return 1
  fi
  if ! verify_archive "$b_partial"; then
    log error backup.verify_failed ",\"file\":\"$(basename "$b_final")\""
    rm -f "$b_partial"
    [ -z "$b_use" ] || registry_fail "$b_id" "El archivo no pasó la comprobación (no se pudo descifrar y leer)"
    return 1
  fi
  mv "$b_partial" "$b_final"

  b_bytes="$(wc -c < "$b_final" | tr -d ' ')"
  b_sum="$(sha256_of "$b_final")"
  b_schema="$(schema_version_of "$b_database")"
  if [ "$b_prefix" = "boutique" ]; then
    b_sales="$(psql --dbname "$b_database" --no-psqlrc --tuples-only --no-align --command 'SELECT count(*) FROM "Sale"' 2> /dev/null || echo "?")"
    log info backup.done ",\"file\":\"$(basename "$b_final")\",\"bytes\":$b_bytes,\"sales\":\"$b_sales\""
  else
    log info backup.done ",\"file\":\"$(basename "$b_final")\",\"bytes\":$b_bytes"
  fi
  [ -z "$b_use" ] || registry_ok "$b_id" "$(basename "$b_final")" "$b_bytes" "$b_sum" "$b_schema" "$b_days"

  # Retención: se borran los respaldos de ESTA base con más de N días.
  b_deleted="$(find "$BACKUP_DIR" -maxdepth 1 -name "$b_prefix-*.dump.enc" -mtime "+$b_days" -print -delete | wc -l | tr -d ' ')"
  if [ "$b_deleted" -gt 0 ]; then
    log info backup.pruned ",\"file\":\"$b_prefix\",\"deleted\":$b_deleted,\"retentionDays\":$b_days"
  fi
  return 0
}

# Anota como retirados los respaldos buenos cuyo archivo ya no está en la carpeta (la retención los borró). La fila queda como historial.
registry_mark_pruned() {
  [ -z "$b_registry" ] || cpsql -v files="$(ls -1 "$BACKUP_DIR" 2> /dev/null || true)" <<'SQL' > /dev/null 2>&1 || true
UPDATE "TenantBackup" SET "prunedAt" = now()
WHERE "status" = 'OK' AND "prunedAt" IS NULL AND "fileName" IS NOT NULL
  AND "fileName" <> ALL (string_to_array(:'files', chr(10)));
SQL
}

# Si la anotación está disponible en esta ejecución («» = no).
b_registry=""
if registry_ready; then b_registry="yes"; fi
