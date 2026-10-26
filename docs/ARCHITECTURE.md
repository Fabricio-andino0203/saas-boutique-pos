# Arquitectura

## 1. Principios

1. **Aburrido y confiable.** Tecnología madura y muy documentada; Claude Code la conoce bien y es fácil encontrar ayuda.
2. **Un solo despliegue.** Monolito modular (Next.js + Postgres). Nada de microservicios.
3. **El dominio manda.** La lógica de dinero e inventario vive en servicios puros y testeados, no en componentes.
4. **Transacciones siempre** en operaciones que tocan dinero o stock.
5. **Preparado, no sobreconstruido.** Multi-sucursal y offline están contemplados en el modelo, pero se implementan después.

## 2. Stack y justificación

| Decisión | Elección | Por qué | Alternativa descartada |
|---|---|---|---|
| Framework | Next.js App Router + TS | Full-stack en un repo, server actions, SSR rápido, ecosistema enorme | SPA + API separada (más piezas que mantener) |
| BD | PostgreSQL | Transacciones sólidas, índices parciales, `pg_trgm` para búsqueda, JSON | MySQL (menos cómodo para búsqueda difusa e índices parciales); SQLite (sin concurrencia multi-terminal) |
| ORM | Prisma | Tipos de extremo a extremo, migraciones claras | Drizzle (también válido; Prisma es más conocido) |
| UI | Tailwind + shadcn/ui | Componentes accesibles y personalizables, sin dependencia pesada | MUI/AntD (look genérico, más pesado) |
| Forms | React Hook Form + Zod | Un schema compartido cliente/servidor | Formik |
| Tablas | TanStack Table v8 | Ordenar, filtrar, paginar, virtualizar; v8 es la API con más ejemplos y guía de shadcn | TanStack Table v9 (reescritura; sin guía verificada), tablas a mano |
| Estado POS | Zustand | Carrito local, rápido, simple | Redux (excesivo) |
| Auth | Sesiones propias en BD (tabla `Session`) | Revocables, sin dependencia de un proyecto en transición; el token se guarda hasheado | Auth.js (el proveedor de credenciales solo admite JWT, que no se puede revocar; v5 sigue en beta y el proyecto pasa a Better Auth) |
| Pruebas | Vitest 5 (proyectos `unit` e `integration`) + Playwright (Chromium) | Rápidas; integración contra Postgres real; E2E real del flujo de venta | Jest |
| Hash de contraseñas | `@node-rs/argon2` (Argon2id) | Binarios precompilados para Windows y Linux, sin compilar | `argon2` (compilación nativa que falla en Windows) |
| Tipografía | Inter con `next/font/google` | Legible, con cifras tabulares para dinero | Geist (la de la plantilla de Next) |
| Driver de BD | Prisma 7 con `@prisma/adapter-pg` | Prisma 7 exige un adaptador de driver; cliente generado en `src/generated/prisma` | – |
| Códigos de barras | `bwip-js` (generar) | Genera EAN-13/Code128 en servidor/cliente | – |
| PDF/Excel | `@react-pdf/renderer` o impresión HTML; `exceljs` | Reportes y etiquetas | – |
| Gráficos | Recharts | Suficiente para el dashboard | – |

> Si algún paquete/versión no coincide con lo que está disponible al momento de implementar, Claude Code puede proponer el equivalente y anotarlo en este archivo.

## 3. Capas y flujo de una operación

```
UI (RSC + Client Components)
   │  formulario/acción del usuario
   ▼
Server Action  (src/modules/<mod>/actions.ts)
   │  1) autentica  2) autoriza (capacidad)  3) valida con Zod
   ▼
Service  (src/modules/<mod>/service.ts)
   │  reglas de negocio + db.$transaction
   ▼
Prisma  →  PostgreSQL
```

- **Queries de lectura** (listados, reportes) en `queries.ts`; pueden usarse directamente desde Server Components, siempre pasando por `requireCapability()`.
- **Escrituras** únicamente vía `service` (nunca desde el componente).
- `service` no conoce HTTP/Next: recibe datos ya validados y el `actor` (usuario), lanza errores de dominio tipados.
- Los errores de dominio (`InsufficientStockError`, `CashSessionClosedError`, `FiscalRangeExhaustedError`, `ForbiddenError`…) se traducen en la action a mensajes en español.

