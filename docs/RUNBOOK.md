# Manual de operación (RUNBOOK)

> Para quien instala y cuida el servidor. Todos los comandos de esta guía se probaron en el repositorio (instalación limpia, venta, respaldo, restauración en un servidor vacío, cambio de contraseña de la base). Si algo contradice a `CLAUDE.md` o a `docs/ARCHITECTURE.md`, gana `CLAUDE.md`.

## 1. Qué hay en el servidor

`docker-compose.prod.yml` levanta cuatro servicios, todos con reinicio automático y registros rotados (10 MB × 5):

| Servicio | Qué hace | Se ve desde fuera |
| --- | --- | --- |
| `db` | PostgreSQL 16 con sus datos en el volumen `pgdata` | No (solo la red interna) |
| `app` | El sistema (Next.js). Al arrancar aplica las migraciones pendientes | No (solo detrás de Caddy) |
| `caddy` | HTTPS automático, HSTS, compresión; reescribe la IP real del cliente | Puertos 80 y 443 |
| `backup` | Respaldo diario cifrado a las 02:00 (hora de la tienda) | No |

Los respaldos quedan en la carpeta `./backups` del servidor (o en `BACKUP_PATH`). **El volumen `pgdata`, esa carpeta y el volumen `uploads` (las fotos de los productos, §18) son lo único que no se puede reconstruir**: todo lo demás sale del repositorio.

Para no escribir el comando largo cada vez, en el servidor:

```bash
alias dc='docker compose --env-file .env.production -f docker-compose.prod.yml'
```

(Ponlo en `~/.bashrc` para que quede.) En el resto de la guía `dc` significa eso.

## 2. Primera instalación

Requisitos: un servidor Linux con Docker y `docker compose` (Docker Engine 24 o más nuevo), `git`, un nombre de dominio que apunte a la IP del servidor y los puertos 80 y 443 abiertos hacia internet (Caddy los necesita para pedir el certificado). La construcción de la imagen necesita internet (descarga dependencias y la tipografía).

1. Clonar el repositorio y entrar en la carpeta (por ejemplo `/opt/boutique-pos`).
2. Crear la configuración:

   ```bash
   cp .env.production.example .env.production
   ```

   Completar `DOMAIN`, `APP_URL` (con `https://`), `POSTGRES_PASSWORD` (`openssl rand -hex 24`), `AUTH_SECRET` (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) y `BACKUP_PASSPHRASE` (`openssl rand -base64 33`). **Guardar `BACKUP_PASSPHRASE` también fuera del servidor** (gestor de contraseñas o caja fuerte): sin ella los respaldos no se pueden abrir y no hay forma de recuperarla.

3. Levantar todo (la primera vez tarda varios minutos en construir):

   ```bash
   dc up -d --build
   dc ps          # todo debe quedar "healthy" o "Up"
   ```

   Si `APP_URL` no es `https`, o `AUTH_SECRET`/`POSTGRES_PASSWORD` siguen siendo textos de ejemplo, la app se niega a arrancar y lo dice en `dc logs app`.

4. Crear al propietario (pide nombre, usuario, contraseña dos veces y un PIN opcional):

   ```bash
   dc exec app pnpm admin:create-owner
   ```

   No existen usuarios de demostración en producción: `pnpm db:seed` se niega a correr con `DEPLOYMENT=production`.

5. Abrir `https://tu-dominio`, entrar con ese usuario y completar la **Bienvenida** (datos del negocio, impuestos, reglas de venta, mercadería).
6. Programar la tarea diaria de apartados vencidos (sección 3) y **copiar los respaldos fuera del servidor** (sección 5).
7. Configurar el monitor externo (sección 7).

## 3. Día a día

```bash
dc ps                                # estado de los servicios
dc logs --tail 100 -f app            # registro de la app (una línea de JSON por evento)
dc logs app | grep '"level":"error"' # solo errores
```

**Tarea diaria de apartados vencidos.** Sin ella los apartados solo vencen cuando alguien abre la pantalla de venta. En el `crontab` del servidor (`crontab -e`), ajustando la carpeta:

```cron
0 3 * * * cd /opt/boutique-pos && docker compose --env-file .env.production -f docker-compose.prod.yml exec -T app pnpm job:expire-layaways >> /var/log/boutique-apartados.log 2>&1
```

Es segura de repetir: si no hay nada vencido, no hace nada. Actúa como el propietario activo más antiguo.

## 4. Actualizar a una versión nueva

1. Avisar en la tienda: la app se reinicia (≈ 30 s sin servicio).
2. **Respaldo manual antes de actualizar** (las migraciones no se revierten):

   ```bash
   dc exec -T backup /scripts/backup.sh
   ```

3. Traer y levantar:

   ```bash
   git pull
   dc up -d --build
   dc logs --tail 30 app     # debe terminar en "migrate.done" y "server.start"
   ```

4. Entrar y comprobar una venta de prueba. Si algo falla y hay migraciones nuevas de por medio, **no basta con volver al código anterior**: restaurar el respaldo del paso 2 (sección 6B) y luego volver a la versión anterior (`git checkout <etiqueta>` y `dc up -d --build`).

Si una migración falla, el contenedor `app` se detiene y se reinicia en bucle sin atender tráfico (a propósito: nunca se sirve con la base a medias). `/api/health` también responde 503 mientras haya una migración sin terminar.

## 5. Respaldos

- **Qué:** un volcado completo de Postgres (`pg_dump`), cifrado con AES-256 y la clave `BACKUP_PASSPHRASE`, a las 02:00 todos los días. Si al arrancar no hay ninguno de las últimas 24 horas, hace uno de inmediato. Cada uno se **comprueba** (se descifra completo y se lee su índice) antes de conservarlo; si no se puede leer, no queda archivo y el registro dice `backup.verify_failed`.
- **Dónde:** `./backups/boutique-AAAAMMDDTHHMMSSZ.dump.enc` (hora UTC en el nombre). Se conservan 30 días (`BACKUP_RETENTION_DAYS`).
- **Cómo saber que funciona:** `dc ps` muestra `backup` como `healthy` solo si hay un respaldo de las últimas 26 horas. `dc logs backup` muestra `backup.done` con el tamaño y la cantidad de ventas.
- **Copiarlos fuera del servidor (obligatorio):** un respaldo en el mismo disco no sirve si el disco muere. El sistema no trae cliente de nube; se copia la carpeta desde el servidor con lo que uses: `rclone sync /opt/boutique-pos/backups remoto:boutique`, `rsync` a otro equipo, un disco externo… Programarlo en el `crontab` a las 04:00 (después del respaldo). Los archivos ya van cifrados.
- **La clave:** sin `BACKUP_PASSPHRASE` los archivos son basura. Si se cambia (sección 8), los respaldos viejos siguen necesitando la clave vieja: guardar las dos.

## 6. Restaurar

### A. Ensayo (hacerlo al instalar y cada tres meses)

Restaura en una base **aparte** sin tocar la real y revisa que los libros cuadren:

```bash
ls backups/                                           # elegir un archivo
dc exec -T backup /scripts/restore.sh /backups/boutique-AAAAMMDDTHHMMSSZ.dump.enc boutique_pos_ensayo
dc exec app sh -c 'VERIFY_DATABASE=boutique_pos_ensayo pnpm db:verify'
```

Debe terminar con `Libros cuadrados: todas las comprobaciones pasaron.` y mostrar usuarios, productos, ventas y la última venta que esperas. Cuando termines, la base de ensayo se borra a mano:

```bash
dc exec -T db psql -U boutique -d postgres -c 'DROP DATABASE boutique_pos_ensayo'
```

(`boutique` es el valor de `POSTGRES_USER`.) Con la clave equivocada el script se detiene al principio con un mensaje claro y no crea nada.

### B. Recuperar la tienda de verdad

1. Si es un servidor nuevo: seguir la sección 2 hasta el paso 3, pero **sin crear el propietario** (viene en el respaldo) y con el **mismo `BACKUP_PASSPHRASE`**. Copiar al servidor el archivo de respaldo más reciente (a `./backups/`).
2. Detener la app para que suelte la base:

   ```bash
   dc stop app caddy
   ```

3. Restaurar sobre la base real. La anterior **no se borra**: se renombra a `boutique_pos_old_<fecha>`.

   ```bash
   dc exec -T -e RESTORE_REPLACE=yes backup /scripts/restore.sh /backups/boutique-AAAAMMDDTHHMMSSZ.dump.enc boutique_pos
   ```

4. Volver a levantar y revisar:

   ```bash
   dc up -d
   dc exec app pnpm db:verify
   ```

   Si `db:verify` lista problemas, **no abrir la tienda** y avisar con la salida completa.
5. Entrar, comprobar la última venta y abrir caja. Lo vendido después del último respaldo (hasta 24 horas) hay que registrarlo a mano.
6. Cuando todo esté bien, borrar la base vieja (`boutique_pos_old_...`) como en el ensayo.

Ensayado: un respaldo cifrado con un año de historia (3,3 MB, ≈ 21 000 líneas de venta) se restauró en 6 segundos en un servidor Postgres vacío con las mismas cifras que el original, los libros cuadraron, la app arrancó sobre esa base y se pudo entrar.

## 7. Monitoreo y alertas

