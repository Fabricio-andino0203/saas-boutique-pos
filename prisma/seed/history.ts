import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "../../src/generated/prisma/client";
import { addLocalDays, startOfLocalDay } from "../../src/lib/dates";
import { DOCUMENT_PREFIX, formatDocumentNumber } from "../../src/lib/document-number";
import { extractTax, percentOf } from "../../src/lib/money";
import { createStockLevels } from "../../src/modules/inventory/service";
import { valueOfUnits } from "../../src/modules/returns/calc";
import { assertNotProduction } from "./run-seed";

/**
 * Historia de prueba: un año de ventas realistas (más de 20 000 líneas con los valores por defecto) para probar los
 * reportes y su rendimiento. Escribe directo en la base, pero deja los libros cuadrados: cada venta tiene su salida de
 * stock, el stock final es la suma de los movimientos, el efectivo esperado de cada turno sale de su fórmula, los
 * correlativos continúan donde estaban y las devoluciones nunca pasan de lo vendido.
 *
 * Solo para desarrollo y pruebas (nunca con NODE_ENV=production). Es aditiva y no se puede cargar dos veces.
 */

export type HistoryOptions = {
  /** Meses hacia atrás desde ayer (365 días si son 12). */
  months?: number;
  /** Ventas por día en un día normal (varía con el día de la semana y la temporada). */
  salesPerDay?: number;
  /** Cuántos productos de prueba crear. */
  products?: number;
  seed?: number;
};

export type HistorySummary = {
  sales: number;
  lines: number;
  returns: number;
  sessions: number;
  variants: number;
  customers: number;
  from: Date;
  to: Date;
};

const HOUR_WEIGHTS: readonly (readonly [number, number])[] = [
  [9, 4],
  [10, 6],
  [11, 8],
  [12, 9],
  [13, 7],
  [14, 8],
  [15, 9],
  [16, 10],
  [17, 7],
];
const MONTH_FACTOR = [0.75, 1.2, 0.9, 0.95, 1.1, 1, 0.9, 0.95, 0.9, 1, 1.25, 1.7];
const WEEKDAY_FACTOR = [0.35, 0.8, 0.85, 0.9, 1, 1.35, 1.7]; // domingo … sábado
const TYPES = [
  { word: "Vestido", category: "mujer-vestidos", price: [65000, 140000], sizes: "ropa" },
  { word: "Blusa", category: "mujer-blusas", price: [28000, 60000], sizes: "ropa" },
  { word: "Camisa", category: "hombre-camisas", price: [35000, 75000], sizes: "ropa" },
  { word: "Pantalón", category: "hombre", price: [42000, 90000], sizes: "ropa" },
  { word: "Conjunto", category: "ninos", price: [30000, 65000], sizes: "ropa" },
  { word: "Sandalia", category: "calzado", price: [38000, 80000], sizes: "calzado" },
  { word: "Bolso", category: "accesorios", price: [30000, 95000], sizes: "ninguna" },
] as const;
const STYLES = [
  "floral",
  "lino",
  "clásico",
  "casual",
  "elegante",
  "verano",
  "urbano",
  "básico",
  "fiesta",
  "oficina",
];
const BRANDS = ["Aurora", "Costa", "Delfina", "Ébano", "Faro", "Gala"];
const CHUNK = 2000;

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function insertInChunks<T>(
  rows: T[],
  insert: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let index = 0; index < rows.length; index += CHUNK) {
    await insert(rows.slice(index, index + CHUNK));
  }
}

type HistVariant = {
  id: string;
  sku: string;
  productName: string;
  sizeName: string | null;
  colorName: string | null;
  priceCents: number;
  costCents: number;
  exempt: boolean;
  weight: number;
};

type HistLine = {
  id: string;
  variant: HistVariant;
  quantity: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  returned: number;
};

