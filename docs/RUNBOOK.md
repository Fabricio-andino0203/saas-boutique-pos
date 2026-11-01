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

Los respaldos quedan en la carpeta `./backups` del servidor (o en `BACKUP_PATH`). **El volumen `pgdata` y esa carpeta son lo único que no se puede reconstruir**: todo lo demás sale del repositorio.

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

El alta automática de negocios nuevos, la migración de todas las bases y el borrado controlado llegan en la Etapa 3; planes, vencimientos y límites en la Etapa 4; respaldos individuales por negocio en la Etapa 5. El negocio #1 se conecta con la cuenta principal de Postgres tal como lo hacía la tienda; los negocios nuevos tendrán un rol propio con permisos solo de datos.

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

**Borrar de verdad** una base archivada es una decisión aparte y manual (no hay comando a propósito): antes guarda un volcado (`pg_dump -Fc z_archived_<id>` en el contenedor `db`, cifrado y fuera del servidor) y luego `DROP DATABASE "z_archived_<id>"`. El borrado guiado llega con la Etapa 5. Las bases archivadas **no entran en el respaldo diario** (son estáticas: guarda un volcado antes de borrar).

### Respaldos de los negocios dados de alta

El respaldo diario (§5) recorre **todas las bases `t_<id>` que existen en el servidor** además de la tienda #1 y la base central: genera `tenant-t_<id>-AAAAMMDDTHHMMSSZ.dump.enc`, cifrado y comprobado igual que los demás. Si el respaldo de un negocio falla se anota (`backup.tenant_failed`) y se sigue con los demás; al final el respaldo termina con error. Se restaura con el mismo `restore.sh` (§6) en una base de prueba y se revisa con `VERIFY_DATABASE=<base> pnpm db:verify --tenant …`. Un respaldo **por negocio** con retención propia y restauración guiada llega con la Etapa 5; con muchos negocios el tiempo del respaldo crece en proporción.

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

- Cada rol de negocio tiene `CONNECTION LIMIT 10` y `statement_timeout 60 s`: un negocio no puede acaparar el servidor. Cada proceso de la app abre un pool pequeño por negocio y cierra los que llevan 5 minutos sin uso (tope de 50 abiertos a la vez).
- La prueba de capacidad dio de alta 20 negocios (5 a la vez) sin problema; para cientos de negocios hay que vigilar `max_connections` de Postgres (Etapa 6).
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
