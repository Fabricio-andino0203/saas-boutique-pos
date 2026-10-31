#!/bin/sh
# Respaldo diario: espera hasta BACKUP_TIME (hora de TZ, por omisión 02:00), respalda y repite. Si todavía no hay ningún
# respaldo (instalación nueva) o el último tiene más de un día, respalda de inmediato al arrancar.
set -eu

BACKUP_TIME="${BACKUP_TIME:-02:00}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"

log() { printf '{"time":"%s","level":"%s","event":"%s"%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "${3:-}"; }

run_backup() {
  if ! /scripts/backup.sh; then
    log error backup.failed ""
  fi
}

mkdir -p "$BACKUP_DIR"
if [ -z "$(find "$BACKUP_DIR" -maxdepth 1 -name 'boutique-*.dump.enc' -mmin -1440 | head -n 1)" ]; then
  run_backup
fi

while true; do
  now="$(date +%s)"
  target="$(date -d "$(date +%Y-%m-%d) $BACKUP_TIME:00" +%s)"
  if [ "$target" -le "$now" ]; then
    target=$((target + 86400))
  fi
  log info backup.scheduled ",\"in_seconds\":$((target - now)),\"at\":\"$BACKUP_TIME\""
  sleep "$((target - now))"
  run_backup
done
