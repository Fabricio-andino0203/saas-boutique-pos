# Epic 02: Datos, interfaz y entrega

> Al terminar existen la semilla mínima, `/api/health` servido de verdad, los tokens y el shell de la aplicación, los cinco componentes compartidos con su galería, las pruebas E2E, el test del invariante de stock, los documentos al día y el CI.

| | |
|---|---|
| **Epic id** | `02-datos-interfaz-y-entrega` |
| **Tasks** | `E2-T1` … `E2-T9` |
| **Depends on** | `01-nucleo-de-dominio-y-pruebas` |
| **Unlocks** | la Fase 1 (acceso, configuración y catálogo) |
| **Parallel with** | ninguna (comparte `package.json` y `tests/` con la épica 1) |

You do not need any other file to complete this epic. Everything below is repeated here on purpose.

---

## Stack

Next.js 16.4.2 (App Router, Cache Components: `cacheComponents: true` y `partialPrefetching: true` en `next.config.ts`) · TypeScript 5.9.3 estricto · Tailwind 4.3.3 (config en CSS) + shadcn `base-nova` sobre Base UI · PostgreSQL 16 · Prisma 7.10.1 con `@prisma/adapter-pg` · Auth.js llega en la Fase 1 · hosting en la Fase 6.
Package manager: `pnpm` 12.15.0. Runtime: Node 24. Las versiones están en el lockfile: léelo, nunca adivines una. Congeladas (no se suben): `next`, `react`, `react-dom`, `prisma`, `@prisma/client`, `@prisma/adapter-pg`, `zod`, `tailwindcss`.

**AGENTS.md exige leer la guía de Next antes de escribir código de Next:** está en `node_modules/.pnpm/next@16.4.2_*/node_modules/next/dist/docs/` (este Next difiere de lo que recuerdas).

| Task | Command |
|---|---|
| Dev | `pnpm dev` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Format | `pnpm format` (reescribe) · `pnpm format:check` |
| Pruebas | `pnpm test:unit` · `pnpm test:integration` · `pnpm test` · `pnpm test:coverage` · `pnpm test:e2e` |
| Humo del servidor | `pnpm exec tsx scripts/smoke-server.ts <start\|dev> <puerto> <ruta=estado[:texto]>...` |
| Servicios locales | `pnpm db:up` / `pnpm db:down` |

**Gate:** `pnpm lint && pnpm exec eslint --max-warnings 0 && pnpm exec next typegen && pnpm typecheck && pnpm format:check && pnpm test` pasa antes de marcar hecha cualquier tarea (`typegen` regenera los tipos de rutas de Next, que están en `.gitignore`).

La BD de Docker debe estar arriba para toda verificación de integración y de servidor; `docker-compose.yml` ya existe en la raíz (tú no lo escribes ni lo sustituyes por un falso). `scripts/smoke-server.ts` ya está en su sitio: arranca `next start` (o `next dev`) en el puerto dado, espera a que responda, pide cada `ruta=estado[:texto]` (el texto es una subcadena que debe aparecer en el cuerpo), mata el árbol de procesos al terminar y sale con 1 si algo no coincide.

## Directory subtree

```
package.json                          # edit: tareas 1, 3 y 7
playwright.config.ts                  # NEW: se copia desde el bundle en la tarea 7
scripts/smoke-server.ts               # existe (workspace), solo lectura
prisma/
  seed.ts                             # NEW (tarea 1)
  seed/run-seed.ts                    # NEW (tarea 1)
  schema.prisma  migrations/          # existen, congelados, solo lectura
docs/DATA_MODEL.md  ARCHITECTURE.md   # edit (tarea 8)
README.md  CLAUDE.md                  # edit (tarea 9)
.github/workflows/ci.yml              # NEW (tarea 9)
src/
  app/
    layout.tsx                        # edit (tarea 4): Inter
    globals.css                       # edit (tarea 4): tokens
    loading.tsx  error.tsx  not-found.tsx        # NEW (tarea 5)
    (app)/layout.tsx                  # NEW (tarea 5)
    (app)/page.tsx                    # NEW (tarea 5): se mueve desde src/app/page.tsx con git mv
    (app)/dev/componentes/page.tsx    # NEW (tarea 7): galería solo de desarrollo
    api/health/route.ts               # NEW (tarea 2)
  components/
    ui/                               # shadcn: button existe; la tarea 3 añade nueve primitivas
    shared/                           # NEW (tarea 6): page-header, empty-state, confirm-dialog, money-input, data-table
  hooks/use-mobile.ts                 # NEW (tarea 3, lo copia el CLI)
  lib/health.ts                       # NEW (tarea 2)
  lib/{env,db,errors,action-result,dates,money,format,permissions,password,audit}.ts   # existen (épica 1), solo lectura
  config/messages.es.ts               # existe (épica 1), solo lectura
tests/
  unit/                               # architecture.test.ts, ci-workflow.test.ts, password.test.ts (existe)...
  integration/                        # seed.test.ts, health.test.ts, invariants.test.ts, helpers/invariants.ts
  e2e/                                # shell.spec.ts, components.spec.ts
```

Todo lo que no esté en este subárbol queda fuera de alcance. Si una tarea parece exigir editar un archivo que no figura aquí, detente y repórtalo.

## Data model touched here

| Entity | Fields this epic adds or reads | Notes |
|---|---|---|
| `User` | upsert por `username` único: `name`, `role`, `passwordHash`, `pinHash`, `isActive` | la semilla solo escribe hashes al crear |
| `Location` | upsert por `code` único: `name`, `isDefault`, `type` | `MAIN`, `STORE` |
| `Terminal` | `name`, `locationId`, `isActive` | sin unicidad en BD: se busca por nombre y ubicación |
| `Size`, `Color`, `Category` | `Size.name` único, `group`, `sortOrder`; `Color.name` único, `hex`, `sortOrder`; `Category.slug` único, `parentId` | `Category` es jerárquica |
| `BusinessProfile` | `legalName` | se crea solo si no hay ninguna fila |
| `Setting` | `key` único, `valueJson` | no se sobrescribe lo existente |
| `DocumentCounter` | `key` (clave primaria), `nextValue` por defecto 1 | **nunca se reinicia**: el seed no actualiza contadores existentes |
| `StockMovement`, `StockLevel` | lectura por el invariante 1 | `StockMovement` es de solo inserción; **no hay** CHECK de `onHand >= 0`; sí `reserved >= 0`; los movimientos `LAYAWAY_RESERVE` y `LAYAWAY_RELEASE` no cuentan para `onHand` |

El esquema y las migraciones están congelados: no los modifiques.

## Contracts

**Consumed** — ya existe, no lo reconstruyas:

| From | Interface | Guarantee |
|---|---|---|
| `01-nucleo-de-dominio-y-pruebas` | `hashSecret(plain)`, `verifySecret(hash, plain)` en `src/lib/password.ts` | Argon2id; `verifySecret` devuelve `false` ante un hash mal formado |
| `01-nucleo-de-dominio-y-pruebas` | `parseMoney`, `formatMoney`, `formatMoneyPlain` en `src/lib/format.ts` | `L 1,234.50`; negativos `−L 64.00` con U+2212; `parseMoney` devuelve `null` si el texto no es dinero |
| `01-nucleo-de-dominio-y-pruebas` | `messages` en `src/config/messages.es.ts` | claves `app`, `nav`, `common`, `home`, `states`, `errors`, `dev.gallery`; solo se leen, no se añaden claves |
| `01-nucleo-de-dominio-y-pruebas` | `APP_ERROR_CODES`, `ValidationError`, `ForbiddenError`… en `src/lib/errors.ts` | `AppError` con `code` y `status` |
| `01-nucleo-de-dominio-y-pruebas` | `audit.log(tx, entry)` en `src/lib/audit.ts` | inserta en `AuditLog` |
| workspace | `testDb`, `resetDatabase()`, `closeDatabase()`, `assertTestDatabaseUrl` en `tests/integration/helpers/db.ts` | solo bases `_test` |
| repo | `db` de `src/lib/db.ts`; `parseEnv`/`env` de `src/lib/env.ts` | congelados |

**Produced** — lo que otras tareas (y la Fase 1) esperan con esta firma exacta:

| Export | Signature | Used by |
|---|---|---|
| `prisma/seed/run-seed.ts` → `runSeed`, `DEMO_USERS` | `runSeed(client: PrismaClient): Promise<void>` | `prisma/seed.ts`, `seed.test.ts` |
| `src/lib/health.ts` → `checkDatabase`, `pingDatabase`, `createHealthHandler` | `checkDatabase(query: () => Promise<unknown>): Promise<boolean>`; `createHealthHandler(check: () => Promise<boolean>): () => Promise<Response>` | `route.ts`, `health.test.ts` |
| `src/components/shared/*` | `PageHeader`, `EmptyState`, `ConfirmDialog`, `MoneyInput`, `DataTable` (props en la tarea 6) | galería (tarea 7), Fase 1 |
| `tests/integration/helpers/invariants.ts` → `findStockDiscrepancies` | `findStockDiscrepancies(client: Pick<PrismaClient, "$queryRaw">): Promise<StockDiscrepancy[]>` | `invariants.test.ts`, Fase 2 |

## Conventions that bite in this area

