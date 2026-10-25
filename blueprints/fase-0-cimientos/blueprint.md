# Boutique POS — Fase 0: Cimientos — Blueprint

> Generado por The Architect el 2026-10-23
> Shape: internal-tool (la más cercana; el proyecto es un híbrido internal-tool / saas-webapp) · `knowledge/shapes/internal-tool.md`
> Runtime track: ts-node · `knowledge/runtime-tracks/ts-node.md` (los pines del lockfile del repo mandan sobre el track: regla 3 de brownfield)
> Emission mode: bundle
> Blueprint version: 1
> Versions last verified: 2026-10-23 — ver §11 para la procedencia por paquete
> Tipo de cambio: brownfield. Completa la Fase 0 de `docs/ROADMAP.md` sobre el scaffold existente (HEAD `6ea1527`; el esquema y el entorno vienen del commit `fca87b5`).

**Cómo leer este bundle.** `blueprint.md` explica el porqué y fija el orden (§9). `tasks.json` es la cola ejecutable (un paso de §9 = una tarea). `epics/` contiene las dos épicas autosuficientes. `workspace/` se copia a la raíz del repo con el bloque de Bootstrap de §10 (copia que no pisa archivos existentes). El bundle vive dentro del repo que modifica (`blueprints/fase-0-cimientos/`) para que todos los comandos de verificación corran contra este repo; no lo muevas.

---

## 1. Project Overview & Non-Goals

### Vision
Boutique POS es el sistema de inventario y punto de venta de una boutique de ropa en Honduras (una tienda hoy, varias mañana). La Fase 0 no agrega funciones de negocio: entrega el suelo firme sobre el que se construye todo lo demás, para que el dinero y el inventario nunca se descuadren. Eso significa librerías puras y probadas (dinero en centavos con redondeo único, fechas en `America/Tegucigalpa`, errores tipados, permisos por capacidades, auditoría de solo inserción, hash de contraseñas), una infraestructura de pruebas contra Postgres real, una semilla mínima, un `/api/health`, un shell de aplicación con componentes compartidos y un CI.

El scaffold ya existe y está congelado: proyecto Next.js 16, shadcn inicializado, Docker Compose con la BD de pruebas, validación de entorno, cliente Prisma 7 y el esquema completo de 39 modelos con sus dos migraciones. Este blueprint termina lo que falta de la Fase 0 sin tocar esas piezas. Ningún otro producto del mercado comparte esta combinación de decisiones: es una boutique hondureña con ISV 15 % incluido, rango CAI, tallas × colores y cajeros sin formación técnica; si cambias "boutique" por "ferretería" casi todo lo anterior seguiría igual, pero las reglas de dominio de `CLAUDE.md` §6 y el tono de `docs/UX.md` §10 no.

### Current state
Mapa del repo leído antes de diseñar (los pines del lockfile mandan; ver §11):

