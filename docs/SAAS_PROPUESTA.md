# Propuesta técnica — Boutique POS como SaaS multi-negocio

> **Propuesta aprobada el 2026-10-31. Etapas hechas:** Etapa 0 (prueba de concepto, [`SAAS_ETAPA_0.md`](SAAS_ETAPA_0.md)), Etapa 1 (plano de control y superadministrador con 2FA, [`SAAS_ETAPA_1.md`](SAAS_ETAPA_1.md)) y Etapa 2 (negocios por subdominio y modo multi-negocio listo para producción, [`SAAS_ETAPA_2.md`](SAAS_ETAPA_2.md)). Cada etapa siguiente se muestra funcionando y se aprueba antes de empezar la otra.

## Resumen en cinco líneas

1. **Una base de datos por negocio** (como pides), todas del mismo esquema que ya tienes: **no hay que cambiar las 39 tablas ni las 9 migraciones actuales** porque hoy cada instalación ya es un negocio completo.
2. Una **base de datos central** (el "plano de control") guarda negocios, planes, suscripciones, superadministradores y su auditoría. **Nunca** guarda ventas, inventario ni clientes.
3. Cada negocio entra por **su propia dirección** (`tienda-a.tuplataforma.com`). El servidor deduce el negocio **solo** de esa dirección verificada en la base central, jamás de algo que mande el navegador, y **si no hay negocio resuelto, no hay base de datos** (falla cerrado).
4. Registrar un negocio ejecuta una **receta automática con estados y recuperación**: crea su base y su usuario de base, aplica migraciones, crea al administrador, asigna plan y fechas, y lo deja listo.
5. Es un cambio **grande pero acotado**: el motor de ventas, inventario, caja y reportes **no se reescriben**; se agrega una capa debajo (cómo se obtiene la conexión) y una capa encima (planes y panel de plataforma).

---

## 1. Diagnóstico de la arquitectura actual

| Hallazgo (verificado en el código) | Qué significa para el SaaS |
| --- | --- |
| Un solo cliente Prisma `db` (`src/lib/db.ts`) que lee `DATABASE_URL`; **40 archivos** lo importan | El punto de cambio es **uno**: dejar de ser un cliente fijo |
| **108 funciones** reciben `client = db` por omisión; **0** llamadas `db.$…` directas; **49** transacciones interactivas y **0** por lote | `db` se puede sustituir por un cliente "que elige la base del negocio" **sin tocar la lógica** de ventas, inventario, caja, etc. |
| **No hay** `use cache` ni `unstable_cache`; `getSettings` lee la BD cada vez | No existe una caché compartida que pudiera mostrarle a un negocio datos de otro (se protege con una prueba de arquitectura) |
| Configuración, correlativos y perfil del negocio viven **dentro de la BD** (`BusinessProfile`, `Setting`, `DocumentCounter`) | Con una BD por negocio ya son "por negocio" automáticamente: **sin columna `tenantId`** |
| Sesiones en la tabla `Session` de la misma BD y cookie **sin atributo Domain** (por host) | Una cookie de `tienda-a.…` no viaja a `tienda-b.…` y un token de A no existe en la BD de B: aislamiento por construcción |
| Candados `pg_advisory_xact_lock`, correlativos sin saltos y reportes SQL | Son **por base**: siguen siendo correctos y no compiten entre negocios |
| Estado global en memoria: limitador de intentos por IP y un hash ficticio de login | Hay que **incluir el negocio en la clave** del limitador (el hash ficticio es inocuo) |
| Docker Compose, `entrypoint.sh`, respaldos, `db:verify`, `admin:create-owner`, seeds y scripts asumen **una** base | Se adaptan a "para cada negocio…" (los de respaldo y verificación ya son casi reutilizables) |
| Permisos por rol en código (`src/lib/permissions.ts`); **no hay** concepto de plan ni de módulo | Falta una segunda llave: "¿el plan de este negocio incluye esta función?" |
| País fijo: Lempira, ISV, `America/Tegucigalpa`, textos `es-HN` (3 archivos + `messages.es.ts`) | Para la v1 **todos los negocios operan en Honduras**; internacionalizar es un proyecto aparte |
| 2 páginas (`vender`, `apartados/[id]`) llaman a Prisma directamente | Se corrigen al tocarlas (la regla del proyecto lo prohíbe) |