### Servicios clave y su contrato

| Servicio | Responsabilidad | Garantías |
|---|---|---|
| `inventory.recordMovement(tx, input)` | **Única** puerta para cambiar stock: inserta `StockMovement` y actualiza `StockLevel` | Atómico; valida no-negativo; lock de fila (`SELECT … FOR UPDATE`) |
| `sales.completeSale(input)` | Valida carrito, recalcula totales en el servidor, descuenta stock, registra pagos, asigna numeración, audita | Idempotente por `clientRequestId`; todo-o-nada |
| `sales.voidSale(id, actor, reason)` | Revierte stock y pagos | Requiere capacidad o PIN de gerente; audita |
| `returns.processReturn(...)` | Devolución/cambio | No excede lo vendido; stock según condición |
| `cash.openSession / closeSession` | Turnos y arqueo | Una sesión abierta por cajero/terminal |
| `layaways.*` | Reserva, abonos, saldado, expiración | Maneja `reserved` sin tocar `onHand` hasta saldar |
| `purchasing.receive(...)` | Recepción y costo promedio | Recalcula `avgCostCents` |
| `fiscal.issue(tx, type, terminal)` | Siguiente número del rango | Correlativo sin saltos (lock) |
| `money.*` | Suma, porcentaje, redondeo, prorrateo de descuentos, extracción de ISV | Funciones puras con tests exhaustivos |

**Importante:** el servidor **recalcula** precios, descuentos y totales; nunca confía en los montos enviados por el cliente (solo en las cantidades y los IDs, y en el precio solo si el descuento/anulación fue autorizado).

### Concurrencia

- Dos cajeros vendiendo la última prenda: `recordMovement` toma lock de la fila de `StockLevel` y falla con `InsufficientStockError` al segundo.
- Fiscal: `FiscalRange` se bloquea con `FOR UPDATE` al emitir.
- Nivel de aislamiento por defecto `READ COMMITTED` + locks explícitos; usar `Serializable` solo si un test demuestra necesidad.

## 4. Estructura de carpetas

```
boutique-pos/
├─ CLAUDE.md
├─ docs/
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  └─ seed.ts
├─ src/
│  ├─ app/
│  │  ├─ (auth)/login/
│  │  ├─ (app)/                      # layout con barra lateral y guardia de sesión
│  │  │  ├─ dashboard/
│  │  │  ├─ pos/                     # pantalla de venta (layout a pantalla completa)
│  │  │  ├─ productos/
│  │  │  ├─ inventario/              # existencias, kardex, ajustes, conteos
│  │  │  ├─ compras/
│  │  │  ├─ ventas/                  # historial + detalle + reimpresión
│  │  │  ├─ devoluciones/
│  │  │  ├─ apartados/
│  │  │  ├─ clientes/
│  │  │  ├─ caja/
│  │  │  ├─ reportes/
│  │  │  └─ configuracion/
│  │  └─ api/                        # solo health, exportaciones, impresión
│  ├─ modules/
│  │  ├─ auth/ catalog/ inventory/ purchasing/ sales/ returns/
│  │  ├─ layaways/ cash/ customers/ reports/ settings/ fiscal/
│  │  └─ <mod>/ {schemas.ts, service.ts, queries.ts, actions.ts, components/}
│  ├─ components/
│  │  ├─ ui/                         # shadcn
│  │  ├─ layout/                     # sidebar, topbar, page header
│  │  └─ shared/                     # DataTable, MoneyInput, ConfirmDialog, EmptyState…
│  ├─ lib/
│  │  ├─ db.ts  auth.ts  permissions.ts  money.ts  dates.ts
│  │  ├─ errors.ts  audit.ts  barcode.ts  print.ts  settings.ts
│  ├─ config/
│  │  ├─ messages.es.ts              # textos de UI
│  │  └─ constants.ts
│  └─ types/
├─ tests/
│  ├─ unit/        # money, permisos, cálculos
│  ├─ integration/ # servicios contra Postgres real
│  └─ e2e/         # Playwright: flujos completos
├─ docker-compose.yml
├─ .env.example
├─ .github/workflows/ci.yml
└─ package.json
```