| Aspecto | Estado real |
|---|---|
| Runtime y gestor | Node 24.22.1, `pnpm@12.15.0` (`packageManager`), TypeScript 5.9.3 con `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `isolatedModules`, `moduleResolution: "bundler"`, alias `@/*` → `src/*` |
| Framework | Next.js 16.4.2 App Router, React 19.3.0. `next.config.ts` activa `cacheComponents: true` y `partialPrefetching: true`; Tailwind entra por el loader `@tailwindcss/turbopack` |
| Datos | Prisma 7.10.1 + `@prisma/adapter-pg`; cliente generado en `src/generated/prisma` (ignorado por git, se regenera con `pnpm db:generate`); `prisma/schema.prisma` con 39 modelos; migraciones `20261023000000_init` y `20261023000100_constraints` (índices parciales, CHECK, triggers de solo inserción en `AuditLog`, `StockMovement` y `StoreCreditEntry`, índices trigram); `prisma.config.ts` ya declara `migrations.seed: "tsx prisma/seed.ts"` |
| Servicios locales | `docker-compose.yml` (proyecto `boutique-pos`, `postgres:16-alpine`, `127.0.0.1:5432`, healthcheck) y `docker/postgres/init/01-extensions-and-test-db.sh`, que crea `boutique_pos_test` y las extensiones `pg_trgm` y `unaccent` al crear el volumen |
| Entorno | `src/lib/env.ts` (Zod): `NODE_ENV`, `DATABASE_URL`, `AUTH_SECRET` (mín. 32), `APP_URL`, `TZ`; exporta `parseEnv`, `env`, `Env`. `src/lib/db.ts` exporta `db` |
| Lint y formato | ESLint 9 con `eslint-config-next` y Prettier 3 (`semi`, comillas dobles, `trailingComma: "all"`, `printWidth: 100`, `prettier-plugin-tailwindcss`). No hay Biome |
| UI | Tailwind 4.3.3 (config en CSS), shadcn estilo `base-nova` sobre Base UI; solo existe `src/components/ui/button.tsx`; `src/app/page.tsx` es la plantilla de Next |
| Pruebas y CI | Ninguno: `tests/unit`, `tests/integration` y `tests/e2e` solo contienen `.gitkeep`; no hay `.github/` |
| Scripts de `package.json` | `dev`, `build`, `start`, `lint` (`eslint`), `typecheck` (`tsc --noEmit`), `format`, `format:check`, `db:up` (`docker compose up -d --wait`), `db:down`, `db:generate`, `db:migrate`, `db:deploy`, `db:seed` (`prisma db seed`), `db:reset` (`prisma migrate reset --force`) |
| Instrucciones de agente | `CLAUDE.md` (11 reglas de dominio inviolables) y `AGENTS.md` (bloque `nextjs-agent-rules`: leer `node_modules/next/dist/docs/` antes de escribir código de Next) |
| Instalación de dependencias (`pnpm-workspace.yaml`) | `allowBuilds` con cinco decisiones, todas `false`: `"@prisma/engines"`, `esbuild`, `prisma`, `sharp` y `unrs-resolver`. Las tres primeras las añadió el commit `6ea1527` (`fix(deps): decide install scripts for prisma, @prisma/engines and esbuild`): pnpm 12 exige una decisión de `allowBuilds` por cada dependencia con script de instalación y, sin ellas, `pnpm install --frozen-lockfile` aborta con `ERR_PNPM_IGNORED_BUILDS` en un clon limpio. Con `false`, `pnpm db:generate`, `prisma migrate deploy` y `tsx` funcionan (comprobado en un clon limpio) |
| Historial del repo | HEAD `6ea1527`, sobre `b1cabde` (cuatro skills de agente), `fca87b5` (Docker, entorno y esquema Prisma) y `1e1430f` (scaffold y documentos) |

Convenciones que este cambio debe respetar (de `CLAUDE.md` y del repo): (1) dinero siempre en centavos enteros vía `src/lib/money.ts`; (2) los textos de interfaz viven en `src/config/messages.es.ts`; (3) las páginas nunca llaman a Prisma; (4) archivos en `kebab-case`, componentes en `PascalCase`; (5) cada regla de negocio nueva lleva prueba y las de dinero o stock se prueban contra Postgres real.

Hechos de entorno que condicionan el diseño: Windows 11 en desarrollo y Linux en CI (los comandos de Bootstrap y Verify son POSIX sh, ejecutables en Git Bash); `cacheComponents` prohíbe `export const dynamic`, `revalidate` y `fetchCache`, exige `<Suspense>` alrededor de datos de petición en un layout, y hace que un `GET` que consulta la BD corra en tiempo de petición; `middleware` se llama `proxy` (no se usa en esta fase); `pnpm-workspace.yaml` declara `allowBuilds` para cinco paquetes (`"@prisma/engines"`, `esbuild`, `prisma`, `sharp` y `unrs-resolver`, todos `false`; commit `6ea1527`), de modo que cualquier paquete con script de instalación nuevo detendría `pnpm install` con `ERR_PNPM_IGNORED_BUILDS` hasta que se decida; una máquina sin identidad de git (ni `user.name` y `user.email` ni las variables `GIT_AUTHOR_*` y `GIT_COMMITTER_*`) no puede hacer commits y el primer Checkpoint moriría con "Author identity unknown", así que el Bootstrap lo comprueba antes del primer commit (§10).

### Target state
Al terminar la Fase 0, desde un clon limpio: `pnpm install`, `pnpm db:up`, `pnpm db:deploy`, `pnpm db:seed` y `pnpm dev` levantan la app con el shell (barra lateral con "Inicio", barra superior, estados de carga, error y no encontrado) y `/api/health` responde 200. Existen `src/lib/{errors,action-result,dates,money,format,permissions,password,audit,health}.ts`, `src/config/messages.es.ts`, la semilla mínima, los componentes `PageHeader`, `EmptyState`, `ConfirmDialog`, `MoneyInput` y `DataTable`, una galería de desarrollo para ejercitarlos, Vitest 5 con proyectos `unit` e `integration`, Playwright, el test de invariante de stock y un workflow de GitHub Actions. `CLAUDE.md` marca la Fase 0 como hecha con la fecha real.

### Users
| Persona | What they come to do | Frequency |
|---|---|---|
| Desarrollador/a (humano o Claude Code) | Construir las fases siguientes sobre librerías probadas y un CI confiable | diaria |
| Cajero/a (en fases siguientes) | Usar el shell, los estados y el formato de dinero que esta fase fija | diaria |
| Propietario/a | Ver que el sistema levanta, tiene usuarios demo por rol y datos base coherentes | una vez por fase |

### Goals — v1 scope
1. El repo tiene librerías de dominio puras con pruebas: dinero (suma, porcentaje, ISV incluido 15 %, prorrateo sin perder centavos), fechas, errores, permisos por capacidades y auditoría.
2. Las pruebas de integración corren contra un Postgres real aislado (`boutique_pos_test`) y comprueban que `AuditLog` es de solo inserción.
3. Una base recién migrada se puede sembrar de forma repetible con usuarios por rol, ubicación, terminal, tallas, colores, categorías, ajustes y contadores.
4. La app arranca con un shell de aplicación accesible, estados de carga, error y vacío, y un `/api/health` que no filtra detalles.
5. Playwright y un workflow de CI ejecutan lint, typecheck, formato, pruebas y build; existe el test del invariante `Σ StockMovement = StockLevel`.
6. La documentación (`docs/`) refleja el esquema y el stack reales.

### Non-Goals — explicitly out of scope for v1

| Not building | Why not now | Revisit when |
|---|---|---|
| Login, Auth.js, sesiones y pantalla de acceso | La autenticación necesita pantallas, rate limiting y decisiones de `docs/DECISIONS_PENDING.md`; la Fase 0 solo fija `permissions.ts` y el hash de contraseñas | Fase 1 |
| Pantallas de negocio y navegación más allá de "Inicio" | Cada módulo aparece en su propia fase con sus propios criterios | cada fase de módulo |
| `src/lib/settings.ts` (lectura tipada de `Setting`) | La Fase 0 solo siembra las filas; el helper tipado depende del módulo de configuración | Fase 1 |
| Semilla grande (productos, ventas de 12 meses, clientes) | Depende del catálogo y de las ventas, que aún no existen | Fase 5 (productos demo desde Fase 1) |
| Interruptor de modo oscuro | Los tokens oscuros se definen ahora; el interruptor y su prueba visual son de endurecimiento | Fase 6 |
| Storybook y pruebas de componentes con jsdom | Dos herramientas nuevas para cinco componentes; una galería de desarrollo más Playwright cubre el mismo riesgo | si los componentes compartidos pasan de 15 |
| Despliegue a producción, seguimiento de errores y `pnpm audit` en CI | Sin producción que proteger todavía; es trabajo de la Fase 6 | Fase 6 |
| Cambios al esquema Prisma o a las migraciones | Congelados: ya están revisados contra `docs/DATA_MODEL.md` | solo con una necesidad de producto documentada |
| Interfaz congelada: esquema Prisma y las dos migraciones | Toda la fase depende de ellos | ver fila anterior |
| Interfaz congelada: superficie pública de `src/lib/env.ts` (`parseEnv`, `env`, `Env`) y la exportación `db` de `src/lib/db.ts` | Los demás módulos ya importan esas firmas | se amplía solo por adición, en la fase que lo necesite |
| Interfaz congelada: nombres de los scripts existentes de `package.json` (`dev`, `build`, `start`, `lint`, `typecheck`, `format`, `format:check`, `db:up`, `db:down`, `db:generate`, `db:migrate`, `db:deploy`, `db:seed`, `db:reset`) | `CLAUDE.md` §4 y el README los documentan; se pueden cambiar sus comandos (solo `db:reset` cambia) pero no sus nombres | nunca sin actualizar `CLAUDE.md` §4 |
| Interfaz congelada: las 11 reglas de dominio de `CLAUDE.md` §6 y las versiones de `next`, `react`, `react-dom`, `prisma`, `@prisma/client`, `@prisma/adapter-pg`, `zod` y `tailwindcss` | Un error aquí descuadra caja o inventario; las versiones están verificadas con el lockfile | una necesidad documentada en un cambio aparte |
| Interfaz congelada: `pnpm-workspace.yaml` (las cinco decisiones de `allowBuilds`, todas `false`, commit `6ea1527`) | pnpm 12 aborta la instalación con `ERR_PNPM_IGNORED_BUILDS` si una dependencia con script de instalación no tiene decisión; el archivo se mantiene constante salvo por las entradas de `allowBuilds` de paquetes nuevos que esta fase añada, y ninguno lo necesita | solo se amplía con la entrada de un paquete nuevo que de verdad necesite su script de instalación (con nota en §20.3) |
| Interfaz congelada: el campo `type` de `package.json` (hoy ausente, es decir CommonJS) y el nombre `vitest.config.ts` | Cada referencia a `vitest.config.ts` del bundle, de los gates y de la documentación depende de él; cambiarlos por el aviso inocuo de Vite descrito en §19.6 costaría más que el aviso | ver la fila 21 de §20.3 |

**El builder no debe implementar nada de esta tabla**, aunque parezca una adición pequeña mientras trabaja en un paso vecino. Si un paso parece exigir algo de esta tabla, es un defecto del blueprint: detente y repórtalo.

### Success metrics
| Metric | Target | How measured |
|---|---|---|
| La puerta global de §20.1 sale con código 0 en un clon limpio | 100 % de los comandos | ejecutar el bloque de §20.1 y revisar cada código de salida |
| Cobertura por archivo de `src/lib/money.ts` | 100 % líneas, sentencias y funciones; 95 % ramas | `pnpm test:coverage` sale con 0 (umbrales en `vitest.config.ts`) |
| Etiquetas de rollback | una por paso, 16 en total, todas presentes | las 16 líneas `git rev-parse --verify --quiet` de §20.1 |
| CI del workflow en verde en GitHub tras el primer push | 1 ejecución verde de `check` | pestaña Actions (lista de lanzamiento de §20.1, requiere GitHub) |

---

## 2. Tech Stack

**Runtime track: ts-node (Next.js 16).** Esta tabla nombra decisiones, no versiones. Todo pin vive en §11. El lockfile del repo manda sobre `knowledge/runtime-tracks/ts-node.md`: el track recomienda Biome, TypeScript 6 y React 19.3.1, pero el repo usa ESLint + Prettier, TypeScript 5.9.3 y React 19.3.0, y esta fase no los cambia (§20.3, fila 1).

| Layer | Choice | Why this, over what |
|---|---|---|
| Language / runtime | TypeScript estricto sobre Node 24 | Ya decidido en `CLAUDE.md` §3; Node 24 es el LTS vigente y el requisito de Vitest 5 y Vite 8 |
| Framework | Next.js App Router con Cache Components | Ya instalado; un solo despliegue (monolito modular) en vez de SPA + API |
| Styling | Tailwind CSS 4 (config en CSS) | Ya instalado; tokens como variables CSS para cambiar la marca en un solo lugar (`docs/UX.md` §8) |
| Component layer | shadcn/ui estilo `base-nova` sobre Base UI + lucide-react | Ya inicializado; copia el código al repo y es accesible; frente a MUI o AntD, evita el aspecto de ERP gris |
| Database | PostgreSQL 16 | Índices parciales, `pg_trgm` y triggers que ya usa la migración `constraints` |
| ORM / data access | Prisma 7 con `@prisma/adapter-pg` | Ya instalado; las pruebas de integración usan el mismo adaptador contra la BD de pruebas |
| Auth | NOT APPLICABLE en esta fase | Auth.js llega en la Fase 1; aquí solo se entregan capacidades (`permissions.ts`) y hash (`password.ts`) |
| Background work | NOT APPLICABLE | Sin trabajos en segundo plano en el MVP |
| Payments | NOT APPLICABLE | El cobro con tarjeta es por terminal externa; no hay pasarela |
| File storage | NOT APPLICABLE | Las imágenes de producto son de la Fase 1 |
| Email / notifications | NOT APPLICABLE | Fuera del alcance del MVP |
| Hosting | NOT APPLICABLE en esta fase | Decisión de la Fase 6 (`docs/DECISIONS_PENDING.md` #21) |
| Test runners | Vitest 5 (proyectos `unit` e `integration`) y Playwright | Vitest ya figura en `CLAUDE.md` §3; los proyectos separan pruebas puras de las que usan Postgres real; frente a Jest, comparte el resolvedor de Vite |
| Hash de contraseñas | `@node-rs/argon2` (Argon2id) | Binarios precompilados para Windows y Linux; frente a `argon2`, no compila código nativo con node-gyp en la máquina de desarrollo |
| Tablas | TanStack Table 8.21.3 | v9 es una reescritura cuya guía para shadcn no está verificada (§20.3, fila 2) |
| Package manager | pnpm 12.15 | Ya fijado en `packageManager`; el gate usa `--frozen-lockfile` |

### Compatibility check
Checked against `knowledge/stack-compatibility.md`: ninguna de las filas de "Known-bad combinations" aplica a esta pila (un solo gestor de migraciones, Prisma; Tailwind sin CSS-in-JS en runtime; ESLint no analiza CSS; el driver TCP corre en el runtime Node de las rutas, no en edge; una sola librería de autenticación, que aún no existe). Los Gotchas del track que sí aplican y que este blueprint arrastra: pnpm 11+ aborta `install` con `ERR_PNPM_IGNORED_BUILDS` si una dependencia nueva trae script de instalación (mitigado en §20.2, riesgo 3); `middleware.ts` pasó a ser `proxy.ts` (no se usa); Turbopack es el bundler de `dev` y `build`; `next/font` no añade `font-display` a las caras de reserva, por eso la prueba de fuentes mira la llamada a `Inter` y no el CSS construido.

---

## 3. Directory Structure

```
boutique-pos/
  CLAUDE.md                          # existente; el Bootstrap añade la marca y §11 (workspace/CLAUDE.md)
  AGENTS.md                          # existente; el Bootstrap añade la marca y una línea (workspace/AGENTS.md)
  README.md                          # paso 16 antepone "Desarrollo local"
  package.json                       # pasos 1, 6, 8, 10 y 14 añaden dependencias y scripts
  vitest.config.ts                   # NUEVO, emitido en workspace/ (dos proyectos: unit, integration)
  playwright.config.ts               # NUEVO, emitido en workspace/; se copia en el paso 14 (necesita @playwright/test)
  eslint.config.mjs                  # existente; el Bootstrap añade ignores (blueprints, coverage, test-results, playwright-report)
  tsconfig.json                      # existente; el Bootstrap añade "blueprints" a exclude
  .prettierignore                    # existente; el Bootstrap añade blueprints, .claude y AGENTS.md
  .gitignore                         # existente; el Bootstrap añade /test-results/ y /playwright-report/
  .env.example                       # existente; el Bootstrap añade DATABASE_URL_TEST
  .github/workflows/ci.yml           # NUEVO, paso 16
  .claude/                           # NUEVO, workspace: settings.json, skills/ (2), rules/ (2)
  blueprints/fase-0-cimientos/       # este bundle (se versiona; todas las herramientas lo excluyen)
  docker-compose.yml                 # existente, congelado
  docker/postgres/init/              # existente, congelado (crea boutique_pos_test)
  prisma/
    schema.prisma                    # existente, congelado
    migrations/                      # existente, congelado
    seed.ts                          # NUEVO, paso 8 (entrada de `prisma db seed`)
    seed/run-seed.ts                 # NUEVO, paso 8 (runSeed(client), idempotente)
  scripts/smoke-server.ts            # NUEVO, emitido en workspace/ (arranca next start|dev y comprueba rutas)
  docs/                              # pasos 4 (UX.md) y 15 (DATA_MODEL.md, ARCHITECTURE.md)
  src/
    app/
      layout.tsx                     # existente; paso 11 cambia Geist por Inter
      globals.css                    # existente; paso 11 define los tokens de §7
      loading.tsx  error.tsx  not-found.tsx   # NUEVOS, paso 12
      (app)/
        layout.tsx                   # NUEVO, paso 12: barra lateral + barra superior
        page.tsx                     # NUEVO, paso 12 (mueve src/app/page.tsx): Inicio
        dev/componentes/page.tsx     # NUEVO, paso 14: galería solo de desarrollo
      api/health/route.ts            # NUEVO, paso 9
    components/
      ui/                            # shadcn; paso 10 añade nueve primitivas
      shared/                        # NUEVO, paso 13: page-header, empty-state, confirm-dialog, money-input, data-table
    config/messages.es.ts            # NUEVO, paso 2
    hooks/use-mobile.ts              # NUEVO, paso 10 (lo copia el CLI de shadcn)
    lib/
      env.ts  db.ts  utils.ts        # existentes, congelados
      errors.ts  action-result.ts    # NUEVOS, paso 2
      dates.ts                       # NUEVO, paso 3
      money.ts                       # NUEVO, pasos 4 y 5
      format.ts                      # NUEVO, paso 5
      permissions.ts  password.ts    # NUEVOS, paso 6
      audit.ts                       # NUEVO, paso 7
      health.ts                      # NUEVO, paso 9
    generated/prisma/                # generado por `pnpm db:generate`; ignorado por git
  tests/
    unit/                            # pasos 1-6, 15, 16 (+ helpers/prng.ts)
    integration/                     # global-setup.ts y helpers/db.ts (workspace); tests de los pasos 7, 8, 9, 15; helpers/invariants.ts
    e2e/                             # paso 14: shell.spec.ts, components.spec.ts
```

**Boundary rules**
- `src/app/**` solo compone: no importa `@/lib/db` ni Prisma. Los únicos archivos de `src/app` que tocan la BD en esta fase son `api/health/route.ts` (a través de `@/lib/health`).
- `src/components/shared/**` no importa nada de `src/modules` ni de `src/lib/db`; recibe datos por props.
- Solo `src/modules/inventory/service.ts` (que aún no existe) podrá escribir `StockLevel`; el test de arquitectura del paso 15 lo impone desde hoy.
- `tests/integration/**` solo toca la BD `boutique_pos_test` (guardia `assertTestDatabaseUrl`).
- Convención de resolución de imports (alias `@/`, rutas relativas en scripts y E2E): se decide una vez y se reconcilia contra cada cargador en la matriz de §19.6; no se repite aquí.

**Cada ruta de salida dibujada en este árbol** (`/api/health`, `/dev/componentes`) es el mismo valor que usan los comandos de §9 y §20.1; las compara la tabla de reconciliación de §19.6.

### Delta
| Acción | Archivos |
|---|---|
| Añadidos | `vitest.config.ts`, `playwright.config.ts`, `scripts/smoke-server.ts`, `tests/integration/global-setup.ts`, `tests/integration/helpers/db.ts`, `.claude/**` (emitidos en `workspace/`); `src/lib/{errors,action-result,dates,money,format,permissions,password,audit,health}.ts`, `src/config/messages.es.ts`, `prisma/seed.ts`, `prisma/seed/run-seed.ts`, `src/app/{loading,error,not-found}.tsx`, `src/app/(app)/layout.tsx`, `src/app/api/health/route.ts`, `src/app/(app)/dev/componentes/page.tsx`, `src/components/shared/*.tsx` (cinco), nueve primitivas en `src/components/ui/`, `src/hooks/use-mobile.ts`, `.github/workflows/ci.yml` y todos los archivos de `tests/` de cada paso |
| Modificados | `package.json` (dependencias y scripts), `src/app/layout.tsx`, `src/app/globals.css`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/UX.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, y en el Bootstrap `eslint.config.mjs`, `tsconfig.json`, `.prettierignore`, `.gitignore`, `.env.example` |
| Movidos | `src/app/page.tsx` → `src/app/(app)/page.tsx` (`git mv`, paso 12) |
| Eliminados | ninguno |

---

## 4. Data Model

### Current state
El modelo no cambia en esta fase. `prisma/schema.prisma` define 39 modelos (contados del archivo) y las migraciones `20261023000000_init` y `20261023000100_constraints` ya están aplicables. Las tablas que esta fase usa directamente:

| Tabla | Uso en la Fase 0 | Restricción relevante (migración `constraints`) |
|---|---|---|
| `AuditLog` | Paso 7 (`audit.log`) | Triggers `BEFORE UPDATE OR DELETE` → excepción `La tabla "AuditLog" es de solo inserción: UPDATE no permitido` (o `DELETE`), SQLSTATE `restrict_violation` (23001) |
| `StockMovement`, `StockLevel` | Paso 15 (invariante 1) | `StockMovement` es de solo inserción y `quantity <> 0`; `StockLevel.reserved >= 0`; **no hay** CHECK de `onHand >= 0` (decisión de diseño: depende de `sales.allowNegativeStock`, se valida en `inventory.recordMovement`) |
| `User`, `Location`, `Terminal`, `Size`, `Color`, `Category`, `BusinessProfile`, `Setting`, `DocumentCounter` | Paso 8 (semilla) | `User.username` único; `Location.code` único; `Size.name`, `Color.name` únicos; `Category.slug` único; `Setting.key` único; `DocumentCounter.key` es la clave primaria |
| Todas las tablas de aplicación | Pasos 7 a 15 (`resetDatabase()`) | `TRUNCATE ... RESTART IDENTITY CASCADE` no dispara los triggers de fila; `_prisma_migrations` nunca se trunca |

### Delta
Ninguno. Esta fase no añade modelos, campos, índices ni migraciones (fila congelada de §1). El único cambio de datos es la **siembra** (§4 "Seed data").

### Relationships
Sin cambios. Para la semilla: `Terminal` —(N:1)→ `Location`; `Category` —(N:1 opcional)→ `Category` (padre); `AuditLog` —(N:1 opcional)→ `User`. Ningún borrado en cascada se ejerce en esta fase (la semilla solo hace upserts).

### Indexes
Sin cambios. Los índices ya existentes que las pruebas ejercitan: unicidad de `User.username`, de `Location.code`, de `Category.slug` y de `Setting.key`.

### Schema
Sin cambios; la fuente es `prisma/schema.prisma` (congelado). Extractos que los pasos 7, 8 y 15 necesitan, copiados del archivo:

```prisma
model AuditLog {
  id         String   @id @default(cuid())
  userId     String?
  action     String
  entityType String
  entityId   String
  before     Json?
  after      Json?
  reason     String?
  ip         String?
  createdAt  DateTime @default(now())

  user User? @relation(fields: [userId], references: [id])

  @@index([entityType, entityId])
  @@index([userId, createdAt])
  @@index([action, createdAt])
}

model DocumentCounter {
  key       String   @id // "SALE", "RETURN", "LAYAWAY", "PURCHASE_ORDER", ...
  nextValue Int      @default(1)
  updatedAt DateTime @updatedAt
}

model Setting {
  id        String   @id @default(cuid())
  key       String   @unique
  valueJson Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model StockLevel {
  id         String   @id @default(cuid())
  variantId  String
  locationId String
  onHand     Int      @default(0)
  reserved   Int      @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([variantId, locationId])
  @@index([locationId])
}

model StockMovement {
  id            String            @id @default(cuid())
  variantId     String
  locationId    String
  type          StockMovementType
  quantity      Int
  unitCostCents Int               @default(0)
  refType       String?
  refId         String?
  reason        String?
  userId        String
  createdAt     DateTime          @default(now())

  @@index([variantId, locationId, createdAt])
  @@index([refType, refId])
  @@index([userId, createdAt])
}
```

### Migrations
Herramienta: Prisma 7 (`prisma migrate`). Esta fase **no genera migraciones**. Reglas vigentes: en local `pnpm db:migrate` (`prisma migrate dev`); en CI, pruebas y despliegue `pnpm db:deploy` (`prisma migrate deploy`); nunca `db push`. Prisma 7 no ejecuta `generate` ni `seed` automáticamente tras migrar: por eso el Bootstrap llama `pnpm db:generate` explícitamente y `db:reset` se redefine en el paso 8 como `prisma migrate reset --force && pnpm db:seed`. Las pruebas de integración aplican las migraciones a la BD de pruebas con `prisma migrate deploy` en el `globalSetup` de Vitest (§19.6).

### Seed data
Archivos: `prisma/seed.ts` (entrada de `prisma db seed`, que `prisma.config.ts` ya apunta con `tsx prisma/seed.ts`) y `prisma/seed/run-seed.ts` (`runSeed(client)`, idempotente). Comando: `pnpm db:seed`. Contenido mínimo y fechas de referencia en el paso 8; las credenciales demo están escritas literalmente en §10 y en el código de la semilla, solo para desarrollo. La semilla **se niega a correr con `NODE_ENV=production`**.

---

## 5. API Design

### Conventions
- Base path: la Fase 0 solo expone `GET /api/health`. Las mutaciones del producto son server actions (no hay API REST pública en el MVP; `docs/ARCHITECTURE.md` §4 limita `src/app/api` a health, exportaciones e impresión).
- Response envelope de las server actions (se fija aquí y vive en `src/lib/action-result.ts`): éxito `{ ok: true, data }`; error `{ ok: false, error: { code, message } }`. Una sola forma, sin excepciones.
- Error codes (conjunto enumerado, `src/lib/errors.ts`), con estado HTTP asociado para cuando un code cruce una frontera HTTP:

| code | Clase | status |
|---|---|---|
| `VALIDATION` | `ValidationError` | 422 |
| `NOT_FOUND` | `NotFoundError` | 404 |
| `UNAUTHORIZED` | `UnauthorizedError` | 401 |
| `FORBIDDEN` | `ForbiddenError` | 403 |
| `CONFLICT` | `ConflictError` | 409 |
| `INSUFFICIENT_STOCK` | `InsufficientStockError` | 409 |
| `CASH_SESSION_CLOSED` | `CashSessionClosedError` | 409 |
| `FISCAL_RANGE_EXHAUSTED` | `FiscalRangeExhaustedError` | 409 |
| `UNEXPECTED` | (no es un `AppError`: lo produce `toActionResult` ante cualquier otro error) | 500 |

- Validation: Zod (el mismo schema en cliente y servidor); en esta fase solo valida el entorno (`src/lib/env.ts`, congelado).
- Pagination, Idempotency, Rate limits: NOT APPLICABLE en esta fase (el `clientRequestId` de cobro es de la Fase 3; el rate limiting de login y PIN, de la Fase 1).
- Autorización: las capacidades y la matriz por rol se definen en el paso 6 (tabla literal) y se aplican con `requireCapability(actor, capacidad)` en cada action y query desde la Fase 1.

### Routes

| Method | Path | Description | Auth | Rate limit |
|---|---|---|---|---|
| GET | /api/health | Comprueba que la BD responde (`select 1`); 200 `{"status":"ok"}` o 503 `{"status":"error"}` | pública (la usan CI, Playwright y futuros monitores) | ninguno |

### Critical endpoints — full detail

**`GET /api/health`**
- Request: sin parámetros ni cuerpo.
- Response 200: JSON `{"status":"ok"}`. Response 503: JSON `{"status":"error"}`. No hay otros campos ni textos de error: el cuerpo nunca incluye el mensaje de la excepción.
- Validación y errores: cualquier excepción de la consulta se traduce a 503; no se registran contraseñas ni la cadena de conexión.
- Efectos secundarios: una consulta `select 1`; no escribe filas.
- Implementación: `src/lib/health.ts` exporta `checkDatabase(query)`, `createHealthHandler(check)` y `pingDatabase`; `src/app/api/health/route.ts` llama `await connection()` (API de `next/server`) para excluir el handler del prerenderizado y delega en el handler. El archivo **no** exporta `dynamic`, `revalidate` ni `fetchCache`.

### Interfaces held constant
Estas firmas no se mueven en toda la fase; los pasos solo las importan:

| Interfaz | Contrato congelado |
|---|---|
| `src/lib/env.ts` | `parseEnv(source): Env`, `env: Env`, tipo `Env`; variables `NODE_ENV`, `DATABASE_URL` (esquema `postgresql://` o `postgres://`), `AUTH_SECRET` (≥ 32), `APP_URL`, `TZ` (por defecto `America/Tegucigalpa`) |
| `src/lib/db.ts` | exportación `db` (PrismaClient con `@prisma/adapter-pg`) |
| `prisma/schema.prisma` y `prisma/migrations/*` | sin cambios de contenido |
| `package.json` scripts existentes | los 14 nombres de §1; solo cambia el comando de `db:reset` (paso 8) |
| `CLAUDE.md` §6 | las 11 reglas de dominio |
| Versiones | `next` 16.4.2, `react` y `react-dom` 19.3.0, `prisma`, `@prisma/client` y `@prisma/adapter-pg` 7.10.1, `zod` 4.6.7, `tailwindcss` 4.3.3 |

### Delta
Se añade la ruta `GET /api/health` y el envelope `ActionResult`. No se modifica ninguna interfaz existente.

---

## 6. Frontend Architecture

### Routes
| Route | Page | Data source | Auth |
|---|---|---|---|
| `/` | Inicio (`src/app/(app)/page.tsx`): título y descripción desde `messages.home` | estática | pública en esta fase |
| `/dev/componentes` | Galería de desarrollo (`src/app/(app)/dev/componentes/page.tsx`): cada componente compartido en cada estado | estática; responde 404 en producción salvo que el build defina `NEXT_PUBLIC_COMPONENT_GALLERY=enabled` (solo lo hace Playwright) | pública, solo desarrollo |
| cualquier otra | `src/app/not-found.tsx` (404) | estática | pública |

### Rendering strategy
`next.config.ts` ya activa `cacheComponents: true`. Reglas para esta fase, con las directivas exactas: (1) ningún archivo de `src` exporta `dynamic`, `revalidate` ni `fetchCache` (error de build con Cache Components); (2) el layout `(app)` no lee `cookies()` ni `headers()`, por lo que es estático y no necesita `<Suspense>`; cuando una fase futura añada datos de petición al layout, irán dentro de `<Suspense>`; (3) `src/app/loading.tsx` actúa como frontera Suspense del segmento raíz; (4) `error.tsx` es componente de cliente que recibe `error` y `retry` (el nombre estable desde Next 16.3; `reset` también existe y no refresca datos); (5) `GET /api/health` consulta la BD y llama `await connection()`, así que corre en cada petición; (6) `middleware` se llama `proxy` y no se usa.

### Component hierarchy
```
RootLayout (src/app/layout.tsx, servidor)         <html lang="es-HN"> + fuente Inter
└─ (app)/layout.tsx (servidor)                     SidebarProvider (cliente, de shadcn)
   ├─ enlace "Saltar al contenido"                 primer elemento enfocable
   ├─ Sidebar: marca + "Inicio"                    nav con un solo elemento por ahora
   └─ SidebarInset
      ├─ header: SidebarTrigger + nombre de app    barra superior
      └─ main#contenido                            (children)
         └─ (app)/page.tsx (servidor)              h1 + descripción
Componentes compartidos (src/components/shared):
  PageHeader (servidor) · EmptyState (servidor) · ConfirmDialog (cliente) · MoneyInput (cliente) · DataTable (cliente)
```

### State management
Estado del servidor: no hay datos todavía. Estado de formulario: React Hook Form llega con la Fase 1. Estado del POS: Zustand llega con la Fase 3. En la Fase 0, `MoneyInput` guarda un borrador de texto local mientras el campo tiene foco y calcula su valor visible durante el render (sin `useEffect`), y `ConfirmDialog` es controlado por su padre. Deliberadamente **no** va a estado global: nada.

### Loading, empty, and error states
| Superficie | Cargando | Vacío | Error |
|---|---|---|---|
| Rutas (`src/app/`) | `loading.tsx`: región `role="status"` con texto oculto `messages.common.loading` y bloques `Skeleton` | n/a (la página de inicio siempre tiene contenido) | `error.tsx`: `role="alert"`, título `messages.states.error.title`, botón `messages.common.retry` que llama `retry()` |
| 404 | n/a | n/a | `not-found.tsx`: título `messages.states.notFound.title`, enlace "Ir al inicio" |
| `DataTable` | filas `Skeleton` y texto `role="status"` | `EmptyState` con título, descripción y acción sugerida | `role="alert"` con el mensaje y botón `Reintentar` |
| `MoneyInput` | n/a | campo vacío | `aria-invalid="true"` cuando el texto no es dinero válido |

---

## 7. Design System

Los valores de color y su contraste los midió un script (WCAG) el 2026-10-23 antes de escribir este blueprint. La interfaz es cálida y profesional, "no un ERP gris" (`docs/UX.md` §8): neutros cálidos de base y un verde salvia sobrio como acento. Todos los hex son literales; en `src/app/globals.css` se escriben en minúsculas (Prettier no los toca).

### Colors
| Token | Light | Dark | Usage |
|---|---|---|---|
| `--primary` | #3F6350 | #8DB59F | botones primarios, enlaces, anillo de foco |
| `--primary-fg` (`--primary-foreground`) | #FFFFFF | #10170F | texto sobre primario |
| `--background` | #FAF8F5 | #16140F | página |
| `--surface` (`--card`, `--popover`, `--sidebar`) | #FFFFFF | #201D18 | tarjetas, paneles, diálogos, barra lateral |
| `--border` (límite de controles) | #8A8175 | #7C7467 | bordes de componentes de UI e inputs |
| `--divider` (decorativo, exento de contraste) | #E4DED4 | #342F28 | separadores, filas de tabla, borde de la barra lateral |
| `--fg` (`--foreground`) | #1F1B16 | #F3EFE8 | texto del cuerpo |
| `--fg-muted` (`--muted-foreground`) | #5F574D | #B8AFA2 | texto secundario |
| `--destructive` | #B42318 | #F28B82 | errores, borrar |
| `--success` | #1E6B3E | #7FD1A0 | confirmaciones |
| `--warning` | #8A5200 | #E8B35A | advertencias |
| `--info` | #1D5FA8 | #8AB8F0 | información |

Derivados sin valor nuevo (reutilizan los de arriba): `--secondary`, `--muted`, `--accent`, `--sidebar-accent` = `--divider`; sus textos (`--secondary-foreground`, `--accent-foreground`, `--sidebar-accent-foreground`) = `--fg`; `--input` y `--ring` = `--border` y `--primary` respectivamente; `--sidebar-primary` = `--primary`. Los `--chart-*` conservan los valores actuales (los gráficos son de la Fase 5).

**Contraste (WCAG 2.2 AA, medido):** texto normal ≥ 4.5:1, límites de UI ≥ 3:1. Claro: `--fg` sobre `--background` 16.15, `--fg-muted` 6.70, `--primary-fg` sobre `--primary` 6.75, `--destructive` 6.20, `--success` 6.14, `--warning` 6.03, `--info` 6.09, `--border` sobre `--background` 3.62. Oscuro: `--fg` 16.06, `--fg-muted` 8.49, `--primary-fg` sobre `--primary` 8.03. **Los tres pares más justos (claro):** `--warning` 6.03, `--info` 6.09 y `--success` 6.14 sobre `--background`; para componentes de UI el más justo es `--border` 3.62 (mínimo 3). `--fg-muted` sobre `--divider` (la superficie de `--muted`) da 5.31, calculado a mano con la misma fórmula.

### Typography
| Role | Family | Size / line-height | Weight | Tracking |
|---|---|---|---|---|
| Display | Inter | 24 px / 32 px (totales del POS: 18 a 24 px, se usan desde la Fase 3) | 600 | 0 |
| Heading | Inter | 20 px / 28 px (h2) · 24 px / 32 px (h1) | 600 | 0 |
| Body | Inter | 16 px / 24 px | 400 | 0 |
| Mono | pila del sistema `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | 14 px / 20 px | 400 | 0 |

**Font loading:** `Inter` desde `next/font/google`, `subsets: ["latin"]`, `display: "swap"`, `variable: "--font-sans"`. Pila de reserva: la de `next/font` más `system-ui, sans-serif`. Cifras de dinero: clase `.money` (`font-variant-numeric: tabular-nums`, alineada a la derecha). Se retiran Geist y Geist Mono.

### Spacing, radius, elevation
- Escala de espaciado: base 4 px (escala por defecto de Tailwind 4: 4, 8, 12, 16, 24, 32, 48, 64).
- Radio: `--radius: 0.625rem` (10 px, sin cambios); `sm` 6 px, `md` 8 px, `lg` 10 px, `xl` 14 px (derivados `calc` ya presentes).
- Sombras: plano, solo bordes; los diálogos y popovers usan `shadow-md` de shadcn.
- Ancho máximo del contenido: 1280 px · Breakpoints: Tailwind por defecto (640, 768, 1024, 1280). Objetivos táctiles ≥ 44×44 px en contextos de POS (la altura por defecto de `Button` es 32 px; el POS usará `size` mayor desde la Fase 3).

### Motion
150 ms con `ease-out` para transiciones (`--default-transition-duration: 150ms` y `--default-transition-timing-function: ease-out` en el tema). `@media (prefers-reduced-motion: reduce)` reduce animaciones y transiciones a 0.01 ms. Solo `transform` y `opacity` en animaciones propias.

### Component style
Limpio, cálido y profesional: fondo crema (#FAF8F5), superficies blancas, acento salvia, bordes finos de color `--divider` para separar y `--border` solo para controles. Un componente nuevo pertenece al sistema si usa tokens (nunca hex ni px sueltos), tiene estados de carga, vacío y error, y su control principal mide al menos 44 px en el POS.

---

## 8. Authentication & Authorization

NOT APPLICABLE — la autenticación llega en la Fase 1 (Auth.js con credenciales y PIN rápido); esta fase no tiene cuentas, sesiones ni rutas protegidas. Ningún paso de §9 toma un contrato de esta sección. La matriz de capacidades por rol de la Fase 0 vive en el paso 6 de §9 y se resume en §5.

---

## 9. BUILD ORDER

Esta es la sección que el blueprint existe para producir. Un builder que sigue §9 al pie de la letra y se detiene cuando cada puerta pasa a verde termina la Fase 0. **16 pasos = 16 tareas de `tasks.json` = 16 bloques de tarea en dos épicas (7 + 9).** Épica 1, "Núcleo de dominio y pruebas": pasos 1 a 7. Épica 2, "Datos, interfaz y entrega": pasos 8 a 16.

**Reglas que valen para todos los pasos** (resumen de las reglas de paso de la plantilla):
1. Cada paso corre en este orden: **Do → Done when → Verify → Checkpoint**. Un `Verify` nunca afirma estado que solo el `Checkpoint` de su propio paso produce (árbol limpio, archivo rastreado, etiqueta propia); esas afirmaciones van dentro del `Checkpoint`, después del commit, o en §20.1.
2. Un paso no está terminado hasta que sus comandos `Verify` pasan **y** los de los pasos anteriores siguen pasando.
3. Antes de cada `Verify`, corre `pnpm format` (Prettier reescribe los archivos del paso y los del workspace); así `pnpm format:check` mide el resultado final.
4. Los comandos `Verify` salen con código 0 cuando el paso está bien. Donde la respuesta correcta es "no hay coincidencias" se usa `status=0; cmd || status=$?; test "$status" -eq 1` (1 = sin coincidencias; 2 = error de uso, y eso sí falla).
5. Ningún paso exige nada que rompa la puerta de un paso anterior: `src/lib/env.ts` ya valida `DATABASE_URL`, `AUTH_SECRET` y `APP_URL` y el Bootstrap deja `.env` listo antes del paso 1; `DATABASE_URL_TEST` la lee solo el proyecto `integration` y el `globalSetup` (desde el paso 7); `NEXT_PUBLIC_COMPONENT_GALLERY` la define solo `playwright.config.ts` (paso 14).
6. Nunca se escribe el nombre de un archivo que genera una herramienta. Este blueprint no genera migraciones; los archivos que crea el CLI de shadcn (`src/components/ui/<nombre>.tsx`) tienen nombre determinista del registro.
7. Nunca se añade `export const dynamic`, `revalidate` ni `fetchCache` (error de build con Cache Components).
8. Antes de escribir código de Next, lee la guía relevante en `node_modules/.pnpm/next@16.4.2_*/node_modules/next/dist/docs/` (regla de `AGENTS.md`): esta versión difiere de lo que recuerdas.
9. **Mensaje de commit de cada Checkpoint (una sola forma, la de `CLAUDE.md` §7 `tipo(módulo): descripción`):** `feat(fase-0): <id de tarea> <slug>`, donde el id es el de `tasks.json` (`E1-T1` a `E1-T7` para los pasos 1 a 7; `E2-T1` a `E2-T9` para los pasos 8 a 16) y el slug es el de la etiqueta sin `step-NN-` (por ejemplo `feat(fase-0): E1-T1 vitest` para la etiqueta `step-01-vitest`). Los pasos que no añaden una función, sino documentos, una prueba de guardia y CI (pasos 15 y 16), usan `chore(fase-0): <id de tarea> <slug>`. El commit del Bootstrap (`chore: bootstrap fase 0`) es la única excepción: las puertas de §20.1 lo leen por su etiqueta `bootstrap-fase-0`. Las etiquetas siguen siendo `step-NN-<slug>`. Cada Checkpoint necesita la identidad de git que comprueba el bloque 0 del Bootstrap (§10): sin ella `git commit` muere con "Author identity unknown".
10. Los tipos de rutas de Next (`LayoutProps<"/">`, `.next/types/**` y `next-env.d.ts`) están en `.gitignore` y no existen en un clon limpio: los generan `next dev`, `next build` o `pnpm exec next typegen` (comando que documenta la guía instalada, `01-app/03-api-reference/06-cli/next.md`, para comprobar tipos sin construir). Por eso el Bootstrap, el `Verify` del paso 1, la puerta de §20.1 y el job `check` del CI lo ejecutan antes de `pnpm typecheck`: ningún gate debe pasar solo porque quedaron archivos locales de una corrida anterior.
11. Los `Verify` de **los 16 pasos** corren `pnpm exec eslint --max-warnings 0` justo después de `pnpm lint`: `pnpm lint` sale con 0 aunque haya advertencias (por ejemplo `@typescript-eslint/no-unused-vars`, que `eslint-config-next` deja en `warn`), mientras que la puerta final de §20.1 no tolera ninguna; así la advertencia aparece en el paso que la causa y no al cierre de la fase. Ningún paso queda exento: ESLint y su configuración son del repo desde antes del paso 1 (el Bootstrap solo añade las exclusiones del bundle) y los `.ts` del `workspace/` están escritos para no emitir advertencias. Si la advertencia está en un archivo que copió el CLI de shadcn, se corrige en ese archivo (es código del proyecto).

### Step map

| # | Step | Depends on | Touches | Gate |
|---|---|---|---|---|
| 1 | Vitest 5 y primera prueba real (`parseEnv`) | — | `package.json`, `tests/unit/env.test.ts` (+ `vitest.config.ts` del workspace) | `pnpm test:unit` |
| 2 | Errores tipados, `ActionResult` y mensajes es-HN | 1 | `src/lib/errors.ts`, `src/lib/action-result.ts`, `src/config/messages.es.ts`, `tests/unit/errors.test.ts`, `tests/unit/messages.test.ts` | `pnpm test:unit` |
| 3 | Fechas en `America/Tegucigalpa` | 2 | `src/lib/dates.ts`, `tests/unit/dates.test.ts` | `pnpm test:unit` |
| 4 | Núcleo de dinero (centavos, porcentaje, ISV) | 1, 2 | `src/lib/money.ts`, `tests/unit/money.test.ts`, `docs/UX.md` | `pnpm test:coverage` |
| 5 | Prorrateo, formato y lectura de dinero | 4 | `src/lib/money.ts`, `src/lib/format.ts`, `tests/unit/helpers/prng.ts`, `tests/unit/money-allocate.test.ts`, `tests/unit/format.test.ts` | `pnpm test:coverage` |
| 6 | Permisos por capacidades y hash de contraseñas | 2 | `package.json`, `src/lib/permissions.ts`, `src/lib/password.ts`, `tests/unit/permissions.test.ts`, `tests/unit/password.test.ts` | `pnpm test:unit` |
| 7 | Auditoría y pruebas de integración contra Postgres real | 1 | `src/lib/audit.ts`, `tests/integration/audit.test.ts` (+ `global-setup.ts` y `helpers/db.ts` del workspace) | `pnpm test:integration` |
| 8 | Semilla mínima idempotente | 6, 7 | `package.json`, `prisma/seed.ts`, `prisma/seed/run-seed.ts`, `tests/integration/seed.test.ts` | `pnpm db:seed` ×2 |
| 9 | `/api/health` servido de verdad | 7 | `src/lib/health.ts`, `src/app/api/health/route.ts`, `tests/integration/health.test.ts` (+ `scripts/smoke-server.ts` del workspace) | `smoke-server start 3190` y `dev 3191` sobre `/api/health=200:ok` |
| 10 | Primitivas de UI: shadcn y TanStack Table | 1, 2 | `package.json`, `src/components/ui/**`, `src/hooks/use-mobile.ts` | `pnpm build` |
| 11 | Tokens de diseño e Inter | 2 | `src/app/globals.css`, `src/app/layout.tsx` | `pnpm build` |
| 12 | Shell de aplicación y estados de ruta | 2, 9, 10, 11 | `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `src/app/loading.tsx`, `src/app/error.tsx`, `src/app/not-found.tsx` | `smoke-server start 3190 /=200:Inicio ...` y `dev 3191 /=200:Inicio` |
| 13 | Componentes compartidos | 2, 5, 10 | `src/components/shared/{page-header,empty-state,confirm-dialog,money-input,data-table}.tsx` | `pnpm typecheck` + `pnpm build` |
| 14 | Playwright y galería de componentes | 9, 12, 13 | `package.json`, `playwright.config.ts`, `tests/e2e/shell.spec.ts`, `tests/e2e/components.spec.ts`, `src/app/(app)/dev/componentes/page.tsx` | `pnpm test:e2e` |
| 15 | Invariante de stock, test de arquitectura y documentos al día | 7 | `tests/integration/invariants.test.ts`, `tests/integration/helpers/invariants.ts`, `tests/unit/architecture.test.ts`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md` | `pnpm test:integration` |
| 16 | CI, README y cierre de la fase | 8, 14, 15 | `.github/workflows/ci.yml`, `tests/unit/ci-workflow.test.ts`, `README.md`, `CLAUDE.md` | `pnpm test` |

Orden: primero lo que no depende de nada (Vitest), luego librerías puras en el orden en que se importan entre sí (errores → fechas → dinero), luego el primer paso que toca la capa de datos (7), la semilla, el único endpoint servido (9), la interfaz (10 a 14) y, al final, los documentos y el CI. El primer artefacto que se sirve (`/api/health`, paso 9) se ejecuta en su propio paso, en producción (`next start`) y en desarrollo (`next dev`); el contrato entre `playwright.config.ts` y la galería se ejerce en el paso 14, donde existen ambos lados.

---

#### Step 1 — Instalar Vitest 5 y escribir la primera prueba real

**Do**
Instala Vitest 5 con sus pares obligatorios, sube `@types/node` a la línea 24 (Vitest 5 exige `@types/node` `^22` o `>=24`; el repo trae `^20`), define los cuatro scripts de prueba y escribe la prueba de `parseEnv`. `vitest.config.ts` (dos proyectos, `unit` e `integration`) ya está en la raíz porque el Bootstrap copió `workspace/`; su contenido y lo que carga están en §19.6. Cambios de Vitest 5 a respetar: `clearMocks` es `true` por defecto, la opción `sequential` no existe (se usa `fileParallelism: false`, ya puesto en el proyecto `integration`), Vitest ya no busca configuración en directorios padre, y los reporters `json` y `junit` escriben archivos por defecto (no se usan).

```bash
pnpm add -D -E vitest@5.0.5 @vitest/coverage-v8@5.0.5 vite@8.3.5 @types/node@24.19.2
npm pkg set scripts.test="vitest run" scripts.test:unit="vitest run --project unit" scripts.test:integration="vitest run --project integration" scripts.test:coverage="vitest run --project unit --coverage"
pnpm format
```

Archivos:
- `package.json` — edición: cuatro devDependencies con versión exacta y cuatro scripts (`test`, `test:unit`, `test:integration`, `test:coverage`); el comando de cada uno es el de arriba.
- `tests/unit/env.test.ts` — nuevo. Importa `describe`, `expect`, `it` de `vitest` (no hay globals) y `parseEnv` de `@/lib/env`. Define `validSource = { DATABASE_URL: "postgresql://u:p@localhost:5432/db", AUTH_SECRET: "x".repeat(32), APP_URL: "http://localhost:3000" }`. Pruebas: (a) con `validSource`, `parseEnv` devuelve `TZ` igual a `America/Tegucigalpa` y `NODE_ENV` igual a `development`; (b) sin `AUTH_SECRET`, el error coincide con `/AUTH_SECRET/`; (c) con `AUTH_SECRET` de 31 caracteres, coincide con `/AUTH_SECRET debe tener al menos 32 caracteres/`; (d) con `DATABASE_URL` igual a `mysql://u:p@localhost/db`, coincide con `/DATABASE_URL debe ser una URL de PostgreSQL/`; (e) con `APP_URL` igual a `no-es-una-url`, coincide con `/APP_URL/`. Esas cadenas son mensajes de `src/lib/env.ts` (congelado), no del motor de Zod. Ojo: `@/lib/env` evalúa `parseEnv(process.env)` al importarse; el proyecto `unit` define `test.env` con valores de relleno, así que la importación no depende de `.env`.

**Done when**
- [ ] WHEN `pnpm install --frozen-lockfile` corre después del paso THE SYSTEM SHALL terminar con código 0 sin modificar el lockfile.
- [ ] WHEN `pnpm test:unit` corre THE SYSTEM SHALL terminar con código 0 ejecutando `tests/unit/env.test.ts` sin pruebas fallidas ni omitidas.
- [ ] WHEN `parseEnv` recibe un origen válido THE SYSTEM SHALL devolver `TZ` igual a `America/Tegucigalpa` y `NODE_ENV` igual a `development` por defecto.
- [ ] WHEN `parseEnv` recibe un origen sin `AUTH_SECRET`, con `AUTH_SECRET` de 31 caracteres, con `DATABASE_URL` que no es de PostgreSQL o con `APP_URL` inválida THE SYSTEM SHALL lanzar un error cuyo mensaje contiene el nombre de esa variable.
- [ ] WHEN `pnpm lint`, `pnpm typecheck` y `pnpm format:check` corren con los archivos del workspace ya copiados THE SYSTEM SHALL terminar con código 0 en los tres.
- [ ] WHEN `package.json` se lee THE SYSTEM SHALL declarar `vitest`, `@vitest/coverage-v8`, `vite` y `@types/node` con las versiones exactas de §11 y los scripts `test`, `test:unit`, `test:integration` y `test:coverage`.

**Verify**
```bash
pnpm install --frozen-lockfile                    # expect: exit 0 — el lockfile ya refleja los cuatro paquetes
pnpm test:unit                                    # expect: exit 0 — corre tests/unit/env.test.ts
pnpm lint                                         # expect: exit 0
pnpm exec eslint --max-warnings 0                 # expect: exit 0 — cero advertencias en este paso (pnpm lint tolera las advertencias; la puerta de §20.1 no)
pnpm exec next typegen                            # expect: exit 0 — regenera los tipos de rutas (gitignored) para que typecheck no pase solo por archivos locales viejos
pnpm typecheck                                    # expect: exit 0 — incluye vitest.config.ts, scripts/smoke-server.ts y tests/integration/**
pnpm format:check                                 # expect: exit 0 — sin diferencias tras `pnpm format`
grep -qF '"vitest": "5.0.5"' package.json         # expect: exit 0
grep -qF '"@vitest/coverage-v8": "5.0.5"' package.json   # expect: exit 0
grep -qF '"vite": "8.3.5"' package.json           # expect: exit 0
grep -qF '"@types/node": "24.19.2"' package.json  # expect: exit 0
grep -qF '"test:integration": "vitest run --project integration"' package.json   # expect: exit 0
test -f vitest.config.ts                          # expect: exit 0 — lo dejó el Bootstrap
status=0; grep -rnE '\.(skip|only)\(' tests/unit || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = sin pruebas omitidas o enfocadas · 2 = error de grep, y eso falla
```

**Checkpoint**
```bash
git add -A && git commit -m "feat(fase-0): E1-T1 vitest"
git tag step-01-vitest
git ls-files --error-unmatch vitest.config.ts                  # expect: exit 0 — ya confirmado en git
git ls-files --error-unmatch scripts/smoke-server.ts           # expect: exit 0
git ls-files --error-unmatch tests/integration/helpers/db.ts   # expect: exit 0
git ls-files --error-unmatch .claude/settings.json             # expect: exit 0
# rollback target si el paso 2 sale mal: git reset --hard step-01-vitest
```

---

#### Step 2 — Errores tipados, `ActionResult` y mensajes es-HN

**Do**
Crea la base de errores de negocio, el envelope de resultado de las server actions y el diccionario de textos de interfaz. Todo el texto visible de la fase sale de `messages.es.ts` (regla de `CLAUDE.md` §7), de modo que este paso define las claves que consumen los pasos 10 a 14.

Archivos:
- `src/lib/errors.ts` — exporta `APP_ERROR_CODES` (tupla `as const` con los ocho códigos de la tabla de §5, en ese orden), el tipo `ErrorCode`, la clase base `AppError extends Error` con `readonly code: ErrorCode` y `readonly status: number` (constructor `(code, status, message, options?: { cause?: unknown })`, fija `this.name = new.target.name`) y las ocho subclases con constructor `(message = <por defecto>, options?)` que llaman `super(<code>, <status>, message, options)`. Como `tsconfig` activa `noImplicitOverride`, las subclases no redeclaran campos. Mensajes por defecto (internos, en inglés): `ValidationError` "Validation failed", `NotFoundError` "Resource not found", `UnauthorizedError` "Authentication required", `ForbiddenError` "Not allowed", `ConflictError` "Conflict with current state", `InsufficientStockError` "Insufficient stock", `CashSessionClosedError` "Cash session is closed", `FiscalRangeExhaustedError` "Fiscal range exhausted or expired". Clase → code → status: la tabla de §5.
- `src/lib/action-result.ts` — exporta `ActionErrorCode` (`ErrorCode | "UNEXPECTED"`), `ActionError = { code; message }`, `ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError }`, `ErrorMessages = Record<ActionErrorCode, string>`, `ok(data)`, `fail(code, message)` y `toActionResult(fn, messages, onUnexpected?)`. `toActionResult` ejecuta `fn`; ante un `AppError` devuelve `fail(error.code, messages[error.code])`; ante cualquier otro error llama `onUnexpected(error)` (por defecto `console.error("Error inesperado en una acción", error)`) y devuelve `fail("UNEXPECTED", messages.UNEXPECTED)` sin incluir el texto del error original.
- `src/config/messages.es.ts` — exporta `messages` (objeto `as const`, tuteo, tono de `docs/UX.md` §10). Contenido literal:

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
- `tests/unit/errors.test.ts` — por cada clase de la tabla de §5: `instanceof AppError` e `instanceof Error`, `code` y `status` exactos; los ocho `code` son distintos (`new Set(APP_ERROR_CODES).size === APP_ERROR_CODES.length`); `ok(5)` devuelve `{ ok: true, data: 5 }`; `toActionResult` con una función que lanza `new ForbiddenError()` devuelve `{ ok: false, error: { code: "FORBIDDEN", message: <messages.errors.FORBIDDEN> } }`; con una que lanza `new Error("secreto-interno")` devuelve `code` `UNEXPECTED`, el mensaje de `messages.errors.UNEXPECTED`, y `JSON.stringify(resultado)` no contiene `secreto-interno` (pasa `onUnexpected` como `vi.fn()` para no ensuciar la salida y comprueba que se llamó).
- `tests/unit/messages.test.ts` — `Object.keys(messages.errors).sort()` es igual a `[...APP_ERROR_CODES, "UNEXPECTED"].sort()` y cada valor es una cadena no vacía; así, un código nuevo sin mensaje rompe la prueba.

**Done when**
- [ ] WHEN cada clase de la tabla del paso se instancia THE SYSTEM SHALL cumplir `instanceof AppError` e `instanceof Error` y exponer el `code` y el `status` de la tabla.
- [ ] WHEN `toActionResult` ejecuta una función que lanza un `AppError` THE SYSTEM SHALL devolver `{ ok: false, error: { code, message } }` con `message` tomado del diccionario inyectado para ese `code`.
- [ ] WHEN `toActionResult` ejecuta una función que lanza un `Error` que no es `AppError` THE SYSTEM SHALL devolver el código `UNEXPECTED` con el mensaje del diccionario y SHALL NOT incluir el texto del error original.
- [ ] WHEN `pnpm test:unit` corre THE SYSTEM SHALL probar que `messages.errors` tiene exactamente las claves de `APP_ERROR_CODES` más `UNEXPECTED`, todas con texto no vacío.
- [ ] WHEN `pnpm lint`, `pnpm typecheck` y `pnpm format:check` corren al cerrar el paso THE SYSTEM SHALL terminar con código 0 en los tres.

**Verify**
```bash
pnpm test:unit                                    # expect: exit 0 — errors.test.ts, messages.test.ts y env.test.ts
pnpm lint                                         # expect: exit 0
pnpm exec eslint --max-warnings 0                 # expect: exit 0 — cero advertencias en este paso (pnpm lint tolera las advertencias; la puerta de §20.1 no)
pnpm typecheck                                    # expect: exit 0
pnpm format:check                                 # expect: exit 0
grep -qF 'export const APP_ERROR_CODES' src/lib/errors.ts   # expect: exit 0
status=0; grep -rnE '\.(skip|only)\(' tests/unit || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = sin pruebas omitidas o enfocadas
```

**Checkpoint**
```bash
git add -A && git commit -m "feat(fase-0): E1-T2 errors-messages"
git tag step-02-errors-messages
git ls-files --error-unmatch src/config/messages.es.ts   # expect: exit 0 — ya confirmado en git
# rollback target si el paso 3 sale mal: git reset --hard step-02-errors-messages
```

---

#### Step 3 — Fechas en `America/Tegucigalpa`

**Do**
Crea los helpers de fecha que exige `CLAUDE.md` §6.10 (UTC en BD, hora local solo para mostrar y para límites de día). Honduras está en UTC−6 todo el año (sin horario de verano en 2025 a 2028, el rango de las pruebas). Se construyen sobre `Intl.DateTimeFormat#formatToParts` para leer la zona IANA; **las cadenas se ensamblan a mano** y las pruebas nunca afirman cadenas producidas por la localización.

Archivos:
- `src/lib/dates.ts` — exporta `APP_TIME_ZONE = "America/Tegucigalpa"`, `localDateKey(date)` → `YYYY-MM-DD`, `startOfLocalDay(date)`, `endOfLocalDay(date)` (último milisegundo del día local), `addLocalDays(date, days)` (suma días de calendario conservando la hora local) y `formatLocalDateTime(date)` → `DD/MM/YYYY HH:mm` en 24 horas. Implementación: un `Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })` creado una vez; `zonedParts(date)` lee las partes por `type` y convierte a número, **normalizando la hora `24` a `0`** (algunos motores devuelven `24` a medianoche; así el resultado no depende de eso); `offsetMs(date)` = `Date.UTC(partes locales)` menos el instante truncado al segundo; `startOfLocalDay` = `Date.UTC(año, mes−1, día)` menos `offsetMs` de ese instante; `endOfLocalDay(date)` = `startOfLocalDay(addLocalDays(date, 1))` menos 1 ms; `addLocalDays` = `date + days·86 400 000 ms` corregido por la diferencia de `offsetMs` entre el origen y el resultado. Un `Date` inválido (`Number.isNaN(date.getTime())`) o `days` no entero lanzan `ValidationError` de `@/lib/errors`.
- `tests/unit/dates.test.ts` — literales derivados a mano con UTC−6: `2026-10-23T05:30:00.000Z` es 22/10 23:30 local; `2026-10-23T06:00:00.000Z` es 23/10 00:00 local. Casos: (a) `localDateKey` de `2026-10-23T05:30:00.000Z` = `2026-10-22`, de `2026-10-23T06:00:00.000Z` = `2026-10-23`, de `2026-10-23T05:59:59.999Z` = `2026-10-22`; (b) `startOfLocalDay` y `endOfLocalDay` de `2026-10-23T05:30:00.000Z` = `2026-10-22T06:00:00.000Z` y `2026-10-23T05:59:59.999Z`; (c) `addLocalDays(2026-10-22T20:15:00.000Z, 30)` = `2026-11-21T20:15:00.000Z`, con `-1` = `2026-10-21T20:15:00.000Z`, y `addLocalDays(2028-02-28T18:00:00.000Z, 1)` = `2028-02-29T18:00:00.000Z` (2028 es bisiesto); (d) `formatLocalDateTime` de `2026-10-23T06:00:00.000Z` = `23/10/2026 00:00`, de `2026-10-23T18:05:00.000Z` = `23/10/2026 12:05`, de `2026-01-01T00:00:00.000Z` = `31/12/2025 18:00`; (e) las cuatro funciones y `addLocalDays` lanzan `ValidationError` con `new Date("no-es-fecha")`.

**Done when**
- [ ] WHEN `localDateKey` recibe `2026-10-23T05:30:00.000Z` THE SYSTEM SHALL devolver `2026-10-22` y para `2026-10-23T06:00:00.000Z` devolver `2026-10-23`.
- [ ] WHEN `startOfLocalDay` y `endOfLocalDay` reciben `2026-10-23T05:30:00.000Z` THE SYSTEM SHALL devolver `2026-10-22T06:00:00.000Z` y `2026-10-23T05:59:59.999Z`.
- [ ] WHEN `addLocalDays` recibe `2026-10-22T20:15:00.000Z` con 30 y con -1 THE SYSTEM SHALL devolver `2026-11-21T20:15:00.000Z` y `2026-10-21T20:15:00.000Z`.
- [ ] WHEN `formatLocalDateTime` recibe `2026-10-23T06:00:00.000Z`, `2026-10-23T18:05:00.000Z` y `2026-01-01T00:00:00.000Z` THE SYSTEM SHALL devolver `23/10/2026 00:00`, `23/10/2026 12:05` y `31/12/2025 18:00`.
- [ ] WHEN cualquier helper recibe un `Date` inválido THE SYSTEM SHALL lanzar `ValidationError`.
- [ ] WHEN `pnpm lint`, `pnpm typecheck` y `pnpm format:check` corren al cerrar el paso THE SYSTEM SHALL terminar con código 0 en los tres.

**Verify**
```bash
pnpm test:unit                                    # expect: exit 0 — incluye tests/unit/dates.test.ts
pnpm lint                                         # expect: exit 0
pnpm exec eslint --max-warnings 0                 # expect: exit 0 — cero advertencias en este paso (pnpm lint tolera las advertencias; la puerta de §20.1 no)
pnpm typecheck                                    # expect: exit 0
pnpm format:check                                 # expect: exit 0
status=0; grep -rnE '\.(skip|only)\(' tests/unit || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = sin pruebas omitidas o enfocadas
```

**Checkpoint**
```bash
git add -A && git commit -m "feat(fase-0): E1-T3 dates"
git tag step-03-dates
# rollback target si el paso 4 sale mal: git reset --hard step-03-dates
```

---

#### Step 4 — Núcleo de dinero: centavos, porcentaje e ISV incluido

**Do**
Crea la primera mitad de `src/lib/money.ts`, la única puerta de cálculo de dinero (`CLAUDE.md` §6.1). **Política de redondeo, escrita una sola vez: mitad hacia afuera del cero, aplicada una sola vez por valor calculado.** Toda función exige enteros seguros (`Number.isSafeInteger`); un decimal, `NaN`, `Infinity` o un entero fuera de rango lanza `ValidationError` de `@/lib/errors`.

Archivos:
- `src/lib/money.ts` — exporta el tipo `Cents` (= `number`), `assertCents(value, label?)` (aserción de tipo), `addCents(a, b)`, `subCents(a, b)`, `mulCents(unitCents, quantity)` (la cantidad es un entero; el resultado debe ser un entero seguro), `sumCents(values)` (`[]` suma 0), `roundHalfAwayFromZero(numerator, denominator)` (única función de redondeo; aritmética entera: signo aparte, cociente `q`, resto `r`; sube a `q + 1` cuando `2r >= denominador`; el producto previo debe ser entero seguro o lanza `ValidationError`), `percentOf(cents, bps)` (puntos base: 1000 = 10 %; = `roundHalfAwayFromZero(cents * bps, 10000)`) y `extractTax(totalCents, rateBps)` → `{ netCents, taxCents }` con `netCents = roundHalfAwayFromZero(totalCents * 10000, 10000 + rateBps)` y `taxCents = totalCents − netCents` (15 % = 1500 bps; `rateBps` entero no negativo). Ejemplo de referencia derivado a mano: total 1 226.00 L = 122 600 centavos → `netCents` 106 609 (1 226 000 000 / 11 500 = 106 608.69… → 106 609) y `taxCents` 15 991 (L 159.91).
- `tests/unit/money.test.ts` — literales derivados a mano: `percentOf(10000, 1000)` = 1000; `percentOf(1999, 1000)` = 200 (199.9); mitades: `percentOf(5, 1000)` = 1, `percentOf(15, 1000)` = 2, `percentOf(25, 1000)` = 3 y `percentOf(-25, 1000)` = -3 (no redondeo bancario); `extractTax(122600, 1500)` = `{ netCents: 106609, taxCents: 15991 }`; `extractTax(11500, 1500)` = `{ netCents: 10000, taxCents: 1500 }`; `extractTax(100, 1500)` = `{ netCents: 87, taxCents: 13 }`; `extractTax(0, 1500)` = `{ netCents: 0, taxCents: 0 }`; `extractTax(-122600, 1500)` es el espejo (`netCents` -106609, `taxCents` -15991); `extractTax(5000, 0)` = `{ netCents: 5000, taxCents: 0 }`; `mulCents(65000, 1)` = 65000 y `mulCents(32000, 2)` = 64000; `sumCents([])` = 0. Ticket de `docs/UX.md` §3: líneas 65000 y 2 × 32000 = 64000, subtotal 129000, descuento de línea `percentOf(64000, 1000)` = 6400, total `subCents(129000, 6400)` = 122600 y ese total da `taxCents` 15 991. Pruebas de rechazo (`ValidationError`): `addCents(0.5, 1)`, `percentOf(Number.NaN, 1000)`, `mulCents(Number.MAX_SAFE_INTEGER, 2)`, `extractTax(100, -1)`, `sumCents([1, Number.POSITIVE_INFINITY])`.
- `docs/UX.md` — edición de una línea: en el ticket de ejemplo de la sección 3 el ISV `159.78` pasa a `159.91` (el total 1 226.00 con ISV incluido del 15 % extrae 159.91 por la política de arriba; con 159.78 el ejemplo era aritméticamente inconsistente). Reemplazo exacto de `L   159.78│` por `L   159.91│`.

Cobertura: `vitest.config.ts` ya define, para el único archivo `src/lib/money.ts`, umbrales de 100 % de líneas, 100 % de sentencias, 100 % de funciones y 95 % de ramas (`test:coverage` los hace cumplir). Escribe las pruebas que cubran el camino negativo y de mitad de `roundHalfAwayFromZero`.

**Done when**
- [ ] WHEN `percentOf(25, 1000)` y `percentOf(-25, 1000)` se llaman THE SYSTEM SHALL devolver `3` y `-3` (redondeo a la mitad alejándose de cero, aplicado una sola vez).
- [ ] WHEN `extractTax(122600, 1500)` se llama THE SYSTEM SHALL devolver `{ netCents: 106609, taxCents: 15991 }`.
- [ ] WHEN `extractTax(11500, 1500)` y `extractTax(100, 1500)` se llaman THE SYSTEM SHALL devolver `{ netCents: 10000, taxCents: 1500 }` y `{ netCents: 87, taxCents: 13 }`.
- [ ] WHEN cualquier función de `src/lib/money.ts` recibe un valor que no es entero seguro (decimal, NaN, Infinity) THE SYSTEM SHALL lanzar `ValidationError`.
- [ ] WHEN `pnpm test:coverage` corre THE SYSTEM SHALL terminar con código 0 cumpliendo por archivo para `src/lib/money.ts` 100 % de líneas, 100 % de sentencias, 100 % de funciones y 95 % de ramas.
- [ ] WHEN `docs/UX.md` se lee THE SYSTEM SHALL mostrar el ISV del ejemplo del ticket como `159.91` y no `159.78`.

**Verify**
```bash
pnpm test:unit                                    # expect: exit 0
out=$(mktemp) && pnpm test:coverage > "$out" && grep -q 'money.ts' "$out"
                                                  # expect: exit 0 — los umbrales pasan y money.ts aparece medido en la tabla (un umbral que no apunta a ningún archivo no mediría nada)
pnpm lint                                         # expect: exit 0
pnpm exec eslint --max-warnings 0                 # expect: exit 0 — cero advertencias en este paso (pnpm lint tolera las advertencias; la puerta de §20.1 no)
pnpm typecheck                                    # expect: exit 0
pnpm format:check                                 # expect: exit 0
grep -qF '159.91' docs/UX.md                      # expect: exit 0
status=0; grep -qF '159.78' docs/UX.md || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = el valor viejo ya no está
status=0; grep -rnE '\.(skip|only)\(' tests/unit || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = sin pruebas omitidas o enfocadas
```

**Checkpoint**
```bash
git add -A && git commit -m "feat(fase-0): E1-T4 money-core"
git tag step-04-money-core
# rollback target si el paso 5 sale mal: git reset --hard step-04-money-core
```

---

#### Step 5 — Prorrateo de descuentos, formato y lectura de dinero

**Do**
Completa `src/lib/money.ts` con el reparto exacto de centavos y crea `src/lib/format.ts`, la capa de presentación (`CLAUDE.md` §6.1: el formato solo vive en presentación). Las pruebas de propiedades usan un generador pseudoaleatorio sembrado, sin dependencias nuevas (no `fast-check`).

Archivos:
- `src/lib/money.ts` — edición: añade `allocate(totalCents, weights)` y `prorateDiscount(lineTotals, discountCents)`. `allocate` usa el **método del mayor residuo**: validaciones (total entero ≥ 0; pesos: arreglo no vacío de enteros seguros ≥ 0; si el total es 0 devuelve ceros; si el total es > 0 y los pesos suman 0 lanza `ValidationError`); parte base `floor(total·peso / suma)` y resto `(total·peso) mod suma`, calculados con `BigInt(...)` (llamadas a la función, no literales `1n`, porque `tsconfig` apunta a ES2017) para no desbordar; el sobrante `total − Σ partes base` se reparte de a 1 centavo a los índices de mayor resto, **empate al índice más bajo**; la suma de las partes es siempre igual al total. `prorateDiscount` devuelve ceros si el descuento es 0, lanza `ValidationError` si el descuento supera la suma de las líneas (refleja el CHECK `discountCents <= subtotalCents`), y en otro caso es `allocate(discountCents, lineTotals)`; ninguna parte supera su línea.
- `src/lib/format.ts` — exporta `parseMoney(text): Cents | null`, `formatMoney(cents): string` y `formatMoneyPlain(cents): string`. `parseMoney`: recorta espacios; acepta un prefijo opcional `L` (mayúscula o minúscula) con espacios; entero con comas de millares bien formadas (`1,234`) o sin ellas (`1234`); parte decimal opcional de 1 o 2 dígitos (`.5` = 50 centavos, `.05` = 5, `.50` = 50). Gramática: `/^(?:L\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/i`. Devuelve `null` para cualquier otra cosa (`12.345`, `abc`, cadena vacía, negativos, `1,23`, `12.`) y para valores fuera del rango seguro. `formatMoney`: `L 1,234.50`; negativos `−L 64.00` con U+2212 (escrito `−` en el código y en las pruebas); cero `L 0.00`; aritmética entera pura (sin `Intl` para números). `formatMoneyPlain`: sin símbolo ni comas (`1234.50`), pensada para el texto editable de `MoneyInput`; para negativos antepone `-` ASCII (no se vuelve a leer con `parseMoney`). Ambas funciones usan `assertCents`.
- `tests/unit/helpers/prng.ts` — exporta `mulberry32(seed: number): () => number` (generador de 32 bits: `a = (a + 0x6d2b79f5) >>> 0; t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296`).
- `tests/unit/money-allocate.test.ts` — literales derivados a mano: `allocate(100, [1, 1, 1])` = `[34, 33, 33]` (tres restos iguales a 1, el sobrante va al índice 0); `allocate(10, [1, 2, 3])` = `[2, 3, 5]` (bases 1, 3, 5; restos 4, 2, 0; el sobrante va al índice 0); `allocate(1, [1, 1, 1])` = `[1, 0, 0]`; `allocate(0, [5, 5])` = `[0, 0]`; `allocate(5, [0, 0, 1])` = `[0, 0, 5]`; `prorateDiscount([65000, 64000], 6400)` = `[3225, 3175]` (bases 3224 y 3175, restos 104 000 y 25 000, el centavo sobrante va a la primera línea). Propiedades con `mulberry32(20261023)` y 1000 casos cada una: `allocate` con total entre 0 y 10 000 000 y de 1 a 8 pesos entre 0 y 1 000 000 (al menos uno > 0) cumple: la suma de las partes es el total, ninguna parte es negativa, cada parte es `floor(total·peso/suma)` o ese valor + 1; `prorateDiscount` con líneas aleatorias y descuento entre 0 y la suma cumple: suma de partes = descuento y cada parte ≤ su línea. Rechazos (`ValidationError`): `allocate(10, [0, 0])`, `allocate(-1, [1])`, `allocate(10, [])`, `prorateDiscount([100, 100], 201)`.
- `tests/unit/format.test.ts` — `parseMoney("1,234.50")` = 123450; `parseMoney("L 1,234.5")` = 123450; `parseMoney("1234")` = 1234·100 = 123400; `parseMoney("L1234.05")` = 123405; `parseMoney("12.345")`, `parseMoney("abc")`, `parseMoney("")`, `parseMoney("-5")`, `parseMoney("1,23")` y `parseMoney("12.")` = `null`. `formatMoney(123450)` = `L 1,234.50`, `formatMoney(0)` = `L 0.00`, `formatMoney(5)` = `L 0.05`, `formatMoney(122600)` = `L 1,226.00`, `formatMoney(100000000)` = `L 1,000,000.00`, `formatMoney(-6400)` = `"−L 64.00"`; `formatMoneyPlain(123450)` = `1234.50`. Propiedad (1000 enteros no negativos entre 0 y 10 000 000 000 con `mulberry32(20261023)`): `parseMoney(formatMoney(x))` = `x`. Rechazo: `formatMoney(1.5)` lanza `ValidationError`.

Los umbrales de cobertura por archivo de `src/lib/money.ts` del paso 4 siguen vigentes: `allocate` y `prorateDiscount` quedan cubiertos por estas pruebas.

**Done when**
- [ ] WHEN `allocate(100, [1, 1, 1])`, `allocate(10, [1, 2, 3])` y `allocate(1, [1, 1, 1])` se llaman THE SYSTEM SHALL devolver `[34, 33, 33]`, `[2, 3, 5]` y `[1, 0, 0]`.
- [ ] WHEN `prorateDiscount([65000, 64000], 6400)` se llama THE SYSTEM SHALL devolver `[3225, 3175]`.
- [ ] WHEN las pruebas de propiedades corren con 1000 casos generados por mulberry32 con semilla fija THE SYSTEM SHALL cumplir en cada caso que la suma de las partes es igual al total, que ninguna parte es negativa, que cada parte de `prorateDiscount` no supera su línea y que `parseMoney(formatMoney(x))` devuelve `x`.
- [ ] WHEN `parseMoney` recibe `1,234.50`, `L 1,234.5` y `1234` THE SYSTEM SHALL devolver `123450`, `123450` y `123400`, y WHEN recibe `12.345`, `abc` o una cadena vacía THE SYSTEM SHALL devolver `null`.
- [ ] WHEN `formatMoney` recibe `123450`, `0`, `5` y `-6400` THE SYSTEM SHALL devolver `L 1,234.50`, `L 0.00`, `L 0.05` y `−L 64.00` (con U+2212), y `formatMoneyPlain(123450)` SHALL devolver `1234.50`.
- [ ] WHEN `allocate` recibe pesos que suman cero con total mayor que cero, o `prorateDiscount` recibe un descuento mayor que la suma de líneas THE SYSTEM SHALL lanzar `ValidationError`, y WHEN `pnpm test:coverage` corre THE SYSTEM SHALL terminar con código 0 con los umbrales por archivo de `src/lib/money.ts` del paso 4.

**Verify**
```bash
pnpm test:unit                                    # expect: exit 0
out=$(mktemp) && pnpm test:coverage > "$out" && grep -q 'money.ts' "$out"
                                                  # expect: exit 0 — umbrales de money.ts vigentes y medidos
pnpm lint                                         # expect: exit 0
pnpm exec eslint --max-warnings 0                 # expect: exit 0 — cero advertencias en este paso (pnpm lint tolera las advertencias; la puerta de §20.1 no)
pnpm typecheck                                    # expect: exit 0
pnpm format:check                                 # expect: exit 0
status=0; grep -rnE '\.(skip|only)\(' tests/unit || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = sin pruebas omitidas o enfocadas
```

**Checkpoint**
```bash
git add -A && git commit -m "feat(fase-0): E1-T5 money-allocate-format"
git tag step-05-money-allocate-format
# rollback target si el paso 6 sale mal: git reset --hard step-05-money-allocate-format
```

---

#### Step 6 — Permisos por capacidades y hash de contraseñas

**Do**
Define las capacidades y la matriz de roles de `docs/PRD.md` §2 y el hash Argon2id que usará la semilla (paso 8) y la autenticación (Fase 1). Instala la única dependencia nueva del paso: `@node-rs/argon2` (binarios precompilados por plataforma; no tiene script de instalación, así que no necesita `allowBuilds`).

```bash
pnpm add -E @node-rs/argon2@2.2.2
```

Archivos:
- `package.json` — edición: dependencia `@node-rs/argon2` con versión exacta.
- `src/lib/permissions.ts` — exporta `ROLES` (`OWNER`, `MANAGER`, `CASHIER`, `WAREHOUSE`; tupla `as const`), el tipo `Role`, `CAPABILITIES` (tupla `as const` con las 17 capacidades de la tabla), el tipo `Capability`, `ROLE_CAPABILITIES: Record<Role, ReadonlySet<Capability>>`, `MANAGER_PIN_OVERRIDES` (`["discount.applyBeyondLimit", "sale.void"] as const satisfies readonly Capability[]`), `hasCapability(role, capability)`, `requireCapability(actor: { role: Role }, capability)` (lanza `ForbiddenError` de `@/lib/errors` si el rol no la tiene) y `canManagerPinOverride(capability)`. Las 14 capacidades de `docs/ARCHITECTURE.md` §5 más 3 que la matriz del PRD exige: `discount.apply` (descuento hasta el límite del cajero), `cash.viewOthers` (ver cierres de otros cajeros) y `audit.view` (Auditoría, solo Propietario, `docs/UX.md` §2).
- `src/lib/password.ts` — exporta `hashSecret(plain): Promise<string>` y `verifySecret(hash, plain): Promise<boolean>`, con `hash` y `verify` de `@node-rs/argon2`. `hashSecret` pasa `{ algorithm: 2, version: 1, memoryCost: 19456, timeCost: 2, parallelism: 1 }` (2 = Argon2id, 1 = versión 0x13): **valores numéricos, no los `const enum` `Algorithm` y `Version` del paquete**, porque `tsconfig` tiene `isolatedModules: true` y no permite usar enums de constantes ambientales. `verifySecret` devuelve `false` si `verify` lanza (hash mal formado). Se usa para contraseñas y PIN; el rate limiting de PIN es de la Fase 1.
- `tests/unit/permissions.test.ts` — contiene la matriz literal de abajo como un arreglo de filas `[capacidad, owner, manager, cashier, warehouse]` y recorre las 68 celdas (17 filas × 4 roles) con `expect(hasCapability(rol, capacidad)).toBe(esperado)`; comprueba que las capacidades de la matriz son exactamente `CAPABILITIES` (igualdad de conjuntos, no un conteo); `requireCapability({ role: 'CASHIER' }, 'product.viewCost')` lanza `ForbiddenError`; `requireCapability({ role: 'OWNER' }, 'user.manage')` no lanza; `requireCapability({ role: 'WAREHOUSE' }, 'stock.adjust')` no lanza; `MANAGER_PIN_OVERRIDES` contiene `discount.applyBeyondLimit` y `sale.void`, y cada una la tienen `MANAGER` y `OWNER` y no `CASHIER`; `canManagerPinOverride` es verdadera para esas dos y falsa para `product.viewCost`; `ROLES` (ordenado) es igual a `Object.values(Role)` del enum de Prisma importado de `@/generated/prisma/enums` (guarda contra deriva entre las dos listas; el enum es TypeScript puro y no abre conexión); una línea `// @ts-expect-error capacidad inexistente` sobre `hasCapability("OWNER", "capacidad.inexistente")`, cuyo resultado en ejecución es `false`.
- `tests/unit/password.test.ts` — `hashSecret("Demo-Cajero-2026")` es distinta del texto plano y empieza con `$argon2id$`; `verifySecret(hash, "Demo-Cajero-2026")` es `true` y con otro texto `false`; dos hashes del mismo texto son distintos (sal aleatoria); `verifySecret("no-es-un-hash", "x")` es `false`.

**Matriz literal de capacidades por rol** (✓ = el rol la tiene; – = no). Se deriva fila por fila de `docs/PRD.md` §2, y por eso la prueba la repite celda por celda:

| Capacidad | Fila del PRD §2 | OWNER | MANAGER | CASHIER | WAREHOUSE |
|---|---|:-:|:-:|:-:|:-:|
| `sale.create` | Vender / cobrar | ✓ | ✓ | ✓ | – |
| `discount.apply` | Descuento hasta el límite del cajero | ✓ | ✓ | ✓ | – |
| `discount.applyBeyondLimit` | Descuento sobre el límite (cajero: PIN de gerente) | ✓ | ✓ | – | – |
| `sale.void` | Anular venta (cajero: PIN de gerente) | ✓ | ✓ | – | – |
| `return.create` | Devoluciones / cambios | ✓ | ✓ | ✓ | – |
| `cash.open` | Abrir / cerrar caja propia | ✓ | ✓ | ✓ | – |
| `cash.closeApprove` | Flujo "Cierre de caja" del PRD §5 (el gerente aprueba) y lista de `docs/ARCHITECTURE.md` §5 | ✓ | ✓ | – | – |
| `cash.viewOthers` | Ver cierres de otros cajeros | ✓ | ✓ | – | – |
| `product.write` | Crear / editar productos | ✓ | ✓ | – | ✓ |
| `product.viewCost` | Ver costos y márgenes | ✓ | ✓ | – | – |
| `price.change` | Cambiar precios | ✓ | ✓ | – | – |
| `stock.adjust` | Ajustes de inventario (almacén: con motivo) | ✓ | ✓ | – | ✓ |
| `purchase.receive` | Recibir compras | ✓ | ✓ | – | ✓ |
| `report.financial` | Reportes financieros | ✓ | ✓ | – | – |
| `user.manage` | Usuarios y configuración | ✓ | – | – | – |
| `settings.manage` | Usuarios y configuración | ✓ | – | – | – |
| `audit.view` | Auditoría solo del Propietario (`docs/UX.md` §2) | ✓ | – | – | – |

**Done when**
- [ ] WHEN `hasCapability(rol, capacidad)` se evalúa para cada celda de la matriz del paso THE SYSTEM SHALL devolver exactamente el valor de la tabla.
- [ ] WHEN `requireCapability({ role: 'CASHIER' }, 'product.viewCost')` se llama THE SYSTEM SHALL lanzar `ForbiddenError`, y WHEN se llama con `{ role: 'OWNER' }` y `'user.manage'` THE SYSTEM SHALL no lanzar.
- [ ] WHEN `MANAGER_PIN_OVERRIDES` se evalúa THE SYSTEM SHALL contener `discount.applyBeyondLimit` y `sale.void`, y cada una SHALL estar en los conjuntos de `MANAGER` y `OWNER` y ausente del de `CASHIER`.
- [ ] WHEN `pnpm typecheck` corre THE SYSTEM SHALL terminar con código 0 gracias a que `hasCapability('OWNER', 'capacidad.inexistente')` produce un error de tipos marcado con `@ts-expect-error`.
- [ ] WHEN `hashSecret('Demo-Cajero-2026')` se llama THE SYSTEM SHALL devolver un hash distinto del texto plano que empieza con `$argon2id$`, que `verifySecret` acepta con el texto correcto y rechaza con otro, y WHEN `verifySecret` recibe un hash malformado THE SYSTEM SHALL devolver `false`.
- [ ] WHEN `pnpm test:unit` corre THE SYSTEM SHALL comprobar que `ROLES` es igual al conjunto de valores del enum `Role` generado por Prisma.

**Verify**
```bash
pnpm install --frozen-lockfile                    # expect: exit 0
pnpm test:unit                                    # expect: exit 0 — permissions.test.ts y password.test.ts
pnpm lint                                         # expect: exit 0
pnpm exec eslint --max-warnings 0                 # expect: exit 0 — cero advertencias en este paso (pnpm lint tolera las advertencias; la puerta de §20.1 no)
pnpm typecheck                                    # expect: exit 0 — falla si el @ts-expect-error ya no encuentra su error
pnpm format:check                                 # expect: exit 0
grep -qF '"@node-rs/argon2": "2.2.2"' package.json   # expect: exit 0
status=0; grep -rnE '\.(skip|only)\(' tests/unit || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = sin pruebas omitidas o enfocadas
```

**Checkpoint**
```bash
git add -A && git commit -m "feat(fase-0): E1-T6 permissions-password"
git tag step-06-permissions-password
# rollback target si el paso 7 sale mal: git reset --hard step-06-permissions-password
```

---

#### Step 7 — Auditoría y pruebas de integración contra Postgres real

**Do**
Este es el primer paso que toca la capa de datos. Escribe `audit.log` y la primera prueba de integración, que ejercita la infraestructura que el Bootstrap ya dejó lista: la BD de pruebas `boutique_pos_test` creada por `docker/postgres/init`, `DATABASE_URL_TEST` en `.env`, y los archivos del workspace `tests/integration/global-setup.ts` (aplica `prisma migrate deploy` a la BD de pruebas antes de las pruebas del proyecto `integration`) y `tests/integration/helpers/db.ts` (exporta `testDb`, `resetDatabase()`, `closeDatabase()` y `assertTestDatabaseUrl`; contenido en §19.6). **Esos helpers se niegan a trabajar con una base cuyo nombre no termine en `_test`**, porque `resetDatabase()` hace `TRUNCATE` de todas las tablas.

Archivos:
- `src/lib/audit.ts` — exporta `AUDIT_ACTIONS` (tupla `as const`: `SALE_VOIDED`, `DISCOUNT_OVERRIDE`, `STOCK_ADJUSTED`, `PRICE_CHANGED`, `COST_CHANGED`, `CASH_SESSION_CLOSED`, `PERMISSION_CHANGED`; son las acciones sensibles de `CLAUDE.md` §6.7: anulaciones, descuentos sobre el límite, ajustes de inventario, cambios de precio y de costo, cierres de caja, cambios de permisos), el tipo `AuditAction`, `AuditEntry` (`{ userId?: string | null; action: AuditAction; entityType: string; entityId: string; before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue; reason?: string; ip?: string }`) y el objeto `audit` con `log(tx, entry)`, donde `tx` es `Pick<Prisma.TransactionClient, "auditLog">` (acepta el cliente de una transacción y el cliente normal; `Prisma` se importa de `@/generated/prisma/client`). `log` hace `tx.auditLog.create` con los campos de la entrada y no devuelve nada.
- `tests/integration/audit.test.ts` — `beforeEach(resetDatabase)` y `afterAll(closeDatabase)`; un `User` de apoyo creado con `testDb.user.create` (`name`, `username` único, `passwordHash: "x"`, `role: "OWNER"`). Casos: (a) dentro de `testDb.$transaction(async (tx) => audit.log(tx, {...}))` con `userId`, `action` `SALE_VOIDED`, `entityType` `Sale`, `entityId` `sale-1`, `reason` `Cliente devolvió la prenda`, `before` `{ status: 'COMPLETED' }` y `after` `{ status: 'VOIDED' }`: tras confirmar existe una fila con esos valores (`before` y `after` iguales por valor); (b) la misma llamada seguida de `throw new Error("rollback")` dentro de la transacción: `rejects.toThrow("rollback")` y cero filas con `entityId` `sale-1`; (c) `testDb.$executeRaw` de un `UPDATE "AuditLog" SET "reason" = 'x'` y de un `DELETE FROM "AuditLog"` rechazan con un error cuyo texto serializado (mensaje, `code`, `meta` y `cause` recorridos, vía una función auxiliar `errorText(error)` del propio test) coincide con `/solo inserción|23001/`, y la fila sigue con su `reason` original; (d) tras insertar filas, `resetDatabase()` deja `AuditLog` y `User` vacíos y `_prisma_migrations` intacta (`SELECT count(*)` mayor que 0 antes y después); (e) `assertTestDatabaseUrl("postgresql://u:p@localhost:5432/boutique_pos")` lanza y `assertTestDatabaseUrl("postgresql://u:p@localhost:5432/boutique_pos_test")` no; (f) una prueba que define `const attempt = (): Promise<void> =>` seguida de la línea `// @ts-expect-error acción fuera de AuditAction` y, en la línea siguiente, `audit.log(testDb, { action: "ACCION_INVENTADA", entityType: "X", entityId: "1" });` (la función `attempt` nunca se invoca; la prueba solo comprueba `typeof attempt` igual a `function`, de modo que únicamente el verificador de tipos ve la llamada).

**Done when**
- [ ] WHEN `audit.log(tx, entry)` corre dentro de `testDb.$transaction` y la transacción confirma THE SYSTEM SHALL persistir una fila de `AuditLog` con los mismos `userId`, `action`, `entityType`, `entityId`, `reason`, `before` y `after`.
- [ ] WHEN la transacción lanza un error después de `audit.log` THE SYSTEM SHALL dejar cero filas de `AuditLog` para ese `entityId`.
- [ ] WHEN un `UPDATE` o un `DELETE` crudo se ejecuta sobre `AuditLog` THE SYSTEM SHALL rechazarlo con un error cuyo texto coincide con `solo inserción` o con el código `23001` y dejar la fila intacta.
- [ ] WHEN `resetDatabase()` corre THE SYSTEM SHALL vaciar todas las tablas de la aplicación sin tocar `_prisma_migrations`, y `assertTestDatabaseUrl` SHALL lanzar un error cuando el nombre de la base no termina en `_test`.
- [ ] WHEN `pnpm typecheck` corre THE SYSTEM SHALL terminar con código 0 gracias a que una acción fuera de `AuditAction` en `tests/integration/audit.test.ts` produce un error de tipos marcado con `@ts-expect-error`.
- [ ] WHEN `pnpm test:integration` corre contra `DATABASE_URL_TEST` THE SYSTEM SHALL aplicar las migraciones con `globalSetup` y terminar con código 0.

**Verify**
```bash
pnpm test:integration                             # expect: exit 0 — globalSetup migra boutique_pos_test y corre audit.test.ts (la BD de Docker debe estar arriba: `pnpm db:up`)
pnpm test:unit                                    # expect: exit 0
pnpm lint                                         # expect: exit 0
pnpm exec eslint --max-warnings 0                 # expect: exit 0 — cero advertencias en este paso (pnpm lint tolera las advertencias; la puerta de §20.1 no)
pnpm typecheck                                    # expect: exit 0
pnpm format:check                                 # expect: exit 0
status=0; grep -rnE '\.(skip|only)\(' tests/integration || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = sin pruebas omitidas o enfocadas
```

**Checkpoint**
```bash
git add -A && git commit -m "feat(fase-0): E1-T7 audit-integration"
git tag step-07-audit-integration
git ls-files --error-unmatch tests/integration/audit.test.ts   # expect: exit 0 — ya confirmado en git
# rollback target si el paso 8 sale mal: git reset --hard step-07-audit-integration
```

---

#### Step 8 — Semilla mínima idempotente

**Do**
Crea la semilla que deja una base recién migrada usable en desarrollo. Es idempotente: correrla dos veces no duplica filas, **no reinicia los contadores de documentos** (`CLAUDE.md` §6.8: correlativos sin saltos) y **no vuelve a hashear** a usuarios que ya existen. Se niega a correr con `NODE_ENV=production`. Cambia también el script `db:reset`, porque Prisma 7 ya no ejecuta la semilla tras `migrate reset`.

```bash
npm pkg set scripts.db:reset="prisma migrate reset --force && pnpm db:seed"
pnpm format
```

Archivos:
- `package.json` — edición: `db:reset` pasa a `prisma migrate reset --force && pnpm db:seed` (los demás scripts no cambian).
- `prisma/seed/run-seed.ts` — exporta `DEMO_USERS` (tabla de abajo, para pruebas y README) y `runSeed(client: PrismaClient)`. Importa **por rutas relativas sin extensión** (`../../src/generated/prisma/client` solo para el tipo y `../../src/lib/password`), nunca con `@/`, porque lo ejecutan `tsx` y Vitest (convención de la matriz de §19.6). Lo primero que hace `runSeed` es lanzar un `Error` cuyo mensaje contiene `production` si `process.env.NODE_ENV` es `production`, antes de escribir nada.
- `prisma/seed.ts` — entrada de `prisma db seed`: `import "dotenv/config"`, construye `new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })` igual que `src/lib/db.ts` (lanza si `DATABASE_URL` falta), llama `runSeed`, desconecta en `finally` e imprime una línea de resumen; un error termina el proceso con código 1.
- `tests/integration/seed.test.ts` — ver abajo.

**Contenido de la semilla (literal).**
- `Location`: `{ code: "MAIN", name: "Tienda principal", isDefault: true, type: "STORE" }` (upsert por `code`). `Terminal`: nombre `Caja 1` en esa ubicación (buscar por nombre y ubicación; crear si no existe).
- Usuarios (upsert por `username`; si ya existe solo se actualizan `name` y `role`, nunca los hashes; solo se hashea para crear):

| username | name | role | contraseña demo | PIN demo |
|---|---|---|---|---|
| `owner` | Propietario Demo | `OWNER` | `Demo-Propietario-2026` | `1111` |
| `manager` | Gerente Demo | `MANAGER` | `Demo-Gerente-2026` | `2222` |
| `cashier` | Cajero Demo | `CASHIER` | `Demo-Cajero-2026` | `3333` |
| `warehouse` | Almacén Demo | `WAREHOUSE` | `Demo-Almacen-2026` | `4444` |

  Contraseñas y PIN se guardan con `hashSecret` (paso 6) en `passwordHash` y `pinHash`. Son **solo para desarrollo**; la rotación antes de producción está en la lista de lanzamiento de §20.1.
- `Size` (upsert por `name`): grupo `ropa` con `XS`, `S`, `M`, `L`, `XL`, `XXL` (`sortOrder` 1 a 6) y grupo `calzado` con `34`, `35`, `36`, `37`, `38`, `39`, `40`, `41`, `42` (`sortOrder` 10 a 18).
- `Color` (upsert por `name`, `sortOrder` 1 a 12 en este orden): Negro `#1A1A1A`, Blanco `#FFFFFF`, Gris `#8A8A8A`, Beige `#D9C7A7`, Café `#6B4423`, Rojo `#B42318`, Rosa `#E58EA7`, Azul marino `#1F2A5C`, Azul `#2F6DB5`, Verde `#3F7F4F`, Amarillo `#E8C547`, Morado `#6B3FA0`.
- `Category` (upsert por `slug`, padres primero, `sortOrder` por posición): `mujer` (Mujer), `mujer-vestidos` (Vestidos, padre `mujer`), `mujer-blusas` (Blusas, padre `mujer`), `hombre` (Hombre), `hombre-camisas` (Camisas, padre `hombre`), `ninos` (Niños), `accesorios` (Accesorios), `calzado` (Calzado).
- `BusinessProfile`: si no existe ninguna fila, crea una con `legalName` igual a `Mi Boutique (por configurar)`.
- `Setting` (upsert por `key`, sin sobrescribir valores existentes): `tax.rate` = `1500`, `tax.pricesIncludeTax` = `true`, `sales.allowNegativeStock` = `false`, `discount.maxPercent.CASHIER` = `10`, `returns.maxDays` = `8`, `layaway.expiryDays` = `30`, `ticket.footer` = `¡Gracias por tu compra!`.
- `DocumentCounter` (upsert por `key`, sin sobrescribir): `SALE`, `RETURN`, `LAYAWAY`, `PURCHASE_ORDER`, `GOODS_RECEIPT`, cada uno con `nextValue` 1 al crearse.

**`tests/integration/seed.test.ts`.** `beforeAll`: `resetDatabase()` y dos llamadas seguidas a `runSeed(testDb)`; `afterAll(closeDatabase)`. Afirma por entidades con nombre, nunca por conteo de filas: los cuatro usuarios con su rol; `verifySecret(hash, contraseña)` y `verifySecret(pinHash, PIN)` verdaderos para `cashier`; `MAIN` con `isDefault`; la terminal `Caja 1` en `MAIN`; tallas `XS`, `XXL` (grupo `ropa`), `34` y `42` (grupo `calzado`); color `Negro` con `hex` `#1A1A1A`; categoría `mujer-vestidos` con padre `mujer`; los siete ajustes con los valores de arriba (`valueJson` compara con `toBe`); los cinco contadores existen. Luego: pone `SALE` en `nextValue` 5 con `testDb.documentCounter.update`, guarda el `passwordHash` y el `pinHash` de `owner`, corre `runSeed` otra vez y comprueba que `SALE` sigue en 5 y que el `passwordHash` y el `pinHash` de `owner` no cambiaron (comparados con `toBe` contra los valores guardados). Un segundo `describe`: `resetDatabase()`, `vi.stubEnv("NODE_ENV", "production")`, `await expect(runSeed(testDb)).rejects.toThrow(/production/)` y `testDb.user.findUnique({ where: { username: "owner" } })` es `null`; `afterEach(() => vi.unstubAllEnvs())`.

**Done when**
- [ ] WHEN `runSeed(testDb)` corre dos veces seguidas THE SYSTEM SHALL terminar sin error ambas veces y dejar los usuarios `owner`, `manager`, `cashier` y `warehouse` con los roles `OWNER`, `MANAGER`, `CASHIER` y `WAREHOUSE`.
- [ ] WHEN el seed termina THE SYSTEM SHALL tener la ubicación `MAIN` con `isDefault` verdadero, la terminal `Caja 1` en ella, las tallas `XS`, `XXL`, `34` y `42`, el color `Negro` con `hex`, y la categoría `mujer-vestidos` con padre `mujer`.
- [ ] WHEN el seed termina THE SYSTEM SHALL tener los ajustes `tax.rate` igual a `1500`, `tax.pricesIncludeTax` verdadero, `sales.allowNegativeStock` falso, `discount.maxPercent.CASHIER` igual a `10`, `returns.maxDays` igual a `8` y `layaway.expiryDays` igual a `30`, y los contadores `SALE`, `RETURN`, `LAYAWAY`, `PURCHASE_ORDER` y `GOODS_RECEIPT`.
- [ ] WHEN el contador `SALE` vale 5 y el seed corre de nuevo THE SYSTEM SHALL conservar `5` y conservar sin cambios los `passwordHash` y `pinHash` ya existentes.
- [ ] WHEN `NODE_ENV` es `production` THE SYSTEM SHALL rechazar `runSeed` con un error que menciona `production` sin escribir filas.
- [ ] WHEN `pnpm db:seed` corre dos veces sobre la base de desarrollo THE SYSTEM SHALL terminar con código 0 ambas veces, y `package.json` SHALL definir `db:reset` como `prisma migrate reset --force && pnpm db:seed`.

**Verify**
```bash
pnpm test:integration                             # expect: exit 0 — seed.test.ts, audit.test.ts
pnpm db:seed                                      # expect: exit 0 — primera pasada sobre la BD de desarrollo (`prisma db seed` ejecuta `tsx prisma/seed.ts` y lee .env)
pnpm db:seed                                      # expect: exit 0 — segunda pasada idempotente
grep -qF '"db:reset": "prisma migrate reset --force && pnpm db:seed"' package.json   # expect: exit 0
pnpm test:unit                                    # expect: exit 0
pnpm lint                                         # expect: exit 0
pnpm exec eslint --max-warnings 0                 # expect: exit 0 — cero advertencias en este paso (pnpm lint tolera las advertencias; la puerta de §20.1 no)
pnpm typecheck                                    # expect: exit 0
pnpm format:check                                 # expect: exit 0
status=0; grep -rnE '\.(skip|only)\(' tests/integration || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = sin pruebas omitidas o enfocadas
```
No se ejecuta `pnpm db:reset` como gate: borra la base de desarrollo y está en la lista de denegados de `settings.json`; su definición se comprueba por texto.

**Checkpoint**
```bash
git add -A && git commit -m "feat(fase-0): E2-T1 seed"
git tag step-08-seed
git ls-files --error-unmatch prisma/seed/run-seed.ts   # expect: exit 0 — ya confirmado en git
# rollback target si el paso 9 sale mal: git reset --hard step-08-seed
```

---

#### Step 9 — `/api/health` servido de verdad

**Do**
Crea el único endpoint de la fase y **ejecútalo servido**: este es el primer artefacto que corre como servidor, así que su `Verify` arranca `next start` y le pide la ruta. Para que la ruta de fallo se pruebe sin mockear el motor de Prisma, la comprobación se inyecta. `scripts/smoke-server.ts` (workspace, contenido en §19.6) arranca `next start` o `next dev` en un puerto, espera a que responda, pide cada `ruta=estado[:texto]` que recibe y mata el árbol de procesos al terminar; sale con código 1 si algo no coincide.

Archivos:
- `src/lib/health.ts` — exporta `checkDatabase(query: () => Promise<unknown>): Promise<boolean>` (`true` si la consulta resuelve; `false` si rechaza, sin propagar ni registrar el error), `createHealthHandler(check: () => Promise<boolean>)` que devuelve una función `async` sin parámetros con `Response.json({ status: healthy ? "ok" : "error" }, { status: healthy ? 200 : 503 })`, y `pingDatabase()` = ``checkDatabase(() => db.$queryRaw`select 1`)`` con `db` de `@/lib/db`.
- `src/app/api/health/route.ts` — `import { connection } from "next/server"`; `const handler = createHealthHandler(pingDatabase)`; `export async function GET(): Promise<Response> { await connection(); return handler(); }`. `connection()` excluye el handler del prerenderizado; con Cache Components una consulta a la BD ya lo hace dinámico, y esta llamada lo hace explícito para que un build sin BD nunca congele un 503. **El archivo no exporta `dynamic`, `revalidate` ni `fetchCache`.**
- `tests/integration/health.test.ts` — importa `checkDatabase`, `createHealthHandler`, `pingDatabase` de `@/lib/health` y `db` de `@/lib/db`; `afterAll(() => db.$disconnect())`. Casos: (a) `createHealthHandler(pingDatabase)()` responde 200 y su JSON es `{ status: 'ok' }`; (b) `createHealthHandler(() => Promise.resolve(false))()` responde 503 y su cuerpo de texto es exactamente `{"status":"error"}`; (c) `checkDatabase(() => Promise.reject(new Error("detalle-secreto")))` es `false` y el cuerpo de un handler que usa ese resultado no contiene `detalle-secreto`; (d) `checkDatabase(() => Promise.resolve(1))` es `true`. El módulo `route.ts` no se importa en la prueba (`connection()` solo es válido dentro de una petición de Next); lo cubre la ejecución servida de abajo.

**Done when**
- [ ] WHEN el handler creado con `pingDatabase` se invoca contra la base de pruebas THE SYSTEM SHALL responder 200 con el JSON `{ status: 'ok' }`.
- [ ] WHEN la comprobación de base de datos falla THE SYSTEM SHALL responder 503 con el JSON `{ status: 'error' }` y SHALL NOT incluir el texto del error original en el cuerpo.
- [ ] WHEN `checkDatabase` recibe una consulta que rechaza THE SYSTEM SHALL devolver `false` sin propagar el error, y WHEN recibe una que resuelve THE SYSTEM SHALL devolver `true`.
- [ ] WHEN `pnpm build` termina y `scripts/smoke-server.ts` arranca `next start` en el puerto 3190 THE SYSTEM SHALL recibir 200 con un cuerpo que contiene `ok` en `/api/health`, y WHEN arranca `next dev` en el puerto 3191 THE SYSTEM SHALL recibir 200 con un cuerpo que contiene `ok` en `/api/health`.
- [ ] WHEN se buscan segment configs en `src/app` THE SYSTEM SHALL no encontrar `export const dynamic`, `revalidate` ni `fetchCache`.
- [ ] WHEN `pnpm lint`, `pnpm typecheck` y `pnpm format:check` corren al cerrar el paso THE SYSTEM SHALL terminar con código 0 en los tres.

**Verify**
```bash
pnpm test:integration                             # expect: exit 0 — health.test.ts y audit.test.ts (el paso 9 depende del paso 7, no del 8)
pnpm lint                                         # expect: exit 0
pnpm exec eslint --max-warnings 0                 # expect: exit 0 — cero advertencias en este paso (pnpm lint tolera las advertencias; la puerta de §20.1 no)
pnpm typecheck                                    # expect: exit 0
pnpm format:check                                 # expect: exit 0
pnpm build                                        # expect: exit 0 — Cache Components: sin segment configs y sin datos de petición fuera de Suspense
pnpm exec tsx scripts/smoke-server.ts start 3190 /api/health=200:ok
                                                  # expect: exit 0 — next start sirve el endpoint real contra la BD de desarrollo: 200 y cuerpo con `ok`
pnpm exec tsx scripts/smoke-server.ts dev 3191 /api/health=200:ok
                                                  # expect: exit 0 — `next dev` también sirve el endpoint (el script mata el árbol de procesos al terminar); así el arranque de desarrollo se ejerce desde el primer paso servido
status=0; grep -rnE 'export const (dynamic|revalidate|fetchCache)' src/app || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = ningún segment config
```

**Checkpoint**
```bash
git add -A && git commit -m "feat(fase-0): E2-T2 health"
git tag step-09-health
git ls-files --error-unmatch src/app/api/health/route.ts   # expect: exit 0 — ya confirmado en git
# rollback target si el paso 10 sale mal: git reset --hard step-09-health
```

---

#### Step 10 — Primitivas de UI: shadcn y TanStack Table

**Do**
Prepara los componentes base que la interfaz necesita antes de escribir pantallas: instala TanStack Table (versión exacta) y copia con el CLI de shadcn las nueve primitivas nuevas (existe `button`; **no pases `--overwrite`**). Lo que copia el CLI es salida de herramienta y cuenta como una sola entrada en los archivos del paso (`src/components/ui/**`), junto con el hook que trae el CLI. Lee primero `src/components/ui/button.tsx`: los componentes generados usan Base UI (`render` en lugar de `asChild`). Los textos en español salen de `messages` (paso 2): por eso este paso depende del paso 2. Los tokens de color y la fuente llegan en el paso 11.

```bash
pnpm add -E @tanstack/react-table@8.21.3
pnpm dlx shadcn@4.22.1 add sidebar table alert-dialog dialog skeleton input tooltip separator sheet --yes
pnpm format
```
Si `pnpm install` o el CLI terminan con `ERR_PNPM_IGNORED_BUILDS`, la causa es un paquete nuevo con script de instalación: léelo del mensaje y decide con el riesgo 3 de §20.2 (nunca `dangerouslyAllowAllBuilds`).

Archivos:
- `package.json` — edición: `@tanstack/react-table` con versión exacta (el CLI puede añadir dependencias que ya existen; no debe subir ninguna de las congeladas).
- `src/components/ui/**` — nuevos (copiados por el CLI): `sidebar.tsx`, `table.tsx`, `alert-dialog.tsx`, `dialog.tsx`, `skeleton.tsx`, `input.tsx`, `tooltip.tsx`, `separator.tsx`, `sheet.tsx`; son código del proyecto y se editan sin pudor. Ajustes obligatorios: (a) los separadores decorativos usan el token `divider` (en `separator.tsx` cambia `bg-border` por `bg-divider`; en `table.tsx` los bordes de fila usan `border-divider`; el token se define en el paso 11); (b) los textos en inglés que deje el CLI (`Toggle Sidebar`, `Close`) leen `messages.common.toggleSidebar` y `messages.common.close` de `@/config/messages.es`: el `span` `sr-only`, y también cualquier `aria-label` o `title` con `Toggle Sidebar` (no se conserva ninguno en inglés; el botón de cierre de `dialog.tsx` y de `sheet.tsx` y el riel y el disparador de `sidebar.tsx` son los sitios habituales; búscalos con `grep -rn 'sr-only\|Toggle Sidebar\|Close' src/components/ui`). Si el CLI no modifica `button.tsx`, no lo toques.
- `src/hooks/use-mobile.ts` — lo copia el CLI (lo usa `sidebar.tsx`).

**Done when**
- [ ] WHEN el CLI de shadcn termina y se aplican los ajustes del paso THE SYSTEM SHALL haber creado `sidebar`, `table`, `alert-dialog`, `dialog`, `skeleton`, `input`, `tooltip`, `separator` y `sheet` en `src/components/ui/`, con `separator` y `table` usando el token `divider` y sin los textos sr-only en inglés `Toggle Sidebar` ni `Close`.
- [ ] WHEN `package.json` se lee THE SYSTEM SHALL declarar `@tanstack/react-table` con la versión exacta `8.21.3`.
- [ ] WHEN `pnpm build` corre con `cacheComponents` activo THE SYSTEM SHALL terminar con código 0.
- [ ] WHEN se buscan segment configs en `src` THE SYSTEM SHALL no encontrar `export const dynamic`, `revalidate` ni `fetchCache`.
- [ ] WHEN `pnpm lint`, `pnpm typecheck` y `pnpm format:check` corren al cerrar el paso THE SYSTEM SHALL terminar con código 0 en los tres.

**Verify**
```bash
pnpm install --frozen-lockfile                    # expect: exit 0
test -f src/components/ui/sidebar.tsx && test -f src/components/ui/table.tsx && test -f src/components/ui/alert-dialog.tsx && test -f src/components/ui/dialog.tsx && test -f src/components/ui/skeleton.tsx && test -f src/components/ui/input.tsx && test -f src/components/ui/tooltip.tsx && test -f src/components/ui/separator.tsx && test -f src/components/ui/sheet.tsx
                                                  # expect: exit 0 — las nueve primitivas existen
grep -qF 'bg-divider' src/components/ui/separator.tsx   # expect: exit 0
grep -qF 'border-divider' src/components/ui/table.tsx   # expect: exit 0
status=0; grep -rnF 'Toggle Sidebar' src/components/ui || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = ninguna aparición del texto en inglés (span sr-only, aria-label o title; no depende de cómo se parta el JSX)
status=0; grep -rnE '(^|[>"])[[:space:]]*Close[[:space:]]*($|[<"])' src/components/ui || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = ningún texto `Close` solo (en la misma línea, entre comillas o en una línea propia); no coincide con DialogClose ni con DialogPrimitive.Close
grep -qF '"@tanstack/react-table": "8.21.3"' package.json   # expect: exit 0
status=0; grep -rnE 'export const (dynamic|revalidate|fetchCache)' src || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = ningún segment config
pnpm build                                        # expect: exit 0 — la fuente actual (Geist) se descarga de Google Fonts durante el build (necesita red)
pnpm lint                                         # expect: exit 0
pnpm exec eslint --max-warnings 0                 # expect: exit 0 — cero advertencias en este paso (pnpm lint tolera las advertencias; la puerta de §20.1 no)
pnpm typecheck                                    # expect: exit 0
pnpm format:check                                 # expect: exit 0
```

**Checkpoint**
```bash
git add -A && git commit -m "feat(fase-0): E2-T3 ui-primitives"
git tag step-10-ui-primitives
git ls-files --error-unmatch src/components/ui/sidebar.tsx   # expect: exit 0 — ya confirmado en git
# rollback target si el paso 11 sale mal: git reset --hard step-10-ui-primitives
```

---

#### Step 11 — Tokens de diseño e Inter

**Do**
Aplica los tokens de §7 en `src/app/globals.css` y cambia Geist por Inter en `src/app/layout.tsx`. Depende del paso 2 porque el layout lee `messages.app.name` de `@/config/messages.es`.

Archivos:
- `src/app/globals.css` — edición: tokens de §7. Conserva `@import`s, `@custom-variant`, las asignaciones `--color-*` y `--radius-*` existentes y los `--chart-*`; y **conserva la línea `@source not "../../blueprints";`** que dejó el Bootstrap (excluye el bundle del escaneo automático de Tailwind). Cambios:

```css
/* dentro de @theme inline, junto a las asignaciones existentes */
--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
--color-success: var(--success);
--color-warning: var(--warning);
--color-info: var(--info);
--color-divider: var(--divider);
--default-transition-duration: 150ms;
--default-transition-timing-function: ease-out;
```
(y se elimina `--font-mono: var(--font-geist-mono);`). Bloque `:root` (hex en minúsculas; Prettier no los reescribe):

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
```
Bloque `.dark` (mismas claves; los `--chart-*` y `--radius` no cambian):