**Tenant = negocio (empresa)**, no sucursal. Las sucursales y cajas ya son datos **dentro** de cada negocio (`Location`, `Terminal`).

---

## 2. Alternativas de aislamiento y por qué recomiendo una

| | **A. Una BD por negocio** (tu idea) | B. Un esquema por negocio (1 BD) | C. Tablas compartidas con `tenantId` + RLS |
| --- | --- | --- | --- |
| Aislamiento | **El más fuerte**: otro usuario de base de datos, otra base | Medio: misma base, permisos por esquema | El más débil: depende de no olvidar filtros/políticas |
| Cambios al código actual | **Mínimos** (solo cómo se obtiene la conexión) | Medios (Prisma no cambia de esquema por petición sin clientes separados) | **Enormes**: 39 modelos, SQL crudo, `@unique` y correlativos globales |
| Respaldo/restauración/borrado de **uno** | **Natural** (`pg_dump` de una BD; ya lo tenemos) | Posible (`-n`) pero incómodo | Muy difícil sin filtrar filas |
| Migraciones | Hay que correrlas **en cada BD** (se automatiza) | En cada esquema | Una sola vez |
| Conexiones | **Costo real**: un pool por BD (se gestiona, ver §3.4) | Un pool | Un pool |
| Reportes entre negocios | Hay que recolectar métricas aparte | Igual | Fácil |
| Costo por negocio pequeño | Mayor (cada BD pesa unos MB) | Menor | El menor |
| Escala | Cientos por servidor; **miles repartidos en varios** | Cientos | Decenas de miles |

**Recomendación: A**, sobre uno o varios servidores Postgres, con **un rol (usuario) de base por negocio** que solo puede conectarse a *su* base. Es lo que pides, minimiza el riesgo de fuga entre clientes y deja intacta la lógica probada de dinero e inventario. Su precio (conexiones y migraciones masivas) es manejable y está resuelto abajo. **C es lo más barato de operar pero obligaría a reescribir y re-probar casi todo el sistema**: no la recomiendo para un POS donde un error cruza dinero ajeno.

---

## 3. Arquitectura propuesta

```
Navegador ──HTTPS──► Caddy (certificado comodín) ──► App Next.js (un solo despliegue)
                                                       │
  admin.tuplataforma.com ──► área "Plataforma" ────────┼──► BD CENTRAL (negocios, planes, suscripciones, superadmins)
  tienda-a.tuplataforma.com ─► área "Negocio" ─┐       │
  tienda-b.tuplataforma.com ─► área "Negocio" ─┴─► resolver host→negocio ─► pool de conexiones ─► BD del negocio A / B / C…
                                                       │
   Procesos de fondo (misma imagen): aprovisionar · migrar flota · respaldar · vencer suscripciones · recolectar métricas
```

### 3.1 Base central ("plano de control")
Esquema Prisma propio (`prisma/control/schema.prisma`, cliente generado aparte; la CLI de Prisma admite un archivo de configuración alterno, **se confirma en la Etapa 0**). Tablas:

- **Tenant**: `id`, `slug` (subdominio único), `name`, `status` (`PROVISIONING`, `ACTIVE`, `SUSPENDED`, `PENDING_DELETION`, `DELETED`, `FAILED`), `dbServerId`, `dbName`, `dbRole`, credencial **cifrada** (AES-256-GCM: texto cifrado + nonce + versión de llave), `schemaVersion` (última migración aplicada), `ownerEmail`, `createdAt`.
- **Plan**: nombre, `priceCents`, `interval` (`MONTHLY`/`QUARTERLY`/`SEMIANNUAL`/`ANNUAL`), `limits` (usuarios, cajas, sucursales, productos, almacenamiento…), `features` (lista de módulos habilitados), `isActive`, `sortOrder`.
- **Subscription** (historial, nunca se edita una fila vieja): `tenantId`, `planId`, `status` (`TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED`, `EXPIRED`), `startsAt`, `currentPeriodEnd`, `graceDays`, `priceSnapshot`, `reason`.
- **PlatformPayment**: pagos registrados (monto, fecha, método, referencia, periodo que cubre).
- **PlatformUser** (superadministradores) y **PlatformSession**, con contraseña Argon2 y **2FA obligatorio (TOTP)**.
- **PlatformAuditLog**: toda acción administrativa (quién, qué negocio, qué cambió, IP), que no se borra.
- **TenantUsageSnapshot**: métricas **de una lista blanca** (cuántos usuarios, ventas de los últimos 30 días, tamaño de la base, último acceso, versión del esquema); **nunca** datos de negocio.
- **ProvisioningRun**: cada intento de aprovisionar con sus pasos y errores.

### 3.2 Base de cada negocio
**El mismo esquema actual, sin cambios.** El administrador principal es un `User` con rol `OWNER` como hoy. La auditoría del negocio (`AuditLog`) sigue siendo suya.

### 3.3 Cómo se elige la base en cada petición (el punto crítico)
1. `src/proxy.ts` toma el `Host`, lo valida contra la base central (con caché corta de 30–60 s) y, si no existe o el negocio no puede operar, responde 404 / "cuenta suspendida" **antes** de tocar nada. El área "Plataforma" solo responde en `admin.…`; el área "Negocio", solo en los hosts de negocios.
2. `db` pasa a ser un **objeto "resolutor"**: cada llamada (`db.sale.create(...)`, `db.$transaction(...)`) obtiene primero el cliente del negocio actual y luego ejecuta la operación. Para peticiones web el negocio sale de `headers()` (el host ya validado); para procesos de fondo y pruebas, de `runWithTenant(tenant, fn)` (`AsyncLocalStorage`).
3. **Falla cerrado:** si no hay negocio en contexto, `db` lanza un error. No existe una "base por defecto" a la que se pueda caer por accidente.
4. **Ninguna ruta, parámetro, cuerpo ni cookie puede elegir negocio.** La única fuente es el host verificado.
5. Alternativa descartable en la Etapa 0: servidor personalizado de Next con `AsyncLocalStorage` para toda la petición (más simple de razonar, pero reemplaza `next start`). Se decide con una prueba real; mi preferencia es el resolutor sin servidor personalizado.

### 3.4 Gestión de conexiones (el costo de la opción A)
- **Administrador de pools**: un pool pequeño (2–5) por negocio, creado al primer uso y **cerrado tras minutos sin uso** (LRU con tope global por instancia, p. ej. 50 negocios activos).
- Cada rol de base tiene `CONNECTION LIMIT` y `statement_timeout` propios: un negocio no puede agotar el servidor ("vecino ruidoso").
- Se mide: conexiones por servidor, evicciones, tiempo de aprovisionamiento. **PgBouncer** (modo transacción) es opcional cuando el número de negocios activos simultáneos pase de ≈ 100; los candados y transacciones del sistema son compatibles en principio y se **valida en la Etapa 0**.
- Cada servidor Postgres aloja **cientos** de bases cómodamente (autovacuum y catálogos son el límite). `Tenant.dbServerId` permite repartir **miles** en varios servidores sin cambiar el código.

---

## 4. Registro y aprovisionamiento automático

El botón "Registrar negocio" crea el `Tenant` (`PROVISIONING`) y lanza una **receta con pasos idempotentes**; cada paso se anota en `ProvisioningRun` y puede **reintentarse o deshacerse**:

1. Validar `slug` (solo `[a-z0-9-]`, reservados bloqueados) y elegir servidor.
2. **Crear el rol** `t_<id>` con contraseña aleatoria; `REVOKE CONNECT … FROM PUBLIC` y `GRANT CONNECT` solo a ese rol (así nadie más entra a esa base).
3. **Crear la base** `t_<id>` **desde una plantilla** (`CREATE DATABASE … TEMPLATE boutique_plantilla`): una base "dorada" que ya tiene extensiones y todas las migraciones y se mantiene al día en cada despliegue; tarda milisegundos en vez de segundos. Nombres **generados por el sistema**, nunca escritos por una persona (sin inyección de SQL).
4. **Verificar/aplicar migraciones pendientes** (`prisma migrate deploy` en un proceso aparte con la URL de esa base) y anotar `schemaVersion`.
5. **Sembrar lo base**: ubicación, caja, catálogos, ajustes, contadores (`seedBase`, que ya existe) y el **perfil del negocio** con los datos del alta.
6. **Crear al administrador principal** (`createFirstOwner`, que ya existe) con contraseña temporal de un solo uso que debe cambiar al entrar.
7. **Cifrar y guardar la credencial** del rol en la base central.
8. Crear la **suscripción** (plan elegido, inicio, vencimiento) y el **primer respaldo**.
9. Marcar `ACTIVE`, registrar en la auditoría y mostrar la dirección y el acceso inicial.

**Recuperación:** si un paso falla, la receta se detiene en `FAILED` con el motivo; **reintentar** continúa desde ese paso (idempotente) y **deshacer** elimina lo creado por *ese* intento (base y rol) y deja el negocio en `FAILED` sin residuos. Un trabajo de conciliación detecta bases `t_*` sin negocio y negocios sin base y los reporta.

---

## 5. Planes y suscripciones

- **Planes configurables** desde el panel: nombre, precio, duración, límites y módulos. Módulos que se pueden activar/desactivar (el núcleo de vender/cobrar/caja/inventario siempre va): reportes y exportaciones, apartados, devoluciones y cambios, compras y recepciones, conteos físicos, facturación con CAI, clientes y crédito de tienda, etiquetas.
- **Validación automática**, en tres puntos del servidor: (1) **estado del negocio** en cada petición (suspendido = pantalla de cuenta suspendida); (2) `requireFeature("apartados")` junto a `requireCapability(...)` en acciones y páginas, y menú que oculta lo no incluido; (3) **límites** al crear (`createUser`, cajas, sucursales, productos…). La "foto" de permisos del plan se guarda en memoria 60 s y se invalida al cambiar algo en el panel.
- **Cambio de plan sin perder datos:** solo se agrega una `Subscription` nueva (efecto inmediato o al fin del periodo). Los datos del negocio no se tocan. Si un plan nuevo tiene un límite menor que el uso actual (8 usuarios → plan de 5), **no se borra nada**: queda "sobre el límite" y solo se bloquea crear más.
- **Ciclo de vida** (valores por defecto, ajustables): `TRIAL` 14 días → `ACTIVE` → vence → `PAST_DUE` con **7 días de gracia** (todo funciona, con aviso) → `SUSPENDED` (**solo lectura y exportación**, no venta) → a los 60 días `CANCELLED` → `PENDING_DELETION` (30 días de retención) → borrado. Un trabajo diario mueve los estados y avisa.
- **Cobro v1 manual:** tú registras el pago y se extiende el periodo (queda auditado). La **pasarela de pago** (cobro recurrente automático) es una etapa opcional posterior; hay que elegirla (Stripe no opera directamente en Honduras; opciones regionales a validar).

---

## 6. Seguridad y aislamiento

