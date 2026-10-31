#!/bin/sh
# Un respaldo: volcado de la base (formato custom de pg_dump) cifrado con AES-256, comprobado y con retención.
# Variables: PGHOST PGUSER PGPASSWORD PGDATABASE (de Postgres), BACKUP_PASSPHRASE (obligatoria),
#            BACKUP_DIR (por omisión /backups), BACKUP_RETENTION_DAYS (por omisión 30).
# Resultado: $BACKUP_DIR/boutique-AAAAMMDDTHHMMSSZ.dump.enc (hora UTC). Sale con error si algo falla; nunca deja un archivo a medias.
set -eu
set -o pipefail

: "${BACKUP_PASSPHRASE:?define BACKUP_PASSPHRASE en .env.production}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

log() { printf '{"time":"%s","level":"%s","event":"%s"%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "${3:-}"; }

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$BACKUP_DIR/boutique-$stamp.dump.enc"
partial="$final.partial"
trap 'rm -f "$partial"' EXIT

log info backup.start ",\"file\":\"$(basename "$final")\""

pg_dump --format=custom --no-owner --no-privileges \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE -out "$partial"

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
if ! verify_archive "$partial"; then
  log error backup.verify_failed ",\"file\":\"$(basename "$final")\""
  exit 1
fi

mv "$partial" "$final"
bytes="$(wc -c < "$final" | tr -d ' ')"
sales="$(psql --no-psqlrc --tuples-only --no-align --command 'SELECT count(*) FROM "Sale"' 2> /dev/null || echo "?")"
log info backup.done ",\"file\":\"$(basename "$final")\",\"bytes\":$bytes,\"sales\":\"$sales\""

# Retención: se borran los respaldos con más de N días.
deleted="$(find "$BACKUP_DIR" -maxdepth 1 -name 'boutique-*.dump.enc' -mtime "+$RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')"
if [ "$deleted" -gt 0 ]; then
  log info backup.pruned ",\"deleted\":$deleted,\"retentionDays\":$RETENTION_DAYS"
fi