- **Monitor externo (recomendado, gratuito):** un servicio como UptimeRobot o Better Stack que pida `https://tu-dominio/api/health` cada minuto y avise por correo o WhatsApp si no responde `200` con `{"status":"ok"}`. `/api/health` responde `503` si la base no contesta o si hay una migración a medias. Es lo que avisa de que se cayó el servidor completo, algo que ningún programa dentro del mismo servidor puede hacer.
- **Dentro del servidor:** `dc ps` (los servicios `app`, `db` y `backup` tienen verificación de salud) y el registro de la app.
- **Eventos del registro** (`dc logs app`, una línea de JSON cada uno):

  | Evento | Qué significa | Qué hacer |
  | --- | --- | --- |
  | `server.start` | La app arrancó (versión, modo) | Nada |
  | `request.error` / `action.unexpected` | Un error del servidor (con su resumen, sin datos sensibles) | Si se repite, avisar con el texto |
  | `auth.login_failed` | Intento fallido de entrar (IP y motivo; nunca la contraseña) | Vigilar si salen muchos |
  | `auth.rate_limited` | Una IP llegó a 20 fallos en 15 min y quedó bloqueada | Ver "Incidentes" |
  | `health.unhealthy` | `/api/health` respondió 503 | Ver "Incidentes" |
  | `backup.done` / `backup.failed` / `backup.verify_failed` | Resultado del respaldo diario | Si falla, ver `dc logs backup` |

- **Error tracking (Sentry u otro):** no está conectado todavía (necesita una cuenta); el punto de enganche es `onRequestError` en `src/instrumentation.ts`.

## 8. Cambiar secretos

- **Contraseña de la base** (`POSTGRES_PASSWORD`). Primero dentro de Postgres y luego en el archivo, para que no se desfasen:

  ```bash
  NUEVA=$(openssl rand -hex 24)
  dc exec -T db psql -U boutique -d postgres -c "ALTER USER boutique PASSWORD '$NUEVA'"
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$NUEVA/" .env.production
  dc up -d        # recrea app y backup con la contraseña nueva; los datos no se tocan
  dc ps
  ```

- **Clave de respaldos** (`BACKUP_PASSPHRASE`): cambiarla en `.env.production` y `dc up -d backup`. Los respaldos **nuevos** usan la nueva; los **viejos solo se abren con la vieja**. Guardar las dos con la fecha del cambio.
- **`AUTH_SECRET`:** hoy el sistema la exige al arrancar pero **no se usa para nada más** (las sesiones son tokens aleatorios guardados con hash, no dependen de ella), así que cambiarla no cierra sesiones. Queda reservada para cuando haga falta firmar algo; mientras tanto basta con que sea larga y propia.
- **Contraseña o PIN de una persona:** el propietario o el gerente la restablece desde **Usuarios**; eso también desbloquea la cuenta y cierra sus sesiones abiertas.
- **Cerrar todas las sesiones a la vez:** `dc exec -T db psql -U boutique -d boutique_pos -c 'DELETE FROM "Session"'` (todos tendrán que volver a entrar).

## 9. Incidentes

| Síntoma | Qué mirar | Qué hacer |
| --- | --- | --- |
| La página no abre o da error 502/504 | `dc ps`; `dc logs --tail 100 app` | Si `app` se reinicia en bucle: casi siempre es una migración fallida o una variable inválida; el registro dice cuál. Si está caído: `dc up -d`. |
| `/api/health` da 503 | `dc logs db`; espacio en disco | Si la base no responde: `dc restart db`. Si hay una migración sin terminar: restaurar el respaldo previo a la actualización (sección 6B). |
| "Demasiados intentos fallidos desde este equipo" | `dc logs app \| grep auth.rate_limited` | Esperar 15 minutos (o `dc restart app`, que borra los contadores). Si todos los cajeros salen por la misma IP y alguien insiste con claves malas, bloquea a toda la tienda: avisarles que esperen. |
| Una persona no puede entrar ("bloqueada") | Usuarios → ese usuario | Esperar 15 minutos, o restablecer su contraseña o PIN (desbloquea al instante). |
| El respaldo aparece `unhealthy` | `dc logs backup`; `df -h` | Revisar disco lleno, `BACKUP_PASSPHRASE` definida y que `db` esté sana; lanzarlo a mano: `dc exec -T backup /scripts/backup.sh`. |
| Disco lleno | `df -h`; `docker system df` | Mover respaldos viejos ya copiados fuera, `docker image prune`; los registros ya se rotan solos. |
| Inventario o caja que "no cuadran" | `dc exec app pnpm db:verify` y `dc exec app pnpm db:reconcile` | Guardar la salida completa y avisar. **No tocar la base a mano**: las ventas, los movimientos y la auditoría no se editan. |
| Se perdió `BACKUP_PASSPHRASE` | — | Los respaldos existentes no se pueden recuperar. Poner una clave nueva (sección 8), hacer un respaldo manual de inmediato y guardarla en dos lugares. |
| Sospecha de acceso indebido | `dc logs app \| grep auth.`; pantalla Auditoría | Restablecer las contraseñas de todos, cerrar todas las sesiones, cambiar la contraseña de la base (sección 8) y, si hay datos alterados, restaurar el último respaldo bueno. |
| Se perdió el servidor completo | — | Servidor nuevo + sección 6B con el respaldo más reciente copiado fuera. |

## 10. Mantenimiento periódico

- **Cada mes:** `dc exec app pnpm db:verify` (revisa que los libros cuadran), `df -h`, confirmar que los respaldos llegan fuera del servidor.
- **Cada tres meses:** ensayo de restauración (6A) con el respaldo más reciente.
- **Cada actualización de Docker o del sistema:** `dc pull db caddy && dc up -d` para tener las imágenes base al día.
- **Dependencias:** el repositorio revisa vulnerabilidades en cada integración (`pnpm audit --prod --audit-level=high`) y Dependabot propone actualizaciones semanales.

## 11. Lo que esta guía no cubre todavía