| Amenaza | Medida |
| --- | --- |
| Un cliente manipula ids, parámetros o cookies para ver a otro | El negocio **solo** sale del host verificado; las sesiones viven en la BD de cada negocio, así que un token ajeno **no existe**; no hay parámetro que cambie de negocio |
| Un fallo de programación consulta la BD equivocada | `db` falla cerrado sin contexto; **prueba de arquitectura** que prohíbe crear clientes de BD fuera de `src/lib/tenancy/`; pruebas con **dos negocios con los mismos ids** |
| Alguien llega a la base por la red | Roles por negocio con `CONNECT` exclusivo + `CONNECTION LIMIT` + `statement_timeout`; la base no se publica fuera |
| Fuga de credenciales | Contraseñas aleatorias cifradas con llave maestra (`PLATFORM_MASTER_KEY`, luego un KMS), con versión de llave y procedimiento de rotación; nunca en logs (el logger ya las redacta) |
| Robo de sesión | Cookie `HttpOnly`, `Secure`, `SameSite=Lax` y prefijo `__Host-` (sin Domain); sesiones de plataforma aparte, con 2FA, caducidad corta y reautenticación para acciones destructivas |
| Superadmin abusa o se equivoca | Auditoría inmutable en la central; acciones sobre un negocio mediante **funciones del servidor** (restablecer contraseña del dueño, crear usuario, cambiar rol) que registran en **ambas** auditorías; **sin "entrar como" el usuario** en la v1 |
| El panel "ve demasiado" | Solo métricas de lista blanca; para mirar datos reales se abre una **sesión de soporte** con motivo, duración limitada y registro |
| Abuso de volumen | Límite de intentos por IP **y por negocio**, topes por rol de base, validación de host con consulta `ask` para certificados |
| Una actualización rompe a un negocio | Migraciones compatibles hacia atrás, versión de esquema por negocio, "en mantenimiento" solo para ese negocio |
| Pérdida de datos | Respaldo cifrado **por negocio** (sección 7), restauración individual ensayada |

**Pruebas de aislamiento obligatorias** (se vuelven parte de CI): ids repetidos en dos negocios, token de A usado en B, host falsificado, negocio suspendido, sin contexto, límites del plan, y fuga por caché/estado global.

---

## 7. Escalabilidad y mantenimiento

- **Migraciones globales:** `pnpm tenants:migrate` recorre la flota con **concurrencia limitada**, canario primero (negocios de prueba), registra `schemaVersion` y aísla fallos (un negocio con error queda `MIGRATION_FAILED` y "en mantenimiento"; los demás siguen). **Política "expandir y luego contraer"**: cada migración debe ser compatible con la versión anterior de la app, para actualizar sin apagar a todos a la vez. La plantilla se actualiza en cada despliegue.
- **Respaldos y restauración individuales:** el servicio `backup` actual recorre los negocios activos de la central y genera `tenant-<id>-<fecha>.dump.enc` con una llave derivada **por negocio** (HKDF de una llave maestra); retención según plan; la base central tiene su propio respaldo. `restore.sh` y `db:verify` actuales se reutilizan **por negocio** (restaurar uno no toca a los demás).
- **Suspender / reactivar:** cambia el estado (reversible, sin tocar datos).
- **Eliminación controlada:** `PENDING_DELETION` con ventana de retención → respaldo final archivado → `DROP DATABASE` + `DROP ROLE`, con **confirmación escrita y reautenticación** del superadmin; queda en la auditoría.
- **Monitoreo:** el id del negocio en cada línea del registro; errores por negocio; conexiones y evicciones; fallos de aprovisionamiento y migración; `/api/health` de plataforma (central + administrador de pools) y estado por negocio solo en el panel; alertas por el monitor externo.
- **Capacidad:** objetivo de diseño de **cientos de negocios por servidor** y **miles con varios servidores**, sin cambiar código (solo `dbServerId` y, si hace falta, PgBouncer).

---

## 8. Qué se modifica y qué se crea