```css
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
Al final del archivo añade la clase de dinero y la regla de movimiento reducido:

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
- `src/app/layout.tsx` — edición: reemplaza Geist y Geist Mono por `Inter` de `next/font/google` con `subsets: ["latin"]`, `display: "swap"` y `variable: "--font-sans"`; `metadata.title` pasa a `messages.app.name` (de `@/config/messages.es`); conserva `description` y `<html lang="es-HN">`, ahora con ``className={`${inter.variable} h-full antialiased`}``. El tipo del layout sigue siendo `LayoutProps<"/">`.

**Done when**
- [ ] WHEN `src/app/globals.css` se lee THE SYSTEM SHALL definir los tokens claros `--background: #FAF8F5`, `--primary: #3F6350` y `--destructive: #B42318` y los oscuros `--background: #16140F` y `--primary: #8DB59F`, además de `--success`, `--warning`, `--info` y `--divider`.
- [ ] WHEN `src/app/layout.tsx` se lee THE SYSTEM SHALL cargar `Inter` con `next/font/google`, `display` igual a `swap` y la variable `--font-sans`, sin referencias a `Geist`, y SHALL conservar `lang` igual a `es-HN`.
- [ ] WHEN `src/app/globals.css` se lee THE SYSTEM SHALL conservar la exclusión `@source not` del bundle de blueprints y definir la clase `.money` y la regla `prefers-reduced-motion`.
- [ ] WHEN `pnpm build` corre con `cacheComponents` activo THE SYSTEM SHALL terminar con código 0.
- [ ] WHEN `pnpm lint`, `pnpm typecheck` y `pnpm format:check` corren al cerrar el paso THE SYSTEM SHALL terminar con código 0 en los tres.

