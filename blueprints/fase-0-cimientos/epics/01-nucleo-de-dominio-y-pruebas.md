# Epic 01: Núcleo de dominio y pruebas

> Al terminar existen Vitest 5, las librerías puras de dominio (errores, mensajes, fechas, dinero, permisos y contraseñas), la auditoría de solo inserción y la infraestructura de pruebas de integración contra Postgres real.

| | |
|---|---|
| **Epic id** | `01-nucleo-de-dominio-y-pruebas` |
| **Tasks** | `E1-T1` … `E1-T7` |
| **Depends on** | nothing — start here (el Bootstrap de §10 del blueprint ya se ejecutó) |
| **Unlocks** | `02-datos-interfaz-y-entrega` |
| **Parallel with** | ninguna (comparte `package.json` y `tests/` con la épica 2) |

You do not need any other file to complete this epic. Everything below is repeated here on purpose.

---

## Stack

Next.js 16.4.2 (App Router, Cache Components) · TypeScript 5.9.3 estricto (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `isolatedModules`) · Tailwind 4 + shadcn `base-nova` · PostgreSQL 16 (Docker) · Prisma 7.10.1 con `@prisma/adapter-pg` · Auth.js llega en la Fase 1 · hosting en la Fase 6.
Package manager: `pnpm` 12.15.0. Runtime: Node 24 (sin `.nvmrc`). Las versiones de las dependencias están en el lockfile: léelo, nunca adivines una. Estas versiones están congeladas y no se suben: `next`, `react`, `react-dom`, `prisma`, `@prisma/client`, `@prisma/adapter-pg`, `zod`, `tailwindcss`.

| Task | Command |
|---|---|
| Dev | `pnpm dev` (no se usa en esta épica) |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Format | `pnpm format` (reescribe) · `pnpm format:check` (solo comprueba) |
| Pruebas | `pnpm test:unit` · `pnpm test:integration` · `pnpm test:coverage` |
| Servicios locales | `pnpm db:up` / `pnpm db:down` |

**Gate:** `pnpm lint && pnpm exec eslint --max-warnings 0 && pnpm exec next typegen && pnpm typecheck && pnpm format:check && pnpm test` pasa antes de marcar hecha cualquier tarea de esta épica (`typegen` regenera los tipos de rutas de Next, que están en `.gitignore`).

