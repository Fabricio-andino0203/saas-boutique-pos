# SaaS multi-negocio — Etapa 3: alta automática, actualización de la flota y baja controlada

> Rama `saas/etapa-0` (la Etapa 3 se construye encima). Propuesta aprobada: [`SAAS_PROPUESTA.md`](SAAS_PROPUESTA.md). Informes anteriores: [`SAAS_ETAPA_0.md`](SAAS_ETAPA_0.md), [`SAAS_ETAPA_1.md`](SAAS_ETAPA_1.md), [`SAAS_ETAPA_2.md`](SAAS_ETAPA_2.md). Operación: [`RUNBOOK.md`](RUNBOOK.md) §14.
>
> **Criterio de la etapa:** «crear 20 negocios de prueba en lote; matar el proceso a mitad y recuperar; migrar la flota con un negocio fallando» — **cumplido y probado** (secciones 3, 4 y 8).

## 1. Qué se entregó

| Pieza | Dónde | Para qué |
| --- | --- | --- |
| Receta de alta | `src/modules/platform/provisioning.ts` | Siete pasos idempotentes que dejan un negocio listo: rol propio, base copiada de la plantilla, migraciones y permisos, datos base, propietario y activación. Cada paso queda anotado en `ProvisioningRun`. |
| Reintentar y deshacer | ídem | Un paso que falla detiene la receta con su motivo; **retomar** continúa donde falló; **deshacer** borra lo que creó el intento sin dejar residuos. Una receta interrumpida (proceso muerto) se recupera pasados 5 minutos sin signos de vida. |
| Migración de la flota | `src/modules/platform/fleet.ts` | Lleva la base de cada negocio a la última versión: canarios primero, concurrencia limitada y **aislamiento de fallos**: un negocio cuya migración falla queda «en mantenimiento» y los demás siguen. |
| Estado «en mantenimiento» | `proxy.ts`, `directory.ts`, `control-directory.ts` | Un negocio con migración fallida (`MIGRATION_FAILED`) muestra una pantalla de actualización (503) en vez de una base a medias. |
| Baja controlada | `src/modules/platform/lifecycle.ts` | Pedir la baja (retención de 30 días, cancelable) → archivar. **Archivar renombra la base, no la destruye.** |
| Conciliación | `src/modules/platform/reconcile.ts` | Compara lo registrado con lo que hay en el servidor de Postgres y reporta bases o roles huérfanos, bases que faltan, altas abandonadas y datos atrasados. |
| Panel | `src/app/platform/(panel)/negocios/**` | Registrar un negocio, página de detalle (pasos de cada intento, error de migración, retención) con acciones confirmadas con tu contraseña, y «Revisión del servidor». |
| Comandos | `scripts/tenants.ts` | `tenants:template`, `provision`, `resume`, `undo`, `migrate`, `canary`, `reconcile`, `delete`, `cancel-delete`, `archive`. |
| Arranque | `docker/entrypoint.sh`, compose | Con varios negocios, cada arranque deja al día la plantilla y migra a la flota. |
| Respaldo | `docker/backup/backup.sh` | El respaldo diario recorre todas las bases `t_<id>`: `tenant-t_<id>-….dump.enc`, cifrado y comprobado. |
| Esquema central | `prisma/control/migrations` (2) | `ProvisioningRun`, estado `MIGRATION_FAILED`, canario, retención y archivo, con sus restricciones en la base. |

Lo que **no** cambia: ninguna regla de ventas, inventario, caja ni reportes; ninguna tabla ni migración de un negocio; con `TENANCY_MODE=single` el sistema es idéntico al de antes.

## 2. Cómo verlo funcionando (en tu equipo)

En PowerShell, con la plataforma ya preparada como en la Etapa 2:

```powershell
$env:TENANT_PROVISIONING_URL = "postgresql://boutique:<contraseña>@localhost:5432/postgres"
pnpm tenants:template                    # prepara la plantilla (una vez; después se mantiene sola)
$env:OWNER_PASSWORD = "Temporal-2026"
pnpm tenants:provision --slug tienda-b --name "Boutique B" --owner-name "Rosa Pérez" --owner-username rosa
$env:TENANCY_MODE = "multi"; $env:PLATFORM_HOST = "admin.localhost"
pnpm dev
```