**Verify**
```bash
grep -qiF -- '--background: #faf8f5;' src/app/globals.css   # expect: exit 0
grep -qiF -- '--primary: #3f6350;' src/app/globals.css      # expect: exit 0
grep -qiF -- '--destructive: #b42318;' src/app/globals.css  # expect: exit 0
grep -qiF -- '--background: #16140f;' src/app/globals.css   # expect: exit 0
grep -qiF -- '--primary: #8db59f;' src/app/globals.css      # expect: exit 0
grep -qF -- '--divider:' src/app/globals.css      # expect: exit 0
grep -qF -- '--success:' src/app/globals.css      # expect: exit 0
grep -qF -- '--warning:' src/app/globals.css      # expect: exit 0
grep -qF -- '--info:' src/app/globals.css         # expect: exit 0
grep -qF '@source not "../../blueprints";' src/app/globals.css   # expect: exit 0 — la exclusión del Bootstrap sigue en pie
grep -qF '.money' src/app/globals.css             # expect: exit 0 — la clase de dinero existe
grep -qF 'prefers-reduced-motion' src/app/globals.css   # expect: exit 0
grep -qE '\bInter\(' src/app/layout.tsx   # expect: exit 0
grep -qF 'display: "swap"' src/app/layout.tsx   # expect: exit 0
grep -qF 'variable: "--font-sans"' src/app/layout.tsx   # expect: exit 0
grep -qF 'lang="es-HN"' src/app/layout.tsx        # expect: exit 0
status=0; grep -q 'Geist' src/app/layout.tsx || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = sin referencias a Geist
pnpm build                                        # expect: exit 0 — Inter se descarga de Google Fonts durante el build (necesita red)
pnpm lint                                         # expect: exit 0
pnpm exec eslint --max-warnings 0                 # expect: exit 0 — cero advertencias en este paso (pnpm lint tolera las advertencias; la puerta de §20.1 no)
pnpm typecheck                                    # expect: exit 0
pnpm format:check                                 # expect: exit 0
```

**Checkpoint**
```bash
git add -A && git commit -m "feat(fase-0): E2-T4 design-tokens"
git tag step-11-design-tokens
# rollback target si el paso 12 sale mal: git reset --hard step-11-design-tokens
```

---

#### Step 12 — Shell de aplicación y estados de ruta

**Do**
Construye el shell: barra lateral con **un solo elemento, "Inicio"** (los demás módulos aparecen en su fase), barra superior, página de inicio y las tres páginas de estado de ruta. Antes de escribir, lee `src/components/ui/sidebar.tsx` (API real de los componentes generados) y las guías `layout.md`, `loading.md`, `error.md` y `not-found.md` en `node_modules/.pnpm/next@16.4.2_*/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/`. Todo texto sale de `messages` (paso 2). **Orden:** escribe primero `src/app/(app)/layout.tsx` (así existe el directorio `src/app/(app)/`) y solo después ejecuta el `git mv` de la página; `git mv` no crea directorios y por eso no hace falta `mkdir`.

Archivos:
- `src/app/(app)/layout.tsx` — componente de servidor, **sin `cookies()` ni `headers()`** (estático; con Cache Components cualquier dato de petición futuro irá dentro de `<Suspense>`). Estructura: enlace `Saltar al contenido` (`messages.common.skipToContent`, visible solo al enfocarlo) hacia `#contenido`; `SidebarProvider` con `Sidebar` (marca `messages.app.name` y un `SidebarMenu` que primero renderiza `homeItem` —un `SidebarMenuButton` cuyo `render` es un `Link` a `homeItem.href` con `<homeItem.icon />` y el texto `homeItem.label`— y debajo `navGroups.map((group) => …)`: un `SidebarGroup` con `key={group.label}`, su etiqueta y un `SidebarMenuButton` por elemento de `group.items`, con el mismo patrón de `Link`); `SidebarInset` con una `header` (`SidebarTrigger` y `Separator` vertical) y `main` con `id="contenido"` que renderiza `children`. Antes del componente, dos tipos y dos constantes sin exportar y **sin comentarios**: `type NavItem = { href: string; label: string; icon: LucideIcon }` (`LucideIcon` de `lucide-react`), `type NavGroup = { label: string; items: readonly NavItem[] }`, `const homeItem: NavItem = { href: "/", label: messages.nav.home, icon: House }` (`House` de `lucide-react`) y `const navGroups: readonly NavGroup[] = []`; son la forma que la Fase 1 extiende con los grupos de `docs/UX.md` §2 (Vender, Mercadería, Gente, Negocio, Admin). `navGroups` está vacío en esta fase, así que el `map` no pinta nada, pero **debe renderizarse**: de ese modo `NavItem`, `NavGroup` y `navGroups` quedan usados y `@typescript-eslint/no-unused-vars` (advertencia en la configuración de `eslint-config-next`) no emite una advertencia, que `pnpm lint` toleraría pero haría fallar `pnpm exec eslint --max-warnings 0` de §20.1. Las líneas decorativas usan `border-divider`.
- `src/app/(app)/page.tsx` — `git mv src/app/page.tsx "src/app/(app)/page.tsx"` y reemplaza su contenido: `h1` con `messages.home.title` y un párrafo con `messages.home.description` (`text-muted-foreground`). La ruta `/` sigue existiendo. No hay otro `h1` en el shell.
- `src/app/loading.tsx` — región `role="status"` con texto oculto `messages.common.loading` y tres bloques `Skeleton`.
- `src/app/error.tsx` — primera línea `"use client";`; recibe `{ error, retry }` (`error: unknown`, `retry: () => void`, firma de la guía instalada); `useEffect` que hace `console.error(error)`; contenedor `role="alert"` con `messages.states.error.title`, `messages.states.error.description` y un `Button` con `messages.common.retry` que llama `retry()`.
- `src/app/not-found.tsx` — componente de servidor: `h1` con `messages.states.notFound.title`, párrafo con `.description` y un `Link` a `/` con `buttonVariants()` y el texto `messages.states.notFound.action`.

**Done when**
- [ ] WHEN la página `/` se pide al servidor de producción y al servidor de desarrollo THE SYSTEM SHALL responder 200 con HTML que contiene `Inicio`.
- [ ] WHEN una ruta inexistente se pide THE SYSTEM SHALL responder 404 con HTML que contiene `No encontramos`.
- [ ] WHEN el árbol de `src/app` se inspecciona THE SYSTEM SHALL no contener `src/app/page.tsx` y SHALL contener `src/app/(app)/page.tsx`, `src/app/loading.tsx`, `src/app/error.tsx` y `src/app/not-found.tsx`.
- [ ] WHEN `src/app/error.tsx` se lee THE SYSTEM SHALL empezar con la directiva `use client` y recibir las props `error` y `retry`.
- [ ] WHEN se buscan segment configs en `src` THE SYSTEM SHALL no encontrar `export const dynamic`, `revalidate` ni `fetchCache`.
- [ ] WHEN `pnpm lint`, `pnpm typecheck`, `pnpm format:check` y `pnpm build` corren THE SYSTEM SHALL terminar con código 0 en los cuatro.

**Verify**
```bash
pnpm build                                        # expect: exit 0 — Cache Components: layout estático, sin datos de petición fuera de Suspense
pnpm exec tsx scripts/smoke-server.ts start 3190 /=200:Inicio '/ruta-que-no-existe=404:No encontramos' /api/health=200:ok
                                                  # expect: exit 0 — `/` 200 con "Inicio", ruta inexistente 404 con el título, health sigue 200
pnpm exec tsx scripts/smoke-server.ts dev 3191 /=200:Inicio
                                                  # expect: exit 0 — `next dev` sirve el shell; además regenera `.next/dev/types`, que `pnpm typecheck` incluye y que quedaría obsoleto tras mover la página
test ! -e src/app/page.tsx                        # expect: exit 0 — la plantilla de Next ya no existe
test -f "src/app/(app)/page.tsx" && test -f src/app/loading.tsx && test -f src/app/error.tsx && test -f src/app/not-found.tsx && test -f "src/app/(app)/layout.tsx"
                                                  # expect: exit 0
head -n 1 src/app/error.tsx | grep -qx '"use client";'   # expect: exit 0
grep -qE '[{ ,]retry[:,]' src/app/error.tsx   # expect: exit 0
grep -qE '[{ ,]error[:,]' src/app/error.tsx       # expect: exit 0 — la prop `error` está declarada (desestructurada o tipada)
grep -qF 'lang="es-HN"' src/app/layout.tsx        # expect: exit 0
status=0; grep -rnE 'export const (dynamic|revalidate|fetchCache)' src || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = ningún segment config
pnpm lint                                         # expect: exit 0
pnpm exec eslint --max-warnings 0                 # expect: exit 0 — cero advertencias en este paso (pnpm lint tolera las advertencias; la puerta de §20.1 no)
pnpm typecheck                                    # expect: exit 0
pnpm format:check                                 # expect: exit 0
```

**Checkpoint**
```bash
git add -A && git commit -m "feat(fase-0): E2-T5 app-shell"
git tag step-12-app-shell
git ls-files --error-unmatch "src/app/(app)/layout.tsx"   # expect: exit 0 — ya confirmado en git
# rollback target si el paso 13 sale mal: git reset --hard step-12-app-shell
```

---

#### Step 13 — Componentes compartidos

**Do**
Crea los cinco componentes compartidos en `src/components/shared/`. Lee antes los archivos generados que vas a componer (`alert-dialog.tsx`, `table.tsx`, `input.tsx`, `skeleton.tsx`): usa solo las exportaciones que existan. Reglas de React: sin `useEffect` que llame a `setState` y sin leer refs durante el render (las reglas de `react-hooks` de la configuración de ESLint lo marcan). Los textos que no vienen por props salen de `messages`. Este paso se verifica con el verificador de tipos, el linter y el build; **el comportamiento en el navegador se ejerce en el paso 14**, cuando existe la galería que los renderiza.

Archivos (todos en `src/components/shared/`):
- `page-header.tsx` — componente de servidor. Props `{ title: string; description?: string; actions?: React.ReactNode }`. Renderiza el `h1`, la descripción en `text-muted-foreground` y las acciones a la derecha. Sin `"use client"`.
- `empty-state.tsx` — componente de servidor. Props `{ icon?: LucideIcon; title: string; description?: string; action?: React.ReactNode }`; centrado, con acción sugerida. Sin `"use client"`.
- `confirm-dialog.tsx` — `"use client"`. Props `{ open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; confirmLabel: string; cancelLabel?: string; destructive?: boolean; pending?: boolean; onConfirm: () => void }`. Compone `AlertDialog` de `@/components/ui/alert-dialog`; `cancelLabel` por defecto `messages.common.cancel`; el botón de confirmar usa la variante `destructive` cuando corresponde y queda deshabilitado con `pending`. `Escape` y el botón de cancelar cierran vía `onOpenChange(false)`.
- `money-input.tsx` — `"use client"`. Props `Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "type"> & { valueCents: number | null; onValueChange: (cents: number | null) => void }`; es **controlado en centavos**. Usa `Input` de `@/components/ui/input`, `parseMoney`, `formatMoney` y `formatMoneyPlain` de `@/lib/format`. Estado local `draft: string | null` (`null` = no se está editando). Valor visible: `draft ?? (valueCents === null ? "" : formatMoney(valueCents))` (calculado en el render, sin efectos). Al enfocar: `draft` pasa a `valueCents === null ? "" : formatMoneyPlain(valueCents)`. Al escribir: actualiza `draft`. Al salir del campo: si `draft` es vacío llama `onValueChange(null)`; si `parseMoney(draft)` da un número llama `onValueChange(número)` y `draft` vuelve a `null`; si da `null` conserva `draft` y marca `aria-invalid="true"`. `inputMode="decimal"`, `autoComplete="off"`, clases `text-right` y `tabular-nums`. El nombre accesible lo pone quien lo usa (`id` + `label`, o `aria-label`).
- `data-table.tsx` — `"use client"`. TanStack Table 8 (`useReactTable`, `getCoreRowModel`, `flexRender` de `@tanstack/react-table`) sobre `Table` de `@/components/ui/table`. Props `{ columns: ColumnDef<TData, TValue>[]; data: TData[]; isLoading?: boolean; loadingRows?: number; error?: { message: string; onRetry: () => void } | null; empty?: { title: string; description?: string; action?: React.ReactNode }; caption: string }`; cada prop opcional se declara con la forma `nombre?: tipo`, que es la que comprueba el `Verify`. Estados: `isLoading` → filas `Skeleton` (por defecto 5) y un `role="status"` con `messages.common.loading`; `error` → bloque `role="alert"` con el mensaje y un botón `messages.common.retry` que llama `onRetry`; sin filas → `EmptyState` (con `empty` o los textos de `messages.states.empty`); con filas → la tabla. `caption` es el `<caption>` accesible (puede ser `sr-only`). Si `pnpm lint` marca `react-hooks/incompatible-library` en `useReactTable`, añade en esa línea un único `// eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table v8 devuelve funciones no memoizables; aceptado (§20.3, fila 2)` y nada más.

**Done when**
- [ ] WHEN `pnpm typecheck` corre THE SYSTEM SHALL terminar con código 0 con `MoneyInput` tipado como `valueCents: number | null` y `onValueChange: (cents: number | null) => void`.
- [ ] WHEN `src/components/shared/money-input.tsx` se lee THE SYSTEM SHALL usar `parseMoney` y `formatMoney` de `@/lib/format`, `inputMode` igual a `decimal` y la clase `tabular-nums`.
- [ ] WHEN `src/components/shared/data-table.tsx` se lee THE SYSTEM SHALL importar `useReactTable` de `@tanstack/react-table` y exponer las props `isLoading`, `error` y `empty`.
- [ ] WHEN `src/components/shared/confirm-dialog.tsx` se lee THE SYSTEM SHALL componer `alert-dialog` de `@/components/ui/alert-dialog`.
- [ ] WHEN se leen los archivos de `src/components/shared` THE SYSTEM SHALL tener la directiva `use client` solo en `money-input.tsx`, `confirm-dialog.tsx` y `data-table.tsx`, y no en `page-header.tsx` ni `empty-state.tsx`.
- [ ] WHEN `pnpm lint`, `pnpm typecheck`, `pnpm format:check` y `pnpm build` corren THE SYSTEM SHALL terminar con código 0 en los cuatro.

**Verify**
```bash
pnpm typecheck                                    # expect: exit 0 — medio: verificador de tipos sobre las firmas de los cinco componentes
pnpm lint                                         # expect: exit 0
pnpm exec eslint --max-warnings 0                 # expect: exit 0 — cero advertencias en este paso (pnpm lint tolera las advertencias; la puerta de §20.1 no)
pnpm format:check                                 # expect: exit 0
pnpm build                                        # expect: exit 0
grep -qF 'valueCents: number | null' src/components/shared/money-input.tsx   # expect: exit 0
grep -qF 'onValueChange: (cents: number | null) => void' src/components/shared/money-input.tsx   # expect: exit 0
grep -qE '\bparseMoney\(' src/components/shared/money-input.tsx   # expect: exit 0
grep -qE '\bformatMoney\(' src/components/shared/money-input.tsx   # expect: exit 0
grep -qF 'inputMode="decimal"' src/components/shared/money-input.tsx   # expect: exit 0
grep -qF 'tabular-nums' src/components/shared/money-input.tsx  # expect: exit 0
grep -qE '\buseReactTable\(' src/components/shared/data-table.tsx   # expect: exit 0
grep -qF 'from "@tanstack/react-table"' src/components/shared/data-table.tsx   # expect: exit 0
grep -qF 'isLoading?:' src/components/shared/data-table.tsx    # expect: exit 0 — prop opcional declarada en el tipo de props
grep -qF 'error?:' src/components/shared/data-table.tsx        # expect: exit 0
grep -qF 'empty?:' src/components/shared/data-table.tsx        # expect: exit 0
grep -qF '@/components/ui/alert-dialog' src/components/shared/confirm-dialog.tsx   # expect: exit 0
head -n 1 src/components/shared/money-input.tsx | grep -qx '"use client";'    # expect: exit 0
head -n 1 src/components/shared/confirm-dialog.tsx | grep -qx '"use client";' # expect: exit 0
head -n 1 src/components/shared/data-table.tsx | grep -qx '"use client";'     # expect: exit 0
status=0; grep -qF 'use client' src/components/shared/page-header.tsx || status=$?; test "$status" -eq 1   # expect: exit 0 — 1 = el archivo no contiene la directiva en ninguna línea
status=0; grep -qF 'use client' src/components/shared/empty-state.tsx || status=$?; test "$status" -eq 1   # expect: exit 0 — 1 = ídem
```

**Checkpoint**
```bash
git add -A && git commit -m "feat(fase-0): E2-T6 shared-components"
git tag step-13-shared-components
git ls-files --error-unmatch src/components/shared/data-table.tsx   # expect: exit 0 — ya confirmado en git
# rollback target si el paso 14 sale mal: git reset --hard step-13-shared-components
```

---

#### Step 14 — Playwright y galería de componentes

**Do**
Instala Playwright, copia su configuración desde `workspace/` (se copia ahora y no en el Bootstrap porque importa `@playwright/test`, que no existe antes de este paso: con el archivo en la raíz, `pnpm typecheck` de los pasos 1 a 13 habría fallado), crea la galería de desarrollo y las dos especificaciones. La galería existe **solo** para que Playwright ejerza los componentes (no hay Storybook ni pruebas con jsdom). Usa las convenciones de la skill `playwright-best-practices` (localizadores por rol o etiqueta, sin esperas fijas). Los E2E importan `messages` por ruta relativa (`../../src/config/messages.es`).

```bash
pnpm add -D -E @playwright/test@1.64.1
test -e playwright.config.ts || cp blueprints/fase-0-cimientos/workspace/playwright.config.ts playwright.config.ts
npm pkg set scripts.test:e2e="playwright test"
pnpm exec playwright install chromium
pnpm format
```
(En Linux de CI el comando de navegadores es `pnpm exec playwright install --with-deps chromium`, ya incluido en el workflow del paso 16.)

`playwright.config.ts` (contenido en §19.6): `testDir` `tests/e2e`, solo Chromium, `webServer` = `pnpm build && pnpm exec next start --port 3100` con `url` `http://127.0.0.1:3100/api/health`, `reuseExistingServer: !isCI`, `timeout` de 240 s y `env` con `NEXT_PUBLIC_COMPONENT_GALLERY` igual a `enabled`. Las opciones `env`, `reuseExistingServer`, `command`, `url` y `timeout` de `webServer` figuran en los ejemplos de la skill instalada (`.agents/skills/playwright-best-practices/core/configuration.md`); `pnpm typecheck` las valida contra los tipos de `@playwright/test`.

