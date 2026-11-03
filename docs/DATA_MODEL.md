# Modelo de datos

> Especificación para implementar en `prisma/schema.prisma`. Los nombres están en inglés (así van en código); la descripción, en español.
> Convenciones: `id` = `String @id @default(cuid())`; todos los modelos llevan `createdAt` y `updatedAt`; los que se archivan llevan `archivedAt DateTime?`. **Todo dinero es `Int` en centavos** (sufijo `Cents`). Las cantidades de prendas son `Int`.

## 1. Diagrama (alto nivel)

```mermaid
erDiagram
  User ||--o{ Sale : "sells"
  User ||--o{ CashSession : "opens"
  Location ||--o{ StockLevel : "holds"
  Location ||--o{ Terminal : "has"
  Terminal ||--o{ CashSession : "used by"
  Product ||--o{ Variant : "has"
  Category ||--o{ Product : "groups"
  Brand ||--o{ Product : "labels"
  Season ||--o{ Product : "belongs"
  Size ||--o{ Variant : "is"
  Color ||--o{ Variant : "is"
  Variant ||--o{ StockLevel : "per location"
  Variant ||--o{ StockMovement : "tracked by"
  Variant ||--o{ SaleItem : "sold as"
  Sale ||--o{ SaleItem : "contains"
  Sale ||--o{ Payment : "paid by"
  Sale ||--o{ ReturnDoc : "may have"
  ReturnDoc ||--o{ ReturnItem : "contains"
  Customer ||--o{ Sale : "buys"
  Customer ||--o{ Layaway : "reserves"
  Customer ||--o{ StoreCreditEntry : "balance"
  Layaway ||--o{ LayawayItem : "contains"
  Layaway ||--o{ LayawayPayment : "paid by"
  Supplier ||--o{ PurchaseOrder : "receives"
  PurchaseOrder ||--o{ PurchaseOrderItem : "contains"
  PurchaseOrder ||--o{ GoodsReceipt : "received by"
  StockCount ||--o{ StockCountItem : "contains"
```

## 2. Acceso y configuración

### User
| Campo | Tipo | Notas |
|---|---|---|
| name | String | |
| username | String @unique | para login |
| email | String? @unique | |
| passwordHash | String | argon2/bcrypt |
| pinHash | String? | cambio rápido de cajero |
| role | enum `OWNER, MANAGER, CASHIER, WAREHOUSE` | mapea a conjunto de capacidades |
| isActive | Boolean | desactivar en vez de borrar |
| failedLogins | Int, lockedUntil DateTime? | bloqueo por intentos |
| lastLoginAt | DateTime? | |

### Location (sucursal/bodega)
`name`, `code @unique`, `address?`, `isDefault Boolean`, `type enum (STORE, WAREHOUSE)`. Hoy existe una sola; todo el stock cuelga de aquí.

### Terminal (caja física)
`name`, `locationId`, `isActive`. Define dónde se abren las sesiones de caja.

### Setting
Clave/valor tipado por ámbito (`key @unique`, `valueJson`). Ejemplos: `tax.rate`, `tax.pricesIncludeTax`, `sales.allowNegativeStock`, `discount.maxPercent.CASHIER`, `returns.maxDays`, `layaway.expiryDays`, `ticket.footer`. Con helper tipado en `src/lib/settings.ts`.

### BusinessProfile
`legalName`, `tradeName`, `taxId (RTN)`, `address`, `phone`, `logoUrl?`.

### FiscalRange (rango CAI)
| Campo | Notas |
|---|---|
| documentType | `INVOICE`, `CREDIT_NOTE`… |
| terminalId | `Terminal?`; `null` = rango general (sin punto de emisión propio) |
| cai | String |
| prefix | p. ej. `000-001-01-` |
| rangeStart / rangeEnd | Int |
| nextNumber | Int (**se incrementa solo dentro de la transacción de venta**) |
| expiresAt | DateTime (fecha límite de emisión) |
| isActive | Boolean |

Invariantes: `nextNumber` ∈ [`rangeStart`, `rangeEnd`+1]; no se emite si `now > expiresAt` o `nextNumber > rangeEnd`. Solo un rango activo por tipo y terminal/punto de emisión (índice parcial único en la migración `constraints`, ver §11).

