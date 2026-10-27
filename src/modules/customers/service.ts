import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { requireCapability } from "@/lib/permissions";
import type { Actor } from "@/modules/catalog/service";
import { quickCustomerSchema } from "@/modules/customers/schemas";
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
