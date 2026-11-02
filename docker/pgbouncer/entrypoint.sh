#!/bin/sh
# Arma la configuración de PgBouncer desde variables de entorno y lo arranca.
#
# Cada negocio tiene su propio rol y su propia base, así que no hay una lista de usuarios fija: PgBouncer le pregunta a Postgres
# (`auth_query`) por la contraseña de quien se conecta, con una cuenta de solo consulta (PGB_AUTH_USER) que solo puede llamar a
# `pgbouncer.get_auth()` (se crea con `pnpm pgbouncer:setup`). Ninguna contraseña de negocio se guarda aquí.
set -eu

: "${PGB_HOST:?define PGB_HOST (el servidor de Postgres)}"
: "${PGB_AUTH_PASSWORD:?define PGB_AUTH_PASSWORD (la contraseña de la cuenta de consulta)}"

PGB_PORT="${PGB_PORT:-5432}"
PGB_AUTH_USER="${PGB_AUTH_USER:-pgbouncer}"
PGB_AUTH_DBNAME="${PGB_AUTH_DBNAME:-postgres}"
# Conexiones reales por cada pareja (base, rol), o sea, por negocio. Transacciones simultáneas de un mismo negocio.
PGB_POOL_SIZE="${PGB_POOL_SIZE:-4}"
PGB_MAX_CLIENT_CONN="${PGB_MAX_CLIENT_CONN:-4000}"
# Una conexión real ociosa se cierra pronto: con muchos negocios, dejar una abierta por cada uno agotaría Postgres.
PGB_SERVER_IDLE_TIMEOUT="${PGB_SERVER_IDLE_TIMEOUT:-3}"

DIR="/tmp/pgbouncer"
mkdir -p "$DIR"

cat > "$DIR/pgbouncer.ini" <<EOF
[databases]
* = host=${PGB_HOST} port=${PGB_PORT}

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
unix_socket_dir =
pool_mode = transaction
max_client_conn = ${PGB_MAX_CLIENT_CONN}
default_pool_size = ${PGB_POOL_SIZE}
min_pool_size = 0
server_idle_timeout = ${PGB_SERVER_IDLE_TIMEOUT}
server_lifetime = 3600
auth_type = scram-sha-256
auth_file = ${DIR}/userlist.txt
auth_user = ${PGB_AUTH_USER}
auth_dbname = ${PGB_AUTH_DBNAME}
auth_query = SELECT usename, passwd FROM pgbouncer.get_auth(\$1)
ignore_startup_parameters = extra_float_digits,options,application_name
log_connections = 0
log_disconnections = 0
stats_period = 60
EOF

# Solo la cuenta de consulta, para que PgBouncer pueda hacer la pregunta.
printf '"%s" "%s"\n' "$PGB_AUTH_USER" "$PGB_AUTH_PASSWORD" > "$DIR/userlist.txt"
chmod 0600 "$DIR/userlist.txt"

exec pgbouncer "$DIR/pgbouncer.ini"