- **Cache Components:** nunca `export const dynamic`, `revalidate` ni `fetchCache` (error de build). Un layout no lee `cookies()` ni `headers()`; el dato de petición futuro va dentro de `<Suspense>`. Un `GET` que consulta la BD corre en cada petición; la ruta de salud además llama `await connection()` (de `next/server`). `middleware` se llama `proxy` (no se usa). `error.tsx` es componente de cliente que recibe `error` y `retry` (el nombre estable desde Next 16.3; `reset` también existe). `LayoutProps<"/">` es un tipo global que generan `next dev`, `next build` y `next typegen`.
- **Resolución de imports:** `@/…` en código de aplicación y pruebas bajo Next o Vitest; rutas **relativas sin extensión** (sin `@/`) en `prisma/seed.ts`, `prisma/seed/run-seed.ts`, `scripts/` y en las especificaciones E2E (por ejemplo `../../src/config/messages.es`).
- **Textos de interfaz:** salen de `messages` (`src/config/messages.es.ts`), no de JSX literal; la galería también usa `messages.dev.gallery`.
- **React:** sin `useEffect` que llame a `setState` y sin leer refs durante el render (las reglas `react-hooks` del lint lo marcan).
- **Prisma 7:** `prisma db seed` no corre solo tras `migrate`; `pnpm db:generate` es obligatorio porque `src/generated` no se versiona. La semilla se niega a correr con `NODE_ENV=production`.
- **shadcn:** el CLI se invoca con la versión exacta y sin `--overwrite`; los componentes generados usan Base UI (`render` en lugar de `asChild`); son código del proyecto y se editan.
- **pnpm:** `ERR_PNPM_IGNORED_BUILDS` aparece si una dependencia nueva trae script de instalación; nunca `dangerouslyAllowAllBuilds`.
- Antes de cada `Verify` corre `pnpm format`. Nunca `.only` ni `.skip` (salvo `it.todo` documentado).
- **Cero advertencias de ESLint:** el `Verify` de las nueve tareas (`E2-T1` a `E2-T9`) corre además `pnpm exec eslint --max-warnings 0` justo después de `pnpm lint`. `pnpm lint` sale con 0 aunque haya advertencias (`@typescript-eslint/no-unused-vars` está en `warn` en `eslint-config-next`) y la puerta final no tolera ninguna; una advertencia en un archivo que copió el CLI de shadcn se corrige en ese archivo.

Full project rules: `CLAUDE.md`. Area rules: `.claude/rules/tests.md` (pruebas) y `.claude/rules/money.md`. Both sit in the project root — the builder copied them there from the bundle's `workspace/` before task one.

---

## Tasks

Listed in the same order as `tasks.json`. That order is the build order — work top to bottom and do not re-rank by priority or by what looks quick.

### `E2-T1` — Semilla mínima idempotente

**Depends on:** `E1-T6`, `E1-T7` · **Priority:** p0 — metadata for scope cuts, not a running order

Crea la semilla de una base recién migrada. Es idempotente: no duplica filas, **no reinicia los contadores** y **no vuelve a hashear** usuarios existentes. Prisma 7 ya no ejecuta la semilla tras `migrate reset`, por eso cambia `db:reset`.

```bash
npm pkg set scripts.db:reset="prisma migrate reset --force && pnpm db:seed"
pnpm format
```

`prisma/seed/run-seed.ts` exporta `DEMO_USERS` y `runSeed(client: PrismaClient)`. Importa **por rutas relativas sin extensión** (`../../src/generated/prisma/client` solo para el tipo y `../../src/lib/password`). Lo primero que hace `runSeed` es lanzar un `Error` con `production` en el mensaje si `process.env.NODE_ENV` es `production`, antes de escribir nada. `prisma/seed.ts` (entrada de `prisma db seed`): `import "dotenv/config"`; construye `new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })` como `src/lib/db.ts` (lanza si falta `DATABASE_URL`); llama `runSeed`; desconecta en `finally`; un error termina con código 1.

Contenido (literal):
- `Location`: `{ code: "MAIN", name: "Tienda principal", isDefault: true, type: "STORE" }` (upsert por `code`). `Terminal`: `Caja 1` en esa ubicación.
- Usuarios (upsert por `username`; si existe solo se actualizan `name` y `role`; solo se hashea para crear). Contraseñas y PIN se guardan con `hashSecret` en `passwordHash` y `pinHash`:

| username | name | role | contraseña demo | PIN demo |
|---|---|---|---|---|
| `owner` | Propietario Demo | `OWNER` | `Demo-Propietario-2026` | `1111` |
| `manager` | Gerente Demo | `MANAGER` | `Demo-Gerente-2026` | `2222` |
| `cashier` | Cajero Demo | `CASHIER` | `Demo-Cajero-2026` | `3333` |
| `warehouse` | Almacén Demo | `WAREHOUSE` | `Demo-Almacen-2026` | `4444` |

- `Size` (upsert por `name`): grupo `ropa` con `XS`, `S`, `M`, `L`, `XL`, `XXL` (`sortOrder` 1 a 6) y grupo `calzado` con `34` a `42` (`sortOrder` 10 a 18).
- `Color` (upsert por `name`, `sortOrder` 1 a 12 en este orden): Negro `#1A1A1A`, Blanco `#FFFFFF`, Gris `#8A8A8A`, Beige `#D9C7A7`, Café `#6B4423`, Rojo `#B42318`, Rosa `#E58EA7`, Azul marino `#1F2A5C`, Azul `#2F6DB5`, Verde `#3F7F4F`, Amarillo `#E8C547`, Morado `#6B3FA0`.
- `Category` (upsert por `slug`, padres primero): `mujer` (Mujer), `mujer-vestidos` (Vestidos, padre `mujer`), `mujer-blusas` (Blusas, padre `mujer`), `hombre` (Hombre), `hombre-camisas` (Camisas, padre `hombre`), `ninos` (Niños), `accesorios` (Accesorios), `calzado` (Calzado).
- `BusinessProfile`: si no hay ninguna fila, crea una con `legalName` `Mi Boutique (por configurar)`.
- `Setting` (upsert por `key`, sin sobrescribir existentes): `tax.rate` = `1500`, `tax.pricesIncludeTax` = `true`, `sales.allowNegativeStock` = `false`, `discount.maxPercent.CASHIER` = `10`, `returns.maxDays` = `8`, `layaway.expiryDays` = `30`, `ticket.footer` = `¡Gracias por tu compra!`.
- `DocumentCounter` (upsert por `key`, sin sobrescribir): `SALE`, `RETURN`, `LAYAWAY`, `PURCHASE_ORDER`, `GOODS_RECEIPT`, `nextValue` 1 al crearse.

`tests/integration/seed.test.ts`: `beforeAll` hace `resetDatabase()` y dos `runSeed(testDb)` seguidos; `afterAll(closeDatabase)`. Afirma por entidades con nombre, nunca por conteo de filas: los cuatro usuarios con su rol; `verifySecret(hash, contraseña)` y `verifySecret(pinHash, PIN)` verdaderos para `cashier`; `MAIN` con `isDefault`; la terminal `Caja 1` en `MAIN`; tallas `XS`, `XXL` (grupo `ropa`), `34` y `42` (grupo `calzado`); color `Negro` con `hex` `#1A1A1A`; categoría `mujer-vestidos` con padre `mujer`; los siete ajustes (`valueJson` con `toBe`); los cinco contadores existen. Luego: `SALE` a `nextValue` 5 con `testDb.documentCounter.update`, guarda el `passwordHash` y el `pinHash` de `owner`, otro `runSeed` y comprueba que `SALE` sigue en 5 y que el `passwordHash` y el `pinHash` de `owner` no cambiaron (`toBe` contra los valores guardados). Segundo `describe`: `resetDatabase()`, `vi.stubEnv("NODE_ENV", "production")`, `await expect(runSeed(testDb)).rejects.toThrow(/production/)` y `testDb.user.findUnique({ where: { username: "owner" } })` es `null`; `afterEach(() => vi.unstubAllEnvs())`.

