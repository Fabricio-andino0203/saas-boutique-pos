# PgBouncer para muchos negocios (docs/RUNBOOK.md §17): la app abre cientos de conexiones HACIA ÉL y él mantiene pocas hacia Postgres.
# Modo transacción: una conexión real solo se usa mientras dura cada transacción. Opcional: solo se enciende con el perfil `pgbouncer`.
FROM alpine:3.21

RUN apk add --no-cache pgbouncer && adduser -D -H -u 1001 pgbouncer

COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh

USER pgbouncer
EXPOSE 6432
ENTRYPOINT ["/entrypoint.sh"]
