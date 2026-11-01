#!/bin/sh
# Restaura el respaldo de UN negocio sin tocar a los demás. Nunca borra datos: restaura en una base temporal y, solo si todo salió
# bien, la deja con el nombre pedido; si el negocio ya tenía base (RESTORE_REPLACE=yes) la RENOMBRA a z_replaced_<base>_<fecha>
# en vez de borrarla (se retira después con el borrado guiado del panel, o a mano).
#
# Uso:   restore-tenant.sh <archivo .dump.enc> <base destino>
#        (la base destino de un negocio es t_<id>; está en la página del negocio, en «Base de datos».)
# Variables: PGHOST PGUSER PGPASSWORD (de Postgres), BACKUP_PASSPHRASE (la misma con la que se cifró),
#            RESTORE_REPLACE=yes (obligatoria si el negocio ya tiene su base).
#
# Antes: suspender el negocio en el panel (así nadie escribe mientras se cambia la base).
# Después, en la aplicación:  pnpm tenants:relink <subdominio>   (rol, permisos y versión)
#                              pnpm db:verify --tenant <subdominio>  (los libros cuadran)
# y reactivar el negocio. Este script solo devuelve los DATOS; el rol de aplicación y los permisos no viajan en un volcado.
set -u
set -o pipefail

. /scripts/lib.sh

file="${1:?uso: restore-tenant.sh <archivo .dump.enc> <base destino>}"
target="${2:?uso: restore-tenant.sh <archivo .dump.enc> <base destino>}"

[ -f "$file" ] || { echo "No existe el archivo: $file" >&2; exit 2; }
is_identifier "$target" || { echo "El nombre de la base solo puede tener letras minúsculas, números y guion bajo: $target" >&2; exit 2; }

# De qué base salió el archivo (va en su nombre) decide la llave: tenant-<base>-… y final-<base>-… usan la propia de esa base;
# boutique-… y control-… usan la clave tal cual. Los respaldos de la Etapa 3 (tenant-… con la clave tal cual) también abren.
name="$(basename "$file")"
source_db=""
case "$name" in
  tenant-*) source_db="${name#tenant-}"; source_db="${source_db%-[0-9]*T*Z.dump.enc}" ;;
  final-*) source_db="${name#final-}"; source_db="${source_db%-[0-9]*T*Z.dump.enc}" ;;
esac

can_read() { # can_read <llave> : ¿abre el archivo y se lee su índice?
  BACKUP_KEY="$1"
  export BACKUP_KEY
  verify_archive "$file" 2> /dev/null
}

echo "1/5 Comprobando que el archivo y la clave sirven..."
key=""
if [ -n "$source_db" ] && is_identifier "$source_db" && can_read "$(derive_key "$source_db")"; then
  key="$(derive_key "$source_db")"
elif can_read "$BACKUP_PASSPHRASE"; then
  key="$BACKUP_PASSPHRASE"
fi
[ -n "$key" ] || { echo "No se pudo abrir: la clave no es la del respaldo, el archivo está dañado o no es un volcado de Postgres." >&2; exit 4; }
BACKUP_KEY="$key"
export BACKUP_KEY

sql() { psql --dbname postgres --no-psqlrc --quiet --tuples-only --no-align --command "$1"; }
decrypt() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_KEY -in "$file"; }

exists="$(sql "SELECT 1 FROM pg_database WHERE datname = '$target'")"
if [ "$exists" = "1" ] && [ "${RESTORE_REPLACE:-no}" != "yes" ]; then
  echo "La base $target ya existe. Para reemplazarla repite con RESTORE_REPLACE=yes (la anterior se conserva con otro nombre)." >&2
  exit 3
fi

staging="${target}_restoring"
echo "2/5 Preparando una base temporal ($staging)..."
sql "DROP DATABASE IF EXISTS \"$staging\" WITH (FORCE)" > /dev/null
sql "CREATE DATABASE \"$staging\"" > /dev/null
# Desde el primer momento solo el administrador puede entrar a la base: sin esto cualquier rol del servidor podría conectarse.
sql "REVOKE CONNECT ON DATABASE \"$staging\" FROM PUBLIC" > /dev/null
done_ok="no"
cleanup() {
  if [ "$done_ok" != "yes" ]; then
    echo "La restauración falló: se descarta la base temporal $staging (no se tocó ninguna otra)." >&2
    sql "DROP DATABASE IF EXISTS \"$staging\" WITH (FORCE)" > /dev/null || true
  fi
}
trap cleanup EXIT

echo "3/5 Restaurando $name en la base temporal..."
decrypt | pg_restore --no-owner --no-privileges --exit-on-error --dbname "$staging" || {
  echo "pg_restore terminó con error." >&2
  exit 6
}

echo "4/5 Dejando la base como $target..."
if [ "$exists" = "1" ]; then
  old="z_replaced_${target}_$(date -u +%Y%m%d%H%M%S)"
  # Se cierran las puertas de la base vieja y se echa a quien siga conectado (solo a este negocio; los demás ni lo notan).
  sql "ALTER DATABASE \"$target\" WITH ALLOW_CONNECTIONS false" > /dev/null
  sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$target' AND pid <> pg_backend_pid()" > /dev/null
  if ! sql "ALTER DATABASE \"$target\" RENAME TO \"$old\"" > /dev/null; then
    sql "ALTER DATABASE \"$target\" WITH ALLOW_CONNECTIONS true" > /dev/null || true
    echo "No se pudo renombrar $target (¿algo sigue conectado a esa base?). No se cambió nada." >&2
    exit 5
  fi
  # La base vieja vuelve a admitir conexiones (para poder volcarla antes de borrarla) pero ya no para el rol del negocio.
  sql "ALTER DATABASE \"$old\" WITH ALLOW_CONNECTIONS true" > /dev/null
  if [ "$(sql "SELECT 1 FROM pg_roles WHERE rolname = '$target'")" = "1" ]; then
    sql "REVOKE CONNECT ON DATABASE \"$old\" FROM \"$target\"" > /dev/null
  fi
  echo "    La base anterior quedó como $old (se retira con el borrado guiado del panel cuando ya no la necesites)."
fi
sql "ALTER DATABASE \"$staging\" RENAME TO \"$target\"" > /dev/null
done_ok="yes"

echo "5/5 Listo. Lo que quedó en $target:"
psql --dbname "$target" --no-psqlrc --tuples-only --no-align --field-separator ' · ' --command \
  'SELECT (SELECT count(*) FROM "User") AS usuarios, (SELECT count(*) FROM "Product") AS productos, (SELECT count(*) FROM "Sale") AS ventas, (SELECT count(*) FROM "StockMovement") AS movimientos, COALESCE((SELECT max("number") FROM "Sale"), '"'"'ninguna'"'"') AS "ultima venta"'
echo "Faltan dos pasos en la aplicación (el rol del negocio y sus permisos no viajan en un volcado):"
echo "    pnpm tenants:relink <subdominio>"
echo "    pnpm db:verify --tenant <subdominio>"