- `http://tienda-b.localhost:3000/login`: el propietario entra con `rosa` y la contraseña temporal.
- `http://admin.localhost:3000` → **Negocios**: el formulario **Registrar un negocio** hace lo mismo desde el panel (unos 3 segundos); cada negocio tiene su página con los pasos del alta y las acciones (suspender, actualizar sus datos, pedir la baja, archivar…), todas con tu contraseña.
- **Negocios → Revisión del servidor**: conciliación y «Actualizar todos».

## 3. La receta de alta

| # | Paso | Qué hace (y por qué se puede repetir) |
| --- | --- | --- |
| 1 | `validate` | La cuenta de aprovisionamiento y la plantilla existen. |
| 2 | `role` | Genera la contraseña de la base y la **guarda cifrada antes de crear el rol** (si el proceso muere entre una cosa y otra, se retoma con la misma); crea el rol o, si ya existe, le deja esa contraseña. |
| 3 | `database` | `CREATE DATABASE … TEMPLATE` si aún no existe (con reintento si la plantilla está ocupada); solo su rol puede conectarse. |
| 4 | `migrate` | Aplica las migraciones que falten (solo si hacen falta) y los permisos de datos del rol. |
| 5 | `seed` | Ubicación, caja, catálogos y ajustes (`seedBase`, que ya era repetible) y el nombre del negocio. |
| 6 | `owner` | El propietario con la contraseña temporal; si ya existe uno activo, no hace nada. |
| 7 | `finalize` | El negocio pasa a `ACTIVE`, se borra la contraseña temporal de la receta y se anota en la auditoría, **todo en una sola transacción**. |

Cada negocio queda con **su propia base y su propio rol** (`t_<id>`, con `CONNECTION LIMIT 10` y `statement_timeout 60 s`), que solo puede leer y escribir datos de esa base. La contraseña temporal del propietario va cifrada por la bóveda mientras la receta no termina y nunca aparece en la auditoría, el registro ni los errores (los motivos de fallo se limpian de cadenas de conexión).

## 4. Recuperación

| Situación | Resultado comprobado |
| --- | --- |
| Falla un paso | La receta queda `FAILED` con el paso y el motivo, el negocio en «Con error»; **retomar** continúa desde ese paso y la base ya creada sigue siendo la misma (mismo identificador, misma contraseña). |
| Deshacer | Se borran la base y el rol del intento; el registro queda `FAILED` sin residuos; el subdominio se puede registrar de nuevo reutilizando el registro (intento 2). No se puede deshacer dos veces ni un negocio ya dado de alta. |
| Dos retomas a la vez | Solo una obtiene la receta (reclamo atómico); la otra recibe un conflicto. |
| **Proceso muerto** | Un proceso hijo se mata a sí mismo con `SIGKILL` justo después del paso `seed`, sin cerrar nada. La receta queda «en marcha» sin nadie; con signos de vida recientes no se puede tomar a la fuerza; pasada la gracia (5 minutos; aquí, sin espera) se retoma, hace el propietario, termina, y la base conserva su identificador y un único propietario. |
| Plantilla ausente | Detiene el alta en `validate` con «prepárala con pnpm tenants:template»; reparada, se retoma. |

## 5. Actualización de la flota

- Solo se migra a quien lo necesita (versión anotada ≠ última) y, antes de lanzar `prisma migrate deploy`, se comprueba la propia base: si ya está al día, no se lanza nada (rápido con cientos de negocios). `--force` lo hace siempre y así descubre una migración fallida a medias.
- **Canarios primero**; si uno falla, el resto se reporta «sin tocar».
- **Un negocio que falla** (probado con una migración fallida real: `prisma migrate deploy` se niega a seguir ante una migración a medias, P3009) pasa a `MIGRATION_FAILED` con el motivo y la hora, quien entra ve «en mantenimiento», los demás se migran y siguen activos. Reparado, la siguiente migración lo devuelve a `ACTIVE`. Un negocio suspendido que falla no cambia de estado (ya no atendía), solo anota el error.
- Quedan en la auditoría cada fallo y el resumen de cada corrida.

