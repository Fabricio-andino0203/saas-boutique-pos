#!/bin/sh
# Las tareas diarias de la plataforma, en una sola corrida (para un cron: en Railway, un servicio con esta orden de inicio y la
# programación `0 9 * * *`, que es UTC; en un servidor propio, una línea de cron con `docker compose exec -T app sh docker/daily.sh`).
#
#   1. billing:sweep   anota quién entró en gracia, en solo lectura o se canceló, y pide la baja de los cancelados  (RUNBOOK §15)
#   2. usage:collect   la foto de uso de cada negocio                                                              (RUNBOOK §16)
#   3. alerts:check    imprime las alertas; sale con 1 si hay algo grave o que conviene revisar                    (RUNBOOK §16)
#
# Cada paso corre aunque otro falle. Sale con 1 si CUALQUIERA falló, así el servicio de cron lo marca en rojo; las alertas de
# `alerts:check` también dejan ese código a propósito: es el aviso. Todos son repetibles: correrlos dos veces no hace daño.
set -u

status=0
for task in "billing sweep" "usage collect" "alerts check"; do
  script="${task% *}"
  command="${task#* }"
  echo "{\"level\":\"info\",\"event\":\"daily.start\",\"task\":\"$script:$command\"}"
  if node_modules/.bin/tsx "scripts/$script.ts" "$command"; then
    echo "{\"level\":\"info\",\"event\":\"daily.done\",\"task\":\"$script:$command\"}"
  else
    echo "{\"level\":\"warn\",\"event\":\"daily.failed\",\"task\":\"$script:$command\"}"
    status=1
  fi
done
exit "$status"