### Session
Sesiones en BD, revocables (forma compatible con Auth.js). `sessionToken @unique`, `userId` (`onDelete: Cascade`), `expires`, `ip?`, `userAgent?`, `createdAt`, `updatedAt`. Índices por `userId` y `expires`.

### DocumentCounter
Numeración correlativa interna sin saltos (ticket, devolución, apartado…). `key` es la clave primaria (p. ej. `SALE`, `RETURN`, `LAYAWAY`, `PURCHASE_ORDER`), `nextValue Int` (por defecto 1) y `updatedAt`. Se incrementa con bloqueo de fila dentro de la transacción del documento.

### AuditLog
`userId?`, `action String` (p. ej. `SALE_VOIDED`), `entityType`, `entityId`, `before Json?`, `after Json?`, `reason String?`, `ip?`, `createdAt`. **Solo inserción**; nunca update/delete. Índices por `(entityType, entityId)`, `(userId, createdAt)` y `(action, createdAt)`.

## 3. Catálogo

### Category
`name`, `parentId?` (auto-referencia), `slug @unique`, `sortOrder`, `allowsReturns Boolean @default(true)`.

### Brand · Season
`name @unique`; Season además `startsAt?`, `endsAt?` (p. ej. "Primavera-Verano 2026").

### Size · Color
- **Size:** `name @unique` (S, M, 38…), `sortOrder`, `group?` (ropa, calzado, números).
- **Color:** `name @unique`, `hex?`, `sortOrder`.

### Supplier
`name`, `taxId?`, `contactName?`, `phone?`, `email?`, `address?`, `paymentTerms?`, `notes?`, `archivedAt?`.

### Product
| Campo | Notas |
|---|---|
| code | `String @unique`, base del SKU de sus variantes |
| name | |
| description | String? |
| categoryId | |
| brandId? | |
| seasonId? | |
| defaultSupplierId? | |
| basePriceCents | precio público (con ISV incluido si así se configura) |
| baseCostCents | costo de referencia |
| taxCategory | enum `STANDARD, EXEMPT` (para ISV) |
| imageUrl? | **En desuso:** las fotos viven en `ProductImage`; nada lee ni escribe este campo |
| archivedAt? | |

### ProductImage (foto de un producto)
| Campo | Notas |
|---|---|
| id | lo genera el servidor (`ph…`); es también la carpeta de sus archivos |
| productId | |
| colorId? | si la foto es de un color del producto (debe ser uno de los que tiene en sus variantes); `null` = foto general |
| position | 0, 1, 2… sin huecos por producto; la 0 es la foto principal. Las altas, bajas y reordenamientos mantienen la secuencia bajo un candado por producto |
| width, height | de la versión grande, ya orientada |
| bytes | suma de las tres versiones (mide el espacio que usa el negocio) |
| originalName? | solo para mostrar; nunca ubica nada |
| createdAt | |

Los archivos **no están en la base**: viven en el almacén de archivos (`UPLOADS_DIR`) en `<negocio>/<producto>/<foto>/{thumb,medium,large}.webp`, una dirección que sale de los ids y no se guarda. Tope: 6 fotos por producto y el límite `photos` del plan (sin tope por omisión).

### Variant (la unidad que se vende y se cuenta)
| Campo | Notas |
|---|---|
| productId | |
| sizeId?, colorId? | al menos uno o variante "única" |
| sku | `@unique`, generado: `{código producto}-{talla}-{color}` (sin tildes, en mayúsculas; si choca, sufijo `-2`, `-3`…) |
| barcode | `@unique`, EAN-13 interno generado: prefijo `200` + serie de 9 dígitos (`barcode_serial_seq`) + dígito de control |
| priceCents? | si es null hereda `Product.basePriceCents` |
| costCents? | si es null hereda `Product.baseCostCents` |
| avgCostCents | costo promedio ponderado, actualizado por compras |
| reorderPoint | Int? stock mínimo |
| archivedAt? | |

Restricción: `(productId, sizeId, colorId)` es un índice único `NULLS NOT DISTINCT` creado en la migración `constraints` (Prisma no puede expresarlo), de modo que una variante sin talla o sin color tampoco se duplica.

