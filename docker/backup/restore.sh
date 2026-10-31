#!/bin/sh
# Restaura un respaldo cifrado. Nunca borra datos: restaura en una base temporal y, solo si todo salió bien, la deja con el
# nombre pedido; si ya existía una base con ese nombre (RESTORE_REPLACE=yes) la RENOMBRA a <nombre>_old_<fecha> en vez de borrarla.
# Uso:   restore.sh <archivo .dump.enc> <nombre de la base destino>
# Variables: PGHOST PGUSER PGPASSWORD (de Postgres), BACKUP_PASSPHRASE (la misma con la que se cifró).
# Prueba de restauración: usar otro nombre (p. ej. boutique_pos_restore) y revisarlo con `VERIFY_DATABASE=... pnpm db:verify`.
# Recuperar la tienda de verdad: detener la app (la base real no puede tener conexiones), restaurar con el nombre de la base
# real y RESTORE_REPLACE=yes, y levantar la app otra vez.
set -eu
set -o pipefail

file="${1:?uso: restore.sh <archivo .dump.enc> <base destino>}"
target="${2:?uso: restore.sh <archivo .dump.enc> <base destino>}"
: "${BACKUP_PASSPHRASE:?define BACKUP_PASSPHRASE (la clave con la que se cifró el respaldo)}"

[ -f "$file" ] || { echo "No existe el archivo: $file" >&2; exit 2; }
case "$target" in
  "" | *[!A-Za-z0-9_]*) echo "El nombre de la base solo puede tener letras, números y guion bajo: $target" >&2; exit 2 ;;
esac

sql() { psql --dbname postgres --no-psqlrc --tuples-only --no-align --command "$1"; }
decrypt() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE -in "$file"; }

exists="$(sql "SELECT 1 FROM pg_database WHERE datname = '$target'")"
if [ "$exists" = "1" ] && [ "${RESTORE_REPLACE:-no}" != "yes" ]; then
  echo "La base $target ya existe. Para reemplazarla repite con RESTORE_REPLACE=yes (la anterior se conserva con otro nombre)." >&2
  exit 3
fi

echo "1/4 Comprobando que el archivo y la clave sirven..."
decrypt > /dev/null || { echo "No se pudo descifrar: la clave no es la del respaldo o el archivo está dañado." >&2; exit 4; }
(
  set +o pipefail
  decrypt 2> /dev/null | pg_restore --list > /dev/null
) || { echo "El archivo se descifró pero no es un volcado de Postgres válido." >&2; exit 4; }

staging="${target}_restoring"
sql "DROP DATABASE IF EXISTS \"$staging\" WITH (FORCE)" > /dev/null
sql "CREATE DATABASE \"$staging\"" > /dev/null
cleanup() {
  if [ "${done_ok:-no}" != "yes" ]; then
    echo "La restauración falló: se descarta la base temporal $staging (no se tocó ninguna otra)." >&2
    sql "DROP DATABASE IF EXISTS \"$staging\" WITH (FORCE)" > /dev/null || true
  fi
}
trap cleanup EXIT

echo "2/4 Restaurando $(basename "$file") en una base temporal..."
decrypt | pg_restore --no-owner --no-privileges --exit-on-error --dbname "$staging"

echo "3/4 Dejando la base como $target..."
if [ "$exists" = "1" ]; then
  old="${target}_old_$(date -u +%Y%m%d%H%M%S)"
  sql "ALTER DATABASE \"$target\" RENAME TO \"$old\"" > /dev/null \
    || { echo "No se pudo renombrar $target (¿la app sigue conectada? deténla primero)." >&2; exit 5; }
  echo "    La base anterior quedó como $old (bórrala cuando ya no la necesites)."
fi
sql "ALTER DATABASE \"$staging\" RENAME TO \"$target\"" > /dev/null
done_ok=yes

echo "4/4 Listo. Lo que quedó en $target:"
psql --dbname "$target" --no-psqlrc --tuples-only --no-align --field-separator ' · ' --command \
  'SELECT (SELECT count(*) FROM "User") AS usuarios, (SELECT count(*) FROM "Product") AS productos, (SELECT count(*) FROM "Sale") AS ventas, (SELECT count(*) FROM "StockMovement") AS movimientos, COALESCE((SELECT max("number") FROM "Sale"), '"'"'ninguna'"'"') AS "ultima venta"'
echo "Falta el último paso: revisar que los libros cuadran con  VERIFY_DATABASE=$target pnpm db:verify"
