# Boutique POS — Contexto para Claude Code

> Este archivo lo lee Claude Code al iniciar cada sesión. Mantenlo corto y actualizado.
> Detalle completo en `docs/`. Si algo aquí contradice a `docs/`, gana este archivo y hay que corregir el otro.

<!-- fase-0-blueprint -->

## 1. Qué es este proyecto

Sistema de **inventario + punto de venta (POS)** para una **boutique de ropa** (una tienda hoy, preparado para varias sucursales mañana).
Prioridades, en este orden: **(1) que sea fácil e intuitivo para cajeros sin experiencia técnica, (2) que nunca pierda ni descuadre datos de dinero e inventario, (3) que sea rápido en mostrador.**

Idioma: **la interfaz está en español (es-HN)**; el código, los identificadores, commits y nombres de tablas están en **inglés**.
Moneda: Lempira (HNL, símbolo `L`). Zona horaria: `America/Tegucigalpa`.

## 2. Estado actual

- [x] Fase 0 — Cimientos (2026-10-25)
- [x] Fase 1 — Acceso, configuración y catálogo (2026-10-26)
- [x] Fase 2 — Inventario y compras (2026-10-26)
- [x] Fase 3 — Caja y punto de venta (2026-10-26)
- [x] Fase 4 — Devoluciones, cambios, apartados, crédito de tienda (2026-10-27)
- [x] Fase 5 — Clientes, reportes y dashboard (2026-10-27)
- [x] Fase 6 — Endurecimiento y despliegue, lo imprescindible (2026-10-30); lo opcional (modo sin internet, ESC/POS, varias sucursales, modo oscuro) queda para la Fase 7

Actualiza esta lista al terminar cada fase (marca `[x]` y agrega la fecha).

## 3. Stack (decidido)

| Capa | Tecnología |
|---|---|
| Framework | Next.js (App Router) + TypeScript estricto |
| UI | Tailwind CSS + shadcn/ui + lucide-react |
| Formularios / validación | React Hook Form + Zod (el mismo schema en cliente y servidor) |
| Tablas | TanStack Table |
| Estado del POS | Zustand (solo el carrito y la UI del POS; el resto es server state) |
| Base de datos | PostgreSQL 16 |
| ORM | Prisma |
| Auth | Sesiones propias en BD (cookie `httpOnly` con token aleatorio; se guarda su hash), credenciales + PIN rápido con Argon2. **No** Auth.js (ver `docs/ARCHITECTURE.md` §12) |
| Tests | Vitest (unidad + integración con BD real) y Playwright (E2E) |
| Gestor de paquetes | pnpm |
| Entorno local | Docker Compose (Postgres) |

Detalle y justificación: `docs/ARCHITECTURE.md`.

## 4. Comandos (se crean en la Fase 0)

```
pnpm dev            # servidor de desarrollo
pnpm build          # build de producción
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit
pnpm test           # Vitest
pnpm test:e2e       # Playwright
pnpm db:up          # docker compose up -d (Postgres)
pnpm db:migrate     # prisma migrate dev
pnpm db:seed        # datos de demo
pnpm db:reset       # reset + migrate + seed (solo local)
pnpm admin:create-owner   # primer arranque de una instalación real: crea al propietario (sin usuarios de demo)
pnpm job:expire-layaways  # tarea diaria: vence apartados con el plazo cumplido
pnpm db:verify         # revisa que los libros cuadran (después de restaurar un respaldo; VERIFY_DATABASE=<base>)
pnpm control:setup     # SaaS: crea (si falta) y migra la base central de la plataforma (ver docs/SAAS_ETAPA_1.md)
pnpm platform:create-admin | platform:reset-2fa | platform:unlock | platform:gen-key | platform:rotate-key   # SaaS: superadministradores y llave maestra
pnpm platform:adopt-store --slug <subdominio> --name "<negocio>"   # SaaS: registra la tienda en uso (DATABASE_URL) como el negocio #1, sin tocar sus datos (docs/SAAS_ETAPA_2.md)
pnpm platform:suspend <subdominio> | platform:reactivate <subdominio> | platform:tenants   # SaaS: estado de los negocios
pnpm job:expire-layaways --all     # con TENANCY_MODE=multi: recorre todos los negocios (los demás comandos de negocio llevan --tenant <subdominio>)
pnpm tenants:provision | tenants:resume <s> | tenants:undo <s> | tenants:migrate | tenants:canary <s> on|off | tenants:reconcile | tenants:delete <s> | tenants:cancel-delete <s> | tenants:archive <s>   # SaaS: alta, actualización y baja de negocios (docs/SAAS_ETAPA_3.md)
pnpm billing:sweep | billing:seed-plans | billing:plans | billing:status <s> | billing:assign <s> | billing:pay <s>   # SaaS: planes, suscripciones y cobros; el barrido corre a diario (docs/SAAS_ETAPA_4.md)
pnpm backups:status | backups:list <s> | backups:request <s>|--control | backups:retired | backups:final <base> | backups:drop <base> --confirm <base> | tenants:relink <s>   # SaaS: respaldos por negocio, restauración y borrado guiado (docs/SAAS_ETAPA_5.md)
pnpm usage:collect | usage:show <s> | alerts:check   # SaaS: fotos de uso (solo números) y alertas de la plataforma; corren a diario (RUNBOOK §16)
pnpm tenants:limit-store <s>   # SaaS: le da a la tienda adoptada (#1) su propio rol limitado de base de datos en vez de la cuenta principal (RUNBOOK §17)
pnpm capacity:provision | capacity:run | capacity:http | pgbouncer:setup   # SaaS: pruebas de capacidad con cientos de negocios (SOLO en un servidor desechable, con CAPACITY_CONFIRM=<base central>) y la preparación opcional de PgBouncer (docs/SAAS_ETAPA_6.md)
pnpm tenants:template  # SaaS: deja al día la base plantilla de la que se copia cada negocio nuevo
pnpm test:e2e:platform # SaaS: pruebas de navegador del panel y de dos negocios por subdominio (base central de pruebas)
E2E_TENANCY=multi pnpm test:e2e   # SaaS: las mismas pruebas de la tienda, con la tienda como negocio #1 en tienda.localhost
```