### PriceHistory
`variantId` o `productId`, `oldPriceCents`, `newPriceCents`, `oldCostCents`, `newCostCents`, `changedById`, `changedAt`, `reason?`.

## 4. Inventario

### StockLevel (acumulado — **no se edita directamente**)
`variantId`, `locationId`, `onHand Int`, `reserved Int` (apartados). `available = onHand − reserved`.
`@@unique([variantId, locationId])`. No hay CHECK de `onHand >= 0` en la BD: depende de `sales.allowNegativeStock` y se valida en `inventory.recordMovement`. Sí hay CHECK `reserved >= 0`.

### StockMovement (kardex — **fuente de verdad, solo inserción**)
| Campo | Notas |
|---|---|
| variantId, locationId | |
| type | enum `PURCHASE_IN, SALE_OUT, RETURN_IN, RETURN_SCRAP, ADJUSTMENT_IN, ADJUSTMENT_OUT, COUNT_ADJUSTMENT, TRANSFER_OUT, TRANSFER_IN, LAYAWAY_RESERVE, LAYAWAY_RELEASE, INITIAL` |
| quantity | Int con signo (+ entra, − sale) |
| unitCostCents | costo al momento |
| refType, refId | documento origen (`Sale`, `GoodsReceipt`, `StockCount`…) |
| reason | String? (obligatorio en ajustes) |
| userId | |
| createdAt | |

Invariante: para cada `(variantId, locationId)`, `Σ quantity (excluyendo reservas) = StockLevel.onHand`. Debe existir un test y un script de **reconciliación** que lo verifique.

### StockCount / StockCountItem
- **StockCount:** `locationId`, `status enum (OPEN, IN_REVIEW, APPLIED, CANCELLED)`, `scope` (todo / categoría / zona), `scopeRef?` (id de categoría o nombre de zona, según `scope`), `startedById`, `approvedById?`, `appliedAt?`.
- **StockCountItem:** `stockCountId`, `variantId`, `expectedQty` (congelado al abrir), `countedQty`, `difference` (derivado), `note?`. Único en `(stockCountId, variantId)`.
Al **aplicar** se genera un `StockMovement` `COUNT_ADJUSTMENT` por cada diferencia.

## 5. Compras

### PurchaseOrder
`supplierId`, `locationId`, `number @unique`, `status enum (DRAFT, ORDERED, PARTIALLY_RECEIVED, RECEIVED, CANCELLED)`, `expectedAt?`, `notes?`, `createdById`.
### PurchaseOrderItem
`purchaseOrderId`, `variantId`, `orderedQty`, `receivedQty`, `unitCostCents`. Único en `(purchaseOrderId, variantId)`.
### GoodsReceipt / GoodsReceiptItem
Recepción (puede ser sin orden). `number @unique`, `supplierId`, `locationId`, `purchaseOrderId?`, `supplierInvoiceRef?`, `receivedById`, `receivedAt`; ítems con `variantId`, `quantity`, `unitCostCents`.
Al confirmar: crea `StockMovement PURCHASE_IN`, actualiza `StockLevel`, recalcula `avgCostCents`.

## 6. Ventas

### Customer
`name`, `phone? @unique(nullable)` (único también entre archivados; la ficha completa la crean y editan `customer.write`, y la archiva `customer.archive`, con `AuditLog` en cada cambio), `email?`, `taxId?`, `notes?`, `preferredSizes?` (texto libre), `storeCreditCents` (**derivado/cacheado** del libro `StoreCreditEntry`), `archivedAt?`.

