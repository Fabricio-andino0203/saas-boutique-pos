# Hoja de ruta por fases

> Cada fase termina con **algo usable y probado**. No empieces una fase hasta cumplir los criterios de aceptación de la anterior.
> Tamaños: **S** (1–2 sesiones de Claude Code) · **M** (3–5) · **L** (6–10). Son estimaciones relativas para planificar, no promesas.
>
> **Cómo usar los prompts:** abre Claude Code en la carpeta del proyecto, activa plan mode, pega el prompt de la fase. Revisa el plan, apruébalo y deja que construya en incrementos. Al final pide: "ejecuta lint, typecheck y test, y actualiza el estado en CLAUDE.md".

## Resumen

| Fase | Resultado | Tamaño |
|---|---|---|
| 0 | Proyecto corriendo, CI, BD, esquema base, seed | M |
| 1 | Login, roles, configuración, catálogo con variantes | L |
| 2 | Inventario con kardex, compras, conteos, etiquetas | L |
| 3 | Caja y POS: se puede vender y cerrar caja | L |
| 4 | Devoluciones, cambios, apartados, crédito de tienda | M |
| 5 | Clientes, reportes y dashboard | M |
| 6 | Endurecimiento, offline, respaldos, despliegue | M–L |

**Hito "ya se puede abrir la tienda": final de la Fase 3** (con inventario cargado). Las fases 4–5 completan el MVP.

---

## Fase 0 — Cimientos (M)

**Objetivo:** un esqueleto profesional sobre el que construir sin deuda.

**Entregables**
- Proyecto Next.js + TS estricto + Tailwind + shadcn/ui + ESLint + Prettier, con pnpm.
- `docker-compose.yml` con Postgres 16 (+ extensiones `pg_trgm`, `unaccent`); `.env.example`; validación de env con Zod.
- Prisma configurado con el **esquema completo de `DATA_MODEL.md`** (o al menos auth, settings, catálogo, inventario, ventas, caja) y primera migración.
- Librerías base con tests: `money.ts` (suma, %, redondeo, extraer ISV, prorrateo), `dates.ts`, `errors.ts`, `permissions.ts` (capacidades y roles), `audit.ts`.
- Layout de aplicación: barra lateral, barra superior, tema, componentes compartidos (`DataTable`, `MoneyInput`, `ConfirmDialog`, `EmptyState`, `PageHeader`).
- `messages.es.ts` iniciado.
- Seed mínimo (usuarios por rol, location, terminal, tallas, colores, categorías).
- Vitest + Playwright configurados; CI en GitHub Actions (lint, typecheck, test, build).
- `/api/health`.

**Criterios de aceptación**
- `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm dev` funciona desde un clon limpio siguiendo el README.
- `pnpm lint && pnpm typecheck && pnpm test` pasan; CI en verde.
- `money.ts` tiene tests para: redondeo, ISV incluido (15 %), prorrateo de descuento global sin perder centavos.
- Existe un test que verifica el esquema contra el invariante `Σ StockMovement = StockLevel` (puede ser un placeholder pendiente de Fase 2, pero el archivo existe).

**Prompt**
```
Lee CLAUDE.md y todos los documentos en docs/. Estamos en la FASE 0 del ROADMAP.
Antes de escribir código, entra en plan mode y propón el plan de implementación:
orden de pasos, dependencias exactas que instalarás (con justificación) y cómo
validarás cada paso. Respeta las reglas de dominio de CLAUDE.md §6 y la
estructura de ARCHITECTURE.md §4. Implementa el esquema Prisma siguiendo
DATA_MODEL.md. Al terminar, verifica los criterios de aceptación de la Fase 0
uno por uno y marca la fase en CLAUDE.md.
```

---

## Fase 1 — Acceso, configuración y catálogo (L)

**Objetivo:** poder entrar al sistema, configurarlo y **cargar el catálogo completo de la boutique**.

**Entregables**
1. **Auth:** login, sesión, cierre de sesión, bloqueo por intentos, cambio de contraseña; PIN de cajero (guardar/validar; el cambio rápido en el POS llega en Fase 3).
2. **Usuarios:** CRUD, roles, activar/desactivar, reset de contraseña/PIN. Guardas de capacidad en todas las rutas.
3. **Auditoría:** `audit.log()` en acciones sensibles + pantalla de consulta con filtros.
4. **Configuración:** datos del negocio, impuestos, métodos de pago, límites de descuento, políticas (devoluciones, apartados), rangos CAI (CRUD básico con validaciones), stock negativo sí/no.
5. **Catálogos maestros:** categorías (jerárquicas), marcas, temporadas, tallas, colores, proveedores.
6. **Productos y variantes:** listado con búsqueda y filtros; **asistente de 3 pasos** con generador de matriz talla × color (ver UX.md §4); edición; archivar; duplicar; edición masiva de precio/categoría; historial de precios.
7. **SKU y código de barras:** generación automática única; EAN-13 con prefijo interno configurable.
8. **Importador CSV/Excel** con plantilla y vista previa de errores por fila.
9. **Onboarding inicial** (asistente de 5 pasos) y botón de datos de ejemplo.