Archivos:
- `package.json` — edición: `@playwright/test` exacto y el script `test:e2e` (`playwright test`).
- `playwright.config.ts` — copia desde el workspace (arriba).
- `src/app/(app)/dev/componentes/page.tsx` — página **de cliente** (`"use client"`; necesita estado para `MoneyInput` y `ConfirmDialog`). Primera instrucción del componente: `if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_COMPONENT_GALLERY !== "enabled") { notFound(); }` con `notFound` de `next/navigation`; así en producción real devuelve 404 y solo el build que hace Playwright (que define la variable) la muestra. Usa `messages.dev.gallery` para todo texto. Secciones, en este orden y cada una un `<section aria-labelledby>` con su `h2`: (1) `PageHeader` con `title` `messages.dev.gallery.title` y `description`; (2) `MoneyInput` con `<label htmlFor>` `messages.dev.gallery.money.label`, estado `useState<number | null>(null)`; (3) `ConfirmDialog` controlado, con un `Button` `messages.dev.gallery.confirm.open` que lo abre, y `title`, `description` y `confirmLabel` de `messages.dev.gallery.confirm`; (4) cuatro `DataTable` con columnas Producto (`columnProduct`) y Precio (`columnPrice`, celda con `formatMoney` y la clase `money`) cuyas secciones se llaman `table.loading` (con `isLoading`), `table.empty` (con `data=[]` y `empty` con `action` un `Button` `table.emptyAction`), `table.error` (con `error` `{ message: table.errorMessage, onRetry: () => undefined }`) y `table.rows` (dos filas: `sampleDress` a 65 000 centavos y `sampleBlouse` a 32 000). Cada tabla recibe un `caption` igual al título de su sección.
- `tests/e2e/shell.spec.ts` — (a) `page.goto("/")`: `getByRole("link", { name: messages.nav.home, exact: true })` visible y `getByRole("heading", { level: 1, name: messages.home.title })` visible; (b) `request.get("/api/health")`: estado 200 y JSON igual a `{ status: "ok" }`; (c) `page.goto("/ruta-que-no-existe")`: estado de la respuesta 404 y `getByRole("heading", { name: messages.states.notFound.title })` visible.
- `tests/e2e/components.spec.ts` — `test.beforeEach` va a `/dev/componentes`; con `const gallery = messages.dev.gallery`: (a) `getByLabel(gallery.money.label)`: `fill("1234.5")`, `blur()` y `toHaveValue("L 1,234.50")`; (b) mismo campo con `fill("12.345")`, `blur()` y `toHaveAttribute("aria-invalid", "true")`; (c) clic en el botón `gallery.confirm.open`, `getByRole("alertdialog")` visible, `keyboard.press("Escape")` y el diálogo oculto; (d) por cada sección (`getByRole("region", { name: gallery.table.loading })` y las otras tres): cargando contiene un `role="status"` visible; vacía contiene el botón `gallery.table.emptyAction`; con error contiene un `role="alert"` y el botón `messages.common.retry`; con datos contiene la celda `gallery.table.sampleDress`. Cada localizador de (d) se acota a su región (el anunciador de rutas de Next también usa `role="alert"`).

**Done when**
- [ ] WHEN `pnpm test:e2e` corre THE SYSTEM SHALL construir la app de producción, arrancarla en el puerto 3100 y terminar con código 0 sin pruebas fallidas.
- [ ] WHEN `shell.spec.ts` corre THE SYSTEM SHALL comprobar el enlace `Inicio` en la barra lateral, `/api/health` con 200 y `{ status: 'ok' }`, y una ruta inexistente con 404 y el título de no encontrada.
- [ ] WHEN `components.spec.ts` escribe `1234.5` en el campo `Monto` y lo abandona THE SYSTEM SHALL mostrar `L 1,234.50`, y con `12.345` SHALL marcarlo con `aria-invalid` igual a `true`.
- [ ] WHEN `components.spec.ts` abre el diálogo de confirmación y pulsa `Escape` THE SYSTEM SHALL cerrarlo.
- [ ] WHEN `components.spec.ts` recorre las cuatro tablas THE SYSTEM SHALL mostrar el estado cargando con `role=status`, el vacío con su acción, el error con `role=alert` y botón `Reintentar`, y las filas con `Vestido floral`.
- [ ] WHEN la galería se pide a un build de producción sin `NEXT_PUBLIC_COMPONENT_GALLERY` THE SYSTEM SHALL responder 404.

**Verify**
```bash
pnpm install --frozen-lockfile                    # expect: exit 0
pnpm build                                        # expect: exit 0 — build SIN la variable de la galería
pnpm exec tsx scripts/smoke-server.ts start 3190 /dev/componentes=404 /api/health=200:ok
                                                  # expect: exit 0 — sin NEXT_PUBLIC_COMPONENT_GALLERY la galería responde 404 (esta comprobación va antes del E2E, que reconstruye con la variable)
pnpm test:e2e                                     # expect: exit 0 — Playwright construye con la variable, sirve en 3100 y corre shell.spec.ts y components.spec.ts
pnpm lint                                         # expect: exit 0
pnpm exec eslint --max-warnings 0                 # expect: exit 0 — cero advertencias en este paso (pnpm lint tolera las advertencias; la puerta de §20.1 no)
pnpm typecheck                                    # expect: exit 0 — valida playwright.config.ts contra los tipos de @playwright/test
pnpm format:check                                 # expect: exit 0
grep -qF '"@playwright/test": "1.64.1"' package.json   # expect: exit 0
grep -qF '"test:e2e": "playwright test"' package.json  # expect: exit 0
test -f playwright.config.ts && test -f tests/e2e/shell.spec.ts && test -f tests/e2e/components.spec.ts && test -f "src/app/(app)/dev/componentes/page.tsx"
                                                  # expect: exit 0
status=0; grep -rnE 'waitForTimeout|\.(skip|only)\(' tests/e2e || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = sin esperas fijas ni pruebas omitidas o enfocadas
```

**Checkpoint**
```bash
git add -A && git commit -m "feat(fase-0): E2-T7 playwright"
git tag step-14-playwright
git ls-files --error-unmatch playwright.config.ts   # expect: exit 0 — ya confirmado en git
# rollback target si el paso 15 sale mal: git reset --hard step-14-playwright
```

---

#### Step 15 — Invariante de stock, test de arquitectura y documentos al día

**Do**
Implementa de verdad el invariante 1 de `docs/DATA_MODEL.md` §9, deja los invariantes 2 a 7 como pendientes documentados, añade el test que impone `CLAUDE.md` §6.2 desde hoy y alinea los documentos con el esquema y la pila reales (regla de `CLAUDE.md` §8.6).

Archivos:
- `tests/integration/helpers/invariants.ts` — exporta el tipo `StockDiscrepancy = { variantId: string; locationId: string; movementSum: number; onHand: number }` y `findStockDiscrepancies(client: Pick<PrismaClient, "$queryRaw">)`, que ejecuta (con `$queryRaw` etiquetado) y devuelve las filas de:

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
  Los movimientos de apartado (`LAYAWAY_RESERVE`, `LAYAWAY_RELEASE`) cambian `reserved`, no `onHand`: el invariante dice "excluyendo reservas". Los `::int` evitan que Postgres devuelva `bigint` (Prisma lo traduciría a `BigInt`).
- `tests/integration/invariants.test.ts` — `beforeEach(resetDatabase)`, `afterAll(closeDatabase)`. Casos: (A) base vacía → `findStockDiscrepancies(testDb)` es `[]`; (B) dentro de `testDb.$transaction`: crea `User`, `Location`, `Category` (`slug` único), `Product` (`code`, `name`, `categoryId`, `basePriceCents: 1000`), `Variant` (`sku` y `barcode` únicos) y un `StockMovement` `ADJUSTMENT_IN` de `quantity` 5 con `reason` y `userId` **sin** fila de `StockLevel`; todavía dentro, el helper devuelve exactamente un elemento con ese `variantId` y `locationId`, `movementSum` 5 y `onHand` 0; la transacción termina con un error centinela (`throw new RollbackSignal()`) capturado fuera, y después el helper devuelve `[]`; (C) los mismos datos más un `StockLevel` con `onHand` 5 → `[]`. Los invariantes 2 a 7 de `docs/DATA_MODEL.md` §9 se declaran como `it.todo` con su texto completo (por ejemplo `it.todo("Σ Payment − change = Sale.total para toda venta completada (Fase 3)")`); un `todo` no es un fallo.
- `tests/unit/architecture.test.ts` — con `node:fs` y `node:path`. Detector: `/\bstockLevel\s*\.\s*(update|updateMany|create|createMany|upsert|delete|deleteMany)\s*\(/` y `/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+"?StockLevel"?/i`. Casos: (1) el detector marca `db.stockLevel.update(` y `tx.stockLevel.upsert(` y SQL crudo `UPDATE "StockLevel"`, y no marca `db.stockLevel.findMany(` (prueba que el detector no es vacío); (2) la lista de archivos `.ts` y `.tsx` de `src/` (sin `src/generated`) más `prisma/seed.ts` y `prisma/seed/**` incluye `src/lib/db.ts` (el escaneo ve archivos reales); (3) ningún archivo de esa lista, salvo `src/modules/inventory/service.ts`, coincide con el detector. El test debe pasar mientras `src/modules/inventory/service.ts` no exista (la ruta no se exige).
- `docs/DATA_MODEL.md` — adiciones y correcciones exactas (el esquema real manda): (a) §2: subsección `### Session` (`sessionToken` único, `userId` con cascada, `expires`, `ip?`, `userAgent?`, forma compatible con Auth.js); (b) §2 `FiscalRange`: fila `terminalId` (`Terminal?`; null = rango general) y la mención del índice parcial único de un rango activo por tipo y terminal; (c) §2: subsección `### DocumentCounter` (`key` clave primaria, `nextValue` por defecto 1, incremento con bloqueo dentro de la transacción del documento); (d) §2 `AuditLog`: índice adicional `(action, createdAt)`; (e) §3 `Product`: fila `code` (`String @unique`, base del SKU de sus variantes) y `Category.slug` único; `Variant`: la restricción `(productId, sizeId, colorId)` es un índice único `NULLS NOT DISTINCT` creado en la migración `constraints`; (f) §4 `StockLevel`: **reemplaza** la frase "Check de BD: `onHand >= 0` …" por la decisión real: no hay CHECK de `onHand >= 0` (depende de `sales.allowNegativeStock` y se valida en `inventory.recordMovement`); sí hay CHECK `reserved >= 0`; `StockCount`: campo `scopeRef` (id de categoría o nombre de zona según `scope`); (g) §5: `GoodsReceipt.number` único; `PurchaseOrderItem` único en `(purchaseOrderId, variantId)`; `StockCountItem` único en `(stockCountId, variantId)`; (h) §6 `Sale` y §7 `ReturnDoc`: `@@unique([fiscalRangeId, fiscalNumber])`, y `ReturnDoc.fiscalNumber?` y `fiscalRangeId?`; (i) nueva sección `## 11. Restricciones de la migración constraints`: extensiones, índice único con `NULLS NOT DISTINCT`, índices parciales de caja abierta y de rango fiscal activo, CHECK de montos y cantidades, triggers `prevent_row_mutation` de solo inserción en `AuditLog`, `StockMovement` y `StoreCreditEntry`, índices trigram `gin` sobre `Product.name` y `Variant.sku`; (j) §10 (semilla): una nota que distingue la semilla mínima de la Fase 0 (ubicación, terminal, cuatro usuarios, tallas, colores, categorías, perfil, ajustes, contadores) de la semilla de demostración grande de fases posteriores.
- `docs/ARCHITECTURE.md` — §2: filas nuevas o ajustadas (*Hash de contraseñas*: `@node-rs/argon2` (Argon2id), alternativa descartada `argon2`; *Tablas*: TanStack Table v8, no v9; *Tipografía*: Inter con `next/font/google`, alternativa Geist; *Driver de BD*: Prisma 7 con `@prisma/adapter-pg`; la fila *Pruebas* pasa a "Vitest 5 (proyectos `unit` e `integration`) + Playwright (Chromium)"). §12: filas con fecha `2026-10-23` para: TanStack Table v8 sobre v9; `@node-rs/argon2`; Inter sobre Geist; Prisma 7 con `@prisma/adapter-pg` y cliente generado en `src/generated/prisma` (no versionado); Vitest con proyectos `unit` e `integration` contra la BD `boutique_pos_test`; sin CHECK `onHand >= 0` en BD; `@types/node` en la línea 24; galería `/dev/componentes` más Playwright en lugar de Storybook.

**Done when**
- [ ] WHEN `findStockDiscrepancies` corre sobre una base vacía THE SYSTEM SHALL devolver una lista vacía.
- [ ] WHEN dentro de una transacción se inserta un `StockMovement` `ADJUSTMENT_IN` de cantidad 5 sin fila de `StockLevel` THE SYSTEM SHALL reportar exactamente esa variante y ubicación con `movementSum` 5 y `onHand` 0, y tras revertir la transacción THE SYSTEM SHALL devolver una lista vacía.
- [ ] WHEN el `StockLevel` coincide con la suma de movimientos THE SYSTEM SHALL no reportar discrepancias.
- [ ] WHEN `pnpm test:integration` corre THE SYSTEM SHALL terminar con código 0 con los invariantes 2 a 7 de `docs/DATA_MODEL.md` como `it.todo` (pendientes, no fallidos).
- [ ] WHEN `tests/unit/architecture.test.ts` corre THE SYSTEM SHALL fallar si `src` o `prisma/seed*` escriben `stockLevel` fuera de `src/modules/inventory/service.ts`, y pasar mientras ese archivo no exista.
- [ ] WHEN `docs/DATA_MODEL.md` y `docs/ARCHITECTURE.md` se leen THE SYSTEM SHALL contener las adiciones nombradas por el paso (`Session`, `DocumentCounter`, `scopeRef`, `NULLS NOT DISTINCT`, `prevent_row_mutation`, TanStack Table v8, `@node-rs/argon2`, Inter, `@prisma/adapter-pg`) y no la frase obsoleta `Check de BD`.

**Verify**
```bash
pnpm test:integration                             # expect: exit 0 — invariants.test.ts con 0 fallidos (los it.todo cuentan como pendientes)
pnpm test:unit                                    # expect: exit 0 — incluye architecture.test.ts
pnpm lint                                         # expect: exit 0
pnpm exec eslint --max-warnings 0                 # expect: exit 0 — cero advertencias en este paso (pnpm lint tolera las advertencias; la puerta de §20.1 no)
pnpm typecheck                                    # expect: exit 0
pnpm format:check                                 # expect: exit 0
grep -qF 'it.todo(' tests/integration/invariants.test.ts        # expect: exit 0
grep -qF 'Sale.total' tests/integration/invariants.test.ts      # expect: exit 0 — invariante 2 declarado
grep -qF 'storeCreditCents' tests/integration/invariants.test.ts   # expect: exit 0 — invariante 5 declarado
grep -qF '### Session' docs/DATA_MODEL.md         # expect: exit 0
grep -qF '### DocumentCounter' docs/DATA_MODEL.md # expect: exit 0
grep -qF 'scopeRef' docs/DATA_MODEL.md            # expect: exit 0
grep -qF 'NULLS NOT DISTINCT' docs/DATA_MODEL.md  # expect: exit 0
grep -qF 'prevent_row_mutation' docs/DATA_MODEL.md   # expect: exit 0
status=0; grep -qF 'Check de BD' docs/DATA_MODEL.md || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = la frase obsoleta ya no está
grep -qF 'TanStack Table v8' docs/ARCHITECTURE.md # expect: exit 0
grep -qF '@node-rs/argon2' docs/ARCHITECTURE.md   # expect: exit 0
grep -qF '@prisma/adapter-pg' docs/ARCHITECTURE.md   # expect: exit 0
grep -qE '\bInter\b' docs/ARCHITECTURE.md   # expect: exit 0
grep -qF '2026-10-23' docs/ARCHITECTURE.md        # expect: exit 0
status=0; grep -rnE '\.(skip|only)\(' tests/integration tests/unit || status=$?; test "$status" -eq 1
                                                  # expect: exit 0 — 1 = sin pruebas omitidas o enfocadas
```

**Checkpoint**
```bash
git add -A && git commit -m "chore(fase-0): E2-T8 invariants-docs"
git tag step-15-invariants-docs
git ls-files --error-unmatch tests/integration/invariants.test.ts   # expect: exit 0 — ya confirmado en git
# rollback target si el paso 16 sale mal: git reset --hard step-15-invariants-docs
```

---

#### Step 16 — CI, README y cierre de la fase

**Do**
Cierra la Fase 0: workflow de GitHub Actions, README para un clon limpio y estado de la fase en `CLAUDE.md`. Pines de acciones verificados el 2026-10-23: `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6` (lee `packageManager`; soporta pnpm 12; su entrada `cache: true` cachea el almacén de pnpm, por eso no se usa `cache: pnpm` de `setup-node`). No se usa `actions/cache`.

Archivos:
- `.github/workflows/ci.yml` — contenido literal (Prettier lo formateará con `pnpm format`):

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
- `tests/unit/ci-workflow.test.ts` — lee `.github/workflows/ci.yml` como texto (`readFileSync`, sin dependencia de YAML) y afirma: contiene `runs-on: ubuntu-24.04`, `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`, `image: postgres:16-alpine`, `--health-cmd`, `DATABASE_URL_TEST:`, `AUTH_SECRET:`, `APP_URL:`, `pnpm exec playwright install --with-deps chromium`, `if: github.ref == 'refs/heads/main'`; y que cada una de estas líneas existe completa (regex con `^\s*- run: <comando>$` y bandera `m`): `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm lint`, `pnpm exec eslint --max-warnings 0`, `pnpm exec next typegen`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm test:coverage`, `pnpm build`, `pnpm test:e2e` (la línea `pnpm test` exacta no se confunde con `pnpm test:coverage` ni con `pnpm test:e2e`).
- `README.md` — antepone, antes del contenido actual, un bloque que empieza con `# Boutique POS — Desarrollo local`: requisitos (Node 24, pnpm 12.15, Docker con `docker compose`, git); primer arranque con la secuencia `git clone`, `cp .env.example .env`, `pnpm install`, `pnpm db:generate`, `pnpm db:up`, `pnpm db:deploy`, `pnpm db:seed`, `pnpm dev` (`pnpm db:generate` es obligatorio: `src/generated` no se versiona y Prisma 7 no genera el cliente al migrar); la tabla de usuarios demo del paso 8 (`owner`, `manager`, `cashier`, `warehouse`, con contraseña y PIN) marcada "solo desarrollo"; comandos de pruebas (`pnpm test`, `pnpm test:e2e`, `pnpm exec playwright install chromium`) y la nota de que, en un clon limpio, `pnpm exec next typegen` va antes de `pnpm typecheck`; una nota para detener otras pilas que usen el puerto 5432. Después una línea `---` y el contenido anterior del README sin cambios.
- `CLAUDE.md` — §2: la línea `- [ ] Fase 0 — Cimientos` pasa a `- [x] Fase 0 — Cimientos (YYYY-MM-DD)` con la fecha de hoy de la máquina (`date +%F`). El resto del archivo, incluida la marca `<!-- fase-0-blueprint -->` y §4, no cambia.

**Done when**
- [ ] WHEN `tests/unit/ci-workflow.test.ts` corre THE SYSTEM SHALL comprobar en `.github/workflows/ci.yml` el runner `ubuntu-24.04`, los pines `actions/checkout@v7`, `actions/setup-node@v7` y `pnpm/action-setup@v6`, y los comandos de la puerta.
- [ ] WHEN `ci.yml` se lee THE SYSTEM SHALL declarar el servicio `postgres:16-alpine` con chequeo de salud y las variables `DATABASE_URL`, `DATABASE_URL_TEST`, `AUTH_SECRET` y `APP_URL`.
- [ ] WHEN `ci.yml` se lee THE SYSTEM SHALL ejecutar el trabajo `e2e` solo en `main` con `pnpm exec playwright install --with-deps chromium` y `pnpm test:e2e`.
- [ ] WHEN `README.md` se lee THE SYSTEM SHALL empezar con la sección `Desarrollo local` con los comandos de clonado a `pnpm dev` y la tabla de usuarios demo, conservando el contenido previo debajo.
- [ ] WHEN `CLAUDE.md` se lee THE SYSTEM SHALL marcar `- [x] Fase 0 — Cimientos` con la fecha de hoy en formato `YYYY-MM-DD` y conservar la marca `fase-0-blueprint`.
- [ ] WHEN `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test` y `pnpm build` corren THE SYSTEM SHALL terminar con código 0 en los cinco.

**Verify**
```bash
pnpm test:unit                                    # expect: exit 0 — incluye ci-workflow.test.ts
grep -Eq '^- \[x\] Fase 0 .{1,3} Cimientos \([0-9]{4}-[0-9]{2}-[0-9]{2}\)$' CLAUDE.md
                                                  # expect: exit 0 — la fecha es cualquier YYYY-MM-DD (el guion largo ocupa 1 carácter o 3 bytes)
grep -q 'fase-0-blueprint' CLAUDE.md              # expect: exit 0 — la marca del Bootstrap sigue
head -n 1 README.md | grep -qF 'Desarrollo local' # expect: exit 0
grep -qF 'pnpm db:generate' README.md             # expect: exit 0
grep -qF 'Demo-Cajero-2026' README.md             # expect: exit 0 — tabla de usuarios demo presente
grep -qF 'Paquete de contexto' README.md          # expect: exit 0 — el contenido previo se conservó
test -f .github/workflows/ci.yml                  # expect: exit 0
pnpm lint                                         # expect: exit 0
pnpm exec eslint --max-warnings 0                 # expect: exit 0 — cero advertencias en este paso (pnpm lint tolera las advertencias; la puerta de §20.1 no)
pnpm typecheck                                    # expect: exit 0
pnpm format:check                                 # expect: exit 0
pnpm test                                         # expect: exit 0 — proyectos unit e integration
pnpm build                                        # expect: exit 0
```

**Checkpoint**
```bash
git add -A && git commit -m "chore(fase-0): E2-T9 ci-readme-close"
git tag step-16-ci-readme-close
git ls-files --error-unmatch .github/workflows/ci.yml   # expect: exit 0 — ya confirmado en git
test -z "$(git status --porcelain)"                     # expect: exit 0 — el commit anterior se llevó todo
# fin de la Fase 0: la puerta global es §20.1
```

---

### 9.1 Parity and cutover

NOT APPLICABLE — no existe un sistema que se esté reemplazando: este cambio es aditivo sobre un scaffold en marcha, no una migración (no hay cambio de framework, base de datos ni proveedor, ni paso de corte).

---

## 10. Environment Setup

### Prerequisites
| Tool | Version | Check |
|---|---|---|
| Node.js | 24.x LTS (probado con 24.22.1; Vitest 5 y Vite 8 exigen `^22.12`, `^24` o `>=26`) | `node -v` |
| pnpm | 12.15.0 (campo `packageManager`) | `pnpm -v` |
| Docker con Compose v2 | cualquier versión reciente, con el motor en marcha | `docker compose version` |
| git | cualquier versión reciente, **con identidad resoluble de autor y de commit**: `user.name` y `user.email` en la configuración, o las variables `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` y `GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL` (`git config user.name` no ve las variables de entorno; por eso la comprobación usa `git var`) | `git --version`, y `git var GIT_AUTHOR_IDENT` y `git var GIT_COMMITTER_IDENT` salen con 0 (sin identidad fallan con "Author identity unknown"; el Bootstrap lo comprueba primero y se detiene con la instrucción para configurarla) |
| Historial del repo | HEAD incluye `6ea1527` (decisiones de `allowBuilds` de `prisma`, `@prisma/engines` y `esbuild`) y `b1cabde` (las cuatro skills de agente) | en un clon completo (no `--depth 1`; en uno superficial `git merge-base --is-ancestor` sale con 128 en lugar de 1): `git merge-base --is-ancestor 6ea1527 HEAD` y `git merge-base --is-ancestor b1cabde HEAD` salen con 0 |
| npm (viene con Node; solo se usa `npm pkg set` para editar `package.json`) | el de Node 24 | `npm -v` |

Antes del Bootstrap: (0) HEAD debe incluir el commit `6ea1527`: sin él, en un clon limpio `pnpm install --frozen-lockfile` aborta con `ERR_PNPM_IGNORED_BUILDS` porque pnpm 12 exige una decisión de `allowBuilds` para `prisma`, `@prisma/engines` y `esbuild`; (1) el puerto `127.0.0.1:5432` debe estar libre (detén cualquier otra pila Docker que use Postgres); (2) `git status --porcelain` debe listar solo `blueprints/`, porque cada Checkpoint usa `git add -A` y arrastraría cualquier otro cambio sin confirmar (las cinco skills que fija `skills-lock.json` —`find-skills` en el commit `1e1430f`; `vitest`, `playwright-best-practices`, `prisma-orm-setup` y `vercel-react-best-practices` en el commit `b1cabde`— están en `.agents/skills/` y `.claude/skills/` y ya están confirmadas, igual que `skills-lock.json`; no aparecen como cambios pendientes); (3) `CLAUDE.md` y `AGENTS.md` deben ser los del commit `fca87b5` — las dos líneas con la marca `fase-0-blueprint` del Bootstrap los reemplazan por las copias de `workspace/`, así que si los editaste, fusiona a mano la marca y la sección 11 en lugar de ejecutar esas dos líneas.

### Accounts to create first
Ninguna cuenta externa para construir. Para el CI hace falta un repositorio en GitHub (lo usa el paso 16 al publicar; el workflow no se ejecuta durante la construcción local).

### Environment variables
| Variable | Purpose | Where to get it | Required by step | Secret? |
|---|---|---|---|---|
| `NODE_ENV` | Modo de ejecución (`development`, `test`, `production`); Next y Vitest lo fijan solos | automático | Bootstrap | no |
| `DATABASE_URL` | Cadena de la BD de desarrollo (`postgresql://…`); la valida `src/lib/env.ts` | `.env.example` (coherente con `POSTGRES_*`) | Bootstrap | sí (contraseña local) |
| `AUTH_SECRET` | Mínimo 32 caracteres; sin uso hasta la Fase 1 pero `src/lib/env.ts` ya lo exige | `.env.example` trae un marcador de 32+ caracteres; genera el tuyo con `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` | Bootstrap | sí |
| `APP_URL` | URL base (`http://localhost:3000`) | `.env.example` | Bootstrap | no |
| `TZ` | Zona horaria de la app (`America/Tegucigalpa`) | `.env.example` | Bootstrap | no |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | Los lee `docker-compose.yml` para crear el contenedor y la BD `boutique_pos` (y `boutique_pos_test` por el script de init) | `.env.example` | Bootstrap | la contraseña, sí (local) |
| `DATABASE_URL_TEST` | BD de pruebas de integración; **debe terminar en `_test`**. La leen `vitest.config.ts`, `global-setup.ts`, `helpers/db.ts` y el CI | el Bootstrap la añade a `.env.example` y la deriva de `DATABASE_URL` en `.env` (`…/boutique_pos_test?schema=public`) | 7 | sí (contraseña local) |
| `NEXT_PUBLIC_COMPONENT_GALLERY` | `enabled` habilita `/dev/componentes` en un build de producción; **solo** la define `playwright.config.ts`; nunca va en `.env`, `.env.example` ni en producción | `playwright.config.ts` (`webServer.env`) | 14 | no |
| `CI` | La define GitHub Actions; `playwright.config.ts` la lee para `forbidOnly`, reintentos y `reuseExistingServer` | automático en CI | 16 | no |
| `COMPOSE_PROJECT_NAME` | Opcional: sobrescribe el nombre del proyecto de Compose (el archivo declara `name: boutique-pos`). El Bootstrap no fija ninguno | tu shell | ninguno | no |
| `PGPASSWORD` | Solo en el paso `psql` del workflow de CI (`ci-password`) | `ci.yml` | 16 | no (valor desechable de CI) |

`.env.example` está versionado con todas las claves y valores obviamente falsos; `.env` está ignorado (`.env*`, con la excepción `!.env.example`). `src/lib/env.ts` valida `DATABASE_URL`, `AUTH_SECRET` y `APP_URL` al importarse y falla con un mensaje claro: el Bootstrap deja `.env` listo antes del paso 1, así que ninguna puerta se rompe. **Listar una variable aquí no la carga**: las herramientas independientes la reciben así (mecanismo único por herramienta, también al pie de §19.6): `vitest.config.ts`, `global-setup.ts` y `helpers/db.ts` empiezan con `import "dotenv/config"`; `prisma.config.ts` ya hace lo mismo para la CLI de Prisma y para `prisma db seed`; `prisma/seed.ts` importa `dotenv/config`; `next build` y `next start` leen `.env` por sí mismos; `scripts/smoke-server.ts` lanza `next`, que lo lee.

**Credenciales de demostración (solo desarrollo; las crea `pnpm db:seed` y las muestra el README):**

| username | role | contraseña | PIN |
|---|---|---|---|
| `owner` | `OWNER` | `Demo-Propietario-2026` | `1111` |
| `manager` | `MANAGER` | `Demo-Gerente-2026` | `2222` |
| `cashier` | `CASHIER` | `Demo-Cajero-2026` | `3333` |
| `warehouse` | `WAREHOUSE` | `Demo-Almacen-2026` | `4444` |

### Files that must be committed

| File | Why it is committed | Ignore-file exception line |
|---|---|---|
| `.env.example` | plantilla de variables, incluida `DATABASE_URL_TEST` | `!.env.example` ya está en `.gitignore` **después** de `.env*` (la última coincidencia gana) |
| `vitest.config.ts`, `playwright.config.ts` | configuración de los gates de §9 | — no coincide con ningún patrón de `.gitignore` |
| `scripts/smoke-server.ts`, `tests/**` | lo ejecutan los `Verify` | — no coincide con ningún patrón |
| `prisma/seed.ts`, `prisma/seed/run-seed.ts` | la semilla | — no coincide con ningún patrón |
| `.github/workflows/ci.yml` | el CI | — no coincide con ningún patrón |
| `.claude/settings.json`, `.claude/skills/**`, `.claude/rules/**` | configuración de agente del proyecto | — `.gitignore` no contiene `.claude` |
| `blueprints/` | el bundle se versiona con el repo | — no coincide con ningún patrón |
| `pnpm-lock.yaml`, `package.json` | `--frozen-lockfile` en CI y en el gate | — no coinciden con ningún patrón |
| `src/generated/` | **NO se versiona** a propósito: lo ignora `/src/generated` y se regenera con `pnpm db:generate` | patrón existente, sin excepción |
| `.env` | **NO se versiona**: contiene secretos locales | patrón existente `.env*` |
| `/test-results/`, `/playwright-report/` | artefactos de Playwright, **no** se versionan | el Bootstrap los añade a `.gitignore` antes del primer commit |

### Bootstrap
```bash
# Ejecutar desde la raíz del repo (Git Bash en Windows, sh o bash en Linux). Seguro de ejecutar dos veces; sale con 0 en ambas.
set -e
BUNDLE=blueprints/fase-0-cimientos

# order matters: git identity guard → ignore file + exclusions → repo init → first commit → .env → workspace copy → install → services → migrate
# (la semilla la corre el paso 8 y las pruebas de integración el paso 7: el Bootstrap no las ejecuta; Playwright instala su navegador en el paso 14)

# --- 0. Identidad de git (antes de cualquier commit; este bloque y cada Checkpoint hacen `git commit`) ---
git var GIT_AUTHOR_IDENT >/dev/null 2>&1 && git var GIT_COMMITTER_IDENT >/dev/null 2>&1 || {
  echo 'Configura la identidad de git: git config user.name "Tu Nombre" && git config user.email tu@correo' >&2
  exit 1
}   # sale con 0 si hay identidad (en la configuración o en las variables GIT_AUTHOR_* y GIT_COMMITTER_*; `git config user.name` no ve estas últimas) también en la segunda ejecución; sale con 1 y la instrucción si no

# --- 1. Exclusiones del bundle y archivos ignorados (ANTES del primer commit) ---
append_line() { # añade una línea exacta si no existe, cuidando el salto de línea final
  test -f "$1" || : > "$1"
  grep -qxF -- "$2" "$1" || { [ -z "$(tail -c1 "$1")" ] || printf '\n' >> "$1"; printf '%s\n' "$2" >> "$1"; }
}
for entry in blueprints .claude AGENTS.md; do append_line .prettierignore "$entry"; done   # Prettier no formatea el bundle, la configuración de agente ni AGENTS.md (lo reescribe `next dev`)
append_line .gitignore "/test-results/"
append_line .gitignore "/playwright-report/"

grep -qF '"blueprints/**"' eslint.config.mjs || cat > eslint.config.mjs <<'EOF'
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    // Bundle del blueprint y artefactos de pruebas (ESLint no lee .gitignore):
    "blueprints/**",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
EOF

grep -qF '"blueprints"' tsconfig.json || node - <<'EOF'
const fs = require("node:fs");
const file = "tsconfig.json";
const text = fs.readFileSync(file, "utf8");
const before = '"exclude": ["node_modules"]';
if (!text.includes(before)) {
  throw new Error("tsconfig.json: no se encontró " + before);
}
fs.writeFileSync(file, text.replace(before, '"exclude": ["node_modules", "blueprints"]'));
EOF

grep -qF '@source not' src/app/globals.css || printf '\n@source not "../../blueprints";\n' >> src/app/globals.css   # Tailwind 4 escanea el proyecto entero: se excluye el bundle

grep -q '^DATABASE_URL_TEST=' .env.example || cat >> .env.example <<'EOF'

# BD de pruebas de integración (la crea docker/postgres/init). Debe terminar en _test.
DATABASE_URL_TEST=postgresql://boutique:change-me-local-only@localhost:5432/boutique_pos_test?schema=public
EOF

# --- 2. Repositorio y primer commit (una etiqueta necesita un commit al que apuntar) ---
git rev-parse --git-dir >/dev/null 2>&1 || git init -b main   # idempotente: no hace nada si ya es un repo
git rev-parse --verify HEAD >/dev/null 2>&1 || git commit --allow-empty -m "chore: init"   # solo si el repo no tiene ningún commit
if ! git rev-parse --verify --quiet refs/tags/bootstrap-fase-0 >/dev/null; then   # solo la primera ejecución: la etiqueta marca el commit de Bootstrap; en la segunda no se prepara ni se commitea nada
  git add .gitignore .prettierignore eslint.config.mjs tsconfig.json .env.example src/app/globals.css blueprints
  git diff --cached --quiet || git commit -m "chore: bootstrap fase 0"   # `diff --cached --quiet` sale con 1 si hay cambios: entonces commitea; si no, sale con 0
  git tag bootstrap-fase-0   # §20.1 comprueba contra esta etiqueta que el Bootstrap precede al paso 1
fi

# --- 3. .env local ---
test -f .env || cp .env.example .env
node - <<'EOF'
const fs = require("node:fs");
const text = fs.readFileSync(".env", "utf8");
if (!/^DATABASE_URL_TEST=/m.test(text)) {
  const match = text.match(/^DATABASE_URL=(.+)$/m);
  if (!match) {
    throw new Error("DATABASE_URL falta en .env");
  }
  const url = new URL(match[1].trim().replace(/^["']|["']$/g, ""));
  url.pathname = `${url.pathname}_test`;
  const separator = text.endsWith("\n") ? "" : "\n";
  fs.writeFileSync(".env", `${text}${separator}DATABASE_URL_TEST=${url.toString()}\n`);
}
EOF

# --- 4. Copia del workspace: solo lo que falta (no pisa lo que un paso ya editó) ---
# `rsync` no viene con Git para Windows y `cp -n` sale con 1 en BSD/macOS cuando omite un archivo; este bucle sale con 0 siempre.
# Excluidos a propósito: CLAUDE.md y AGENTS.md (guardas por marca, abajo) y playwright.config.ts (lo copia el paso 14 cuando @playwright/test ya está instalado).
# Nunca se sobrescriben: package.json ni pnpm-lock.yaml (el workspace no los emite).
(cd "$BUNDLE/workspace" && find . -type f ! -path ./CLAUDE.md ! -path ./AGENTS.md ! -path ./playwright.config.ts) | while read -r f; do
  mkdir -p "$(dirname "$f")"
  test -e "$f" || cp "$BUNDLE/workspace/$f" "$f"
done
grep -q 'fase-0-blueprint' CLAUDE.md || cp "$BUNDLE/workspace/CLAUDE.md" CLAUDE.md   # la marca evita revertir ediciones posteriores (el paso 16 edita CLAUDE.md)
grep -q 'fase-0-blueprint' AGENTS.md || cp "$BUNDLE/workspace/AGENTS.md" AGENTS.md

# --- 5. Dependencias, cliente Prisma y servicios ---
pnpm install --frozen-lockfile   # el workspace no emite package.json ni lockfile, así que el manifiesto no cambió y el modo congelado es válido
pnpm db:generate                 # Prisma 7 no genera el cliente al migrar y src/generated no se versiona
pnpm exec next typegen           # genera next-env.d.ts y .next/types (LayoutProps<"/"> y demás), ambos en .gitignore y ausentes en un clon limpio; sin ellos `tsc --noEmit` falla con TS2304; idempotente, sale con 0 en cada corrida
pnpm db:up                       # docker compose up -d --wait: vuelve cuando Postgres pasa su healthcheck; no fija nombre de proyecto (respeta COMPOSE_PROJECT_NAME)
pnpm db:deploy                   # prisma migrate deploy sobre la BD de desarrollo
```
Qué hace cada bloque con una segunda ejecución: la guarda de identidad de git sale con 0 (la identidad sigue resoluble); las líneas `append_line` y los `grep -q… ||` no encuentran nada que añadir y salen con 0; el bloque del commit se omite entero porque la etiqueta `bootstrap-fase-0` ya existe (no se vuelve a preparar nada ni se crea un segundo commit `chore: bootstrap fase 0`); `.env` ya existe y ya tiene `DATABASE_URL_TEST`; el bucle de copia salta todo lo existente; los dos `cp` de `CLAUDE.md` y `AGENTS.md` se omiten porque la marca ya está; `pnpm install --frozen-lockfile`, `pnpm exec next typegen`, `pnpm db:up` y `pnpm db:deploy` son idempotentes.