## 5. Autenticación y permisos

- Login con usuario + contraseña (Argon2id). Sesión en BD: cookie `httpOnly`, `secure` en producción, `sameSite=lax`, con un token aleatorio de 32 bytes; en la tabla `Session` solo se guarda su hash SHA-256. Vence a las 12 horas o tras 60 minutos de inactividad, y se puede revocar. Código en `src/modules/auth/service.ts` (lógica) y `src/lib/auth.ts` (cookies). `src/proxy.ts` solo redirige a `/login` si falta la cookie; la validación real está en `requireSession()`.
- **PIN rápido:** en el POS, el cajero activo puede ser cambiado con PIN sin pasar por login completo; se registra en cada venta quién la hizo (`sellerId`).
- **Capacidades** (en `src/lib/permissions.ts`), por ejemplo:
  `sale.create, sale.void, discount.applyBeyondLimit, return.create, product.write, product.viewCost, price.change, stock.adjust, purchase.receive, cash.open, cash.closeApprove, report.financial, user.manage, settings.manage`.
- `requireCapability(actor, cap)` en cada action/query. Roles = mapa rol→capacidades.
- **Autorización por PIN de gerente** (override puntual): la action recibe el PIN, lo verifica contra usuarios con la capacidad requerida y audita quién autorizó.
- Bloqueo por intentos en login y PIN: 5 fallos seguidos bloquean la cuenta 15 minutos (`failedLogins`, `lockedUntil`). Un solo contador para contraseña y PIN.

## 6. POS: decisiones de diseño

- El carrito vive en el **cliente** (Zustand) para ser instantáneo; el **servidor recalcula todo** al cobrar.
- **Ventas en espera:** se guardan en `localStorage` (por terminal) en el MVP. Si se requiere multi-dispositivo, migrar a `ParkedSale` en servidor.
- **Escáner de código de barras:** modo "teclado" (el lector emula escritura + Enter). Un listener global captura ráfagas rápidas de teclas (< 50 ms entre caracteres) y las interpreta como escaneo aunque el foco no esté en el campo de búsqueda.
- **Búsqueda:** endpoint/consulta con `pg_trgm` + normalización de tildes (`unaccent`); resultados en < 200 ms; los más vendidos primero.
- **Optimismo con red:** si falla el cobro por red, el botón queda en "Reintentando…" usando el **mismo** `clientRequestId`; la venta nunca se duplica.
- **Reglas de dinero (`money.ts`):** precios al público con ISV incluido; el ISV se **extrae** (`total − total / (1 + tasa)`), el redondeo se hace una sola vez por línea con política documentada; los descuentos globales se **prorratean** entre líneas para devoluciones exactas.

## 7. Impresión

- **Ticket térmico 80 mm (y 58 mm):** MVP con una vista HTML de CSS de impresión (`@media print`, ancho fijo) y `window.print()`. Fase 6: ESC/POS directo (WebUSB o agente local) si el navegador no basta.
- **Cajón de dinero:** suele abrirse por el pulso de la impresora; se documenta como configuración de la impresora, no del software.
- **Etiquetas:** PDF/HTML con `bwip-js`; plantillas configurables (tamaño de rollo o de hoja A4 con N columnas).
- **Reportes:** vista en pantalla + exportación CSV/XLSX; PDF para cierre de caja y valoración.

## 8. Fiscal (aislado)

```
interface FiscalDocumentIssuer {
  issue(tx, saleDraft): Promise<{ type; number; cai?; ... }>
}
```
Implementación inicial: `CaiRangeIssuer` (correlativo local con rango/CAI/fecha límite). Si luego se exige facturación electrónica, se agrega otra implementación sin tocar `sales`.

## 9. Despliegue y operación

- **Desarrollo:** `docker compose` para Postgres; `pnpm dev`.
- **Producción (opciones, ver `DECISIONS_PENDING.md`):**
  - **A (recomendada para empezar):** un VPS pequeño (Docker: app + Postgres + Caddy para HTTPS) o plataforma gestionada (Vercel/Fly/Railway + Postgres administrado como Neon/Supabase). 
  - **B:** servidor local en la tienda (mini PC) si el internet es poco fiable; requiere respaldo externo.
