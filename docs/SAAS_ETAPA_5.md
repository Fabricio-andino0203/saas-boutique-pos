# SaaS multi-negocio — Etapa 5: respaldos por negocio, uso, alertas y soporte

> Rama `saas/etapa-0` (la Etapa 5 se construye encima). Propuesta aprobada: [`SAAS_PROPUESTA.md`](SAAS_PROPUESTA.md). Informes anteriores: [`SAAS_ETAPA_0.md`](SAAS_ETAPA_0.md) … [`SAAS_ETAPA_4.md`](SAAS_ETAPA_4.md). Operación: [`RUNBOOK.md`](RUNBOOK.md) §16.
>
> **Criterio de la etapa:** «restaurar **un** negocio en un servidor vacío con `db:verify` en verde y sin afectar a otro» — **cumplido y ensayado en Docker** (secciones 3 y 7).

## 1. Qué se entregó

| Pieza | Dónde | Para qué |
| --- | --- | --- |
| Respaldo **por negocio** | `docker/backup/{lib,backup,requests,loop}.sh` | El servicio de respaldos recorre los negocios registrados en la base central y respalda cada uno por separado, comprobado (se descifra completo y se lee el índice del volcado) y sin dejar nunca un archivo a medias. |
| **Llave propia** por negocio | `lib.sh` (`derive_key`) | El respaldo de cada negocio se cifra con una llave derivada de la clave general y del nombre de su base: se puede **entregar la copia de uno** sin abrir los demás. Los respaldos de la Etapa 3 siguen abriéndose. |
| **Retención según el plan** | `Plan.backupRetentionDays`, `/planes` | Cada plan dice cuántos días se conservan los respaldos de sus negocios (7 a 3650). Un negocio sin plan usa el valor del servidor (30). |
| **Registro** de respaldos | `TenantBackup` (base central), `src/modules/platform/backups.ts` | Cada respaldo queda anotado (archivo, tamaño, huella SHA-256, versión del esquema, comprobado, hasta cuándo se conserva, error si falló). Un archivo retirado deja su fila como historial. |
| Pedir un respaldo | panel → negocio → «Respaldar ahora», `pnpm backups:request` | La aplicación **no hace** el respaldo (no tiene la clave): deja un pedido y el servicio lo toma en unos segundos. |
| Estado de los respaldos | panel → **Respaldos**, página de cada negocio, `pnpm backups:status` | Al día / atrasado / falló / sin respaldo / pendiente, calculado con la hora (como el acceso por suscripción). |
| **Restaurar un negocio** | `docker/backup/restore-tenant.sh`, `src/modules/platform/restore.ts` (`tenants:relink`) | Restaura en una base temporal y, solo si salió bien, la pone en su lugar; la actual **no se borra** (queda como `z_replaced_…`). Después, `relink` devuelve lo que un volcado no trae: el rol del negocio, sus permisos, la versión de los datos, y **comprueba que puede entrar**. |
| **Uso** por negocio | `TenantUsageSnapshot`, `usage.ts`, `pnpm usage:collect` | Usuarios, productos, ventas de 30 días, última venta e ingreso, peso de la base: **solo números de una lista blanca**, nunca qué se vende ni a quién. |
| **Alertas** | `alerts.ts`, Resumen del panel, `pnpm alerts:check` | Una sola lista, de lo más grave a lo menos: respaldos fallidos o atrasados, servicio de respaldos detenido, negocios en mantenimiento, bases que faltan, negocios cerca de su tope… `alerts:check` sale con error si hay algo grave: sirve para un `cron` que avise. |
| **Borrado guiado** | `retired.ts`, `/respaldos`, `pnpm backups:retired / final / drop` | Las bases archivadas y las que una restauración dejó apartadas se borran de verdad solo con **un volcado final comprobado** y escribiendo su nombre. |
| **Soporte** | `support.ts`, `support-reader.ts`, `/negocios/<s>/soporte` | Una sesión con motivo y duración limitada (15 min a 2 h) para mirar personas, ventas, cierres de caja y auditoría de un negocio, y dos correcciones de acceso (desbloquear, contraseña temporal). |
| Esquema central | `prisma/control/migrations` (3) | `TenantBackup`, `TenantUsageSnapshot`, `SupportSession`, `Plan.backupRetentionDays`, `Tenant.archivedDroppedAt`, con sus restricciones en la base. |