### CashSession (turno de caja)
`terminalId`, `userId`, `openedAt`, `openingFloatCents`, `inheritedFloatCents?`, `openingNotes?`, `closedAt?`, `expectedCashCents?`, `countedCashCents?`, `differenceCents?`, `withdrawnCents?`, `status enum (OPEN, CLOSED_PENDING_APPROVAL, CLOSED)`, `approvedById?`, `notes?`.
`withdrawnCents` es lo que se retiró al cerrar (0 si no se retiró nada; `NULL` en los turnos anteriores a esta función): CHECK `0 ≤ withdrawnCents ≤ countedCashCents`. Lo que **se queda en el cajón** es `countedCashCents − withdrawnCents` y es el fondo que se ofrece al abrir la siguiente caja de esa terminal; un cierre con `withdrawnCents NULL` no hereda nada. `inheritedFloatCents` es lo que se ofreció al abrir (`NULL` si no había cierre anterior con retiro declarado) y `openingNotes` explica por qué se abrió con otro monto (obligatorio si lo heredado era mayor que cero y el fondo fue distinto).
Restricción: máximo una sesión `OPEN` por usuario y por terminal (índice parcial).
Ciclo: `OPEN` → (el cajero cierra con arqueo: guarda `expectedCashCents`, `countedCashCents`, `differenceCents`; si la diferencia no es 0, `notes` es obligatorio) `CLOSED_PENDING_APPROVAL` → (gerente o propietario aprueba: `approvedById`) `CLOSED`. El desglose por billetes y monedas, si se usó, queda en el `after` del `AuditLog` `CASH_SESSION_CLOSED`. Mientras está `OPEN`, lo esperado se calcula al momento; al cerrar se congela.

### CashMovement
Entradas/salidas manuales: `cashSessionId`, `type (IN, OUT)`, `amountCents` (> 0), `reason` (obligatorio, ≥ 3 caracteres), `userId`. Una salida no puede superar el efectivo esperado en ese momento (la sesión se bloquea con `FOR UPDATE` mientras se decide).

### Sale
| Campo | Notas |
|---|---|
| number | correlativo interno `@unique` |
| clientRequestId | `@unique` — **idempotencia** |
| status | `COMPLETED, VOIDED` (las ventas en espera viven en el cliente o en `ParkedSale`) |
| locationId, terminalId, cashSessionId | |
| sellerId | usuario que vendió |
| customerId? | |
| subtotalCents | suma de líneas antes de descuento global |
| discountCents | descuento global |
| taxCents | ISV incluido en el total |
| totalCents | lo que paga el cliente |
| paidCents / changeCents | |
| fiscalDocType?, fiscalNumber?, fiscalRangeId? | si se emitió factura; `@@unique([fiscalRangeId, fiscalNumber])` |
| customerTaxId?, customerNameOnInvoice? | datos a nombre en la factura |
| voidedAt?, voidedById?, voidReason? | |
| createdAt | |

Invariante: `totalCents = subtotal − discount` (con ISV incluido: `taxCents` es informativo; si los precios no incluyen ISV, `totalCents = subtotal − discount + taxCents`); `Σ Payment.amountCents − changeCents = totalCents`; `Σ SaleItem.lineTotalCents = totalCents`. El `Sale` cae en el turno abierto de la terminal; `sellerId` es quien vendió. Una venta con total 0 (por ejemplo, con el 100 % de descuento) no se acepta.

Anulación: solo mientras el turno de la venta sigue abierto; pone `status = VOIDED` con `voidedAt`, `voidedById` (quien autorizó) y `voidReason`, devuelve cada prenda con un movimiento `RETURN_IN` (motivo "Anulación de venta T-…", costo de la línea) y no borra nada: el número de ticket y el de factura quedan usados (sin saltos). Después de cerrar el turno se corrige con una devolución (Fase 4).

### SaleItem (snapshot)
`saleId`, `variantId`, `quantity`, `unitPriceCents`, `unitCostCents` (promedio de la prenda; si nunca se compró, el costo del catálogo), `lineDiscountCents` (descuento propio **más** su parte prorrateada del descuento global), `taxRate` (basis points, p. ej. 1500), `taxCents`, `lineTotalCents`, y **copias de texto** `productName`, `sizeName`, `colorName`, `sku` (para que el recibo histórico no cambie si se renombra el producto).

