# Contenedor de respaldos: las herramientas de Postgres 16 (pg_dump, pg_restore, psql) más openssl y la zona horaria.
FROM postgres:16-alpine
RUN apk add --no-cache openssl tzdata
COPY backup.sh restore.sh loop.sh /scripts/
RUN chmod +x /scripts/*.sh
# Se anula el arranque de Postgres de la imagen base: aquí solo corre el ciclo de respaldos.
ENTRYPOINT []
CMD ["/scripts/loop.sh"]