**Files**
- `package.json` — edit: `db:reset` pasa a `prisma migrate reset --force && pnpm db:seed`
- `prisma/seed.ts` — new
- `prisma/seed/run-seed.ts` — new
- `tests/integration/seed.test.ts` — new

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization defined in `agents/blueprint-writer.md` *Acceptance strings*. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `runSeed(testDb)` corre dos veces seguidas **THE SYSTEM SHALL** terminar sin error ambas veces y dejar los usuarios `owner`, `manager`, `cashier` y `warehouse` con los roles `OWNER`, `MANAGER`, `CASHIER` y `WAREHOUSE`.
2. **WHEN** el seed termina **THE SYSTEM SHALL** tener la ubicación `MAIN` con `isDefault` verdadero, la terminal `Caja 1` en ella, las tallas `XS`, `XXL`, `34` y `42`, el color `Negro` con `hex`, y la categoría `mujer-vestidos` con padre `mujer`.
3. **WHEN** el seed termina **THE SYSTEM SHALL** tener los ajustes `tax.rate` igual a `1500`, `tax.pricesIncludeTax` verdadero, `sales.allowNegativeStock` falso, `discount.maxPercent.CASHIER` igual a `10`, `returns.maxDays` igual a `8` y `layaway.expiryDays` igual a `30`, y los contadores `SALE`, `RETURN`, `LAYAWAY`, `PURCHASE_ORDER` y `GOODS_RECEIPT`.
4. **WHEN** el contador `SALE` vale 5 y el seed corre de nuevo **THE SYSTEM SHALL** conservar `5` y conservar sin cambios los `passwordHash` y `pinHash` ya existentes.
5. **WHEN** `NODE_ENV` es `production` **THE SYSTEM SHALL** rechazar `runSeed` con un error que menciona `production` sin escribir filas.
6. **WHEN** `pnpm db:seed` corre dos veces sobre la base de desarrollo **THE SYSTEM SHALL** terminar con código 0 ambas veces, y `package.json` SHALL definir `db:reset` como `prisma migrate reset --force && pnpm db:seed`.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:integration
pnpm db:seed
pnpm db:seed
grep -qF '"db:reset": "prisma migrate reset --force && pnpm db:seed"' package.json
pnpm test:unit
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm typecheck
pnpm format:check
status=0; grep -rnE '\.(skip|only)\(' tests/integration || status=$?; test "$status" -eq 1
```

These lines are this task's `verify` **array** in `tasks.json`, one per line, copied with any exit-code wrapping intact. No ejecutes `pnpm db:reset` como gate: borra la base de desarrollo y está denegado en `settings.json`.

**Checkpoint**

```bash
git add -A && git commit -m "feat(fase-0): E2-T1 seed"
git tag step-08-seed
git ls-files --error-unmatch prisma/seed/run-seed.ts
```

### `E2-T2` — Servir y probar /api/health

**Depends on:** `E1-T7` · **Priority:** p0 — metadata for scope cuts, not a running order

Primer artefacto servido: su `Verify` arranca `next start` y `next dev` y le pide la ruta a cada uno. La comprobación se inyecta para probar la ruta de fallo sin mockear el motor de Prisma. `src/lib/health.ts`: `checkDatabase(query)` (`true` si la consulta resuelve; `false` si rechaza, sin propagar ni registrar el error); `createHealthHandler(check)` devuelve una función `async` sin parámetros con `Response.json({ status: healthy ? "ok" : "error" }, { status: healthy ? 200 : 503 })`; `pingDatabase()` = ``checkDatabase(() => db.$queryRaw`select 1`)`` con `db` de `@/lib/db`. `src/app/api/health/route.ts`: `import { connection } from "next/server"`; `const handler = createHealthHandler(pingDatabase)`; `export async function GET(): Promise<Response> { await connection(); return handler(); }`. `connection()` lo excluye del prerenderizado: un build sin BD nunca congela un 503. **No exportes `dynamic`, `revalidate` ni `fetchCache`.**

`tests/integration/health.test.ts`: importa `checkDatabase`, `createHealthHandler`, `pingDatabase` de `@/lib/health` y `db` de `@/lib/db`; `afterAll(() => db.$disconnect())`. Casos: (a) `createHealthHandler(pingDatabase)()` responde 200 y su JSON es `{ status: 'ok' }`; (b) `createHealthHandler(() => Promise.resolve(false))()` responde 503 y el texto del cuerpo es exactamente `{"status":"error"}`; (c) `checkDatabase(() => Promise.reject(new Error("detalle-secreto")))` es `false` y el cuerpo de un handler que usa ese resultado no contiene `detalle-secreto`; (d) `checkDatabase(() => Promise.resolve(1))` es `true`. No importes `route.ts` en la prueba (`connection()` solo es válido dentro de una petición de Next): lo cubre la ejecución servida.

**Files**
- `src/lib/health.ts` — new
- `src/app/api/health/route.ts` — new
- `tests/integration/health.test.ts` — new

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization defined in `agents/blueprint-writer.md` *Acceptance strings*. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** el handler creado con `pingDatabase` se invoca contra la base de pruebas **THE SYSTEM SHALL** responder 200 con el JSON `{ status: 'ok' }`.
2. **WHEN** la comprobación de base de datos falla **THE SYSTEM SHALL** responder 503 con el JSON `{ status: 'error' }` y SHALL NOT incluir el texto del error original en el cuerpo.
3. **WHEN** `checkDatabase` recibe una consulta que rechaza **THE SYSTEM SHALL** devolver `false` sin propagar el error, y **WHEN** recibe una que resuelve **THE SYSTEM SHALL** devolver `true`.
4. **WHEN** `pnpm build` termina y `scripts/smoke-server.ts` arranca `next start` en el puerto 3190 **THE SYSTEM SHALL** recibir 200 con un cuerpo que contiene `ok` en `/api/health`, y **WHEN** arranca `next dev` en el puerto 3191 **THE SYSTEM SHALL** recibir 200 con un cuerpo que contiene `ok` en `/api/health`.
5. **WHEN** se buscan segment configs en `src/app` **THE SYSTEM SHALL** no encontrar `export const dynamic`, `revalidate` ni `fetchCache`.
6. **WHEN** `pnpm lint`, `pnpm typecheck` y `pnpm format:check` corren al cerrar el paso **THE SYSTEM SHALL** terminar con código 0 en los tres.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:integration
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm typecheck
pnpm format:check
pnpm build
pnpm exec tsx scripts/smoke-server.ts start 3190 /api/health=200:ok
pnpm exec tsx scripts/smoke-server.ts dev 3191 /api/health=200:ok
status=0; grep -rnE 'export const (dynamic|revalidate|fetchCache)' src/app || status=$?; test "$status" -eq 1
```

These lines are this task's `verify` **array** in `tasks.json`, one per line, copied with any exit-code wrapping intact. La segunda línea de `smoke-server` ejerce el arranque de desarrollo (`next dev`) desde el primer paso servido; el script mata el árbol de procesos al terminar.

**Checkpoint**

```bash
git add -A && git commit -m "feat(fase-0): E2-T2 health"
git tag step-09-health
git ls-files --error-unmatch src/app/api/health/route.ts
```

### `E2-T3` — Primitivas de UI: shadcn y TanStack Table

**Depends on:** `E1-T1`, `E1-T2` · **Priority:** p1 — metadata for scope cuts, not a running order

Instala TanStack Table (versión exacta) y copia con el CLI de shadcn las nueve primitivas nuevas (existe `button`; **no pases `--overwrite`**). Lee primero `src/components/ui/button.tsx` (Base UI: `render` en lugar de `asChild`). Los tokens de color y la fuente llegan en la tarea siguiente (`E2-T4`); esta tarea depende de `E1-T2` porque los textos solo-lectores-de-pantalla leen `messages`.

```bash
pnpm add -E @tanstack/react-table@8.21.3
pnpm dlx shadcn@4.22.1 add sidebar table alert-dialog dialog skeleton input tooltip separator sheet --yes
pnpm format
```

Ajustes obligatorios sobre `src/components/ui/**` (código del proyecto): (a) separadores decorativos con el token `divider` (en `separator.tsx` cambia `bg-border` por `bg-divider`; en `table.tsx` los bordes de fila usan `border-divider`; el token se define en `E2-T4`); (b) los textos en inglés que deje el CLI (`Toggle Sidebar`, `Close`) leen `messages.common.toggleSidebar` y `messages.common.close` de `@/config/messages.es`: el `span` `sr-only`, y también cualquier `aria-label` o `title` con `Toggle Sidebar` (no se conserva ninguno en inglés; los sitios habituales son el botón de cierre de `dialog.tsx` y `sheet.tsx` y el riel y el disparador de `sidebar.tsx`; búscalos con `grep -rn 'sr-only\|Toggle Sidebar\|Close' src/components/ui`). `src/hooks/use-mobile.ts` lo copia el CLI. No toques `button.tsx` si el CLI no lo modifica.

Si el CLI termina con `ERR_PNPM_IGNORED_BUILDS`, lee el paquete del mensaje; solo si necesita su script añade `<paquete>: true` a `allowBuilds` de `pnpm-workspace.yaml` y anótalo; nunca `dangerouslyAllowAllBuilds`.

**Files**
- `package.json` — edit: `@tanstack/react-table` con versión exacta
- `src/components/ui/**` — new (nueve primitivas del CLI) y ajustes de `separator.tsx`, `table.tsx` y textos sr-only
- `src/hooks/use-mobile.ts` — new (lo copia el CLI)

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization defined in `agents/blueprint-writer.md` *Acceptance strings*. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** el CLI de shadcn termina y se aplican los ajustes del paso **THE SYSTEM SHALL** haber creado `sidebar`, `table`, `alert-dialog`, `dialog`, `skeleton`, `input`, `tooltip`, `separator` y `sheet` en `src/components/ui/`, con `separator` y `table` usando el token `divider` y sin los textos sr-only en inglés `Toggle Sidebar` ni `Close`.
2. **WHEN** `package.json` se lee **THE SYSTEM SHALL** declarar `@tanstack/react-table` con la versión exacta `8.21.3`.
3. **WHEN** `pnpm build` corre con `cacheComponents` activo **THE SYSTEM SHALL** terminar con código 0.
4. **WHEN** se buscan segment configs en `src` **THE SYSTEM SHALL** no encontrar `export const dynamic`, `revalidate` ni `fetchCache`.
5. **WHEN** `pnpm lint`, `pnpm typecheck` y `pnpm format:check` corren al cerrar el paso **THE SYSTEM SHALL** terminar con código 0 en los tres.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm install --frozen-lockfile
test -f src/components/ui/sidebar.tsx && test -f src/components/ui/table.tsx && test -f src/components/ui/alert-dialog.tsx && test -f src/components/ui/dialog.tsx && test -f src/components/ui/skeleton.tsx && test -f src/components/ui/input.tsx && test -f src/components/ui/tooltip.tsx && test -f src/components/ui/separator.tsx && test -f src/components/ui/sheet.tsx
grep -qF 'bg-divider' src/components/ui/separator.tsx
grep -qF 'border-divider' src/components/ui/table.tsx
status=0; grep -rnF 'Toggle Sidebar' src/components/ui || status=$?; test "$status" -eq 1
status=0; grep -rnE '(^|[>"])[[:space:]]*Close[[:space:]]*($|[<"])' src/components/ui || status=$?; test "$status" -eq 1
grep -qF '"@tanstack/react-table": "8.21.3"' package.json
status=0; grep -rnE 'export const (dynamic|revalidate|fetchCache)' src || status=$?; test "$status" -eq 1
pnpm build
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm typecheck
pnpm format:check
```

These lines are this task's `verify` **array** in `tasks.json`, one per line, copied with any exit-code wrapping intact. `pnpm build` descarga la fuente actual (Geist) de Google Fonts: necesita red.

**Checkpoint**

```bash
git add -A && git commit -m "feat(fase-0): E2-T3 ui-primitives"
git tag step-10-ui-primitives
git ls-files --error-unmatch src/components/ui/sidebar.tsx
```

### `E2-T4` — Tokens de diseño e Inter

**Depends on:** `E1-T2` · **Priority:** p1 — metadata for scope cuts, not a running order

Aplica los tokens de color en `src/app/globals.css` y cambia Geist por Inter en `src/app/layout.tsx`. Depende de `E1-T2` porque el layout lee `messages.app.name` de `@/config/messages.es`.

`src/app/globals.css`: conserva los `@import`s, `@custom-variant`, las asignaciones `--color-*` y `--radius-*`, los `--chart-*` y **la línea `@source not "../../blueprints";`** (excluye el bundle del escaneo de Tailwind). Dentro de `@theme inline` añade `--color-success: var(--success); --color-warning: var(--warning); --color-info: var(--info); --color-divider: var(--divider); --default-transition-duration: 150ms; --default-transition-timing-function: ease-out;`, reemplaza `--font-mono: var(--font-geist-mono);` por `--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;`. Bloques (hex en minúsculas; Prettier no los reescribe):

```css
:root {
  --background: #faf8f5;
  --foreground: #1f1b16;
  --card: #ffffff;
  --card-foreground: #1f1b16;
  --popover: #ffffff;
  --popover-foreground: #1f1b16;
  --primary: #3f6350;
  --primary-foreground: #ffffff;
  --secondary: #e4ded4;
  --secondary-foreground: #1f1b16;
  --muted: #e4ded4;
  --muted-foreground: #5f574d;
  --accent: #e4ded4;
  --accent-foreground: #1f1b16;
  --destructive: #b42318;
  --border: #8a8175;
  --input: #8a8175;
  --ring: #3f6350;
  --divider: #e4ded4;
  --success: #1e6b3e;
  --warning: #8a5200;
  --info: #1d5fa8;
  --sidebar: #ffffff;
  --sidebar-foreground: #1f1b16;
  --sidebar-primary: #3f6350;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #e4ded4;
  --sidebar-accent-foreground: #1f1b16;
  --sidebar-border: #e4ded4;
  --sidebar-ring: #3f6350;
}