**Criterios de aceptación**
- Un Cajero no puede ver costos ni acceder a rutas de admin (test de permisos + E2E).
- Crear un producto con 5 tallas × 3 colores genera 15 variantes con SKU y barras únicos en < 2 s.
- Importar un CSV de 500 filas con 5 errores muestra exactamente las 5 filas con error y permite corregir o ignorar.
- Cambiar el precio de un producto queda en `PriceHistory` y `AuditLog`.
- Buscar "vestido flral" (con error) encuentra "Vestido floral".
- Todas las pantallas tienen estados de carga/vacío/error.

**Prompt**
```
Estamos en la FASE 1 del ROADMAP. Lee docs/PRD.md (secciones 4.1, 4.2, 4.9, 4.11),
docs/DATA_MODEL.md (secciones 2 y 3) y docs/UX.md (secciones 2 y 4).
Entra en plan mode. Divide la fase en incrementos verticales pequeños (p. ej.
1: auth + guardas, 2: usuarios, 3: catálogos maestros, 4: productos y
generador de variantes, 5: importador, 6: configuración y onboarding), propón
el orden y espera mi aprobación. Cada incremento debe incluir esquema/servicio/
acción/UI/tests. Los permisos se validan en el servidor. Usa messages.es.ts
para todos los textos.
```

---

## Fase 2 — Inventario y compras (L)

**Objetivo:** el inventario es confiable y trazable desde el primer día.

**Entregables**
1. **`inventory.recordMovement`**: única puerta de cambio de stock, con locks, validación de no-negativo y tests de concurrencia.
2. **Existencias:** vista por producto con matriz talla × color; filtros (stock bajo, sin stock, por categoría/temporada); valoración a costo y a precio.
3. **Kardex** por variante con enlace al documento origen.
4. **Stock inicial** al crear variantes (movimiento `INITIAL`).
5. **Ajustes manuales** con motivo obligatorio + auditoría.
6. **Compras:** órdenes de compra (opcionales), **recepciones** (parciales), costo promedio ponderado, escaneo para recibir.
7. **Conteo físico** en modo escáner: abrir, contar, revisar diferencias, aprobar, aplicar.
8. **Alertas de reposición** (stock mínimo) en dashboard y listado.
9. **Etiquetas:** diseñador simple de plantilla (tamaño, campos), impresión desde producto, desde recepción y selección múltiple.
10. **Script de reconciliación** `Σ movimientos = onHand` y reporte de discrepancias.

**Criterios de aceptación**
- Test de concurrencia: 20 intentos simultáneos de sacar la última unidad → exactamente 1 éxito.
- Recibir una compra de 100 prendas actualiza stock, kardex y costo promedio correctamente (test con números concretos).
- Un conteo con 3 diferencias genera exactamente 3 ajustes `COUNT_ADJUSTMENT` y deja el stock igual a lo contado.
- Ningún camino de código actualiza `StockLevel` fuera de `recordMovement` (verificado con un test de arquitectura/grep en CI).
- Imprimir etiquetas de 30 variantes produce un PDF/HTML con códigos de barras escaneables.

**Prompt**
```
Estamos en la FASE 2 del ROADMAP. Lee docs/PRD.md §4.3 y §4.9, docs/DATA_MODEL.md
§4 y §5, docs/ARCHITECTURE.md §3 (servicios clave y concurrencia).
Plan mode primero. La prioridad absoluta es la corrección de recordMovement:
escribe sus tests de concurrencia ANTES de usarla en otros módulos. Después
avanza en incrementos verticales: existencias+kardex → ajustes → compras/
recepciones → conteo físico → etiquetas → alertas. Añade un test que falle si
algún archivo fuera de inventory/service.ts actualiza StockLevel directamente.
```

---

## Fase 3 — Caja y punto de venta (L)

**Objetivo:** **vender de verdad**. Al terminar esta fase, la tienda puede operar.

