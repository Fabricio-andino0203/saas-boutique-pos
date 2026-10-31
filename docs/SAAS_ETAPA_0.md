# SaaS multi-negocio — Etapa 0: informe de la prueba de concepto

> Rama `saas/etapa-0`. Propuesta completa y aprobada: [`SAAS_PROPUESTA.md`](SAAS_PROPUESTA.md). Esta etapa **no cambia ninguna regla de negocio**: solo cambia cómo se obtiene la conexión a la base de datos y comprueba, con el sistema real, que la arquitectura de "una base por negocio" funciona.

## Veredicto

**La arquitectura propuesta es viable y no hay que reescribir el sistema.** Todo lo que se quería confirmar quedó confirmado con pruebas; lo que salió mal se encontró y se corrigió en la propia etapa (sección 5). Recomendación: **seguir con la Etapa 1** (plano de control).

## 1. Qué se construyó (poco código, mucho efecto)

| Pieza | Archivo | Para qué |
| --- | --- | --- |
| Resolutor `db` | `src/lib/db.ts`, `src/lib/tenancy/resolver.ts` | `db` ya no es un cliente fijo: **elige la base del negocio actual en cada llamada**. Los 108 servicios que escriben `client = db` no cambian |
| Contexto | `src/lib/tenancy/tenant-context.ts` | `runWithTenant` (procesos y pruebas), negocio predeterminado explícito solo fuera de peticiones web, error `TenantContextError` |
| Directorio de hosts | `src/lib/tenancy/directory.ts` | host → negocio. En la Etapa 0 es una tabla fija; en la Etapa 1 será la base central |
| Administrador de conexiones | `src/lib/tenancy/tenant-clients.ts` | un pool pequeño por negocio, expulsión del menos usado, **nunca cierra un cliente con operaciones en curso** |
| Aprovisionamiento de bajo nivel | `src/lib/tenancy/provision-db.ts` | rol + base (desde plantilla) + permisos mínimos + deshacer |
| Barrera del host | `src/proxy.ts` | un host que no es de ningún negocio recibe 404 en **todas** las rutas |
| Esqueleto de la base central | `prisma/control/` | segundo esquema Prisma con su configuración, migraciones y cliente (`--config`) |
| Pruebas | `tests/integration/tenancy.test.ts` (13), `tests/unit/architecture.test.ts` (+4), `tests/integration/setup-tenant.ts` | aislamiento y reglas de arquitectura |
| Guiones de la prueba | `scripts/poc/*.ts` | aprovisionar dos negocios de demostración y probar PgBouncer |

Modos (`TENANCY_MODE`): **`single`** (por omisión) es el comportamiento de hoy —una sola base—; **`multi`** es el SaaS: **falla cerrado**, sin negocio no hay base de datos.

## 2. Lo que se comprobó

| Pregunta de la propuesta | Resultado |
| --- | --- |
| ¿Se puede sustituir `db` sin tocar la lógica? | **Sí.** Las 970 pruebas existentes pasan sin cambiar su lógica (modo `single`) y **las 42 de integración (576 pruebas) pasan en modo estricto `multi`** |
| ¿Resolutor o servidor personalizado de Next? | **Resolutor.** Funciona en páginas (RSC), acciones del servidor (el inicio de sesión), `proxy` y rutas (`/api/health`). No hace falta reemplazar `next start` |
| ¿Dos negocios con **los mismos identificadores** se ven entre sí? | **No.** Mismos ids de producto, usuario y sesión en las dos bases: cada una devuelve lo suyo; un token de A no existe en B; 300 operaciones intercaladas sin cruces |
| ¿Funciona el motor de ventas real en dos negocios a la vez? | **Sí.** Misma solicitud de cobro en los dos: cada uno numera `T-000001`, descuenta su propio inventario, los reintentos se reconocen y `verifyBooks` queda limpio en ambos |
| ¿Aislamiento a nivel de base de datos? | **Sí.** El rol de A **no puede ni conectarse** a la base de B; el rol de la aplicación solo tiene permisos de datos: `CREATE`, `DROP` y `ALTER` son rechazados |
| ¿Límites por negocio? | Cada rol tiene su `CONNECTION LIMIT` (10) y `statement_timeout` (60 s), verificados en `pg_roles` |
| ¿Administrador de conexiones? | Con tope de 2 negocios abiertos y 6 usos: 6 aperturas y 4 cierres, sin pasar el tope; **un negocio con una transacción abierta no se cierra** aunque otro pida lugar |
| ¿Prisma maneja un segundo esquema? | **Sí.** `prisma generate`, `migrate dev` y `migrate deploy` con `--config prisma/control/prisma.config.ts` generan un cliente propio (`src/generated/control`) y migraciones propias |
| ¿PgBouncer en modo transacción? | **Sí.** 50 cobros simultáneos del motor real (candados `pg_advisory_xact_lock`, transacciones interactivas, reintentos): 45 ventas creadas, **0 rechazos**, libros exactos, igual que directo (≈ 1,0–1,2 s contra 1,4–1,9 s directo) |
| ¿Cuánto cuesta crear un negocio? | Migrar la **plantilla** tarda **8,9 s una sola vez**; crear la base de cada negocio **desde la plantilla tarda 0,17–0,23 s** (migrar cada una: ≈ 9 s) |
| ¿Recorrido real en el navegador? | **Sí.** `a.localhost` y `b.localhost`: el mismo usuario `dueno` con contraseñas distintas; la contraseña de B se rechaza en A; cada uno ve su propio nombre de negocio; B no hereda la sesión de A; un host desconocido recibe 404; un `X-Forwarded-Host` falso se ignora |

