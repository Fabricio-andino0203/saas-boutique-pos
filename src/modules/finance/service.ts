import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { localDateKey, parseLocalDateKey } from "@/lib/dates";
import { db } from "@/lib/db";
import {
  FinanceDrawerEntryError,
  FinanceEntryVoidedError,
  FixedCostPaidError,
  ItemInUseError,
  NameTakenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { requireCapability } from "@/lib/permissions";
import type { Actor } from "@/modules/catalog/service";
import { formatPeriod, periodOf, periodStart } from "@/modules/finance/periods";
import {
  categorySchema,
  financeEntrySchema,
  fixedCostSchema,
  payFixedCostSchema,
  renameCategorySchema,
  voidEntrySchema,
} from "@/modules/finance/schemas";

type Tx = Prisma.TransactionClient;

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input";
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/** Lo que se guarda en la auditoría de un movimiento (sin ids internos que no ayuden a leerla). */
function snapshot(entry: {
  type: string;
  categoryId: string;
  amountCents: number;
  occurredAt: Date;
  paidWith: string;
  description: string;
  supplierId: string | null;
}): Prisma.InputJsonValue {
  return {
    type: entry.type,
    categoryId: entry.categoryId,
    amountCents: entry.amountCents,
    occurredAt: entry.occurredAt.toISOString(),
    paidWith: entry.paidWith,
    description: entry.description,
    supplierId: entry.supplierId,
  };
}

/**
 * Registra un gasto o un ingreso que no es venta. Es idempotente: reintentar con el mismo `clientRequestId` devuelve el
 * movimiento que ya se guardó y no crea otro.
 */
export async function createFinanceEntry(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
  now: Date = new Date(),
): Promise<{ id: string }> {
  requireCapability(actor, "finance.write");
  const parsed = financeEntrySchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const data = parsed.data;

  const existing = await client.financeEntry.findUnique({
    where: { clientRequestId: data.clientRequestId },
    select: { id: true, createdById: true },
  });
  if (existing) {
    if (existing.createdById !== actor.id) {
      throw new ValidationError("Request id already used");
    }
    return { id: existing.id };
  }

  const occurredAt = parseLocalDateKey(data.occurredOn);
  if (!occurredAt || data.occurredOn > localDateKey(now)) {
    throw new ValidationError("Invalid date");
  }

  try {
    return await client.$transaction(async (tx) => {
      const category = await tx.financeCategory.findUnique({ where: { id: data.categoryId } });
      if (!category) {
        throw new NotFoundError("Category not found");
      }
      if (category.archivedAt || category.type !== data.type) {
        throw new ValidationError("Category is archived or of the other type");
      }
      if (data.supplierId) {
        const supplier = await tx.supplier.findUnique({
          where: { id: data.supplierId },
          select: { id: true, archivedAt: true },
        });
        if (!supplier || supplier.archivedAt) {
          throw new NotFoundError("Supplier not found");
        }
      }
      const entry = await tx.financeEntry.create({
        data: {
          type: data.type,
          categoryId: data.categoryId,
          amountCents: data.amountCents,
          occurredAt,
          paidWith: data.paidWith,
          description: data.description,
          supplierId: data.supplierId ?? null,
          clientRequestId: data.clientRequestId,
          createdById: actor.id,
        },
      });
      await audit.log(tx, {
        userId: actor.id,
        action: "FINANCE_ENTRY_CREATED",
        entityType: "FinanceEntry",
        entityId: entry.id,
        after: snapshot(entry),
      });
      return { id: entry.id };
    });
  } catch (error) {
    // Dos envíos iguales a la vez: gana el primero y el segundo devuelve ese movimiento.
    if (isUniqueViolation(error)) {
      const winner = await client.financeEntry.findUnique({
        where: { clientRequestId: data.clientRequestId },
        select: { id: true, createdById: true },
      });
      if (winner && winner.createdById === actor.id) {
        return { id: winner.id };
      }
    }
    throw error;
  }
}

/**
 * Registra, dentro de la transacción de la caja, el movimiento de Finanzas de una salida o entrada de efectivo (RF-FIN-4):
 * una salida es un gasto y una entrada es un ingreso que no es venta. No pide permisos de Finanzas (quien saca o mete el
 * efectivo es el cajero, que tiene `cash.open`); quien llama ya revisó eso y que el plan incluya el módulo. Es el mismo
 * movimiento de caja el que queda enlazado, así que el arqueo y las finanzas no se contradicen.
 */
export async function recordCashMovementEntry(
  tx: Tx,
  input: {
    actorId: string;
    cashMovementId: string;
    type: "IN" | "OUT";
    categoryId: string;
    amountCents: number;
    description: string;
  },
  now: Date = new Date(),
): Promise<{ id: string }> {
  const entryType = input.type === "OUT" ? "EXPENSE" : "INCOME";
  const category = await tx.financeCategory.findUnique({ where: { id: input.categoryId } });
  if (!category) {
    throw new NotFoundError("Category not found");
  }
  if (category.archivedAt || category.type !== entryType) {
    throw new ValidationError("Category is archived or of the other type");
  }
  const occurredAt = parseLocalDateKey(localDateKey(now));
  if (!occurredAt) {
    throw new ValidationError("Invalid date");
  }
  const entry = await tx.financeEntry.create({
    data: {
      type: entryType,
      categoryId: input.categoryId,
      amountCents: input.amountCents,
      occurredAt,
      paidWith: "CASH_DRAWER",
      description: input.description,
      cashMovementId: input.cashMovementId,
      clientRequestId: `cash:${input.cashMovementId}`,
      createdById: input.actorId,
    },
  });
  await audit.log(tx, {
    userId: input.actorId,
    action: "FINANCE_ENTRY_CREATED",
    entityType: "FinanceEntry",
    entityId: entry.id,
    after: {
      ...(snapshot(entry) as Record<string, unknown>),
      cashMovementId: input.cashMovementId,
    },
  });
  return { id: entry.id };
}

/**
 * Anula un movimiento (con motivo). No se borra ni se edita: el libro conserva el movimiento y quién lo anuló. Un gasto que
 * salió de la caja no se anula aquí: el efectivo ya salió y se corrige con una entrada de efectivo.
 */
export async function voidFinanceEntry(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
  now: Date = new Date(),
): Promise<void> {
  requireCapability(actor, "finance.void");
  const parsed = voidEntrySchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const { entryId, reason } = parsed.data;

  await client.$transaction(async (tx) => {
    const entry = await tx.financeEntry.findUnique({ where: { id: entryId } });
    if (!entry) {
      throw new NotFoundError("Finance entry not found");
    }
    if (entry.voidedAt) {
      throw new FinanceEntryVoidedError();
    }
    if (entry.cashMovementId) {
      throw new FinanceDrawerEntryError();
    }
    // `voidedAt: null` en el filtro: si otra anulación llegó primero, esta no pisa nada.
    const result = await tx.financeEntry.updateMany({
      where: { id: entryId, voidedAt: null },
      data: { voidedAt: now, voidedById: actor.id, voidReason: reason },
    });
    if (result.count === 0) {
      throw new FinanceEntryVoidedError();
    }
    await audit.log(tx, {
      userId: actor.id,
      action: "FINANCE_ENTRY_VOIDED",
      entityType: "FinanceEntry",
      entityId: entryId,
      before: snapshot(entry),
      reason,
    });
  });
}

// ───────────────────────── Categorías ─────────────────────────

/** Agrega una categoría de gasto o de ingreso. Dos con el mismo nombre (sin importar mayúsculas) en un tipo no caben. */
export async function createFinanceCategory(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ id: string }> {
  requireCapability(actor, "finance.write");
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const { type, name } = parsed.data;

  return client.$transaction(async (tx) => {
    await assertNameFree(tx, type, name);
    const last = await tx.financeCategory.aggregate({ where: { type }, _max: { sortOrder: true } });
    const category = await tx.financeCategory.create({
      data: { type, name, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    });
    await audit.log(tx, {
      userId: actor.id,
      action: "FINANCE_CATEGORY_CHANGED",
      entityType: "FinanceCategory",
      entityId: category.id,
      after: { type, name },
    });
    return { id: category.id };
  });
}

async function assertNameFree(
  tx: Tx,
  type: "EXPENSE" | "INCOME",
  name: string,
  exceptId?: string,
): Promise<void> {
  const clash = await tx.financeCategory.findFirst({
    where: {
      type,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    throw new NameTakenError();
  }
}

export async function renameFinanceCategory(
  actor: Actor,
  categoryId: string,
  input: unknown,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "finance.write");
  const parsed = renameCategorySchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const { name } = parsed.data;

  await client.$transaction(async (tx) => {
    const category = await tx.financeCategory.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundError("Category not found");
    }
    if (category.name === name) {
      return;
    }
    await assertNameFree(tx, category.type, name, category.id);
    await tx.financeCategory.update({ where: { id: category.id }, data: { name } });
    await audit.log(tx, {
      userId: actor.id,
      action: "FINANCE_CATEGORY_CHANGED",
      entityType: "FinanceCategory",
      entityId: category.id,
      before: { name: category.name },
      after: { name },
    });
  });
}

/** Archiva o restaura una categoría. No se archiva una que usan costos fijos activos: primero se cambian o se archivan. */
export async function setFinanceCategoryArchived(
  actor: Actor,
  categoryId: string,
  archived: boolean,
  client: PrismaClient = db,
  now: Date = new Date(),
): Promise<void> {
  requireCapability(actor, "finance.write");

  await client.$transaction(async (tx) => {
    const category = await tx.financeCategory.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundError("Category not found");
    }
    if ((category.archivedAt !== null) === archived) {
      return;
    }
    if (archived) {
      const inUse = await tx.fixedCost.count({
        where: { categoryId, archivedAt: null },
      });
      if (inUse > 0) {
        throw new ItemInUseError();
      }
    }
    await tx.financeCategory.update({
      where: { id: categoryId },
      data: { archivedAt: archived ? now : null },
    });
    await audit.log(tx, {
      userId: actor.id,
      action: "FINANCE_CATEGORY_CHANGED",
      entityType: "FinanceCategory",
      entityId: categoryId,
      before: { archived: category.archivedAt !== null },
      after: { archived },
    });
  });
}

// ───────────────────────── Costos fijos ─────────────────────────

const fixedCostSnapshot = (cost: {
  name: string;
  categoryId: string;
  amountCents: number;
  dueDay: number;
  startsOn: Date;
  endsOn: Date | null;
}): Prisma.InputJsonValue => ({
  name: cost.name,
  categoryId: cost.categoryId,
  amountCents: cost.amountCents,
  dueDay: cost.dueDay,
  startsOn: periodOf(cost.startsOn),
  endsOn: cost.endsOn ? periodOf(cost.endsOn) : null,
});

async function assertActiveExpenseCategory(tx: Tx, categoryId: string): Promise<void> {
  const category = await tx.financeCategory.findUnique({ where: { id: categoryId } });
  if (!category) {
    throw new NotFoundError("Category not found");
  }
  if (category.archivedAt || category.type !== "EXPENSE") {
    throw new ValidationError("Category is archived or not an expense category");
  }
}

async function assertFixedCostNameFree(tx: Tx, name: string, exceptId?: string): Promise<void> {
  const clash = await tx.fixedCost.findFirst({
    where: {
      archivedAt: null,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    throw new NameTakenError();
  }
}

/** Agrega un costo fijo mensual. No genera gastos: cada mes aparece como «por pagar» y se paga con {@link payFixedCost}. */
export async function createFixedCost(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ id: string }> {
  requireCapability(actor, "finance.write");
  const parsed = fixedCostSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const data = parsed.data;

  return client.$transaction(async (tx) => {
    await assertActiveExpenseCategory(tx, data.categoryId);
    await assertFixedCostNameFree(tx, data.name);
    const cost = await tx.fixedCost.create({
      data: {
        name: data.name,
        categoryId: data.categoryId,
        amountCents: data.amountCents,
        dueDay: data.dueDay,
        startsOn: periodStart(data.startsOn),
        endsOn: data.endsOn ? periodStart(data.endsOn) : null,
      },
    });
    await audit.log(tx, {
      userId: actor.id,
      action: "FIXED_COST_CHANGED",
      entityType: "FixedCost",
      entityId: cost.id,
      after: fixedCostSnapshot(cost),
    });
    return { id: cost.id };
  });
}

/** Cambia un costo fijo. Los pagos que ya se hicieron conservan su monto: el cambio vale para los meses que faltan. */
export async function updateFixedCost(
  actor: Actor,
  fixedCostId: string,
  input: unknown,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "finance.write");
  const parsed = fixedCostSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const data = parsed.data;

  await client.$transaction(async (tx) => {
    const cost = await tx.fixedCost.findUnique({ where: { id: fixedCostId } });
    if (!cost) {
      throw new NotFoundError("Fixed cost not found");
    }
    if (cost.archivedAt) {
      throw new ValidationError("An archived fixed cost cannot be edited");
    }
    await assertActiveExpenseCategory(tx, data.categoryId);
    await assertFixedCostNameFree(tx, data.name, cost.id);
    const updated = await tx.fixedCost.update({
      where: { id: cost.id },
      data: {
        name: data.name,
        categoryId: data.categoryId,
        amountCents: data.amountCents,
        dueDay: data.dueDay,
        startsOn: periodStart(data.startsOn),
        endsOn: data.endsOn ? periodStart(data.endsOn) : null,
      },
    });
    await audit.log(tx, {
      userId: actor.id,
      action: "FIXED_COST_CHANGED",
      entityType: "FixedCost",
      entityId: cost.id,
      before: fixedCostSnapshot(cost),
      after: fixedCostSnapshot(updated),
    });
  });
}

/** Archiva o restaura un costo fijo (los pagos que ya tiene no cambian). */
export async function setFixedCostArchived(
  actor: Actor,
  fixedCostId: string,
  archived: boolean,
  client: PrismaClient = db,
  now: Date = new Date(),
): Promise<void> {
  requireCapability(actor, "finance.write");

  await client.$transaction(async (tx) => {
    const cost = await tx.fixedCost.findUnique({
      where: { id: fixedCostId },
      include: { category: { select: { archivedAt: true } } },
    });
    if (!cost) {
      throw new NotFoundError("Fixed cost not found");
    }
    if ((cost.archivedAt !== null) === archived) {
      return;
    }
    if (!archived) {
      if (cost.category.archivedAt) {
        throw new ValidationError("Its category is archived");
      }
      await assertFixedCostNameFree(tx, cost.name, cost.id);
    }
    await tx.fixedCost.update({
      where: { id: cost.id },
      data: { archivedAt: archived ? now : null },
    });
    await audit.log(tx, {
      userId: actor.id,
      action: "FIXED_COST_CHANGED",
      entityType: "FixedCost",
      entityId: cost.id,
      before: { archived: cost.archivedAt !== null },
      after: { archived },
    });
  });
}

/**
 * Registra el pago de un costo fijo en un mes: un gasto con sus datos llenos (categoría, descripción, mes) que **no se puede
 * repetir** mientras el pago no esté anulado. El monto parte del habitual pero se puede ajustar. Es idempotente por
 * `clientRequestId`.
 */
export async function payFixedCost(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
  now: Date = new Date(),
): Promise<{ id: string }> {
  requireCapability(actor, "finance.write");
  const parsed = payFixedCostSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const data = parsed.data;

  const existing = await client.financeEntry.findUnique({
    where: { clientRequestId: data.clientRequestId },
    select: { id: true, createdById: true },
  });
  if (existing) {
    if (existing.createdById !== actor.id) {
      throw new ValidationError("Request id already used");
    }
    return { id: existing.id };
  }

  const occurredAt = parseLocalDateKey(data.occurredOn);
  if (!occurredAt || data.occurredOn > localDateKey(now)) {
    throw new ValidationError("Invalid date");
  }

  try {
    return await client.$transaction(async (tx) => {
      const cost = await tx.fixedCost.findUnique({ where: { id: data.fixedCostId } });
      if (!cost) {
        throw new NotFoundError("Fixed cost not found");
      }
      if (cost.archivedAt) {
        throw new ValidationError("An archived fixed cost cannot be paid");
      }
      const first = periodOf(cost.startsOn);
      const last = cost.endsOn ? periodOf(cost.endsOn) : periodOf(now);
      if (data.period < first || data.period > last || data.period > periodOf(now)) {
        throw new ValidationError("That month is not payable for this fixed cost");
      }
      await assertActiveExpenseCategory(tx, cost.categoryId);
      const paid = await tx.financeEntry.findFirst({
        where: { fixedCostId: cost.id, period: data.period, voidedAt: null },
        select: { id: true },
      });
      if (paid) {
        throw new FixedCostPaidError();
      }
      const entry = await tx.financeEntry.create({
        data: {
          type: "EXPENSE",
          categoryId: cost.categoryId,
          amountCents: data.amountCents,
          occurredAt,
          paidWith: data.paidWith,
          description: `${cost.name} (${formatPeriod(data.period)})`,
          fixedCostId: cost.id,
          period: data.period,
          clientRequestId: data.clientRequestId,
          createdById: actor.id,
        },
      });
      await audit.log(tx, {
        userId: actor.id,
        action: "FINANCE_ENTRY_CREATED",
        entityType: "FinanceEntry",
        entityId: entry.id,
        after: {
          ...(snapshot(entry) as Record<string, unknown>),
          fixedCostId: cost.id,
          period: data.period,
        },
      });
      return { id: entry.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await client.financeEntry.findUnique({
        where: { clientRequestId: data.clientRequestId },
        select: { id: true, createdById: true },
      });
      if (winner && winner.createdById === actor.id) {
        return { id: winner.id };
      }
      // Otro pago del mismo mes llegó primero.
      throw new FixedCostPaidError(undefined, { cause: error });
    }
    throw error;
  }
}
