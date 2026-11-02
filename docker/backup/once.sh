#!/bin/sh
# UN ciclo de respaldos para un servicio de cron (Railway): atiende los respaldos que se pidieron desde el panel, respalda a todos los
# negocios (cada archivo se sube al destino de afuera apenas queda listo) y termina. No deja nada encendido: se paga solo lo que
# dura. Sale con 1 si algo falló, para que el servicio de cron lo marque en rojo.
#
# Variables: las de backup.sh (PGHOST PGUSER PGPASSWORD PGDATABASE, BACKUP_PASSPHRASE, BACKUP_RETENTION_DAYS, TENANCY_MODE…) y
#            OFFSITE_REMOTE (obligatoria: «nombre:carpeta» de rclone; la configuración va en RCLONE_CONFIG_<NOMBRE>_*).
# Limitación: los respaldos que se piden desde el panel se atienden en la próxima corrida del cron, no al instante.
set -u
set -o pipefail

. /scripts/lib.sh

[ -n "$OFFSITE_REMOTE" ] || { echo "Falta OFFSITE_REMOTE: sin un destino de afuera este servicio perdería los respaldos al terminar." >&2; exit 2; }

status=0
if [ "${TENANCY_MODE:-single}" = "multi" ]; then
  /scripts/requests.sh --boot || status=1
fi
/scripts/backup.sh || status=1
exit "$status"