### Payment
`saleId`, `method enum (CASH, CARD, TRANSFER, STORE_CREDIT, OTHER, EXCHANGE, LAYAWAY)` (`EXCHANGE`: el valor de lo devuelto en un cambio, aplicado a la venta nueva; `LAYAWAY`: los abonos ya recibidos de un apartado, aplicados a la venta al saldar; ninguno mueve el cajón), `amountCents` (en efectivo, lo que entregó el cliente: el vuelto se resta aparte en `Sale.changeCents`; solo el efectivo puede pasarse del total), `reference?` (últimos 4 / # autorización / # transferencia), `cashSessionId`.
Datos de tarjeta **nunca**: solo monto y referencia.

### ParkedSale (venta en espera, opcional en servidor)
`userId`, `terminalId`, `payloadJson`, `createdAt`. Alternativa: solo en el cliente (Zustand + `localStorage`); decisión en `ARCHITECTURE.md`.

## 7. Devoluciones, apartados, crédito

### ReturnDoc
`number @unique`, `clientRequestId @unique` (idempotencia), `customerId?` (quien recibe el crédito de tienda), `saleId` (venta original), `type enum (RETURN, EXCHANGE)`, `exchangeSaleId?` (venta nueva si es cambio), `reason`, `refundMethod enum (ORIGINAL, CASH, STORE_CREDIT, NONE)`, `refundCents` (el dinero que sale hacia el cliente; en un cambio, solo lo que sobra después de pagar la venta nueva, y `NONE` si no sobra nada), `cashSessionId`, `processedById`, `authorizedById?`, `fiscalNumber?`, `fiscalRangeId?` (la nota de crédito, solo si la venta original tuvo factura y había un rango `CREDIT_NOTE` vigente; `@@unique([fiscalRangeId, fiscalNumber])`), `createdAt`.
### ReturnItem
`returnId`, `saleItemId`, `quantity`, `condition enum (RESELLABLE, DAMAGED)`, `refundCents`, `reason`.
Invariante: Σ `ReturnItem.quantity` por `saleItemId` ≤ `SaleItem.quantity`.

### Layaway (apartado)
`number`, `clientRequestId @unique` (idempotencia), `customerId`, `status enum (ACTIVE, COMPLETED, CANCELLED, EXPIRED)`, `totalCents`, `paidCents` (Σ de los abonos recibidos; el pago final vive en la venta), `retainedCents` (lo que la tienda se queda al cancelar), `expiresAt`, `saleId?` (al saldar), `createdById`, `cancelledAt?`, `cancelReason?`, `cancelledById?`.
### LayawayItem · LayawayPayment
Ítems con snapshot de precio; abonos (`LayawayPayment`) con `method` (efectivo, tarjeta, transferencia u otro), `amountCents`, `reference?`, `clientRequestId? @unique` (idempotencia), `cashSessionId` (el turno donde entró el abono), `userId` (quien lo recibió), `createdAt`.
Al crear: `StockLevel.reserved += qty` (movimiento `LAYAWAY_RESERVE`, cantidad positiva; `onHand` no cambia). Al saldar, cancelar o vencer: `LAYAWAY_RELEASE` (cantidad negativa). Una venta (`SALE_OUT`) solo puede sacar lo disponible (`onHand − reserved`). Invariante: Σ de los movimientos de apartado = `StockLevel.reserved` = Σ de las cantidades de los apartados `ACTIVE` (`findReservedDiscrepancies`).
Al saldar: el apartado se vuelve una venta a los precios guardados; los abonos ya recibidos pagan la venta con un `Payment` de método `LAYAWAY` (su efectivo ya entró en el turno donde se recibió, y `loadCashTotals` lo suma con `layawayCashCents`) y lo que falta se cobra con pagos normales. Al cancelar o vencer: lo abonado menos `retainedCents` pasa a crédito de tienda (`LAYAWAY_CANCEL`) y queda un `AuditLog LAYAWAY_CANCELLED`.

### StoreCreditEntry (libro del crédito de tienda — solo inserción)
`customerId`, `amountCents` (+ abona, − consume), `reason enum (RETURN, LAYAWAY_CANCEL, MANUAL, USED_IN_SALE, SALE_VOID)`, `refType`, `refId`, `note?` (el motivo de un ajuste manual), `userId`, `createdAt`.
`Customer.storeCreditCents` = Σ del libro (se mantiene en la misma transacción, con la fila del cliente bloqueada: dos cobros no gastan el mismo saldo). Todo cambio pasa por `applyStoreCredit` (`src/modules/credit/service.ts`) y el saldo nunca queda negativo. Origen de cada movimiento: `RETURN` (devolución o sobrante de un cambio, `refType ReturnDoc`), `USED_IN_SALE` (pago con crédito, `refType Sale`), `SALE_VOID` (anular una venta pagada con crédito lo devuelve), `MANUAL` (ajuste de un gerente con motivo, `refType Adjustment`) y `LAYAWAY_CANCEL` (apartado cancelado o vencido).

## 7b. Finanzas (módulo `finance`)

Finanzas **operativas**, no contabilidad (ver PRD §4.12). Las ventas, devoluciones y costos de lo vendido ya viven en `Sale`, `ReturnDoc` y `SaleItem`: aquí solo entra lo que **no** es una venta.

### FinanceCategory
`type enum (EXPENSE, INCOME)`, `name` (único por tipo), `sortOrder`, `archivedAt?`. Se siembra al crear el negocio y se archiva, no se borra.

### FinanceEntry (libro de gastos e ingresos — inmutable salvo su anulación)
`type`, `categoryId`, `amountCents` (> 0), `occurredAt` (el día del gasto, UTC; se muestra en `America/Tegucigalpa`), `paidWith enum (CASH_DRAWER, CASH_OTHER, TRANSFER, CARD, OTHER)`, `description`, `supplierId?`, `cashMovementId? @unique` (si salió de la caja), `fixedCostId?` + `period?` (`"2026-11"`, el mes que paga un costo fijo), `clientRequestId @unique` (idempotencia), `createdById`, `voidedAt?`/`voidedById?`/`voidReason?` (las tres juntas o ninguna).
Reglas: `CASH_DRAWER` exige `cashMovementId` y viceversa (una salida de caja es un gasto y una entrada es un ingreso; `clientRequestId = "cash:<id del movimiento>"`); un gasto de caja no se anula desde Finanzas; un costo fijo solo se paga una vez por mes mientras el pago no esté anulado (índice parcial único). Un trigger rechaza `DELETE` y cualquier `UPDATE` que no sea la anulación.

### FinanceBoxWithdrawal (retiro de la caja de finanzas — inmutable salvo su anulación)
`amountCents` (> 0), `occurredAt` (el día, UTC), `reason` (≥ 3 caracteres), `clientRequestId` (único: idempotencia), `createdById`, `createdAt`, `voidedAt?`, `voidedById?`, `voidReason?` (los tres de la anulación van juntos o ninguno). Es el efectivo que sale de la caja de finanzas (RF-FIN-12); no es un gasto. Un trigger impide `DELETE` y todo `UPDATE` que no sea la anulación (una sola vez). El servicio serializa los retiros con un candado de transacción y rechaza uno mayor que el saldo.

### FixedCost (costo fijo mensual)
`name`, `categoryId` (de gasto), `amountCents` (> 0), `dueDay` (1–28), `startsOn`, `endsOn?`, `archivedAt?`. No genera gastos: el sistema calcula los meses «por pagar» (desde el mayor entre `startsOn` y los últimos 6 meses, hasta el mes actual o `endsOn`, sin `FinanceEntry` vigente para ese `period`; `src/modules/finance/periods.ts`). El monto del pago puede ajustarse y queda en el movimiento; cambiar el costo fijo no toca los pagos hechos.

## 8. Índices recomendados

- `Variant(barcode)`, `Variant(sku)` únicos; índice trigram (`pg_trgm`) en `Product.name` + `Variant.sku` para búsqueda tolerante.
- `StockMovement(variantId, locationId, createdAt)`; `StockMovement(refType, refId)`.
- `Sale(createdAt)`, `Sale(sellerId, createdAt)`, `Sale(cashSessionId)`, `Sale(customerId)`.
- `SaleItem(variantId)`, `Payment(saleId)`, `Payment(cashSessionId, method)`.
- `AuditLog(entityType, entityId)`, `AuditLog(userId, createdAt)`.
- `FinanceEntry(occurredAt)`, `FinanceEntry(type, categoryId)`, `FinanceCategory(type, archivedAt)`, `FinanceBoxWithdrawal(occurredAt)`.

## 9. Invariantes globales (deben tener test)

1. `Σ StockMovement.quantity = StockLevel.onHand` para cada variante y ubicación.
2. `Σ Payment − change = Sale.total` para toda venta completada.
3. `Σ ReturnItem.quantity ≤ SaleItem.quantity` por línea.
4. Los correlativos fiscales no tienen saltos ni repeticiones y están dentro del rango vigente.
5. `Customer.storeCreditCents = Σ StoreCreditEntry.amountCents`.
6. `CashSession.expectedCash = opening + Σ Payment CASH + Σ LayawayPayment CASH − Σ Sale.changeCents + Σ CashMovement IN − Σ CashMovement OUT − reembolsos en efectivo`, solo con ventas `COMPLETED` (las anuladas no cuentan). `Payment.amountCents` en efectivo es lo que entregó el cliente (vuelto incluido); el vuelto se resta aparte. Función pura: `src/modules/cash/expected.ts`.
7. Una venta `VOIDED` revierte exactamente sus movimientos de stock y de pago.
8. Todo `FinanceEntry` con `paidWith = CASH_DRAWER` está enlazado a un `CashMovement` por el mismo monto (`OUT` para un gasto, `IN` para un ingreso), creados en la misma transacción. La utilidad neta del periodo = utilidad bruta de los reportes + Σ ingresos vigentes − Σ gastos vigentes (los anulados no cuentan). Función pura: `src/modules/finance/summary.ts`.

9. El saldo de la **caja de finanzas** = Σ `CashSession.withdrawnCents` + Σ ingresos vigentes con `paidWith = CASH_OTHER` − Σ gastos vigentes con `paidWith = CASH_OTHER` − Σ `FinanceBoxWithdrawal` vigentes. No hay tabla propia: se calcula de esas dos fuentes, así no puede desfasarse. Lo retirado en un cierre no es ingreso ni gasto y no entra en la utilidad neta. Función pura: `src/modules/finance/box.ts`.

## 10. Datos de ejemplo (seed)

> La **Fase 0** solo carga la semilla mínima (ubicación, terminal, cuatro usuarios, tallas, colores, categorías, perfil del negocio, ajustes por defecto y contadores de documentos). La semilla de demostración grande de abajo llega en fases posteriores.

Una `Location` + `Terminal`; 4 usuarios (uno por rol, con contraseñas de demo documentadas solo para desarrollo); tallas XS–XXL y 34–42; ~12 colores; ~8 categorías; ~30 productos con ~150 variantes y stock; 10 clientes; 40 ventas distribuidas en 30 días; un rango CAI de demo; un apartado activo.

## 11. Restricciones de la migración `constraints`

Lo que Prisma no puede expresar vive en la segunda migración (`constraints`):

- **Extensiones:** `pg_trgm` y `unaccent`.
- **Unicidad con NULL:** índice único `NULLS NOT DISTINCT` sobre `Variant(productId, sizeId, colorId)`.
- **Índices parciales únicos:** una caja abierta por usuario y por terminal (`CashSession`, `status = 'OPEN'`) y un rango fiscal activo por tipo y terminal (`FiscalRange`).
- **CHECK de montos y cantidades:** importes no negativos, cantidades positivas, `reserved >= 0`, `nextNumber` dentro del rango fiscal, descuento no mayor que el subtotal. No hay CHECK de `onHand >= 0` (ver §4).
- **Tablas de solo inserción:** triggers `prevent_row_mutation` que rechazan `UPDATE` y `DELETE` en `AuditLog`, `StockMovement` y `StoreCreditEntry`.
- **Finanzas:** `CHECK` de monto positivo, de anulación completa o ausente y de `CASH_DRAWER` ⇔ `cashMovementId`; índice parcial único `FinanceEntry(fixedCostId, period)` donde `voidedAt IS NULL`; trigger `FinanceEntry_guard` (no `DELETE`; `UPDATE` solo para anular). `FinanceBoxWithdrawal`: `CHECK` de monto positivo y de anulación completa o ausente, y el mismo tipo de trigger (`FinanceBoxWithdrawal_guard`).
- **Búsqueda tolerante a errores:** índices `gin` trigram sobre `Product.name` y `Variant.sku`. La consulta del listado compara con `unaccent(lower(...))` (no usa esos índices; basta a escala de boutique) y combina coincidencia exacta de código o barras, "contiene" y similitud de trigramas.
- **Secuencias de códigos:** `product_code_seq` (códigos `P00001`…) y `barcode_serial_seq` (serie de los EAN-13 internos). Pueden dejar huecos; solo garantizan unicidad (la numeración sin saltos es la de facturas).