Antes de dar una tarea por terminada deben pasar: `lint`, `typecheck` y `test`.

## 5. Estructura (resumen)

Organización **por módulo de dominio**, no por tipo de archivo:

```
src/app/            rutas (solo composición; sin lógica de negocio)
src/modules/<mod>/  schemas.ts · service.ts · queries.ts · actions.ts · components/
src/components/     ui/ (shadcn), layout/, shared/
src/lib/            db, auth, permissions, money, dates, errors, audit, barcode, print
prisma/             schema.prisma, migrations, seed.ts
tests/              unit/, integration/, e2e/
docs/               documentación (esta carpeta)
```

Flujo de una operación: `página/componente → server action (valida con Zod + permisos) → service (reglas de negocio, transacción) → Prisma`.
**Las páginas y componentes nunca llaman a Prisma directamente.**

## 6. Reglas de dominio INVIOLABLES

Estas reglas existen porque un error aquí descuadra caja o inventario. Si una tarea parece pedir romperlas, detente y pregunta.

1. **Dinero = enteros en centavos** (`priceCents`, `totalCents`). Nunca `float`/`number` con decimales. Todo cálculo pasa por `src/lib/money.ts`. Formateo solo en la capa de presentación.
2. **El stock solo cambia mediante `StockMovement`** creado dentro de una transacción. `StockLevel` es un acumulado que se actualiza en esa misma transacción. Prohibido `update` directo de cantidades.
3. **Las ventas son inmutables.** Se corrigen con devolución, cambio o anulación (con motivo y usuario autorizador). Nunca editar ni borrar una venta cerrada.
4. **Snapshot en cada línea de venta:** precio, costo, descuento e impuesto se copian a `SaleItem` al vender. Cambiar el precio del catálogo no altera ventas pasadas.
5. **Nada con historial se borra.** Productos, variantes, clientes, proveedores y usuarios se **archivan** (`archivedAt`). Borrado físico solo si no tiene ningún movimiento asociado.
6. **Stock no negativo** por defecto. Existe un ajuste de configuración para permitirlo, desactivado de fábrica.
7. **Toda acción sensible genera `AuditLog`:** anulaciones, descuentos sobre el límite, ajustes de inventario, cambios de precio/costo, cierres de caja, cambios de permisos.
8. **La numeración de factura/ticket es correlativa y sin saltos**, se asigna dentro de la transacción de cierre de la venta.
9. **Permisos y validación siempre en el servidor.** Ocultar un botón en la UI no es seguridad.
10. **Fechas en UTC en BD**, se muestran en `America/Tegucigalpa`. Usar los helpers de `src/lib/dates.ts`.
11. **Idempotencia en cobro:** el cliente envía un `clientRequestId` por venta; reintentar no debe duplicar la venta.

## 7. Convenciones de código

- TypeScript `strict`. Sin `any` salvo con comentario que lo justifique.
- Server actions devuelven un resultado tipado `{ ok: true, data } | { ok: false, error }`; los errores de negocio son clases de `src/lib/errors.ts` (nunca strings sueltos).
- Los textos de UI viven en `src/config/messages.es.ts` (no dispersos en JSX), para poder mantener un tono consistente.
- Nombres de archivos en `kebab-case`; componentes en `PascalCase`; funciones y variables en `camelCase`; tablas Prisma en `PascalCase` singular; campos de BD en `camelCase`.
- Un `service` por módulo; las funciones que escriben reciben `tx` (transacción) opcional para poder componerse.
- Cada regla de negocio nueva lleva test. Las operaciones de dinero/stock llevan test de integración contra Postgres real (no mocks de BD).
- Commits pequeños, en inglés, formato `tipo(módulo): descripción` (p. ej. `feat(sales): add split payments`).
- Sin dependencias nuevas sin justificarlas en el PR/commit.