---

## 11. Dependencies

Los pines nuevos vienen del informe de `stack-researcher` de esta sesión de diseño (verificado el 2026-10-23); los ya instalados vienen de `pnpm-lock.yaml` (importers) del commit `fca87b5`, leído en la misma sesión, y no se re-investigaron. Ninguna dependencia nueva trae script de instalación (`@node-rs/argon2` publica binarios por plataforma como `optionalDependencies`; la instalación de las de Vitest, paso 1, se comprobó en una prueba de humo sin decisión adicional), así que esta fase no añade nada a `allowBuilds`. El repo ya decide `prisma`, `@prisma/engines` y `esbuild` (commit `6ea1527`, todos `false`, igual que `sharp` y `unrs-resolver`): pnpm 12 exige una decisión por cada dependencia con script de instalación y, sin ella, `pnpm install --frozen-lockfile` aborta con `ERR_PNPM_IGNORED_BUILDS` en un clon limpio. Si una dependencia que el builder añada la provocara, se decide como en el riesgo 3 de §20.2. Todas las nuevas se instalan con versión exacta (`-E`). Fechas de publicación: solo se indican las que trae el informe (`@node-rs/argon2` y las acciones de GitHub); para el resto la fecha de publicación no se consultó. **Comprobación de prerelease:** `prisma` tiene como dist-tag `latest` un `8.0.0-rc`; se queda en 7.10.1 estable. `@types/node` tiene `latest` 26.6.5 pero el runtime es Node 24, por eso se fija la línea 24 (comprobado en la sesión de diseño el 2026-10-23).

### Runtime
| Package | Version | Source (registry URL or track file) | Checked | Installed by | Purpose |
|---|---|---|---|---|---|
| `@node-rs/argon2` | 2.2.2 | https://registry.npmjs.org/@node-rs%2fargon2 (stack-researcher; publicada 2026-10-06) | 2026-10-23 | step 6 (`pnpm add -E @node-rs/argon2@2.2.2`) | Hash Argon2id de contraseñas y PIN; binarios precompilados `win32-x64-msvc` y `linux-x64-gnu`; por defecto Argon2id con `memoryCost` 19456, `timeCost` 2, `parallelism` 1; `Algorithm` y `Version` son `const enum` (se pasan valores numéricos) |
| `@tanstack/react-table` | 8.21.3 | https://registry.npmjs.org/@tanstack%2freact-table (stack-researcher; no deprecada en npm; existe 9.3.1 = reescritura, §20.3 fila 2) | 2026-10-23 | step 10 (`pnpm add -E @tanstack/react-table@8.21.3`) | Motor de `DataTable` |

### Development
| Package | Version | Source (registry URL or track file) | Checked | Installed by | Purpose |
|---|---|---|---|---|---|
| `vitest` | 5.0.5 | https://registry.npmjs.org/-/package/vitest/dist-tags (peers: `vite` `^6.4 \|\| ^7 \|\| ^8` obligatorio, `@types/node` `^22 \|\| >=24` opcional; engines node `^22.12 \|\| ^24 \|\| >=26`) | 2026-10-23 | step 1 | Runner de pruebas unitarias e integración |
| `@vitest/coverage-v8` | 5.0.5 | https://registry.npmjs.org/-/package/@vitest/coverage-v8/dist-tags (debe ser igual a `vitest`) | 2026-10-23 | step 1 | Cobertura V8 con umbrales por archivo para `money.ts` |
| `vite` | 8.3.5 | https://registry.npmjs.org/-/package/vite/dist-tags (par obligatorio de Vitest 5; engines `^20.19 \|\| >=22.12`) | 2026-10-23 | step 1 | Resolvedor y servidor de Vitest; aporta `resolve.tsconfigPaths` |
| `@types/node` | 24.19.2 | https://registry.npmjs.org/@types%2fnode (el dist-tag `latest` es 26.6.5; se fija la línea 24 por el runtime; el repo traía `^20`) | 2026-10-23 | step 1 | Tipos de Node alineados con el runtime y con el par de Vitest 5 |
| `@playwright/test` | 1.64.1 | https://registry.npmjs.org/@playwright%2ftest (stack-researcher; engines node >=20) | 2026-10-23 | step 14 | Pruebas E2E (Chromium) |
| `shadcn` (CLI) | 4.22.1 | https://registry.npmjs.org/shadcn (ya es dependencia del repo; el paso 10 lo invoca con `pnpm dlx shadcn@4.22.1`; flags `--yes` y `--overwrite` verificados; estilo `base-nova`) | 2026-10-23 | repo (§10 Bootstrap, lockfile) y step 10 (`pnpm dlx shadcn@4.22.1 add …`) | Copia las primitivas de UI al repo |
| `actions/checkout` | v7 (7.0.1, publicada 2026-07-20) | https://github.com/actions/checkout/releases | 2026-10-23 | step 16 (`ci.yml`) | Checkout en CI |
| `actions/setup-node` | v7 (7.1.0, publicada 2026-10-08) | https://github.com/actions/setup-node/releases | 2026-10-23 | step 16 (`ci.yml`) | Node 24 en CI |
| `pnpm/action-setup` | v6 (6.1.0, publicada 2026-09-05; soporta pnpm 12; entrada `cache: true`) | https://github.com/pnpm/action-setup/releases | 2026-10-23 | step 16 (`ci.yml`) | pnpm desde `packageManager` y caché del almacén |
| `postgres:16-alpine` (imagen) | 16-alpine (corriendo 16.15) | `docker-compose.yml` del repo; Docker Hub | 2026-10-23 | repo (`docker-compose.yml`, `pnpm db:up` en §10) y step 16 (`ci.yml`) | Postgres local y de CI; el archivo emitido es el instalador |

`actions/cache` v6.1.0 (2026-06-26) fue verificada y **no se usa**.

### Ya instaladas en el repo y congeladas (provenance de solo lectura)
Todas las instala `pnpm install --frozen-lockfile` del Bootstrap de §10. Fuente: `pnpm-lock.yaml` del commit `fca87b5`; Checked 2026-10-23; "not re-researched".