Modo sin internet, impresión directa ESC/POS con apertura de cajón, varias sucursales, error tracking con Sentry y la validación del formato de factura/nota de crédito con el contador (`docs/DECISIONS_PENDING.md` #6). Están anotados en `docs/ROADMAP.md`.

## 12. Plataforma SaaS: superadministradores (Etapa 1)

> Solo aplica a la rama de la plataforma (`docs/SAAS_PROPUESTA.md`). Una instalación de una sola tienda no usa nada de esto. Poner los negocios detrás de sus propias direcciones está en §13.

El panel de la plataforma vive en su propia dirección (`PLATFORM_HOST`, p. ej. `admin.tuplataforma.com`), con su propia base de datos (`CONTROL_DATABASE_URL`) y requiere `TENANCY_MODE=multi`. Todas las personas que entran son **superadministradores** con contraseña de 12 caracteres o más y verificación en dos pasos (aplicación de autenticación).

| Tarea | Comando (en el servidor) | Notas |
| --- | --- | --- |
| Crear la base central y migrarla | `pnpm control:setup` | La crea si no existe y la migra; es repetible. El arranque del contenedor lo hace solo en modo `multi` (§13). |
| Generar la llave maestra | `pnpm platform:gen-key` | Imprime la llave. Guardarla en `PLATFORM_MASTER_KEY` **y en un segundo lugar fuera del servidor**. |
| Crear el primer superadministrador | `pnpm platform:create-admin` | Pide nombre, usuario y contraseña temporal. En su primer acceso configura la aplicación de autenticación. |
| Perdió el teléfono | `pnpm platform:reset-2fa <usuario>` | Cierra sus sesiones; configurará una aplicación nueva al entrar. También se puede desde el panel (Administradores). |
| Cuenta bloqueada por intentos fallidos | `pnpm platform:unlock <usuario>` | O esperar 15 minutos. |
| Rotar la llave maestra | ver abajo | Re-cifra todos los secretos con la llave nueva. |

**Rotar la llave maestra**
1. `pnpm platform:gen-key` → llave nueva.
2. En el entorno del servicio: `PLATFORM_MASTER_KEY_PREVIOUS` = la llave vigente, `PLATFORM_MASTER_KEY_PREVIOUS_VERSION` = su versión; `PLATFORM_MASTER_KEY` = la nueva y `PLATFORM_MASTER_KEY_VERSION` = la versión anterior + 1. Reiniciar.
3. `pnpm platform:rotate-key` (repetible; imprime cuántos secretos re-cifró). Queda en la auditoría.
4. Cuando el comando diga que todos están al día, retirar `PLATFORM_MASTER_KEY_PREVIOUS*` y reiniciar. Guardar la llave nueva fuera del servidor.

**Si se pierde la llave maestra:** los secretos cifrados no se pueden recuperar. Los superadministradores restablecen su verificación con `platform:reset-2fa`; las credenciales de las bases de los negocios se vuelven a generar rotando el rol de cada base (procedimiento de la Etapa 3).

**Respaldo de la base central:** con `TENANCY_MODE=multi` el servicio `backup` la respalda cada día junto con la tienda (`control-*.dump.enc`, ver §13). Guarda **por separado** la llave maestra: sin ella los secretos de ese respaldo no se abren.

**Auditoría:** todo lo que se hace en el panel queda en *Auditoría* y no se puede editar ni borrar (la base lo impide). Nunca contiene contraseñas, códigos ni secretos.

## 13. Plataforma SaaS: varios negocios en producción (Etapa 2)

> Solo aplica si activas `TENANCY_MODE=multi`. Una instalación de una sola tienda sigue funcionando exactamente igual (`TENANCY_MODE=single`, que es el valor por omisión) y no necesita nada de esta sección. Diseño y pruebas: `docs/SAAS_ETAPA_2.md`.

### Cómo se reparte el tráfico

- El panel de la plataforma vive en `PLATFORM_HOST` (p. ej. `admin.tuplataforma.com`).
- Cada negocio vive en **`<subdominio>.<TENANT_BASE_DOMAIN>`** (p. ej. `tienda.tuplataforma.com`). El servidor decide de qué negocio es una petición **solo** por el nombre con que lo llamaron; nada que mande el navegador puede cambiarlo.
- Cualquier otro nombre responde `404` sin tocar ninguna base de datos.
- El estado de cada negocio decide qué muestra su dirección:

| Estado | Qué ve quien entra |
| --- | --- |
| `ACTIVE` | El sistema, con la base de ese negocio. |
| `SUSPENDED`, `PENDING_DELETION` | «Cuenta suspendida» (HTTP 403) en **todas** las pantallas. Sus datos no se tocan. |
| `PROVISIONING`, `FAILED`, `DELETED` | `404`, como si no existiera. |

`pnpm platform:suspend <subdominio>` / `pnpm platform:reactivate <subdominio>` cambian el estado (quedan en la auditoría). El cambio se nota en segundos: el servidor recuerda qué negocio es cada nombre durante `TENANT_DIRECTORY_TTL_MS` (20 000 ms por omisión).

### Requisitos antes de activarlo

1. **DNS:** un registro para el panel y uno **comodín** `*.tuplataforma.com` hacia este servidor.
2. **Puertos** 80 y 443 abiertos (Caddy pide los certificados por el puerto 80).
3. **Llave maestra** de la plataforma (`pnpm platform:gen-key`), guardada en `.env.production` **y en otro lugar fuera del servidor**.
4. Un **respaldo reciente de la tienda con la restauración ensayada** (§6A).

### Pasar una tienda que ya funciona a este modo

1. En `.env.production` (ver `.env.production.example`, sección «Varios negocios»): `TENANCY_MODE=multi`, `PLATFORM_HOST`, `TENANT_BASE_DOMAIN`, `PLATFORM_MASTER_KEY`, `CADDYFILE=./Caddyfile.multi`, y `DOMAIN` y `APP_URL` con el dominio del **panel**.
2. `dc up -d --build`. Al arrancar, el contenedor crea y migra la base central solo (`control_migrate.start/done` en el registro) y después migra la tienda como siempre.
3. Crear a quien administra la plataforma: `dc exec app pnpm platform:create-admin` (debe entrar de inmediato a configurar su verificación en dos pasos).
4. Registrar la tienda actual como el **negocio #1**, sin mover sus datos:
   ```bash
   dc exec app pnpm platform:adopt-store --slug tienda --name "Nombre de la boutique"
   ```
   Desde ese momento se atiende en `tienda.<TENANT_BASE_DOMAIN>`.
5. **Avisar al personal de la nueva dirección.** Las sesiones abiertas en la dirección anterior no pasan a la nueva (otro nombre = otra cookie): todos entran otra vez. La dirección anterior deja de responder; si quieres que redirija, añade en `Caddyfile.multi` un bloque `direccion-anterior.com { redir https://tienda.tuplataforma.com{uri} permanent }`.
6. Comprobar: `https://tienda.<dominio>/login` abre la entrada, `https://admin.<dominio>` el panel (sección **Negocios**) y `dc ps` muestra la app y los respaldos como `healthy`.

**Volver atrás:** `TENANCY_MODE=single`, `DOMAIN` y `APP_URL` anteriores y quitar `CADDYFILE`; `dc up -d`. Los datos de la tienda nunca se movieron.

### Tareas y comandos con varios negocios

Los comandos de línea de comandos trabajan para **un** negocio; sin indicarlo se niegan (no hay una base «por defecto»):

| Tarea | Comando |
| --- | --- |
| Crear al propietario de un negocio | `pnpm admin:create-owner --tenant <subdominio>` |
| Vencer apartados de **todos** los negocios (cron diario) | `pnpm job:expire-layaways --all` |
| Vencer apartados de uno | `pnpm job:expire-layaways --tenant <subdominio>` |
| Conciliar inventario / verificar libros de uno | `pnpm db:reconcile --tenant <subdominio>` · `pnpm db:verify --tenant <subdominio>` |
| Ver los negocios registrados | `pnpm platform:tenants` |

Con una sola tienda, los mismos comandos no llevan nada extra.

### Si algo falla

- **La base central no responde:** los negocios que ya se atendieron en los últimos minutos **siguen funcionando** (hasta 10 minutos después de vencida su caché); los demás responden «Servicio no disponible» (503) y el registro dice `tenant.directory_unavailable`. La prueba de salud de Docker (`127.0.0.1`) responde por el estado de la plataforma y falla, así que `docker compose ps` lo muestra.
- **«No se pudo descifrar la credencial»** en el registro (`TenantDirectoryError`): la llave maestra del servidor no es la que cifró esa credencial. Restaura la llave correcta (§12); no sirve de nada reintentar.
- **Certificado de un negocio nuevo:** Caddy lo pide la primera vez que alguien entra, solo si la app confirma que el nombre existe. Un nombre inventado no obtiene certificado. Si hay muchas altas en pocos días y Let's Encrypt limita la emisión, usa un certificado comodín por reto DNS: construye Caddy con el módulo de tu proveedor de DNS (`xcaddy build --with github.com/caddy-dns/<proveedor>`) y cambia el bloque de los negocios por `*.tuplataforma.com { tls { dns <proveedor> <token> } import app }`. (Esta alternativa no se ensayó en esta etapa; el certificado bajo demanda sí, con la autoridad interna de Caddy.)

### Respaldos

El servicio `backup` respalda **también la base central** (`control-AAAAMMDDTHHMMSSZ.dump.enc`, cifrada y comprobada igual que la de la tienda) y su indicador de salud exige los dos. Se restaura con el mismo `restore.sh` (§6). La base central **no sirve sin la llave maestra**, que no está en ningún respaldo a propósito.

### Lo que todavía no hace esta etapa

El alta automática de negocios nuevos, la migración de todas las bases y el borrado controlado llegan en la Etapa 3; planes, vencimientos y límites en la Etapa 4; respaldos individuales por negocio en la Etapa 5 (§16). El negocio #1 se conecta con la cuenta principal de Postgres tal como lo hacía la tienda; los negocios nuevos tendrán un rol propio con permisos solo de datos.

## 14. Plataforma SaaS: altas, actualizaciones y bajas de negocios (Etapa 3)

> Solo aplica con `TENANCY_MODE=multi` (§13). Diseño, pruebas y límites: `docs/SAAS_ETAPA_3.md`.

### Qué hace falta

- **La cuenta que crea bases:** `TENANT_PROVISIONING_URL` (el compose de producción ya la pasa, con la cuenta de Postgres de la instalación). Sin ella el panel dice que el alta está desactivada y no se crea nada.
- **La plantilla** (`boutique_plantilla`, o `TENANT_TEMPLATE_DB`): una base ya migrada de la que se copia cada negocio nuevo (milisegundos). **Se deja al día sola** en cada arranque; a mano: `dc exec app pnpm tenants:template` (`--force` la rehace).

### Dar de alta un negocio

Desde el panel: **Negocios → Registrar un negocio** (nombre, subdominio, propietario con una contraseña temporal y tu contraseña para confirmar). Tarda unos segundos y termina en la página del negocio con los siete pasos hechos. Desde el servidor:

```bash
dc exec -e OWNER_PASSWORD='Temporal-2026' app pnpm tenants:provision --slug tienda-b --name "Boutique B" --owner-name "Rosa Pérez" --owner-username rosa
```

Entrega la contraseña temporal al propietario por un medio seguro: **no se guarda en ningún registro** y debe cambiarla al entrar (Mi cuenta). El sistema todavía no obliga a cambiarla.

Cada negocio recibe **su propia base y su propio rol** de Postgres, que solo puede entrar a esa base y no puede cambiar el esquema; el nombre de ambos lo genera el sistema (`t_<id>`). La contraseña de ese rol queda cifrada en la base central.

### Si el alta falla o se interrumpe

El alta queda **detenida en el paso que falló** (verás el motivo en la página del negocio, sección *Intentos de alta*) y el negocio queda «Con error»; nada se atiende.

| Situación | Qué hacer |
| --- | --- |
| Falló un paso (falta la plantilla, disco lleno, servidor sin conexiones…) | Corrige la causa y pulsa **Retomar el alta** (o `pnpm tenants:resume <subdominio>`): continúa desde el paso que falló y no repite lo ya hecho. |
| Quieres empezar de cero | **Deshacer el alta** (o `pnpm tenants:undo <subdominio>`): borra la base y el rol de ese intento. Después se puede registrar el mismo subdominio otra vez. |
| El proceso murió a la mitad (corte de luz, reinicio) | La receta queda «en marcha» sin signos de vida. A los **5 minutos** ya se puede retomar (o deshacer); antes, el sistema lo impide para no pisar a un proceso que sigue trabajando. |

Un negocio ya dado de alta **nunca** se deshace con esta herramienta; se da de baja (abajo).

### Actualizar la versión de los datos

Cada negocio tiene su propia base, así que cada actualización del sistema debe migrarlas **todas**. Se hace sola al arrancar: se deja al día la plantilla y se migra a toda la flota (`fleet_migrate.start/done` en el registro). Reglas:

- Solo se migra a quien lo necesita (su versión anotada no es la última).
- Los **canarios** van primero: `pnpm tenants:canary <subdominio> on`. Si un canario falla, **no se toca a nadie más** (verás «sin tocar» en el resumen). Marca como canarios uno o dos negocios propios o de prueba.
- Un negocio cuya migración falla pasa a **«En mantenimiento»** (quien entra ve una pantalla de actualización, 503) con el motivo en su página; **los demás siguen**. El arranque no se detiene (`fleet_migrate.partial` en el registro).
- Reparado el problema: **Actualizar sus datos** en su página, o `pnpm tenants:migrate --only <subdominio>`; si funciona, vuelve a operar. **Revisión del servidor → Actualizar todos** hace toda la flota.
- Las migraciones deben ser compatibles hacia atrás (agregar antes de quitar): así un negocio puede ir un paso atrás por unos minutos sin romperse.

### Dar de baja un negocio

1. **Pedir la baja** (página del negocio, o `pnpm tenants:delete <subdominio> --reason "…"`): deja de atender («cuenta suspendida») y empieza una **retención de 30 días** en la que no se borra nada.
2. **Cancelar la baja** en cualquier momento de la retención: vuelve a como estaba.
3. **Archivar** (cumplida la retención; exige escribir el subdominio y tu contraseña; `--early` solo si de verdad no puede esperar): la base **se renombra** a `z_archived_<id>` y se elimina su rol. **No se destruye nada.** El negocio queda «Archivado».

**Borrar de verdad** una base archivada es una decisión aparte, con su propio procedimiento guiado (§16): El borrado guiado existe desde la Etapa 5 (§16, «Bases apartadas y borrado definitivo»): primero un volcado final comprobado, después el borrado. Las bases archivadas **no entran en el respaldo diario** (son estáticas).

### Respaldos de los negocios dados de alta

El respaldo diario (§5) respalda **cada negocio por separado** (`tenant-t_<id>-AAAAMMDDTHHMMSSZ.dump.enc`), además de la tienda #1 y la base central, cifrado y comprobado. Desde la Etapa 5 cada negocio tiene su propia llave, la retención de su plan, un registro visible en el panel y un procedimiento de restauración individual: ver §16. Con muchos negocios el tiempo del respaldo crece en proporción: con `BACKUP_PARALLEL=4` se hacen cuatro a la vez (§17).

### Revisión del servidor (conciliación)

**Negocios → Revisión del servidor**, o `pnpm tenants:reconcile` (sale con error si hay algo que revisar). No arregla nada sola:

| Hallazgo | Qué significa y qué hacer |
| --- | --- |
| Base o rol que ningún negocio reclama | Quedó de un alta que se borró del registro a mano. Revísalo y, si no es de nadie, bórralo a mano. |
| Negocio cuya base no está en el servidor | Alguien la borró o renombró. Restaura desde un respaldo (§6) o devuélvele su nombre `t_<id>`. |
| Archivado cuya base archivada no está | Igual: se perdió el archivo; restaura si lo necesitas. |
| Alta «en marcha» sin signos de vida | Retómala o deshazla (arriba). |
| Datos atrasados | `pnpm tenants:migrate`. |

### Límites a tener presentes

- Cada rol de negocio tiene `CONNECTION LIMIT 10` y `statement_timeout 60 s`: un negocio no puede acaparar el servidor. Cada instancia de la app abre un pool pequeño por negocio y cierra los que llevan 5 minutos sin uso; cuántos puede tener abiertos a la vez lo marca un presupuesto de conexiones (§17).
- Con decenas o cientos de negocios hay que ajustar las conexiones de Postgres y de la app: ver §17 (capacidad medida con 200 negocios).
- Todo lo que se hace queda en **Auditoría** (altas, fallos, retomadas, deshechas, migraciones fallidas, bajas, archivados), sin contraseñas ni secretos.

## 15. Plataforma SaaS: planes, suscripciones y cobros (Etapa 4)

> Solo aplica con `TENANCY_MODE=multi` (§13). Diseño, pruebas y límites: `docs/SAAS_ETAPA_4.md`. Los comandos corren dentro del contenedor (`dc exec app pnpm …`) y todo lo que hacen queda en la auditoría de la plataforma; el panel hace lo mismo con tu contraseña de confirmación.

### Una vez: la tarea diaria

El barrido anota quién entró en gracia, en solo lectura o se canceló, deja la auditoría y pide la baja de los cancelados. **El acceso de cada negocio no depende de él** (se calcula con la hora en cada petición), pero sin barrido el panel y la auditoría se quedan viejos y los cancelados no entran en retención. Se corre solo al arrancar el contenedor; además, una vez al día, junto al de apartados (§5):

```cron
10 3 * * * cd /opt/boutique-pos && docker compose --env-file .env.production -f docker-compose.prod.yml exec -T app pnpm billing:sweep >> /var/log/boutique-cobros.log 2>&1
```

Es repetible: correrlo dos veces no hace nada la segunda. Un barrido que falla no detiene nada (`billing_sweep.failed` en el arranque): corrígelo y vuelve a correrlo.

### Crear los planes

Panel → **Planes → Nuevo plan** (nombre, precio, cada cuánto se cobra, días de prueba, límites y módulos), o `dc exec app pnpm billing:seed-plans` para empezar con **Básico, Estándar y Completo** (precios de ejemplo: ajústalos). Editar un plan lo cambia para todos los negocios que lo tienen, **salvo el precio ya acordado**, que está copiado en cada suscripción. Un plan no se borra: se **desactiva** (deja de poder asignarse; quien ya lo tiene lo conserva).

- **Límites:** usuarios activos y productos no archivados. Vacío = sin límite. Un negocio por encima del tope (porque bajó de plan) **conserva todo**; solo no puede agregar más.
- **Módulos:** reportes y exportaciones, apartados, devoluciones y cambios, compras y proveedores, conteos físicos, etiquetas, clientes y crédito, facturación con CAI. Vender, cobrar, caja, inventario y catálogo van siempre.

### Darle plan a un negocio

- **Un negocio nuevo:** en **Registrar un negocio** elige el plan (arranca en prueba) o, desde el servidor, `pnpm tenants:provision … --plan "Estándar"`.
- **Uno que ya existe sin plan** (la tienda #1, por ejemplo): **Negocios → (negocio) → Suscripción → Asignar plan**, o `pnpm billing:assign <subdominio> --plan "Estándar" --reason "Alta" [--paid] [--until AAAA-MM-DD]`. En prueba por omisión; con `--paid` queda vigente un periodo (o hasta la fecha indicada).
- **Un negocio sin plan no tiene ninguna restricción ni paga**: la lista de negocios lo muestra como «Sin plan». No dejes ninguno así por olvido.

### Cobrar

Cuando el negocio te pague, **Registrar pago** (monto, método, referencia, periodos que cubre) o `pnpm billing:pay <subdominio> --amount 900.00 --method TRANSFER --reference "TR-123"`. El vencimiento se extiende desde el fin del periodo si todavía no vence, o desde hoy si ya venció. **El negocio vuelve a trabajar en segundos**, sin perder nada; si el sistema había pedido su baja por falta de pago, la cancela (una baja pedida por una persona no se toca).

Un pago **no se puede editar ni borrar** (la base lo impide). Si registraste uno mal, el pago equivocado queda en el historial y lo corriges con **Ajustar vencimiento** (con el motivo), que también queda en la auditoría.

### Qué ve el negocio en cada estado

| Estado | Cuándo | Qué pasa |
| --- | --- | --- |
| Al corriente | hasta el vencimiento | Todo funciona. Los últimos 7 días (o de la prueba) la franja avisa «vence el…». |
| **En gracia** | hasta 7 días después | Todo funciona; franja amarilla «venció el…, todo sigue hasta el…». |
| **Solo lectura** | hasta 60 días más | Pueden entrar, consultar y exportar; **no registrar nada nuevo** (ventas, inventario, usuarios, catálogo…). Franja roja. |
| **Cancelada** | después | «Suscripción vencida»: nadie entra. El sistema pide la baja (30 días de retención, cancelable); sus datos siguen intactos. |

Los plazos se ajustan por negocio en **Ajustar vencimiento** (días de gracia 0–90, de solo lectura 0–365, y el vencimiento mismo, con el motivo).

### Cambiar de plan

**Cambiar plan → Ahora** conserva las fechas pagadas y estrena límites y módulos de inmediato; **En la próxima renovación** lo programa y el siguiente pago lo aplica (y cobra el precio nuevo). No se pierde ningún dato. El historial de planes queda en la página del negocio.

### Si algo no cuadra

| Síntoma | Qué mirar |
| --- | --- |
| El negocio no nota el cambio de plan o el pago | El directorio guarda 20 s los datos de cada negocio. Con una sola instancia se invalida al instante desde el panel; con varias puede tardar hasta 20 s. |
| «No incluido en tu plan» en algo que sí debería | Panel → Planes → editar: ¿está marcado el módulo? Cada pantalla pertenece a un módulo (`src/config/plan-catalog.ts`). |
| Un negocio cancelado que ya pagó sigue sin entrar | Revisa su suscripción: el pago debe haber cubierto una fecha futura. Si la baja la pidió una persona (no el barrido), cancélala en **Cancelar baja**. |
| `pnpm billing:sweep` falla | Es solo la base central: revisa `CONTROL_DATABASE_URL`. El acceso de los negocios no se ve afectado. |
| Un negocio paga y sigue en solo lectura | Mira su vencimiento en la página del negocio (hora de Honduras): un pago que solo cubre hasta una fecha ya pasada no lo levanta. |

### Límites a tener presentes

- Los avisos son la franja dentro de la tienda y la lista del panel: **el sistema no envía correos ni mensajes de cobro**.
- El cobro es manual; no hay pasarela. La facturación de la propia plataforma (facturas a tus clientes) queda fuera.
- El tope de **cajas y sucursales** existe en el plan pero no se aplica todavía (no hay pantalla para crearlas).
- En solo lectura, `db` corta las escrituras de las tablas del negocio; no vigila SQL crudo de lectura (`$queryRaw`), que la aplicación usa solo para leer y para candados dentro de transacciones.

## 16. Plataforma SaaS: respaldos por negocio, uso, alertas y soporte (Etapa 5)

> Solo aplica con `TENANCY_MODE=multi` (§13). Diseño, pruebas y límites: `docs/SAAS_ETAPA_5.md`. Los comandos de la aplicación corren con `dc exec app pnpm …`; los del servicio de respaldos, con `dc exec -T backup /scripts/…`. Todo lo que cambia algo queda en la auditoría de la plataforma, y el panel lo hace con tu contraseña de confirmación.

### Cómo se reparten el trabajo la aplicación y el servicio de respaldos

La clave de los respaldos (`BACKUP_PASSPHRASE`) y la carpeta de archivos **solo existen en el contenedor `backup`**; la aplicación no las tiene a propósito (una aplicación comprometida no puede abrir ningún respaldo). Se hablan por la base central:

- El servicio `backup` respalda, comprueba, retira lo vencido y **anota cada respaldo** (tabla `TenantBackup`).
- La aplicación **lee** ese registro para el panel y solo **agrega pedidos** («respalda ahora»), que el servicio toma en unos 15 segundos.

### Respaldos por negocio

- **A diario** (02:00 por omisión) el servicio respalda **cada negocio por separado** (`tenant-t_<id>-AAAAMMDDTHHMMSSZ.dump.enc`), la tienda #1 (`boutique-…`) y la base central (`control-…`). Si el respaldo de un negocio falla se anota y se sigue con los demás.
- **Llave propia por negocio:** el respaldo de cada negocio se cifra con una llave derivada de `BACKUP_PASSPHRASE` y del nombre de su base. Sirve para **entregarle a alguien la copia de UN negocio** con su llave sin abrir los demás (ver «Entregar la copia de un negocio»). Los respaldos de la Etapa 3 (cifrados con la clave sola) se siguen pudiendo restaurar.
- **Retención por plan:** los días que se conservan los respaldos de un negocio salen de su plan (**Planes → Días que se conservan los respaldos**, de 7 a 3650). Un negocio sin plan usa `BACKUP_RETENTION_DAYS` (30). Un archivo retirado deja su fila en el historial con la marca «Retirado».
- **Su primer respaldo** se pide al dar de alta el negocio (en segundos), sin esperar a la noche.
- **Pedir uno ahora:** panel → negocio → **Respaldar ahora** (o `pnpm backups:request <subdominio>`, y `--control` para la base central). Si el servicio de respaldos no está corriendo, el pedido queda esperando y la alerta lo avisa a los 10 minutos.
- **Ver cómo están:** panel → **Respaldos** (todos los negocios y la base central, con su estado), la página de cada negocio (los últimos respaldos, con el error si falló) o `pnpm backups:status`, que sale con error si algún negocio está atrasado, falló o nunca se respaldó. Estados: **al día** (hay uno bueno de las últimas 26 horas), **atrasado**, **falló**, **sin respaldo** y **pendiente** (negocio nuevo).
- **Copiarlos fuera del servidor** sigue siendo obligatorio (§5): la carpeta `./backups` contiene todos los archivos, ya cifrados.

### Tareas diarias

Además del barrido de cobros (§15), una vez al día la foto de uso y la revisión de alertas:

```cron
20 3 * * * cd /opt/boutique-pos && docker compose --env-file .env.production -f docker-compose.prod.yml exec -T app pnpm usage:collect >> /var/log/boutique-uso.log 2>&1
30 3 * * * cd /opt/boutique-pos && docker compose --env-file .env.production -f docker-compose.prod.yml exec -T app pnpm alerts:check || echo "Boutique POS: hay alertas, mira el panel" | mail -s "Alertas de la plataforma" tu@correo.com
```

`alerts:check` imprime cada alerta y **sale con código 1 si hay algo grave o que conviene revisar** (las de información no lo hacen fallar): úsalo con tu servicio de avisos favorito. Un monitor externo (§7) sigue siendo lo que avisa de que se cayó el servidor entero.

### Restaurar UN negocio (sin tocar a los demás)

Vuelve a la fecha del respaldo: **lo vendido después se pierde** (y queda guardado en una base apartada, ver abajo). Hazlo con el negocio suspendido y deja a quien opera el local avisado.

1. **Suspende el negocio** (panel → negocio → Suspender). Así nadie escribe mientras se cambia la base. Los demás negocios siguen atendiendo.
2. **Elige el respaldo** (la página del negocio muestra el último bueno, con los comandos ya escritos) y restaura. El servicio comprueba el archivo, restaura en una base temporal y **solo si todo salió bien** la pone en el lugar de la actual (cierra las conexiones de **ese** negocio aunque la aplicación siga corriendo); la actual **no se borra**: queda como `z_replaced_<base>_<fecha>`.

   ```bash
   dc exec -T -e RESTORE_REPLACE=yes backup /scripts/restore-tenant.sh /backups/tenant-t_<id>-AAAAMMDDTHHMMSSZ.dump.enc t_<id>
   ```

3. **Termina la restauración**: un volcado trae los datos, pero no el rol de aplicación del negocio ni sus permisos, y el respaldo puede ser de una versión anterior del sistema. Este paso lo deja todo como estaba y comprueba que el negocio **puede entrar con su rol**.

   ```bash
   dc exec app pnpm tenants:relink <subdominio>      # o el botón «Terminar la restauración» de su página
   dc exec app pnpm db:verify --tenant <subdominio>  # los libros cuadran
   ```

4. **Reactiva el negocio** (panel → Reactivar), entra, comprueba la última venta y abre caja. Lo vendido después del respaldo hay que registrarlo a mano; la base apartada (`z_replaced_…`) tiene esos datos por si hace falta consultarlos.

Con una clave equivocada o un archivo dañado, el script se detiene al principio con un mensaje claro y no cambia nada. Para **ensayar** sin tocar el negocio, restaura a otro nombre de base (`restore-tenant.sh <archivo> t_ensayo_1`) y revísalo con `VERIFY_DATABASE=… pnpm db:verify` (§6A); después bórrala con `DROP DATABASE`.

### Restaurar todo en un servidor nuevo

Es el desastre completo: el servidor murió y hay que levantar la plataforma desde los respaldos. Hace falta **la carpeta de respaldos, `BACKUP_PASSPHRASE` y `PLATFORM_MASTER_KEY`** (sin la llave maestra, las credenciales de las bases de los negocios no se pueden abrir) y **la misma `POSTGRES_USER` y `POSTGRES_PASSWORD`**: la credencial de la tienda #1 es la cuenta principal de Postgres y está guardada, cifrada, en la base central.

1. Instala el servidor como en la §2 (hasta el paso 3) con **la misma `PLATFORM_MASTER_KEY` y `BACKUP_PASSPHRASE`**, y copia los respaldos a `./backups`. Levanta solo la base: `dc up -d db backup`.
2. Restaura la **base central** y la **tienda #1**. La base `POSTGRES_DB` existe vacía, por eso `RESTORE_REPLACE=yes`: la vacía queda apartada como `boutique_pos_old_<fecha>` (bórrala con `DROP DATABASE`).

   ```bash
   dc exec -T backup /scripts/restore.sh /backups/control-AAAAMMDDTHHMMSSZ.dump.enc boutique_pos_control
   dc exec -T -e RESTORE_REPLACE=yes backup /scripts/restore.sh /backups/boutique-AAAAMMDDTHHMMSSZ.dump.enc boutique_pos
   ```

3. Restaura **cada negocio** con su último respaldo. Los nombres `t_<id>` salen de la base central que acabas de restaurar (la tienda #1 es `POSTGRES_DB`, ya restaurada):

   ```bash
   dc exec -T db psql -U <POSTGRES_USER> -d boutique_pos_control -Atc 'SELECT slug, "dbName" FROM "Tenant" WHERE "dbName" IS NOT NULL'
   dc exec -T backup /scripts/restore-tenant.sh /backups/tenant-t_<id>-AAAAMMDDTHHMMSSZ.dump.enc t_<id>
   ```

4. Levanta la aplicación (`dc up -d`). Al arrancar migra lo que falte. Mientras no termines la restauración de un negocio, su `/api/health` responde 503 (su rol aún no existe en el servidor nuevo). Luego, **por cada negocio**, créale el rol con la contraseña que guarda la bóveda, dale sus permisos y comprueba que los libros cuadran:

   ```bash
   dc exec app pnpm tenants:relink <subdominio>
   dc exec app pnpm db:verify --tenant <subdominio>
   ```

5. Entra al panel, revisa **Respaldos**, **Revisión del servidor** y el **Resumen** (sin alertas), y pide un respaldo nuevo de todo (`dc exec -T backup /scripts/backup.sh`).

Ensayado (ver `docs/SAAS_ETAPA_5.md` §7): en un servidor vacío, con la base central, la tienda #1 y un negocio restaurados de los respaldos, el rol del negocio no existía antes de `tenants:relink` (su `/api/health` daba 503); después existía, `db:verify` dio «Libros cuadrados» y el negocio respondió 200.

### Entregar la copia de un negocio

Si un negocio se va y quiere su información, o necesitas darle su respaldo a alguien: entrégale **el archivo de ese negocio y su llave**, no `BACKUP_PASSPHRASE`. La llave se obtiene dentro del servicio de respaldos y **se trata como una contraseña**:

```bash
dc exec -T backup sh -c '. /scripts/lib.sh && derive_key t_<id>'
```

Con esa llave el archivo se abre con `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass pass:<llave> -in <archivo>` y el resultado es un volcado de Postgres (`pg_restore`). No abre ningún otro negocio.

### Bases apartadas y borrado definitivo

El sistema **nunca destruye por sí solo** una base con datos de un negocio. Quedan apartadas dos clases:

- **Archivadas** (`z_archived_<id>`): el negocio se dio de baja y se archivó (§14).
- **Reemplazadas** (`z_replaced_<base>_<fecha>`): una restauración las dejó apartadas al poner el respaldo en su lugar; tienen lo que se vendió después de ese respaldo.

Panel → **Respaldos → Bases apartadas** (o `pnpm backups:retired`) las lista. Borrar una es irreversible, así que son **dos pasos que no se pueden saltar**:

1. **Guardar el volcado final** (`pnpm backups:final <base>`): el servicio de respaldos hace un volcado cifrado y comprobado de esa base y lo guarda `FINAL_BACKUP_RETENTION_DAYS` (365 por omisión).
2. **Borrar definitivamente** (`pnpm backups:drop <base> --confirm <base>`): exige que ese volcado exista y todavía esté guardado, que escribas el nombre de la base tal cual y tu contraseña. Queda en la auditoría con el archivo del volcado.

El volcado final se restaura como cualquier otro (`restore-tenant.sh /backups/final-<base>-….dump.enc <nombre nuevo>`), por si un negocio dado de baja vuelve.

### Uso de cada negocio

La página de cada negocio muestra su **uso**: usuarios activos y productos (contra los topes de su plan), ventas de los últimos 30 días, última venta, último ingreso y el peso de su base. **Son solo números** de una lista fija: el panel sabe *cuánto* usa un negocio, nunca *qué* vende ni a quién. La foto se toma a diario (`pnpm usage:collect`) y se puede actualizar a mano en la página del negocio. Un negocio que llega al 90 % de un tope aparece como información en las alertas (es el momento de ofrecerle un plan mayor).

### Soporte: mirar los datos de un negocio

Sin una **sesión de soporte** abierta, el panel no muestra nada de un negocio salvo los números de uso. Para ayudar a alguien con un problema real: página del negocio → **Soporte → Abrir una sesión** con un **motivo** (10 a 300 caracteres) y una duración (15 minutos a 2 horas; la base no admite más).

- Abrirla **deja un aviso en la auditoría del propio negocio** (quién, por qué y hasta cuándo). Una persona solo puede tener una abierta por negocio.
- Con ella se ven: las personas con acceso (sin contraseñas), las ventas recientes, los cierres de caja y lo que se hizo en el negocio (sin el contenido de los cambios).
- Y se pueden hacer **dos correcciones**: **desbloquear** a una persona que se quedó sin poder entrar, y darle una **contraseña temporal** (se muestra una sola vez, cierra sus sesiones y no se guarda en ningún lado). Ambas quedan en las dos auditorías.
- **No hay «entrar como» esa persona.** Cierra la sesión al terminar (o vence sola).

### Alertas

Panel → **Resumen → Alertas** (y `pnpm alerts:check`), de lo más grave a lo menos:

| Alerta | Gravedad | Qué hacer |
| --- | --- | --- |
| El último respaldo de un negocio (o de la base central) falló / no existe | Grave | Mira el error en su página; corrige la causa y pide uno. |
| Respaldos pedidos que nadie atiende (10 min) | Grave | El servicio `backup` no está corriendo: `dc ps`, `dc logs backup`. |
| Un negocio en mantenimiento (falló su actualización) | Grave | §14: actualizar sus datos. |
| La base de un negocio no está en el servidor | Grave | Restáurala (arriba). |
| El respaldo de un negocio tiene más de 26 horas | Aviso | Mira los registros del servicio de respaldos. |
| Bases o roles que nadie reclama, o negocios con datos atrasados | Aviso | Revisión del servidor (§14). |
| Un alta que no terminó | Aviso | Retómala o deshazla (§14). |
| Un negocio cerca de su tope, bases apartadas por borrar, sesiones de soporte abiertas | Información | Sin urgencia. |

### Si algo no cuadra

| Síntoma | Qué mirar |
| --- | --- |
| «Falló» en un respaldo | La página del negocio muestra el error. `dc logs backup` lo detalla (`backup.dump_failed`, `backup.verify_failed`). |
| Un pedido de respaldo se queda en «Pedido» | El servicio `backup` no corre o no alcanza la base central. Con `dc logs backup`: `backup.requests_failed`. |
| `restore-tenant.sh` dice que no pudo abrir el archivo | La clave no es la del respaldo, o el archivo está dañado. Prueba con el respaldo anterior. |
| `restore-tenant.sh` no pudo renombrar la base | Algo sigue conectado a ella: suspende el negocio y repite (cierra las conexiones él mismo). |
| `tenants:relink` dice que no puede entrar con su rol | Mira el motivo que imprime; repetirlo es seguro. Si la llave maestra no es la que cifró la credencial, ver §12. |
| Quedó una base `z_replaced_…` | Es lo esperado: se borra con el borrado guiado cuando ya no la necesites. |

### Límites a tener presentes

- La restauración de un negocio **vuelve a la fecha del respaldo**: no hay recuperación a un instante exacto (no se archivan los registros de transacciones de Postgres).
- Restaurar sigue siendo una decisión de quien opera el servidor (necesita acceso al contenedor y la clave): el panel no ofrece un botón de «restaurar», a propósito.
- El registro de respaldos lo escribe el servicio de respaldos con la cuenta principal de Postgres; una aplicación comprometida puede pedir respaldos y leer el registro, pero no abrir ningún archivo.
- El panel guarda solo los números de uso; las **sesiones de soporte sí leen datos reales** (ventas y personas) durante el tiempo que dure la sesión, con su motivo y su rastro.
- Los avisos de alertas son el panel y `alerts:check`: **el sistema no envía correos** por su cuenta.

## 17. Plataforma SaaS: capacidad, conexiones y endurecimiento (Etapa 6)

El informe con todas las mediciones es [`SAAS_ETAPA_6.md`](SAAS_ETAPA_6.md). Aquí, lo que hace falta para **operar** con decenas o cientos de negocios.

### Cuántos negocios caben: las conexiones a Postgres

Cada negocio al que se atendió en los últimos segundos mantiene **1 o 2 conexiones abiertas** a Postgres. Postgres admite 100 de fábrica, así que lo que limita cuántos negocios pueden trabajar a la vez **no es la CPU sino las conexiones**. La aplicación lo cuida con un **presupuesto**: nunca abre más de `TENANT_POOL_MAX_CONNECTIONS` hacia los negocios (60 de fábrica). Si un negocio nuevo necesita lugar y todos los abiertos están ocupados, **espera** unos milisegundos (lo que dura una venta); si la espera pasa de 10 s falla con un error que se puede reintentar y lo anota en el registro (`tenant.pool_busy`). Antes de esto, 200 negocios a la vez agotaban Postgres y le fallaban a todos.

**Con 20 a 50 negocios** (la escala prevista) la instalación de fábrica ya atiende bien y, para 50, basta subir las dos variables de la fila «Hasta ~50» (medido: escaneo en 14 ms y venta en 72 ms con unas 100 cajas). Elige la fila que corresponda a cuántos negocios **trabajan a la vez** (no cuántos están registrados) y pon las dos variables en `.env.production`:

| Negocios trabajando a la vez | `POSTGRES_MAX_CONNECTIONS` | `TENANT_POOL_MAX_CONNECTIONS` | Negocios que quedan abiertos | Memoria aproximada |
| --- | --- | --- | --- | --- |
| Hasta ~30 (de fábrica, sin tocar nada; **20 negocios caben así**) | 100 | 60 | 30 | App 1 GB · Postgres 0,5 GB |
| **Hasta ~50** | 200 | 160 | 80 | App 1 GB · Postgres 0,6 GB |
| Hasta ~120 | 300 | 240 | 120 | App 2 GB · Postgres 1 GB |
| Hasta ~200 | 500 | 420 | 200 | App 3 GB · Postgres 1,5 GB (con dos instancias, el presupuesto de cada una suma al otro: p. ej. 2 × 200) |

Reglas: `TENANT_POOL_MAX_CONNECTIONS` siempre **al menos 40 menos** que `POSTGRES_MAX_CONNECTIONS` (quedan para la base central, los respaldos y el mantenimiento); cada negocio abierto cuesta ~7 MB en la app y cada conexión ~4 MB en Postgres. Si hay más negocios registrados que lugares, no pasa nada grave: el que no está abierto se abre al primer uso (~20 ms), pero con **mucha** rotación el servidor trabaja más y las respuestas se alargan.

Después de reiniciar la aplicación, **los primeros minutos son más lentos**: cada negocio arma sus consultas la primera vez que las usa (la primera petición a un negocio tarda ~1 s). Para saber si te hace falta más: **Panel → Resumen → «Negocios abiertos ahora»**. Muestra cuántos tiene abiertos *esta* instancia, de cuántos le caben, y cuántas veces un negocio tuvo que esperar lugar y cuántas no lo consiguió. Si «sin conseguirlo» sube, sube las dos variables (o reparte los negocios en otro servidor, abajo). Después de cambiar `POSTGRES_MAX_CONNECTIONS` hay que reiniciar la base: `dc up -d db` (se reconecta sola).

### Una instancia o varias

- **Una instancia** es lo normal. En el equipo de prueba (4 núcleos), con los 200 negocios abiertos, sostuvo **114 operaciones de caja por segundo** (escaneo en 28 ms, mediana) —el doble de lo que hacen 400 cajas— pero solo **~25 páginas completas por segundo**: la aplicación es de **un solo hilo** (~1 núcleo). Para 200 negocios con mucho movimiento, **dos instancias** dan holgura.
- **Para tener dos:** `dc up -d --scale app=2` (el `Caddyfile.multi` reparte entre las que respondan). Al **actualizar la versión** con migraciones, levanta primero una (`dc up -d --scale app=1`), espera a que quede sana y luego escala: la migración de la flota al arrancar no tiene un candado entre instancias.
- **Varias instancias** de la app (para no depender de una sola) comparten las mismas bases. Sus presupuestos **se suman**: la suma de todos los `TENANT_POOL_MAX_CONNECTIONS` tiene que caber en `POSTGRES_MAX_CONNECTIONS − 40`.
- Una suspensión, un cambio de plan o una baja hechos desde el panel se notan al instante en la instancia que los hizo y **en las demás hasta en `TENANT_DIRECTORY_TTL_MS`** (20 s de fábrica). Si necesitas que sea más rápido, baja ese valor (5000 es razonable): cuesta una consulta a la base central por negocio cada TTL, nada más.
- El **límite de intentos fallidos de entrada por IP** vive en la memoria de cada instancia: con N instancias un atacante tiene N veces el cupo. El **bloqueo por usuario** (5 fallos) vive en la base de cada negocio y vale para todas.

### PgBouncer: se evaluó y no se recomienda por omisión

Se probó PgBouncer en modo transacción delante de Postgres (`docker/pgbouncer`, perfil opcional de Compose). Con una base y un rol **por negocio**, PgBouncer arma un grupo de conexiones por negocio y **no tiene un tope global**: 200 negocios tocados casi a la vez siguen abriendo 200 conexiones reales. En la prueba redujo las conexiones a Postgres a la mitad pero también el ritmo (65 contra 132 operaciones por segundo con todos los negocios abiertos). **No lo enciendas** salvo que el tope de conexiones lo imponga un Postgres administrado que no puedas subir; si lo haces:

```bash
PGBOUNCER_AUTH_PASSWORD=$(openssl rand -hex 24)   # guárdala en .env.production
dc run --rm -e PGBOUNCER_AUTH_PASSWORD app pnpm pgbouncer:setup
# en .env.production: TENANT_DB_HOST=pgbouncer  TENANT_DB_PORT=6432  PGB_AUTH_PASSWORD=<la misma>
dc --profile pgbouncer up -d
```

La cuenta de PgBouncer solo puede ejecutar una función que devuelve el verificador de contraseña de un rol de negocio (nunca el de una cuenta de superusuario); las altas, las migraciones y los respaldos siguen yendo directo a Postgres. La tienda #1 debe tener su rol limitado primero (abajo).

### Medir tu propio servidor

Los guiones de `scripts/capacity/` repiten las mediciones del informe en el servidor que tú quieras. **Crean y cargan cientos de negocios: solo en un servidor desechable.** Para que nadie los apunte a producción por descuido, exigen escribir el nombre de la base central en `CAPACITY_CONFIRM`.

```bash
export CAPACITY_CONFIRM=<nombre de la base central>
pnpm capacity:provision --count 50 --concurrency 3           # da de alta 50 negocios con datos de tienda (1 minuto)
pnpm capacity:run --tenants 50 --uniform --workers 30 --warmup 45 --seconds 60 --rate 12   # carga «dentro del proceso» y verificación de libros
pnpm capacity:http --tenants 50 --port 3000 --seconds 60     # carga por HTTP a la app compilada
```

`capacity:run` termina verificando, negocio por negocio, que no se mezcló nada y que los libros cuadran; sale con error si no. Con `NODE_OPTIONS=--expose-gc` además mide la memoria viva (busca fugas).

### Tareas de la flota con cientos de negocios

Tiempos medidos con 200 negocios (portátil de 4 núcleos; un servidor real será parecido o mejor):

| Tarea | Tiempo | Nota |
| --- | --- | --- |
| `pnpm tenants:migrate --concurrency 4` | 4 min | ~1,2 s por negocio; lanza un `prisma migrate deploy` por negocio. Con 1000 negocios, ~20 min. |
| Respaldo diario (`BACKUP_PARALLEL=1`) | 8,5 min | Un negocio tras otro. |
| Respaldo diario (`BACKUP_PARALLEL=4`) | 3,4 min | **Recomendado desde ~50 negocios.** Cada respaldo usa un núcleo para cifrar y una conexión. |
| `pnpm usage:collect` | 10 s | |
| `pnpm billing:sweep`, `tenants:reconcile`, `alerts:check` | ~1,5 s cada uno | |
| Alta de un negocio | ~3 s | 4 altas a la vez: 200 negocios en 4,5 min. |

### Contraseñas temporales

La contraseña que otra persona le pone a una cuenta es **temporal**: el alta de un negocio (la del propietario), el soporte y quien restablece la de un compañero. Al entrar con ella, el sistema **solo deja elegir una propia**; ninguna otra pantalla ni acción funciona hasta entonces (lo aplica el servidor, no un botón). Una cuenta con contraseña temporal pendiente tampoco puede descargar nada. La contraseña de un usuario creado desde «Usuarios → Nuevo» no es temporal (la elige quien lo crea y la persona la cambia en Mi cuenta cuando quiera).

### Dar a la tienda #1 su propio rol de base de datos

Los negocios que da de alta el sistema atienden con un rol que solo lee y escribe datos de **su** base. La tienda que ya existía antes de la plataforma (el negocio #1) se adoptó con la **cuenta principal del servidor**: si un error de la aplicación ejecutara SQL ajeno en esa tienda, tendría el servidor entero. Por eso el panel muestra una alerta («atiende con la cuenta principal del servidor») mientras no se cambie:

```bash
dc exec app pnpm tenants:limit-store <subdominio-de-la-tienda>
```

Crea el rol `t_<id>`, le da permisos de datos, comprueba que puede entrar y cambia la credencial guardada; la aplicación lo toma en menos de 20 s, sin reiniciar. Se puede repetir sin riesgo. La cuenta principal sigue existiendo para las migraciones, los respaldos y la verificación de libros. En un servidor nuevo, `tenants:relink` vuelve a crear ese rol como el de cualquier otro negocio.

### Importar productos: archivos «bomba»

Un `.xlsx` es un zip. La importación mira lo que el archivo **declara** antes de abrirlo y rechaza los que superan 30 MB descomprimidos, 300 archivos internos, 1000 filas o 60 columnas. Con varios negocios en la misma aplicación, un archivo así podía colgar la memoria o la CPU de todos.

### Si algo no cuadra

| Síntoma | Qué mirar |
| --- | --- |
| «Hay demasiados negocios atendiéndose a la vez…» / `tenant.pool_busy` en los registros | Faltan conexiones: sube `TENANT_POOL_MAX_CONNECTIONS` y `POSTGRES_MAX_CONNECTIONS` (tabla de arriba). |
| Postgres dice «remaining connection slots are reserved» | La suma de los presupuestos de las instancias (más respaldos y mantenimiento) pasa de `POSTGRES_MAX_CONNECTIONS`. |
| Todo se pone lento cuando trabajan muchos negocios | Resumen → «Negocios abiertos ahora»: si «esperaron lugar» sube sin parar, hay más negocios activos que lugares. |
| Una persona entra y solo ve «Elige tu contraseña» | Es lo esperado con una contraseña temporal. Si no sabe cuál es, restablécele la contraseña (Usuarios o soporte). |
| La alerta «atiende con la cuenta principal del servidor» | `pnpm tenants:limit-store <subdominio>` (arriba). |

### Límites a tener presentes

- Las cifras salen de **un portátil de 4 núcleos con Docker Desktop**, con el generador de carga en la misma máquina: son un piso, no una promesa. Mide en tu servidor con `scripts/capacity/`.
- Una instancia de la app y un Postgres atendieron 200 negocios con tráfico parejo. Más de ~200 negocios **trabajando a la vez** pide un segundo servidor de bases de datos. **Hoy el sistema solo conoce un servidor** (`primary`): repartir negocios en varios exige un mapa de servidores y que el alta, el respaldo y la conciliación lo usen (ver el informe, §7).
- Un certificado comodín, `DEPLOYMENT=production` con un dominio real y una base de datos administrada por un proveedor **no se ensayaron** aquí.
- La recuperación a un instante exacto y los avisos por correo siguen sin existir (Etapa 5).

## 18. Fotos de los productos

Las fotos **no están en la base de datos**: viven en el volumen `uploads` (la carpeta `/data/uploads` de la app, `UPLOADS_DIR`), una subcarpeta por negocio con el id del negocio (`single` en una instalación de una sola tienda) y dentro `<producto>/<foto>/{thumb,medium,large}.webp`. Junto con `pgdata` y `./backups`, **`uploads` es de lo que no se puede reconstruir**.

### Respaldos y restauración

- Cada noche, justo después del volcado de cada negocio, el servicio `backup` archiva su carpeta de fotos en `photos-boutique-AAAAMMDDTHHMMSSZ.tar.enc` (la tienda de siempre) o `photos-tenant-<base>-AAAAMMDDTHHMMSSZ.tar.enc` (un negocio), **cifrado con la misma llave que el volcado de ese negocio** y comprobado (se descifra y se lee el contenido antes de dejarlo).
- Las fotos casi no cambian, así que **solo se repite si algo es más nuevo que el último archivo** (una foto agregada, quitada o reordenada). Si no, el registro dice `backup.photos_unchanged`. La retención es la del plan del negocio, pero **nunca se borra el archivo más reciente**, por viejo que sea: es el único que hay si nada cambió.
- Si el respaldo de las fotos falla, el del volcado ya quedó bien, pero el servicio sale con error (`backup.photos_failed` en el registro): revísalo igual.
- Al copiar `./backups` fuera del servidor (paso del operador), los `photos-*.tar.enc` van incluidos.

Devolver las fotos de un negocio (después de restaurar su base, o si se perdió el volumen):

```bash
# El volumen se llama <proyecto>_uploads (docker volume ls). Se monta para ESCRIBIR solo en este comando.
dc run --rm --no-deps -v boutique-pos-prod_uploads:/photos backup /scripts/restore-photos.sh /backups/photos-tenant-t_XXXX-AAAAMMDDTHHMMSSZ.tar.enc
```

El script prueba la llave del negocio (por el nombre del archivo) y luego la general, no borra nada (solo agrega o reemplaza archivos de la carpeta de ese negocio) y deja los archivos al usuario de la app (`PHOTOS_OWNER`, 1000:1000 por omisión). Una foto cuyo archivo falta **no rompe nada**: se ve un recuadro vacío y el resto funciona; basta con quitarla desde la ficha y subirla de nuevo.

### Fotos en un bucket (S3) en vez del volumen

Con `S3_BUCKET` definido (más `S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY`; `S3_ENDPOINT` vacío = AWS, `S3_REGION` vacío = `auto`) las fotos van a un servicio de objetos compatible con S3 y **no** a la carpeta `UPLOADS_DIR`: las mismas claves (`<negocio>/<producto>/<foto>/<tamaño>.webp`), las mismas garantías. Sirve donde un volumen no conviene (Railway: un volumen se adjunta a un solo servicio y ata la app a una réplica) y se prueba con un servicio S3 de mentira en `tests/unit/s3-blob-store.test.ts`. El arranque lo dice en el registro (`server.start` → `"photos":"s3"` o `"photos":"file:/data/uploads"`): **mira ese campo después de cada despliegue**, porque una app sin las variables de S3 guardaría las fotos en el disco de la imagen y las perdería al actualizar. Los buckets de Railway no tienen respaldo automático: si se necesita, hay que copiarlos aparte.

### Espacio y límites

- Una foto ocupa unos 100–250 KB entre sus tres tamaños. Cuenta ~300 fotos por tienda: 30–75 MB por negocio.
- El plan puede topar las fotos de todo el negocio (Panel → Planes → «Fotos de productos»; vacío = sin límite). Pasarse del tope no borra nada: solo impide agregar.
- Hasta 6 fotos por producto, de 8 MB cada una; el navegador reduce las pesadas antes de subirlas.

### Si algo no cuadra

| Síntoma | Qué mirar |
| --- | --- |
| Las fotos se ven como recuadros vacíos | El volumen `uploads` no está montado en `/data/uploads` o se recreó vacío: `dc exec app ls /data/uploads`. Restaurar con el comando de arriba. |
| «No se pudo subir» en todas | `dc logs app` (`photos.upload_failed`); suele ser permisos de la carpeta (debe ser de `node`) o disco lleno. |
| La app no arranca con `UPLOADS_DIR` | En producción es obligatoria. El `Dockerfile` la fija en `/data/uploads`; fuera de Docker, defínela. |

### Límites a tener presentes

- **Con un volumen la app queda en una sola réplica** (no se puede escalar a dos `app` compartiendo la carpeta, ni en Railway, donde un volumen se adjunta a un servicio). Para más de una réplica hay que pasar el almacén a un servicio de objetos (R2/S3): la interfaz (`BlobStore`) ya está pensada para eso, el controlador no se ha escrito.
- El respaldo y la restauración de fotos se ensayaron en el contenedor de respaldos con carpetas de prueba (llave propia y general, clave equivocada, archivo dañado, retención). La subida y entrega se prueban con la base y el almacén de las pruebas, no con un volumen de Docker en producción.

## 19. Despliegue en Railway

Proyecto `boutique-pos` (un solo entorno, `production`). Todo sale del repositorio de GitHub (rama `main`): cada `push` reconstruye y despliega los servicios conectados a él. **Antes de empujar un cambio que no sea de código** (documentos), piensa que también reconstruye; si molesta, se pueden poner «watch patterns» a cada servicio.

### Qué hay

| Servicio | Qué es | Notas |
| --- | --- | --- |
| `postgres` | Imagen `ghcr.io/railwayapp-templates/postgres-ssl:16` con el volumen `postgres-data` (1 GB, crece) | Se usa la 16 (la probada); la plantilla de Railway trae la 18 y su `pg_dump` no sirve para el cliente 16 del respaldo |
| `app` | El sistema (`Dockerfile` de la raíz). Aplica las migraciones al arrancar y atiende por el puerto `3000` | Healthcheck `/api/health`; reinicia si falla (5 intentos) |
| `tareas-diarias` | Cron `0 9 * * *` (UTC = 03:00 en Honduras) que corre `sh docker/daily.sh` | Cobros, foto de uso y alertas (§15–16). Sale con 1 si algo falló o hay alertas |
| `cron-respaldos` | Cron `0 8 * * *` (UTC = 02:00 en Honduras); imagen de `docker/backup`, orden `/scripts/once.sh` | Respalda cada negocio y la base central, **cifra** y sube cada archivo al bucket `respaldos` (`OFFSITE_REMOTE`) |
| bucket `fotos` | Las fotos de los productos (`S3_*` de la app) | Sin respaldo automático de Railway |
| bucket `respaldos` | Los respaldos cifrados | Cada familia se retira allá por los días del plan |

Todos en la misma región (`us-east4`, Virginia: la más cercana a Honduras con servicios completos) para que la red privada y los buckets queden a pocos milisegundos.

### Variables (las pone Railway; nada de esto se escribe a mano)

La `app` lleva: `NODE_ENV=production`, `DEPLOYMENT=production`, `TENANCY_MODE=multi`, `PORT=3000`, las tres URLs de Postgres (`DATABASE_URL`, `CONTROL_DATABASE_URL`, `TENANT_PROVISIONING_URL`, por la red privada y con `${{postgres.…}}`), `S3_*` (`${{fotos.…}}`), `CLIENT_IP_HEADER=x-real-ip` (el borde de Railway escribe la IP real; no se cree `X-Forwarded-For`), `TLS_ASK=off` (no hay Caddy: la ruta interna de certificados no existe) y tres secretos **generados por Railway** con `${{ secret(…) }}`: `AUTH_SECRET`, `PLATFORM_MASTER_KEY` y, en `cron-respaldos`, `BACKUP_PASSPHRASE`. Las tareas leen lo mismo de la app por referencia (`${{app.…}}`).

**Guarda fuera de Railway `PLATFORM_MASTER_KEY` y `BACKUP_PASSPHRASE`** (Railway → servicio → Variables → ver el valor → gestor de contraseñas). Sin la primera no se descifran las credenciales de las bases de los negocios; sin la segunda no se abre ningún respaldo. Si se pierde el proyecto de Railway, se pierden con él.

### Después de cada despliegue

1. En los registros de `app`, la línea `server.start` debe traer `"photos":"s3"`. Si trae `"file:/data/uploads"`, faltan las variables de S3 y las fotos se perderían al actualizar.
2. `https://<dirección>/api/health` responde `{"status":"ok"}`.
3. En `tareas-diarias` y `cron-respaldos`, la última ejecución en verde.

4. `pnpm photos:check` (guarda, lee y borra un archivo de prueba en el almacén de fotos): confirma que las credenciales del bucket sirven sin subir una foto desde una pantalla. Railway no da una consola; ver «Correr un comando una sola vez» abajo.

### Correr un comando una sola vez (Railway no da consola)

Se hace con un **servicio temporal**: un servicio nuevo con el mismo repositorio y las mismas variables de la app (por referencia, `${{app.NOMBRE}}`), `startCommand` = el comando (`node_modules/.bin/tsx scripts/platform.ts create-admin`, `node_modules/.bin/tsx scripts/photos-check.ts`…) y reinicio `NEVER`. Se crea **en espera** y se despliega con `accept-deploy`: su primer despliegue toma esa configuración y el contenedor corre el comando y termina; sus registros dicen cómo salió; luego se borra el servicio. Así se creó el administrador inicial (`ADMIN_NAME`, `ADMIN_USERNAME` y `ADMIN_PASSWORD` con `${{ secret(24, "…") }}`: la contraseña la genera Railway y se lee en el panel de Railway, nunca en un chat).

Trampas que ya se pisaron: **`redeploy` no aplica la configuración nueva** (vuelve a correr la anterior); para que un servicio ya creado tome un cambio de `startCommand` o de programación hay que **volver a conectar su fuente** (`connect-service-source`), que dispara un despliegue nuevo. Un cron con programación cambia solo en el siguiente despliegue, y Railway lo corre en el siguiente múltiplo de la programación (mínimo cada 5 minutos): para forzar una corrida de prueba se pone `*/5 * * * *`, se espera, y se **vuelve** a la programación de verdad.

### Dominio

Mientras se use la dirección gratuita de Railway (`*.up.railway.app`) **solo existe el panel de la plataforma**: Railway no da subdominios comodín sobre sus direcciones, y cada negocio necesita el suyo (`tienda.tudominio.com`). Para atender negocios hace falta un dominio propio:

1. Railway → `app` → Settings → Networking → Custom Domain: agrega `admin.tudominio.com` y `*.tudominio.com` (un comodín cuenta como un dominio). Railway da dos registros CNAME y un TXT para el DNS.
2. Variables de `app`: `PLATFORM_HOST=admin.tudominio.com`, `TENANT_BASE_DOMAIN=tudominio.com`, `APP_URL=https://admin.tudominio.com`.
3. Las tareas heredan esos valores por referencia; basta reiniciarlas.

### Restaurar desde el bucket de respaldos

Los archivos están cifrados con `BACKUP_PASSPHRASE` (`tenant-<base>-…` con una llave propia derivada de ella). Para devolver un negocio:

1. Descargar el archivo del bucket `respaldos` (explorador de archivos de Railway, o `rclone` con las credenciales del bucket).
2. Correr `docker/backup/restore-tenant.sh <archivo> <base>` en una máquina con Docker contra la base (se necesita acceso a Postgres: el proxy TCP de Railway, mientras dure la restauración) y, después, `pnpm tenants:relink <subdominio>` y `pnpm db:verify --tenant <subdominio>` desde un servicio temporal de la app (§16).

### Costos y límites

- Tope pedido: **$10 al mes**. En Railway → Workspace → Usage → *Set Usage Limits* conviene un límite duro de $10 y un aviso en $8: al llegar al límite Railway apaga los servicios y suspende los buckets.
- Cuenta los GB de RAM y los vCPU **realmente usados**; los tres servicios de fondo (Postgres, app) son lo que más pesa; los crones solo cuestan los minutos que corren.
- Los respaldos pedidos desde el panel se atienden en la próxima corrida del cron, no al instante.
- Los buckets de Railway no tienen versiones ni respaldo propio; el bucket de respaldos está en el mismo proyecto que lo que respalda. Para una copia fuera de Railway, apunta `OFFSITE_REMOTE` (y sus variables `RCLONE_CONFIG_OFFSITE_*`) a otro proveedor (Backblaze B2, S3…).