**Entregables**
1. **Terminales y sesiones de caja:** apertura (fondo), movimientos de efectivo (ingreso/egreso con motivo), cierre con arqueo, aprobación de gerente, resumen imprimible.
2. **POS** según `UX.md §3`: búsqueda siempre enfocada, escáner, selector visual de talla/color, carrito, descuentos por línea y globales, límites por rol y **autorización con PIN de gerente**, ventas en espera, cliente rápido.
3. **`sales.completeSale`**: recálculo en servidor, idempotencia por `clientRequestId`, snapshot de líneas, descuento de stock vía `recordMovement`, pagos mixtos, cambio, correlativos (interno + fiscal con `FiscalDocumentIssuer`), auditoría.
4. **Cobro:** diálogo con métodos, billetes rápidos, saldo restante en pagos mixtos.
5. **Ticket/factura:** vista de impresión térmica 80 mm y A4; reimpresión; datos fiscales (RTN, CAI, rango, fecha límite) cuando aplique.
6. **Cambio rápido de cajero con PIN.**
7. **Anulación de ventas** (con motivo y autorización) que revierte stock y pagos.
8. **Historial de ventas** con filtros y detalle.
9. **Atajos de teclado** completos y pantalla de ayuda (`F1`).
10. **Alertas de CAI** (por vencer / por agotarse) y bloqueo al exceder.

**Criterios de aceptación**
- E2E: login cajero → abrir caja → escanear 3 prendas → descuento 10 % → pago mixto efectivo + tarjeta → ticket → cierre de caja con diferencia 0.
- Doble clic en "Cobrar" o reintento con el mismo `clientRequestId` crea **una sola** venta.
- Dos terminales vendiendo la última unidad: una venta se completa, la otra recibe un mensaje claro de falta de stock.
- Venta anulada → stock restaurado, pagos revertidos, auditoría registrada; el esperado de caja se corrige.
- Sin caja abierta no se puede vender.
- Un Cajero no puede dar un descuento > su límite sin PIN de gerente.
- Los invariantes #1, #2, #4, #6 y #7 de `DATA_MODEL.md §9` tienen tests que pasan tras una secuencia aleatoria de 200 operaciones.
- Venta típica (escanear 2 prendas + cobrar en efectivo) usando solo teclado en < 30 s (prueba manual cronometrada).

**Prompt**
```
Estamos en la FASE 3 del ROADMAP: caja y POS. Lee docs/PRD.md §4.4 y §4.5,
docs/DATA_MODEL.md §6, docs/ARCHITECTURE.md §3, §6, §7 y §8, y docs/UX.md §3 y §6.
Plan mode primero. Empieza por el backend (money, completeSale con
idempotencia, sesiones de caja, fiscal.issue) con tests de integración contra
Postgres real; solo después construye la UI del POS. El servidor recalcula
todos los montos: nunca confíes en totales del cliente. Prototipa la pantalla
del POS siguiendo el esquema de UX.md y pídeme revisión visual antes de pulir.
```

---

## Fase 4 — Devoluciones, cambios, apartados y crédito de tienda (M)

**Objetivo:** cubrir lo que hace único a una boutique de ropa.

**Entregables**
1. **Devoluciones** (total/parcial) con motivo y condición (revendible / dañada → merma), validación de política (días, categorías sin devolución), búsqueda de venta original por número/ticket/cliente.
2. **Cambios** en una sola operación con cálculo de diferencia y un comprobante.
3. **Reembolso**: método original, efectivo (afecta caja) o **crédito de tienda**.
4. **Crédito de tienda**: libro de movimientos, uso como método de pago en el POS, saldo en la ficha del cliente.
5. **Apartados**: crear (cliente + abono), abonos con recibo, reserva de stock (`reserved`), saldar → convertir en venta, cancelar/expirar según política, listado con vencimientos.
6. **Notas de crédito fiscales** si la configuración fiscal lo requiere (a través de `FiscalDocumentIssuer`).

**Criterios de aceptación**
- No se puede devolver más de lo vendido (ni en devoluciones parciales sucesivas).
- Una devolución con descuento global prorrateado devuelve el monto exacto pagado por esa prenda (test con centavos).
- Un cambio de talla con diferencia de precio cobra/reembolsa lo correcto y deja stock y caja consistentes.
- Apartado: la prenda reservada no aparece como disponible en el POS; al expirar vuelve a estar disponible.
- Reembolso en efectivo reduce el esperado de caja del turno.
- Invariantes #3 y #5 tienen tests.

**Prompt**
```
Estamos en la FASE 4 del ROADMAP. Lee docs/PRD.md §4.6, §4.7 y §4.8 y
docs/DATA_MODEL.md §7. Plan mode primero. Define con precisión la regla de
prorrateo de descuentos para devoluciones (documéntala en ARCHITECTURE.md §6)
y escribe sus tests antes de implementar. Luego devoluciones → cambios →
crédito de tienda → apartados, cada uno como incremento vertical con E2E.
```

---