## 6. Baja controlada

1. **Pedir la baja** (con motivo): deja de atender y empieza la retención de 30 días; no se borra nada.
2. **Cancelar** en cualquier momento: vuelve al estado que tenía.
3. **Archivar** (retención cumplida, escribiendo el subdominio y con tu contraseña): se quitan los permisos del rol, se cierran las conexiones, la base se **renombra** a `z_archived_<id>` y se elimina el rol. Repetible tras una interrupción (el nombre sale del id). Los datos siguen intactos (se comprobó leyendo al propietario y el nombre del negocio en la base archivada).

## 7. Decisiones y hallazgos

1. **Archivar, no borrar.** El proyecto no tiene `pg_dump` en la imagen de la aplicación y el respaldo individual por negocio es de la Etapa 5; destruir una base sin respaldo comprobado es irreversible. Borrar de verdad una base archivada queda como una decisión manual y documentada (RUNBOOK §14).
2. **Un error del ensayo en Docker que las pruebas no cubrían:** el compose pasa `TENANT_TEMPLATE_DB` vacío y mi configuración lo leía como un nombre inválido, así que el contenedor de una instalación actualizada se reiniciaba sin parar. Ahora una variable vacía cuenta como no definida y, además, que no se pueda dejar al día la plantilla **ya no detiene el arranque** (solo fallarían las altas nuevas). Es la razón de ensayar la actualización de una instalación real y no solo una instalación nueva.
3. **Dos migraciones para el estado nuevo:** Postgres no deja usar un valor de enum recién agregado en la misma transacción, así que `MIGRATION_FAILED` va en su propia migración y las restricciones que lo mencionan en la siguiente.
4. **La receta no usa `redirect()` ni una cola de trabajos:** corre dentro de la acción del servidor (unos 3 segundos) y todo su estado está en la base central; si el proceso muere se recupera como arriba. Una cola aparte solo se justifica con altas de varios minutos.
5. **Todos los negocios nuevos entran al respaldo diario** (`tenant-t_<id>`). Sin esto, la Etapa 3 habría permitido crear datos de clientes sin respaldo. El respaldo individual con retención por plan sigue siendo de la Etapa 5.
6. **Cualquier rol de Postgres puede conectarse a la base `postgres`** (permiso por omisión de `PUBLIC`), así que el rol de un negocio podría ver los *nombres* de las bases de otros (`t_<id>`), nunca sus datos. Quitar ese permiso rompe servidores administrados, así que se deja y queda anotado.
7. **El propietario inicial no está obligado a cambiar su contraseña temporal** al entrar: eso exige un campo en las tablas de cada negocio (y migrar la flota por ello). Queda como mejora; mientras tanto se entrega por un medio seguro y se le pide cambiarla en *Mi cuenta*.
8. **Mi primera suposición en un caso de prueba era errónea:** que migrar «a los desactualizados» lanzaría siempre `prisma migrate deploy`. Como cada negocio se comprueba contra su propia base primero, no lo lanza si ya está al día; las pruebas ahora hacen «atrasada» a una base de verdad y usan `--force` donde hace falta la migración real.

## 8. Verificación

Corridas finales sobre el estado que se entrega (2026-11-01):

