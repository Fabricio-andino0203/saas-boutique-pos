#!/bin/sh
# Un respaldo: volcado de la base (formato custom de pg_dump) cifrado con AES-256, comprobado y con retención.
# Variables: PGHOST PGUSER PGPASSWORD PGDATABASE (de Postgres), BACKUP_PASSPHRASE (obligatoria),
#            BACKUP_DIR (por omisión /backups), BACKUP_RETENTION_DAYS (por omisión 30),
#            CONTROL_PGDATABASE (opcional: la base CENTRAL de la plataforma, que se respalda aparte). Con TENANCY_MODE=multi se
#            respalda siempre (POSTGRES_CONTROL_DB, por omisión boutique_pos_control).
# Resultado: $BACKUP_DIR/boutique-AAAAMMDDTHHMMSSZ.dump.enc (hora UTC) y, si hay base central,
#            $BACKUP_DIR/control-AAAAMMDDTHHMMSSZ.dump.enc. Sale con error si algo falla; nunca deja un archivo a medias.
# La base central NO sirve sin la llave maestra de la plataforma (PLATFORM_MASTER_KEY), que no está en estos respaldos a propósito:
# guárdala fuera del servidor.
set -eu
set -o pipefail

: "${BACKUP_PASSPHRASE:?define BACKUP_PASSPHRASE en .env.production}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

log() { printf '{"time":"%s","level":"%s","event":"%s"%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "${3:-}"; }

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
partial=""
trap 'if [ -n "$partial" ]; then rm -f "$partial"; fi' EXIT

# Comprobación de un respaldo que no se puede leer no sirve de nada: (1) se descifra el archivo completo, lo que falla si la
# clave o el relleno no cuadran, y (2) se lee el índice del volcado. `pg_restore --list` cierra la tubería en cuanto termina
# el índice, así que en ese paso solo cuenta su resultado (sin pipefail).
verify_archive() {
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE -in "$1" > /dev/null || return 1
  (
    set +o pipefail
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE -in "$1" 2> /dev/null | pg_restore --list > /dev/null
  )
}

# backup_one <prefijo del archivo> <base de datos>
backup_one() {
  prefix="$1"
  database="$2"
  final="$BACKUP_DIR/$prefix-$stamp.dump.enc"
  partial="$final.partial"

  log info backup.start ",\"file\":\"$(basename "$final")\""

  pg_dump --dbname "$database" --format=custom --no-owner --no-privileges \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE -out "$partial"

  if ! verify_archive "$partial"; then
    log error backup.verify_failed ",\"file\":\"$(basename "$final")\""
    exit 1
  fi

  mv "$partial" "$final"
  partial=""
  bytes="$(wc -c < "$final" | tr -d ' ')"
  if [ "$prefix" = "boutique" ]; then
    sales="$(psql --dbname "$database" --no-psqlrc --tuples-only --no-align --command 'SELECT count(*) FROM "Sale"' 2> /dev/null || echo "?")"
    log info backup.done ",\"file\":\"$(basename "$final")\",\"bytes\":$bytes,\"sales\":\"$sales\""
  else
    log info backup.done ",\"file\":\"$(basename "$final")\",\"bytes\":$bytes"
  fi

  # Retención: se borran los respaldos con más de N días.
  deleted="$(find "$BACKUP_DIR" -maxdepth 1 -name "$prefix-*.dump.enc" -mtime "+$RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')"
  if [ "$deleted" -gt 0 ]; then
    log info backup.pruned ",\"file\":\"$prefix\",\"deleted\":$deleted,\"retentionDays\":$RETENTION_DAYS"
  fi
}

backup_one boutique "${PGDATABASE:?define PGDATABASE}"
# Con varios negocios (TENANCY_MODE=multi) la base central se respalda siempre, junto con la de la tienda.
control_db="${CONTROL_PGDATABASE:-}"
if [ -z "$control_db" ] && [ "${TENANCY_MODE:-single}" = "multi" ]; then
  control_db="${POSTGRES_CONTROL_DB:-boutique_pos_control}"
fi
if [ -n "$control_db" ]; then
  backup_one control "$control_db"
fi