## Fase 5 — Clientes, reportes y dashboard (M)

**Objetivo:** que el dueño tome decisiones con datos.

**Entregables**
1. **Clientes**: CRUD, búsqueda por teléfono, historial, crédito, apartados.
2. **Dashboard** (UX.md §7).
3. **Reportes** (PRD §4.10): ventas por periodo/cajero/categoría/marca/método; utilidad y margen (con permiso); más/menos vendidos y rotación; matriz de ventas por talla/color; cierres de caja; inventario muerto; valoración.
4. **Exportación** CSV/XLSX y PDF de cierre de caja y valoración.
5. Consultas optimizadas (índices, vistas materializadas o tablas de resumen solo si es necesario y medido).

**Criterios de aceptación**
- Cada cifra del dashboard se puede reconciliar con el detalle de ventas del mismo periodo (test que compara agregados vs suma de líneas).
- Un Cajero no ve utilidad ni costos en ningún reporte ni en exportaciones.
- Reportes con 12 meses de datos de seed (≈ 20 000 líneas) cargan en < 2 s.
- Exportar a XLSX abre correctamente en Excel con formatos de moneda y fecha.

**Prompt**
```
Estamos en la FASE 5 del ROADMAP. Lee docs/PRD.md §4.8 y §4.10 y docs/UX.md §7.
Plan mode primero. Genera un seed ampliado (12 meses de ventas realistas) para
probar rendimiento. Cada reporte se implementa como query tipada en
modules/reports/queries.ts con test que verifica el resultado contra datos
conocidos. Mide antes de optimizar y documenta los índices agregados.
```

---

## Fase 6 — Endurecimiento y despliegue (M–L)

**Objetivo:** listo para producción con tranquilidad.

**Entregables**
1. **Despliegue** según la opción elegida en `DECISIONS_PENDING.md` (Docker + Caddy o plataforma gestionada), HTTPS, dominio, variables y migraciones automáticas.
2. **Respaldos** diarios cifrados + **prueba de restauración** documentada (`docs/RUNBOOK.md`).
3. **Observabilidad:** logs estructurados, error tracking, health checks, alerta si el servicio cae.
4. **Seguridad:** revisión contra el checklist de ARCHITECTURE.md §11, cabeceras, rate limiting, `pnpm audit`.
5. **Rendimiento:** pruebas de carga del flujo de venta; revisión de índices.
6. **Modo offline (PWA)** para el POS: venta con cola local y sincronización con idempotencia (`clientRequestId`); resolución de conflictos de stock documentada. *(Alcance a confirmar; puede ser una fase aparte.)*
7. **Impresión ESC/POS directa** y apertura de cajón si el navegador no es suficiente.
8. **Multi-sucursal**: transferencias entre ubicaciones, reportes por sucursal.
9. **Accesibilidad y modo oscuro**; pulido de UX con usuarios reales.
10. **Documentación** final: manual de usuario por rol (con capturas), `RUNBOOK.md`, guía de capacitación de 10 minutos.

**Criterios de aceptación**
- Restauración de un respaldo en un entorno limpio, verificada con el script de reconciliación.
- Sin vulnerabilidades altas/críticas en `pnpm audit`.
- 50 ventas concurrentes simuladas sin duplicados ni descuadres.
- Un usuario no técnico completa el flujo de venta usando solo el manual de 1 página.

**Prompt**
```
Estamos en la FASE 6 del ROADMAP. Lee docs/ARCHITECTURE.md §9 a §11 y
docs/DECISIONS_PENDING.md. Plan mode primero: separa lo imprescindible para
salir a producción (despliegue, respaldos, observabilidad, seguridad) de lo
opcional (offline, ESC/POS, multi-sucursal) y propón qué hacer antes y qué
después. Produce docs/RUNBOOK.md con procedimientos de despliegue, respaldo,
restauración y respuesta a incidentes.
```

---

## Reglas transversales para todas las fases

1. **Plan primero, código después.** Siempre plan mode al inicio de la fase.
2. **Verticales pequeños.** Cada incremento termina con algo que corre y tiene tests.
3. **Definición de "terminado":** lint + typecheck + test en verde, estados de carga/vacío/error, textos en `messages.es.ts`, permisos en servidor, auditoría donde corresponda, docs actualizados, estado en `CLAUDE.md` al día.
4. **Datos de prueba reales:** si algún comportamiento depende de volumen (búsqueda, reportes), probarlo con el seed grande.
5. **Revisión humana:** al final de cada fase, probar manualmente el flujo con una persona que trabaje en la tienda y anotar fricciones en `docs/UX_FEEDBACK.md`.
6. **No ampliar alcance** sin actualizar primero `PRD.md`.