**Se modifica (poco):**
- `src/lib/db.ts` → resolutor del negocio actual (el cambio central).
- `src/proxy.ts` → resolver host, estado del negocio, separar áreas Plataforma/Negocio.
- `src/lib/auth.ts` y `src/modules/auth/*` → siguen igual por dentro; se ejecutan en el contexto del negocio.
- `src/lib/rate-limit.ts` / `modules/auth/throttle.ts` → clave con el negocio.
- `src/lib/logger.ts`, `src/instrumentation*.ts` → id de negocio en cada línea.
- `src/modules/users/service.ts` (+ cajas, sucursales, productos) → verificar límites del plan.
- `src/app/(app)/**` → menú y rutas filtrados por módulos del plan; 2 páginas que llamaban a Prisma directo.
- `src/lib/env.ts`, `.env.production.example`, `docker-compose.prod.yml`, `Dockerfile`/`entrypoint.sh`, `Caddyfile` (certificado comodín), CI, `health`.
- Scripts `create-owner`, `expire-layaways`, `db:verify`, `db:reconcile`, backup/restore → reciben el negocio (`--tenant`) o recorren la flota.
- Pruebas: los ayudantes de BD de pruebas (`tests/integration/helpers/db.ts`) y E2E (subdominios locales `*.localhost`).

**Se crea desde cero:**
- `prisma/control/` (esquema + migraciones de la base central) y su cliente.
- `src/lib/tenancy/`: resolutor de host, contexto (`runWithTenant`), administrador de pools, bóveda de credenciales (cifrado), conciliador.
- `src/modules/platform/`: negocios, planes, suscripciones, pagos, superadmins (+ 2FA TOTP), auditoría, métricas, soporte.
- `src/modules/provisioning/`: la receta, el deshacer y el conciliador.
- `src/modules/entitlements/`: módulos y límites del plan, `requireFeature`.
- `src/app/(platform)/**`: panel de Superadministrador (negocios, planes, suscripciones, vencimientos, auditoría, salud).
- `scripts/tenants-migrate.ts`, `scripts/tenants-backup`, trabajos diarios (vencimientos, métricas, conciliación).
- `docs/RUNBOOK.md` ampliado (alta, baja, migración de flota, restauración de un negocio, rotación de llaves).

**Tecnologías:** **ninguna dependencia nueva obligatoria**: TOTP y el cifrado salen de `node:crypto`; los trabajos usan un cron del servidor y una tabla de tareas en la central. Opcionales cuando haga falta: **PgBouncer**, **Redis** (límites y caché compartidos si hay varias instancias de la app), **KMS** para la llave maestra, plugin DNS para el certificado comodín (o Cloudflare delante), y la pasarela de pagos.

---

## 9. Plan por etapas (cada una termina con algo que ves funcionando)

| Etapa | Qué se hace | Cómo se sabe que está lista | Tamaño |
| --- | --- | --- | :-: |
| **0. Prueba de concepto** (lo que autorizas ahora) | Resolutor `db` + contexto sobre **dos bases** de prueba; correr la **suite actual** sin cambios de lógica; confirmar: resolutor vs servidor personalizado, `--config` de Prisma, PgBouncer, rendimiento del pool | Toda la suite verde con el resolutor; una demo donde dos "negocios" con **los mismos ids** no se ven entre sí; informe de hallazgos y decisión final del mecanismo | S–M |
| **1. Plano de control** | Base central, bóveda de credenciales, superadmin con 2FA, esqueleto del panel, auditoría | Entras a `admin.…` con 2FA; todo queda auditado | M |
| **2. Tiempo de ejecución multi-negocio** | Host → negocio, pools, fallo cerrado, estados del negocio; **el negocio actual pasa a ser el negocio #1 sin mover datos**; limitador y logs con negocio | Pruebas de aislamiento de §6 en verde; la tienda actual sigue vendiendo igual | M–L |
| **3. Aprovisionamiento y ciclo de vida** | La receta con plantilla, deshacer, conciliador, migración de flota, suspender/reactivar/eliminar | Crear 20 negocios de prueba en lote; matar el proceso a mitad y recuperar; migrar la flota con un negocio fallando | L |
| **4. Planes, suscripciones y límites** | Planes, módulos, límites, cambio de plan, vencimientos y gracia, pagos manuales, avisos | Un negocio vence y pasa por gracia → solo lectura → reactiva al pagar; cambio de plan sin perder datos | M–L |
| **5. Respaldos por negocio, soporte y monitoreo** | Respaldo/restauración individuales, métricas de lista blanca, sesión de soporte, alertas | Restaurar **un** negocio en un servidor vacío con `db:verify` en verde y sin afectar a otro | M |
| **6. Endurecimiento y escala** | Carga con 200 negocios, PgBouncer/segundo servidor si hace falta, revisión de seguridad, documentación | 200 negocios con uso simultáneo sin fugas ni errores de conexión; informe de capacidad | M |
| *Opcional* | Pasarela de pago, dominio propio por negocio, internacionalización (otro país/moneda), "entrar como" con registro | — | — |