.dark {
  --background: #16140f;
  --foreground: #f3efe8;
  --card: #201d18;
  --card-foreground: #f3efe8;
  --popover: #201d18;
  --popover-foreground: #f3efe8;
  --primary: #8db59f;
  --primary-foreground: #10170f;
  --secondary: #342f28;
  --secondary-foreground: #f3efe8;
  --muted: #342f28;
  --muted-foreground: #b8afa2;
  --accent: #342f28;
  --accent-foreground: #f3efe8;
  --destructive: #f28b82;
  --border: #7c7467;
  --input: #7c7467;
  --ring: #8db59f;
  --divider: #342f28;
  --success: #7fd1a0;
  --warning: #e8b35a;
  --info: #8ab8f0;
  --sidebar: #201d18;
  --sidebar-foreground: #f3efe8;
  --sidebar-primary: #8db59f;
  --sidebar-primary-foreground: #10170f;
  --sidebar-accent: #342f28;
  --sidebar-accent-foreground: #f3efe8;
  --sidebar-border: #342f28;
  --sidebar-ring: #8db59f;
}
```

(Los `--chart-*` y `--radius: 0.625rem` de ambos bloques no cambian.) Al final del archivo:

```css
@layer components {
  .money {
    @apply text-right tabular-nums;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  ::before,
  ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

`src/app/layout.tsx`: reemplaza Geist y Geist Mono por `Inter` de `next/font/google` con `subsets: ["latin"]`, `display: "swap"` y `variable: "--font-sans"`; `metadata.title` pasa a `messages.app.name` (de `@/config/messages.es`); conserva `description` y ``<html lang="es-HN" className={`${inter.variable} h-full antialiased`}>``; el tipo sigue siendo `LayoutProps<"/">`.

**Files**
- `src/app/globals.css` — edit: tokens, clase `.money` y movimiento reducido
- `src/app/layout.tsx` — edit: Inter en lugar de Geist

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization defined in `agents/blueprint-writer.md` *Acceptance strings*. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `src/app/globals.css` se lee **THE SYSTEM SHALL** definir los tokens claros `--background: #FAF8F5`, `--primary: #3F6350` y `--destructive: #B42318` y los oscuros `--background: #16140F` y `--primary: #8DB59F`, además de `--success`, `--warning`, `--info` y `--divider`.
2. **WHEN** `src/app/layout.tsx` se lee **THE SYSTEM SHALL** cargar `Inter` con `next/font/google`, `display` igual a `swap` y la variable `--font-sans`, sin referencias a `Geist`, y SHALL conservar `lang` igual a `es-HN`.
3. **WHEN** `src/app/globals.css` se lee **THE SYSTEM SHALL** conservar la exclusión `@source not` del bundle de blueprints y definir la clase `.money` y la regla `prefers-reduced-motion`.
4. **WHEN** `pnpm build` corre con `cacheComponents` activo **THE SYSTEM SHALL** terminar con código 0.
5. **WHEN** `pnpm lint`, `pnpm typecheck` y `pnpm format:check` corren al cerrar el paso **THE SYSTEM SHALL** terminar con código 0 en los tres.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
grep -qiF -- '--background: #faf8f5;' src/app/globals.css
grep -qiF -- '--primary: #3f6350;' src/app/globals.css
grep -qiF -- '--destructive: #b42318;' src/app/globals.css
grep -qiF -- '--background: #16140f;' src/app/globals.css
grep -qiF -- '--primary: #8db59f;' src/app/globals.css
grep -qF -- '--divider:' src/app/globals.css
grep -qF -- '--success:' src/app/globals.css
grep -qF -- '--warning:' src/app/globals.css
grep -qF -- '--info:' src/app/globals.css
grep -qF '@source not "../../blueprints";' src/app/globals.css
grep -qF '.money' src/app/globals.css
grep -qF 'prefers-reduced-motion' src/app/globals.css
grep -qE '\bInter\(' src/app/layout.tsx
grep -qF 'display: "swap"' src/app/layout.tsx
grep -qF 'variable: "--font-sans"' src/app/layout.tsx
grep -qF 'lang="es-HN"' src/app/layout.tsx
status=0; grep -q 'Geist' src/app/layout.tsx || status=$?; test "$status" -eq 1
pnpm build
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm typecheck
pnpm format:check
```

These lines are this task's `verify` **array** in `tasks.json`, one per line, copied with any exit-code wrapping intact. `pnpm build` descarga Inter de Google Fonts: necesita red.

**Checkpoint**

```bash
git add -A && git commit -m "feat(fase-0): E2-T4 design-tokens"
git tag step-11-design-tokens
```

### `E2-T5` — Shell de aplicación y estados de ruta

**Depends on:** `E1-T2`, `E2-T2`, `E2-T3`, `E2-T4` · **Priority:** p0 — metadata for scope cuts, not a running order

Construye el shell: barra lateral con **un solo elemento, "Inicio"** (los demás módulos aparecen en su fase), barra superior, página de inicio y las tres páginas de estado de ruta. Lee `src/components/ui/sidebar.tsx` (API real) y las guías `layout.md`, `loading.md`, `error.md` y `not-found.md` en `node_modules/.pnpm/next@16.4.2_*/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/`. Todo texto sale de `messages`. **Orden:** escribe primero `src/app/(app)/layout.tsx` (así existe el directorio `src/app/(app)/`) y solo después ejecuta el `git mv` de la página; `git mv` no crea directorios y por eso no hace falta `mkdir`.

`src/app/(app)/layout.tsx` (servidor, **sin `cookies()` ni `headers()`**): enlace `Saltar al contenido` (`messages.common.skipToContent`, visible solo al enfocarlo) hacia `#contenido`; `SidebarProvider` con `Sidebar` (marca `messages.app.name` y un `SidebarMenu` que primero renderiza `homeItem` —un `SidebarMenuButton` cuyo `render` es un `Link` a `homeItem.href` con `<homeItem.icon />` y el texto `homeItem.label`— y debajo `navGroups.map((group) => …)`: un `SidebarGroup` con `key={group.label}`, su etiqueta y un `SidebarMenuButton` por elemento de `group.items`, con el mismo patrón de `Link`); `SidebarInset` con `header` (`SidebarTrigger` y `Separator` vertical) y `main` con `id="contenido"` que renderiza `children`. Antes del componente, dos tipos y dos constantes sin exportar y **sin comentarios**: `type NavItem = { href: string; label: string; icon: LucideIcon }` (`LucideIcon` de `lucide-react`), `type NavGroup = { label: string; items: readonly NavItem[] }`, `const homeItem: NavItem = { href: "/", label: messages.nav.home, icon: House }` (`House` de `lucide-react`) y `const navGroups: readonly NavGroup[] = []` (la forma que la Fase 1 extiende con Vender, Mercadería, Gente, Negocio y Admin). `navGroups` está vacío en esta fase, así que el `map` no pinta nada, pero **debe renderizarse**: de ese modo `NavItem`, `NavGroup` y `navGroups` quedan usados y `@typescript-eslint/no-unused-vars` (advertencia en la configuración de `eslint-config-next`) no emite una advertencia, que `pnpm lint` toleraría pero haría fallar `pnpm exec eslint --max-warnings 0` de §20.1. Las líneas decorativas usan `border-divider`. `src/app/(app)/page.tsx`: `git mv src/app/page.tsx "src/app/(app)/page.tsx"` y reemplaza su contenido por un `h1` con `messages.home.title` y un párrafo `text-muted-foreground` con `messages.home.description` (no hay otro `h1` en el shell). `src/app/loading.tsx`: región `role="status"` con texto oculto `messages.common.loading` y tres `Skeleton`. `src/app/error.tsx`: primera línea `"use client";`; props `{ error, retry }` (`error: unknown`, `retry: () => void`); `useEffect` que hace `console.error(error)`; contenedor `role="alert"` con `messages.states.error.title`, `.description` y un `Button` `messages.common.retry` que llama `retry()`. `src/app/not-found.tsx` (servidor): `h1` `messages.states.notFound.title`, párrafo `.description` y un `Link` a `/` con `buttonVariants()` y el texto `messages.states.notFound.action`.

**Files**
- `src/app/(app)/layout.tsx` — new
- `src/app/(app)/page.tsx` — new (movido con `git mv` desde `src/app/page.tsx`, que deja de existir)
- `src/app/loading.tsx` — new
- `src/app/error.tsx` — new
- `src/app/not-found.tsx` — new

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization defined in `agents/blueprint-writer.md` *Acceptance strings*. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** la página `/` se pide al servidor de producción y al servidor de desarrollo **THE SYSTEM SHALL** responder 200 con HTML que contiene `Inicio`.
2. **WHEN** una ruta inexistente se pide **THE SYSTEM SHALL** responder 404 con HTML que contiene `No encontramos`.
3. **WHEN** el árbol de `src/app` se inspecciona **THE SYSTEM SHALL** no contener `src/app/page.tsx` y SHALL contener `src/app/(app)/page.tsx`, `src/app/loading.tsx`, `src/app/error.tsx` y `src/app/not-found.tsx`.
4. **WHEN** `src/app/error.tsx` se lee **THE SYSTEM SHALL** empezar con la directiva `use client` y recibir las props `error` y `retry`.
5. **WHEN** se buscan segment configs en `src` **THE SYSTEM SHALL** no encontrar `export const dynamic`, `revalidate` ni `fetchCache`.
6. **WHEN** `pnpm lint`, `pnpm typecheck`, `pnpm format:check` y `pnpm build` corren **THE SYSTEM SHALL** terminar con código 0 en los cuatro.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm build
pnpm exec tsx scripts/smoke-server.ts start 3190 /=200:Inicio '/ruta-que-no-existe=404:No encontramos' /api/health=200:ok
pnpm exec tsx scripts/smoke-server.ts dev 3191 /=200:Inicio
test ! -e src/app/page.tsx
test -f "src/app/(app)/page.tsx" && test -f src/app/loading.tsx && test -f src/app/error.tsx && test -f src/app/not-found.tsx && test -f "src/app/(app)/layout.tsx"
head -n 1 src/app/error.tsx | grep -qx '"use client";'
grep -qE '[{ ,]retry[:,]' src/app/error.tsx
grep -qE '[{ ,]error[:,]' src/app/error.tsx
grep -qF 'lang="es-HN"' src/app/layout.tsx
status=0; grep -rnE 'export const (dynamic|revalidate|fetchCache)' src || status=$?; test "$status" -eq 1
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm typecheck
pnpm format:check
```

These lines are this task's `verify` **array** in `tasks.json`, one per line, copied with any exit-code wrapping intact. La línea de `smoke-server` con `dev` va antes de `pnpm lint` y `pnpm typecheck` a propósito: `next dev` regenera `.next/dev/types`, que `pnpm typecheck` incluye y que quedaría obsoleto tras mover `src/app/page.tsx`.

**Checkpoint**

```bash
git add -A && git commit -m "feat(fase-0): E2-T5 app-shell"
git tag step-12-app-shell
git ls-files --error-unmatch "src/app/(app)/layout.tsx"
```

### `E2-T6` — Componentes compartidos de interfaz

**Depends on:** `E1-T2`, `E1-T5`, `E2-T3` · **Priority:** p1 — metadata for scope cuts, not a running order

Crea los cinco componentes en `src/components/shared/`. Lee antes `alert-dialog.tsx`, `table.tsx`, `input.tsx` y `skeleton.tsx` generados y usa solo exportaciones que existan. Sin `useEffect` que llame a `setState`; sin leer refs en el render. Este paso se verifica con tipos, lint y build; el comportamiento en el navegador se ejerce en la tarea 7, cuando existe la galería que los renderiza.

- `page-header.tsx` (servidor, sin `"use client"`): props `{ title: string; description?: string; actions?: React.ReactNode }`; el `h1`, la descripción en `text-muted-foreground` y las acciones a la derecha.
- `empty-state.tsx` (servidor): props `{ icon?: LucideIcon; title: string; description?: string; action?: React.ReactNode }`; centrado con acción sugerida.
- `confirm-dialog.tsx` (`"use client"`): props `{ open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; confirmLabel: string; cancelLabel?: string; destructive?: boolean; pending?: boolean; onConfirm: () => void }`; compone `AlertDialog` de `@/components/ui/alert-dialog`; `cancelLabel` por defecto `messages.common.cancel`; el botón de confirmar usa la variante `destructive` cuando corresponde y se deshabilita con `pending`; `Escape` y cancelar llaman `onOpenChange(false)`.
- `money-input.tsx` (`"use client"`): props `Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "type"> & { valueCents: number | null; onValueChange: (cents: number | null) => void }`; controlado en centavos; usa `Input` de `@/components/ui/input` y `parseMoney`, `formatMoney`, `formatMoneyPlain` de `@/lib/format`. Estado local `draft: string | null` (`null` = no se edita). Valor visible: `draft ?? (valueCents === null ? "" : formatMoney(valueCents))` (en el render, sin efectos). Al enfocar: `draft` = `valueCents === null ? "" : formatMoneyPlain(valueCents)`. Al escribir: actualiza `draft`. Al salir: si `draft` es vacío llama `onValueChange(null)`; si `parseMoney(draft)` da un número llama `onValueChange(número)` y `draft` vuelve a `null`; si da `null` conserva `draft` y marca `aria-invalid="true"`. `inputMode="decimal"`, `autoComplete="off"`, clases `text-right` y `tabular-nums`. El nombre accesible lo pone quien lo usa.
- `data-table.tsx` (`"use client"`): TanStack Table 8 (`useReactTable`, `getCoreRowModel`, `flexRender`) sobre `Table` de `@/components/ui/table`. Props `{ columns: ColumnDef<TData, TValue>[]; data: TData[]; isLoading?: boolean; loadingRows?: number; error?: { message: string; onRetry: () => void } | null; empty?: { title: string; description?: string; action?: React.ReactNode }; caption: string }`; cada prop opcional se declara con la forma `nombre?: tipo`, que es la que comprueba el `Verify`. `isLoading` → filas `Skeleton` (5 por defecto) y un `role="status"` con `messages.common.loading`; `error` → `role="alert"` con el mensaje y un botón `messages.common.retry` que llama `onRetry`; sin filas → `EmptyState` (con `empty` o los textos de `messages.states.empty`); con filas → la tabla. `caption` es el `<caption>` accesible (puede ser `sr-only`). Si `pnpm lint` marca `react-hooks/incompatible-library` en `useReactTable`, añade en esa línea un único `// eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table v8 devuelve funciones no memoizables; aceptado` y nada más.

**Files**
- `src/components/shared/page-header.tsx` — new
- `src/components/shared/empty-state.tsx` — new
- `src/components/shared/confirm-dialog.tsx` — new
- `src/components/shared/money-input.tsx` — new
- `src/components/shared/data-table.tsx` — new

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization defined in `agents/blueprint-writer.md` *Acceptance strings*. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `pnpm typecheck` corre **THE SYSTEM SHALL** terminar con código 0 con `MoneyInput` tipado como `valueCents: number | null` y `onValueChange: (cents: number | null) => void`.
2. **WHEN** `src/components/shared/money-input.tsx` se lee **THE SYSTEM SHALL** usar `parseMoney` y `formatMoney` de `@/lib/format`, `inputMode` igual a `decimal` y la clase `tabular-nums`.
3. **WHEN** `src/components/shared/data-table.tsx` se lee **THE SYSTEM SHALL** importar `useReactTable` de `@tanstack/react-table` y exponer las props `isLoading`, `error` y `empty`.
4. **WHEN** `src/components/shared/confirm-dialog.tsx` se lee **THE SYSTEM SHALL** componer `alert-dialog` de `@/components/ui/alert-dialog`.
5. **WHEN** se leen los archivos de `src/components/shared` **THE SYSTEM SHALL** tener la directiva `use client` solo en `money-input.tsx`, `confirm-dialog.tsx` y `data-table.tsx`, y no en `page-header.tsx` ni `empty-state.tsx`.
6. **WHEN** `pnpm lint`, `pnpm typecheck`, `pnpm format:check` y `pnpm build` corren **THE SYSTEM SHALL** terminar con código 0 en los cuatro.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm typecheck
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm format:check
pnpm build
grep -qF 'valueCents: number | null' src/components/shared/money-input.tsx
grep -qF 'onValueChange: (cents: number | null) => void' src/components/shared/money-input.tsx
grep -qE '\bparseMoney\(' src/components/shared/money-input.tsx
grep -qE '\bformatMoney\(' src/components/shared/money-input.tsx
grep -qF 'inputMode="decimal"' src/components/shared/money-input.tsx
grep -qF 'tabular-nums' src/components/shared/money-input.tsx
grep -qE '\buseReactTable\(' src/components/shared/data-table.tsx
grep -qF 'from "@tanstack/react-table"' src/components/shared/data-table.tsx
grep -qF 'isLoading?:' src/components/shared/data-table.tsx
grep -qF 'error?:' src/components/shared/data-table.tsx
grep -qF 'empty?:' src/components/shared/data-table.tsx
grep -qF '@/components/ui/alert-dialog' src/components/shared/confirm-dialog.tsx
head -n 1 src/components/shared/money-input.tsx | grep -qx '"use client";'
head -n 1 src/components/shared/confirm-dialog.tsx | grep -qx '"use client";'
head -n 1 src/components/shared/data-table.tsx | grep -qx '"use client";'
status=0; grep -qF 'use client' src/components/shared/page-header.tsx || status=$?; test "$status" -eq 1
status=0; grep -qF 'use client' src/components/shared/empty-state.tsx || status=$?; test "$status" -eq 1
```

These lines are this task's `verify` **array** in `tasks.json`, one per line, copied with any exit-code wrapping intact.

**Checkpoint**

```bash
git add -A && git commit -m "feat(fase-0): E2-T6 shared-components"
git tag step-13-shared-components
git ls-files --error-unmatch src/components/shared/data-table.tsx
```

### `E2-T7` — Playwright y galería de componentes

**Depends on:** `E2-T2`, `E2-T5`, `E2-T6` · **Priority:** p1 — metadata for scope cuts, not a running order

Instala Playwright, copia su configuración desde el bundle (se copia ahora y no en el Bootstrap porque importa `@playwright/test`: con el archivo en la raíz `pnpm typecheck` de las tareas anteriores habría fallado), crea la galería y las dos especificaciones. La galería existe **solo** para que Playwright ejerza los componentes (no hay Storybook ni jsdom). Usa las convenciones de la skill `playwright-best-practices` (localizadores por rol o etiqueta, sin esperas fijas). Los E2E importan `messages` por ruta relativa (`../../src/config/messages.es`).

```bash
pnpm add -D -E @playwright/test@1.64.1
test -e playwright.config.ts || cp blueprints/fase-0-cimientos/workspace/playwright.config.ts playwright.config.ts
npm pkg set scripts.test:e2e="playwright test"
pnpm exec playwright install chromium
pnpm format
```

`playwright.config.ts` (ya escrito en el bundle): `testDir` `tests/e2e`, solo Chromium, `webServer` con `command` `pnpm build && pnpm exec next start --port 3100`, `url` `http://127.0.0.1:3100/api/health`, `reuseExistingServer: !isCI`, `timeout` 240 s y `env: { NEXT_PUBLIC_COMPONENT_GALLERY: "enabled" }`. `pnpm typecheck` valida estas opciones contra los tipos de `@playwright/test`.

`src/app/(app)/dev/componentes/page.tsx`: página **de cliente** (`"use client"`; necesita estado). Primera instrucción del componente: `if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_COMPONENT_GALLERY !== "enabled") { notFound(); }` con `notFound` de `next/navigation`: en producción real responde 404 y solo el build de Playwright (que define la variable) la muestra. Todo texto sale de `messages.dev.gallery`. Secciones en este orden, cada una un `<section aria-labelledby>` con su `h2`: (1) `PageHeader` con `title` `messages.dev.gallery.title` y `description`; (2) `MoneyInput` con `<label htmlFor>` `money.label` y `useState<number | null>(null)`; (3) `ConfirmDialog` controlado, con un `Button` `confirm.open` que lo abre y `title`, `description` y `confirmLabel` de `confirm`; (4) cuatro `DataTable` con columnas Producto (`columnProduct`) y Precio (`columnPrice`, celda con `formatMoney` y la clase `money`), en secciones llamadas `table.loading` (con `isLoading`), `table.empty` (`data=[]` y `empty` con un `Button` `table.emptyAction` como acción), `table.error` (`error` `{ message: table.errorMessage, onRetry: () => undefined }`) y `table.rows` (dos filas: `sampleDress` a 65 000 centavos y `sampleBlouse` a 32 000). Cada tabla recibe un `caption` igual al título de su sección.

`tests/e2e/shell.spec.ts`: (a) `page.goto("/")`: `getByRole("link", { name: messages.nav.home, exact: true })` visible y `getByRole("heading", { level: 1, name: messages.home.title })` visible; (b) `request.get("/api/health")`: estado 200 y JSON igual a `{ status: "ok" }`; (c) `page.goto("/ruta-que-no-existe")`: estado de la respuesta 404 y `getByRole("heading", { name: messages.states.notFound.title })` visible. `tests/e2e/components.spec.ts`: `test.beforeEach` va a `/dev/componentes`; con `const gallery = messages.dev.gallery`: (a) `getByLabel(gallery.money.label)`: `fill("1234.5")`, `blur()` y `toHaveValue("L 1,234.50")`; (b) mismo campo con `fill("12.345")`, `blur()` y `toHaveAttribute("aria-invalid", "true")`; (c) clic en el botón `gallery.confirm.open`, `getByRole("alertdialog")` visible, `keyboard.press("Escape")` y el diálogo oculto; (d) por cada sección `getByRole("region", { name: gallery.table.<estado> })`: cargando contiene un `role="status"` visible; vacía el botón `gallery.table.emptyAction`; con error un `role="alert"` y el botón `messages.common.retry`; con datos la celda `gallery.table.sampleDress`. Acota cada localizador de (d) a su región: el anunciador de rutas de Next también usa `role="alert"`.

**Files**
- `package.json` — edit: `@playwright/test` exacto y el script `test:e2e`
- `playwright.config.ts` — new (copia desde el bundle)
- `tests/e2e/shell.spec.ts` — new
- `tests/e2e/components.spec.ts` — new
- `src/app/(app)/dev/componentes/page.tsx` — new

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization defined in `agents/blueprint-writer.md` *Acceptance strings*. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `pnpm test:e2e` corre **THE SYSTEM SHALL** construir la app de producción, arrancarla en el puerto 3100 y terminar con código 0 sin pruebas fallidas.
2. **WHEN** `shell.spec.ts` corre **THE SYSTEM SHALL** comprobar el enlace `Inicio` en la barra lateral, `/api/health` con 200 y `{ status: 'ok' }`, y una ruta inexistente con 404 y el título de no encontrada.
3. **WHEN** `components.spec.ts` escribe `1234.5` en el campo `Monto` y lo abandona **THE SYSTEM SHALL** mostrar `L 1,234.50`, y con `12.345` SHALL marcarlo con `aria-invalid` igual a `true`.
4. **WHEN** `components.spec.ts` abre el diálogo de confirmación y pulsa `Escape` **THE SYSTEM SHALL** cerrarlo.
5. **WHEN** `components.spec.ts` recorre las cuatro tablas **THE SYSTEM SHALL** mostrar el estado cargando con `role=status`, el vacío con su acción, el error con `role=alert` y botón `Reintentar`, y las filas con `Vestido floral`.
6. **WHEN** la galería se pide a un build de producción sin `NEXT_PUBLIC_COMPONENT_GALLERY` **THE SYSTEM SHALL** responder 404.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm exec tsx scripts/smoke-server.ts start 3190 /dev/componentes=404 /api/health=200:ok
pnpm test:e2e
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm typecheck
pnpm format:check
grep -qF '"@playwright/test": "1.64.1"' package.json
grep -qF '"test:e2e": "playwright test"' package.json
test -f playwright.config.ts && test -f tests/e2e/shell.spec.ts && test -f tests/e2e/components.spec.ts && test -f "src/app/(app)/dev/componentes/page.tsx"
status=0; grep -rnE 'waitForTimeout|\.(skip|only)\(' tests/e2e || status=$?; test "$status" -eq 1
```

These lines are this task's `verify` **array** in `tasks.json`, one per line, copied with any exit-code wrapping intact. El orden importa: la comprobación de 404 de la galería va antes del E2E, que reconstruye `.next` con la variable definida.

**Checkpoint**

```bash
git add -A && git commit -m "feat(fase-0): E2-T7 playwright"
git tag step-14-playwright
git ls-files --error-unmatch playwright.config.ts
```

### `E2-T8` — Invariante de stock, guardia y documentos

**Depends on:** `E1-T7` · **Priority:** p1 — metadata for scope cuts, not a running order

Implementa de verdad el invariante 1 de `docs/DATA_MODEL.md` §9, deja los invariantes 2 a 7 como pendientes documentados, añade el test que impone `CLAUDE.md` §6.2 y alinea los documentos con el esquema y la pila reales.

`tests/integration/helpers/invariants.ts`: tipo `StockDiscrepancy = { variantId: string; locationId: string; movementSum: number; onHand: number }` y `findStockDiscrepancies(client: Pick<PrismaClient, "$queryRaw">)`, que ejecuta con `$queryRaw` etiquetado y devuelve las filas de:

```sql
SELECT COALESCE(m."variantId", l."variantId") AS "variantId",
       COALESCE(m."locationId", l."locationId") AS "locationId",
       COALESCE(m."movementSum", 0)::int AS "movementSum",
       COALESCE(l."onHand", 0)::int AS "onHand"
FROM (
  SELECT "variantId", "locationId", SUM("quantity")::int AS "movementSum"
  FROM "StockMovement"
  WHERE "type" NOT IN ('LAYAWAY_RESERVE', 'LAYAWAY_RELEASE')
  GROUP BY "variantId", "locationId"
) m
FULL OUTER JOIN "StockLevel" l
  ON l."variantId" = m."variantId" AND l."locationId" = m."locationId"
WHERE COALESCE(m."movementSum", 0) <> COALESCE(l."onHand", 0)
ORDER BY 1, 2
```

(Los movimientos de apartado cambian `reserved`, no `onHand`: el invariante dice "excluyendo reservas". Los `::int` evitan `bigint`.) `tests/integration/invariants.test.ts`: `beforeEach(resetDatabase)`, `afterAll(closeDatabase)`. (A) base vacía → `[]`; (B) dentro de `testDb.$transaction` crea `User`, `Location`, `Category` (`slug` único), `Product` (`code`, `name`, `categoryId`, `basePriceCents: 1000`), `Variant` (`sku` y `barcode` únicos) y un `StockMovement` `ADJUSTMENT_IN` de `quantity` 5 con `reason` y `userId` **sin** `StockLevel`; dentro, el helper devuelve exactamente un elemento con ese `variantId` y `locationId`, `movementSum` 5 y `onHand` 0; la transacción termina con un error centinela capturado fuera, y después el helper devuelve `[]`; (C) los mismos datos más un `StockLevel` con `onHand` 5 → `[]`. Los invariantes 2 a 7 de `docs/DATA_MODEL.md` §9 se declaran como `it.todo` con su texto completo (el 2 menciona `Sale.total`; el 5 menciona `storeCreditCents`); un `todo` no es un fallo.

`tests/unit/architecture.test.ts` (con `node:fs` y `node:path`): detector `/\bstockLevel\s*\.\s*(update|updateMany|create|createMany|upsert|delete|deleteMany)\s*\(/` y `/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+"?StockLevel"?/i`. Casos: (1) el detector marca `db.stockLevel.update(`, `tx.stockLevel.upsert(` y SQL crudo `UPDATE "StockLevel"` y no marca `db.stockLevel.findMany(`; (2) la lista de archivos `.ts` y `.tsx` de `src/` (sin `src/generated`) más `prisma/seed.ts` y `prisma/seed/**` incluye `src/lib/db.ts`; (3) ningún archivo de esa lista, salvo `src/modules/inventory/service.ts`, coincide con el detector (la ruta no se exige que exista).

`docs/DATA_MODEL.md` (el esquema real manda): (a) §2 subsección `### Session` (`sessionToken` único, `userId` con cascada, `expires`, `ip?`, `userAgent?`, compatible con Auth.js); (b) §2 `FiscalRange`: fila `terminalId` (`Terminal?`; null = rango general) y mención del índice parcial único de un rango activo por tipo y terminal; (c) §2 `### DocumentCounter` (`key` clave primaria, `nextValue` por defecto 1, incremento con bloqueo en la transacción del documento); (d) §2 `AuditLog`: índice `(action, createdAt)`; (e) §3 `Product`: fila `code` (`String @unique`, base del SKU) y `Category.slug` único; `Variant`: la restricción `(productId, sizeId, colorId)` es un índice único `NULLS NOT DISTINCT` de la migración `constraints`; (f) §4 `StockLevel`: **reemplaza** la frase "Check de BD: `onHand >= 0` …" por la decisión real: no hay CHECK de `onHand >= 0` (depende de `sales.allowNegativeStock` y se valida en `inventory.recordMovement`); sí CHECK `reserved >= 0`; `StockCount`: campo `scopeRef`; (g) §5: `GoodsReceipt.number` único; `PurchaseOrderItem` único en `(purchaseOrderId, variantId)`; `StockCountItem` único en `(stockCountId, variantId)`; (h) §6 `Sale` y §7 `ReturnDoc`: `@@unique([fiscalRangeId, fiscalNumber])`, y `ReturnDoc.fiscalNumber?` y `fiscalRangeId?`; (i) nueva `## 11. Restricciones de la migración constraints`: extensiones, índice único `NULLS NOT DISTINCT`, índices parciales de caja abierta y rango fiscal activo, CHECK de montos y cantidades, triggers `prevent_row_mutation` de solo inserción en `AuditLog`, `StockMovement` y `StoreCreditEntry`, índices trigram `gin` en `Product.name` y `Variant.sku`; (j) §10: nota que distingue la semilla mínima de la Fase 0 de la semilla de demostración grande de fases posteriores. `docs/ARCHITECTURE.md`: §2 filas nuevas o ajustadas (*Hash de contraseñas*: `@node-rs/argon2` (Argon2id), alternativa descartada `argon2`; *Tablas*: TanStack Table v8, no v9; *Tipografía*: Inter con `next/font/google`, alternativa Geist; *Driver de BD*: Prisma 7 con `@prisma/adapter-pg`; *Pruebas*: Vitest 5 (proyectos `unit` e `integration`) + Playwright (Chromium)); §12: filas con fecha `2026-10-23` para TanStack Table v8 sobre v9, `@node-rs/argon2`, Inter sobre Geist, Prisma 7 con `@prisma/adapter-pg` y cliente generado en `src/generated/prisma` (no versionado), Vitest con proyectos `unit` e `integration` contra `boutique_pos_test`, sin CHECK `onHand >= 0` en BD, `@types/node` en la línea 24, y galería `/dev/componentes` más Playwright en lugar de Storybook.

**Files**
- `tests/integration/invariants.test.ts` — new
- `tests/integration/helpers/invariants.ts` — new
- `tests/unit/architecture.test.ts` — new
- `docs/DATA_MODEL.md` — edit
- `docs/ARCHITECTURE.md` — edit

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization defined in `agents/blueprint-writer.md` *Acceptance strings*. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `findStockDiscrepancies` corre sobre una base vacía **THE SYSTEM SHALL** devolver una lista vacía.
2. **WHEN** dentro de una transacción se inserta un `StockMovement` `ADJUSTMENT_IN` de cantidad 5 sin fila de `StockLevel` **THE SYSTEM SHALL** reportar exactamente esa variante y ubicación con `movementSum` 5 y `onHand` 0, y tras revertir la transacción **THE SYSTEM SHALL** devolver una lista vacía.
3. **WHEN** el `StockLevel` coincide con la suma de movimientos **THE SYSTEM SHALL** no reportar discrepancias.
4. **WHEN** `pnpm test:integration` corre **THE SYSTEM SHALL** terminar con código 0 con los invariantes 2 a 7 de `docs/DATA_MODEL.md` como `it.todo` (pendientes, no fallidos).
5. **WHEN** `tests/unit/architecture.test.ts` corre **THE SYSTEM SHALL** fallar si `src` o `prisma/seed*` escriben `stockLevel` fuera de `src/modules/inventory/service.ts`, y pasar mientras ese archivo no exista.
6. **WHEN** `docs/DATA_MODEL.md` y `docs/ARCHITECTURE.md` se leen **THE SYSTEM SHALL** contener las adiciones nombradas por el paso (`Session`, `DocumentCounter`, `scopeRef`, `NULLS NOT DISTINCT`, `prevent_row_mutation`, TanStack Table v8, `@node-rs/argon2`, Inter, `@prisma/adapter-pg`) y no la frase obsoleta `Check de BD`.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:integration
pnpm test:unit
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm typecheck
pnpm format:check
grep -qF 'it.todo(' tests/integration/invariants.test.ts
grep -qF 'Sale.total' tests/integration/invariants.test.ts
grep -qF 'storeCreditCents' tests/integration/invariants.test.ts
grep -qF '### Session' docs/DATA_MODEL.md
grep -qF '### DocumentCounter' docs/DATA_MODEL.md
grep -qF 'scopeRef' docs/DATA_MODEL.md
grep -qF 'NULLS NOT DISTINCT' docs/DATA_MODEL.md
grep -qF 'prevent_row_mutation' docs/DATA_MODEL.md
status=0; grep -qF 'Check de BD' docs/DATA_MODEL.md || status=$?; test "$status" -eq 1
grep -qF 'TanStack Table v8' docs/ARCHITECTURE.md
grep -qF '@node-rs/argon2' docs/ARCHITECTURE.md
grep -qF '@prisma/adapter-pg' docs/ARCHITECTURE.md
grep -qE '\bInter\b' docs/ARCHITECTURE.md
grep -qF '2026-10-23' docs/ARCHITECTURE.md
status=0; grep -rnE '\.(skip|only)\(' tests/integration tests/unit || status=$?; test "$status" -eq 1
```

These lines are this task's `verify` **array** in `tasks.json`, one per line, copied with any exit-code wrapping intact.

**Checkpoint**

```bash
git add -A && git commit -m "chore(fase-0): E2-T8 invariants-docs"
git tag step-15-invariants-docs
git ls-files --error-unmatch tests/integration/invariants.test.ts
```

### `E2-T9` — CI, README y cierre de la Fase 0

**Depends on:** `E2-T1`, `E2-T7`, `E2-T8` · **Priority:** p1 — metadata for scope cuts, not a running order

Cierra la fase. Pines de acciones verificados el 2026-10-23: `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6` (lee `packageManager`; su entrada `cache: true` cachea el almacén de pnpm; no se usa `actions/cache`). `.github/workflows/ci.yml` (literal; `pnpm format` lo normaliza):

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  AUTH_SECRET: ci-only-secret-with-at-least-32-characters-0000
  APP_URL: http://localhost:3000
  TZ: America/Tegucigalpa
  DATABASE_URL: postgresql://boutique:ci-password@localhost:5432/boutique_pos?schema=public
  DATABASE_URL_TEST: postgresql://boutique:ci-password@localhost:5432/boutique_pos_test?schema=public

jobs:
  check:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: boutique
          POSTGRES_PASSWORD: ci-password
          POSTGRES_DB: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U boutique -d postgres"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
        with:
          cache: true
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:generate
      - name: Create databases and extensions
        env:
          PGPASSWORD: ci-password
        run: |
          psql -h localhost -U boutique -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE boutique_pos;' -c 'CREATE DATABASE boutique_pos_test;'
          for db in boutique_pos boutique_pos_test; do
            psql -h localhost -U boutique -d "$db" -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;' -c 'CREATE EXTENSION IF NOT EXISTS unaccent;'
          done
      - run: pnpm db:deploy
      - run: pnpm lint
      - run: pnpm exec eslint --max-warnings 0
      - run: pnpm exec next typegen
      - run: pnpm typecheck
      - run: pnpm format:check
      - run: pnpm test
      - run: pnpm test:coverage
      - run: pnpm build

  e2e:
    if: github.ref == 'refs/heads/main'
    needs: check
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: boutique
          POSTGRES_PASSWORD: ci-password
          POSTGRES_DB: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U boutique -d postgres"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
        with:
          cache: true
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:generate
      - name: Create databases and extensions
        env:
          PGPASSWORD: ci-password
        run: |
          psql -h localhost -U boutique -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE boutique_pos;' -c 'CREATE DATABASE boutique_pos_test;'
          for db in boutique_pos boutique_pos_test; do
            psql -h localhost -U boutique -d "$db" -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;' -c 'CREATE EXTENSION IF NOT EXISTS unaccent;'
          done
      - run: pnpm db:deploy
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
```

`tests/unit/ci-workflow.test.ts` lee `.github/workflows/ci.yml` como texto (`readFileSync`, sin dependencia de YAML) y afirma: contiene `runs-on: ubuntu-24.04`, `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`, `image: postgres:16-alpine`, `--health-cmd`, `DATABASE_URL_TEST:`, `AUTH_SECRET:`, `APP_URL:`, `pnpm exec playwright install --with-deps chromium`, `if: github.ref == 'refs/heads/main'`; y que cada una de estas líneas existe completa (regex `^\s*- run: <comando>$` con bandera `m`): `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm lint`, `pnpm exec eslint --max-warnings 0`, `pnpm exec next typegen`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm test:coverage`, `pnpm build`, `pnpm test:e2e` (la línea `pnpm test` exacta no se confunde con `pnpm test:coverage` ni con `pnpm test:e2e`).

`README.md`: antepone, antes del contenido actual, un bloque que empieza con `# Boutique POS — Desarrollo local`: requisitos (Node 24, pnpm 12.15, Docker con `docker compose`, git); primer arranque con `git clone`, `cp .env.example .env`, `pnpm install`, `pnpm db:generate`, `pnpm db:up`, `pnpm db:deploy`, `pnpm db:seed`, `pnpm dev` (`pnpm db:generate` es obligatorio: `src/generated` no se versiona y Prisma 7 no genera el cliente al migrar); la tabla de usuarios demo (`owner`, `manager`, `cashier`, `warehouse` con contraseña y PIN: `Demo-Propietario-2026`/`1111`, `Demo-Gerente-2026`/`2222`, `Demo-Cajero-2026`/`3333`, `Demo-Almacen-2026`/`4444`) marcada "solo desarrollo"; comandos de pruebas (`pnpm test`, `pnpm test:e2e`, `pnpm exec playwright install chromium`) y la nota de que, en un clon limpio, `pnpm exec next typegen` va antes de `pnpm typecheck`; una nota para detener otras pilas que usen el puerto 5432. Después una línea `---` y el contenido anterior del README sin cambios.

`CLAUDE.md` §2: la línea `- [ ] Fase 0 — Cimientos` pasa a `- [x] Fase 0 — Cimientos (YYYY-MM-DD)` con la fecha de hoy de la máquina (`date +%F`). El resto, incluida la marca `<!-- fase-0-blueprint -->` y §4, no cambia.

**Files**
- `.github/workflows/ci.yml` — new
- `tests/unit/ci-workflow.test.ts` — new
- `README.md` — edit: bloque "Desarrollo local" antepuesto
- `CLAUDE.md` — edit: marca la Fase 0 con la fecha de hoy

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization defined in `agents/blueprint-writer.md` *Acceptance strings*. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `tests/unit/ci-workflow.test.ts` corre **THE SYSTEM SHALL** comprobar en `.github/workflows/ci.yml` el runner `ubuntu-24.04`, los pines `actions/checkout@v7`, `actions/setup-node@v7` y `pnpm/action-setup@v6`, y los comandos de la puerta.
2. **WHEN** `ci.yml` se lee **THE SYSTEM SHALL** declarar el servicio `postgres:16-alpine` con chequeo de salud y las variables `DATABASE_URL`, `DATABASE_URL_TEST`, `AUTH_SECRET` y `APP_URL`.
3. **WHEN** `ci.yml` se lee **THE SYSTEM SHALL** ejecutar el trabajo `e2e` solo en `main` con `pnpm exec playwright install --with-deps chromium` y `pnpm test:e2e`.
4. **WHEN** `README.md` se lee **THE SYSTEM SHALL** empezar con la sección `Desarrollo local` con los comandos de clonado a `pnpm dev` y la tabla de usuarios demo, conservando el contenido previo debajo.
5. **WHEN** `CLAUDE.md` se lee **THE SYSTEM SHALL** marcar `- [x] Fase 0 — Cimientos` con la fecha de hoy en formato `YYYY-MM-DD` y conservar la marca `fase-0-blueprint`.
6. **WHEN** `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test` y `pnpm build` corren **THE SYSTEM SHALL** terminar con código 0 en los cinco.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:unit
grep -Eq '^- \[x\] Fase 0 .{1,3} Cimientos \([0-9]{4}-[0-9]{2}-[0-9]{2}\)$' CLAUDE.md
grep -q 'fase-0-blueprint' CLAUDE.md
head -n 1 README.md | grep -qF 'Desarrollo local'
grep -qF 'pnpm db:generate' README.md
grep -qF 'Demo-Cajero-2026' README.md
grep -qF 'Paquete de contexto' README.md
test -f .github/workflows/ci.yml
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm typecheck
pnpm format:check
pnpm test
pnpm build
```

These lines are this task's `verify` **array** in `tasks.json`, one per line, copied with any exit-code wrapping intact. El guion largo de `Fase 0 — Cimientos` ocupa 1 carácter (o 3 bytes): por eso el patrón usa `.{1,3}`.

**Checkpoint**

```bash
git add -A && git commit -m "chore(fase-0): E2-T9 ci-readme-close"
git tag step-16-ci-readme-close
git ls-files --error-unmatch .github/workflows/ci.yml
test -z "$(git status --porcelain)"
```

---

## Epic acceptance

The epic is done when every task is `done` **and**:

1. **WHEN** `pnpm db:up`, `pnpm db:deploy`, `pnpm db:seed` y el servidor de desarrollo arrancan desde el estado actual **THE SYSTEM SHALL** responder 200 en `/api/health`, comprobado con `smoke-server dev`.
2. **WHEN** `pnpm test`, `pnpm test:coverage` y `pnpm test:e2e` corren **THE SYSTEM SHALL** terminar con código 0.

```bash
pnpm db:up
pnpm db:deploy
pnpm db:seed
pnpm lint
pnpm exec eslint --max-warnings 0
pnpm exec next typegen
pnpm typecheck
pnpm format:check
pnpm test
pnpm test:coverage
pnpm test:e2e
pnpm exec tsx scripts/smoke-server.ts dev 3191 /api/health=200:ok
```

Run from the project root, one command per line, each exiting 0. Both criteria are decided by exactly these commands: criterion 1 by `db:up`, `db:deploy`, `db:seed` and the `smoke-server dev` line, criterion 2 by `test`, `test:coverage` and `test:e2e` (the global gate with every check is §20.1 of `blueprint.md`).

## Pitfalls

- **`.next` mezclado entre builds** — `pnpm test:e2e` reconstruye `.next` con `NEXT_PUBLIC_COMPONENT_GALLERY=enabled`. Nunca despliegues ni arranques con `pnpm start` un `.next` salido de un E2E: vuelve a correr `pnpm build`.
- **`playwright.config.ts` demasiado pronto** — con el archivo en la raíz antes de instalar `@playwright/test`, `pnpm typecheck` falla; por eso solo se copia en la tarea 7.
- **`git mv` sin directorio destino** — `git mv` no crea `src/app/(app)/`: en `E2-T5` escribe primero `src/app/(app)/layout.tsx` y solo después mueve la página.
- **Tipos obsoletos de `next dev` tras mover la página** — `.next/dev/types` conserva la ruta vieja `src/app/page.tsx` hasta que `next dev` los regenera y `pnpm typecheck` los incluye; por eso la línea `smoke-server … dev 3191` de `E2-T5` va antes de `pnpm lint` y `pnpm typecheck`.
- **Datos de petición en un layout** — con Cache Components, `cookies()` o `headers()` en `(app)/layout.tsx` rompe el build; el layout es estático.
- **`export const dynamic`** — error de build; el health se hace dinámico con `connection()`.
- **Hex en mayúsculas en CSS** — Prettier puede reescribirlos; los tokens van en minúsculas y los greps de `Verify` ignoran el caso (`-i`).
- **Reiniciar contadores en la semilla** — viola `CLAUDE.md` §6.8; el `upsert` de `DocumentCounter` usa `update` vacío.
- **Rutas con alias fuera de Vitest/Next** — `prisma/seed.ts`, `scripts/` y las especificaciones E2E usan rutas relativas.
- **`reset` frente a `retry` en `error.tsx`** — usa `retry` (vuelve a pedir los datos); `reset` solo limpia el estado de error.
- **`ERR_PNPM_IGNORED_BUILDS`** — léelo del mensaje; nunca `dangerouslyAllowAllBuilds`. El repo ya decide `prisma`, `@prisma/engines` y `esbuild` (todos `false`, commit `6ea1527`); solo un paquete nuevo con script de instalación necesitaría una entrada.
- **Aviso de Vite en cada corrida de Vitest** — «(!) Your Vite config uses features that are unsupported by `configLoader: 'native'` …» es esperado e inocuo (sale con 0): no renombres `vitest.config.ts` ni añadas `"type": "module"` a `package.json`.

## Before moving on

- [ ] Every task in this epic is `done` in `tasks.json` — no task left `in_progress`.
- [ ] Every `verify` command of every task in this epic passed, not just the first one.
- [ ] No `verify` command was edited, and none was skipped because a file it names did not exist.
- [ ] **Every task in this epic has its `checkpoint` tag in version control** — one tag per task, matching the `checkpoint` value in `tasks.json`. `git tag -l 'step-*'` lists them.
- [ ] Gate command passes clean, run from the project root.
- [ ] Every "Produced" contract above exists with the stated signature.
- [ ] No file outside the subtree was modified.
- [ ] `.env.example` quedó sin cambios en esta épica (el Bootstrap ya añadió `DATABASE_URL_TEST`; `NEXT_PUBLIC_COMPONENT_GALLERY` no va ahí a propósito).
- [ ] One commit per task, each message `feat(fase-0): <task id> <slug>` (`chore(fase-0): <task id> <slug>` for `E2-T8` and `E2-T9`, which add documents, a guard test and CI instead of a feature), each followed by its checkpoint tag.