| Package | Versión del lockfile | Nota |
|---|---|---|
| `next` | 16.4.2 | congelada |
| `react`, `react-dom` | 19.3.0 | congeladas |
| `typescript` | 5.9.3 | el track recomienda 6.0; el repo manda |
| `tailwindcss`, `@tailwindcss/turbopack` | 4.3.3 | congeladas |
| `zod` | 4.6.7 | congelada |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg` | 7.10.1 | congeladas; no se usa la `8.0.0-rc` |
| `tsx` | 4.23.15 | ejecuta `prisma/seed.ts` y `scripts/smoke-server.ts` |
| `dotenv` | 18.0.9 | carga `.env` en herramientas independientes |
| `eslint`, `eslint-config-next` | 9.39.5 y 16.4.2 | linter del repo |
| `prettier`, `prettier-plugin-tailwindcss` | 3.9.10 y 0.8.1 | formateador del repo |
| `@base-ui/react`, `class-variance-authority`, `clsx`, `lucide-react`, `tailwind-merge`, `tw-animate-css`, `shadcn` | 1.9.0, 0.7.1, 2.1.1, 1.61.0, 3.7.0, 1.4.0 y 4.22.1 | base de la UI de shadcn |
| `@types/react`, `@types/react-dom` | 19.3.0 y 19.3.0 | tipos |
| Node.js y pnpm (herramientas) | 24.22.1 y 12.15.0 | prerrequisitos de §10, no se instalan por paso |

### Deliberately not used
| Rejected | Instead | Why |
|---|---|---|
| `fast-check` | `mulberry32` sembrado (`tests/unit/helpers/prng.ts`) | una dependencia nueva para 3 propiedades (`allocate`, `prorateDiscount` y `parseMoney(formatMoney(x))`); el generador es una función corta |
| `jsdom`, `@testing-library/*` | galería `/dev/componentes` + Playwright | un solo mecanismo para ejercitar componentes |
| `vite-tsconfig-paths` | `resolve.tsconfigPaths: true` de Vite 8 | está integrado desde Vite 8 |
| `argon2` | `@node-rs/argon2` | `argon2` compila código nativo con node-gyp en la máquina de desarrollo |
| TanStack Table 9 | TanStack Table 8.21.3 | reescritura; la guía de shadcn para v9 no está verificada |
| Storybook | galería de desarrollo | mantenimiento de otra herramienta para cinco componentes |
| `date-fns`, `dayjs` | `Intl.DateTimeFormat#formatToParts` | los helpers de la fase son cinco funciones (`localDateKey`, `startOfLocalDay`, `endOfLocalDay`, `addLocalDays`, `formatLocalDateTime`) más la constante `APP_TIME_ZONE` |
| Zustand, React Hook Form | (no se instalan) | no hacen falta hasta las Fases 3 y 1 |
| `@axe-core/playwright` | (no se instala) | la comprobación automática de accesibilidad es de la Fase 6 (`docs/ARCHITECTURE.md` §10) |

---

## 12. Deployment Strategy

### Hosting
NOT APPLICABLE en la Fase 0 — no hay despliegue: la plataforma (VPS o servicio gestionado) se decide en la Fase 6 (`docs/DECISIONS_PENDING.md` #21 a #23, `docs/ARCHITECTURE.md` §9). Para esa fase quedan fijados el comando de build (`pnpm build`), el de arranque (`pnpm start`) y la verificación de salud (`GET /api/health`).

### Environments
| Environment | Branch | URL | Database | Third-party mode |
|---|---|---|---|---|
| Local | — | `http://localhost:3000` (`pnpm dev`) | Postgres de Docker: `boutique_pos` (desarrollo) y `boutique_pos_test` (pruebas) | ninguno |
| CI (GitHub Actions) | cualquier PR y `main` | n/a | servicio `postgres:16-alpine` con ambas bases creadas por un paso `psql` | ninguno |
| Production | `main` | NOT APPLICABLE hasta la Fase 6 | NOT APPLICABLE | NOT APPLICABLE |

### CI/CD
Un workflow (`.github/workflows/ci.yml`, paso 16), job `check` en `ubuntu-24.04`, en este orden: `actions/checkout@v7` → `pnpm/action-setup@v6` (`cache: true`) → `actions/setup-node@v7` (Node 24) → `pnpm install --frozen-lockfile` → `pnpm db:generate` → paso `psql` que crea las dos bases y las extensiones → `pnpm db:deploy` → `pnpm lint` → `pnpm exec eslint --max-warnings 0` → `pnpm exec next typegen` → `pnpm typecheck` → `pnpm format:check` → `pnpm test` → `pnpm test:coverage` → `pnpm build` (`typegen` genera los tipos de rutas de Next, que están en `.gitignore` y no existen en el checkout de CI; sin ellos `tsc --noEmit` falla con TS2304). Job `e2e` solo en `main`, después de `check`: mismo arranque (checkout hasta `pnpm db:deploy`) más `pnpm exec playwright install --with-deps chromium` y `pnpm test:e2e`; no ejecuta `typecheck` y por eso no lleva `typegen` (`next build`, que lanza Playwright, genera sus propios tipos). **Qué ejecuta el CI y qué no:** ejecuta exactamente los comandos listados arriba (`check`: instalación, generación del cliente, bases, migraciones, `lint`, `eslint --max-warnings 0`, `typegen`, `typecheck`, `format:check`, `test`, `test:coverage`, `build`; `e2e`: arranque más navegador y `test:e2e`). **No ejecuta** `pnpm db:up` (el servicio de Actions provee Postgres), `pnpm db:seed` suelto ni su segunda corrida (la semilla solo corre dentro de `tests/integration/seed.test.ts`), `scripts/smoke-server.ts` (ni el arranque con `next start` ni con `next dev`), la repetición del Bootstrap, las etiquetas de checkpoint ni las puertas manuales de §20.1: esas se ejecutan en local con la puerta de §20.1.

### Release and rollback
No hay releases. El rollback de la construcción es por etiquetas: `git reset --hard <etiqueta del paso anterior>` (la etiqueta de cada paso está en §9) y reintentar; nunca se depura hacia adelante sobre un paso roto. Migraciones: esta fase no crea ninguna; la regla vigente es `prisma migrate deploy` (nunca `db push`) y, en producción, como paso de despliegue explícito y no al arrancar la app.

### Domain, DNS, TLS
NOT APPLICABLE — sin dominio ni producción hasta la Fase 6.

---

## 13. Testing Strategy

| Layer | Framework | What it covers | Where | Runs |
|---|---|---|---|---|
| Unit | Vitest 5, proyecto `unit` | entorno, errores y mensajes, fechas, dinero y formato, permisos, hash de contraseñas, guardia de arquitectura, workflow de CI | `tests/unit/**/*.test.ts` | cada commit (`pnpm test:unit`) |
| Integration | Vitest 5, proyecto `integration`, Postgres real | `audit.log` y el trigger de solo inserción, semilla idempotente, `/api/health`, invariante de stock | `tests/integration/**/*.test.ts` | cada commit (`pnpm test:integration`) |
| E2E | Playwright, Chromium | shell, `/api/health`, 404 y los cinco componentes compartidos en la galería | `tests/e2e/*.spec.ts` | `main` en CI y `pnpm test:e2e` en local |

### Critical flows to cover E2E
1. El shell: `/` muestra "Inicio" en la barra lateral y un 404 muestra la página de no encontrado (lo que el cajero ve si algo falla).
2. `GET /api/health` responde 200 con `{ status: 'ok' }` contra la base real.
3. Un monto escrito a mano se normaliza a `L 1,234.50` y un texto inválido se marca (el dinero mal tecleado es el error más caro del POS).

### Test data
La BD de pruebas `boutique_pos_test` la crea `docker/postgres/init` al crear el volumen. `tests/integration/global-setup.ts` aplica `prisma migrate deploy` a esa base antes de cada corrida del proyecto `integration`, y `resetDatabase()` hace `TRUNCATE … RESTART IDENTITY CASCADE` de todas las tablas de la aplicación (menos `_prisma_migrations`) en `beforeEach` o `beforeAll`. `fileParallelism: false` evita que dos archivos pisen la misma base; ningún test depende del orden de otro. El archivo que levanta el servicio es `docker-compose.yml` (repo), la variable es `DATABASE_URL_TEST` (§10) y los comandos son `pnpm db:up` y `pnpm db:down`; el detalle de configuración está en §19.6. Los tests de siembra y de invariantes usan entidades con nombre, nunca conteos de filas.

### What is deliberately not tested
Apariencia y contraste (se midieron con un script antes de escribir los tokens; se revisan a mano en el lanzamiento); accesibilidad automatizada con axe (Fase 6); el render de `error.tsx` (no hay forma barata de provocarlo; se revisa con la guía instalada de Next); modo oscuro (solo tokens); el workflow de GitHub Actions ejecutándose (solo su contenido de texto; la ejecución real es de la lista de lanzamiento); server actions y servicios de negocio (no existen todavía).

---

## 14. Security & Secrets

| Concern | Control | Implemented in |
|---|---|---|
| Secret storage | Secretos solo en `.env` (ignorado) y variables de CI; `.env.example` con valores falsos | `.gitignore`, `.env.example`, `ci.yml` |
| Secret rotation | Las credenciales demo y `AUTH_SECRET` se rotan antes de producción (lista de lanzamiento de §20.1) | §20.1 |
| Input validation | Zod en el borde; en esta fase solo valida el entorno. `parseMoney` devuelve `null` ante texto inválido | `src/lib/env.ts`, `src/lib/format.ts` |
| Output encoding / XSS | React escapa por defecto; no hay `dangerouslySetInnerHTML` | componentes de `src` |
| SQL injection | Prisma parametriza. La única excepción es `$executeRawUnsafe` en `resetDatabase()`, que interpola identificadores leídos del catálogo de Postgres (no entrada de usuario) y solo corre contra una base `_test` | `tests/integration/helpers/db.ts` |
| AuthN / AuthZ | Capacidades por rol listas (`permissions.ts`); la autenticación llega en la Fase 1; el servidor siempre decide | `src/lib/permissions.ts` |
| CSRF | NOT APPLICABLE hasta que existan server actions con sesión (Fase 1) | — |
| Rate limiting / abuse | NOT APPLICABLE hasta el login y el PIN (Fase 1) | — |
| Webhook verification | NOT APPLICABLE | — |
| Dependency audit | `pnpm audit` en CI llega con la Fase 6; nuevas dependencias fijadas con versión exacta y justificadas en §11 | §11 |
| Security headers | NOT APPLICABLE hasta el despliegue (Fase 6: CSP, HSTS, `X-Content-Type-Options`) | — |
| PII handling | La semilla solo crea usuarios ficticios; no hay datos de clientes | `prisma/seed/run-seed.ts` |
| Logging hygiene | Nunca se registran contraseñas, PIN ni sus hashes; `/api/health` no devuelve el texto de la excepción; `toActionResult` no filtra el mensaje de errores inesperados | `src/lib/health.ts`, `src/lib/action-result.ts` |
| Contraseñas y PIN | Argon2id (`@node-rs/argon2`); la semilla se niega a correr con `NODE_ENV=production` | `src/lib/password.ts`, `prisma/seed/run-seed.ts` |
| Auditoría | `AuditLog` es de solo inserción por trigger de BD (UPDATE y DELETE se rechazan) | migración `constraints`, probado en el paso 7 |

**Hard rules.** Ningún secreto se confirma, imprime en un log ni llega al bundle del cliente (lo que empieza con `NEXT_PUBLIC_` es público: la única variable así, `NEXT_PUBLIC_COMPONENT_GALLERY`, no es un secreto). Toda comprobación de autorización corre antes del trabajo, no después. No aplica un régimen regulatorio específico en la Fase 0 (no hay datos de clientes ni de tarjetas; las tarjetas nunca se almacenan, `docs/PRD.md` §6). Las deny rules de `.claude/settings.json` desalientan leer `.env`, pero no son aislamiento: para eso hace falta el sandbox.

---

## 15. Accessibility

**Target: WCAG 2.2 Level AA.** La interfaz de la Fase 0 es pequeña (shell y cinco componentes), pero fija las bases que heredan todas las pantallas.

### Baseline requirements
| Requirement | Rule en esta fase |
|---|---|
| Semantic HTML | Landmarks `nav` (barra lateral), `header`, `main#contenido`; un solo `h1` por página; tablas con `<caption>` accesible |
| Keyboard | El primer elemento enfocable es "Saltar al contenido"; la barra lateral, `SidebarTrigger`, los diálogos y `MoneyInput` se operan con teclado; `Escape` cierra `ConfirmDialog` |
| Focus visible | Anillo de foco con `--ring` (6.36:1 contra `--background`, calculado a mano con la fórmula WCAG; el borde del control en foco usa el color completo, sin transparencia) |
| Contraste | Los pares de §7 cumplen AA; el límite de controles `--border` da 3.62:1 |
| Forms | `MoneyInput` exige etiqueta o `aria-label` del llamador; el error se comunica con `aria-invalid="true"` y no solo con color |
| Motion | `prefers-reduced-motion` reduce animaciones y transiciones (§7) |
| Live regions | El estado de carga usa `role="status"` y el de error `role="alert"` |

### Verification
La comprobación automática con axe llega en la Fase 6 (`docs/ARCHITECTURE.md` §10 la prevé "en pantallas clave"); no se añade `@axe-core/playwright` ahora (§11, "Deliberately not used"). En esta fase los E2E usan localizadores por rol y etiqueta (`getByRole`, `getByLabel`), que fallan si falta el nombre accesible. Los pasos manuales quedan en la lista de lanzamiento de §20.1: recorrido solo con teclado del shell y de la galería, una pasada con lector de pantalla y una a 200 % de zoom a 320 px de ancho.

---

## 16. Observability & Cost

### Instrumentation
| Signal | Tool | What it captures | Who looks at it |
|---|---|---|---|
| Errors | NOT APPLICABLE hasta la Fase 6 (Sentry u otro) | — | — |
| Logs | salida estándar de Next y de los scripts | errores del servidor (el detalle de errores inesperados va aquí, nunca al cliente) | quien desarrolla |
| Metrics | NOT APPLICABLE | — | — |
| Uptime | NOT APPLICABLE hasta producción | — | — |

### The metrics that matter for this project
| Metric | Target | Alert at |
|---|---|---|
| `GET /api/health` | 200 con `{ status: 'ok' }` | cualquier respuesta distinta (el CI y `smoke-server` fallan) |
| Cobertura por archivo de `src/lib/money.ts` | 100 % líneas, sentencias y funciones; 95 % ramas | `pnpm test:coverage` sale con código distinto de 0 |
| Duración del job `check` de CI | menos de 15 min | el timeout de 20 min del workflow |

### Health check
Ruta `GET /api/health`: ejecuta `select 1` contra la BD y responde 200 o 503; no comprueba migraciones aplicadas (eso lo cubren `prisma migrate deploy` y las pruebas). La consultan `scripts/smoke-server.ts`, el `webServer` de Playwright y, desde la Fase 6, el monitor de uptime.

### Cost model
| Service | Free tier | Cost at v1 scale | Cost at 10× | Cliff to watch |
|---|---|---|---|---|
| GitHub Actions | minutos gratuitos del plan del repositorio | $0 | $0 | los minutos mensuales del plan si el repo es privado |
| Docker local | n/a | $0 | $0 | ninguno |

**Estimated monthly cost at launch: $0.** El único gasto futuro es el hosting de la Fase 6; ningún servicio de esta fase escala de forma superlineal.

---

## 17. Model Routing

NOT APPLICABLE — this project does not call an LLM at runtime.

---

## 18. Skills to Use During Build

Los nombres sin barra se activan solos: no se invocan como comandos. Si una skill no está instalada, el builder sigue con la guía de este blueprint, anota la sustitución en una línea y continúa. Las cuatro primeras de la tabla (`vitest`, `playwright-best-practices`, `prisma-orm-setup`, `vercel-react-best-practices`) ya están instaladas **y confirmadas en git** en este repo (`.agents/skills/` y `.claude/skills/`, fijadas en `skills-lock.json`, commit `b1cabde`): el builder no las instala ni las commitea; el comando de instalación sirve para otra máquina. El repo fija además `find-skills` (commit `1e1430f`), que ningún paso de esta fase usa y por eso no figura en la tabla; `frontend-design` es un plugin y no está instalado en el repo.

| Skill | Build steps | Why | Install |
|---|---|---|---|
| vitest | 1 a 8, 15, 16 | convenciones de Vitest 5: proyectos, cobertura, `clearMocks` | `npx skills add antfu/skills --skill vitest` |
| playwright-best-practices | 14 | localizadores por rol, `webServer`, sin esperas fijas | `npx skills add currents-dev/playwright-best-practices-skill --skill playwright-best-practices` |
| prisma-orm-setup | 7, 8, 9, 15 | cliente Prisma 7 con adaptador, semillas y `prisma.config.ts` | `npx skills add prisma/skills --skill prisma-orm-setup` |
| vercel-react-best-practices | 10 a 13 | rendimiento y límites servidor/cliente de React y Next | `npx skills add vercel-labs/agent-skills --skill react-best-practices` (la skill upstream se llama `react-best-practices`; si el comando falla, revisa el README de `vercel-labs/agent-skills`) |
| frontend-design | 10 a 13 | diseño de interfaz de calidad de producción para shell y componentes | `/plugin marketplace add anthropics/skills` y luego `/plugin install example-skills@anthropic-agent-skills` |

---

## 19. Agent Workspace

En un cambio brownfield el workspace **se fusiona** con lo que el repo ya tiene en lugar de reemplazarlo. El bundle emite, bajo `blueprints/fase-0-cimientos/workspace/` (que refleja la raíz del repo):

```
workspace/
├── CLAUDE.md                      # §19.1 (copia del actual + marca + sección 11)
├── AGENTS.md                      # §19.2 (copia del actual + marca + una línea)
├── vitest.config.ts               # §19.6
├── playwright.config.ts           # §19.6 (se copia en el paso 14)
├── scripts/smoke-server.ts        # §19.6
├── tests/integration/global-setup.ts
├── tests/integration/helpers/db.ts
└── .claude/
    ├── settings.json              # §19.3
    ├── skills/money-change-checklist/SKILL.md   # §19.4
    ├── skills/new-capability/SKILL.md           # §19.4
    ├── rules/money.md             # §19.5
    └── rules/tests.md             # §19.5
```

**La copia es segura de repetir** (bloque de Bootstrap de §10, sección 4): un bucle `find … | while read` que solo copia lo que falta y sale con 0 aunque omita archivos (no se usa `rsync` porque Git para Windows no lo trae, ni `cp -n` porque en BSD y macOS sale con 1 al omitir un archivo y rompería la segunda ejecución con `set -e`). **Nunca se sobrescriben** `package.json` ni `pnpm-lock.yaml` (el workspace no los emite) ni ningún archivo que un paso ya haya editado. `CLAUDE.md` y `AGENTS.md` se copian solo si no contienen la marca `fase-0-blueprint`, y `playwright.config.ts` queda fuera de la copia del Bootstrap por la razón del paso 14. No hay `.claude/commands/`.

**Todo lo emitido pasa las puertas del propio blueprint.** La configuración de formato que gobierna es la que ya está en el repo (`.prettierrc.json`: `semi`, comillas dobles, `trailingComma: "all"`, `printWidth: 100`, 2 espacios; no se emite ni se regenera), y los archivos `.ts` del workspace están escritos en ese estilo. Los archivos de `.claude/`, `AGENTS.md` y `CLAUDE.md` no los formatea Prettier (el Bootstrap añade `.claude` y `AGENTS.md` a `.prettierignore`; `CLAUDE.md` ya estaba). `eslint` y `tsc` sí revisan los `.ts`. El paso 1 corre `pnpm format` antes de verificar como red de seguridad.

### 19.1 `CLAUDE.md`

`workspace/CLAUDE.md` es el `CLAUDE.md` del commit `fca87b5` **tal cual**, con exactamente dos cambios: (1) la marca de abajo, en su propia línea justo después del bloque de cita del encabezado (un comentario HTML de bloque no cuesta tokens en tiempo de ejecución); (2) una sección 11 al final. Tiene 145 líneas (menos de 200). Conserva su orden: los comandos están en su sección 4, no primero, porque la convención del repo gana sobre la del plugin (§20.3, fila 6). La sección 11 también lista los comandos que añade la Fase 0.

```markdown
<!-- fase-0-blueprint -->
```

La sección 11 que se añade al final (texto literal, sangrado cuatro espacios aquí para que no se confunda con los encabezados numerados del blueprint; en `workspace/CLAUDE.md` va sin sangría):

    ## 11. Build de la Fase 0

    La Fase 0 se construye con el bundle `blueprints/fase-0-cimientos/` (16 pasos en 2 épicas). Fuente de verdad: `blueprints/fase-0-cimientos/blueprint.md`. Para retomar o avanzar, ejecuta `/architect-next` desde la raíz del repo.

    - Durante la Fase 0 el plan aprobado es `blueprint.md`; no esperes confirmación entre pasos ni abras plan mode: ejecuta los pasos en orden.
    - Cada paso termina con `git add -A && git commit` y una etiqueta `step-NN-<slug>`; el rollback es `git reset --hard <etiqueta del paso anterior>`.
    - Antes de cada Checkpoint corre `pnpm format` y luego `pnpm lint`, `pnpm typecheck` y `pnpm format:check`.
    - Las pruebas de integración usan solo la base `boutique_pos_test` (`DATABASE_URL_TEST`); nunca la de desarrollo.
    - `pnpm test` corre los proyectos `unit` e `integration` de Vitest; `pnpm test:e2e` corre Playwright.
    - Comandos que añade o usa la Fase 0: `pnpm test:unit`, `pnpm test:integration`, `pnpm test:coverage`, `pnpm format`, `pnpm format:check`, `pnpm db:generate`, `pnpm exec next typegen` (genera los tipos de rutas de Next, ausentes en un clon limpio, antes de `pnpm typecheck`), `pnpm db:deploy`, `pnpm db:down`.
    - La Fase 0 no agrega pantallas de negocio, no cambia el esquema Prisma ni las migraciones, y no sube versiones de `next`, `react`, `prisma` ni `zod`.

### 19.2 `AGENTS.md`

`workspace/AGENTS.md` (13 líneas) es el `AGENTS.md` actual (el bloque `nextjs-agent-rules`, que reescribe `next dev`, queda intacto) más, **fuera** de ese bloque, la marca y una línea de puntero a `CLAUDE.md`, que es la fuente de verdad:

```markdown
<!-- fase-0-blueprint -->

Fase 0 en curso: sigue `blueprints/fase-0-cimientos/blueprint.md` y las reglas de `CLAUDE.md`, que es la fuente de verdad del proyecto (comandos, reglas de dominio y estructura).
```

### 19.3 `.claude/settings.json`

El repo no tenía `.claude/settings.json`. Este archivo pre-aprueba cada comando de §9 (`Do` y `Verify`) y de §20.1 que no es de solo lectura, **por subcomando** (la regla se evalúa por separado en `&&`, `||`, `;`, `|` y dentro de `$( )`; `test` entra por `Bash(test:*)`, `grep`, `head`, `tail` y los `git` de lectura son de solo lectura). Nada de intérpretes desnudos, `curl`, `npx`, `sh -c` ni `pnpm dlx` con comodín: el único `dlx` permitido es la línea exacta del paso 10. `Bash(pnpm exec tsx scripts/smoke-server.ts:*)` acota `tsx` a un único script del repo, y `Bash(pnpm exec next typegen)` acota `next` al subcomando que genera tipos (la línea exacta que ejecutan el Bootstrap, el paso 1 y §20.1). `Bash(git var GIT_AUTHOR_IDENT:*)` y `Bash(git var GIT_COMMITTER_IDENT:*)` cubren la guarda de identidad del Bootstrap (solo lectura; van con `:*` porque la línea redirige su salida a `/dev/null`).

```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm install --frozen-lockfile)",
      "Bash(pnpm add -D -E vitest@5.0.5 @vitest/coverage-v8@5.0.5 vite@8.3.5 @types/node@24.19.2)",
      "Bash(pnpm add -E @node-rs/argon2@2.2.2)",
      "Bash(pnpm add -E @tanstack/react-table@8.21.3)",
      "Bash(pnpm add -D -E @playwright/test@1.64.1)",
      "Bash(pnpm dlx shadcn@4.22.1 add sidebar table alert-dialog dialog skeleton input tooltip separator sheet --yes)",
      "Bash(npm pkg set:*)",
      "Bash(date +%F)",
      "Bash(pnpm format)",
      "Bash(pnpm format:check)",
      "Bash(pnpm lint)",
      "Bash(pnpm typecheck)",
      "Bash(pnpm build)",
      "Bash(pnpm test)",
      "Bash(pnpm test:unit)",
      "Bash(pnpm test:integration)",
      "Bash(pnpm test:coverage:*)",
      "Bash(pnpm test:e2e)",
      "Bash(pnpm db:up)",
      "Bash(pnpm db:down)",
      "Bash(pnpm db:generate)",
      "Bash(pnpm db:deploy)",
      "Bash(pnpm db:seed)",
      "Bash(pnpm exec eslint --max-warnings 0)",
      "Bash(pnpm exec next typegen)",
      "Bash(pnpm exec playwright install chromium)",
      "Bash(pnpm exec tsx scripts/smoke-server.ts:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git tag:*)",
      "Bash(git mv:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git rev-parse:*)",
      "Bash(git ls-files:*)",
      "Bash(git check-ignore:*)",
      "Bash(git merge-base:*)",
      "Bash(git var GIT_AUTHOR_IDENT:*)",
      "Bash(git var GIT_COMMITTER_IDENT:*)",
      "Bash(test:*)",
      "Bash(mktemp)",
      "Bash(cp blueprints/fase-0-cimientos/workspace/playwright.config.ts playwright.config.ts)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.local)",
      "Read(./.env.*.local)",
      "Bash(git push:*)",
      "Bash(pnpm db:reset:*)",
      "Bash(docker compose down -v:*)",
      "Bash(docker volume rm:*)"
    ]
  }
}
```

Cobertura por subcomando: cada línea `pnpm …` de los `Verify` tiene su entrada exacta, salvo `pnpm test:coverage`, que los `Verify` y §20.1 redirigen a un archivo (`pnpm test:coverage > "$out"`) y por eso entra como `Bash(pnpm test:coverage:*)` (prefijo, para que la redirección no deje la línea sin cubrir); ninguna otra línea `pnpm` del bundle se redirige ni se encadena por tubería; `grep`, `head`, `tail`, `wc` y `git` de lectura no requieren entrada; `test …` entra por `Bash(test:*)` (también las afirmaciones `status=0; cmd || status=$?; test "$status" -eq N`, donde las asignaciones no son comandos); `out=$(mktemp)` entra por `Bash(mktemp)`; `git add -A && git commit -m …` y `git tag …` por los tres `git` de escritura; `git rev-parse --verify --quiet refs/tags/…` y `git merge-base --is-ancestor …` de §20.1 por sus entradas. `pnpm db:reset` está **denegado** a propósito: borra la base de desarrollo. Las reglas de denegación desalientan pero no aíslan.

### 19.4 Project skills — `.claude/skills/<name>/SKILL.md`

Dos flujos repetibles, cada uno un procedimiento con su verificación y su "no hacer". Los archivos reales están en `workspace/.claude/skills/`; el campo `description` es lo único que se carga hasta que la skill se activa.

| Skill | Triggers on | What it automates |
|---|---|---|
| `money-change-checklist` | tocar `src/lib/money.ts` o `src/lib/format.ts`; calcular precios, descuentos, ISV, totales o prorrateos | centavos enteros, redondeo único, prueba con literales a mano, cobertura por archivo de `money.ts`, y actualizar `docs/ARCHITECTURE.md` si cambia una regla |
| `new-capability` | pedir un permiso nuevo o moverlo entre roles; autorizar un override con PIN de gerente | actualizar `docs/PRD.md` §2, `CAPABILITIES`, `ROLE_CAPABILITIES`, `MANAGER_PIN_OVERRIDES`, la fila de la matriz de pruebas y `requireCapability` en la action |

### 19.5 `.claude/rules/*.md`

Convenciones por área que solo se cargan al tocar archivos que coinciden con sus `paths`:

| File | `paths` globs | Covers |
|---|---|---|
| `.claude/rules/money.md` | `src/lib/money*.ts`, `src/lib/format.ts`, `tests/unit/money*.test.ts`, `tests/unit/format.test.ts` | centavos, redondeo, formato, `ValidationError`, cobertura y pruebas de propiedades |
| `.claude/rules/tests.md` | `tests/**` | separación unit/integration/E2E, solo `boutique_pos_test`, sin `.only`/`.skip`, entidades con nombre, textos desde `messages` |

### 19.6 Verify-critical config and local infrastructure

Cada archivo que un `Verify` necesita para correr existe como archivo real en `workspace/` (el contenido completo está ahí; las líneas que importan para cada tabla de abajo se citan literalmente y coinciden con el archivo).

| File | Path in the project | Which `Verify` commands need it | Resolution/env handling it carries | Bundle-path exclusion |
|---|---|---|---|---|
| `vitest.config.ts` | `vitest.config.ts` | pasos 1 a 9, 15, 16 (todo `pnpm test*`) y §20.1 | `resolve: { tsconfigPaths: true },` hace que `@/…` funcione bajo Vitest, y `extends: true` en ambos proyectos hace explícito que lo heredan; `import "dotenv/config";` carga `.env` para leer `DATABASE_URL_TEST`; el proyecto `unit` fija `test.env` con valores de relleno de `DATABASE_URL`, `AUTH_SECRET` y `APP_URL` (porque `@/lib/env` valida al importarse); el proyecto `integration` fija `DATABASE_URL: process.env.DATABASE_URL_TEST ?? ""` y `globalSetup: ["./tests/integration/global-setup.ts"]`; `fileParallelism: false`; umbrales de cobertura por archivo de `src/lib/money.ts`. **Aviso esperado e inocuo:** cada corrida de Vitest imprime el aviso de Vite «(!) Your Vite config uses features that are unsupported by `configLoader: 'native'` … ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1)»; sale con 0 y no falla nada (comprobado en la prueba de humo). No se arregla a propósito: renombrar el archivo a `vitest.config.mts` o añadir `"type": "module"` a `package.json` cambiaría el nombre que citan los gates y el campo `type` congelado del repo (§1, interfaces congeladas; §20.3 fila 21) | `const exclude = ["**/node_modules/**", "blueprints/**"];` usada en el nivel raíz y en ambos proyectos |
| `tests/integration/global-setup.ts` | igual | pasos 7, 8, 9, 15, 16 | `import "dotenv/config";`; ejecuta `pnpm exec prisma migrate deploy` con `env: { ...process.env, DATABASE_URL: databaseUrl }` (el `dotenv` de `prisma.config.ts` no sobreescribe una variable ya definida, así que la URL de pruebas gana); se niega a seguir si el nombre de la base no termina en `_test`; sin alias `@/` | n/a — este archivo nunca recorre el árbol |
| `tests/integration/helpers/db.ts` | igual | pasos 7, 8, 9, 15 y 16 (todos los pasos cuyo `Verify` corre el proyecto `integration`: `pnpm test:integration` en 7, 8, 9 y 15, `pnpm test` en 16; el paso 9 lo carga porque `audit.test.ts`, del paso 7 del que depende, sigue en ese proyecto) | `import "dotenv/config";`; `@/generated/prisma/client` lo resuelve `tsconfigPaths` de Vitest; exporta `assertTestDatabaseUrl`, `testDb`, `resetDatabase`, `closeDatabase` | n/a — nunca recorre el árbol |
| `scripts/smoke-server.ts` | igual | pasos 9, 12, 14 y §20.1 | corre bajo `tsx` (script independiente): solo importa `node:*`, sin `@/`; resuelve el binario de Next por ruta (`node_modules/next/dist/bin/next`); `next start` y `next dev` leen `.env` por sí mismos; mata el árbol de procesos con `taskkill` en Windows o `process.kill(-pid)` en POSIX | n/a — solo lanza `next` y pide URLs |
| `playwright.config.ts` | `playwright.config.ts` (copiado por el paso 14) | paso 14, CI y §20.1 | `webServer.env: { NEXT_PUBLIC_COMPONENT_GALLERY: "enabled" }` es lo único que habilita la galería en un build de producción; `next build` y `next start` leen `.env`; las especificaciones importan `messages` por ruta relativa | `testIgnore: ["**/blueprints/**"],` |
| `.claude/settings.json`, `.claude/skills/**`, `.claude/rules/**`, `CLAUDE.md`, `AGENTS.md` | igual | ninguno (los lee Claude Code, no las herramientas del proyecto) | no necesitan resolución ni variables | n/a — ninguna herramienta del proyecto recorre `.claude` (queda en `.prettierignore`) |

**Paquetes con resolución no trivial que este blueprint exige, y por qué ninguna configuración necesita una línea extra:** `@node-rs/argon2` trae un binario nativo por plataforma (`optionalDependencies`); Vitest lo trata como dependencia externa de `node_modules` y lo carga con el pool `forks`, que es el valor por defecto de Vitest 5, así que `password.test.ts` y la semilla lo resuelven sin condiciones ni alias. El cliente de Prisma vive en `src/generated/prisma` (TypeScript que genera `pnpm db:generate`, ejecutado por el Bootstrap) y se importa por el alias `@/generated/prisma/client` en las pruebas y por ruta relativa en la semilla. No hay paquetes `server-only` ni de solo ESM bajo un runner CJS. Cada paquete que importa una prueba o un script de los que corren en Vitest, `tsx` o Next está en el árbol de dependencias de §11.

Configuración existente que el Bootstrap **edita** (no se emite como archivo nuevo; los `Verify` dependen de estas líneas):

| File | Línea literal que añade el Bootstrap | Efecto |
|---|---|---|
| `eslint.config.mjs` | `"blueprints/**"`, `"coverage/**"`, `"test-results/**"`, `"playwright-report/**"` dentro de `globalIgnores([...])` | ESLint no lee `.gitignore` |
| `tsconfig.json` | `"exclude": ["node_modules", "blueprints"]` | `tsc` y `next build` no ven el bundle |
| `.prettierignore` | `blueprints`, `.claude`, `AGENTS.md` | Prettier no formatea el bundle ni la configuración de agente |
| `.gitignore` | `/test-results/`, `/playwright-report/` | artefactos de Playwright fuera de git (Prettier también respeta `.gitignore`) |
| `src/app/globals.css` | `@source not "../../blueprints";` | Tailwind 4 detecta clases escaneando el proyecto: excluye el bundle |
| `.env.example` | `DATABASE_URL_TEST=postgresql://boutique:change-me-local-only@localhost:5432/boutique_pos_test?schema=public` | documenta la BD de pruebas |

#### Resolution convention matrix

**La convención, decidida una vez:** el alias `@/…` → `src/…` se usa en el código de aplicación y en las pruebas que corren bajo Next o Vitest; todo lo que corre fuera de ellos (la semilla, `scripts/`, el `globalSetup` y las especificaciones E2E) usa rutas **relativas sin extensión** y nunca `@/`.

| Context | Command that exercises it | Convention as it appears there | Config + literal setting that makes it work |
|---|---|---|---|
| Application source | `pnpm typecheck` y `pnpm build` | `import { db } from "@/lib/db"` | `tsconfig.json` (existente): `"paths": { "@/*": ["./src/*"] }` con `"moduleResolution": "bundler"` |
| Test files (Vitest) | `pnpm test` | `import { parseEnv } from "@/lib/env"`; entre archivos de pruebas, relativo (`./helpers/db`, `../../prisma/seed/run-seed`) | `vitest.config.ts`: `resolve: { tsconfigPaths: true },` |
| Standalone scripts | `pnpm db:seed` (ejecuta `tsx prisma/seed.ts`) y `pnpm exec tsx scripts/smoke-server.ts start 3190 /api/health=200:ok` | `import { runSeed } from "./seed/run-seed"`, `import { PrismaClient } from "../src/generated/prisma/client"`, `import { hashSecret } from "../../src/lib/password"`; `smoke-server.ts` solo importa `node:*` | `tsconfig.json`: `"moduleResolution": "bundler"` ya acepta relativos sin extensión, así que no hace falta ninguna bandera adicional para que `tsc` acepte esos archivos; `tsx` los resuelve en ejecución |
| Build / bundle | `pnpm build` | `@/…` | Turbopack lee `paths` de `tsconfig.json` (el mismo ajuste que la fila de código de aplicación) |
| Playwright specs | `pnpm test:e2e` | `import { messages } from "../../src/config/messages.es"` (relativo) | ninguna: una ruta relativa no necesita alias |
| Vitest `globalSetup` | `pnpm test:integration` | solo `node:child_process` y `dotenv/config` | n/a |

#### Every tool that reads env vars must be given a way to load them

| Tool | Variables it reads | Loading mechanism | Where it is present |
|---|---|---|---|
| Prisma CLI (`db:generate`, `db:deploy`, `db:migrate`, `db:seed`) | `DATABASE_URL` | `import "dotenv/config"` en `prisma.config.ts` (repo, existente) | todos los lugares donde se escribe el comando (§10, §9 paso 8, §19.1, §20.1) porque vive en la config y no en la llamada |
| Vitest (`test*`) | `DATABASE_URL_TEST` | `import "dotenv/config"` en `vitest.config.ts` | idem |
| `global-setup.ts` | `DATABASE_URL_TEST` | `import "dotenv/config"` y `DATABASE_URL` pasado explícitamente al hijo | archivo |
| `prisma/seed.ts` | `DATABASE_URL` | `import "dotenv/config"` en el propio script | archivo |
| `next dev`, `next build`, `next start`, `next typegen` | `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, `TZ` (`next typegen` carga `next.config.ts` con la fase de producción: la guía instalada pide tener las variables disponibles) | Next lee `.env` por sí mismo; en CI, `env:` a nivel de workflow | §10 y `ci.yml` |
| `scripts/smoke-server.ts` y `playwright.config.ts` | ninguna directamente | lanzan `next`, que lee `.env`; Playwright solo lee `CI` | archivos |
| `docker compose` | `POSTGRES_*` | Compose lee `.env` del directorio del proyecto | §10 |

#### Services a gate depends on are provisioned by the blueprint

1. **Lo que lo arranca:** `docker-compose.yml` (repo, existente): imagen `postgres:16-alpine`, volumen `pgdata`, healthcheck con `pg_isready`; `docker/postgres/init/01-extensions-and-test-db.sh` crea `boutique_pos_test` y las extensiones al crear el volumen. El tag de imagen tiene su fila en §11.
2. **La variable:** `DATABASE_URL_TEST` en la tabla de §10, con su valor local literal (`postgresql://boutique:change-me-local-only@localhost:5432/boutique_pos_test?schema=public`) y la misma clave en `.env.example`. Las pruebas usan únicamente esa base.
3. **Los comandos:** `pnpm db:up`, `pnpm db:down`, `pnpm db:deploy` y `pnpm db:generate` en el Bootstrap de §10 y en `CLAUDE.md` (§4 y §11); el reinicio entre pruebas lo hace `resetDatabase()`.
4. **El permiso:** esos cuatro comandos están en `permissions.allow` (§19.3). No se pre-aprueba ningún comando de Compose directo porque ningún gate lo usa.

#### The bundle sits inside the project, so every emitted config excludes it

El bundle vive en `blueprints/fase-0-cimientos/` y contiene copias de configuración. Cada herramienta que recorre el árbol lleva una línea literal de exclusión en su propia sintaxis (tablas anteriores): ESLint (`"blueprints/**"`), `tsc` (`"blueprints"`), Prettier (`blueprints`), Vitest (`"blueprints/**"`), Playwright (`"**/blueprints/**"`) y Tailwind (`@source not "../../blueprints";`). Next solo escanea `src/app`, `pnpm-workspace.yaml` no define `packages:` y `git` versiona el bundle a propósito (no se ignora). Las puertas de lint, formato y typecheck de §20.1 se ejecutan desde la raíz **con el bundle presente**.

#### Cross-artifact value reconciliation

| Shared value | Single source — the file that decides it | Literal value | Every other place it appears | Compared |
|---|---|---|---|---|
| Nombre de la BD de pruebas | `docker/postgres/init/01-extensions-and-test-db.sh` (`${POSTGRES_DB}_test`) | `boutique_pos_test` | `.env.example` (`…/boutique_pos_test?schema=public`) · Bootstrap §10 (deriva `${pathname}_test` en `.env`) · `ci.yml` (`DATABASE_URL_TEST` y `CREATE DATABASE boutique_pos_test;`) · `helpers/db.ts` y `global-setup.ts` (exigen sufijo `_test`) · comando G2 de este apartado (`-d boutique_pos_test`) · §10, §13, `rules/tests.md` | yes |
| Puerto y host de Postgres | `docker-compose.yml` (`127.0.0.1:${POSTGRES_PORT:-5432}:5432`) | `5432` | `.env.example` (`POSTGRES_PORT=5432` y las dos URLs) · `ci.yml` (`5432:5432` y las URLs) · §10 | yes |
| Imagen de Postgres | `docker-compose.yml` (`image:`) | `postgres:16-alpine` | `ci.yml` (dos jobs) · §11 · paso 16 | yes |
| Scripts de prueba y nombres de proyecto | `package.json` (`test`, `test:unit`, `test:integration`, `test:coverage`, `test:e2e`; los crean los pasos 1 y 14) | `pnpm test` = `vitest run` · `pnpm test:unit` = `vitest run --project unit` · `pnpm test:integration` = `vitest run --project integration` · `pnpm test:coverage` = `vitest run --project unit --coverage` · `pnpm test:e2e` = `playwright test` | `vitest.config.ts` (`name: "unit"` y `name: "integration"`) · `ci.yml` (`test`, `test:coverage` y `test:e2e`) · `CLAUDE.md` §11 · `settings.json` y §19.3 (los cinco; `test:coverage` como `Bash(pnpm test:coverage:*)` por la redirección a un archivo) · Verify de §9 (`test:unit` en los pasos 1 a 8, 15 y 16; `test:integration` en 7, 8, 9 y 15; `test:coverage` en 4 y 5; `pnpm test` en 16; `test:e2e` en 14), con los mismos arreglos de `tasks.json` y bloques de `epics/` · §20.1 · §12 · especificación de `ci-workflow.test.ts` · pasos 1 y 14 | yes |
| Puerto de Playwright | `playwright.config.ts` (`const port = 3100;`) | `3100` | paso 14 (texto y criterio) | yes |
| Puertos de humo | pasos 9, 12, 14 y §20.1 (argumento del script) | `3190` (`start`) y `3191` (`dev`) | §19.3 (la regla `smoke-server.ts:*` no repite el puerto) | yes |
| Ruta de salud | `src/app/api/health/route.ts` | `/api/health` | `playwright.config.ts` (`url`) · `shell.spec.ts` · pasos 9, 12, 14 · §20.1 · §5 | yes |
| Ruta de la galería | `src/app/(app)/dev/componentes/page.tsx` | `/dev/componentes` | `components.spec.ts` (`goto`) · paso 14 (Verify de 404) · §6 · §20.1 | yes |
| Variable de la galería | `src/app/(app)/dev/componentes/page.tsx` (la lee) | `NEXT_PUBLIC_COMPONENT_GALLERY` con valor `enabled` | `playwright.config.ts` (`webServer.env`) · §10 · §6 · paso 14 | yes |
| Credenciales demo | `prisma/seed/run-seed.ts` (`DEMO_USERS`) | `owner`/`Demo-Propietario-2026`/`1111`, `manager`/`Demo-Gerente-2026`/`2222`, `cashier`/`Demo-Cajero-2026`/`3333`, `warehouse`/`Demo-Almacen-2026`/`4444` | tablas de §10 y del paso 8 · README (paso 16) · `password.test.ts` (usa `Demo-Cajero-2026` como texto) | yes |
| Capacidades y matriz por rol | `src/lib/permissions.ts` (`CAPABILITIES`) | `sale.create`, `discount.apply`, `discount.applyBeyondLimit`, `sale.void`, `return.create`, `cash.open`, `cash.closeApprove`, `cash.viewOthers`, `product.write`, `product.viewCost`, `price.change`, `stock.adjust`, `purchase.receive`, `report.financial`, `user.manage`, `settings.manage`, `audit.view` (17) | matriz literal del paso 6 en §9 (17 filas × 4 roles) · la misma matriz en `epics/01-nucleo-de-dominio-y-pruebas.md` (E1-T6, mismos 17 ids en el mismo orden y mismas celdas) · `tests/unit/permissions.test.ts` (recorre las 17 filas y las compara con `CAPABILITIES`) · skill `new-capability` (procedimiento sobre `ROLE_CAPABILITIES`) | yes |
| Códigos de error | `src/lib/errors.ts` (`APP_ERROR_CODES`) | `VALIDATION`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT`, `INSUFFICIENT_STOCK`, `CASH_SESSION_CLOSED`, `FISCAL_RANGE_EXHAUSTED` (+ `UNEXPECTED` en `ActionResult`) | `src/config/messages.es.ts` (`errors`) · tabla de §5 · paso 2 | yes |
| Variables de entorno obligatorias | `src/lib/env.ts` (congelado) | `DATABASE_URL`, `AUTH_SECRET` (≥ 32), `APP_URL`, `TZ`, `NODE_ENV` | `.env.example` · `vitest.config.ts` (`sharedEnv` de 46 caracteres y URL de relleno) · `ci.yml` (`AUTH_SECRET` de 47 caracteres) · §10 | yes |
| Umbrales de cobertura de `money.ts` | `vitest.config.ts` (`coverage.thresholds["src/lib/money.ts"]` y `coverage.include: ["src/lib/money.ts"]`) | `src/lib/money.ts`: 100 / 100 / 100 / 95 (líneas / sentencias / funciones / ramas) | pasos 4 y 5 (Verify con `grep -q 'money.ts'`; `tasks.json` y `epics/01`) · §20.1 (misma comprobación) · `rules/money.md` · §1 · §16 | yes |
| Versión mayor de Node | `ci.yml` (`node-version: 24`) | `24` | §10 (prerrequisitos) · `@types/node` 24.19.2 en §11 y `settings.json` | yes |
| Ruta del bundle | el propio directorio | `blueprints/fase-0-cimientos/` | Bootstrap (`BUNDLE=`) · exclusiones (`blueprints`, `blueprints/**`, `**/blueprints/**`, `../../blueprints`: la misma carpeta en la sintaxis de cada herramienta) · `settings.json` (`cp …/playwright.config.ts`) · paso 14 · `CLAUDE.md` §11 · `AGENTS.md` | yes |
| Etiquetas de checkpoint | §9 (el bloque `git tag` de cada paso) | `step-01-vitest`, `step-02-errors-messages`, `step-03-dates`, `step-04-money-core`, `step-05-money-allocate-format`, `step-06-permissions-password`, `step-07-audit-integration`, `step-08-seed`, `step-09-health`, `step-10-ui-primitives`, `step-11-design-tokens`, `step-12-app-shell`, `step-13-shared-components`, `step-14-playwright`, `step-15-invariants-docs`, `step-16-ci-readme-close` (16) | `tasks.json` (`checkpoint` de E1-T1 a E2-T9, mismo orden) · el bloque `git tag` de cada tarea en `epics/` (7 en la épica 1, 9 en la 2) · las 16 líneas `git rev-parse --verify --quiet refs/tags/step-…` de §20.1 · el slug del mensaje de commit de cada Checkpoint (regla 9 de §9) | yes |
| Etiqueta del Bootstrap | §10 (bloque del commit) | `bootstrap-fase-0` | puerta de §20.1 (`refs/tags/bootstrap-fase-0`, `git merge-base --is-ancestor bootstrap-fase-0 step-01-vitest` y `git diff --quiet bootstrap-fase-0 HEAD -- prisma/schema.prisma prisma/migrations`) · explicación de la segunda ejecución en §10 · §20.3 | yes |
| Comando que genera los tipos de rutas de Next | `.github/workflows/ci.yml` (`- run: pnpm exec next typegen`, job `check`) | `pnpm exec next typegen` | `workspace/.claude/settings.json` (línea 28, `Bash(pnpm exec next typegen)`) y el bloque de §19.3 · `workspace/CLAUDE.md` (línea 144) y el bloque de §19.1 · especificación de `tests/unit/ci-workflow.test.ts` (§9 paso 16 y E2-T9) · Bootstrap de §10 (bloque 5) · Verify del paso 1 (§9 y `tasks.json` E1-T1) · regla 10 de §9 · §12 CI/CD · §19.6 (fila de herramientas que leen variables) · §20.1 (bloque y prosa) · `epics/` (línea Gate y cierre de ambas épicas, "Estado de partida" y Verify de E1-T1, `ci.yml` y prueba de E2-T9, nota del README) | yes |
| Generación del cliente de Prisma | `package.json` (`"db:generate": "prisma generate"`, existente) | `pnpm db:generate` | `ci.yml` (jobs `check` y `e2e`) · `workspace/.claude/settings.json` (línea 24) · `workspace/CLAUDE.md` (línea 144) y §19.1 · Bootstrap de §10 (bloque 5) · §12 CI/CD · §19.6 (servicios, "Los comandos") · §20.1 · secuencia de primer arranque del README y su `grep` (§9 paso 16, `tasks.json` E2-T9) · especificación de `ci-workflow.test.ts` · `epics/` | yes |
| Instalación con lockfile congelado | `.github/workflows/ci.yml` (`- run: pnpm install --frozen-lockfile`) | `pnpm install --frozen-lockfile` | `workspace/.claude/settings.json` (línea 4) · Verify de los pasos 1, 6, 10 y 14 (§9, `tasks.json` E1-T1, E1-T6, E2-T3, E2-T7) · criterio 1 del paso 1 · Bootstrap de §10 (bloque 5) · §12 CI/CD · §20.1 · especificación de `ci-workflow.test.ts` · `epics/` | yes |
| Pines de CI y ejecutor | `.github/workflows/ci.yml` | `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`, `runs-on: ubuntu-24.04` | afirmaciones de `tests/unit/ci-workflow.test.ts` (§9 paso 16 y E2-T9) · §11 (filas `actions/checkout` v7, `actions/setup-node` v7 y `pnpm/action-setup` v6) · Do y criterio 1 del paso 16 (§9, `tasks.json` E2-T9, `epics/02`) · §12 CI/CD · gate manual de §20.1 (`psql` existe en `ubuntu-24.04`) | yes |
| Ruta del `globalSetup` de Vitest | `workspace/vitest.config.ts` (`globalSetup: ["./tests/integration/global-setup.ts"]`) | `./tests/integration/global-setup.ts` | el archivo `workspace/tests/integration/global-setup.ts` (el Bootstrap lo copia a `tests/integration/global-setup.ts`, la misma ruta sin el prefijo `./`, que solo exige la opción de Vitest) · §3 (árbol y Delta) · §9 (mapa de pasos y paso 7) · §10 (tabla de variables y párrafo de carga del entorno) · §13 · §19 (árbol de `workspace/`) · §19.6 (fila de `vitest.config.ts`, fila propia y matriz de resolución) · `epics/01` | yes |
| Directorio de las especificaciones E2E | `workspace/playwright.config.ts` (`testDir: "tests/e2e"`) | `tests/e2e` | §1 (Current state, fila "Pruebas y CI") · §3 (árbol: `tests/` → `e2e/`) · §9 (mapa de pasos, Do y Verify del paso 14) · §13 (tabla de capas) · `tasks.json` E2-T7 (`files` y Verify) · `epics/02` (E2-T7) · `vitest.config.ts` no lo recoge: sus `include` solo cubren `tests/unit` y `tests/integration` | yes |
| URL base de la aplicación | `.env.example` (`APP_URL=http://localhost:3000`, existente) | `APP_URL=http://localhost:3000` | `ci.yml` (`APP_URL: http://localhost:3000`) · `workspace/vitest.config.ts` (`sharedEnv.APP_URL`, `"http://localhost:3000"`) · `validSource` de `tests/unit/env.test.ts` (paso 1, §9 y `epics/01`) · §10 (tabla de variables) · §12 (entorno Local) · gate manual de §20.1 (`http://localhost:3000/api/health`). El E2E usa a propósito otro origen, `http://127.0.0.1:3100` (fila "Puerto de Playwright"): la Fase 0 solo valida `APP_URL`, no sirve con ella | yes |
| Comprobación de ESLint sin advertencias | `.github/workflows/ci.yml` (`- run: pnpm exec eslint --max-warnings 0`, job `check`, justo después de `- run: pnpm lint`) | `pnpm exec eslint --max-warnings 0` | `workspace/.claude/settings.json` (línea 27) y el bloque de §19.3 · especificación de `tests/unit/ci-workflow.test.ts` (§9 paso 16 y E2-T9) · Verify de los 16 pasos de §9, justo después de `pnpm lint` (los mismos 16 arreglos `verify` de `tasks.json` y los bloques Verify de `epics/`) · regla 11 de §9 · §12 CI/CD (lista y "Qué ejecuta el CI") · §20.1 (bloque ejecutable, prosa y bloque de lo congelado) · línea Gate y cierre de ambas épicas | yes |
| Identidad de git | Bootstrap de §10, bloque 0 (`git var GIT_AUTHOR_IDENT … && git var GIT_COMMITTER_IDENT …`) | `git var GIT_AUTHOR_IDENT` y `git var GIT_COMMITTER_IDENT` | `workspace/.claude/settings.json` (líneas 42 y 43: `Bash(git var GIT_AUTHOR_IDENT:*)` y `Bash(git var GIT_COMMITTER_IDENT:*)`) y el bloque de §19.3 · §10 Prerequisites (fila git) · §20.2 (riesgo) · §20.3 fila 22 · y, sin repetir el comando, la regla 9 de §9 ("bloque 0"), §1 (Hechos de entorno) y `epics/01` (Estado de partida: "`git var`") | yes |
| Comandos de calidad de `package.json` | `package.json` (`lint`: `eslint`; `typecheck`: `tsc --noEmit`; `format:check`: `prettier --check .`; `build`: `next build`) | `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build` | `ci.yml` (las cuatro, job `check`) · `settings.json` y §19.3 · Verify de §9 (`lint`, `typecheck` y `format:check` en los 16 pasos; `build` en los pasos 9 a 14 y 16), con `tasks.json` y `epics/` · especificación de `ci-workflow.test.ts` · §12 · §20.1 · `CLAUDE.md` §11 (`lint`, `typecheck`, `format:check`) y §4 (`lint`, `typecheck`, `build`) | yes |
| Comandos de base de datos de `package.json` | `package.json` (`db:up`: `docker compose up -d --wait`; `db:down`: `docker compose down`; `db:deploy`: `prisma migrate deploy`; `db:seed`: `prisma db seed`) | `pnpm db:up`, `pnpm db:down`, `pnpm db:deploy`, `pnpm db:seed` | `settings.json` y §19.3 (las cuatro) · Bootstrap de §10 (`db:up`, `db:deploy`) · §20.1 (`db:up`, `db:deploy`, `db:seed`) · `ci.yml` (solo `db:deploy`: el servicio de Actions reemplaza a `db:up`) y §12 · Verify del paso 8 (`db:seed` dos veces) · `CLAUDE.md` §11 (`db:deploy`, `db:down`) · secuencia de primer arranque del README del paso 16 (`db:up`, `db:deploy`, `db:seed`) | yes |
| Instalación del navegador de Playwright en CI | `.github/workflows/ci.yml` (`- run: pnpm exec playwright install --with-deps chromium`, job `e2e`) | `pnpm exec playwright install --with-deps chromium` | especificación de `ci-workflow.test.ts` (§9 paso 16 y E2-T9) · criterio 3 del paso 16 (§9, `tasks.json`, `epics/02`) · nota "En Linux de CI" del paso 14 · §12 | yes |
| Instalación del navegador de Playwright en local | paso 14, bloque `Do` de §9 (`pnpm exec playwright install chromium`) | `pnpm exec playwright install chromium` | `settings.json` y §19.3 · §20.1 (bloque ejecutable) · README del paso 16 (comandos de pruebas) · `epics/02` (E2-T7) | yes |
| Identificadores de commit del repo | el historial de git del repo (`git log`) | `6ea1527` (decisiones de `allowBuilds`), `b1cabde` (las cuatro skills), `fca87b5` (Docker, entorno y esquema Prisma), `1e1430f` (scaffold y documentos; trae `find-skills`) | cabecera y §1 (Current state) · §10 (Prerequisites y "Antes del Bootstrap") · §11 (procedencia) · §18 · §19.1 (`fca87b5`) · §20.2 y §20.3 (`6ea1527`) · `epics/` (solo `6ea1527`) | yes |
| Decisiones de `allowBuilds` | `pnpm-workspace.yaml` del repo | `"@prisma/engines": false`, `esbuild: false`, `prisma: false`, `sharp: false`, `unrs-resolver: false` | las cinco en §1 (Current state y Non-Goals), §11 (intro) y §20.3 fila 20 · las tres que añadió `6ea1527` (`prisma`, `@prisma/engines`, `esbuild`) en §10, §20.2 y `epics/` | yes |
| Postgres local: usuario, bases y URL | `.env.example` (`POSTGRES_USER=boutique`, `POSTGRES_DB=boutique_pos`, `POSTGRES_PASSWORD=change-me-local-only`, `DATABASE_URL=postgresql://boutique:change-me-local-only@localhost:5432/boutique_pos?schema=public`) | `boutique`, `boutique_pos`, `change-me-local-only` y la URL de pruebas `postgresql://boutique:change-me-local-only@localhost:5432/boutique_pos_test?schema=public` | Bootstrap de §10 (`DATABASE_URL_TEST` en `.env.example`) · §10 (tabla de variables) · §19.6 (servicios, punto 2) · comando G2 (`-U boutique`) · `ci.yml` usa a propósito el mismo usuario y las mismas bases con la contraseña desechable `ci-password` | yes |
| Extensiones de Postgres | `docker/postgres/init/01-extensions-and-test-db.sh` (`CREATE EXTENSION IF NOT EXISTS pg_trgm;` y `… unaccent;`) | `pg_trgm`, `unaccent` | `ci.yml` (paso `psql` de los dos jobs: las mismas dos sentencias) y `epics/02` (E2-T9) · §1 (Servicios locales) | yes |
| Zona horaria | `src/lib/env.ts` (congelado: `TZ` con valor por defecto `America/Tegucigalpa`) | `America/Tegucigalpa` | `.env.example` (`TZ=America/Tegucigalpa`) · `ci.yml` (`TZ: America/Tegucigalpa`) · `src/lib/dates.ts` (`APP_TIME_ZONE`, paso 3) · prueba de `parseEnv` del paso 1 · §10 (tabla de variables) · §1 | yes |
| Pines de las dependencias nuevas | §11 (tablas de dependencias) | `vitest@5.0.5`, `@vitest/coverage-v8@5.0.5`, `vite@8.3.5`, `@types/node@24.19.2`, `@node-rs/argon2@2.2.2`, `@tanstack/react-table@8.21.3`, `@playwright/test@1.64.1`, `shadcn@4.22.1` | comandos `pnpm add` y `pnpm dlx` de los pasos 1, 6, 10 y 14 (§9) · las mismas cadenas exactas en `permissions.allow` (`settings.json` y §19.3) · `grep -qF '"<paquete>": "<versión>"' package.json` de los Verify (`tasks.json` y `epics/`: `vitest`, `@node-rs/argon2`, `@tanstack/react-table` y `@playwright/test`) | yes |
| Versiones congeladas | `package.json` y `pnpm-lock.yaml` del repo | `next` 16.4.2 · `react` y `react-dom` 19.3.0 · `prisma`, `@prisma/client` y `@prisma/adapter-pg` 7.10.1 · `zod` 4.6.7 · `tailwindcss` 4.3.3 | §1 (Current state y Non-Goals) · §11 (tabla "Ya instaladas en el repo y congeladas") · §20.1 (greps de `next`, `react` y `prisma` en `package.json`) · `epics/` (Stack) · regla 8 de §9 (la ruta `next@16.4.2_*` de las guías) | yes |
| Cargador del entorno de las herramientas independientes | `prisma.config.ts` del repo (primera línea) | `import "dotenv/config";` | primera línea de `workspace/vitest.config.ts`, `workspace/tests/integration/global-setup.ts` y `workspace/tests/integration/helpers/db.ts` · `prisma/seed.ts` (paso 8) · §10 (párrafo de carga del entorno) · §19.6 (filas de esos archivos y tabla de herramientas que leen variables) | yes |
| Invocación del script de humo | `workspace/scripts/smoke-server.ts` (uso: `<start\|dev> <puerto> <ruta=estado[:texto]>…`) | `pnpm exec tsx scripts/smoke-server.ts` | `settings.json` y §19.3 (`Bash(pnpm exec tsx scripts/smoke-server.ts:*)`) · Verify de los pasos 9, 12 y 14 (`tasks.json`, `epics/`) · §20.1 (dos líneas) · §19.6 (fila propia y matriz de resolución) · `epics/02` (tabla de comandos) | yes |
| Línea de exclusión de Tailwind | Bootstrap de §10 (añade a `src/app/globals.css` la línea) | `@source not "../../blueprints";` | paso 11 en §9 (Do y Verify), `tasks.json` E2-T4 y `epics/02` E2-T4 · §19.6 ("Configuración existente que el Bootstrap edita") | yes |
| Archivos de prueba que citan los gates | el paso que los crea (columna `Touches` del mapa de §9) | `tests/unit/money.test.ts` (paso 4), `tests/unit/money-allocate.test.ts` (paso 5), `tests/integration/invariants.test.ts` (paso 15) | §20.1 (`grep` y `test -f`) · pasos 4, 5 y 15 de §9 · `files` de `tasks.json` · `epics/` | yes |
| Textos de interfaz citados en criterios y gates | `src/config/messages.es.ts` (`nav.home` y `home.title` = `Inicio`; `states.notFound.title` = `No encontramos esa página`; `common.retry` = `Reintentar`; `dev.gallery.money.label` = `Monto`; `dev.gallery.table.sampleDress` = `Vestido floral`) | `Inicio`, `No encontramos`, `Reintentar`, `Monto`, `Vestido floral` | criterios de los pasos 12 y 14 (§9, `tasks.json`, `epics/02`) · agujas de `smoke-server` (pasos 9, 12 y 14 y §20.1) · especificaciones E2E del paso 14 (leen `messages`) · fila de agujas de la tabla *Byte-exact artifact reconciliation* | yes |
| Tokens de color | `src/app/globals.css` (lo escribe el paso 11) | `--background: #faf8f5`, `--primary: #3f6350`, `--destructive: #b42318` (claros) y `--background: #16140f`, `--primary: #8db59f` (oscuros), dentro de 30 tokens claros y 30 oscuros | §7 (tablas de tokens, mismos 30 + 30 valores) · bloques CSS del paso 11 en §9 y de E2-T4 en `epics/02` (`:root` y `.dark` en un solo bloque, mismos valores) · Verify del paso 11 (cinco `grep -qiF`) · criterio 1 del paso 11 (hex en mayúsculas) | yes |

**Comandos de confirmación de la columna "Runtime call" (G1 a G3).** Se ejecutan una sola vez, sobre las versiones fijadas de §11, antes de entregar el bundle (la tabla marca la mitad de blueprint como confirmada; estos comandos confirman la mitad del motor). No son gates de §9:

```bash
# G1 — fechas (Node 24; no necesita dependencias del proyecto). Esperado, una línea: day=22 hour=23 minute=30 month=10 second=00 year=2026
node -e 'const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/Tegucigalpa",hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).formatToParts(new Date("2026-10-23T05:30:00.000Z"));console.log(p.filter(x=>x.type!=="literal").map(x=>x.type+"="+x.value).sort().join(" "))'
# G2 — mensaje del trigger (con la BD de Docker arriba y migrada). Esperado en stderr: ERROR:  La tabla "AuditLog" es de solo inserción: UPDATE no permitido  (las sentencias equivalentes se ejecutaron el 2026-10-25 en Postgres 16.15 dentro de una transacción sin confirmar: el mensaje coincide exactamente y le sigue `CONTEXT:  PL/pgSQL function prevent_row_mutation() line 3 at RAISE`)
docker compose exec -T db psql -U boutique -d boutique_pos_test -v ON_ERROR_STOP=1 -c "INSERT INTO \"AuditLog\" (id, action, \"entityType\", \"entityId\") VALUES ('g2', 'SALE_VOIDED', 'Sale', 'g2')" -c "UPDATE \"AuditLog\" SET reason = 'x' WHERE id = 'g2'"
docker compose exec -T db psql -U boutique -d boutique_pos_test -c 'TRUNCATE "AuditLog"'
# G3 — hash (en una carpeta temporal con `pnpm add @node-rs/argon2@2.2.2` hecho). Esperado: $argon2id$v=19$m=19456,t=2,p=1
node -e 'require("@node-rs/argon2").hash("x",{algorithm:2,version:1,memoryCost:19456,timeCost:2,parallelism:1}).then(h=>console.log(h.slice(0,30)))'
```
(En G1 el `sort()` fija el orden alfabético de las partes, independiente del motor.) **Estado:** G1, G2 y G3 ya se ejecutaron y devolvieron exactamente lo esperado. G1 y G3 en la sesión de diseño (`day=22 hour=23 minute=30 month=10 second=00 year=2026` y `$argon2id$v=19$m=19456,t=2,p=1`). G2 el 2026-10-25 sobre Postgres 16.15 (docker compose, base migrada): el hilo principal ejecutó las sentencias equivalentes (`BEGIN; INSERT …; UPDATE …;`) en una sola sesión, dentro de una transacción sin confirmar que se revirtió al salir; el `INSERT` en `AuditLog` funcionó y el `UPDATE` produjo `ERROR:  La tabla "AuditLog" es de solo inserción: UPDATE no permitido` seguido de `CONTEXT:  PL/pgSQL function prevent_row_mutation() line 3 at RAISE`, y no quedó ninguna fila (0 persistidas). El comando documentado arriba, con dos banderas `-c`, usa autocommit: su `INSERT` sí se confirma y lo elimina el `TRUNCATE` de la línea siguiente; esa forma no es la que se ejecutó. Lo único que sigue sin conocerse de antemano es cómo envuelve ese texto Prisma 7 con `@prisma/adapter-pg`; lo confirma la corrida del paso 7 y el regex `/solo inserción|23001/` lo tolera. Para G2 los nombres `boutique` y `boutique_pos_test` son los de `.env.example`.

El contrato entre `playwright.config.ts` y la galería (variable, ruta y puerto) existe por primera vez en el paso 14 y es ahí donde se ejerce: el Verify del paso 14 comprueba el 404 sin la variable y el E2E comprueba la galería con ella. El contrato entre `vitest.config.ts`, `global-setup.ts` y la BD de pruebas se ejerce en el paso 7. Los contratos `route.ts` ↔ `smoke-server.ts` se ejercen en el paso 9.

#### Byte-exact artifact reconciliation

| Byte-exact artifact | Authored by | First diffed at | Blueprint rules that constrain it | Runtime call that produces it, on the §11 pin | Both confirmed |
|---|---|---|---|---|---|
| Literales de `tests/unit/dates.test.ts` (`2026-10-22`, `2026-10-22T06:00:00.000Z`, `23/10/2026 00:00`, `31/12/2025 18:00`, …) | paso 3 | paso 3 | `CLAUDE.md` §1 y §6.10 (zona `America/Tegucigalpa`, UTC en BD); desfase fijo UTC−6 sin horario de verano en 2025 a 2028; formatos `YYYY-MM-DD` y `DD/MM/YYYY HH:mm` en 24 h definidos en el paso 3 | `Intl.DateTimeFormat("en-US", { timeZone: "America/Tegucigalpa", hourCycle: "h23", … }).formatToParts(new Date("2026-10-23T05:30:00.000Z"))` devuelve `month` 10, `day` 22, `year` 2026, `hour` 23, `minute` 30, `second` 00 (comando G1 de abajo); la implementación normaliza la hora `24` a `0`, así que el literal `00:00` no depende del motor | yes — (1) derivado a mano campo por campo; (2) G1 lo confirma sobre Node 24 antes de enviar |
| Literales de `money.test.ts`, `money-allocate.test.ts` y `format.test.ts` (`106609`, `15991`, `[34, 33, 33]`, `[3225, 3175]`, `L 1,234.50`, `−L 64.00`, …) | pasos 4 y 5 | pasos 4 y 5 | política de redondeo del paso 4 (mitad hacia afuera del cero, una vez); mayor residuo con empate al índice más bajo (paso 5); `docs/PRD.md` §7 (ISV 15 % incluido); `docs/UX.md` §8 (`L 1,234.50`) | ninguna: aritmética entera pura, sin cadenas que produzca el motor (el formato lo ensambla `format.ts`) | yes |
| Regex `/solo inserción\|23001/` de `tests/integration/audit.test.ts` | paso 7 | paso 7 | el mensaje lo define la migración `constraints` (`La tabla "%" es de solo inserción: % no permitido`, SQLSTATE `restrict_violation` = 23001); §4 | el texto que muestra Prisma 7 sobre `@prisma/adapter-pg` al rechazar un `UPDATE` crudo no se conoce de antemano; el regex acepta el mensaje de la BD o su código, y el comando G2 muestra el mensaje real de la BD | yes — (1) mensaje y código leídos de la migración; (2) G2 ejecutado el 2026-10-25 en Postgres 16.15 con las sentencias equivalentes `BEGIN; INSERT; UPDATE` en una sola sesión (transacción revertida al salir, 0 filas persistidas): `ERROR:  La tabla "AuditLog" es de solo inserción: UPDATE no permitido` seguido de `CONTEXT:  PL/pgSQL function prevent_row_mutation() line 3 at RAISE`; la forma documentada con `-c` confirma el `INSERT` y lo elimina el `TRUNCATE` siguiente; el envoltorio de Prisma 7 sobre `@prisma/adapter-pg` lo confirma el paso 7 (el regex lo tolera) |
| `startsWith("$argon2id$")` de `tests/unit/password.test.ts` | paso 6 | paso 6 | paso 6 (Argon2id, `algorithm: 2`) | `hash("x", { algorithm: 2, version: 1, memoryCost: 19456, timeCost: 2, parallelism: 1 })` de `@node-rs/argon2` 2.2.2 empieza con `$argon2id$v=19$m=19456,t=2,p=1` (comando G3); un valor numérico equivocado del enum produce `$argon2d$` o `$argon2i$` y la prueba falla a propósito | yes — (1) formato PHC; (2) G3 lo confirma con la versión fijada |
| Agujas de humo (`ok`, `Inicio`, `No encontramos`) y textos E2E | pasos 9, 12, 14 | pasos 9, 12, 14 | `src/config/messages.es.ts` (paso 2) es la fuente; el 404 usa `messages.states.notFound.title` | HTML producido por el código del propio proyecto, no por un motor externo | yes |

---

## 20. Acceptance Gate, Risks & Decision Log

### 20.1 Global acceptance gate

La Fase 0 está **terminada** cuando cada comando de abajo sale con código 0 en un clon limpio con el Bootstrap de §10 ya ejecutado (Docker arriba), y no antes. Reproduce los criterios de aceptación de `docs/ROADMAP.md` (Fase 0): el arranque desde un clon limpio, `lint`, `typecheck` y `test` en verde, las pruebas de `money.ts` (redondeo, ISV incluido del 15 % y prorrateo de descuento sin perder centavos), el archivo del invariante de stock y el CI.

```bash
pnpm install --frozen-lockfile        # expect: exit 0
pnpm db:generate                      # expect: exit 0 — el cliente de Prisma no se versiona
pnpm db:up                            # expect: exit 0 — vuelve cuando Postgres pasa su healthcheck
pnpm db:deploy                        # expect: exit 0
pnpm db:seed                          # expect: exit 0 — idempotente
pnpm lint                             # expect: exit 0
pnpm exec eslint --max-warnings 0     # expect: exit 0 — cero advertencias: ninguna advertencia tolerada se vuelve permanente
pnpm exec next typegen                # expect: exit 0 — los tipos de rutas (.next/types, next-env.d.ts) están en .gitignore: en un clon limpio solo existen si se generan antes de typecheck
pnpm typecheck                        # expect: exit 0
pnpm format:check                     # expect: exit 0 — corrido desde la raíz con el bundle presente
pnpm test                             # expect: exit 0 — proyectos unit e integration; los it.todo no son fallos
out=$(mktemp) && pnpm test:coverage > "$out" && grep -q 'money.ts' "$out"
                                      # expect: exit 0 — umbrales por archivo de money.ts vigentes y medidos
pnpm build                            # expect: exit 0
pnpm exec tsx scripts/smoke-server.ts start 3190 /api/health=200:ok /=200:Inicio '/ruta-que-no-existe=404:No encontramos' /dev/componentes=404
                                      # expect: exit 0 — next start sirve la app compilada: health, inicio, 404 y galería oculta sin la variable
pnpm exec tsx scripts/smoke-server.ts dev 3191 /api/health=200:ok /=200:Inicio
                                      # expect: exit 0 — `next dev` arranca de verdad (el mismo arranque que `pnpm dev`): /api/health responde 200 con `ok` y `/` 200 con `Inicio` (el script mata el árbol de procesos al terminar)
pnpm exec playwright install chromium # expect: exit 0
pnpm test:e2e                         # expect: exit 0 — Playwright reconstruye con la variable de la galería y corre las dos especificaciones
grep -qF 'extractTax' tests/unit/money.test.ts            # expect: exit 0 — ISV incluido cubierto
grep -qF 'percentOf' tests/unit/money.test.ts             # expect: exit 0 — redondeo cubierto
grep -qF 'prorateDiscount' tests/unit/money-allocate.test.ts   # expect: exit 0 — prorrateo cubierto
test -f tests/integration/invariants.test.ts              # expect: exit 0 — el archivo del invariante existe
test -f .github/workflows/ci.yml                          # expect: exit 0 — el CI existe
```

**Cada línea sale con 0 en una construcción correcta** y cada expectativa es una propiedad, no un conteo. Ninguna línea trata "sale distinto de 0" como éxito: las comprobaciones de ausencia usan `status=0; cmd || status=$?; test "$status" -eq 1` (1 = sin coincidencias; 2 = error de uso, y eso falla). **El CI no ejecuta esta puerta completa:** ejecuta solo los comandos que lista §12 (CI/CD): instalación, generación del cliente, bases, `db:deploy`, `lint`, `pnpm exec eslint --max-warnings 0`, `pnpm exec next typegen`, `typecheck`, `format:check`, `test`, `test:coverage`, `build` y, en `main`, `test:e2e`. Las líneas `pnpm db:up`, `pnpm db:seed` suelto, las dos de `smoke-server`, las comprobaciones de `grep`/`test -f` y los gates manuales de abajo solo se corren en local.

Más estos gates manuales, la lista de lanzamiento, cada uno una sola vez antes de lanzar:

- [ ] La etiqueta del Bootstrap y las 16 etiquetas de checkpoint existen en git (una por paso de §9; el repositorio y la etiqueta `bootstrap-fase-0` los crea el Bootstrap de §10). Cada línea sale con 0:

```bash
git rev-parse --verify --quiet refs/tags/bootstrap-fase-0
git rev-parse --verify --quiet refs/tags/step-01-vitest
git rev-parse --verify --quiet refs/tags/step-02-errors-messages
git rev-parse --verify --quiet refs/tags/step-03-dates
git rev-parse --verify --quiet refs/tags/step-04-money-core
git rev-parse --verify --quiet refs/tags/step-05-money-allocate-format
git rev-parse --verify --quiet refs/tags/step-06-permissions-password
git rev-parse --verify --quiet refs/tags/step-07-audit-integration
git rev-parse --verify --quiet refs/tags/step-08-seed
git rev-parse --verify --quiet refs/tags/step-09-health
git rev-parse --verify --quiet refs/tags/step-10-ui-primitives
git rev-parse --verify --quiet refs/tags/step-11-design-tokens
git rev-parse --verify --quiet refs/tags/step-12-app-shell
git rev-parse --verify --quiet refs/tags/step-13-shared-components
git rev-parse --verify --quiet refs/tags/step-14-playwright
git rev-parse --verify --quiet refs/tags/step-15-invariants-docs
git rev-parse --verify --quiet refs/tags/step-16-ci-readme-close
```

- [ ] Todo archivo que §10 llama "versionado" está en un checkout limpio y ninguna regla de ignorar lo traga (**un solo path por invocación**, para que un fallo sea del archivo y no del comando):

```bash
git ls-files --error-unmatch .env.example
git ls-files --error-unmatch vitest.config.ts
git ls-files --error-unmatch playwright.config.ts
git ls-files --error-unmatch scripts/smoke-server.ts
git ls-files --error-unmatch prisma/seed.ts
git ls-files --error-unmatch .github/workflows/ci.yml
git ls-files --error-unmatch .claude/settings.json
git ls-files --error-unmatch pnpm-lock.yaml
git ls-files --error-unmatch blueprints/fase-0-cimientos/blueprint.md
status=0; git check-ignore -q .env.example || status=$?; test "$status" -eq 1   # 1 = no ignorado · 128 = uso incorrecto, y eso falla
status=0; git check-ignore -q playwright.config.ts || status=$?; test "$status" -eq 1
status=0; git check-ignore -q .claude/settings.json || status=$?; test "$status" -eq 1
status=0; git check-ignore -q .github/workflows/ci.yml || status=$?; test "$status" -eq 1
status=0; git check-ignore -q .env || status=$?; test "$status" -eq 0           # 0 = ignorado, como debe
test -z "$(git ls-files -ci --exclude-standard)"                                # ningún archivo versionado coincide con una regla de ignorar
```

- [ ] El archivo de ignorar estuvo en su sitio antes del primer commit del Bootstrap, y el Bootstrap quedó antes del paso 1 (cada línea sale con 0):

```bash
git merge-base --is-ancestor bootstrap-fase-0 step-01-vitest   # la etiqueta del Bootstrap es ancestro de la del paso 1; las exclusiones y .gitignore se confirmaron ahí, no en un paso de §9
```

  Una regla de ignorar no afecta a lo que git ya rastrea: por eso `git ls-files -ci --exclude-standard` de arriba debe quedar vacío.
- [ ] Cada fila de la tabla *Byte-exact artifact reconciliation* de §19.6 se confirmó: los comandos G1, G2 y G3 de §19.6 se ejecutaron sobre las versiones fijadas y los literales coinciden (los tres ya se ejecutaron durante el diseño y coincidieron, G2 en su forma equivalente dentro de una transacción; se repiten solo si cambian las versiones fijadas).
- [ ] El bloque de Bootstrap de §10 se volvió a ejecutar una vez sobre el árbol ya inicializado y **salió con 0** (no solo "no cambió nada"): `package.json` conserva todas las dependencias instaladas, `pnpm test:unit` sigue pasando y `git status --porcelain` no muestra cambios nuevos en archivos que un paso editó, la etiqueta `bootstrap-fase-0` sigue apuntando al mismo commit (`git rev-parse bootstrap-fase-0` igual antes y después) y no apareció un segundo commit `chore: bootstrap fase 0` (`git log --format=%s` lo lista a lo sumo una vez). Esto prueba la copia protegida del workspace, el bloque del commit protegido por la etiqueta y que ninguna guarda falla en su camino de "ya existe".
- [ ] Cada fila de la tabla *Cross-artifact value reconciliation* de §19.6 dice `Compared: yes`, y `pnpm lint`, `pnpm format:check` y `pnpm typecheck` se corrieron desde la raíz con el bundle presente.
- [ ] §9.1 no aplica (cambio aditivo, no migración).
- [ ] Ningún no-objetivo de §1 se construyó, y lo congelado sigue igual (cada línea sale con 0):

```bash
test ! -e src/lib/settings.ts
test ! -e src/lib/auth.ts
test ! -e src/modules/inventory/service.ts
test ! -e .storybook
git diff --quiet bootstrap-fase-0 HEAD -- prisma/schema.prisma prisma/migrations   # sin cambios de esquema ni de migraciones desde el Bootstrap
grep -qF '"next": "16.4.2"' package.json
grep -qF '"react": "19.3.0"' package.json
grep -qF '"prisma": "7.10.1"' package.json
pnpm exec eslint --max-warnings 0     # cero advertencias: ninguna advertencia tolerada se vuelve permanente
```

- [ ] En un clon limpio (carpeta nueva), seguir el README literalmente hasta `pnpm dev` levanta la app y `http://localhost:3000/api/health` responde 200 (la parte automatizable es la línea `smoke-server … dev 3191` de arriba; la lectura del README la hace una persona).
- [ ] **Lo que un paso no pudo comprobar con un comando, aquí por nombre:** (1) el workflow de `.github/workflows/ci.yml` en verde en GitHub tras el primer push (`check` en cada PR, `e2e` en `main`); verifica de paso que `psql` existe en `ubuntu-24.04`; (2) antes de cualquier despliegue (Fase 6): rotar las contraseñas y PIN demo y generar un `AUTH_SECRET` propio; (3) recorrido solo con teclado del shell y de la galería, una pasada con lector de pantalla y una a 200 % de zoom a 320 px de ancho (§15); (4) revisión visual del shell contra los tokens de §7 y prueba con una persona de la tienda, con las fricciones anotadas en `docs/UX_FEEDBACK.md` (regla transversal 5 de `docs/ROADMAP.md`).
- [ ] No aplican en esta fase: variables de entorno de producción, E2E contra una URL de producción, seguimiento de errores y un rollback en un entorno de preview (no existen todavía; el rollback de la construcción son las etiquetas).

**No se ignora ninguna advertencia.** Una advertencia tolerada se vuelve permanente y la siguiente real se esconde dentro.

### 20.2 Risk register

| Risk | Likelihood | Impact | Early signal | Mitigation |
|---|---|---|---|---|
| Deriva de redondeo o de prorrateo en dinero | M | H | una prueba de propiedades falla o la cobertura de `money.ts` baja de los umbrales | una sola política (`roundHalfAwayFromZero`), literales derivados a mano y propiedades con 1000 casos (pasos 4 y 5); `pnpm test:coverage` en CI. Responsable: quien construye los pasos 4 y 5 |
| Binario nativo de `@node-rs/argon2` ausente en Windows o Linux | L | H | el `import` de `@node-rs/argon2` falla con "Cannot find module" del paquete de plataforma en el paso 6 | binarios precompilados como `optionalDependencies`; el paso 6 ejecuta el hash en esta máquina; si una plataforma no tiene binario, se registra en §20.3 y se decide el reemplazo con una persona (no se cambia en silencio) |
| Pares de Vitest 5 / Vite 8 / `@types/node` 24, o `ERR_PNPM_IGNORED_BUILDS` por una dependencia con script de instalación | M | H | `pnpm install --frozen-lockfile` falla en el paso 1 (o en el 6, 10 o 14), o ya en el Bootstrap si HEAD no incluye el commit `6ea1527` | `Verify` del paso 1 = instalación congelada + `pnpm test:unit`; el repo ya decide `prisma`, `@prisma/engines` y `esbuild` (commit `6ea1527`, todos `false`; sin él, un clon limpio aborta con `ERR_PNPM_IGNORED_BUILDS`) y las dependencias de esta fase no necesitan entradas nuevas; si pnpm nombra un paquete con script, léelo del error, y solo si hace falta ese script añade `<paquete>: true` en `allowBuilds` de `pnpm-workspace.yaml` con una nota en §20.3; nunca `dangerouslyAllowAllBuilds`. Responsable: quien construye |
| Interacciones de Cache Components | M | M | `next build` falla con "Uncached data was accessed outside of Suspense" o por un segment config | sin `dynamic`, `revalidate` ni `fetchCache`; layout estático; `connection()` en la ruta de salud; `pnpm build` en los gates de los pasos 9 a 13 |
| Base de pruebas desviada, puerto 5432 ocupado o dos pilas de Compose | M | H | `ECONNREFUSED`, o `prisma migrate deploy` apuntando a otra base | el `globalSetup` siempre corre `migrate deploy` sobre `DATABASE_URL_TEST`; `assertTestDatabaseUrl` impide truncar una base que no termine en `_test`; §10 pide detener otras pilas y el Bootstrap no fija nombre de proyecto de Compose |
| Credenciales demo o la galería llegan a producción | L | H | la semilla corre con `NODE_ENV=production`, o `/dev/componentes` responde 200 en un build de producción sin la variable | la semilla se niega a correr en producción; `NEXT_PUBLIC_COMPONENT_GALLERY` solo la define `playwright.config.ts` y el paso 14 verifica el 404 sin ella; rotación en la lista de lanzamiento de §20.1 |
| Divergencia entre TanStack Table v8 y v9 | M | L | la documentación de `data-table` de shadcn pasa a apuntar a v9 | v8 fijado con versión exacta y registrado en `docs/ARCHITECTURE.md` §12; reevaluar con el disparador de §20.3 fila 2 |
| `next/font/google` necesita red durante `next build` | M | M | `pnpm build` falla al descargar Inter en un entorno sin red | el CI y las máquinas de desarrollo tienen red; si hace falta construir sin red, pasar a `next/font/local` con los archivos de Inter descargados (decisión a documentar en §20.3) |
| El alcance crece: se añaden pantallas o módulos de negocio | M | M | aparece una ruta fuera de `/`, `/dev/componentes` y `/api/health`, o un archivo de `src/modules` | la tabla de no-objetivos de §1 y la regla "el builder no implementa nada de esa tabla"; el test de arquitectura y el gate de §20.1 comprueban lo congelado |
| La máquina no tiene identidad de git (ni `user.name`/`user.email` ni `GIT_AUTHOR_*`/`GIT_COMMITTER_*`) | M | H | `git commit` muere con "Author identity unknown" en el Bootstrap o en el primer Checkpoint | el bloque 0 del Bootstrap (§10) comprueba `git var GIT_AUTHOR_IDENT` y `git var GIT_COMMITTER_IDENT` antes de cualquier commit y se detiene con la instrucción para configurarla; sale con 0 cuando hay identidad, también en la segunda ejecución |
| Aviso de Vite en cada corrida de Vitest: «(!) Your Vite config uses features that are unsupported by `configLoader: 'native'` … ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1)» | H | L | aparece en toda salida de `pnpm test*`, con código de salida 0 y sin pruebas fallidas | es esperado e inocuo en esta fase y no se corrige a propósito (renombrar a `vitest.config.mts` o añadir `"type": "module"` toca nombres y campos congelados; §19.6 y §20.3 fila 21); solo importaría si una versión futura de Vite o Vitest lo vuelve un error. Responsable: quien construye |

### 20.3 Decision log

| # | Decision | Rejected alternative | Why | Would reverse if |
|---|---|---|---|---|
| 1 | El lockfile del repo manda sobre el track `ts-node.md`: ESLint + Prettier, TypeScript 5.9.3, React 19.3.0, pnpm 12.15.0 | pasar a Biome, TypeScript 6 y React 19.3.1 dentro de la Fase 0 | la regla 3 de brownfield: no se mezcla una migración de herramientas con los cimientos | se aprueba un cambio aparte de herramientas |
| 2 | TanStack Table 8.21.3 (versión exacta) | TanStack Table 9.3.1 | v9 es una reescritura y no se verificó la guía de `data-table` de shadcn para v9; v8 no está deprecada | la documentación de shadcn para `data-table` apunta a v9 |
| 3 | `@types/node` en la línea 24 (24.19.2), exacto | dejar `^20` o saltar a la línea 26 (el `latest`) | Vitest 5 exige `^22` o `>=24`; el runtime es Node 24 | el runtime sube de mayor |
| 4 | Inter vía `next/font/google` reemplaza a Geist | conservar Geist | `docs/UX.md` §8 pide Inter con cifras tabulares para dinero | la marca define otra tipografía |
| 5 | Galería `/dev/componentes` + Playwright para ejercer los componentes; en producción responde 404 salvo `NEXT_PUBLIC_COMPONENT_GALLERY=enabled` en el build (solo `playwright.config.ts` lo define). Los textos de la galería viven en `messages.dev.gallery` | Storybook o jsdom; o proteger la galería solo con `NODE_ENV` (imposible: el E2E corre contra el build de producción) o correr el E2E sobre `next dev` | un solo mecanismo, sin dependencias nuevas, y el E2E ejerce el mismo build que se desplegará | los componentes compartidos pasan de 15 o el E2E migra a `next dev` |
| 6 | `CLAUDE.md` y `AGENTS.md` se copian con una marca (`fase-0-blueprint`) en lugar de fusionarse a mano; `CLAUDE.md` conserva su orden (comandos en la sección 4) | reescribir `CLAUDE.md` con los comandos primero; enlazar `AGENTS.md` con un symlink | la convención del repo gana; la marca hace la copia segura de repetir (el paso 16 edita `CLAUDE.md`); un symlink no es seguro con checkouts en Windows | `CLAUDE.md` supera las 200 líneas o el equipo pide comandos primero |
| 7 | No hay CHECK `onHand >= 0` en BD; el stock no negativo se valida en `inventory.recordMovement` | CHECK en la migración | el stock negativo es una opción de configuración (`sales.allowNegativeStock`) | se decide eliminar esa opción de configuración |
| 8 | Vitest con proyectos `unit` e `integration`; la integración usa Postgres real (`boutique_pos_test`), `globalSetup` con `migrate deploy` y una guardia de nombre `_test` | mocks de BD; contenedores efímeros por corrida | `CLAUDE.md` §7 exige Postgres real para dinero y stock; la guardia evita truncar la base equivocada | el CI no puede ofrecer un servicio Postgres |
| 9 | `@node-rs/argon2` con Argon2id y valores numéricos explícitos (`algorithm: 2`, `version: 1`) | `argon2` (node-gyp); bcrypt; usar los `const enum` del paquete | binarios precompilados; `isolatedModules` prohíbe los `const enum` ambientales | falta un binario para una plataforma de despliegue |
| 10 | Redondeo a la mitad alejándose de cero, una vez por valor; porcentajes en puntos base; reparto por mayor residuo con empate al índice más bajo | redondeo bancario; redondear cada parte por separado | `docs/ARCHITECTURE.md` §6: "el redondeo se hace una sola vez por línea con política documentada"; la suma de las partes debe ser el total | el contador o el SAR exigen otra regla (`docs/DECISIONS_PENDING.md` #6) |
| 11 | Fechas con `Intl.DateTimeFormat#formatToParts` y cadenas ensambladas a mano, normalizando la hora `24` a `0` | `date-fns-tz` o aritmética con desfase fijo | sin dependencias; la zona IANA se lee del motor y el literal de medianoche no depende del motor | se necesitan reglas de calendario que `Intl` no ofrece |
| 12 | `ROLES` se duplica en `permissions.ts` y una prueba lo compara con el enum `Role` de Prisma | importar el enum generado en la librería pura | mantiene `permissions.ts` sin dependencia del cliente generado | importar `src/generated` se vuelve gratuito en todos los contextos |
| 13 | `toActionResult` recibe el diccionario de mensajes por inyección | mensajes dentro de `errors.ts` | los textos de interfaz viven solo en `messages.es.ts` (`CLAUDE.md` §7) | se añade un segundo idioma |
| 14 | `playwright.config.ts` se copia en el paso 14 y no en el Bootstrap | copiarlo en el Bootstrap | con el archivo en la raíz, `pnpm typecheck` de los pasos 1 a 13 falla (`@playwright/test` no existe todavía) | `@playwright/test` pasa a instalarse en el Bootstrap |
| 15 | La contraseña (`password.ts`) va en el paso 6 con permisos, y la UI se reparte en los pasos 10 a 14 (primitivas, tokens, shell, componentes compartidos, galería con Playwright) | el reparto de la primera versión de 15 pasos (contraseña dentro de la semilla; primitivas y tokens en un solo paso `ui-foundation`; un solo paso para todo el shell y los componentes) | el límite de 5 archivos por paso; una puerta por paso | el límite de archivos por paso cambia |
| 16 | La copia del workspace es un bucle `find … while read` | `rsync -a --ignore-existing`; `cp -Rn … \|\| true` | `rsync` no viene con Git para Windows; `cp -Rn` sale con 1 en BSD/macOS y rompería la segunda ejecución con `set -e` | el entorno de construcción garantiza `rsync` |
| 17 | Decisiones heredadas que no se reabren: Postgres 16 + Prisma, Auth.js en la Fase 1, hosting en la Fase 6, Tailwind + shadcn, Zustand en la Fase 3 | cualquier cambio de pila en la Fase 0 | `CLAUDE.md` §3 y `docs/ARCHITECTURE.md` §2 ya las deciden | `docs/DECISIONS_PENDING.md` cambia una respuesta de fondo |
| 18 | Las primitivas de UI (paso 10) y los tokens de diseño con Inter (paso 11) son dos pasos; el de primitivas depende solo de los pasos 1 y 2 | un solo paso `ui-foundation` que hacía ambas cosas | el paso combinado juntaba la salida del CLI de shadcn, `package.json`, `globals.css` y `layout.tsx` con seis criterios y dos puertas distintas; separados, cada uno cabe en una sentada y la dependencia de cada uno es verdadera | el límite de archivos por paso cambia |
| 19 | El Bootstrap marca su commit con la etiqueta `bootstrap-fase-0` (se crea solo si falta) y las puertas de §20.1 leen esa etiqueta | localizar el commit con `git log --grep` | el mensaje puede no existir (si no había nada que confirmar) y repetirse en una segunda ejecución; la etiqueta es única y hace que el bloque del commit no se repita | el Bootstrap deja de crear commits |
| 20 | `prisma`, `@prisma/engines` y `esbuild` quedan en `false` en `allowBuilds` (commit `6ea1527`), igual que `sharp` y `unrs-resolver`; esta fase no añade entradas | `true` para esos paquetes; `dangerouslyAllowAllBuilds` | privilegio mínimo y es el estado con el que el repo ya funcionaba: pnpm 12 solo exige una decisión explícita, y con `false` `pnpm install --frozen-lockfile` termina con 0 y `prisma generate`, `prisma migrate deploy` y `tsx` funcionan (comprobado en un clon limpio con Postgres 16.15) | una dependencia necesita de verdad su script de instalación (por ejemplo un binario que solo ese script descarga) |
| 21 | El aviso de Vite sobre `configLoader: 'native'` (ESM en un archivo cargado como CommonJS, `vitest.config.ts:1:1`) se acepta en la Fase 0: no se renombra `vitest.config.ts` ni se añade `"type"` a `package.json` | renombrar a `vitest.config.mts`; añadir `"type": "module"` | el aviso sale con código 0 y no falla nada; el nombre `vitest.config.ts` aparece en los gates, el bundle y la documentación, y el campo `type` ausente es parte del repo congelado: cambiar el modo de módulos de todo el paquete por un aviso inocuo cambia cómo cargan los demás archivos | el aviso se vuelve error en una versión futura de Vite o Vitest, o el equipo decide pasar el proyecto a ESM en un cambio aparte |
| 22 | El Bootstrap comprueba la identidad de git con `git var GIT_AUTHOR_IDENT` y `git var GIT_COMMITTER_IDENT` antes de cualquier commit | `git config user.name` y `git config user.email` | `git config` no ve las variables `GIT_AUTHOR_*` y `GIT_COMMITTER_*` que usan los entornos sin configuración global, mientras que `git var` falla exactamente cuando `git commit` no podría determinar la identidad | el builder deja de hacer commits |

### 20.4 What to build next

1. **Fase 1 — acceso y configuración:** Auth.js con credenciales y PIN rápido, sesiones en BD, `src/lib/settings.ts` y la pantalla de configuración. Disparador: la puerta de §20.1 en verde.
2. **Fase 1 — catálogo con variantes:** productos, tallas, colores y carga inicial, usando `DataTable`, `MoneyInput`, `PageHeader` y `messages.es.ts`. Disparador: Auth.js y `settings.ts` listos.
3. **Fase 2 — inventario:** `inventory.recordMovement` en `src/modules/inventory/service.ts`, que activa el test de arquitectura y el invariante 1 con datos reales. Disparador: catálogo cargado.
4. **Fase 6 — endurecimiento:** interruptor de modo oscuro (tokens ya definidos), `pnpm audit` en CI, seguimiento de errores y despliegue; rotación de credenciales demo. Disparador: las Fases 1 a 5 cerradas.
5. **Fase 5 — semilla grande y reportes:** productos y ventas de demostración para probar volumen. Disparador: ventas y reportes construidos.

---

*End of blueprint. Build order is §9. Stop when §20.1 is green.*