---

## 10. Riesgos y cómo se controlan

1. **Olvidar el contexto de negocio** → falla cerrado + prueba de arquitectura + pruebas con ids repetidos.
2. **Explosión de conexiones** → pools mínimos con expulsión por inactividad, `CONNECTION LIMIT`, PgBouncer, más servidores.
3. **Migraciones a medias en la flota** → compatibilidad hacia atrás, canario, estado por negocio, aislamiento del fallo.
4. **Aprovisionamiento huérfano** (base sin negocio) → receta idempotente, deshacer y conciliador.
5. **Llave maestra comprometida o perdida** → rotación documentada, respaldo de la llave fuera del servidor, KMS cuando crezca; **sin la llave no se recuperan las credenciales** (se pueden restablecer rotando los roles).
6. **Costo operativo** → un solo despliegue de la app, trabajos de fondo en la misma imagen, métricas de capacidad desde el día uno.
7. **Alcance** → v1 solo Honduras (L, ISV, es-HN); cobro manual; sin dominio propio por negocio.

## 11. Decisiones que necesito de ti (mi valor por defecto entre paréntesis)

1. **Dirección de cada negocio:** subdominio de tu dominio (`tienda-a.tuplataforma.com`) *(sí)*, o dominio propio por negocio más adelante.
2. **¿Operan todos en Honduras** (Lempira, ISV 15 %, hora de Honduras, español)? *(sí en la v1)*
3. **Política al vencer:** 7 días de gracia → solo lectura/exportación → cancelar a los 60 días → borrar tras 30 de retención *(estos números)*.
4. **Cobro:** manual en la v1 *(sí)*; ¿qué pasarela te interesaría después?
5. **Módulos que quieres vender por separado** (lista de §5 como punto de partida) y **límites** que usarías (usuarios, cajas, sucursales, productos).
6. **Servidores:** ¿Postgres propio (VPS) o administrado? *(propio al inicio, preparado para varios)*; número de negocios esperados el primer año.
7. **El negocio actual** (esta tienda) pasa a ser el negocio #1 *(sí, sin mover datos)*.
8. **Panel de plataforma en la misma aplicación**, separado por dirección (`admin.…`) *(sí; se puede separar después)*.

## Qué NO incluye esta propuesta (v1)

Dominio propio por negocio, otros países o monedas, cobro automático con pasarela, "entrar como" otro usuario, modo sin internet, tienda en línea, y compartir datos entre negocios.

## Verificación (cómo se comprobará cada etapa)

`pnpm lint`, `pnpm typecheck`, `pnpm format:check`, la suite actual completa (**debe seguir verde sin cambios de lógica**), pruebas de integración con **dos bases reales** (mismos ids en ambas), prueba de arquitectura contra clientes de BD fuera de `tenancy/`, pruebas de aprovisionamiento con **fallos inyectados** en cada paso, migración de flota con un negocio defectuoso, restauración individual con `db:verify`, E2E con dos subdominios locales, y demo en el navegador integrado al cerrar cada etapa.