La BD de Docker debe estar arriba (`pnpm db:up`) para toda verificación de integración: el archivo `docker-compose.yml` ya existe en la raíz; tú no lo escribes ni lo sustituyes por un falso. **Estado de partida (lo dejó el Bootstrap):** git tiene identidad de autor y de commit resoluble (el Bootstrap lo comprobó con `git var`; cada Checkpoint hace `git commit`); existe `.env` con `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, `TZ` y `DATABASE_URL_TEST` (la base `boutique_pos_test`, que debe terminar en `_test`); `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm exec next typegen`, `pnpm db:up` y `pnpm db:deploy` ya corrieron; y se copiaron estos archivos a su sitio: `vitest.config.ts`, `scripts/smoke-server.ts`, `tests/integration/global-setup.ts`, `tests/integration/helpers/db.ts`, `.claude/**`. `CLAUDE.md` y `AGENTS.md` ya llevan la marca `fase-0-blueprint`.

## Directory subtree

```
vitest.config.ts                     # existe (workspace): proyectos unit e integration, umbrales de money.ts
package.json                         # edit: dependencias y scripts (tareas 1 y 6)
docs/UX.md                           # edit: una línea (tarea 4)
src/
  config/messages.es.ts              # NEW (tarea 2)
  lib/
    env.ts  db.ts                    # existen, congelados, solo lectura
    errors.ts  action-result.ts      # NEW (tarea 2)
    dates.ts                         # NEW (tarea 3)
    money.ts                         # NEW (tarea 4), edit (tarea 5)
    format.ts                        # NEW (tarea 5)
    permissions.ts  password.ts      # NEW (tarea 6)
    audit.ts                         # NEW (tarea 7)
tests/
  unit/                              # env, errors, messages, dates, money, money-allocate, format, permissions, password
  unit/helpers/prng.ts               # NEW (tarea 5)
  integration/
    global-setup.ts                  # existe (workspace), solo lectura
    helpers/db.ts                    # existe (workspace), solo lectura: testDb, resetDatabase, closeDatabase, assertTestDatabaseUrl
    audit.test.ts                    # NEW (tarea 7)
prisma/schema.prisma  prisma/migrations/   # existen, congelados, solo lectura
```

Todo lo que no esté en este subárbol queda fuera de alcance. Si una tarea parece exigir editar un archivo que no figura aquí, detente y repórtalo: el límite de la épica está mal.

## Data model touched here

| Entity | Fields this epic adds or reads | Notes |
|---|---|---|
| `AuditLog` | escribe `userId?`, `action`, `entityType`, `entityId`, `before?`, `after?`, `reason?`, `ip?` | Solo inserción: la migración `constraints` tiene triggers `BEFORE UPDATE OR DELETE` que lanzan `La tabla "AuditLog" es de solo inserción: UPDATE no permitido` (o `DELETE`), SQLSTATE `restrict_violation` (23001). `userId` es FK opcional a `User` |
| `User` | crea filas de apoyo en las pruebas (`name`, `username` único, `passwordHash`, `role`) | solo para pruebas |
| todas las tablas de aplicación | `resetDatabase()` hace `TRUNCATE … RESTART IDENTITY CASCADE` (el TRUNCATE no dispara los triggers de fila); nunca toca `_prisma_migrations` | únicamente sobre una base `_test` |

El esquema y las migraciones están congelados: no los modifiques.

## Contracts

**Consumed** — ya existe, no lo reconstruyas:

| From | Interface | Guarantee |
|---|---|---|
| repo | `parseEnv(source): Env`, `env`, tipo `Env` en `src/lib/env.ts` | `parseEnv` lanza `Error` con `Variables de entorno inválidas:` y una línea `- <variable>: <mensaje>` por incidencia; mensajes propios: `AUTH_SECRET debe tener al menos 32 caracteres`, `DATABASE_URL debe ser una URL de PostgreSQL`; `TZ` por defecto `America/Tegucigalpa`; `NODE_ENV` por defecto `development` |
| repo | `db` en `src/lib/db.ts` | cliente Prisma con adapter-pg |
| workspace | `testDb`, `resetDatabase()`, `closeDatabase()`, `assertTestDatabaseUrl(url)` en `tests/integration/helpers/db.ts` | trabajan solo con una base cuyo nombre termine en `_test` |

**Produced** — las tareas posteriores y la épica 2 dependen de estas firmas exactas:

| Export | Signature | Used by |
|---|---|---|
| `src/lib/errors.ts` → `APP_ERROR_CODES`, `ErrorCode`, `AppError`, `ValidationError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`, `InsufficientStockError`, `CashSessionClosedError`, `FiscalRangeExhaustedError` | `class XError extends AppError { constructor(message?: string, options?: { cause?: unknown }) }`; `AppError` tiene `readonly code: ErrorCode`, `readonly status: number` | todas las tareas; épica 2 |
| `src/lib/action-result.ts` → `ActionResult<T>`, `ok`, `fail`, `toActionResult` | `toActionResult<T>(fn: () => Promise<T>, messages: ErrorMessages, onUnexpected?: (error: unknown) => void): Promise<ActionResult<T>>` | Fase 1 |
| `src/config/messages.es.ts` → `messages` | objeto `as const` (literal en la tarea 2) | épica 2 (shell, componentes, galería, E2E) |
| `src/lib/dates.ts` | `APP_TIME_ZONE`, `localDateKey(d)`, `startOfLocalDay(d)`, `endOfLocalDay(d)`, `addLocalDays(d, n)`, `formatLocalDateTime(d)` | fases posteriores |
| `src/lib/money.ts` | `Cents`, `assertCents`, `addCents`, `subCents`, `mulCents`, `sumCents`, `roundHalfAwayFromZero`, `percentOf`, `extractTax`, `allocate`, `prorateDiscount` | épica 2 y fases posteriores |
| `src/lib/format.ts` | `parseMoney(text): Cents \| null`, `formatMoney(cents): string`, `formatMoneyPlain(cents): string` | `MoneyInput` (épica 2) |
| `src/lib/permissions.ts` | `ROLES`, `Role`, `CAPABILITIES`, `Capability`, `ROLE_CAPABILITIES`, `MANAGER_PIN_OVERRIDES`, `hasCapability(role, cap)`, `requireCapability(actor, cap)`, `canManagerPinOverride(cap)` | Fase 1 |
| `src/lib/password.ts` | `hashSecret(plain): Promise<string>`, `verifySecret(hash, plain): Promise<boolean>` | semilla (épica 2) |
| `src/lib/audit.ts` | `AUDIT_ACTIONS`, `AuditAction`, `AuditEntry`, `audit.log(tx, entry)` | fases posteriores |

## Conventions that bite in this area

- **Dinero = enteros de centavos** (`Cents`). Nunca `parseFloat`, `toFixed` ni decimales. **Redondeo: mitad hacia afuera del cero, una sola vez por valor calculado.** `money.ts` no formatea; `format.ts` no calcula.
- Los tests importan con el alias `@/…` y de forma explícita desde `vitest` (`describe`, `expect`, `it`; no hay globals). Entre archivos de pruebas, rutas relativas. Nunca `.only` ni `.skip` (salvo `it.todo`).
- Vitest 5: `clearMocks` es `true` por defecto, la opción `sequential` no existe (el proyecto `integration` ya usa `fileParallelism: false`), Vitest no busca config en directorios padre y los reporters `json` y `junit` escriben archivos (no los uses).
- Cada archivo de integración cierra su cliente en `afterAll`: `closeDatabase()` si usa `testDb`, `db.$disconnect()` si usa `db` de `@/lib/db` (el proyecto `integration` fija `DATABASE_URL`). La integración usa únicamente la base `_test`.
- `tsconfig` tiene `noImplicitOverride` y `isolatedModules`: no uses `const enum` ambientales de paquetes; pasa valores numéricos.
- Antes de cada `Verify` corre `pnpm format`. Nunca `export const dynamic`, `revalidate` ni `fetchCache`.
- **Cero advertencias de ESLint:** el `Verify` de las siete tareas (`E1-T1` a `E1-T7`) corre además `pnpm exec eslint --max-warnings 0` justo después de `pnpm lint`: `pnpm lint` sale con 0 aunque haya advertencias y la puerta final no tolera ninguna.
- Los archivos de esta épica no importan nada de `src/components` ni de `src/app`.

Full project rules: `CLAUDE.md`. Area rules: `.claude/rules/money.md` (dinero) y `.claude/rules/tests.md` (pruebas). Both sit in the project root — the builder copied them there from the bundle's `workspace/` before task one.

---

## Tasks

Listed in the same order as `tasks.json`. That order is the build order — work top to bottom and do not re-rank by priority or by what looks quick.

### `E1-T1` — Instalar Vitest 5 y probar parseEnv

**Depends on:** nothing · **Priority:** p0 — metadata for scope cuts, not a running order

Instala Vitest 5 con sus pares y sube `@types/node` a la línea 24 (Vitest 5 exige `@types/node` `^22` o `>=24`; el repo trae `^20`). `vitest.config.ts` ya está en la raíz (dos proyectos, `unit` e `integration`). Define los cuatro scripts y escribe la prueba de `parseEnv` (cinco casos). `@/lib/env` evalúa `parseEnv(process.env)` al importarse: el proyecto `unit` define `test.env` con valores de relleno, así que no hace falta `.env`.

```bash
pnpm add -D -E vitest@5.0.5 @vitest/coverage-v8@5.0.5 vite@8.3.5 @types/node@24.19.2
npm pkg set scripts.test="vitest run" scripts.test:unit="vitest run --project unit" scripts.test:integration="vitest run --project integration" scripts.test:coverage="vitest run --project unit --coverage"
pnpm format
```

`tests/unit/env.test.ts`: importa `describe`, `expect`, `it` de `vitest` y `parseEnv` de `@/lib/env`. `validSource = { DATABASE_URL: "postgresql://u:p@localhost:5432/db", AUTH_SECRET: "x".repeat(32), APP_URL: "http://localhost:3000" }`. Casos: (a) `parseEnv(validSource)` devuelve `TZ` `America/Tegucigalpa` y `NODE_ENV` `development`; (b) sin `AUTH_SECRET` el error coincide con `/AUTH_SECRET/`; (c) con `AUTH_SECRET` de 31 caracteres coincide con `/AUTH_SECRET debe tener al menos 32 caracteres/`; (d) con `DATABASE_URL` `mysql://u:p@localhost/db` coincide con `/DATABASE_URL debe ser una URL de PostgreSQL/`; (e) con `APP_URL` `no-es-una-url` coincide con `/APP_URL/`. Esas cadenas son mensajes de `src/lib/env.ts`, no del motor de Zod.

**Files**
- `package.json` — edit: cuatro devDependencies exactas y cuatro scripts
- `tests/unit/env.test.ts` — new

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization defined in `agents/blueprint-writer.md` *Acceptance strings*. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `pnpm install --frozen-lockfile` corre después del paso **THE SYSTEM SHALL** terminar con código 0 sin modificar el lockfile.
2. **WHEN** `pnpm test:unit` corre **THE SYSTEM SHALL** terminar con código 0 ejecutando `tests/unit/env.test.ts` sin pruebas fallidas ni omitidas.
3. **WHEN** `parseEnv` recibe un origen válido **THE SYSTEM SHALL** devolver `TZ` igual a `America/Tegucigalpa` y `NODE_ENV` igual a `development` por defecto.
4. **WHEN** `parseEnv` recibe un origen sin `AUTH_SECRET`, con `AUTH_SECRET` de 31 caracteres, con `DATABASE_URL` que no es de PostgreSQL o con `APP_URL` inválida **THE SYSTEM SHALL** lanzar un error cuyo mensaje contiene el nombre de esa variable.
5. **WHEN** `pnpm lint`, `pnpm typecheck` y `pnpm format:check` corren con los archivos del workspace ya copiados **THE SYSTEM SHALL** terminar con código 0 en los tres.
6. **WHEN** `package.json` se lee **THE SYSTEM SHALL** declarar `vitest`, `@vitest/coverage-v8`, `vite` y `@types/node` con las versiones exactas de §11 y los scripts `test`, `test:unit`, `test:integration` y `test:coverage`.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm install --frozen-lockfile
pnpm test:unit
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm exec next typegen
pnpm typecheck
pnpm format:check
grep -qF '"vitest": "5.0.5"' package.json
grep -qF '"@vitest/coverage-v8": "5.0.5"' package.json
grep -qF '"vite": "8.3.5"' package.json
grep -qF '"@types/node": "24.19.2"' package.json
grep -qF '"test:integration": "vitest run --project integration"' package.json
test -f vitest.config.ts
status=0; grep -rnE '\.(skip|only)\(' tests/unit || status=$?; test "$status" -eq 1
```

These lines are this task's `verify` **array** in `tasks.json`, one per line, **copied with any exit-code wrapping intact**. A task is not done until the last one passes. `pnpm exec next typegen` regenera los tipos de rutas de Next (`.next/types`, `next-env.d.ts`; están en `.gitignore`) para que `pnpm typecheck` no pase solo porque quedaron archivos locales de una corrida anterior.

**Checkpoint**

```bash
git add -A && git commit -m "feat(fase-0): E1-T1 vitest"
git tag step-01-vitest
git ls-files --error-unmatch vitest.config.ts
git ls-files --error-unmatch scripts/smoke-server.ts
git ls-files --error-unmatch tests/integration/helpers/db.ts
git ls-files --error-unmatch .claude/settings.json
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts. The four `git ls-files` lines confirm, after the commit, that no ignore rule swallowed the workspace files.

### `E1-T2` — Errores tipados, ActionResult y mensajes es-HN

**Depends on:** `E1-T1` · **Priority:** p0 — metadata for scope cuts, not a running order

Crea la base de errores de negocio, el envelope de resultado de las server actions y el diccionario de textos. Todo texto visible de la fase sale de `messages.es.ts`.

`src/lib/errors.ts`: exporta `APP_ERROR_CODES` (tupla `as const`: `VALIDATION`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT`, `INSUFFICIENT_STOCK`, `CASH_SESSION_CLOSED`, `FISCAL_RANGE_EXHAUSTED`, en ese orden), el tipo `ErrorCode`, la clase `AppError extends Error` con `readonly code` y `readonly status` (constructor `(code, status, message, options?: { cause?: unknown })`; fija `this.name = new.target.name`) y las ocho subclases con constructor `(message = <por defecto>, options?)` que llaman `super(<code>, <status>, message, options)` (sin redeclarar campos: `noImplicitOverride`):

| Clase | code | status | mensaje por defecto (interno) |
|---|---|---|---|
| `ValidationError` | `VALIDATION` | 422 | Validation failed |
| `NotFoundError` | `NOT_FOUND` | 404 | Resource not found |
| `UnauthorizedError` | `UNAUTHORIZED` | 401 | Authentication required |
| `ForbiddenError` | `FORBIDDEN` | 403 | Not allowed |
| `ConflictError` | `CONFLICT` | 409 | Conflict with current state |
| `InsufficientStockError` | `INSUFFICIENT_STOCK` | 409 | Insufficient stock |
| `CashSessionClosedError` | `CASH_SESSION_CLOSED` | 409 | Cash session is closed |
| `FiscalRangeExhaustedError` | `FISCAL_RANGE_EXHAUSTED` | 409 | Fiscal range exhausted or expired |

`src/lib/action-result.ts`: `ActionErrorCode` (`ErrorCode | "UNEXPECTED"`), `ActionError = { code; message }`, `ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError }`, `ErrorMessages = Record<ActionErrorCode, string>`, `ok(data)`, `fail(code, message)` y `toActionResult(fn, messages, onUnexpected?)`: ante un `AppError` devuelve `fail(error.code, messages[error.code])`; ante cualquier otro error llama `onUnexpected(error)` (por defecto `console.error("Error inesperado en una acción", error)`) y devuelve `fail("UNEXPECTED", messages.UNEXPECTED)` sin el texto original.

`src/config/messages.es.ts` (literal; tuteo):

```ts
export const messages = {
  app: { name: "Boutique POS" },
  nav: { home: "Inicio" },
  common: {
    loading: "Cargando…",
    retry: "Reintentar",
    cancel: "Cancelar",
    confirm: "Confirmar",
    close: "Cerrar",
    skipToContent: "Saltar al contenido",
    toggleSidebar: "Mostrar u ocultar el menú",
  },
  home: {
    title: "Inicio",
    description: "Aquí verás el resumen de tu tienda cuando termines de configurarla.",
  },
  states: {
    notFound: {
      title: "No encontramos esa página",
      description: "Revisa la dirección o vuelve al inicio.",
      action: "Ir al inicio",
    },
    error: {
      title: "Algo salió mal",
      description: "No pudimos mostrar esta pantalla. Puedes intentarlo de nuevo.",
    },
    empty: {
      title: "Aún no hay nada por aquí",
      description: "Cuando agregues información aparecerá en esta lista.",
    },
  },
  errors: {
    VALIDATION: "Revisa los datos ingresados: hay campos incompletos o con formato incorrecto.",
    NOT_FOUND: "No encontramos lo que buscas. Puede que ya no exista.",
    UNAUTHORIZED: "Tu sesión terminó. Vuelve a iniciar sesión para continuar.",
    FORBIDDEN: "No tienes permiso para hacer esto. Pídele ayuda a un gerente.",
    CONFLICT: "Esto cambió mientras lo editabas. Actualiza la pantalla e inténtalo de nuevo.",
    INSUFFICIENT_STOCK:
      "No quedan suficientes prendas de este artículo. ¿Quieres ver otras tallas o colores?",
    CASH_SESSION_CLOSED: "Abre tu caja para empezar a vender.",
    FISCAL_RANGE_EXHAUSTED: "El rango de facturas se agotó o ya venció. Solicita uno nuevo al SAR.",
    UNEXPECTED:
      "Ocurrió un problema inesperado. Inténtalo de nuevo; si sigue pasando, avisa al administrador.",
  },
  dev: {
    gallery: {
      title: "Galería de componentes",
      description: "Solo para desarrollo: cada componente compartido en cada uno de sus estados.",
      money: { label: "Monto" },
      confirm: {
        open: "Abrir confirmación",
        title: "¿Quitar esta prenda?",
        description: "Esta acción no se puede deshacer.",
        confirm: "Quitar",
      },
      table: {
        loading: "Tabla: cargando",
        empty: "Tabla: sin datos",
        error: "Tabla: con error",
        rows: "Tabla: con datos",
        columnProduct: "Producto",
        columnPrice: "Precio",
        emptyAction: "Agregar producto de ejemplo",
        errorMessage: "No pudimos cargar los productos.",
        sampleDress: "Vestido floral",
        sampleBlouse: "Blusa de lino",
      },
    },
  },
} as const;
```

`tests/unit/errors.test.ts`: por cada clase de la tabla, `instanceof AppError` e `instanceof Error`, `code` y `status` exactos; los ocho `code` son distintos; `ok(5)` devuelve `{ ok: true, data: 5 }`; `toActionResult` con una función que lanza `new ForbiddenError()` devuelve `{ ok: false, error: { code: "FORBIDDEN", message: messages.errors.FORBIDDEN } }`; con una que lanza `new Error("secreto-interno")` devuelve `UNEXPECTED`, `messages.errors.UNEXPECTED`, y `JSON.stringify(resultado)` no contiene `secreto-interno` (pasa `onUnexpected` como `vi.fn()` y comprueba que se llamó). `tests/unit/messages.test.ts`: `Object.keys(messages.errors).sort()` es igual a `[...APP_ERROR_CODES, "UNEXPECTED"].sort()` y todo valor es una cadena no vacía.

**Files**
- `src/lib/errors.ts` — new
- `src/lib/action-result.ts` — new
- `src/config/messages.es.ts` — new
- `tests/unit/errors.test.ts` — new
- `tests/unit/messages.test.ts` — new

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization defined in `agents/blueprint-writer.md` *Acceptance strings*. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** cada clase de la tabla del paso se instancia **THE SYSTEM SHALL** cumplir `instanceof AppError` e `instanceof Error` y exponer el `code` y el `status` de la tabla.
2. **WHEN** `toActionResult` ejecuta una función que lanza un `AppError` **THE SYSTEM SHALL** devolver `{ ok: false, error: { code, message } }` con `message` tomado del diccionario inyectado para ese `code`.
3. **WHEN** `toActionResult` ejecuta una función que lanza un `Error` que no es `AppError` **THE SYSTEM SHALL** devolver el código `UNEXPECTED` con el mensaje del diccionario y SHALL NOT incluir el texto del error original.
4. **WHEN** `pnpm test:unit` corre **THE SYSTEM SHALL** probar que `messages.errors` tiene exactamente las claves de `APP_ERROR_CODES` más `UNEXPECTED`, todas con texto no vacío.
5. **WHEN** `pnpm lint`, `pnpm typecheck` y `pnpm format:check` corren al cerrar el paso **THE SYSTEM SHALL** terminar con código 0 en los tres.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:unit
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm typecheck
pnpm format:check
grep -qF 'export const APP_ERROR_CODES' src/lib/errors.ts
status=0; grep -rnE '\.(skip|only)\(' tests/unit || status=$?; test "$status" -eq 1
```

These lines are this task's `verify` **array** in `tasks.json`, one per line, copied with any exit-code wrapping intact.

**Checkpoint**

```bash
git add -A && git commit -m "feat(fase-0): E1-T2 errors-messages"
git tag step-02-errors-messages
git ls-files --error-unmatch src/config/messages.es.ts
```

### `E1-T3` — Helpers de fechas en America/Tegucigalpa

**Depends on:** `E1-T2` · **Priority:** p0 — metadata for scope cuts, not a running order

Honduras está en UTC−6 todo el año (sin horario de verano en 2025 a 2028). Los helpers se construyen sobre `Intl.DateTimeFormat#formatToParts`; **las cadenas se ensamblan a mano** y las pruebas nunca afirman cadenas producidas por la localización. Implementación: un `Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })` creado una vez; `zonedParts(date)` lee las partes por `type` y las convierte a número, **normalizando la hora `24` a `0`**; `offsetMs(date)` = `Date.UTC(partes locales)` menos el instante truncado al segundo; `startOfLocalDay` = `Date.UTC(año, mes−1, día)` menos `offsetMs` de ese instante; `endOfLocalDay(date)` = `startOfLocalDay(addLocalDays(date, 1))` menos 1 ms; `addLocalDays` = `date + days·86 400 000 ms` corregido por la diferencia de `offsetMs` entre origen y resultado; `localDateKey` → `YYYY-MM-DD`; `formatLocalDateTime` → `DD/MM/YYYY HH:mm` (24 h). Un `Date` inválido o `days` no entero lanza `ValidationError` de `@/lib/errors`.

`tests/unit/dates.test.ts` (literales derivados a mano con UTC−6; `2026-10-23T05:30:00.000Z` es 22/10 23:30 local y `2026-10-23T06:00:00.000Z` es 23/10 00:00 local): (a) `localDateKey` de `…05:30:00.000Z` = `2026-10-22`, de `2026-10-23T06:00:00.000Z` = `2026-10-23`, de `2026-10-23T05:59:59.999Z` = `2026-10-22`; (b) `startOfLocalDay` / `endOfLocalDay` de `2026-10-23T05:30:00.000Z` = `2026-10-22T06:00:00.000Z` / `2026-10-23T05:59:59.999Z`; (c) `addLocalDays(2026-10-22T20:15:00.000Z, 30)` = `2026-11-21T20:15:00.000Z`, con `-1` = `2026-10-21T20:15:00.000Z`, y `addLocalDays(2028-02-28T18:00:00.000Z, 1)` = `2028-02-29T18:00:00.000Z`; (d) `formatLocalDateTime` de `2026-10-23T06:00:00.000Z` = `23/10/2026 00:00`, de `2026-10-23T18:05:00.000Z` = `23/10/2026 12:05`, de `2026-01-01T00:00:00.000Z` = `31/12/2025 18:00`; (e) las cuatro funciones y `addLocalDays` lanzan `ValidationError` con `new Date("no-es-fecha")`.

**Files**
- `src/lib/dates.ts` — new
- `tests/unit/dates.test.ts` — new

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization defined in `agents/blueprint-writer.md` *Acceptance strings*. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `localDateKey` recibe `2026-10-23T05:30:00.000Z` **THE SYSTEM SHALL** devolver `2026-10-22` y para `2026-10-23T06:00:00.000Z` devolver `2026-10-23`.
2. **WHEN** `startOfLocalDay` y `endOfLocalDay` reciben `2026-10-23T05:30:00.000Z` **THE SYSTEM SHALL** devolver `2026-10-22T06:00:00.000Z` y `2026-10-23T05:59:59.999Z`.
3. **WHEN** `addLocalDays` recibe `2026-10-22T20:15:00.000Z` con 30 y con -1 **THE SYSTEM SHALL** devolver `2026-11-21T20:15:00.000Z` y `2026-10-21T20:15:00.000Z`.
4. **WHEN** `formatLocalDateTime` recibe `2026-10-23T06:00:00.000Z`, `2026-10-23T18:05:00.000Z` y `2026-01-01T00:00:00.000Z` **THE SYSTEM SHALL** devolver `23/10/2026 00:00`, `23/10/2026 12:05` y `31/12/2025 18:00`.
5. **WHEN** cualquier helper recibe un `Date` inválido **THE SYSTEM SHALL** lanzar `ValidationError`.
6. **WHEN** `pnpm lint`, `pnpm typecheck` y `pnpm format:check` corren al cerrar el paso **THE SYSTEM SHALL** terminar con código 0 en los tres.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:unit
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm typecheck
pnpm format:check
status=0; grep -rnE '\.(skip|only)\(' tests/unit || status=$?; test "$status" -eq 1
```

These lines are this task's `verify` **array** in `tasks.json`, one per line, copied with any exit-code wrapping intact.

**Checkpoint**

```bash
git add -A && git commit -m "feat(fase-0): E1-T3 dates"
git tag step-03-dates
```

### `E1-T4` — Núcleo de dinero: centavos, porcentaje e ISV

**Depends on:** `E1-T1`, `E1-T2` · **Priority:** p0 — metadata for scope cuts, not a running order

Primera mitad de `src/lib/money.ts`. **Política de redondeo, una sola vez: mitad hacia afuera del cero, aplicada una sola vez por valor calculado.** Toda función exige enteros seguros (`Number.isSafeInteger`); un decimal, `NaN`, `Infinity` o un entero fuera de rango lanza `ValidationError`. Exporta: tipo `Cents` (= `number`), `assertCents(value, label?)` (aserción de tipo), `addCents`, `subCents`, `mulCents(unitCents, quantity)` (cantidad entera; resultado entero seguro), `sumCents(values)` (`[]` suma 0), `roundHalfAwayFromZero(numerator, denominator)` (única función de redondeo, aritmética entera: signo aparte, cociente `q`, resto `r`, sube a `q + 1` cuando `2r >= denominador`; el producto previo debe ser entero seguro o lanza `ValidationError`), `percentOf(cents, bps)` (puntos base, 1000 = 10 %; = `roundHalfAwayFromZero(cents * bps, 10000)`) y `extractTax(totalCents, rateBps)` → `{ netCents, taxCents }` con `netCents = roundHalfAwayFromZero(totalCents * 10000, 10000 + rateBps)` y `taxCents = totalCents − netCents` (15 % = 1500 bps; `rateBps` entero no negativo). Ejemplo derivado a mano: total 1 226.00 L = 122 600 centavos → `netCents` 106 609 (1 226 000 000 / 11 500 = 106 608.69… → 106 609) y `taxCents` 15 991.

`tests/unit/money.test.ts`: `percentOf(10000, 1000)` = 1000; `percentOf(1999, 1000)` = 200; mitades `percentOf(5, 1000)` = 1, `percentOf(15, 1000)` = 2, `percentOf(25, 1000)` = 3, `percentOf(-25, 1000)` = -3; `extractTax(122600, 1500)` = `{ netCents: 106609, taxCents: 15991 }`; `extractTax(11500, 1500)` = `{ netCents: 10000, taxCents: 1500 }`; `extractTax(100, 1500)` = `{ netCents: 87, taxCents: 13 }`; `extractTax(0, 1500)` = `{ netCents: 0, taxCents: 0 }`; `extractTax(-122600, 1500)` = `{ netCents: -106609, taxCents: -15991 }`; `extractTax(5000, 0)` = `{ netCents: 5000, taxCents: 0 }`; `mulCents(65000, 1)` = 65000; `mulCents(32000, 2)` = 64000; `sumCents([])` = 0. Ticket de `docs/UX.md` §3: líneas 65000 y 2 × 32000 = 64000, subtotal 129000, descuento de línea `percentOf(64000, 1000)` = 6400, total 122600 y su `taxCents` 15 991. Rechazos (`ValidationError`): `addCents(0.5, 1)`, `percentOf(Number.NaN, 1000)`, `mulCents(Number.MAX_SAFE_INTEGER, 2)`, `extractTax(100, -1)`, `sumCents([1, Number.POSITIVE_INFINITY])`.

`docs/UX.md`: en el ticket de ejemplo de la sección 3 reemplaza exactamente `L   159.78│` por `L   159.91│` (con 15 % incluido, el ISV de 1 226.00 es 159.91; 159.78 era una inconsistencia aritmética).

Cobertura: `vitest.config.ts` ya fija, para el único archivo `src/lib/money.ts`, 100 % de líneas, 100 % de sentencias, 100 % de funciones y 95 % de ramas; `pnpm test:coverage` los hace cumplir. Cubre el camino negativo y el de mitad de `roundHalfAwayFromZero`.

**Files**
- `src/lib/money.ts` — new
- `tests/unit/money.test.ts` — new
- `docs/UX.md` — edit: una línea (`159.78` → `159.91`)

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization defined in `agents/blueprint-writer.md` *Acceptance strings*. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `percentOf(25, 1000)` y `percentOf(-25, 1000)` se llaman **THE SYSTEM SHALL** devolver `3` y `-3` (redondeo a la mitad alejándose de cero, aplicado una sola vez).
2. **WHEN** `extractTax(122600, 1500)` se llama **THE SYSTEM SHALL** devolver `{ netCents: 106609, taxCents: 15991 }`.
3. **WHEN** `extractTax(11500, 1500)` y `extractTax(100, 1500)` se llaman **THE SYSTEM SHALL** devolver `{ netCents: 10000, taxCents: 1500 }` y `{ netCents: 87, taxCents: 13 }`.
4. **WHEN** cualquier función de `src/lib/money.ts` recibe un valor que no es entero seguro (decimal, NaN, Infinity) **THE SYSTEM SHALL** lanzar `ValidationError`.
5. **WHEN** `pnpm test:coverage` corre **THE SYSTEM SHALL** terminar con código 0 cumpliendo por archivo para `src/lib/money.ts` 100 % de líneas, 100 % de sentencias, 100 % de funciones y 95 % de ramas.
6. **WHEN** `docs/UX.md` se lee **THE SYSTEM SHALL** mostrar el ISV del ejemplo del ticket como `159.91` y no `159.78`.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:unit
out=$(mktemp) && pnpm test:coverage > "$out" && grep -q 'money.ts' "$out"
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm typecheck
pnpm format:check
grep -qF '159.91' docs/UX.md
status=0; grep -qF '159.78' docs/UX.md || status=$?; test "$status" -eq 1
status=0; grep -rnE '\.(skip|only)\(' tests/unit || status=$?; test "$status" -eq 1
```

These lines are this task's `verify` **array** in `tasks.json`, one per line, copied with any exit-code wrapping intact. La segunda línea exige que `money.ts` aparezca en la tabla de cobertura: un umbral que no apunta a ningún archivo no mediría nada.

**Checkpoint**

```bash
git add -A && git commit -m "feat(fase-0): E1-T4 money-core"
git tag step-04-money-core
```

### `E1-T5` — Prorrateo, formato y lectura de dinero

**Depends on:** `E1-T4` · **Priority:** p0 — metadata for scope cuts, not a running order

Completa `src/lib/money.ts` con el reparto exacto de centavos y crea `src/lib/format.ts` (presentación). Sin dependencias nuevas (no `fast-check`).

`money.ts` añade `allocate(totalCents, weights)` y `prorateDiscount(lineTotals, discountCents)`. `allocate` usa el **método del mayor residuo**: total entero ≥ 0; pesos: arreglo no vacío de enteros seguros ≥ 0; total 0 → ceros; total > 0 con pesos que suman 0 → `ValidationError`; parte base `floor(total·peso / suma)` y resto `(total·peso) mod suma`, calculados con `BigInt(...)` (llamadas a la función, no literales `1n`: `tsconfig` apunta a ES2017); el sobrante `total − Σ partes base` se reparte de a 1 centavo a los índices de mayor resto, **empate al índice más bajo**; la suma de las partes es siempre el total. `prorateDiscount`: ceros si el descuento es 0; `ValidationError` si el descuento supera la suma de las líneas; si no, `allocate(discountCents, lineTotals)`; ninguna parte supera su línea.

`format.ts`: `parseMoney(text): Cents | null` — recorta espacios; prefijo opcional `L`/`l` con espacios; entero con comas de millares bien formadas o sin ellas; decimales opcionales de 1 o 2 dígitos (`.5` = 50 centavos, `.05` = 5); regex `/^(?:L\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/i`; `null` para todo lo demás (`12.345`, `abc`, vacío, negativos, `1,23`, `12.`) y para valores fuera del rango seguro. `formatMoney(cents)`: `L 1,234.50`; negativos `−L 64.00` con U+2212 (escrito `−` en código y pruebas); cero `L 0.00`; aritmética entera pura, sin `Intl` para números. `formatMoneyPlain(cents)`: sin símbolo ni comas (`1234.50`); para negativos antepone `-` ASCII. Ambas usan `assertCents`.

`tests/unit/helpers/prng.ts`: `mulberry32(seed: number): () => number` — `a = (a + 0x6d2b79f5) >>> 0; t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296`.

`tests/unit/money-allocate.test.ts` (literales a mano): `allocate(100, [1, 1, 1])` = `[34, 33, 33]`; `allocate(10, [1, 2, 3])` = `[2, 3, 5]` (bases 1, 3, 5; restos 4, 2, 0); `allocate(1, [1, 1, 1])` = `[1, 0, 0]`; `allocate(0, [5, 5])` = `[0, 0]`; `allocate(5, [0, 0, 1])` = `[0, 0, 5]`; `prorateDiscount([65000, 64000], 6400)` = `[3225, 3175]` (bases 3224 y 3175, restos 104 000 y 25 000). Propiedades con `mulberry32(20261023)` y 1000 casos cada una: `allocate` (total 0 a 10 000 000, 1 a 8 pesos entre 0 y 1 000 000 con al menos uno > 0): suma = total, ninguna parte negativa, cada parte es `floor(total·peso/suma)` o ese valor + 1; `prorateDiscount` (líneas aleatorias, descuento entre 0 y su suma): suma = descuento y cada parte ≤ su línea. Rechazos: `allocate(10, [0, 0])`, `allocate(-1, [1])`, `allocate(10, [])`, `prorateDiscount([100, 100], 201)`. `tests/unit/format.test.ts`: `parseMoney("1,234.50")` = 123450; `parseMoney("L 1,234.5")` = 123450; `parseMoney("1234")` = 123400; `parseMoney("L1234.05")` = 123405; `null` para `"12.345"`, `"abc"`, `""`, `"-5"`, `"1,23"`, `"12."`; `formatMoney(123450)` = `L 1,234.50`, `formatMoney(0)` = `L 0.00`, `formatMoney(5)` = `L 0.05`, `formatMoney(122600)` = `L 1,226.00`, `formatMoney(100000000)` = `L 1,000,000.00`, `formatMoney(-6400)` = `"−L 64.00"`; `formatMoneyPlain(123450)` = `1234.50`; propiedad: 1000 enteros de 0 a 10 000 000 000, `parseMoney(formatMoney(x))` = `x`; `formatMoney(1.5)` lanza `ValidationError`.

**Files**
- `src/lib/money.ts` — edit: añade `allocate` y `prorateDiscount`
- `src/lib/format.ts` — new
- `tests/unit/helpers/prng.ts` — new
- `tests/unit/money-allocate.test.ts` — new
- `tests/unit/format.test.ts` — new

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization defined in `agents/blueprint-writer.md` *Acceptance strings*. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `allocate(100, [1, 1, 1])`, `allocate(10, [1, 2, 3])` y `allocate(1, [1, 1, 1])` se llaman **THE SYSTEM SHALL** devolver `[34, 33, 33]`, `[2, 3, 5]` y `[1, 0, 0]`.
2. **WHEN** `prorateDiscount([65000, 64000], 6400)` se llama **THE SYSTEM SHALL** devolver `[3225, 3175]`.
3. **WHEN** las pruebas de propiedades corren con 1000 casos generados por mulberry32 con semilla fija **THE SYSTEM SHALL** cumplir en cada caso que la suma de las partes es igual al total, que ninguna parte es negativa, que cada parte de `prorateDiscount` no supera su línea y que `parseMoney(formatMoney(x))` devuelve `x`.
4. **WHEN** `parseMoney` recibe `1,234.50`, `L 1,234.5` y `1234` **THE SYSTEM SHALL** devolver `123450`, `123450` y `123400`, y **WHEN** recibe `12.345`, `abc` o una cadena vacía **THE SYSTEM SHALL** devolver `null`.
5. **WHEN** `formatMoney` recibe `123450`, `0`, `5` y `-6400` **THE SYSTEM SHALL** devolver `L 1,234.50`, `L 0.00`, `L 0.05` y `−L 64.00` (con U+2212), y `formatMoneyPlain(123450)` SHALL devolver `1234.50`.
6. **WHEN** `allocate` recibe pesos que suman cero con total mayor que cero, o `prorateDiscount` recibe un descuento mayor que la suma de líneas **THE SYSTEM SHALL** lanzar `ValidationError`, y **WHEN** `pnpm test:coverage` corre **THE SYSTEM SHALL** terminar con código 0 con los umbrales por archivo de `src/lib/money.ts` del paso 4.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:unit
out=$(mktemp) && pnpm test:coverage > "$out" && grep -q 'money.ts' "$out"
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm typecheck
pnpm format:check
status=0; grep -rnE '\.(skip|only)\(' tests/unit || status=$?; test "$status" -eq 1
```

These lines are this task's `verify` **array** in `tasks.json`, one per line, copied with any exit-code wrapping intact.

**Checkpoint**

```bash
git add -A && git commit -m "feat(fase-0): E1-T5 money-allocate-format"
git tag step-05-money-allocate-format
```

### `E1-T6` — Permisos por capacidades y hash de contraseñas

**Depends on:** `E1-T2` · **Priority:** p0 — metadata for scope cuts, not a running order

Define las capacidades y la matriz de roles y el hash Argon2id que usará la semilla. Instala la única dependencia nueva (`@node-rs/argon2`: binarios precompilados por plataforma, sin script de instalación, no necesita `allowBuilds`).

```bash
pnpm add -E @node-rs/argon2@2.2.2
```

`src/lib/permissions.ts`: `ROLES` (`OWNER`, `MANAGER`, `CASHIER`, `WAREHOUSE`; `as const`), tipo `Role`, `CAPABILITIES` (`as const`, las 17 capacidades de la tabla), tipo `Capability`, `ROLE_CAPABILITIES: Record<Role, ReadonlySet<Capability>>`, `MANAGER_PIN_OVERRIDES` (`["discount.applyBeyondLimit", "sale.void"] as const satisfies readonly Capability[]`), `hasCapability(role, capability)`, `requireCapability(actor: { role: Role }, capability)` (lanza `ForbiddenError`) y `canManagerPinOverride(capability)`. `src/lib/password.ts`: `hashSecret(plain)` y `verifySecret(hash, plain)` con `hash`/`verify` de `@node-rs/argon2`; `hashSecret` pasa `{ algorithm: 2, version: 1, memoryCost: 19456, timeCost: 2, parallelism: 1 }` (**números, no los `const enum` `Algorithm` y `Version`**: `isolatedModules` los prohíbe; 2 = Argon2id, 1 = versión 0x13); `verifySecret` devuelve `false` si `verify` lanza.

**Matriz literal** (✓ = el rol la tiene; – = no). `OWNER` las tiene todas:

| Capacidad | Fila del PRD §2 | OWNER | MANAGER | CASHIER | WAREHOUSE |
|---|---|:-:|:-:|:-:|:-:|
| `sale.create` | Vender / cobrar | ✓ | ✓ | ✓ | – |
| `discount.apply` | Descuento hasta el límite del cajero | ✓ | ✓ | ✓ | – |
| `discount.applyBeyondLimit` | Descuento sobre el límite (cajero: PIN de gerente) | ✓ | ✓ | – | – |
| `sale.void` | Anular venta (cajero: PIN de gerente) | ✓ | ✓ | – | – |
| `return.create` | Devoluciones / cambios | ✓ | ✓ | ✓ | – |
| `cash.open` | Abrir / cerrar caja propia | ✓ | ✓ | ✓ | – |
| `cash.closeApprove` | El gerente aprueba el cierre de caja (PRD §5; lista de ARCHITECTURE §5) | ✓ | ✓ | – | – |
| `cash.viewOthers` | Ver cierres de otros cajeros | ✓ | ✓ | – | – |
| `product.write` | Crear / editar productos | ✓ | ✓ | – | ✓ |
| `product.viewCost` | Ver costos y márgenes | ✓ | ✓ | – | – |
| `price.change` | Cambiar precios | ✓ | ✓ | – | – |
| `stock.adjust` | Ajustes de inventario | ✓ | ✓ | – | ✓ |
| `purchase.receive` | Recibir compras | ✓ | ✓ | – | ✓ |
| `report.financial` | Reportes financieros | ✓ | ✓ | – | – |
| `user.manage` | Usuarios y configuración | ✓ | – | – | – |
| `settings.manage` | Usuarios y configuración | ✓ | – | – | – |
| `audit.view` | Auditoría solo del Propietario | ✓ | – | – | – |

`tests/unit/permissions.test.ts`: la matriz como arreglo de filas `[capacidad, owner, manager, cashier, warehouse]` recorrida celda por celda con `expect(hasCapability(rol, capacidad)).toBe(esperado)`; las capacidades de la matriz son exactamente `CAPABILITIES` (igualdad de conjuntos); `requireCapability({ role: 'CASHIER' }, 'product.viewCost')` lanza `ForbiddenError`; `requireCapability({ role: 'OWNER' }, 'user.manage')` no lanza; `requireCapability({ role: 'WAREHOUSE' }, 'stock.adjust')` no lanza; `MANAGER_PIN_OVERRIDES` contiene `discount.applyBeyondLimit` y `sale.void`, ambas en `MANAGER` y `OWNER` y no en `CASHIER`; `canManagerPinOverride` verdadera para esas dos y falsa para `product.viewCost`; `ROLES` ordenado igual a `Object.values(Role)` del enum de Prisma importado de `@/generated/prisma/enums` (TypeScript puro, sin conexión); una línea `// @ts-expect-error capacidad inexistente` sobre `hasCapability("OWNER", "capacidad.inexistente")` (en ejecución devuelve `false`). `tests/unit/password.test.ts`: `hashSecret("Demo-Cajero-2026")` distinto del texto y empieza con `$argon2id$`; `verifySecret` acepta el texto correcto y rechaza otro; dos hashes del mismo texto son distintos; `verifySecret("no-es-un-hash", "x")` es `false`.

**Files**
- `package.json` — edit: dependencia `@node-rs/argon2` exacta
- `src/lib/permissions.ts` — new
- `src/lib/password.ts` — new
- `tests/unit/permissions.test.ts` — new
- `tests/unit/password.test.ts` — new

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization defined in `agents/blueprint-writer.md` *Acceptance strings*. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `hasCapability(rol, capacidad)` se evalúa para cada celda de la matriz del paso **THE SYSTEM SHALL** devolver exactamente el valor de la tabla.
2. **WHEN** `requireCapability({ role: 'CASHIER' }, 'product.viewCost')` se llama **THE SYSTEM SHALL** lanzar `ForbiddenError`, y **WHEN** se llama con `{ role: 'OWNER' }` y `'user.manage'` **THE SYSTEM SHALL** no lanzar.
3. **WHEN** `MANAGER_PIN_OVERRIDES` se evalúa **THE SYSTEM SHALL** contener `discount.applyBeyondLimit` y `sale.void`, y cada una SHALL estar en los conjuntos de `MANAGER` y `OWNER` y ausente del de `CASHIER`.
4. **WHEN** `pnpm typecheck` corre **THE SYSTEM SHALL** terminar con código 0 gracias a que `hasCapability('OWNER', 'capacidad.inexistente')` produce un error de tipos marcado con `@ts-expect-error`.
5. **WHEN** `hashSecret('Demo-Cajero-2026')` se llama **THE SYSTEM SHALL** devolver un hash distinto del texto plano que empieza con `$argon2id$`, que `verifySecret` acepta con el texto correcto y rechaza con otro, y **WHEN** `verifySecret` recibe un hash malformado **THE SYSTEM SHALL** devolver `false`.
6. **WHEN** `pnpm test:unit` corre **THE SYSTEM SHALL** comprobar que `ROLES` es igual al conjunto de valores del enum `Role` generado por Prisma.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm install --frozen-lockfile
pnpm test:unit
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm typecheck
pnpm format:check
grep -qF '"@node-rs/argon2": "2.2.2"' package.json
status=0; grep -rnE '\.(skip|only)\(' tests/unit || status=$?; test "$status" -eq 1
```

These lines are this task's `verify` **array** in `tasks.json`, one per line, copied with any exit-code wrapping intact.

**Checkpoint**

```bash
git add -A && git commit -m "feat(fase-0): E1-T6 permissions-password"
git tag step-06-permissions-password
```

### `E1-T7` — Auditoría y pruebas de integración con Postgres

**Depends on:** `E1-T1` · **Priority:** p0 — metadata for scope cuts, not a running order

Primer paso que toca la capa de datos. Escribe `audit.log` y su prueba de integración, que ejercita la infraestructura ya presente: la base `boutique_pos_test`, `DATABASE_URL_TEST` en `.env`, `tests/integration/global-setup.ts` (aplica `prisma migrate deploy` a la base de pruebas antes del proyecto `integration`) y `tests/integration/helpers/db.ts` (`testDb`, `resetDatabase()`, `closeDatabase()`, `assertTestDatabaseUrl`). Esos helpers se niegan a trabajar con una base cuyo nombre no termine en `_test`, porque `resetDatabase()` hace `TRUNCATE` de todas las tablas. La BD de Docker debe estar arriba (`pnpm db:up`).

`src/lib/audit.ts`: `AUDIT_ACTIONS` (`as const`: `SALE_VOIDED`, `DISCOUNT_OVERRIDE`, `STOCK_ADJUSTED`, `PRICE_CHANGED`, `COST_CHANGED`, `CASH_SESSION_CLOSED`, `PERMISSION_CHANGED`), tipo `AuditAction`, `AuditEntry` (`{ userId?: string | null; action: AuditAction; entityType: string; entityId: string; before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue; reason?: string; ip?: string }`) y el objeto `audit` con `log(tx, entry)`, donde `tx` es `Pick<Prisma.TransactionClient, "auditLog">` (`Prisma` de `@/generated/prisma/client`); `log` hace `tx.auditLog.create` con los campos de la entrada.

`tests/integration/audit.test.ts`: `beforeEach(resetDatabase)`, `afterAll(closeDatabase)`; un `User` de apoyo con `testDb.user.create` (`name`, `username` único, `passwordHash: "x"`, `role: "OWNER"`). Casos: (a) dentro de `testDb.$transaction(async (tx) => audit.log(tx, {...}))` con `userId`, `action` `SALE_VOIDED`, `entityType` `Sale`, `entityId` `sale-1`, `reason` `Cliente devolvió la prenda`, `before` `{ status: 'COMPLETED' }`, `after` `{ status: 'VOIDED' }`: tras confirmar existe una fila con esos valores; (b) la misma llamada seguida de `throw new Error("rollback")`: `rejects.toThrow("rollback")` y cero filas con `entityId` `sale-1`; (c) `testDb.$executeRaw` de `UPDATE "AuditLog" SET "reason" = 'x'` y de `DELETE FROM "AuditLog"` rechazan con un error cuyo texto serializado (mensaje, `code`, `meta` y `cause` recorridos, con una función auxiliar `errorText(error)` del propio test) coincide con `/solo inserción|23001/`, y la fila conserva su `reason`; (d) tras insertar filas, `resetDatabase()` deja `AuditLog` y `User` vacíos y `_prisma_migrations` intacta (`SELECT count(*)` mayor que 0 antes y después); (e) `assertTestDatabaseUrl("postgresql://u:p@localhost:5432/boutique_pos")` lanza y `assertTestDatabaseUrl("postgresql://u:p@localhost:5432/boutique_pos_test")` no; (f) una prueba que define `const attempt = (): Promise<void> =>` seguida de `// @ts-expect-error acción fuera de AuditAction` y, en la línea siguiente, `audit.log(testDb, { action: "ACCION_INVENTADA", entityType: "X", entityId: "1" });` (`attempt` nunca se invoca; la prueba solo comprueba `typeof attempt` igual a `function`).

**Files**
- `src/lib/audit.ts` — new
- `tests/integration/audit.test.ts` — new

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization defined in `agents/blueprint-writer.md` *Acceptance strings*. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `audit.log(tx, entry)` corre dentro de `testDb.$transaction` y la transacción confirma **THE SYSTEM SHALL** persistir una fila de `AuditLog` con los mismos `userId`, `action`, `entityType`, `entityId`, `reason`, `before` y `after`.
2. **WHEN** la transacción lanza un error después de `audit.log` **THE SYSTEM SHALL** dejar cero filas de `AuditLog` para ese `entityId`.
3. **WHEN** un `UPDATE` o un `DELETE` crudo se ejecuta sobre `AuditLog` **THE SYSTEM SHALL** rechazarlo con un error cuyo texto coincide con `solo inserción` o con el código `23001` y dejar la fila intacta.
4. **WHEN** `resetDatabase()` corre **THE SYSTEM SHALL** vaciar todas las tablas de la aplicación sin tocar `_prisma_migrations`, y `assertTestDatabaseUrl` SHALL lanzar un error cuando el nombre de la base no termina en `_test`.
5. **WHEN** `pnpm typecheck` corre **THE SYSTEM SHALL** terminar con código 0 gracias a que una acción fuera de `AuditAction` en `tests/integration/audit.test.ts` produce un error de tipos marcado con `@ts-expect-error`.
6. **WHEN** `pnpm test:integration` corre contra `DATABASE_URL_TEST` **THE SYSTEM SHALL** aplicar las migraciones con `globalSetup` y terminar con código 0.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:integration
pnpm test:unit
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm typecheck
pnpm format:check
status=0; grep -rnE '\.(skip|only)\(' tests/integration || status=$?; test "$status" -eq 1
```

These lines are this task's `verify` **array** in `tasks.json`, one per line, copied with any exit-code wrapping intact.

**Checkpoint**

```bash
git add -A && git commit -m "feat(fase-0): E1-T7 audit-integration"
git tag step-07-audit-integration
git ls-files --error-unmatch tests/integration/audit.test.ts
```

---

## Epic acceptance

The epic is done when every task is `done` **and**:

1. **WHEN** `pnpm test` corre sobre la base de pruebas **THE SYSTEM SHALL** ejecutar los proyectos `unit` e `integration` sin pruebas fallidas ni omitidas.
2. **WHEN** `pnpm test:coverage` corre **THE SYSTEM SHALL** cumplir los umbrales por archivo de `src/lib/money.ts`; y un `UPDATE` sobre `AuditLog` **SHALL** seguir siendo rechazado por el trigger.

```bash
pnpm lint && pnpm exec eslint --max-warnings 0 && pnpm exec next typegen && pnpm typecheck && pnpm format:check && pnpm test
out=$(mktemp) && pnpm test:coverage > "$out" && grep -q 'money.ts' "$out"
```

Run from the project root. Both criteria must be decidable by these commands.

## Pitfalls

- **El umbral de cobertura que no mide nada** — si `money.ts` no aparece en la tabla de `test:coverage`, el umbral no apunta a ningún archivo. La verificación lo detecta con `grep -q 'money.ts'`; no la quites.
- **`@/lib/env` falla al importarse sin variables** — en el proyecto `unit` lo evitan los valores de relleno de `vitest.config.ts`; no pongas valores reales en las pruebas ni crees un `.env` de pruebas.
- **`TRUNCATE` sobre la base equivocada** — nunca lo ejecutes contra `DATABASE_URL`. Los helpers lo impiden con el sufijo `_test`; no los saltes.
- **Redondear dos veces** — `extractTax` redondea una sola vez (`netCents`) y obtiene el impuesto por resta; no redondees `taxCents` por separado.
- **`const enum` de `@node-rs/argon2`** — con `isolatedModules: true` usar `Algorithm.Argon2id` falla; usa los números `2` y `1`.
- **`ERR_PNPM_IGNORED_BUILDS`** — si `pnpm add` lo lanza, lee el paquete del error; solo si necesita su script añade `<paquete>: true` a `allowBuilds` de `pnpm-workspace.yaml` y anótalo; nunca `dangerouslyAllowAllBuilds`. El repo ya decide `prisma`, `@prisma/engines` y `esbuild` (todos `false`, commit `6ea1527`) y las dependencias de esta épica no necesitan entradas nuevas.
- **Aviso de Vite en cada corrida de Vitest** — «(!) Your Vite config uses features that are unsupported by `configLoader: 'native'` … ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1)» es esperado e inocuo (la corrida sale con 0): no renombres `vitest.config.ts` ni añadas `"type": "module"` a `package.json`.

## Before moving on

- [ ] Every task in this epic is `done` in `tasks.json` — no task left `in_progress`.
- [ ] Every `verify` command of every task in this epic passed, not just the first one.
- [ ] No `verify` command was edited, and none was skipped because a file it names did not exist.
- [ ] **Every task in this epic has its `checkpoint` tag in version control** — one tag per task, matching the `checkpoint` value in `tasks.json`. `git tag -l 'step-*'` lists them.
- [ ] Gate command passes clean, run from the project root.
- [ ] Every "Produced" contract above exists with the stated signature.
- [ ] No file outside the subtree was modified.
- [ ] `.env.example` no cambió en esta épica (el Bootstrap ya añadió `DATABASE_URL_TEST`).
- [ ] One commit per task, each message `feat(fase-0): <task id> <slug>`, each followed by its checkpoint tag.