- **Respaldos:** `pg_dump` diario cifrado a almacenamiento externo, retención 30 días, **prueba de restauración documentada y probada** (Fase 6).
- **Migraciones:** `prisma migrate deploy` en el arranque del despliegue; nunca `db push` en producción.
- **Observabilidad:** logs estructurados, endpoint `/api/health`, error tracking (Sentry u otro) en Fase 6.
- **Configuración:** variables de entorno validadas con Zod al arrancar (`DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, `TZ`…); `.env.example` versionado.

## 10. Estrategia de pruebas

| Nivel | Qué cubre | Herramienta |
|---|---|---|
| Unidad | `money`, permisos, cálculo de descuentos/ISV, generación de SKU/EAN | Vitest |
| Integración | Servicios contra **Postgres real** (contenedor): venta, devolución, cierre de caja, recepción, conteo, concurrencia de stock, idempotencia | Vitest + Prisma |
| Invariantes | Los 7 invariantes de `DATA_MODEL.md §9` tras ejecutar secuencias aleatorias de operaciones | Vitest (property-style) |
| E2E | Login → abrir caja → vender → cobrar mixto → devolver → cerrar caja; crear producto con variantes; recibir compra | Playwright |
| Accesibilidad | axe en pantallas clave | Playwright + axe |

CI (GitHub Actions): lint → typecheck → test (con Postgres de servicio) → build → e2e en `main`.

## 11. Seguridad (checklist)

- Hash de contraseñas/PIN; nunca en logs. Rate limiting. Bloqueo por intentos.
- Todas las actions con `requireCapability` + Zod.
- Cabeceras de seguridad (CSP razonable, HSTS, `X-Content-Type-Options`).
- Subida de imágenes: validar tipo/tamaño, almacenar fuera de la raíz pública o en storage de objetos.
- Sin datos de tarjeta. Secretos solo en variables de entorno.
- Dependencias: `pnpm audit` en CI; Dependabot/Renovate.
- Auditoría de acciones sensibles (ver CLAUDE.md §6.7).

## 12. Registro de decisiones (ADR corto)

Cada decisión relevante nueva se agrega aquí con fecha, contexto y consecuencia:

| Fecha | Decisión | Motivo |
|---|---|---|
| (inicio) | Monolito modular Next.js + Postgres | Simplicidad operativa |
| (inicio) | Dinero en centavos enteros | Evitar errores de redondeo |
| (inicio) | Kardex inmutable como fuente de verdad del stock | Trazabilidad y auditoría |
| (inicio) | Servidor recalcula todos los montos | No confiar en el cliente |
| 2026-10-23 | TanStack Table v8 sobre v9 | v9 es una reescritura y su guía con shadcn no está verificada |
| 2026-10-23 | `@node-rs/argon2` (Argon2id) para contraseñas y PIN | Binarios precompilados; `argon2` compila en nativo y falla en Windows |
| 2026-10-23 | Inter sobre Geist | Legibilidad y cifras tabulares para dinero |
| 2026-10-23 | Prisma 7 con `@prisma/adapter-pg` y cliente en `src/generated/prisma` (no versionado) | Requisito de Prisma 7; el cliente se regenera con `pnpm db:generate` |
| 2026-10-23 | Vitest con proyectos `unit` e `integration` contra la BD `boutique_pos_test` | Pruebas de dinero y stock contra Postgres real, sin tocar la BD de desarrollo |
| 2026-10-23 | Sin CHECK `onHand >= 0` en BD | Depende de `sales.allowNegativeStock`; se valida en `inventory.recordMovement` |
| 2026-10-23 | `@types/node` en la línea 24 | Lo exige Vitest 5 y coincide con el runtime (Node 24) |
| 2026-10-23 | Galería `/dev/componentes` + Playwright en lugar de Storybook | Menos dependencias; los componentes se ejercen en un navegador real |
| 2026-10-25 | Sesiones propias en lugar de Auth.js | Credenciales + base de datos no se combinan en Auth.js (solo JWT, no revocable); v5 sigue en beta y el proyecto pasa a Better Auth. Revisar si se añade inicio de sesión con terceros |