## 8. Flujo de trabajo esperado de Claude Code

1. Al empezar una fase: lee `docs/ROADMAP.md` (esa fase), `docs/PRD.md` (módulo relevante) y `docs/DATA_MODEL.md`.
2. **Propón un plan corto y espera confirmación** antes de escribir mucho código (usa plan mode).
3. Construye en incrementos verticales pequeños (BD → servicio → acción → UI → test), no capa por capa.
4. Al terminar: corre lint + typecheck + test, actualiza el estado en este archivo y resume qué quedó y qué falta.
5. Si una decisión no está en los docs, mira `docs/DECISIONS_PENDING.md`: si está ahí con un valor por defecto, úsalo y menciónalo; si no está, pregunta.
6. Si descubres que un doc está desactualizado o es incorrecto, **corrígelo en el mismo cambio**.

## 9. Qué NO hacer

- No agregar funcionalidades fuera del alcance de la fase en curso (ver "Fuera de alcance" en `docs/PRD.md`).
- No usar `float` para dinero. No actualizar stock "a mano". No borrar registros con historial.
- No guardar contraseñas, PINs ni tokens en texto plano ni en logs.
- No hacer commits con secretos; `.env` nunca se versiona (solo `.env.example`).
- No crear UI sin estados de carga, vacío y error.

## 10. Índice de documentación

| Documento | Para qué |
|---|---|
| `docs/PRD.md` | Qué construir: usuarios, roles, módulos, requisitos, alcance |
| `docs/DATA_MODEL.md` | Entidades, relaciones, invariantes e índices |
| `docs/ARCHITECTURE.md` | Cómo construirlo: stack, capas, patrones, despliegue, pruebas |
| `docs/UX.md` | Cómo debe sentirse: pantallas, atajos, copy, accesibilidad |
| `docs/ROADMAP.md` | En qué orden: fases, entregables, criterios de aceptación, prompts |
| `docs/DECISIONS_PENDING.md` | Preguntas abiertas y el valor por defecto asumido |
| `docs/RUNBOOK.md` | Operar el servidor: instalar, actualizar, respaldar, restaurar, incidentes |
| `docs/manual/` | Manuales de uso por rol (cajero en 1 página, gerente, propietario, almacén) |
| `docs/CAPACITACION.md` · `docs/UX_FEEDBACK.md` | Capacitación de 10 minutos y registro de fricciones de uso |
| `docs/SAAS_PROPUESTA.md` · `docs/SAAS_ETAPA_0.md` … `docs/SAAS_ETAPA_6.md` | Iniciativa SaaS multi-negocio (rama de la plataforma): propuesta aprobada por etapas e informes de cada etapa |

## 11. Build de la Fase 0

La Fase 0 se construye con el bundle `blueprints/fase-0-cimientos/` (16 pasos en 2 épicas). Fuente de verdad: `blueprints/fase-0-cimientos/blueprint.md`. Para retomar o avanzar, ejecuta `/architect-next` desde la raíz del repo.

- Durante la Fase 0 el plan aprobado es `blueprint.md`; no esperes confirmación entre pasos ni abras plan mode: ejecuta los pasos en orden.
- Cada paso termina con `git add -A && git commit` y una etiqueta `step-NN-<slug>`; el rollback es `git reset --hard <etiqueta del paso anterior>`.
- Antes de cada Checkpoint corre `pnpm format` y luego `pnpm lint`, `pnpm typecheck` y `pnpm format:check`.
- Las pruebas de integración usan solo la base `boutique_pos_test` (`DATABASE_URL_TEST`); nunca la de desarrollo.
- `pnpm test` corre los proyectos `unit` e `integration` de Vitest; `pnpm test:e2e` corre Playwright.
- Comandos que añade o usa la Fase 0: `pnpm test:unit`, `pnpm test:integration`, `pnpm test:coverage`, `pnpm format`, `pnpm format:check`, `pnpm db:generate`, `pnpm exec next typegen` (genera los tipos de rutas de Next, ausentes en un clon limpio, antes de `pnpm typecheck`), `pnpm db:deploy`, `pnpm db:down`.
- La Fase 0 no agrega pantallas de negocio, no cambia el esquema Prisma ni las migraciones, y no sube versiones de `next`, `react`, `prisma` ni `zod`.