export async function generateHistory(
  client: PrismaClient,
  options: HistoryOptions = {},
): Promise<HistorySummary> {
  assertNotProduction("La historia de prueba");
  const months = options.months ?? 12;
  const salesPerDay = options.salesPerDay ?? 24;
  const productCount = options.products ?? 40;
  const random = mulberry32(options.seed ?? 0x5eed);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const chance = (probability: number) => random() < probability;
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;

  if ((await client.product.count({ where: { code: { startsWith: "HIST-" } } })) > 0) {
    throw new Error("La historia de prueba ya está cargada (hay productos HIST-)");
  }
  const location = await client.location.findFirstOrThrow({ where: { isDefault: true } });
  const terminal = await client.terminal.findFirstOrThrow({ where: { isActive: true } });
  const cashiers = await client.user.findMany({ where: { role: "CASHIER" } });
  const manager =
    (await client.user.findFirst({ where: { role: "MANAGER" } })) ??
    (await client.user.findFirstOrThrow({ where: { role: "OWNER" } }));
  if (cashiers.length === 0) {
    throw new Error("Hace falta al menos un cajero (corre primero `pnpm db:seed`)");
  }
  const sellers = [...cashiers, manager];

  // ───────────── Catálogo de prueba ─────────────
  const categories = await client.category.findMany({ select: { id: true, slug: true } });
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category.id]));
  const sizes = await client.size.findMany({ orderBy: { sortOrder: "asc" } });
  const colors = await client.color.findMany({ orderBy: { sortOrder: "asc" } });
  const brandIds: string[] = [];
  for (const name of BRANDS) {
    const brand = await client.brand.upsert({
      where: { name: `Marca ${name}` },
      update: {},
      create: { name: `Marca ${name}` },
      select: { id: true },
    });
    brandIds.push(brand.id);
  }

  const variants: HistVariant[] = [];
  const productRows: Prisma.ProductCreateManyInput[] = [];
  const variantRows: {
    id: string;
    productId: string;
    sizeId: string | null;
    colorId: string | null;
    sku: string;
    barcode: string;
    avgCostCents: number;
  }[] = [];
  let barcodeCounter = 0;
  for (let index = 1; index <= productCount; index += 1) {
    const type = TYPES[(index - 1) % TYPES.length] as (typeof TYPES)[number];
    const code = `HIST-${String(index).padStart(3, "0")}`;
    const name = `${type.word} ${pick(STYLES)} ${code}`;
    const price = Math.round(int(type.price[0], type.price[1]) / 500) * 500;
    const cost = Math.round(price * (0.38 + random() * 0.17));
    const productId = randomUUID();
    const exempt = type.word === "Bolso" && chance(0.5);
    const categoryId = categoryBySlug.get(type.category) ?? (categories[0] as { id: string }).id;
    productRows.push({
      id: productId,
      code,
      name,
      categoryId,
      brandId: pick(brandIds),
      basePriceCents: price,
      baseCostCents: cost,
      taxCategory: exempt ? "EXEMPT" : "STANDARD",
    });
    const pool =
      type.sizes === "ropa"
        ? sizes.filter((size) => size.group === "ropa").slice(1, 5)
        : type.sizes === "calzado"
          ? sizes.filter((size) => size.group === "calzado").slice(2, 7)
          : [null];
    const palette = [pick(colors), pick(colors), pick(colors)].filter(
      (color, position, all) => all.findIndex((other) => other.id === color.id) === position,
    );
    for (const size of pool) {
      for (const color of palette.slice(0, 1 + (index % 3))) {
        barcodeCounter += 1;
        // El nombre completo del color (sin tildes ni espacios): con tres letras "Azul" y "Azul marino" chocaban.
        const colorCode = color.name
          .normalize("NFD")
          .replace(/[^A-Za-z]/g, "")
          .toUpperCase();
        const sku = `${code}-${size?.name ?? "U"}-${colorCode}`;
        const id = randomUUID();
        variantRows.push({
          id,
          productId,
          sizeId: size?.id ?? null,
          colorId: color.id,
          sku,
          barcode: `3${String(barcodeCounter).padStart(12, "0")}`,
          avgCostCents: cost,
        });
        variants.push({
          id,
          sku,
          productName: name,
          sizeName: size?.name ?? null,
          colorName: color.name,
          priceCents: price,
          costCents: cost,
          exempt,
          weight: 0,
        });
      }
    }
  }
  // Popularidad: unos pocos productos venden mucho y muchos venden poco (lo que hace útiles los reportes)
  const productOrder = [...new Set(variantRows.map((row) => row.productId))].sort(
    () => random() - 0.5,
  );
  const rankOf = new Map(productOrder.map((id, rank) => [id, rank + 1]));
  variants.forEach((variant, position) => {
    const row = variantRows[position] as (typeof variantRows)[number];
    variant.weight = (rankOf.get(row.productId) as number) ** -0.9 * (0.4 + random());
  });
  const cumulative: number[] = [];
  variants.reduce((sum, variant) => {
    const next = sum + variant.weight;
    cumulative.push(next);
    return next;
  }, 0);
  const totalWeight = cumulative[cumulative.length - 1] as number;
  const pickVariant = (): HistVariant => {
    const target = random() * totalWeight;
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((cumulative[middle] as number) < target) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return variants[low] as HistVariant;
  };

  // ───────────── Clientes de prueba ─────────────
  const customerRows = Array.from({ length: 60 }, (_, index) => ({
    id: randomUUID(),
    name: `Cliente de prueba ${String(index + 1).padStart(2, "0")}`,
    phone: `7100-${String(index + 1).padStart(4, "0")}`,
  }));

  // ───────────── Simulación día por día ─────────────
  const yesterday = startOfLocalDay(addLocalDays(new Date(), -1));
  const totalDays = Math.round(months * 30.4);
  const firstDay = addLocalDays(yesterday, -(totalDays - 1));
  const days = Array.from({ length: totalDays }, (_, offset) =>
    startOfLocalDay(addLocalDays(firstDay, offset)),
  );
  const weekdayOf = (day: Date) => new Date(day.getTime() + 6 * 3600_000).getUTCDay();
  const monthOf = (day: Date) => new Date(day.getTime() + 6 * 3600_000).getUTCMonth();
  const closedDay = days.map((day) => weekdayOf(day) === 0 && chance(0.8));
  const nextOpen = (index: number): number => {
    let at = index;
    while (at < days.length && closedDay[at]) {
      at += 1;
    }
    return at;
  };

  const saleCounter = await client.documentCounter.upsert({
    where: { key: "SALE" },
    update: {},
    create: { key: "SALE", nextValue: 1 },
  });
  const returnCounter = await client.documentCounter.upsert({
    where: { key: "RETURN" },
    update: {},
    create: { key: "RETURN", nextValue: 1 },
  });
  let saleNumber = saleCounter.nextValue;
  let returnNumber = returnCounter.nextValue;

  type SessionAcc = {
    id: string;
    userId: string;
    openedAt: Date;
    closedAt: Date;
    floatCents: number;
    cashIn: number;
    change: number;
    refunds: number;
  };
  const sessions: SessionAcc[] = [];
  const saleRows: Record<string, unknown>[] = [];
  const itemRows: Record<string, unknown>[] = [];
  const paymentRows: Record<string, unknown>[] = [];
  const returnRows: Record<string, unknown>[] = [];
  const returnItemRows: Record<string, unknown>[] = [];
  const movementRows: Record<string, unknown>[] = [];
  const net = new Map<string, number>(); // por prenda: − vendido + devuelto a estante
  const soldUnits = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string, by: number) =>
    map.set(key, (map.get(key) ?? 0) + by);
  const pendingReturns: { saleId: string; line: HistLine; saleAt: Date }[][] = days.map(() => []);
  let lineCount = 0;

  const timeIn = (day: Date): Date => {
    const total = HOUR_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = random() * total;
    let hour = 12;
    for (const [candidate, weight] of HOUR_WEIGHTS) {
      roll -= weight;
      if (roll <= 0) {
        hour = candidate;
        break;
      }
    }
    return new Date(day.getTime() + hour * 3600_000 + int(0, 59) * 60_000 + int(0, 59) * 1000);
  };

  for (let index = 0; index < days.length; index += 1) {
    if (closedDay[index]) {
      continue;
    }
    const day = days[index] as Date;
    const cashier = cashiers[index % cashiers.length] as (typeof cashiers)[number];
    const session: SessionAcc = {
      id: randomUUID(),
      userId: cashier.id,
      openedAt: new Date(day.getTime() + 8 * 3600_000),
      closedAt: new Date(day.getTime() + 18 * 3600_000 + 15 * 60_000),
      floatCents: pick([50000, 50000, 80000]),
      cashIn: 0,
      change: 0,
      refunds: 0,
    };
    sessions.push(session);

    const expected =
      salesPerDay *
      (MONTH_FACTOR[monthOf(day)] as number) *
      (WEEKDAY_FACTOR[weekdayOf(day)] as number);
    const salesToday = Math.max(2, Math.round(expected * (0.8 + random() * 0.4)));

    // Primero las devoluciones que tocan hoy (de ventas de días anteriores)
    for (const pending of pendingReturns[index] as (typeof pendingReturns)[number]) {
      const quantity = 1;
      const refund = valueOfUnits(
        pending.line.totalCents,
        pending.line.quantity,
        pending.line.returned,
        quantity,
      );
      pending.line.returned += quantity;
      const at = new Date(day.getTime() + int(9, 16) * 3600_000 + int(0, 59) * 60_000);
      const returnId = randomUUID();
      const damaged = chance(0.1);
      const number = formatDocumentNumber(DOCUMENT_PREFIX.RETURN, returnNumber);
      returnNumber += 1;
      returnRows.push({
        id: returnId,
        number,
        clientRequestId: `hist-r-${number}`,
        saleId: pending.saleId,
        type: "RETURN",
        reason: pick([
          "Talla incorrecta",
          "No le gustó",
          "Defecto de fábrica",
          "Cambió de opinión",
        ]),
        refundMethod: "CASH",
        refundCents: refund,
        cashSessionId: session.id,
        processedById: session.userId,
        authorizedById: manager.id,
        createdAt: at,
      });
      returnItemRows.push({
        id: randomUUID(),
        returnId,
        saleItemId: pending.line.id,
        quantity,
        condition: damaged ? "DAMAGED" : "RESELLABLE",
        refundCents: refund,
      });
      movementRows.push({
        id: randomUUID(),
        variantId: pending.line.variant.id,
        locationId: location.id,
        type: "RETURN_IN",
        quantity,
        unitCostCents: pending.line.variant.costCents,
        refType: "ReturnDoc",
        refId: returnId,
        reason: "Devolución",
        userId: session.userId,
        createdAt: at,
      });
      bump(net, pending.line.variant.id, quantity);
      if (damaged) {
        movementRows.push({
          id: randomUUID(),
          variantId: pending.line.variant.id,
          locationId: location.id,
          type: "RETURN_SCRAP",
          quantity: -quantity,
          unitCostCents: pending.line.variant.costCents,
          refType: "ReturnDoc",
          refId: returnId,
          reason: "Merma por devolución",
          userId: session.userId,
          createdAt: new Date(at.getTime() + 1000),
        });
        bump(net, pending.line.variant.id, -quantity);
      }
      session.refunds += refund;
    }

    for (let sale = 0; sale < salesToday; sale += 1) {
      const saleId = randomUUID();
      const createdAt = timeIn(day);
      const seller = chance(0.7) ? cashier : pick(sellers);
      const lines: HistLine[] = [];
      const wanted = pick([1, 1, 1, 2, 2, 2, 3, 3, 4, 5]);
      for (let position = 0; position < wanted; position += 1) {
        const variant = pickVariant();
        if (lines.some((line) => line.variant.id === variant.id)) {
          continue;
        }
        const quantity = pick([1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 3]);
        const gross = variant.priceCents * quantity;
        const discountCents = chance(0.06) ? percentOf(gross, pick([500, 1000])) : 0;
        const totalCents = gross - discountCents;
        const taxCents = variant.exempt ? 0 : extractTax(totalCents, 1500).taxCents;
        lines.push({
          id: randomUUID(),
          variant,
          quantity,
          discountCents,
          taxCents,
          totalCents,
          returned: 0,
        });
      }
      const total = lines.reduce((sum, line) => sum + line.totalCents, 0);
      const tax = lines.reduce((sum, line) => sum + line.taxCents, 0);

      // Pagos: efectivo con vuelto, tarjeta, transferencia o mixto
      const payments: { method: string; amountCents: number; reference?: string }[] = [];
      let change = 0;
      const mode = random();
      if (mode < 0.45) {
        const tendered = Math.ceil(total / 5000) * 5000;
        payments.push({ method: "CASH", amountCents: tendered });
        change = tendered - total;
      } else if (mode < 0.8) {
        payments.push({ method: "CARD", amountCents: total, reference: String(int(1000, 9999)) });
      } else if (mode < 0.92) {
        payments.push({
          method: "TRANSFER",
          amountCents: total,
          reference: `T-${int(10000, 99999)}`,
        });
      } else {
        const card = Math.round(total / 2);
        payments.push({ method: "CARD", amountCents: card, reference: String(int(1000, 9999)) });
        payments.push({ method: "CASH", amountCents: total - card });
      }
      const cash = payments
        .filter((payment) => payment.method === "CASH")
        .reduce((sum, p) => sum + p.amountCents, 0);
      session.cashIn += cash;
      session.change += change;

      const number = formatDocumentNumber(DOCUMENT_PREFIX.SALE, saleNumber);
      saleNumber += 1;
      saleRows.push({
        id: saleId,
        number,
        clientRequestId: `hist-s-${number}`,
        status: "COMPLETED",
        locationId: location.id,
        terminalId: terminal.id,
        cashSessionId: session.id,
        sellerId: seller.id,
        customerId: chance(0.3) ? (pick(customerRows) as { id: string }).id : null,
        subtotalCents: total,
        discountCents: 0,
        taxCents: tax,
        totalCents: total,
        paidCents: payments.reduce((sum, payment) => sum + payment.amountCents, 0),
        changeCents: change,
        createdAt,
      });
      for (const payment of payments) {
        paymentRows.push({
          id: randomUUID(),
          saleId,
          method: payment.method,
          amountCents: payment.amountCents,
          reference: payment.reference ?? null,
          cashSessionId: session.id,
          createdAt,
        });
      }
      for (const line of lines) {
        lineCount += 1;
        itemRows.push({
          id: line.id,
          saleId,
          variantId: line.variant.id,
          quantity: line.quantity,
          unitPriceCents: line.variant.priceCents,
          unitCostCents: line.variant.costCents,
          lineDiscountCents: line.discountCents,
          taxRate: line.variant.exempt ? 0 : 1500,
          taxCents: line.taxCents,
          lineTotalCents: line.totalCents,
          productName: line.variant.productName,
          sizeName: line.variant.sizeName,
          colorName: line.variant.colorName,
          sku: line.variant.sku,
        });
        movementRows.push({
          id: randomUUID(),
          variantId: line.variant.id,
          locationId: location.id,
          type: "SALE_OUT",
          quantity: -line.quantity,
          unitCostCents: line.variant.costCents,
          refType: "Sale",
          refId: saleId,
          userId: seller.id,
          createdAt,
        });
        bump(net, line.variant.id, -line.quantity);
        bump(soldUnits, line.variant.id, line.quantity);
      }
      // Algunas ventas se devuelven en los días siguientes
      if (chance(0.04)) {
        const target = nextOpen(index + int(0, 6));
        if (target < days.length) {
          (pendingReturns[target] as (typeof pendingReturns)[number]).push({
            saleId,
            line: pick(lines),
            saleAt: createdAt,
          });
        }
      }
    }
  }

  // Un turno se cierra con lo que debía haber, y a veces con una pequeña diferencia
  const sessionRows = sessions.map((session) => {
    const expected = session.floatCents + session.cashIn - session.change - session.refunds;
    const difference = chance(0.85) ? 0 : pick([-1500, -500, -200, 300, 800]);
    return {
      id: session.id,
      terminalId: terminal.id,
      userId: session.userId,
      status: "CLOSED" as const,
      openedAt: session.openedAt,
      openingFloatCents: session.floatCents,
      closedAt: session.closedAt,
      expectedCashCents: expected,
      countedCashCents: expected + difference,
      differenceCents: difference,
      approvedById: manager.id,
      notes: difference === 0 ? null : "Diferencia de prueba",
      createdAt: session.openedAt,
    };
  });

  // Existencias: lo que había al empezar cubre todo lo vendido y un poco más
  const initialAt = new Date((days[0] as Date).getTime() - 24 * 3600_000);
  const levelRows = variants.map((variant) => {
    const flow = net.get(variant.id) ?? 0; // negativo: salió más de lo que volvió
    const initial = Math.max(0, -flow) + int(3, 25);
    movementRows.push({
      id: randomUUID(),
      variantId: variant.id,
      locationId: location.id,
      type: "INITIAL",
      quantity: initial,
      unitCostCents: variant.costCents,
      reason: "Existencia inicial de la historia de prueba",
      userId: manager.id,
      createdAt: initialAt,
    });
    return {
      id: randomUUID(),
      variantId: variant.id,
      locationId: location.id,
      onHand: initial + flow,
      reserved: 0,
    };
  });

  await client.$transaction(
    async (tx) => {
      await tx.customer.createMany({ data: customerRows });
      await tx.product.createMany({ data: productRows });
      await insertInChunks(variantRows, (chunk) => tx.variant.createMany({ data: chunk }));
      await tx.cashSession.createMany({ data: sessionRows });
      await insertInChunks(saleRows, (chunk) => tx.sale.createMany({ data: chunk as never }));
      await insertInChunks(itemRows, (chunk) => tx.saleItem.createMany({ data: chunk as never }));
      await insertInChunks(paymentRows, (chunk) => tx.payment.createMany({ data: chunk as never }));
      await insertInChunks(returnRows, (chunk) =>
        tx.returnDoc.createMany({ data: chunk as never }),
      );
      await insertInChunks(returnItemRows, (chunk) =>
        tx.returnItem.createMany({ data: chunk as never }),
      );
      await insertInChunks(movementRows, (chunk) =>
        tx.stockMovement.createMany({ data: chunk as never }),
      );
      await insertInChunks(levelRows, (chunk) => createStockLevels(tx, chunk));
      await tx.documentCounter.update({ where: { key: "SALE" }, data: { nextValue: saleNumber } });
      await tx.documentCounter.update({
        where: { key: "RETURN" },
        data: { nextValue: returnNumber },
      });
    },
    { timeout: 600_000, maxWait: 30_000 },
  );

  // Tras una carga masiva Postgres aún no tiene estadísticas de las tablas y puede elegir planes de varios segundos para
  // joins que con estadísticas tardan milisegundos; en producción lo hace el autovacuum. Se actualizan aquí para que la
  // base de desarrollo y la de pruebas se parezcan a una instalación con uso real.
  await client.$executeRawUnsafe("ANALYZE");

  return {
    sales: saleRows.length,
    lines: lineCount,
    returns: returnRows.length,
    sessions: sessionRows.length,
    variants: variants.length,
    customers: customerRows.length,
    from: days[0] as Date,
    to: days[days.length - 1] as Date,
  };
}