Lo que **no** cambia: ninguna regla de ventas, inventario, caja ni reportes; ninguna tabla ni migración de un negocio; con `TENANCY_MODE=single` el sistema es idéntico al de antes (el servicio de respaldos sigue respaldando la tienda y su carpeta de siempre).

## 2. Cómo verlo funcionando (en tu equipo)

En PowerShell, con la plataforma preparada como en la Etapa 4 y el servicio de respaldos en Docker (o el de la imagen `docker/backup`):

```powershell
$env:TENANCY_MODE = "multi"; $env:PLATFORM_HOST = "admin.localhost"
pnpm control:setup                 # aplica las 3 migraciones nuevas de la base central
pnpm usage:collect                 # toma la primera foto de uso de los negocios
pnpm dev
```

1. `http://admin.localhost:3000` → **Resumen**: la lista de **Alertas** (un negocio sin respaldo bueno aparece como grave, con enlace).
2. **Respaldos**: todos los negocios y la base central, con su estado. En la página de un negocio: **Respaldar ahora** (con tu contraseña), la lista de sus últimos respaldos y «Cómo restaurarlo», con los comandos ya escritos con el archivo y la base reales.
3. En la página del negocio, **Uso**: usuarios y productos contra los topes del plan, ventas de 30 días, último ingreso y peso de la base; **Actualizar el uso** vuelve a leerlos.
4. **Soporte → Abrir una sesión** (motivo y duración) → **Ver los datos del negocio**: personas, ventas, cierres de caja y auditoría; **Contraseña temporal** (se muestra una vez) y **Desbloquear**. Cierra la sesión al terminar. En la tienda del negocio, su propia auditoría tiene el aviso de que se abrió.
5. **Respaldos → Bases apartadas**: tras archivar un negocio o restaurar uno, aparecen ahí; pide el volcado final y, cuando esté listo, bórrala.
6. **Auditoría** muestra cada paso (respaldo pedido, restauración terminada, uso actualizado, sesión de soporte abierta, vistas, contraseña temporal, base borrada…).

## 3. Restaurar un negocio

Dos casos, con el mismo guion (detalle en RUNBOOK §16):

- **En el mismo servidor, sin tocar a los demás.** Se suspende el negocio; `restore-tenant.sh` restaura el respaldo en una base temporal, y solo si salió bien cierra las conexiones de **ese** negocio, aparta su base actual (`z_replaced_<base>_<fecha>`) y deja la restaurada con su nombre; `pnpm tenants:relink <s>` vuelve a dar el rol y los permisos, lleva la base a la versión actual y entra con el rol del negocio para demostrarlo; `pnpm db:verify --tenant <s>` revisa los libros; se reactiva. Los demás negocios siguen atendiendo todo el tiempo (ensayado: ver sección 7).
- **En un servidor vacío.** Con la carpeta de respaldos y las dos claves (`BACKUP_PASSPHRASE`, `PLATFORM_MASTER_KEY`): se restaura la base central, la tienda #1 y cada negocio; al levantar la aplicación, `tenants:relink` crea el rol de cada negocio **con la contraseña que guarda la bóveda** (en un servidor nuevo el rol no existe) y comprueba que puede entrar.

El panel muestra los comandos exactos pero **no tiene un botón de restaurar**, a propósito: restaurar vuelve el negocio a una fecha anterior y exige acceso al servidor y a la clave de los respaldos, que la aplicación no tiene.

## 4. Dónde se aplica cada cosa (y por qué ahí)

