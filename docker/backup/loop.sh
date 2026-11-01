#!/bin/sh
# Servicio de respaldos: hace el respaldo diario a BACKUP_TIME (hora de TZ, por omisión 02:00) y, con varios negocios, atiende cada
# pocos segundos los respaldos que se pidieron desde el panel. Si todavía no hay ningún respaldo (instalación nueva) o el último
# tiene más de un día, respalda de inmediato al arrancar.
set -u

BACKUP_TIME="${BACKUP_TIME:-02:00}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
POLL_SECONDS="${BACKUP_POLL_SECONDS:-15}"

log() { printf '{"time":"%s","level":"%s","event":"%s"%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "${3:-}"; }

run_backup() {
  if ! /scripts/backup.sh; then
    log error backup.failed ""
  fi
}

# Los pedidos manuales solo existen con varios negocios (el registro vive en la base central).
run_requests() {
  [ "${TENANCY_MODE:-single}" = "multi" ] || return 0
  /scripts/requests.sh "$@" || log error backup.requests_failed ""
}

# El próximo momento de BACKUP_TIME, en segundos desde 1970.
next_target() {
  now="$(date +%s)"
  target="$(date -d "$(date +%Y-%m-%d) $BACKUP_TIME:00" +%s)"
  if [ "$target" -le "$now" ]; then
    target=$((target + 86400))
  fi
  printf '%s' "$target"
}

mkdir -p "$BACKUP_DIR"
run_requests --boot
if [ -z "$(find "$BACKUP_DIR" -maxdepth 1 -name 'boutique-*.dump.enc' -mmin -1440 | head -n 1)" ]; then
  run_backup
fi

target="$(next_target)"
log info backup.scheduled ",\"in_seconds\":$((target - $(date +%s))),\"at\":\"$BACKUP_TIME\""
while true; do
  if [ "$(date +%s)" -ge "$target" ]; then
    run_backup
    target="$(next_target)"
    log info backup.scheduled ",\"in_seconds\":$((target - $(date +%s))),\"at\":\"$BACKUP_TIME\""
  fi
  run_requests
  sleep "$POLL_SECONDS"
done