## 3. Decisiones que quedan tomadas

1. **Mecanismo:** `db` resolutor (JS `Proxy` + `AsyncLocalStorage` para procesos/pruebas + el `Host` validado para peticiones web). Sin servidor personalizado.
2. **Permisos:** la cuenta de aprovisionamiento es dueña de la base y corre las migraciones; **cada negocio tiene un rol de aplicación con solo SELECT/INSERT/UPDATE/DELETE** (mejor que el plan original, donde el rol era dueño). Los permisos de las tablas futuras se heredan con `ALTER DEFAULT PRIVILEGES`.
3. **Aprovisionar desde plantilla** (`CREATE DATABASE … TEMPLATE`) y luego `prisma migrate deploy` por si hay migraciones nuevas.
4. **PgBouncer es compatible** y queda como opción para la Etapa 6 (para muchos negocios se necesita `auth_query`, porque cada negocio tiene su propio rol).
5. El negocio de una petición web sale **únicamente del `Host`**; el negocio predeterminado del proceso **nunca** se usa dentro de una petición, y una prueba de arquitectura impide usarlo desde el código de la aplicación.

## 4. Cifras que importan

- **Cambios al código de la aplicación: 2 archivos** (`src/lib/db.ts` y `src/proxy.ts`); el resto es código nuevo en `src/lib/tenancy/`. Ninguna regla de ventas, inventario, caja, devoluciones ni reportes se tocó.
- **Crear un negocio:** 0,17–0,23 s desde la plantilla (plantilla migrada una vez: 8,9 s).
- **50 cobros simultáneos** a través de PgBouncer (modo transacción): 45 ventas, 0 rechazos, libros exactos.
- **300 operaciones intercaladas** entre 3 negocios con los mismos identificadores: 0 cruces.
- **Costo en el camino de cada consulta:** el resolutor agrega una resolución del negocio por llamada (un acceso a un mapa en memoria); las medidas existentes de la suite de carga (búsqueda, escaneo y venta) siguen dentro de sus límites.

## 5. Problemas encontrados y corregidos en esta etapa

| Hallazgo | Corrección |
| --- | --- |
| El `proxy` exentaba `/login` y `/api/health` de la validación del host: un host desconocido recibía la página de entrada | La validación del host se aplica a **todas** las rutas (menos recursos estáticos); solo `/api/health` queda a nivel de plataforma |
| Fijar el negocio de las pruebas con `AsyncLocalStorage.enterWith` no llega a los ganchos `beforeAll`/`afterAll` (81 fallos en modo estricto) | Negocio predeterminado **explícito del proceso** (`setProcessDefaultTenant`), solo fuera de peticiones web |
| `createTemplateDatabase` no era repetible: no puede borrar una plantilla ya marcada como tal | Se le quita la marca antes de borrar |
| Dos sesiones de trabajo corriendo la suite a la vez contra la misma base de pruebas se pisan (`User_username_key`) | No es del diseño: cada ejecución necesita su base. Para CI y para trabajo en paralelo se usa una base de pruebas por ejecución |
| `/api/health` en modo `multi` depende del negocio del host (un host desconocido da 503) | Pendiente de la Etapa 2: salud de plataforma (base central + administrador de conexiones) separada de la de cada negocio |

## 6. Verificación

| Comprobación | Resultado |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | En verde |
| Suite completa en modo `single` (el de hoy, con el resolutor en medio) | **75 archivos, 987 pruebas, todas pasan** (970 existentes + 13 de aislamiento + 4 de arquitectura) |
| Suite de integración en modo estricto `multi` (sin base por defecto, negocio de proceso fijo) | **42 archivos, 576 pruebas, todas pasan** |
| E2E completo (compilación de producción, base E2E aparte) | **88 pasan, 0 fallan** |
| Recorrido en el navegador con `a.localhost` y `b.localhost` | Aislamiento de usuarios, sesiones, datos y host desconocido (404) comprobado a mano |
| PgBouncer (modo transacción) con 50 cobros simultáneos | 45 creadas, 0 rechazos, libros cuadrados |
| Prisma con segunda configuración (`--config`) | `generate`, `migrate dev` y `migrate deploy` funcionan |

Las pruebas de la Etapa 0 se corren con `pnpm exec vitest run tests/integration/tenancy.test.ts` (necesitan el servidor Postgres de desarrollo con una cuenta que pueda crear roles y bases, como la de `DATABASE_URL_TEST`).

## 7. Pendiente para las etapas siguientes (no bloquea)

- `TENANCY_MODE` y `TENANT_POC_DIRECTORY` pasan a `src/lib/env.ts` con validación (Etapa 2).
- Clave del limitador de intentos y registro (`logger`) con el id del negocio (Etapa 2).
- Los scripts (`create-owner`, `db:verify`, `job:expire-layaways`…) reciben `--tenant` (Etapa 2/3).
- Dos páginas (`vender`, `apartados/[id]`) importan `db` directamente; se corrigen al tocarlas.
- `next dev` con `*.localhost` puede requerir `allowedDevOrigins` (la prueba se hizo con `next start`).
- Credenciales por negocio cifradas con llave maestra en la base central (Etapa 1); hoy la URL viaja en el directorio de la prueba.