| Pieza | Qué decide | Por qué ahí |
| --- | --- | --- |
| Servicio `backup` (otro contenedor) | Tiene `pg_dump`, la clave de cifrado y la carpeta de archivos; hace, comprueba, retira y **anota** cada respaldo | Que una aplicación comprometida **no pueda abrir ningún respaldo**. Es la frontera de seguridad de esta etapa. |
| Base central (`TenantBackup`) | Es el canal entre los dos: el servicio escribe el registro, la aplicación lo lee y agrega pedidos | Ya la usan los dos lados; no hace falta una cola ni un puerto nuevo. El servicio vuelve a validar cada pedido (que la base pedida sea de verdad la de un negocio registrado) antes de volcar nada. |
| `restore-tenant.sh` | Los **datos** (restaurar, apartar la anterior, dejar la nueva sin acceso para los demás roles) | Es lo que necesita `pg_restore` y la llave. |
| `relink` (aplicación) | Todo lo que depende del **servidor** y de la **bóveda**: rol, permisos, versión, prueba de entrada | Las credenciales viven cifradas en la bóveda de la aplicación; el servicio de respaldos no las tiene. Y es un solo código para los permisos (el mismo del alta). |
| `support-reader.ts` (capa `tenancy`) | Las únicas consultas con que el panel lee datos de un negocio | La regla de arquitectura prohíbe que el panel toque la base de un negocio; así todo lo que puede salir está a la vista en un archivo, con sus selecciones fijas (sin contraseñas, PIN, sesiones ni contenido de cambios). |
| Base central (restricciones) | Un respaldo «OK» tiene archivo, tamaño, huella y comprobación; solo se «retira» uno bueno; la sesión de soporte dura a lo sumo 2 h, tiene un motivo legible y es una por persona y negocio; los pagos y la auditoría siguen siendo de solo inserción | Que ni un error del código deje un registro a medias o una sesión sin motivo. |

## 5. Decisiones y hallazgos

- **La aplicación no tiene la clave de los respaldos.** Pudo ser más cómodo (un botón «restaurar» y el respaldo hecho desde Node), pero obligaba a darle la clave y la carpeta a la aplicación web. Se mantuvo la frontera que ya existía desde la Fase 6 y se comunican por el registro.
- **Una llave por negocio, derivada.** `SHA-256("versión:clave:base")` por la entrada estándar (nunca en la línea de comandos) y después los mismos 600 000 pasos de PBKDF2 de siempre. Deja entregar la copia de un negocio y no cambia la clave que ya se guarda fuera del servidor. Los respaldos de la Etapa 3 se abren probando primero la llave propia y luego la general (ensayado con archivos reales de la Etapa 3).
- **Lo que un volcado no trae.** `pg_restore --no-owner --no-privileges` deja las tablas sin permisos para el rol del negocio y la base abierta a `PUBLIC`: un negocio restaurado «a mano» no habría podido entrar, o habría quedado abierto a los roles de los demás. Por eso la base temporal se cierra a `PUBLIC` desde que se crea, y por eso existe `relink`, que además cubre el servidor vacío (donde el rol ni existe).
- **Las bases apartadas por una restauración cuentan como pendientes, no como errores.** La conciliación las lista aparte (`z_replaced_…`); borrarlas usa el mismo borrado guiado que las archivadas.
- **Nada se borra sin una copia comprobada.** El borrado exige un volcado final `OK` cuyo archivo todavía exista (un volcado ya retirado por la retención no vale) y escribir el nombre de la base. Se probó que el volcado final de una base apartada **se restaura** (`restore-tenant.sh final-…`).
- **Las fotos de uso no pueden guardar datos del negocio.** Las columnas son números y fechas, y una prueba exige que la tabla tenga **exactamente** las siete medidas permitidas: agregar una columna obliga a tocar la lista y la prueba.
- **Las sesiones de soporte sí leen datos reales**, pero solo con un motivo, un tiempo y un rastro doble: la auditoría de la plataforma (cada vista, cada acción) y un aviso en la del propio negocio. Si no se puede avisar al negocio, la sesión no se abre. La contraseña temporal no se escribe en ninguna auditoría ni queda en ningún lado salvo su huella Argon2 en la base del negocio.
- **Errores propios encontrados durante la etapa:** (1) una columna del panel se llamaba «Pedido / hecho» y chocaba con el texto «Hecho» del estado de los pasos del alta, que otra prueba de navegador contaba; (2) tras agregar auditoría, la prueba de administradores buscaba su acción en la primera página y ya no estaba: ahora filtra por acción; (3) la clave foránea de los respaldos se creó con `ON DELETE SET NULL`, que choca con la regla «todo respaldo de un negocio tiene negocio»; pasó a `RESTRICT`; (4) los preparadores de las pruebas de navegador vaciaban la tabla de negocios sin las tablas nuevas que apuntan a ella (la de la tienda en modo multi y la del panel).