| Comprobación | Resultado |
| --- | --- |
| `pnpm lint`, `eslint --max-warnings 0`, `pnpm typecheck`, `pnpm format:check` | Limpios |
| `pnpm test` (unitarias + integración contra Postgres real, modo `single`) | **1243 pruebas, 87 archivos** (antes de la etapa: 1195). La corrida completa dio 1242 verdes y un fallo: una prueba de la Etapa 2 que fijaba un estado a mano sin las fechas que ahora exige la base central. Se corrigió y pasa sola (30/30). |
| Integración completa en modo estricto `TENANCY_MODE=multi` | **668 pruebas** (antes: 645); misma situación: 667 verdes y la prueba corregida, que pasa sola en este modo (30/30). |
| `pnpm test:e2e:platform` (panel, dos negocios por subdominio y el alta real desde el panel, en navegador) | **17 verdes** (antes: 13) |
| `pnpm test:e2e` (la tienda, 88 pruebas, modo `single`) | **88 verdes** en la segunda corrida; la primera tuvo **un fallo** en un paso de ajuste de inventario («Ajuste registrado.» no apareció en 15 s) y 12 pruebas sin correr, que no se repitió ni se pudo reproducir. |
| `E2E_TENANCY=multi pnpm test:e2e` (las mismas 88 con la tienda como negocio #1) | **88 verdes** |
| Ensayo en Docker (imagen de producción, **actualizando una instalación de la Etapa 2** con su volumen) | Se aplican las migraciones nuevas de la base central, se rehace la plantilla y la flota «se salta» lo que ya está al día; `healthy`. Alta de un negocio dentro del contenedor (**6 s** con el arranque del proceso) y atendido por HTTPS con certificado bajo demanda; un alta que falla por falta de plantilla y se **retoma** sin rehacer lo hecho; respaldo de la tienda #1, la base central y cada negocio, un respaldo de negocio restaurado y verificado con `db:verify`; baja (403 «cuenta suspendida»), cancelación, archivado anticipado (la base queda como `z_archived_<id>`, la dirección deja de atender) y conciliación sin diferencias. |
| Capacidad | **20 negocios dados de alta en 19 s** (5 a la vez), cada uno con su base y su rol; ninguno puede entrar a la base de otro. Un alta suelta tarda unos 3 s. |

Pruebas nuevas de la etapa: **48 de Vitest** (22 unitarias de la receta y el entorno, 11 de alta —incluida la del proceso matado con `SIGKILL` y la del lote de 20—, 12 de flota, baja y conciliación, y las del estado «en mantenimiento») y **4 de navegador** (alta desde el panel y entrada del propietario, suspender y reactivar con contraseña equivocada primero, baja controlada, revisión y «actualizar todos»).

**Errores propios encontrados y corregidos durante la etapa:** (1) el compose pasa `TENANT_TEMPLATE_DB` vacío y la configuración lo leía como un nombre inválido: el contenedor de una instalación actualizada se reiniciaba sin parar (lo mostró el ensayo en Docker; ahora lo vacío es «no definido» y, además, una plantilla que no se puede preparar ya no detiene el arranque); (2) la preparación de las pruebas de la tienda en modo multi usaba `TRUNCATE "Tenant"`, que la nueva relación con `ProvisioningRun` impide; (3) una advertencia de Turbopack («el acceso dinámico a archivos empaqueta todo el proyecto») por leer la carpeta de migraciones, corregida con la marca `turbopackIgnore`; (4) `pnpm test` completo pasó de unos 13 a unos 26 minutos en esta máquina (las pruebas de aprovisionamiento ocupan unos 2,5 minutos; el resto del aumento no se pudo atribuir a nada concreto), así que subí los tiempos máximos de CI a 30 y 45 minutos.

**Lo que no se pudo ensayar aquí:** un dominio real con certificados de Let's Encrypt, `DEPLOYMENT=production` dentro de Docker (rechaza dominios locales; sus reglas están cubiertas por las pruebas de `env.ts`), y el comportamiento con cientos de negocios (la prueba de capacidad es de 20).

## 9. Qué queda para las etapas siguientes

- **Etapa 4:** planes, suscripciones, límites y módulos; vencimientos con gracia y solo lectura (hoy «suspendido» es todo o nada).
- **Etapa 5:** respaldo y restauración **por negocio** con retención propia, borrado guiado de bases archivadas, métricas y alertas, soporte.
- **Pendientes:** cambio obligatorio de la contraseña temporal; rol limitado para el negocio #1; invalidación del directorio entre varias instancias; el limitador de intentos en memoria de un proceso; certificado comodín (alternativa) y `DEPLOYMENT=production` con un dominio real, sin ensayar.
