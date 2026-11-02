#!/bin/sh
# Devuelve las fotos de productos de UN negocio desde su respaldo (photos-….tar.enc). No borra nada: agrega o reemplaza archivos de la
# carpeta de ese negocio con los del respaldo y no toca a los demás negocios.
#
# Uso:   restore-photos.sh <archivo photos-….tar.enc>
# Variables: BACKUP_PASSPHRASE (la misma con la que se cifró),
#            PHOTOS_DIR (por omisión /photos: el volumen de fotos de la aplicación, montado para ESCRIBIR),
#            PHOTOS_OWNER (por omisión 1000:1000, el usuario `node` de la aplicación: así puede seguir subiendo fotos).
#
# Cuándo: después de restaurar la base de un negocio (restore.sh / restore-tenant.sh), si su carpeta de fotos se perdió. Una foto
# cuyo archivo falta no rompe nada (se ve un recuadro vacío), pero conviene devolverla. Ver docs/RUNBOOK.md §18.
set -u
set -o pipefail

. /scripts/lib.sh

file="${1:?uso: restore-photos.sh <archivo photos-….tar.enc>}"
[ -f "$file" ] || { echo "No existe el archivo: $file" >&2; exit 2; }

# El nombre dice de qué base salió y eso decide la llave (igual que en los volcados): photos-boutique-… usa la clave tal cual;
# photos-tenant-<base>-… usa la propia de esa base.
name="$(basename "$file")"
source_db=""
case "$name" in
  photos-tenant-*) source_db="${name#photos-tenant-}"; source_db="${source_db%-[0-9]*T*Z.tar.enc}" ;;
esac

can_read() { # can_read <llave> : ¿abre el archivo y se lee su contenido?
  BACKUP_KEY="$1"
  export BACKUP_KEY
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_KEY -in "$file" 2> /dev/null | tar -tf - > /dev/null 2>&1
}

echo "1/3 Comprobando que el archivo y la clave sirven..."
key=""
if [ -n "$source_db" ] && is_identifier "$source_db" && can_read "$(derive_key "$source_db")"; then
  key="$(derive_key "$source_db")"
elif can_read "$BACKUP_PASSPHRASE"; then
  key="$BACKUP_PASSPHRASE"
fi
[ -n "$key" ] || { echo "No se pudo abrir: la clave no es la del respaldo o el archivo está dañado." >&2; exit 4; }
BACKUP_KEY="$key"
export BACKUP_KEY

[ -d "$PHOTOS_DIR" ] && [ -w "$PHOTOS_DIR" ] || { echo "La carpeta de fotos $PHOTOS_DIR no existe o no se puede escribir (móntala sin :ro)." >&2; exit 5; }

# La única carpeta de primer nivel del archivo es la del negocio; se muestra para que se vea qué se va a tocar.
folder="$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_KEY -in "$file" | tar -tf - | head -n 1 | cut -d/ -f1)"
case "$folder" in '' | *[!A-Za-z0-9_-]*) echo "El archivo no trae una carpeta de negocio válida." >&2; exit 6 ;; esac
echo "2/3 Devolviendo las fotos de «$folder» a $PHOTOS_DIR (no se borra nada)..."
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_KEY -in "$file" | tar -C "$PHOTOS_DIR" -xf - || {
  echo "No se pudieron extraer las fotos." >&2
  exit 7
}
chown -R "${PHOTOS_OWNER:-1000:1000}" "$PHOTOS_DIR/$folder"

echo "3/3 Listo: $(find "$PHOTOS_DIR/$folder" -type f | wc -l | tr -d ' ') archivos en la carpeta del negocio."
