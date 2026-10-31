#!/bin/sh
# Arranque del contenedor: aplica las migraciones pendientes y levanta el servidor.
# Si una migración falla, el contenedor se detiene (y Docker lo reintenta): nunca se sirve tráfico con la base a medias.
set -eu

echo '{"level":"info","event":"migrate.start"}'
node_modules/.bin/prisma migrate deploy
echo '{"level":"info","event":"migrate.done"}'

exec node_modules/.bin/next start --hostname 0.0.0.0 --port "${PORT:-3000}"
