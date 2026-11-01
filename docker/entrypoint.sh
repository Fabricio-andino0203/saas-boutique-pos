#!/bin/sh
# Arranque del contenedor: aplica las migraciones pendientes y levanta el servidor.
# Si una migración falla, el contenedor se detiene (y Docker lo reintenta): nunca se sirve tráfico con la base a medias.
set -eu

# Modo multi-negocio: primero la base CENTRAL de la plataforma (se crea si falta y se migra).
if [ "${TENANCY_MODE:-single}" = "multi" ]; then
  echo '{"level":"info","event":"control_migrate.start"}'
  node_modules/.bin/tsx scripts/control-setup.ts
  echo '{"level":"info","event":"control_migrate.done"}'
fi

# Suscripciones: se anotan los vencimientos al arrancar (el cron diario lo repite; ver docs/RUNBOOK.md §15). Si falla, no
# detiene el arranque: el acceso de cada negocio se calcula con la hora en cada petición, el barrido solo lo anota y avisa.
if [ "${TENANCY_MODE:-single}" = "multi" ]; then
  if node_modules/.bin/tsx scripts/billing.ts sweep; then
    echo '{"level":"info","event":"billing_sweep.done"}'
  else
    echo '{"level":"warn","event":"billing_sweep.failed","hint":"revisa pnpm billing:sweep"}'
  fi
fi

# La base de DATABASE_URL (la tienda de siempre, o el negocio #1 en modo multi-negocio). Si falla, el contenedor se detiene.
echo '{"level":"info","event":"migrate.start"}'
node_modules/.bin/prisma migrate deploy
echo '{"level":"info","event":"migrate.done"}'

# Varios negocios con la cuenta de aprovisionamiento configurada: se deja al día la plantilla de los negocios nuevos y se
# migra a toda la flota. A diferencia de lo anterior, un negocio que falla NO detiene el arranque: queda «en mantenimiento»
# con el motivo anotado y los demás siguen (ver docs/RUNBOOK.md §14).
if [ "${TENANCY_MODE:-single}" = "multi" ] && [ -n "${TENANT_PROVISIONING_URL:-}" ]; then
  echo '{"level":"info","event":"template.start"}'
  # Si la plantilla no se puede dejar al día, los negocios que ya existen siguen atendiéndose: solo fallarían las altas nuevas.
  if node_modules/.bin/tsx scripts/tenants.ts template; then
    echo '{"level":"info","event":"template.done"}'
  else
    echo '{"level":"warn","event":"template.failed","hint":"las altas nuevas fallarán hasta arreglarlo: revisa pnpm tenants:template"}'
  fi
  echo '{"level":"info","event":"fleet_migrate.start"}'
  if node_modules/.bin/tsx scripts/tenants.ts migrate; then
    echo '{"level":"info","event":"fleet_migrate.done"}'
  else
    echo '{"level":"warn","event":"fleet_migrate.partial","hint":"hay negocios en mantenimiento: revisa pnpm tenants:migrate"}'
  fi
fi

exec node_modules/.bin/next start --hostname 0.0.0.0 --port "${PORT:-3000}"
