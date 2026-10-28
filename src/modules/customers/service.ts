import type { PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { CustomerInUseError, NotFoundError, PhoneTakenError, ValidationError } from "@/lib/errors";
import { requireCapability } from "@/lib/permissions";
import type { Actor } from "@/modules/catalog/service";
import { customerSchema, quickCustomerSchema } from "@/modules/customers/schemas";
import type { QuickCustomer } from "@/modules/sales/pos-types";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * Crea al cliente desde el mostrador con solo nombre y teléfono. Si ya hay alguien con ese teléfono se usa esa
 * persona (sin cambiarle el nombre); si estaba archivada, vuelve a estar activa.
 */
export async function quickCustomer(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<QuickCustomer> {
  requireCapability(actor, "sale.create");
  const parsed = quickCustomerSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { name, phone } = parsed.data;

  const find = async () => {
    if (!phone) {
      return null;
    }
    const existing = await client.customer.findUnique({ where: { phone } });
    if (existing?.archivedAt) {
      return client.customer.update({ where: { id: existing.id }, data: { archivedAt: null } });
    }
    return existing;
  };

  let customer = await find();
  if (!customer) {
    try {
      customer = await client.customer.create({ data: { name, phone } });
    } catch (error) {
      // Dos cajas crearon al mismo cliente a la vez: gana la primera y la otra usa esa.
      customer = isUniqueViolation(error) ? await find() : null;
      if (!customer) {
        throw error;
      }
    }
  }
  return { id: customer.id, name: customer.name, phone: customer.phone };
}

type CustomerSnapshot = {
  name: string;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  notes: string | null;
  preferredSizes: string | null;
};

const snapshotOf = (customer: CustomerSnapshot): CustomerSnapshot => ({
  name: customer.name,
  phone: customer.phone,
  email: customer.email,
  taxId: customer.taxId,
  notes: customer.notes,
  preferredSizes: customer.preferredSizes,
});

function parseCustomer(input: unknown) {
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const data = parsed.data;
  return {
    name: data.name,
    phone: data.phone ?? null,
    email: data.email ?? null,
    taxId: data.taxId ?? null,
    notes: data.notes ?? null,
    preferredSizes: data.preferredSizes ?? null,
  };
}

/** Crea un cliente con su ficha completa. El teléfono no se repite (tampoco con un cliente archivado). */
export async function createCustomer(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ id: string }> {
  requireCapability(actor, "customer.write");
  const data = parseCustomer(input);
  try {
    return await client.$transaction(async (tx) => {
      const created = await tx.customer.create({ data, select: { id: true } });
      await audit.log(tx, {
        userId: actor.id,
        action: "CUSTOMER_CREATED",
        entityType: "Customer",
        entityId: created.id,
        after: data,
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PhoneTakenError();
    }
    throw error;
  }
}

/** Cambia los datos de un cliente; deja en la auditoría cómo estaban y cómo quedaron. */
export async function updateCustomer(
  actor: Actor,
  id: string,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ id: string }> {
  requireCapability(actor, "customer.write");
  const data = parseCustomer(input);
  try {
    return await client.$transaction(async (tx) => {
      const before = await tx.customer.findUnique({ where: { id } });
      if (!before) {
        throw new NotFoundError("Customer not found");
      }
      await tx.customer.update({ where: { id }, data });
      await audit.log(tx, {
        userId: actor.id,
        action: "CUSTOMER_UPDATED",
        entityType: "Customer",
        entityId: id,
        before: snapshotOf(before),
        after: data,
      });
      return { id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PhoneTakenError();
    }
    throw error;
  }
}

/**
 * Archiva o restaura un cliente (nunca se borra: tiene historial). Un cliente con apartados activos no se archiva. Su
 * crédito de tienda y su historial se conservan; si vuelve, se restaura.
 */
export async function setCustomerArchived(
  actor: Actor,
  id: string,
  archived: boolean,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "customer.archive");
  await client.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new NotFoundError("Customer not found");
    }
    if (archived && (await tx.layaway.count({ where: { customerId: id, status: "ACTIVE" } })) > 0) {
      throw new CustomerInUseError();
    }
    if ((customer.archivedAt !== null) === archived) {
      return;
    }
    await tx.customer.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await audit.log(tx, {
      userId: actor.id,
      action: archived ? "CUSTOMER_ARCHIVED" : "CUSTOMER_RESTORED",
      entityType: "Customer",
      entityId: id,
      before: { archived: !archived },
      after: { archived },
    });
  });
}
