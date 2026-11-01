#!/bin/sh
# Arranque del contenedor: aplica las migraciones pendientes y levanta el servidor.
# Si una migración falla, el contenedor se detiene (y Docker lo reintenta): nunca se sirve tráfico con la base a medias.
set -eu

# Modo multi-negocio: primero la base CENTRAL de la plataforma (se crea si falta y se migra). Los negocios no se migran aquí:
# hoy el único es la tienda de DATABASE_URL (negocio #1), que se migra justo después; la migración de toda la flota es de la Etapa 3.
if [ "${TENANCY_MODE:-single}" = "multi" ]; then
  echo '{"level":"info","event":"control_migrate.start"}'
  node_modules/.bin/tsx scripts/control-setup.ts
  echo '{"level":"info","event":"control_migrate.done"}'
fi

echo '{"level":"info","event":"migrate.start"}'
node_modules/.bin/prisma migrate deploy
echo '{"level":"info","event":"migrate.done"}'

exec node_modules/.bin/next start --hostname 0.0.0.0 --port "${PORT:-3000}"