## 6. Qué probó cada cosa

- **Unidad** (`tests/unit`): los estados del respaldo y sus fronteras de 26 horas (`backups`), la lista blanca de uso, `parseReplacedName`, `nearLimit`, el texto y el destino de cada alerta (`alerts`), la duración y el alfabeto de la contraseña temporal (`support`) y la regla de arquitectura de que el panel no toca la base de un negocio.
- **Integración con Postgres real**: `backups.test.ts` (pedir, un pedido a la vez, estados, retención del plan, restricciones de la base), `restore.test.ts` (un servidor que perdió el rol: `relink` lo devuelve, el negocio entra; repetirlo es seguro; no toca a otro; versión atrasada; migración que falla → «en mantenimiento»), `retired.test.ts` (sin volcado no se borra; el volcado retirado no vale; la conciliación; la base reemplazada), `usage-alerts.test.ts` (lo que se lee de una base real, un negocio que falla no impide los demás, alertas por gravedad) y `support.test.ts` (motivo, duración, una por persona, aviso en el negocio, sin sesión no se ve nada, ni vencida ni de otra persona, sin secretos, contraseña temporal que sirve para entrar). `provisioning.test.ts` comprueba que el alta pide su primer respaldo.
- **Navegador** (`tests/e2e-platform`): el recorrido de **respaldos** (el Resumen lista al negocio con el último respaldo fallido y no al nuevo, pedir y no poder pedir otro encima, terminar una restauración, el uso, pedir un volcado final y borrar una base escribiendo mal y luego bien su nombre) y el de **soporte** (sin sesión no hay datos; abrir con motivo; ver; contraseña temporal con la que la dueña entra de verdad a su tienda; cerrar; todo en la auditoría).
- **Servicio de respaldos real, contra un Postgres real** (sin pruebas automáticas: son scripts de shell en otra imagen; se ensayaron en Docker, ver sección 7): respaldo diario por negocio, pedidos, rechazo de un pedido con una base que no es de un negocio, restaurar a la base real y a otro nombre, clave equivocada, respaldos de la Etapa 3, volcado final, y el ciclo de `loop.sh`.

## 7. Verificación

Corridas finales sobre el estado que se entrega (2026-11-01), en secuencia y en una sola pasada:

| Comprobación | Resultado |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Limpios |
| `pnpm test` (unitarias + integración contra Postgres real, modo `single`) | **1414 pruebas, 100 archivos**, todas verdes (antes de la etapa: 1347 y 92). |
| Integración completa en modo estricto `TENANCY_MODE=multi` | **757 pruebas, 53 archivos**, todas verdes (antes: 714). |
| `pnpm test:e2e:platform` (panel, dos negocios por subdominio, alta, planes, respaldos, soporte) | **20 verdes** (antes: 18): los recorridos nuevos de **respaldos** y de **soporte**. |
| `pnpm test:e2e` (la tienda, modo `single`) | **88 verdes** |
| `E2E_TENANCY=multi pnpm test:e2e` (las mismas 88 con la tienda como negocio #1) | **88 verdes** |

**Ensayo en Docker** (imágenes de producción, **actualizando la instalación de la Etapa 4** con su volumen, dos negocios y respaldos viejos):

| Qué se ensayó | Resultado |
| --- | --- |
| Actualización | Las 3 migraciones centrales se aplican, la aplicación y el servicio de respaldos quedan `healthy`, ambos negocios responden 200 y el servicio queda programado. |
| Respaldo diario | Respalda la tienda #1, el negocio y la base central, y los anota en el registro; `backups:status` los muestra «al día». |
| Pedidos | `backups:request` → el servicio lo toma en segundos → archivo y fila `OK`. Un pedido sobre una base que no es de un negocio registrado (`postgres`) se **rechaza** y queda anotado como fallido. |
| Compatibilidad | Un respaldo de la **Etapa 3** (cifrado con la clave general) y uno nuevo (llave propia) se restauran con `restore-tenant.sh`; `restore.sh` manda a quien intenta restaurar un respaldo de negocio con el script equivocado; una clave equivocada se detiene al principio sin crear nada. |
| **Restaurar UN negocio, con la aplicación corriendo** | Con el negocio suspendido y la base abierta por la aplicación, se restauró el respaldo; **el otro negocio respondió 200 en las 66 comprobaciones hechas durante todo el proceso**. La base anterior quedó apartada (`z_replaced_…`); `tenants:relink` dejó el rol y los permisos al día; `db:verify --tenant` dio «Libros cuadrados»; un cambio hecho después del respaldo había desaparecido y el negocio, reactivado, respondió 200. |
| **Servidor vacío** | Proyecto nuevo con volúmenes nuevos: se restauraron la base central, la tienda #1 y un negocio desde la carpeta de respaldos; la aplicación arrancó y migró. El rol del negocio **no existía** (0 roles) y su `/api/health` daba **503**; tras `tenants:relink` el rol existía (creado con la contraseña de la bóveda), `db:verify` dio «Libros cuadrados» y respondió 200; la tienda #1 respondía 200 todo el tiempo. Revisión del servidor, estado de respaldos y alertas quedaron limpias. |
| Borrado guiado | La base apartada por la restauración y una archivada de una etapa anterior: sin volcado, `backups:drop` se niega; con el volcado final hecho por el servicio, se borra; el volcado queda guardado y la conciliación queda sin diferencias. |

Pruebas nuevas de la etapa: **67 de Vitest** (unidad 24: estados del respaldo, uso, alertas y soporte; integración 43: registro y pedidos 12, restauración 6, bases apartadas 4, uso y alertas 10, soporte 11; además el alta comprueba que pide su primer respaldo) y **2 de navegador** (respaldos y uso/bases apartadas; soporte con la contraseña temporal usada de verdad en la tienda).

**Hallazgos del ensayo** (corregidos en la documentación, no en el código): (1) para recuperar en un servidor nuevo hay que usar **la misma `POSTGRES_PASSWORD`**, porque la credencial de la tienda #1 es la cuenta principal y está guardada en la bóveda; (2) la base `POSTGRES_DB` del servidor nuevo existe vacía y `restore.sh` la aparta como `boutique_pos_old_<fecha>`; (3) `GET /login` de un negocio responde 200 aunque no pueda abrir su base — la comprobación real de que un negocio está sano es su `/api/health` (503 si falta su rol).

**Lo que no se pudo ensayar aquí:** un dominio real con certificados de Let's Encrypt y `DEPLOYMENT=production` dentro de Docker; varias instancias de la app a la vez; restaurar con **volúmenes grandes** (los de prueba pesan unos cientos de kilobytes: el tiempo de un respaldo y de una restauración crece con el tamaño de la base); y un servidor de Postgres **gestionado** (el servicio de respaldos usa `pg_dump`/`pg_restore` contra el servidor al que apunta `PGHOST`, y se ensayó con el Postgres del propio compose).

## 8. Qué queda para las etapas siguientes

- **Etapa 6 — endurecimiento y escala** (propuesta §9): carga con cientos de negocios y uso simultáneo, `PgBouncer` o un segundo servidor si hace falta, revisión de seguridad e informe de capacidad. El respaldo diario recorre los negocios de uno en uno: con cientos habrá que repartirlo en paralelo o por servidor.
- **Recuperación a un instante** (PITR): hoy se vuelve a la fecha del último respaldo; archivar los registros de transacciones de Postgres (WAL) permitiría volver a un minuto exacto. No se hizo: cambia la operación del servidor de bases y no estaba en el alcance.
- **Avisos por correo o mensaje:** las alertas viven en el panel y en `alerts:check` (para un `cron` que avise); el sistema **no envía** nada por su cuenta.
- **Botón de «restaurar» en el panel:** a propósito no existe (ver sección 3); si algún día se quiere, requiere decidir cómo se le da la clave de los respaldos a quien lo ejecute.
- **Copia fuera del servidor automática:** la carpeta de respaldos se copia con lo que cada instalación elija (`rclone`, `rsync`…), como desde la Fase 6.
- Endurecimientos que ya estaban anotados: cambio de contraseña obligatorio del propietario recién creado (y de la contraseña temporal que da el soporte), rol limitado para el negocio #1, invalidación del directorio entre varias instancias, limitador de intentos compartido, ensayo con dominio real y `DEPLOYMENT=production`.
